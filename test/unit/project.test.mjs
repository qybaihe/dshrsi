import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createEngine } from '../../packages/dsh-rsi/src/engine.js'
import { LAYERS, layerOf } from '../../packages/dsh-rsi/src/layers.js'
import { exportPack, importPack } from '../../packages/dsh-rsi/src/pack.js'
import { findProject, initProject, portabilityProblems, projectRootFor, publishEntry, readProject, splitHeader } from '../../packages/dsh-rsi/src/project.js'
import { drive, fakeHost, missingCommandWorld, tempLibrary } from '../support/drive.mjs'

const bash = command => ({ description: 'run', command })
const fine = () => ({ text: 'ok' })

/** A repository on disk, with or without a project harness. */
function repository(t, { harness = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dshrsi-repo-')))
  fs.mkdirSync(path.join(root, '.git'))
  fs.mkdirSync(path.join(root, 'packages', 'app'), { recursive: true })
  if (harness) initProject(root)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

/** One person's machine: its own library and engine. */
function machine(t, options = {}) {
  const lib = tempLibrary()
  t.after(lib.cleanup)
  const host = fakeHost()
  const engine = createEngine({ library: lib.library, options: { generator: 'synth', ...options }, host })
  return { ...lib, host, engine }
}

/** A session in which the user corrects the agent; the harness answers with a standing rule. */
async function correct(engine, cwd, sessionId) {
  const run = drive(engine, { sessionId, cwd }, fine)
  run.user('add a dependency on left-pad')
  await run.step()
  await run.call('bash', bash('npm install left-pad'))
  await run.step()
  await run.stop()
  run.end()
  run.user("no, don't use npm in this repository, always use pnpm")
  await run.step()
  await run.call('bash', bash('pnpm add left-pad'))
  await run.step()
  await run.stop()
  run.end()
  run.close()
}

/** A later session that simply does some work and ends. */
async function work(engine, cwd, sessionId) {
  const run = drive(engine, { sessionId, cwd }, fine)
  run.user('add a dependency on is-odd')
  await run.step()
  await run.call('bash', bash('pnpm add is-odd'))
  await run.step()
  await run.stop()
  run.end()
  run.close()
  return run
}

const files = root => fs.readdirSync(path.join(root, '.dsh-rsi', 'adaptations'))

test('layers: every friction kind belongs to exactly one of machine, user, project', () => {
  assert.deepEqual(LAYERS, ['machine', 'user', 'project'])
  assert.equal(layerOf('missing-command'), 'machine')
  assert.equal(layerOf('edit-mismatch'), 'machine')
  assert.equal(layerOf('negative-feedback'), 'user')
  assert.equal(layerOf('user-correction'), 'project')
  assert.equal(layerOf('premature-completion'), 'project')
  assert.equal(layerOf('something-new'), 'project')
})

test('project directory: found from any subdirectory; a new one goes to the repository root', (t) => {
  const bare = repository(t, { harness: false })
  assert.equal(findProject(path.join(bare, 'packages', 'app')), undefined)
  assert.equal(projectRootFor(path.join(bare, 'packages', 'app')), bare)
  initProject(bare)
  assert.equal(findProject(path.join(bare, 'packages', 'app')), bare)
  assert.deepEqual(readProject(bare).entries, [])
  assert.deepEqual(readProject(bare).problems, [])
  assert.ok(fs.existsSync(path.join(bare, '.dsh-rsi', 'README.md')))
  // Initialising twice leaves what is there alone.
  fs.writeFileSync(path.join(bare, '.dsh-rsi', 'README.md'), 'ours')
  initProject(bare)
  assert.equal(fs.readFileSync(path.join(bare, '.dsh-rsi', 'README.md'), 'utf8'), 'ours')
})

test('a file is the unit: its header says what it answers, and the same friction lands in the same file', (t) => {
  const root = repository(t)
  const record = { title: 'Use pnpm here', friction: { signature: 'user:correction:abc', kind: 'user-correction', summary: 'the user corrected the agent' }, origin: { generator: 'model' } }
  const source = "define({ title: 'Use pnpm here', description: 'd', capabilities: ['prompt'], setup(h) { h.promptSection('Use pnpm.') } })\n"
  const first = publishEntry(root, { record, source, now: Date.UTC(2026, 10, 13) })
  assert.match(first.id, /^use-pnpm-here-[0-9a-f]{6}$/)
  assert.equal(first.replaced, false)
  const [entry] = readProject(root).entries
  assert.equal(entry.hash, first.hash)
  assert.deepEqual(entry.header, { signature: 'user:correction:abc', kind: 'user-correction', summary: 'the user corrected the agent', writtenBy: 'model', addedAt: '2026-11-13' })
  assert.equal(splitHeader(entry.source).body, source)

  // Another machine learned the same thing under another title: one entry, not two.
  const second = publishEntry(root, { record: { ...record, title: 'Always pnpm' }, source: source.replace('Use pnpm.', 'Always pnpm.'), now: Date.UTC(2026, 11, 1) })
  assert.equal(second.id, first.id)
  assert.equal(second.replaced, true)
  assert.equal(readProject(root).entries.length, 1)
  assert.equal(readProject(root).entries[0].header.addedAt, '2026-11-13')

  assert.deepEqual(portabilityProblems(source, root), [])
  assert.equal(portabilityProblems(`h.deny('${root}/x')`, root).length, 1)
  fs.writeFileSync(path.join(root, '.dsh-rsi', 'adaptations', 'bad name!.js'), source)
  assert.match(readProject(root).problems[0], /file names may use/)
})

test('a rule learned from the user is written into the project harness once it has proved itself', async (t) => {
  const root = repository(t)
  const me = machine(t)
  await correct(me.engine, path.join(root, 'packages', 'app'), 's1')
  const [learned] = me.library.list()
  assert.equal(learned.layer, 'project')
  assert.equal(learned.status, 'candidate')
  assert.deepEqual(files(root), [], 'a candidate stays on this machine')

  await work(me.engine, path.join(root, 'packages', 'app'), 's2')
  const record = me.library.get(learned.id)
  assert.equal(record.status, 'active')
  assert.equal(files(root).length, 1)
  assert.equal(record.project.root, root)
  assert.equal(`${record.project.entry}.js`, files(root)[0])
  assert.deepEqual(record.scope, { kind: 'workspace', cwd: root }, 'it now covers the whole repository')
  assert.ok(me.library.trusted(root, record.project.entry, record.project.hash))
  assert.ok(me.library.auditTrail().some(entry => entry.type === 'publish' && entry.adaptationId === learned.id))
  const text = fs.readFileSync(path.join(root, '.dsh-rsi', 'adaptations', files(root)[0]), 'utf8')
  assert.match(text, /^\/\/ @dsh-rsi \{"signature":/)
  assert.match(text, /always use pnpm/)
  assert.ok(!text.includes(root), 'nothing about this checkout is written into the repository')

  // Publishing is not repeated, and the publishing machine keeps running its own adaptation.
  const before = fs.statSync(path.join(root, '.dsh-rsi', 'adaptations', files(root)[0])).mtimeMs
  await work(me.engine, root, 's3')
  assert.equal(fs.statSync(path.join(root, '.dsh-rsi', 'adaptations', files(root)[0])).mtimeMs, before)
  assert.equal(me.library.list().length, 1)
  assert.equal(me.host.contributed.at(-1).id, learned.id)
})

test('what is about the machine is not written into the repository; nor is anything without a project harness, or in manual mode', async (t) => {
  const root = repository(t)
  const me = machine(t)
  for (const sessionId of ['m1', 'm2']) {
    const run = drive(me.engine, { sessionId, cwd: root }, missingCommandWorld())
    run.user('run the tests')
    await run.step()
    await run.call('bash', bash('frobnicate test'))
    await run.step()
    await run.call('bash', bash('frobnicate test'))
    await run.step()
    await run.call('bash', bash('frobnicate test'))
    run.end()
    run.close()
  }
  const [machineFact] = me.library.list()
  assert.equal(machineFact.layer, 'machine')
  assert.equal(machineFact.status, 'active')
  assert.deepEqual(files(root), [])

  const bare = repository(t, { harness: false })
  await correct(me.engine, bare, 'b1')
  await work(me.engine, bare, 'b2')
  assert.equal(me.library.list().find(entry => entry.layer === 'project').status, 'active')
  assert.ok(!fs.existsSync(path.join(bare, '.dsh-rsi')))

  const manual = machine(t, { projectHarness: 'manual' })
  await correct(manual.engine, root, 'h1')
  await work(manual.engine, root, 'h2')
  assert.equal(manual.library.list()[0].status, 'active')
  assert.deepEqual(files(root), [])
})

test('on another machine the project harness runs only after its files were accepted there', async (t) => {
  const root = repository(t)
  const author = machine(t)
  await correct(author.engine, root, 's1')
  await work(author.engine, root, 's2')
  const [file] = files(root)
  const entry = file.replace(/\.js$/, '')

  const teammate = machine(t)
  const first = drive(teammate.engine, { sessionId: 't1', cwd: root }, fine)
  assert.deepEqual(first.session.project, { root, waiting: [{ id: entry, changed: false }] })
  assert.equal(teammate.host.contributed.length, 0)
  assert.equal(teammate.library.list().length, 0)
  assert.ok(teammate.host.logs.some(line => /not accepted on this machine/.test(line)))
  first.close()

  teammate.library.trust(root, entry, readProject(root).entries[0].hash)
  const second = drive(teammate.engine, { sessionId: 't2', cwd: path.join(root, 'packages', 'app') }, fine)
  assert.deepEqual(second.session.project.waiting, [])
  const [imported] = teammate.library.list()
  assert.equal(imported.status, 'active')
  assert.equal(imported.layer, 'project')
  assert.equal(imported.origin.imported, 'project')
  assert.equal(imported.friction.kind, 'user-correction')
  assert.deepEqual(imported.capabilities, ['prompt'])
  assert.equal(teammate.host.contributed.length, 1)
  assert.match(teammate.host.contributed[0].sections[0], /always use pnpm/)
  second.close()

  // The same thing is not learned a second time on the teammate's machine, and nothing is written back.
  await correct(teammate.engine, root, 't3')
  assert.equal(teammate.library.list().length, 1)
  assert.equal(files(root).length, 1)
})

test('a changed file keeps the accepted version running until the change is accepted; withdrawn trust unplugs it', async (t) => {
  const root = repository(t)
  const author = machine(t)
  await correct(author.engine, root, 's1')
  await work(author.engine, root, 's2')
  const file = path.join(root, '.dsh-rsi', 'adaptations', files(root)[0])
  const entry = path.basename(file, '.js')
  const teammate = machine(t)
  teammate.library.trust(root, entry, readProject(root).entries[0].hash)
  drive(teammate.engine, { sessionId: 't1', cwd: root }, fine).close()
  const [imported] = teammate.library.list()

  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('always use pnpm', 'always use pnpm, never npm or yarn'))
  const changed = drive(teammate.engine, { sessionId: 't2', cwd: root }, fine)
  assert.deepEqual(changed.session.project.waiting, [{ id: entry, changed: true }])
  assert.equal(teammate.library.get(imported.id).version, 1)
  assert.doesNotMatch(teammate.host.contributed.at(-1).sections[0], /never npm or yarn/)
  changed.close()

  teammate.library.trust(root, entry, readProject(root).entries[0].hash)
  drive(teammate.engine, { sessionId: 't3', cwd: root }, fine).close()
  assert.equal(teammate.library.get(imported.id).version, 2)
  assert.match(teammate.host.contributed.at(-1).sections[0], /never npm or yarn/)
  assert.equal(teammate.library.list().length, 1)

  teammate.library.untrust(root)
  const mounts = teammate.host.contributed.length
  const unplugged = drive(teammate.engine, { sessionId: 't4', cwd: root }, fine)
  assert.equal(teammate.host.contributed.length, mounts)
  assert.equal(teammate.library.get(imported.id).status, 'disabled')
  assert.equal(unplugged.session.project.waiting.length, 1)
  unplugged.close()

  teammate.library.trust(root, entry, readProject(root).entries[0].hash)
  drive(teammate.engine, { sessionId: 't5', cwd: root }, fine).close()
  assert.equal(teammate.library.get(imported.id).status, 'active')
  assert.equal(teammate.host.contributed.length, mounts + 1)
})

test('deleting the file unplugs the adaptation; putting it back plugs it in again; a local switch-off is respected', async (t) => {
  const root = repository(t)
  const me = machine(t)
  await correct(me.engine, root, 's1')
  await work(me.engine, root, 's2')
  const file = path.join(root, '.dsh-rsi', 'adaptations', files(root)[0])
  const text = fs.readFileSync(file, 'utf8')
  const [record] = me.library.list()

  fs.rmSync(file)
  const mounts = me.host.contributed.length
  await work(me.engine, root, 's3')
  assert.equal(me.host.contributed.length, mounts)
  assert.equal(me.library.get(record.id).status, 'disabled')
  assert.equal(me.library.get(record.id).statusReason, 'no longer in the project harness')
  assert.equal(fs.existsSync(file), false, 'an unplugged adaptation is not written back')

  fs.writeFileSync(file, text)
  await work(me.engine, root, 's4')
  assert.equal(me.library.get(record.id).status, 'active')
  assert.equal(me.host.contributed.length, mounts + 1)

  me.library.setStatus(record.id, 'disabled', 'switched off by the user')
  await work(me.engine, root, 's5')
  assert.equal(me.library.get(record.id).status, 'disabled')
  assert.equal(me.host.contributed.length, mounts + 1)
})

test('a hand-written file is a project rule like any other; a file that fails the checks does not run', async (t) => {
  const root = repository(t)
  const dir = path.join(root, '.dsh-rsi', 'adaptations')
  fs.writeFileSync(path.join(dir, 'no-force-push.js'), `define({
  title: 'Never force-push',
  description: 'This repository forbids force pushes.',
  capabilities: ['deny'],
  setup(h) {
    h.beforeTool({ tool: 'bash', command: /git\\s+push\\s+.*--force/ }, () => h.deny('Force pushes are not allowed in this repository.'))
  },
})
`)
  fs.writeFileSync(path.join(dir, 'broken.js'), "const fs = require('fs')\ndefine({})\n")
  fs.writeFileSync(path.join(dir, 'runs-commands.js'), `define({
  title: 'Check the lockfile',
  description: 'Runs a check.',
  capabilities: ['exec', 'verify'],
  setup(h) {
    h.beforeStop(async () => { const out = await h.exec('git status --short'); return out.ok ? undefined : h.continue('check') })
  },
})
`)
  const me = machine(t, { projectTrust: 'always' })
  const run = drive(me.engine, { sessionId: 's1', cwd: root }, fine)
  const records = me.library.list()
  const rule = records.find(entry => entry.project.entry === 'no-force-push')
  assert.equal(rule.friction.signature, 'project:rule:no-force-push')
  assert.equal(rule.origin.generator, 'hand')
  assert.ok(me.host.logs.some(line => /project adaptation broken was not loaded: require\(\)/.test(line)))
  assert.equal(records.some(entry => entry.project.entry === 'broken'), false)
  // "always" runs what the repository holds, but does not hand out the capabilities that need a person's consent.
  assert.equal(me.library.get(records.find(entry => entry.project.entry === 'runs-commands').id).status, 'proposed')

  run.user('publish it')
  await run.step()
  const refused = await run.call('bash', bash('git push origin main --force'))
  assert.equal(refused.denied, true)
  assert.match(refused.text, /Force pushes are not allowed/)
  assert.equal((await run.call('bash', bash('git push origin main'))).denied, false)
  run.close()

  const off = machine(t, { projectHarness: 'off' })
  const ignored = drive(off.engine, { sessionId: 'o1', cwd: root }, fine)
  assert.equal(ignored.session.project, undefined)
  assert.equal(off.library.list().length, 0)
  assert.equal((await ignored.call('bash', bash('git push origin main --force'))).denied, false)
})

test('a layer that is switched off is neither mounted nor learned', async (t) => {
  const root = repository(t)
  const all = machine(t)
  await correct(all.engine, root, 's1')
  await work(all.engine, root, 's2')
  assert.equal(files(root).length, 1)

  // The same library, opened with only the machine layer in use.
  const host = fakeHost()
  const engine = createEngine({ library: all.library, options: { generator: 'synth', layers: ['machine'] }, host })
  await correct(engine, path.join(root, 'packages'), 'x1')
  assert.equal(host.contributed.length, 0)
  assert.equal(all.library.list().length, 1)
  const run = drive(engine, { sessionId: 'x2', cwd: root }, missingCommandWorld())
  run.user('run the tests')
  await run.step()
  await run.call('bash', bash('frobnicate test'))
  await run.step()
  await run.call('bash', bash('frobnicate test'))
  await run.step()
  assert.equal(all.library.list().filter(entry => entry.layer === 'machine').length, 1)
  run.close()

  assert.throws(() => createEngine({ library: all.library, options: { layers: ['machine', 'team'] }, host }), /unknown layer "team"/)
})

test('what the user wants of the agent holds everywhere from the start', async (t) => {
  const me = machine(t)
  const run = drive(me.engine, { sessionId: 's1', cwd: '/work/alpha' }, fine)
  run.user('explain the build')
  await run.step()
  await run.call('bash', bash('ls'))
  await run.step()
  run.raw('feedback/message-put', { sessionId: 's1', item: { messageId: 'm1', rating: 'negative', category: 'instruction-following', note: 'Answers are too long; keep them under five lines.' } })
  await run.step()
  const [record] = me.library.list()
  assert.equal(record.layer, 'user')
  assert.deepEqual(record.scope, { kind: 'global' })
  run.close()
  drive(me.engine, { sessionId: 's2', cwd: '/work/beta' }, fine)
  assert.equal(me.host.contributed.at(-1).id, record.id)
})

test('project settings can ask for less adapting than the user configured, never for more', async (t) => {
  const root = repository(t)
  const manifest = path.join(root, '.dsh-rsi', 'harness.json')
  const set = settings => fs.writeFileSync(manifest, JSON.stringify({ format: 1, settings }))

  set({ mode: 'propose', disabledDetectors: ['read-thrash'], signals: { editChurn: 9 } })
  const eager = machine(t)
  const proposing = drive(eager.engine, { sessionId: 's1', cwd: root }, fine)
  assert.equal(proposing.session.mode, 'propose')
  proposing.close()
  await correct(eager.engine, root, 's2')
  assert.equal(eager.library.list()[0].status, 'proposed')
  assert.equal(eager.host.contributed.length, 0)

  set({ mode: 'adapt' })
  const careful = machine(t, { mode: 'observe' })
  assert.equal(drive(careful.engine, { sessionId: 's1', cwd: root }, fine).session.mode, 'observe')

  set({ autonomy: 'full', mode: 'observe' })
  const guarded = machine(t)
  assert.equal(drive(guarded.engine, { sessionId: 's1', cwd: root }, fine).session.mode, 'adapt')
  assert.ok(guarded.host.logs.some(line => /settings ignored: "autonomy" cannot be set by a project/.test(line)))
})

test('packs: adaptations leave one machine and arrive on another as proposals', async (t) => {
  const me = machine(t)
  const run = drive(me.engine, { sessionId: 's1', cwd: '/work/alpha' }, missingCommandWorld())
  run.user('run the tests')
  await run.step()
  await run.call('bash', bash('frobnicate test'))
  await run.step()
  await run.call('bash', bash('frobnicate test'))
  await run.step()
  run.close()
  const pack = exportPack(me.library)
  assert.equal(pack.format, 'dsh-rsi-pack/1')
  assert.equal(pack.adaptations.length, 1)
  assert.deepEqual(Object.keys(pack.adaptations[0]).sort(), ['capabilities', 'description', 'friction', 'layer', 'source', 'title', 'writtenBy'])
  assert.ok(!JSON.stringify(pack).includes('/work/alpha'), 'a pack says nothing about where it was learned')
  assert.equal(exportPack(me.library, { layer: 'project' }).adaptations.length, 0)
  assert.throws(() => exportPack(me.library, { ids: ['a-nope'] }), /no adaptation a-nope/)

  const other = machine(t)
  const [result] = importPack(other.library, pack, { cwd: '/work/gamma' })
  assert.equal(result.status, 'proposed')
  const waiting = drive(other.engine, { sessionId: 'o1', cwd: '/work/gamma' }, missingCommandWorld())
  assert.equal(other.host.contributed.length + waiting.session.mounted().length, 0)
  waiting.close()
  other.library.approve(result.id)
  const mounted = drive(other.engine, { sessionId: 'o2', cwd: '/work/anywhere' }, missingCommandWorld())
  assert.equal(mounted.session.mounted().length, 1, 'a machine fact applies everywhere on the machine it was imported to')
  assert.equal(other.library.get(result.id).origin.imported, 'pack')

  assert.match(importPack(other.library, pack)[0].reason, /already answers this/)
  const tampered = { ...pack, adaptations: [{ ...pack.adaptations[0], capabilities: ['annotate'], friction: { signature: 'x:y' }, source: "const p = process.env\ndefine({})" }] }
  assert.deepEqual(importPack(other.library, tampered).map(entry => entry.imported), [false])
  assert.throws(() => importPack(other.library, { format: 'something-else' }), /not a dsh-rsi pack/)
  assert.equal(importPack(machine(t).library, pack, { trust: true })[0].status, 'candidate')
})
