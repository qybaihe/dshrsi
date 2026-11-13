// Decides whether a finding is worth changing the harness for, and when.
//
// A finding alone is not a decision. The trigger weighs it against what the
// library already knows (has this cause been met in earlier sessions? is an
// adaptation already covering it?) and against per-session budgets, so a
// noisy session cannot turn into a stream of half-justified harness changes.

export const DEFAULT_POLICY = Object.freeze({
  threshold: 0.6,
  priorBoost: 0.15,
  maxPriorBoost: 0.4,
  maxPerSession: 4,
  maxAttemptsPerSignature: 2,
  cooldownSteps: 1,
  reviseAfter: 2,
  maxContinuations: 2,
  maxFaults: 3,
  minSessions: 2,
  ineffectiveRate: 0.5,
  staleSessions: 20,
  generalizeAfter: 2,
})

/** Friction kinds that are recorded for the ledger but never answered with an adaptation. */
export const RECORD_ONLY = Object.freeze(['model-instability', 'context-pressure', 'user-interrupt'])

/** Friction kinds answered at the stop boundary instead of the next step. */
const AT_STOP = new Set(['premature-completion'])

/**
 * @param {object} finding
 * @param {object} context
 * @param {number} context.priorSessions earlier sessions in which this signature was seen.
 * @param {object} [context.covering] mounted adaptation for this signature: `{ id, sinceMount }`.
 * @param {number} context.sessionAdaptations adaptations created in this session so far.
 * @param {number} context.attempts generation attempts for this signature in this session.
 * @param {number} [context.stepsSinceAdaptation]
 * @param {Partial<typeof DEFAULT_POLICY>} [overrides]
 * @returns {{ act: boolean, mode?: 'create' | 'revise', when?: 'step' | 'stop', severity: number, reason: string }}
 */
export function decide(finding, context, overrides = {}) {
  const policy = { ...DEFAULT_POLICY, ...overrides }
  const boost = Math.min(policy.maxPriorBoost, policy.priorBoost * (context.priorSessions ?? 0))
  const severity = Number(Math.min(1, finding.severity + boost).toFixed(2))
  const when = AT_STOP.has(finding.kind) ? 'stop' : 'step'
  const no = reason => ({ act: false, severity, when, reason })

  if (RECORD_ONLY.includes(finding.kind)) return no('record-only')
  if (severity < policy.threshold) return no('below-threshold')
  if (context.covering) {
    if ((context.covering.sinceMount ?? 0) < policy.reviseAfter) return no('covered')
    if ((context.attempts ?? 0) >= policy.maxAttemptsPerSignature) return no('attempts-exhausted')
    return { act: true, mode: 'revise', when, severity, reason: `recurred ${context.covering.sinceMount} time(s) despite adaptation ${context.covering.id}` }
  }
  if ((context.attempts ?? 0) >= policy.maxAttemptsPerSignature) return no('attempts-exhausted')
  if ((context.sessionAdaptations ?? 0) >= policy.maxPerSession) return no('session-budget')
  if (context.stepsSinceAdaptation !== undefined && context.stepsSinceAdaptation < policy.cooldownSteps) return no('cooldown')
  return { act: true, mode: 'create', when, severity, reason: boost > 0 ? `severity ${finding.severity} raised by ${context.priorSessions} earlier session(s)` : `severity ${severity}` }
}
