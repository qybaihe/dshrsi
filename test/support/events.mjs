// Builds session event logs for tests, in the format the harness writes.
import { normalizeLog } from '../../packages/dsh-rsi/src/normalize.js'
import { createObserver } from '../../packages/dsh-rsi/src/signals.js'

export const SESSION = { sessionId: 's-test', cwd: '/work/alpha' }

/** Fluent builder for one session's events. */
export function log() {
  const events = []
  let seq = 0
  let turn = 0
  let calls = 0
  const push = (type, data) => { events.push({ type, seq: ++seq, time: 1_700_000_000_000 + seq * 1000, data }); return api }
  const api = {
    events,
    user(text) {
      turn += 1
      push('turn/start', { turn })
      return push('user/message', { content: [{ type: 'text', text }], source: { kind: 'user' }, role: 'user', id: `u${seq}` })
    },
    /** A tool call and its result. `outcome` is the result text, or `{ text, isError, code }`. */
    tool(name, args, outcome = 'ok') {
      const result = typeof outcome === 'string' ? { text: outcome } : outcome
      const callId = `c${++calls}`
      push('tool/call', { turn, step: calls, callId, name, arguments: JSON.stringify(args) })
      return push('tool/result', {
        turn, step: calls,
        message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: result.text }], isError: result.isError === true },
        ...(result.code ? { error: { name: 'ToolError', code: result.code } } : {}),
      })
    },
    bash(command, outcome) {
      return api.tool('bash', { description: 'run', command }, outcome)
    },
    assistant(text) {
      return push('assistant/message', { turn, message: { role: 'assistant', content: [{ type: 'text', text }] } })
    },
    end(reason = 'completed') {
      return push('turn/end', { turn, reason: { kind: reason } })
    },
    raw: (type, data) => push(type, data),
  }
  return api
}

/** Shell failure text as the harness renders it. */
export const fails = (stderr, code = 1) => `[stderr]\n${stderr}\n[exit code: ${code}]`

/**
 * Runs the detectors over a log.
 * @returns {{ observations: object[], findings: object[], best: (kind: string) => object | undefined }}
 */
export function detect(events, session = SESSION) {
  const observations = normalizeLog(session, events)
  const observer = createObserver()
  const findings = observations.flatMap(observation => observer.observe(observation))
  return {
    observations,
    findings,
    /** The strongest finding of a kind. */
    best: kind => findings.filter(finding => finding.kind === kind).sort((a, b) => b.severity - a.severity || b.count - a.count)[0],
  }
}
