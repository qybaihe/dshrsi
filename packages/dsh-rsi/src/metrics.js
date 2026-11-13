// What the ledger says about whether adapting worked.
//
// The headline number is the second-hit rate: of the sessions that could have
// run into a known friction, how many did. An adaptation earns its place by
// driving that number down after it was installed.
import { scopeCovers } from './library.js'

/** Sessions in which a friction signature was seen at all, oldest first. */
function hitsBySession(ledger, signature) {
  const sessions = new Map()
  for (const entry of ledger) {
    if (entry.type !== 'friction' || entry.signature !== signature) continue
    if (!sessions.has(entry.sessionId)) sessions.set(entry.sessionId, { sessionId: entry.sessionId, cwd: entry.cwd, time: entry.time, occurrences: 0 })
    // A finding's count is how often the friction had occurred in that session when it was reported.
    const held = sessions.get(entry.sessionId)
    held.occurrences = Math.max(held.occurrences, entry.count ?? 1)
  }
  return [...sessions.values()].sort((a, b) => a.time - b.time)
}

/** Sessions the library saw, oldest first, from `session` ledger entries. */
function sessionsSeen(ledger) {
  const sessions = new Map()
  for (const entry of ledger) {
    if (entry.type !== 'session' || sessions.has(entry.sessionId)) continue
    sessions.set(entry.sessionId, { sessionId: entry.sessionId, cwd: entry.cwd, time: entry.time })
  }
  return [...sessions.values()].sort((a, b) => a.time - b.time)
}

/**
 * How often a signature bit before and after an adaptation was installed.
 * `hit` counts sessions in which it occurred at all; `occurrences` adds up how often it occurred in them, so an
 * adaptation that cuts a run of failures down to one shows up even though the session still counts as hit.
 * @returns {{ before: { sessions: number, hit: number, rate: number, occurrences: number }, after: { sessions: number, hit: number, rate: number, occurrences: number } }}
 */
export function recurrence(ledger, adaptation) {
  const signature = adaptation.friction?.signature
  const inScope = sessionsSeen(ledger).filter(session => scopeCovers(adaptation.scope, session.cwd))
  const hits = new Map(hitsBySession(ledger, signature).map(hit => [hit.sessionId, hit.occurrences]))
  // The sessions that produced or revised the adaptation count as "before": the friction bit there.
  const makers = new Set([adaptation.origin?.sessionId, ...(adaptation.origin?.revisions ?? []).map(revision => revision.sessionId)])
  const installedAt = adaptation.installedAt ?? adaptation.createdAt
  const split = { before: { sessions: 0, hit: 0, occurrences: 0 }, after: { sessions: 0, hit: 0, occurrences: 0 } }
  for (const session of inScope) {
    const side = session.time < installedAt || makers.has(session.sessionId) ? split.before : split.after
    side.sessions += 1
    if (hits.has(session.sessionId)) { side.hit += 1; side.occurrences += hits.get(session.sessionId) }
  }
  const rate = side => (side.sessions === 0 ? 0 : Number((side.hit / side.sessions).toFixed(3)))
  const shape = side => ({ sessions: side.sessions, hit: side.hit, rate: rate(side), occurrences: side.occurrences })
  return { before: shape(split.before), after: shape(split.after) }
}

/**
 * Distinct earlier sessions in which a signature was seen at all.
 * Used as a prior: a cause met before needs less evidence to act on again.
 */
export function priorSessions(ledger, signature, currentSessionId) {
  const sessions = new Set()
  for (const entry of ledger) {
    if (entry.type === 'friction' && entry.signature === signature && entry.sessionId !== currentSessionId) sessions.add(entry.sessionId)
  }
  return sessions.size
}

/** Distinct working directories in which a signature was seen. */
export function workspacesHit(ledger, signature) {
  const cwds = new Set()
  for (const entry of ledger) if (entry.type === 'friction' && entry.signature === signature && entry.cwd) cwds.add(entry.cwd)
  return [...cwds]
}

/**
 * Judges an installed adaptation from the ledger.
 * @returns {{ verdict: 'effective' | 'ineffective' | 'stale' | 'faulty' | 'unproven', reason: string, recurrence: object }}
 */
export function judge(ledger, adaptation, stats, policy) {
  const result = recurrence(ledger, adaptation)
  // A prompt section or a tool works by being present; it has no handler whose calls could be counted.
  const standing = (adaptation.capabilities ?? []).some(name => name === 'prompt' || name === 'tool')
  if (stats.faults >= policy.maxFaults) return { verdict: 'faulty', reason: `${stats.faults} handler faults`, recurrence: result }
  if (result.after.sessions >= policy.minSessions && result.after.rate >= policy.ineffectiveRate) {
    return { verdict: 'ineffective', reason: `the friction still bit in ${result.after.hit} of ${result.after.sessions} later sessions`, recurrence: result }
  }
  if (result.after.sessions >= policy.staleSessions && stats.fires === 0 && !standing) {
    return { verdict: 'stale', reason: `never fired in ${result.after.sessions} sessions`, recurrence: result }
  }
  if (result.after.sessions >= policy.minSessions && (stats.fires > 0 || standing)) {
    return { verdict: 'effective', reason: `acted ${stats.fires} times; second-hit rate ${result.before.rate} -> ${result.after.rate}`, recurrence: result }
  }
  return { verdict: 'unproven', reason: `only ${result.after.sessions} later session(s) so far`, recurrence: result }
}

/** Library-wide summary for status output. */
export function summarize(library, policy) {
  const ledger = library.ledger()
  const adaptations = library.list().map(adaptation => {
    const stats = library.statsOf(adaptation.id, ledger)
    return { ...adaptation, stats, judgement: judge(ledger, adaptation, stats, policy) }
  })
  const frictions = new Map()
  for (const entry of ledger) {
    if (entry.type !== 'friction') continue
    const item = frictions.get(entry.signature) ?? { signature: entry.signature, kind: entry.kind, sightings: 0, actionable: 0, sessions: new Set() }
    item.sightings += 1
    if (entry.actionable) item.actionable += 1
    item.sessions.add(entry.sessionId)
    frictions.set(entry.signature, item)
  }
  const covered = new Set(adaptations.filter(adaptation => ['candidate', 'active'].includes(adaptation.status)).map(adaptation => adaptation.friction?.signature))
  return {
    sessions: sessionsSeen(ledger).length,
    adaptations,
    frictions: [...frictions.values()].map(item => ({ ...item, sessions: item.sessions.size, covered: covered.has(item.signature) }))
      .sort((a, b) => b.actionable - a.actionable || b.sightings - a.sightings),
  }
}
