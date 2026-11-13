// Friction detectors: the decision points that notice a run going badly.
//
// Each detector folds observations into its own state and reports a finding
// when its condition holds. A finding names a friction kind, a signature that
// identifies the cause across sessions, a severity in [0, 1], and the
// observations that justify it.

import { isCheckable } from './normalize.js'

export const DEFAULT_SIGNALS = Object.freeze({
  repeatFailure: 2,
  signatureRepeat: 2,
  readThrash: 4,
  errorWindow: 8,
  errorRate: 0.6,
  stallCalls: 5,
  timeoutRepeat: 2,
  floodBytes: 20000,
  floodRepeat: 2,
  denialRepeat: 2,
  editChurn: 5,
  flailVariants: 3,
  llmFaults: 3,
})

const CORRECTION = [
  /^\s*(?:no|nope|stop|wrong|don'?t|do not|never|not like that|that'?s not|why did you|i (?:said|told you)|again[,:]|wait)\b/i,
  /\b(?:instead of|rather than|should (?:have|be|use)|don'?t use|do not use|stop using|always use|never use|use \S+ not \S+)\b/i,
  /(?:不对|不是这样|别|不要|不用|错了|说过|停|为什么又|应该用|改用|换成|别再|不许|禁止|永远不要|总是用|一律)/,
]

const CATEGORY_KIND = {
  'command-not-found': 'missing-command',
  'module-not-found': 'missing-dependency',
  'invalid-arguments': 'invalid-arguments',
  'edit-mismatch': 'edit-mismatch',
  timeout: 'timeout',
  network: 'network-failure',
  'permission-denied': 'permission-failure',
  'port-in-use': 'port-conflict',
  'no-such-file': 'missing-path',
  'out-of-memory': 'resource-exhaustion',
}

function trimArgs(args) {
  if (args === undefined || args === null || typeof args !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(args).slice(0, 12)) {
    out[key] = typeof value === 'string' ? value.slice(0, 300) : (typeof value === 'number' || typeof value === 'boolean' ? value : undefined)
  }
  return out
}

/** Evidence entry: enough of an observation to show a model and to replay through an adaptation. */
function trim(observation) {
  return {
    seq: observation.seq, turn: observation.turn, step: observation.step, kind: observation.kind,
    tool: observation.tool, args: observation.kind === 'tool' ? trimArgs(observation.args) : undefined,
    command: observation.command, commandHead: observation.commandHead, commandFamily: observation.commandFamily,
    path: observation.path, argsKey: observation.argsKey,
    ok: observation.ok, isError: observation.isError, exitCode: observation.exitCode, errorCode: observation.errorCode,
    mutating: observation.mutating, verifying: observation.verifying, signature: observation.signature, bytes: observation.bytes,
    text: typeof observation.text === 'string' ? observation.text.slice(0, 600) : undefined,
  }
}

function scale(count, threshold) {
  // Below threshold a finding is a weak prior; at threshold it is actionable.
  if (count < threshold) return Math.min(0.45, 0.3 * (count / Math.max(1, threshold - 1 || 1)))
  return Math.min(1, 0.6 + 0.2 * (count - threshold))
}

function subjectOf(observation) {
  const category = observation.signature?.split(':')[1]
  const key = observation.signature?.split(':').slice(2).join(':')
  return {
    tool: observation.tool, command: observation.command, commandHead: observation.commandHead,
    commandFamily: observation.commandFamily, path: observation.path, category, key,
  }
}

function finding(detector, kind, signature, severity, count, observation, summary, evidence) {
  return {
    detector, kind, signature, severity: Number(severity.toFixed(2)), count,
    sessionId: observation.sessionId, cwd: observation.cwd, turn: observation.turn, step: observation.step, seq: observation.seq,
    summary, subject: subjectOf(observation), evidence: evidence.slice(-6).map(trim),
  }
}

/** One entry per decision point. `detect` returns a finding or undefined. */
export const DETECTORS = [
  {
    id: 'repeat-failing-call',
    title: 'The same call fails again with identical arguments',
    init: () => ({ runs: new Map() }),
    detect(state, observation, config) {
      if (observation.kind !== 'tool') return undefined
      const key = `${observation.tool}\u0000${observation.argsKey}`
      if (observation.ok) { state.runs.delete(key); return undefined }
      const run = state.runs.get(key) ?? { count: 0, evidence: [] }
      run.count += 1
      run.evidence.push(observation)
      state.runs.set(key, run)
      if (run.count < config.repeatFailure) return undefined
      const kind = CATEGORY_KIND[observation.signature?.split(':')[1]] ?? 'repeated-failure'
      return finding(this.id, kind, observation.signature, scale(run.count, config.repeatFailure), run.count, observation,
        `${observation.tool} failed ${run.count} times with identical arguments`, run.evidence)
    },
  },
  {
    id: 'failure-signature',
    title: 'The same cause of failure shows up across calls',
    init: () => ({ seen: new Map() }),
    detect(state, observation, config) {
      if (observation.kind !== 'tool' || observation.ok || !observation.signature) return undefined
      const entry = state.seen.get(observation.signature) ?? { count: 0, evidence: [] }
      entry.count += 1
      entry.evidence.push(observation)
      state.seen.set(observation.signature, entry)
      const category = observation.signature.split(':')[1]
      const kind = CATEGORY_KIND[category] ?? 'repeated-failure'
      return finding(this.id, kind, observation.signature, scale(entry.count, config.signatureRepeat), entry.count, observation,
        `${observation.tool} hit the same failure ${entry.count} time(s): ${category.replaceAll('-', ' ')} (${observation.signature.split(':').slice(2).join(':')})`, entry.evidence)
    },
  },
  {
    id: 'command-flailing',
    title: 'One command family keeps failing under different arguments',
    init: () => ({ families: new Map() }),
    detect(state, observation, config) {
      if (observation.kind !== 'tool' || !observation.commandFamily) return undefined
      const entry = state.families.get(observation.commandFamily) ?? { variants: new Set(), evidence: [] }
      if (observation.ok) { state.families.delete(observation.commandFamily); return undefined }
      entry.variants.add(observation.argsKey)
      entry.evidence.push(observation)
      state.families.set(observation.commandFamily, entry)
      if (entry.variants.size < config.flailVariants) return undefined
      return finding(this.id, 'flailing', `bash:flailing:${observation.commandFamily}`, scale(entry.variants.size, config.flailVariants), entry.variants.size, observation,
        `${entry.variants.size} different attempts at \`${observation.commandFamily}\` all failed`, entry.evidence)
    },
  },
  {
    id: 'read-thrash',
    title: 'The same file is read again and again without changing',
    init: () => ({ reads: new Map() }),
    detect(state, observation, config) {
      if (observation.kind !== 'tool' || !observation.path) return undefined
      if (observation.mutating && observation.ok) { state.reads.delete(observation.path); return undefined }
      if (observation.tool !== 'read' || !observation.ok) return undefined
      const entry = state.reads.get(observation.path) ?? { count: 0, evidence: [] }
      entry.count += 1
      entry.evidence.push(observation)
      state.reads.set(observation.path, entry)
      if (entry.count < config.readThrash) return undefined
      return finding(this.id, 'read-thrash', `read:thrash:${observation.path.split(/[\\/]/).at(-1)}`, scale(entry.count, config.readThrash), entry.count, observation,
        `${observation.path} read ${entry.count} times with no edit in between`, entry.evidence)
    },
  },
  {
    id: 'edit-churn',
    title: 'One file is edited many times within a turn',
    init: () => ({ turn: undefined, edits: new Map() }),
    detect(state, observation, config) {
      if (observation.kind === 'turn-start') { state.turn = observation.turn; state.edits.clear(); return undefined }
      if (observation.kind !== 'tool' || !observation.mutating || !observation.path) return undefined
      const entry = state.edits.get(observation.path) ?? { count: 0, evidence: [] }
      entry.count += 1
      entry.evidence.push(observation)
      state.edits.set(observation.path, entry)
      if (entry.count < config.editChurn) return undefined
      return finding(this.id, 'edit-churn', `edit:churn:${observation.path.split(/[\\/]/).at(-1)}`, scale(entry.count, config.editChurn), entry.count, observation,
        `${observation.path} edited ${entry.count} times in one turn`, entry.evidence)
    },
  },
  {
    id: 'error-storm',
    title: 'Most recent tool calls are failing',
    init: () => ({ window: [], reported: 0 }),
    detect(state, observation, config) {
      if (observation.kind !== 'tool') return undefined
      state.window.push(observation)
      if (state.window.length > config.errorWindow) state.window.shift()
      if (state.window.length < config.errorWindow) return undefined
      const failures = state.window.filter(entry => !entry.ok)
      const rate = failures.length / state.window.length
      if (rate < config.errorRate) return undefined
      state.reported += 1
      return finding(this.id, 'error-storm', 'session:error-storm', Math.min(1, 0.5 + rate / 2), failures.length, observation,
        `${failures.length} of the last ${state.window.length} tool calls failed`, failures)
    },
  },
  {
    id: 'stall',
    title: 'A run of failures with no success in between',
    init: () => ({ streak: [] }),
    detect(state, observation, config) {
      if (observation.kind !== 'tool') return undefined
      if (observation.ok) { state.streak = []; return undefined }
      state.streak.push(observation)
      if (state.streak.length < config.stallCalls) return undefined
      return finding(this.id, 'stall', 'session:stall', scale(state.streak.length, config.stallCalls), state.streak.length, observation,
        `${state.streak.length} consecutive tool calls failed`, state.streak)
    },
  },
  {
    id: 'timeout-recurrence',
    title: 'A command family keeps running past its deadline',
    init: () => ({ families: new Map() }),
    detect(state, observation, config) {
      if (observation.kind !== 'tool' || !observation.backgrounded) return undefined
      const family = observation.commandFamily ?? observation.tool
      const entry = state.families.get(family) ?? { count: 0, evidence: [] }
      entry.count += 1
      entry.evidence.push(observation)
      state.families.set(family, entry)
      if (entry.count < config.timeoutRepeat) return undefined
      return finding(this.id, 'timeout', `bash:slow:${family}`, scale(entry.count, config.timeoutRepeat), entry.count, observation,
        `\`${family}\` outlived its deadline ${entry.count} times`, entry.evidence)
    },
  },
  {
    id: 'output-flood',
    title: 'A command family keeps producing oversized output',
    init: () => ({ families: new Map() }),
    detect(state, observation, config) {
      if (observation.kind !== 'tool' || (observation.bytes ?? 0) < config.floodBytes) return undefined
      const family = observation.commandFamily ?? observation.tool
      const entry = state.families.get(family) ?? { count: 0, evidence: [] }
      entry.count += 1
      entry.evidence.push(observation)
      state.families.set(family, entry)
      if (entry.count < config.floodRepeat) return undefined
      return finding(this.id, 'output-flood', `${observation.tool}:flood:${family}`, scale(entry.count, config.floodRepeat), entry.count, observation,
        `\`${family}\` returned more than ${config.floodBytes} characters ${entry.count} times`, entry.evidence)
    },
  },
  {
    id: 'approval-denied',
    title: 'The same kind of action keeps being refused',
    init: () => ({ families: new Map() }),
    detect(state, observation, config) {
      if (observation.kind !== 'tool' || !observation.denied) return undefined
      const family = observation.commandFamily ?? observation.tool
      const entry = state.families.get(family) ?? { count: 0, evidence: [], keys: new Map() }
      entry.count += 1
      entry.evidence.push(observation)
      entry.keys.set(observation.argsKey, (entry.keys.get(observation.argsKey) ?? 0) + 1)
      state.families.set(family, entry)
      if (entry.keys.get(observation.argsKey) >= 2) {
        return finding('denied-repeat', 'denied-repeat', `${observation.tool}:denied-repeat:${family}`, scale(entry.count, config.denialRepeat), entry.count, observation,
          `the model retried a refused \`${family}\` call unchanged`, entry.evidence)
      }
      if (entry.count < config.denialRepeat) return undefined
      return finding(this.id, 'approval-denied', `${observation.tool}:denied:${family}`, scale(entry.count, config.denialRepeat), entry.count, observation,
        `\`${family}\` was refused ${entry.count} times`, entry.evidence)
    },
  },
  {
    id: 'user-correction',
    title: 'The user corrects the agent or redirects it after interrupting',
    init: () => ({ recent: [] }),
    detect(state, observation) {
      if (observation.kind === 'tool' || observation.kind === 'assistant') {
        state.recent.push(observation)
        if (state.recent.length > 6) state.recent.shift()
        return undefined
      }
      if (observation.kind !== 'user') return undefined
      const afterInterrupt = observation.afterReason !== undefined && observation.afterReason !== 'completed'
      const strong = CORRECTION[0].test(observation.text) || CORRECTION[2].test(observation.text)
      const phrased = strong || CORRECTION[1].test(observation.text)
      const context = state.recent
      state.recent = []
      if (context.length === 0) return undefined
      if (!phrased && !afterInterrupt) return undefined
      const result = finding(this.id, 'user-correction', `user:correction:${hashText(observation.text)}`, strong ? 0.75 : phrased ? 0.6 : 0.5, 1, observation,
        afterInterrupt ? 'the user interrupted and redirected the agent' : 'the user corrected the agent', [...context, observation])
      result.subject = { ...result.subject, instruction: observation.text.slice(0, 600), afterInterrupt }
      return result
    },
  },
  {
    id: 'user-interrupt',
    title: 'The user stops a turn before it finishes',
    init: () => ({ recent: [] }),
    detect(state, observation) {
      if (observation.kind === 'tool') {
        state.recent.push(observation)
        if (state.recent.length > 4) state.recent.shift()
        return undefined
      }
      if (observation.kind !== 'turn-end') return undefined
      const context = state.recent
      state.recent = []
      if (!['aborted', 'cancelled', 'canceled', 'interrupted'].includes(observation.reason)) return undefined
      const last = context.at(-1)
      return finding(this.id, 'user-interrupt', `user:interrupt:${last?.commandFamily ?? last?.tool ?? 'idle'}`, 0.35, 1, observation,
        'the user stopped the turn', [...context, observation])
    },
  },
  {
    id: 'premature-completion',
    title: 'The turn ends after edits that nothing verified',
    init: () => ({ mutations: [], verifiedAfter: true }),
    detect(state, observation) {
      if (observation.kind === 'turn-start') { state.mutations = []; state.verifiedAfter = true; return undefined }
      if (observation.kind === 'tool') {
        if (observation.mutating && observation.ok && isCheckable(observation.path)) { state.mutations.push(observation); state.verifiedAfter = false }
        else if (observation.verifying) state.verifiedAfter = true
        return undefined
      }
      if (observation.kind !== 'turn-end' || observation.reason !== 'completed') return undefined
      return this.probe(state, observation)
    },
    /** Same condition, callable at the stop boundary before `turn/end` exists. */
    probe(state, at) {
      if (state.mutations.length === 0 || state.verifiedAfter) return undefined
      const paths = [...new Set(state.mutations.map(entry => entry.path).filter(Boolean))]
      const result = finding(this.id, 'premature-completion', 'turn:unverified-edits', 0.65, state.mutations.length, { ...state.mutations.at(-1), ...at },
        `the turn is ending after ${state.mutations.length} edit(s) with no check run afterwards`, state.mutations)
      result.subject = { ...result.subject, paths }
      return result
    },
  },
  {
    id: 'model-instability',
    title: 'Model requests keep failing, retrying, or hitting the output cap',
    init: () => ({ faults: [] }),
    detect(state, observation, config) {
      if (observation.kind !== 'llm') return undefined
      state.faults.push(observation)
      if (state.faults.length < config.llmFaults) return undefined
      return finding(this.id, 'model-instability', `llm:${observation.event}:${observation.code ?? 'unknown'}`, scale(state.faults.length, config.llmFaults), state.faults.length, observation,
        `${state.faults.length} model request faults in this session`, state.faults)
    },
  },
  {
    id: 'context-pressure',
    title: 'The conversation was compacted mid-task',
    init: () => ({ count: 0 }),
    detect(state, observation) {
      if (observation.kind !== 'compaction') return undefined
      state.count += 1
      return finding(this.id, 'context-pressure', 'session:compaction', Math.min(0.6, 0.25 + 0.15 * state.count), state.count, observation,
        `context compacted ${state.count} time(s)`, [observation])
    },
  },
  {
    id: 'negative-feedback',
    title: 'The user marks a reply as bad',
    init: () => ({ recent: [] }),
    detect(state, observation) {
      if (observation.kind === 'tool' || observation.kind === 'assistant') {
        state.recent.push(observation)
        if (state.recent.length > 6) state.recent.shift()
        return undefined
      }
      if (observation.kind !== 'feedback' || observation.rating !== 'dislike') return undefined
      const result = finding(this.id, 'negative-feedback', `user:dislike:${observation.category ?? 'uncategorized'}`, 0.7, 1, observation,
        'the user disliked a reply', [...state.recent, observation])
      result.subject = { ...result.subject, instruction: observation.note, category: observation.category }
      return result
    },
  },
]

function hashText(text) {
  let hash = 0
  for (const char of String(text).toLowerCase().replace(/\s+/g, ' ').trim()) hash = (hash * 31 + char.codePointAt(0)) | 0
  return (hash >>> 0).toString(36)
}

/**
 * Creates the per-session detector set.
 * @param {Partial<typeof DEFAULT_SIGNALS>} [overrides]
 * @param {string[]} [disabled] detector ids to skip.
 */
export function createObserver(overrides = {}, disabled = []) {
  const config = { ...DEFAULT_SIGNALS, ...overrides }
  const active = DETECTORS.filter(detector => !disabled.includes(detector.id))
  const states = new Map(active.map(detector => [detector.id, detector.init()]))
  let last

  return {
    config,
    /** Feeds one observation through every detector. */
    observe(observation) {
      last = observation
      const found = []
      for (const detector of active) {
        const result = detector.detect(states.get(detector.id), observation, config)
        if (result) found.push(result)
      }
      return found
    },
    /** Findings that only make sense at the stop boundary of the open turn. */
    probeStop(at) {
      const found = []
      for (const detector of active) {
        if (typeof detector.probe !== 'function') continue
        const result = detector.probe(states.get(detector.id), { ...at, sessionId: last?.sessionId, cwd: last?.cwd })
        if (result) found.push(result)
      }
      return found
    },
  }
}
