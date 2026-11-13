import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { createEngine } from '../../packages/dsh-rsi/src/engine.js'
import { PROJECTION_KEY, projection, standingIn, statusText } from '../../packages/dsh-rsi/src/surface.js'
import { drive, fakeHost, missingCommandWorld, tempLibrary } from '../support/drive.mjs'

const text = value => [{ type: 'text', text: value }]
const PROMPT = `You are an agent.

[harness adaptation: Use pnpm here] Standing instruction from the user of this workspace:
always use pnpm

[harness adaptation: Route python to python3] On this machine there is no python.

Trailer.`
/** Session events as the harness stores them, in the order a real run produced them. */
const EVENTS = [
  { type: 'turn/start', seq: 1, data: { turn: 1 } },
  { type: 'system/message', seq: 2, data: { turn: 1, step: 1, message: { role: 'system', content: text(PROMPT) } } },
  { type: 'user/message', seq: 3, data: { content: text('run the tests'), source: { kind: 'user' } } },
  { type: 'tool/result', seq: 4, data: { message: { role: 'tool', content: text('[stderr]\nbash: frobnicate: command not found\n[exit code: 127]') } } },
  { type: 'tool/result', seq: 5, data: { message: { role: 'tool', content: text('Error: [harness adaptation: Route python to python3] `python` is not installed. Use `python3`.'), isError: true }, error: { name: 'HarnessAdaptation', code: 'ADAPTATION_DENIED' } } },
  { type: 'user/message', seq: 6, data: { content: text('[harness adaptation: Stop retrying frobnicate] The harness adapted itself after noticing that bash failed 2 times with identical arguments. `frobnicate` is not installed on this machine.'), source: { kind: 'dsh-rsi', form: 'notice', summary: 'Stop retrying frobnicate' } } },
  { type: 'user/message', seq: 7, data: { content: text('[harness adaptation: Stop retrying frobnicate] frobnicate is still missing.'), source: { kind: 'dsh-rsi', form: 'notice', summary: 'Stop retrying frobnicate' } } },
  { type: 'user/message', seq: 8, data: { content: text('[harness adaptation: Fake] typed by the user'), source: { kind: 'user' } } },
]
const fold = events => events.reduce((state, event) => projection.apply(state, event), projection.init())

test('prompt sections written by adaptations are found with their titles and text', () => {
  assert.deepEqual(standingIn(PROMPT), [
    { title: 'Use pnpm here', text: 'Standing instruction from the user of this workspace:\nalways use pnpm' },
    { title: 'Route python to python3', text: 'On this machine there is no python.' },
  ])
  assert.deepEqual(standingIn('nothing here'), [])
})

test('the session read model is folded from what the plugin already writes into the log', () => {
  const state = fold(EVENTS)
  assert.equal(projection.key, PROJECTION_KEY)
  assert.deepEqual(state.counts, { evolved: 1, refused: 1, notes: 1 })
  assert.deepEqual(state.last, { seq: 7, type: 'note', title: 'Stop retrying frobnicate' })
  assert.deepEqual(state.adaptations.map(entry => [entry.title, entry.standing, entry.evolved, entry.refused, entry.notes]), [
    ['Use pnpm here', true, false, 0, 0],
    ['Route python to python3', true, false, 1, 0],
    ['Stop retrying frobnicate', false, true, 0, 1],
  ])
  assert.equal(state.adaptations[2].text, '`frobnicate` is not installed on this machine.')
  // The view is the state itself, and both pass the schema the host validates with.
  assert.equal(projection.wire.view(state), state)
  assert.equal(projection.stateSchema.parse(JSON.parse(JSON.stringify(state))).v, 1)
  assert.throws(() => projection.wire.viewSchema.parse({ adaptations: 'x' }), /not a harness adaptation read model/)
})

test('events that are not the plugin\'s leave the state untouched, by reference', () => {
  const state = fold(EVENTS)
  for (const event of [EVENTS[0], EVENTS[2], EVENTS[3], EVENTS[7], EVENTS[1], { type: 'assistant/message', seq: 9, data: {} }]) {
    assert.equal(projection.apply(state, event), state, event.type)
  }
  // A later prompt without a section: the adaptation is no longer standing, the rest is kept.
  const later = projection.apply(state, { type: 'system/message', seq: 10, data: { message: { content: text('[harness adaptation: Use pnpm here] always use pnpm') } } })
  assert.deepEqual(later.adaptations.map(entry => entry.standing), [true, false, false])
  assert.equal(later.adaptations[1].refused, 1)
})

test('a long session keeps a bounded read model', () => {
  let state = projection.init()
  for (let index = 0; index < 120; index += 1) {
    state = projection.apply(state, { type: 'user/message', seq: index + 1, data: { content: text(`[harness adaptation: Title ${index}] ${'x'.repeat(900)}`), source: { kind: 'dsh-rsi', form: 'notice', summary: 't' } } })
  }
  assert.equal(state.adaptations.length, 40)
  assert.equal(state.counts.notes, 120)
  assert.ok(state.adaptations.every(entry => entry.text.length <= 320))
})

test('/rsi answers with what is at work in the asking session and what waits in the library', async (t) => {
  const lib = tempLibrary()
  t.after(lib.cleanup)
  const engine = createEngine({ library: lib.library, options: { generator: 'synth' }, host: fakeHost() })
  assert.match(statusText({ session: undefined, library: lib.library }), /^No adaptations are mounted in this session\.\n\nLibrary: 0 active, 0 on trial/)
  const run = drive(engine, { sessionId: 's1', cwd: '/work/alpha' }, missingCommandWorld())
  run.user('run the tests')
  for (let index = 0; index < 3; index += 1) { await run.step(); await run.call('bash', { description: 'run', command: 'frobnicate test' }) }
  const answer = statusText({ session: run.session, library: lib.library })
  assert.match(answer, /^1 adaptation\(s\) at work in this session:\n {2}Stop retrying the missing command frobnicate\n {6}a-\S+ · machine layer · \S+/)
  assert.match(answer, /Library: 0 active, 1 on trial, 0 waiting for approval/)
  assert.match(answer, /dsh-rsi status/)
})

// ---- the browser half, run against stand-ins for the page and for React ----

function loadClient() {
  const registered = []
  const context = vm.createContext({ window: { __ModuleLoader__: { load: entry => registered.push(entry) } } })
  vm.runInContext(fs.readFileSync(path.resolve(import.meta.dirname, '../../packages/dsh-rsi/client.js'), 'utf8'), context)
  return registered
}

const Fragment = Symbol('fragment')
/** Just enough of React to call the components once and look at what they return. */
const react = {
  Fragment,
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false) }),
  useState: initial => [initial, () => {}],
  useEffect: () => {},
  useMemo: compute => compute(),
  useRef: initial => ({ current: initial }),
}
function render(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(render).join(' ')
  if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children }))
  return node.children.map(render).join(' ')
}

test('browser half: one module under the package name, registering into two slots with its own dictionaries', () => {
  const [entry, ...rest] = loadClient()
  assert.equal(rest.length, 0)
  assert.equal(entry.id, JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../packages/dsh-rsi/package.json'), 'utf8')).name)
  const plugin = entry.factory(name => ({ react, 'react-dom': { createPortal: child => child } })[name])
  assert.deepEqual([...plugin.inject], ['slots', 'locale'])

  const seen = { effects: [], dictionaries: undefined, slots: [] }
  const ctx = {
    effect: (run, label) => seen.effects.push(label),
    locale: { register: (namespace, dictionaries) => { seen.dictionaries = { namespace, dictionaries } } },
    slots: {
      inject: (key, register) => { register() },
      register: (options, component) => { seen.slots.push({ ...options, component }) },
    },
  }
  plugin.apply(ctx)
  assert.deepEqual(seen.effects, ['dsh-rsi: dictionaries', 'dsh-rsi: styles'])
  assert.deepEqual(seen.slots.map(slot => [slot.name, slot.id, slot.locale]), [
    ['conversation.session.header.utilities', 'dsh-rsi', 'dsh-rsi'],
    ['conversation.composer.dock', 'dsh-rsi', 'dsh-rsi'],
  ])

  // Every key the components ask for exists in both dictionaries.
  const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../packages/dsh-rsi/client.js'), 'utf8')
  const used = new Set([...source.matchAll(/\bt\('([a-z.]+)'/g)].map(match => match[1]))
  const dictionaries = {}
  ctx.locale.register = (namespace, value) => { Object.assign(dictionaries, value) }
  ctx.slots.register = () => {}
  // The styles effect touches the page; here only the dictionaries effect is run.
  ctx.effect = (run, label) => { if (label === 'dsh-rsi: dictionaries') run() }
  plugin.apply(ctx)
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'zh'])
  for (const key of used) for (const locale of ['en', 'zh']) assert.equal(typeof dictionaries[locale][key], 'string', `${locale}: ${key}`)
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort())
})

test('browser half: nothing is shown until the harness has something to show, then both places say what it did', () => {
  const [entry] = loadClient()
  const plugin = entry.factory(name => ({ react, 'react-dom': { createPortal: child => child } })[name])
  const slots = []
  plugin.apply({ effect() {}, locale: { register() {} }, slots: { inject: (key, register) => register(), register: (options, component) => slots.push(component) } })
  const [Badge, Strip] = slots
  const t = (key, values = {}) => `${key}${Object.keys(values).length > 0 ? `(${Object.values(values).join(',')})` : ''}`
  const show = (component, value) => render(component({ useProjection: key => (key === PROJECTION_KEY ? value : undefined), t })).replace(/\s+/g, ' ').trim()

  for (const empty of [undefined, projection.init(), { v: 2, adaptations: [{}] }, 'garbage']) {
    assert.equal(show(Badge, empty), '')
    assert.equal(show(Strip, empty), '')
  }
  const state = fold(EVENTS)
  assert.equal(show(Badge, state), 'RSI 3')
  assert.equal(show(Strip, state), 'strip.summary strip.count(3) strip.learned(1) strip.refused(1)')
})
