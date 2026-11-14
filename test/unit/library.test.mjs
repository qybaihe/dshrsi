import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { openLibrary, scopeCovers } from '../../packages/dsh-rsi/src/library.js'
import { judge, priorSessions, recurrence, summarize, workspacesHit } from '../../packages/dsh-rsi/src/metrics.js'
import { DEFAULT_POLICY, RECORD_ONLY, decide } from '../../packages/dsh-rsi/src/trigger.js'
import { tempLibrary } from '../support/drive.mjs'

const SOURCE_1 = "define({ title: 'One', description: 'first', capabilities: ['annotate'], setup(h) { h.onToolResult(() => undefined) } })\n"
const SOURCE_2 = "define({ title: 'Two', description: 'second', capabilities: ['deny'], setup(h) { h.beforeTool(() => undefined) } })\n"

function make(library, fields = {}) {
  return library.create({
    title: 'One', description: 'first', capabilities: ['annotate'], tier: 'tighten', status: fields.status ?? 'candidate',
    scope: fields.scope ?? { kind: 'workspace', cwd: '/work/alpha' },
    friction: { signature: fields.signature ?? 'bash:command-not-found:npm', kind: 'missing-command' },
    origin: { sessionId: fields.sessionId ?? 's1', cwd: '/work/alpha', generator: 'synth' },
  }, SOURCE_1)
}

test('library: create, list by status, scope and signature, and read the source back', (t) => {
  const { library, cleanup } = tempLibrary()
  t.after(cleanup)
  const a = make(library)
  const b = make(library, { status: 'proposed', signature: 'read:thrash:a.js', scope: { kind: 'global' } })
  assert.match(a.id, /^a-[0-9a-z]+-[0-9a-f]{6}$/)
  assert.equal(library.readSource(a.id), SOURCE_1)
  assert.deepEqual(library.list().map(record => record.id), [a.id, b.id])
  assert.deepEqual(library.list({ status: 'proposed' }).map(record => record.id), [b.id])
  assert.deepEqual(library.list({ signature: 'read:thrash:a.js' }).map(record => record.id), [b.id])
  assert.deepEqual(library.list({ cwd: '/work/beta' }).map(record => record.id), [b.id])
  // Only candidate and active adaptations mount; a nested directory is inside its workspace.
  assert.deepEqual(library.forSession('/work/alpha/packages/x').map(record => record.id), [a.id])
  assert.deepEqual(library.forSession('/work/alphabet').map(record => record.id), [])
})

test('library: revise keeps every earlier version, rollback restores the previous one', (t) => {
  const { library, home, cleanup } = tempLibrary()
  t.after(cleanup)
  const created = make(library)
  const revised = library.revise(created.id, {
    title: 'Two', description: 'second', capabilities: ['deny'], tier: 'tighten', status: 'candidate',
    revision: { sessionId: 's2', reason: 'recurred', generator: 'model' },
  }, SOURCE_2)
  assert.equal(revised.version, 2)
  assert.equal(revised.createdAt, created.createdAt)
  assert.ok(revised.installedAt > created.installedAt)
  assert.deepEqual(revised.origin.revisions, [{ version: 2, sessionId: 's2', reason: 'recurred', generator: 'model' }])
  assert.equal(library.readSource(created.id), SOURCE_2)
  assert.equal(fs.readFileSync(path.join(home, 'adaptations', created.id, 'versions', '1.js'), 'utf8'), SOURCE_1)

  const back = library.rollback(created.id)
  assert.equal(back.version, 1)
  assert.equal(back.rolledBackFrom, 2)
  assert.equal(library.readSource(created.id), SOURCE_1)
  assert.equal(fs.readFileSync(path.join(home, 'adaptations', created.id, 'versions', '2.js'), 'utf8'), SOURCE_2)
  assert.throws(() => library.rollback(created.id), /no earlier version/)
})

const revision = (title, capabilities) => ({ title, description: title, capabilities, tier: 'tighten', status: 'candidate', revision: { generator: 'model' } })

test('library: a version number means one source for good, and going back brings back what that version was accepted as', (t) => {
  const { library, home, cleanup } = tempLibrary()
  t.after(cleanup)
  const { id } = make(library)
  library.revise(id, revision('Two', ['deny']), SOURCE_2)
  const back = library.rollback(id)
  // Version 1 declared "annotate"; a record still saying "deny" would have its own source refused at mount.
  assert.deepEqual([back.version, back.title, back.capabilities], [1, 'One', ['annotate']])

  const SOURCE_3 = SOURCE_2.replace('Two', 'Three')
  const third = library.revise(id, revision('Three', ['deny']), SOURCE_3)
  assert.equal(third.version, 3)
  assert.equal(third.rolledBackFrom, undefined)
  assert.deepEqual(library.versions(id), [1, 2, 3])
  const version = number => fs.readFileSync(path.join(home, 'adaptations', id, 'versions', `${number}.js`), 'utf8')
  assert.deepEqual([version(1), version(2), version(3)], [SOURCE_1, SOURCE_2, SOURCE_3])

  // Any stored version can be pointed at, forwards as well as back.
  assert.deepEqual([library.rollback(id, 2).version, library.readSource(id)], [2, SOURCE_2])
  assert.deepEqual([library.rollback(id, 3).version, library.readSource(id)], [3, SOURCE_3])
  assert.throws(() => library.rollback(id, 3), /already at version 3/)
  assert.throws(() => library.rollback(id, 7), /has no version 7; it has 1, 2, 3/)
  // A version withdrawn for doing harm is not what "the previous one" means.
  library.update(id, { condemned: [2] })
  assert.equal(library.rollback(id).version, 1)
})

test('library: a library from before versions kept their own description gets it from the source', (t) => {
  const { home, cleanup } = tempLibrary()
  t.after(cleanup)
  const describe = source => ({ title: /title: '(\w+)'/.exec(source)[1], capabilities: [/capabilities: \['(\w+)'\]/.exec(source)[1]] })
  const library = openLibrary(home, { describe })
  const { id } = make(library)
  library.revise(id, revision('Two', ['deny']), SOURCE_2)
  fs.rmSync(path.join(home, 'adaptations', id, 'versions', '1.json'))
  const back = library.rollback(id)
  assert.deepEqual([back.title, back.capabilities], ['One', ['annotate']])
})

test('library: every change to what runs is a generation, and the harness can be put back to any of them', (t) => {
  const { library, cleanup } = tempLibrary()
  t.after(cleanup)
  const a = make(library)                                                             // 1
  library.setStatus(a.id, 'active', 'worked', { change: 'promote' })                   // 2
  const b = make(library, { signature: 'read:thrash:a.js' })                          // 3
  library.revise(a.id, revision('Two', ['deny']), SOURCE_2, { sessionId: 's2' })      // 4
  library.setScope(a.id, { kind: 'global' }, { change: 'generalize' })                // 5
  library.update(a.id, { project: { root: '/work/alpha' } })                          // bookkeeping: no generation

  const timeline = library.timeline()
  assert.deepEqual(timeline.map(entry => [entry.generation, entry.change]), [[1, 'create'], [2, 'promote'], [3, 'create'], [4, 'revise'], [5, 'generalize']])
  assert.deepEqual([timeline[3].before, timeline[3].after], [
    { version: 1, status: 'active', scope: { kind: 'workspace', cwd: '/work/alpha' } },
    { version: 2, status: 'candidate', scope: { kind: 'workspace', cwd: '/work/alpha' } },
  ])
  assert.equal(timeline[3].sessionId, 's2')
  assert.deepEqual(timeline[4].state, { [a.id]: [2, 'candidate', null], [b.id]: [1, 'candidate', '/work/alpha'] })

  const result = library.restore(2)
  assert.deepEqual([result.generation, result.to, result.changes.length], [6, 2, 2])
  const now = id => { const record = library.get(id); return [record.version, record.status, record.scope.kind, record.title] }
  assert.deepEqual(now(a.id), [1, 'active', 'workspace', 'One'])
  assert.equal(library.readSource(a.id), SOURCE_1)
  // What was learned later is switched off, not deleted.
  assert.deepEqual(now(b.id), [1, 'disabled', 'workspace', 'One'])
  assert.match(library.get(b.id).statusReason, /not yet learned at generation 2/)

  // Going back is a generation too, so it can be taken back: forward again to where things were.
  library.restore(5)
  assert.deepEqual([now(a.id), now(b.id)], [[2, 'candidate', 'global', 'Two'], [1, 'candidate', 'workspace', 'One']])
  assert.equal(library.readSource(a.id), SOURCE_2)
  // Generation 0 is the harness before it learned anything.
  assert.equal(library.restore(0).changes.length, 2)
  assert.deepEqual(library.forSession('/work/alpha'), [])
  assert.throws(() => library.restore(99), /no generation 99: the timeline runs from 0 \(nothing learned yet\) to 8/)
  assert.throws(() => library.restore(1.5), /no generation/)
})

test('library: undo takes back the last thing that was put to work, one step at a time', (t) => {
  const { library, cleanup } = tempLibrary()
  t.after(cleanup)
  assert.equal(library.undo(), undefined)
  const a = make(library)
  library.setStatus(a.id, 'active', 'worked', { change: 'promote' })
  library.revise(a.id, { ...revision('Two', ['deny']), status: 'candidate' }, SOURCE_2)
  library.setScope(a.id, { kind: 'global' }, { change: 'generalize' })
  const state = () => { const record = library.get(a.id); return [record.version, record.status, record.scope.kind] }

  // The widening goes first, then the revision, then the adaptation itself. A promotion changes nothing that runs.
  assert.deepEqual([library.undo().change, state()], ['generalize', [2, 'candidate', 'workspace']])
  assert.deepEqual([library.undo().change, state()], ['revise', [1, 'active', 'workspace']])
  assert.equal(library.readSource(a.id), SOURCE_1)
  assert.deepEqual([library.undo().change, state()], ['create', [1, 'disabled', 'workspace']])
  assert.equal(library.undo(), undefined)
  assert.deepEqual(library.timeline().slice(-3).map(entry => [entry.change, entry.by]), [['undo', 'user'], ['undo', 'user'], ['undo', 'user']])
})

test('library: undo leaves alone what has changed since, and takes back a restore only while it is the last thing done', (t) => {
  const { library, cleanup } = tempLibrary()
  t.after(cleanup)
  const a = make(library)
  const b = make(library, { signature: 'read:thrash:a.js' })
  // b was taken out of use by something else; undo does not bring it back, it goes on to a.
  library.setStatus(b.id, 'quarantined', '3 handler faults', { change: 'quarantine' })
  assert.equal(library.undo().record.id, a.id)
  assert.deepEqual([library.get(a.id).status, library.get(b.id).status], ['disabled', 'quarantined'])

  library.setStatus(a.id, 'candidate', 'switched on by the user', { by: 'user', change: 'enable' })
  library.restore(0)
  assert.equal(library.get(a.id).status, 'disabled')
  const undone = library.undo()
  assert.deepEqual([undone.change, undone.restored.to, library.get(a.id).status], ['restore', 5, 'candidate'])
  // That undo is not undone in turn; the next one goes further back.
  assert.equal(library.undo().change, 'enable')
})

test('library: the stock switch is a file other processes can see, and changes nothing else', (t) => {
  const { library, home, cleanup } = tempLibrary()
  t.after(cleanup)
  const a = make(library)
  const before = library.pulse()
  assert.equal(library.stock(), undefined)
  assert.equal(library.setStock(true, { reason: 'something is wrong' }), true)
  assert.equal(library.setStock(true), false)
  assert.deepEqual([library.stock().off, library.stock().reason], [true, 'something is wrong'])
  assert.equal(openLibrary(home).stock().off, true)
  assert.notEqual(library.pulse(), before)
  assert.equal(library.get(a.id).status, 'candidate')
  assert.equal(library.setStock(false), true)
  assert.equal(library.stock(), undefined)
  assert.deepEqual(library.timeline().slice(-2).map(entry => entry.change), ['off', 'on'])
})

test('library: a library that had no timeline starts one with what it holds; a record that cannot be read does not run', (t) => {
  const { library, home, cleanup } = tempLibrary()
  t.after(cleanup)
  const a = make(library)
  const b = make(library, { signature: 'read:thrash:a.js' })
  fs.rmSync(path.join(home, 'timeline.jsonl'))
  library.setStatus(a.id, 'disabled', 'switched off by the user', { by: 'user', change: 'disable' })
  assert.deepEqual(library.timeline().map(entry => entry.change), ['baseline', 'disable'])
  library.restore(1)
  assert.equal(library.get(a.id).status, 'candidate')

  fs.writeFileSync(path.join(home, 'adaptations', b.id, 'adaptation.json'), '{ "id": ')
  assert.equal(library.get(b.id), undefined)
  assert.deepEqual(library.list().map(record => record.id), [a.id])
})

test('library: status, scope and approval changes; unknown ids and states are refused', (t) => {
  const { library, cleanup } = tempLibrary()
  t.after(cleanup)
  const record = make(library, { status: 'proposed' })
  assert.throws(() => library.setStatus(record.id, 'sleeping'), /unknown status/)
  assert.throws(() => library.setStatus('a-missing', 'active'), /no adaptation/)
  const approved = library.approve(record.id)
  assert.equal(approved.status, 'candidate')
  assert.equal(approved.approval.by, 'user')
  assert.deepEqual(approved.approval.capabilities, ['annotate'])
  assert.throws(() => library.approve(record.id), /is candidate, not proposed/)
  assert.equal(library.setStatus(record.id, 'disabled', 'noisy').statusReason, 'noisy')
  assert.equal(library.get(record.id).approval.by, 'user')
  assert.deepEqual(library.setScope(record.id, { kind: 'global' }).scope, { kind: 'global' })
  assert.equal(library.get('a-missing'), undefined)
})

test('library: counters are folded from the ledger, and a torn last line is tolerated', (t) => {
  const { library, home, cleanup } = tempLibrary()
  t.after(cleanup)
  const record = make(library)
  library.record({ type: 'mount', adaptationId: record.id, version: 1, sessionId: 's1' })
  library.record({ type: 'mount', adaptationId: record.id, version: 1, sessionId: 's2' })
  library.record({ type: 'effect', adaptationId: record.id, version: 1, sessionId: 's2', effect: 'annotate' })
  library.record({ type: 'effect', adaptationId: record.id, version: 1, sessionId: 's2', effect: 'deny' })
  library.record({ type: 'fault', adaptationId: record.id, version: 1, sessionId: 's2' })
  library.record({ type: 'fault', adaptationId: record.id, version: 2, sessionId: 's3' })
  library.record({ type: 'effect', adaptationId: 'a-other', sessionId: 's2', effect: 'annotate' })
  fs.appendFileSync(path.join(home, 'ledger.jsonl'), '{"type":"effect","adaptationId":"' + record.id)

  const stats = library.statsOf(record.id)
  assert.deepEqual([stats.mounts, stats.sessions, stats.fires, stats.faults], [2, 2, 2, 2])
  assert.deepEqual(stats.effects, { annotate: 1, deny: 1 })
  // A revision starts with a clean fault count.
  assert.equal(library.statsOf(record.id, library.ledger(), 2).faults, 1)
  assert.equal(library.ledger().length, 7)
})

test('scopeCovers: global covers everything, a workspace covers itself and what is inside it', () => {
  assert.equal(scopeCovers({ kind: 'global' }, '/anywhere'), true)
  assert.equal(scopeCovers(undefined, '/anywhere'), true)
  assert.equal(scopeCovers({ kind: 'workspace', cwd: '/w/a' }, '/w/a'), true)
  assert.equal(scopeCovers({ kind: 'workspace', cwd: '/w/a' }, '/w/a/b/c'), true)
  assert.equal(scopeCovers({ kind: 'workspace', cwd: '/w/a' }, '/w'), false)
  assert.equal(scopeCovers({ kind: 'workspace', cwd: '/w/a' }, undefined), false)
})

const friction = (sessionId, signature, actionable, cwd = '/work/alpha', count = 1) => ({ type: 'friction', sessionId, cwd, signature, actionable, count, kind: 'missing-command' })

test('metrics: second-hit rate splits sessions around the installation, counting its own session as before', (t) => {
  const { library, cleanup, advance } = tempLibrary()
  t.after(cleanup)
  const signature = 'bash:command-not-found:npm'
  library.record({ type: 'session', sessionId: 's0', cwd: '/work/alpha' })
  library.record(friction('s0', signature, false))
  library.record(friction('s0', signature, true, '/work/alpha', 2))
  library.record({ type: 'session', sessionId: 's1', cwd: '/work/alpha' })
  library.record(friction('s1', signature, true, '/work/alpha', 3))
  const record = make(library, { sessionId: 's1', signature })
  advance(1000)
  for (const [sessionId, hit] of [['s2', false], ['s3', true], ['s4', false], ['s5', false]]) {
    library.record({ type: 'session', sessionId, cwd: '/work/alpha' })
    if (hit) library.record(friction(sessionId, signature, false))
  }
  library.record({ type: 'session', sessionId: 'elsewhere', cwd: '/work/beta' })
  library.record(friction('elsewhere', signature, true, '/work/beta'))

  assert.deepEqual(recurrence(library.ledger(), record), {
    before: { sessions: 2, hit: 2, rate: 1, occurrences: 5 },
    after: { sessions: 4, hit: 1, rate: 0.25, occurrences: 1 },
  })
  assert.equal(priorSessions(library.ledger(), signature, 's5'), 4)
  assert.deepEqual(workspacesHit(library.ledger(), signature).sort(), ['/work/alpha', '/work/beta'])
})

test('metrics: verdicts follow the ledger', (t) => {
  const { library, cleanup, advance } = tempLibrary()
  t.after(cleanup)
  const signature = 'bash:command-not-found:npm'
  const record = make(library, { signature })
  advance(1000)
  const stats = fires => ({ fires, faults: 0 })
  const verdict = (fires, faults = 0) => judge(library.ledger(), library.get(record.id), { fires, faults }, DEFAULT_POLICY).verdict

  assert.equal(verdict(0), 'unproven')
  assert.equal(verdict(5, 3), 'faulty')
  library.record({ type: 'session', sessionId: 't1', cwd: '/work/alpha' })
  library.record({ type: 'session', sessionId: 't2', cwd: '/work/alpha' })
  assert.equal(verdict(2), 'effective')
  assert.equal(verdict(0), 'unproven')
  library.record(friction('t1', signature, true))
  assert.equal(judge(library.ledger(), library.get(record.id), stats(2), DEFAULT_POLICY).verdict, 'ineffective')
  for (let index = 3; index <= 22; index += 1) library.record({ type: 'session', sessionId: `t${index}`, cwd: '/work/alpha' })
  assert.equal(verdict(0), 'stale')
  assert.equal(verdict(1), 'effective')
})

test('metrics: summary lists adaptations with their judgement and friction nobody answers yet', (t) => {
  const { library, cleanup } = tempLibrary()
  t.after(cleanup)
  library.record({ type: 'session', sessionId: 's1', cwd: '/work/alpha' })
  library.record(friction('s1', 'bash:command-not-found:npm', true))
  library.record(friction('s1', 'bash:network:ENOTFOUND', true))
  library.record(friction('s1', 'bash:network:ENOTFOUND', true))
  make(library, { status: 'active' })
  const summary = summarize(library, DEFAULT_POLICY)
  assert.equal(summary.sessions, 1)
  assert.equal(summary.adaptations[0].judgement.verdict, 'unproven')
  assert.deepEqual(summary.frictions.map(entry => [entry.signature, entry.actionable, entry.covered]), [
    ['bash:network:ENOTFOUND', 2, false],
    ['bash:command-not-found:npm', 1, true],
  ])
})

const finding = (fields = {}) => ({ kind: 'missing-command', signature: 'bash:command-not-found:npm', severity: 0.6, ...fields })

test('trigger: thresholds, priors, coverage, budgets and boundaries', () => {
  assert.deepEqual(decide(finding(), {}), { act: true, mode: 'create', when: 'step', severity: 0.6, reason: 'severity 0.6' })
  assert.equal(decide(finding({ severity: 0.3 }), {}).reason, 'below-threshold')
  // Two earlier sessions lift a first sighting over the threshold; the lift is capped.
  assert.equal(decide(finding({ severity: 0.3 }), { priorSessions: 1 }).act, false)
  assert.deepEqual(decide(finding({ severity: 0.3 }), { priorSessions: 2 }), { act: true, mode: 'create', when: 'step', severity: 0.6, reason: 'severity 0.3 raised by 2 earlier session(s)' })
  assert.equal(decide(finding({ severity: 0.1 }), { priorSessions: 50 }).severity, 0.5)

  for (const kind of RECORD_ONLY) assert.equal(decide(finding({ kind, severity: 1 }), {}).reason, 'record-only')
  assert.equal(decide(finding({ kind: 'premature-completion', severity: 0.65 }), {}).when, 'stop')

  assert.equal(decide(finding(), { covering: { id: 'a-1', sinceMount: 1 } }).reason, 'covered')
  assert.deepEqual(decide(finding(), { covering: { id: 'a-1', sinceMount: 2 } }),
    { act: true, mode: 'revise', when: 'step', severity: 0.6, reason: 'recurred 2 time(s) despite adaptation a-1' })
  assert.equal(decide(finding(), { covering: { id: 'a-1', sinceMount: 5 }, attempts: 2 }).reason, 'attempts-exhausted')

  assert.equal(decide(finding(), { attempts: 2 }).reason, 'attempts-exhausted')
  assert.equal(decide(finding(), { sessionAdaptations: 4 }).reason, 'session-budget')
  assert.equal(decide(finding(), { stepsSinceAdaptation: 0 }).reason, 'cooldown')
  assert.equal(decide(finding(), { stepsSinceAdaptation: 1 }).act, true)
  assert.equal(decide(finding(), { sessionAdaptations: 4 }, { maxPerSession: 9 }).act, true)
})
