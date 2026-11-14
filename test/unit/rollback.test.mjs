// Going back: what the user takes back, what the harness takes back by itself,
// and that either one reaches a session that is already running.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createEngine } from '../../packages/dsh-rsi/src/engine.js'
import { openLibrary } from '../../packages/dsh-rsi/src/library.js'
import { MARK, WITHDREW } from '../../packages/dsh-rsi/src/marks.js'
import { drive, fakeHost, missingCommandWorld, tempLibrary } from '../support/drive.mjs'

const A = '/work/alpha'
const bash = command => ({ description: 'run', command })
const fenced = source => `\`\`\`javascript\n${source}\n\`\`\``
const works = () => ({ text: 'ok' })

const ADVISE = `define({
  title: 'Mention that frobnicate is missing',
  description: 'frobnicate is not installed here; mention it.',
  capabilities: ['annotate'],
  setup(h) {
    h.onToolResult({ command: /frobnicate/ }, (call, result) => result.ok ? undefined : h.annotate('frobnicate is not installed on this machine.'))
  },
})`
const REFUSE = `define({
  title: 'Refuse frobnicate',
  description: 'frobnicate is not installed here; refuse it.',
  capabilities: ['deny'],
  setup(h) {
    h.beforeTool({ command: /frobnicate/ }, () => h.deny('frobnicate is not installed on this machine; use node --test.'))
  },
})`
const BROKEN = `define({
  title: 'Refuse frobnicate, badly',
  description: 'throws on every call',
  capabilities: ['deny'],
  setup(h) { h.beforeTool(call => call.missing.field) },
})`

function setup(options = {}, hostOverrides = {}) {
  const lib = tempLibrary()
  const host = fakeHost(hostOverrides)
  const engine = createEngine({ library: lib.library, options: { generator: 'synth', ...options }, host })
  return { ...lib, host, engine }
}

/** An adaptation as a session would have left it. `kind` decides whether its refusals rest on a checkable claim. */
function plant(library, source, fields = {}) {
  return library.create({
    title: fields.title ?? 'Planted', description: 'planted for a test', capabilities: fields.capabilities ?? ['deny'], tier: 'tighten',
    status: fields.status ?? 'active', scope: { kind: 'global' },
    friction: { signature: 'bash:command-not-found:frobnicate', kind: fields.kind ?? 'missing-command', summary: '`frobnicate` is not installed' },
    origin: { sessionId: 's0', generator: 'model' }, ...fields.extra,
  }, source)
}

const revised = (title, capabilities) => ({ title, description: title, capabilities, tier: 'tighten', status: 'candidate', revision: { generator: 'model' } })

test('what is switched off at a command line stops acting in a running session, and acts again when switched back on', async (t) => {
  const { library, home, engine, cleanup } = setup()
  t.after(cleanup)
  const record = plant(library, REFUSE, { kind: 'user-correction' })
  // The command line is another process with its own handle on the same library.
  const cli = openLibrary(home)
  const run = drive(engine, { sessionId: 's1', cwd: A }, works)
  run.user('go')
  await run.step()
  assert.equal((await run.call('bash', bash('frobnicate test'))).denied, true)

  cli.setStatus(record.id, 'disabled', 'switched off by the user', { by: 'user', change: 'disable' })
  const after = await run.call('bash', bash('frobnicate test'))
  assert.deepEqual([after.denied, after.ran, after.text], [false, true, 'ok'])
  assert.equal(run.session.mounted().length, 0)

  cli.setStatus(record.id, 'candidate', 'switched on by the user', { by: 'user', change: 'enable' })
  assert.equal((await run.call('bash', bash('frobnicate test'))).denied, true)
  assert.equal(run.session.mounted().length, 1)
})

test('undo takes a rewrite back mid-session: the version before it acts on the very next call', async (t) => {
  const { library, engine, cleanup } = setup()
  t.after(cleanup)
  const record = plant(library, ADVISE, { capabilities: ['annotate'], kind: 'user-correction' })
  library.revise(record.id, revised('Refuse frobnicate', ['deny']), REFUSE)
  const run = drive(engine, { sessionId: 's1', cwd: A }, missingCommandWorld())
  run.user('run the tests')
  await run.step()
  assert.equal((await run.call('bash', bash('frobnicate test'))).denied, true)

  const undone = engine.undo({ sessionId: 's1' })
  assert.deepEqual([undone.change, undone.record.version, undone.record.capabilities], ['revise', 1, ['annotate']])
  const next = await run.call('bash', bash('frobnicate test'))
  assert.deepEqual([next.denied, next.ran], [false, true])
  assert.match(next.notes[0], /frobnicate is not installed on this machine/)
  assert.equal(run.session.mounted()[0].version, 1)
  assert.deepEqual(library.auditTrail().at(-1), { ...library.auditTrail().at(-1), type: 'user', action: 'undo', adaptationId: record.id, sessionId: 's1' })

  // Undone once more, the adaptation itself is gone from the session; a third time there is nothing left to take back.
  assert.equal(engine.undo().change, 'create')
  assert.equal(run.session.mounted().length, 0)
  assert.equal(engine.undo(), undefined)
})

test('at stock nothing is mounted and nothing is written, in running sessions too; switched on, everything is back', async (t) => {
  const { library, engine, cleanup } = setup()
  t.after(cleanup)
  plant(library, REFUSE, { kind: 'user-correction' })
  const run = drive(engine, { sessionId: 's1', cwd: A }, missingCommandWorld('zork'))
  assert.equal(run.session.mounted().length, 1)

  assert.equal(engine.setStock(true, { reason: 'something is off' }), true)
  assert.equal(engine.stock(), true)
  assert.equal(run.session.mounted().length, 0)
  run.user('run the tests')
  await run.step()
  assert.deepEqual([(await run.call('bash', bash('frobnicate test'))).denied], [false])
  // Trouble is still seen and recorded, but the harness does not change itself.
  await run.call('bash', bash('zork test'))
  await run.step()
  await run.call('bash', bash('zork test'))
  assert.deepEqual(await run.step(), [])
  assert.equal(library.list().length, 1)
  assert.ok(library.ledger().some(entry => entry.type === 'friction' && entry.signature === 'bash:command-not-found:zork'))
  // A session that starts at stock starts bare.
  const second = drive(engine, { sessionId: 's2', cwd: A }, works)
  assert.equal(second.session.mounted().length, 0)

  assert.equal(engine.setStock(false), true)
  assert.deepEqual([run.session.mounted().length, second.session.mounted().length], [1, 1])
  assert.equal((await second.call('bash', bash('frobnicate test'))).denied, true)
  assert.deepEqual(library.timeline().slice(-2).map(entry => [entry.change, entry.by]), [['off', 'user'], ['on', 'user']])
})

test('a rewrite that keeps failing is taken back by the harness itself, and the version before it goes back to work', async (t) => {
  const { library, engine, cleanup } = setup()
  t.after(cleanup)
  const record = plant(library, ADVISE, { capabilities: ['annotate'] })
  library.revise(record.id, revised('Refuse frobnicate, badly', ['deny']), BROKEN)
  const run = drive(engine, { sessionId: 's1', cwd: A }, missingCommandWorld())
  run.user('go')
  await run.step()
  for (let index = 0; index < 3; index += 1) assert.equal((await run.call('bash', bash(`echo ${index}`))).text, 'ok')

  const now = library.get(record.id)
  assert.deepEqual([now.version, now.status, now.title, now.capabilities], [1, 'candidate', 'Planted', ['annotate']])
  assert.deepEqual(now.withdrawn.map(entry => [entry.version, entry.sessionId]), [[2, 's1']])
  assert.match(now.withdrawn[0].reason, /3 handler faults/)
  assert.equal(run.session.mounted()[0].version, 1)
  assert.match((await run.call('bash', bash('frobnicate test'))).notes[0], /not installed on this machine/)
  const last = library.timeline().at(-1)
  assert.deepEqual([last.change, last.by, last.before.version, last.after.version], ['auto-rollback', 'harness', 2, 1])
  assert.ok(library.auditTrail().some(entry => entry.type === 'auto-rollback' && entry.from === 2 && entry.to === 1))
  // The user's own "one version back" does not land on the version that did harm.
  library.revise(record.id, revised('Refuse frobnicate', ['deny']), REFUSE)
  assert.equal(library.rollback(record.id).version, 1)
})

test('with no earlier version to go back to, an adaptation that does harm goes out of use', async (t) => {
  const { library, engine, cleanup } = setup()
  t.after(cleanup)
  const record = plant(library, BROKEN)
  const run = drive(engine, { sessionId: 's1', cwd: A }, works)
  run.user('go')
  await run.step()
  for (let index = 0; index < 3; index += 1) await run.call('bash', bash(`echo ${index}`))
  assert.deepEqual([library.get(record.id).status, library.get(record.id).withdrawn.length, run.session.mounted().length], ['quarantined', 1, 0])
})

test('an adaptation that keeps refusing is checked against a real call; when the call works, it is taken back', async (t) => {
  const { library, engine, cleanup } = setup()
  t.after(cleanup)
  const record = plant(library, REFUSE)
  // frobnicate has been installed since the adaptation was learned.
  const run = drive(engine, { sessionId: 's1', cwd: A }, works)
  run.user('run the tests')
  await run.step()
  assert.equal((await run.call('bash', bash('frobnicate test'))).denied, true)
  assert.equal((await run.call('bash', bash('frobnicate --version'))).denied, true)

  const checked = await run.call('bash', bash('frobnicate test --all'))
  assert.deepEqual([checked.denied, checked.ran, checked.text], [false, true, 'ok'])
  assert.ok(checked.notes[0].startsWith(`${MARK}: Refuse frobnicate] ${WITHDREW}: it refused this call, and the call works.`))
  const now = library.get(record.id)
  assert.equal(now.status, 'quarantined')
  assert.match(now.statusReason, /refused a call that works: frobnicate test --all/)
  assert.deepEqual(now.withdrawn.map(entry => entry.version), [1])
  assert.equal(run.session.mounted().length, 0)
  assert.deepEqual((await run.call('bash', bash('frobnicate test'))).notes, [])
  assert.deepEqual(library.ledger().filter(entry => entry.type === 'probe').map(entry => entry.confirmed), [false])
  assert.ok(library.auditTrail().some(entry => entry.type === 'probe' && entry.refusals === 2))
})

test('when the call that was let through fails, the refusals were right: the adaptation stays and is not checked again', async (t) => {
  const { library, engine, cleanup } = setup()
  t.after(cleanup)
  const record = plant(library, REFUSE)
  const run = drive(engine, { sessionId: 's1', cwd: A }, missingCommandWorld())
  run.user('run the tests')
  await run.step()
  await run.call('bash', bash('frobnicate test'))
  await run.call('bash', bash('frobnicate test'))
  const checked = await run.call('bash', bash('frobnicate test'))
  assert.deepEqual([checked.denied, checked.ran], [false, true])
  assert.match(checked.text, /command not found/)
  assert.equal(library.get(record.id).status, 'active')
  assert.deepEqual(library.ledger().filter(entry => entry.type === 'probe').map(entry => entry.confirmed), [true])

  assert.equal((await run.call('bash', bash('frobnicate test'))).denied, true)
  run.end()
  run.user('once more')
  await run.step()
  for (let index = 0; index < 4; index += 1) assert.equal((await run.call('bash', bash('frobnicate test'))).denied, true)
})

test('a refusal that stands for what a person asked for, or that came in from outside, is never set aside to see what happens', async (t) => {
  for (const fields of [{ kind: 'user-correction' }, { kind: 'negative-feedback' }, { extra: { origin: { generator: 'unknown', imported: 'pack' } } }]) {
    const { library, engine, cleanup } = setup()
    t.after(cleanup)
    plant(library, REFUSE, fields)
    const run = drive(engine, { sessionId: 's1', cwd: A }, works)
    run.user('go')
    await run.step()
    for (let index = 0; index < 5; index += 1) assert.equal((await run.call('bash', bash('frobnicate test'))).denied, true)
    assert.deepEqual(library.ledger().filter(entry => entry.type === 'probe'), [])
  }
})

test('the next adaptation for a cause is written knowing why the last one was taken back', async (t) => {
  const requests = []
  const { library, engine, cleanup } = setup({ generator: 'model-then-synth' }, {
    complete: async (session, request) => { requests.push(request); return fenced(requests.length === 1 ? REFUSE : ADVISE) },
  })
  t.after(cleanup)
  const record = plant(library, REFUSE, { status: 'quarantined' })
  library.update(record.id, { withdrawn: [{ version: 1, reason: 'refused a call that works: frobnicate --version', at: 1 }] })
  const run = drive(engine, { sessionId: 's1', cwd: A }, missingCommandWorld())
  run.user('run the tests')
  await run.step()
  await run.call('bash', bash('frobnicate test'))
  await run.step()
  await run.call('bash', bash('frobnicate test'))
  await run.step()

  assert.match(requests[0].user, /was taken back because it did harm: refused a call that works: frobnicate --version\. Its source:/)
  assert.ok(requests[0].user.includes(REFUSE))
  // The model wrote the same script again; it is sent back, and what gets installed is something else.
  assert.match(requests[1].user, /this is the script that was taken back for doing harm; write a different one/)
  const written = library.list().find(entry => entry.id !== record.id)
  assert.deepEqual([written.status, written.capabilities, written.origin.generator], ['candidate', ['annotate'], 'model'])
})
