// Session events -> observations.
//
// Detectors read observations, never raw events, so the same detectors run on
// a live session and on a stored log read back from disk.
import { isMarked } from './marks.js'
import { canonicalArgs, commandFamily, commandHead, missingProgram, runsProgram, signatureOf } from './signature.js'

const TEXT_CAP = 4000
const MUTATING_TOOLS = new Set(['write', 'edit', 'apply_patch', 'multi_edit'])
const READ_TOOLS = new Set(['read', 'glob', 'grep', 'read_image'])
const VERIFY_COMMAND = /\b(?:test|tests|pytest|jest|vitest|mocha|check|lint|eslint|tsc|typecheck|build|compile|cargo|go (?:test|vet|build)|make|gradle|mvn|ctest|rspec|phpunit|ruff|mypy|flake8)\b/i

function blockText(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  return content.map(block => (block && block.type === 'text' ? block.text : '')).join('\n')
}

function parseArguments(raw) {
  if (typeof raw !== 'string') return raw ?? {}
  try {
    return JSON.parse(raw)
  } catch {
    // Malformed argument JSON is itself the observation; keep it as text.
    return { $raw: raw }
  }
}

function exitCodeOf(text) {
  const match = /\[exit code: (-?\d+)\]\s*$/.exec(text)
  return match ? Number(match[1]) : undefined
}

function pathOf(args) {
  return args?.file_path ?? args?.path ?? args?.filePath
}

/** Programs that look at or move files but do not exercise the code in them. */
const INSPECTING = new Set([
  'ls', 'cat', 'echo', 'printf', 'pwd', 'cd', 'git', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'sed', 'awk', 'sort', 'uniq', 'cut', 'diff',
  'which', 'command', 'type', 'mkdir', 'touch', 'cp', 'mv', 'rm', 'chmod', 'tree', 'stat', 'file', 'true', 'false', 'export', 'env', 'set',
  'date', 'whoami', 'test', '[', 'sleep', 'exit',
])

/**
 * Whether a shell command checks the work: it names a test, build or lint step, or it runs a program
 * (an interpreter on the code, a script, a compiler) rather than only looking at files.
 */
export function isVerifying(command) {
  if (typeof command !== 'string' || command.trim() === '') return false
  if (VERIFY_COMMAND.test(command)) return true
  return command.split(/[;&|()\n]+/).some((segment) => {
    const tokens = segment.trim().split(/\s+/).filter(token => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token))
    const program = (tokens[0] ?? '').replace(/^.*[\\/]/, '')
    return program !== '' && !INSPECTING.has(program)
  })
}

/** Prose and media files: editing them leaves nothing for a test or build to check. */
const UNCHECKABLE = /(?:\.(?:md|mdx|txt|rst|adoc|csv|svg|png|jpe?g|gif|pdf)|(?:^|[\\/])(?:LICENSE|NOTICE|CHANGELOG|AUTHORS))$/i

/** Whether an edit to this path is something a check could verify. */
export function isCheckable(file) {
  return typeof file === 'string' && !UNCHECKABLE.test(file)
}

/**
 * Describes one tool call the same way for a stored event and a live call.
 * @param {string} tool
 * @param {object} args parsed arguments.
 */
export function describeCall(tool, args) {
  const command = typeof args?.command === 'string' ? args.command : undefined
  return {
    tool,
    args,
    argsKey: canonicalArgs(args),
    command,
    commandHead: command ? commandHead(command) : undefined,
    commandFamily: command ? commandFamily(command) : undefined,
    path: pathOf(args),
    mutating: MUTATING_TOOLS.has(tool),
    reading: READ_TOOLS.has(tool),
    verifying: isVerifying(command),
  }
}

/**
 * Describes one tool outcome. Shell tools report failure through an exit
 * marker in the text, not through `isError`.
 * @param {string} [command] the shell command line, when there is one.
 */
export function describeOutcome(tool, text, isError, errorCode, command) {
  const shell = tool === 'bash' || tool === 'pwsh'
  const exitCode = shell ? exitCodeOf(text) : undefined
  // `cmd; echo $?` or `cmd || true` ends with status 0, but a program the shell could not find still did not run.
  const absent = shell && (exitCode === undefined || exitCode === 0) && typeof command === 'string' ? missingProgram(text) : undefined
  const masked = absent !== undefined && runsProgram(command, absent)
  const backgrounded = /^\[still running after \d+ms; moved to background job/.test(text)
  const denied = /^(?:Error: )?(?:denied|not approved|approval (?:denied|rejected)|rejected|the user rejected)/i.test(text)
    || ['DENIED', 'APPROVAL_DENIED', 'APPROVAL_REJECTED', 'POLICY_DENIED', 'SANDBOX_DENIED'].includes(errorCode)
  return { ok: !(isError === true || (exitCode !== undefined && exitCode !== 0) || masked), isError: isError === true, exitCode, backgrounded, denied, masked }
}

/**
 * Creates a stateful normalizer for one session.
 * @param {{ sessionId: string, cwd?: string }} session
 */
export function createNormalizer(session) {
  const calls = new Map()
  let turn = 0
  let lastTurnEnd

  /** @returns {object[]} zero or more observations for this event. */
  function push(event) {
    const data = event.data ?? {}
    const base = { sessionId: session.sessionId, cwd: session.cwd, seq: event.seq, time: event.time }
    switch (event.type) {
      case 'turn/start':
        turn = data.turn ?? turn + 1
        return [{ ...base, kind: 'turn-start', turn }]
      case 'turn/end': {
        const reason = data.reason ?? {}
        lastTurnEnd = reason.kind
        return [{ ...base, kind: 'turn-end', turn: data.turn ?? turn, reason: reason.kind ?? 'unknown', cause: reason.cause?.kind ?? reason.code }]
      }
      case 'user/message': {
        const source = data.source?.kind ?? 'unknown'
        if (source !== 'user') return [{ ...base, kind: 'context', turn, source }]
        const text = blockText(data.content).slice(0, TEXT_CAP)
        const observation = { ...base, kind: 'user', turn, text, afterReason: lastTurnEnd }
        lastTurnEnd = undefined
        return [observation]
      }
      case 'tool/call': {
        const args = parseArguments(data.arguments)
        calls.set(data.callId, { tool: data.name, args, turn: data.turn ?? turn, step: data.step, time: event.time })
        return []
      }
      case 'tool/result': {
        const message = data.message ?? {}
        const call = calls.get(message.toolCallId) ?? { tool: 'unknown', args: {}, turn, step: data.step }
        calls.delete(message.toolCallId)
        const text = blockText(message.content)
        // A refusal or correction issued by an adaptation is the harness acting, not a new failure.
        if (isMarked(text)) {
          const described = describeCall(call.tool, call.args)
          return [{ ...base, kind: 'adapted', turn: data.turn ?? call.turn, step: data.step ?? call.step, tool: call.tool, subject: described.command ?? described.path, text: text.slice(0, 600) }]
        }
        const outcome = describeOutcome(call.tool, text, message.isError, data.error?.code, typeof call.args?.command === 'string' ? call.args.command : undefined)
        const failed = !outcome.ok
        const observation = {
          ...base,
          kind: 'tool',
          turn: data.turn ?? call.turn,
          step: data.step ?? call.step,
          callId: message.toolCallId,
          ...describeCall(call.tool, call.args),
          ...outcome,
          errorCode: data.error?.code,
          errorName: data.error?.name,
          text: text.slice(0, TEXT_CAP),
          bytes: text.length,
          durationMs: call.time !== undefined && event.time !== undefined ? event.time - call.time : undefined,
        }
        if (failed) observation.signature = signatureOf(observation)
        return [observation]
      }
      case 'assistant/message': {
        const finish = data.finish?.kind ?? data.message?.finish?.kind
        const text = blockText((data.message?.content ?? []).filter(block => block.type === 'text'))
        const out = [{ ...base, kind: 'assistant', turn: data.turn ?? turn, step: data.step, text: text.slice(0, TEXT_CAP), toolCalls: (data.message?.content ?? []).filter(block => block.type === 'tool-call').length }]
        if (finish === 'max-tokens') out.push({ ...base, kind: 'llm', turn: data.turn ?? turn, event: 'max-tokens' })
        return out
      }
      case 'assistant/attempt':
        return [{ ...base, kind: 'llm', turn: data.turn ?? turn, event: 'failed-attempt', code: data.failure?.code }]
      case 'llm/retry':
        return [{ ...base, kind: 'llm', turn: data.turn ?? turn, event: 'retry', code: data.failure?.code ?? data.code }]
      case 'compaction/summary':
      case 'compaction/end':
        return [{ ...base, kind: 'compaction', turn, event: event.type }]
      case 'feedback/message-put': {
        // A rating the user put on one assistant message, with an optional note.
        const item = data.item ?? {}
        return [{
          ...base, kind: 'feedback', turn, rating: item.rating === 'negative' ? 'dislike' : 'like',
          category: item.category, note: String(item.note ?? '').slice(0, 400),
        }]
      }
      case 'feedback/record':
        // A remark about the whole session; it carries no rating, so it is recorded but not judged.
        return [{ ...base, kind: 'feedback', turn, rating: 'remark', category: data.category, note: String(data.text ?? '').slice(0, 400) }]
      case 'approval/decided':
        return [{ ...base, kind: 'approval', turn, decision: data.outcome === 'allowed-once' ? 'allowed' : 'denied', requestId: data.id }]
      default:
        return []
    }
  }

  return { push }
}

/** Normalizes a complete stored log in one pass. */
export function normalizeLog(session, events) {
  const normalizer = createNormalizer(session)
  return events.flatMap(event => normalizer.push(event))
}
