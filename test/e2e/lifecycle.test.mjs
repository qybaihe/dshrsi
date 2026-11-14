// The rest of the chain against the real harness: the stop boundary, power
// capabilities and approval, tools the harness grows, what the user says,
// revision, quarantine, and the guarantees around all of it.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { DSH_BIN, PLUGIN_DIR, ROOT, childEnv, fenced, isGeneratorRequest, makeSandbox, readSessions, runDsh } from '../support/harness.mjs'
import { systemText, toolCalls, toolResults, userTexts } from '../support/sim-llm.mjs'

const BUGGY = 'export const sum = (a, b) => a - b\n'
const FILES = {
  'package.json': '{"name":"demo","type":"module","scripts":{"test":"node --test"}}\n',
  'sum.js': BUGGY,
  'sum.test.mjs': "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { sum } from './sum.js'\ntest('sum', () => assert.equal(sum(2, 3), 5))\n",
}
const said = (body, pattern) => pattern.test(JSON.stringify(body.messages))
const bash = (command, description = 'run') => ({ toolCalls: [{ name: 'bash', input: { description, command } }] })
const edit = (cwd, from, to) => ({ toolCalls: [{ name: 'edit', input: { file_path: path.join(cwd, 'sum.js'), old_string: from, new_string: to } }] })
const rsiCli = (home, ...args) => execFileSync(process.execPath, [path.join(PLUGIN_DIR, 'bin/rsi.js'), '--home', path.join(home, 'rsi'), ...args], { encoding: 'utf8' })
const notices = body => userTexts(body).filter(text => text.startsWith('[harness adaptation:'))
/** Names of the tools the model called over a whole run, in order. */
const called = run => toolCalls(run.agentRequests.at(-1)).map(call => call.name)

/** A model that fixes the bug and declares victory without running anything, unless told to check. */
function fixerPolicy(cwd, { generator } = {}) {
  return (body) => {
    if (isGeneratorRequest(body)) return generator ? generator(body) : { text: 'I do not know.' }
    const results = toolResults(body)
    if (results.some(result => /pass 1/.test(result.text))) return { text: 'Fixed and verified.' }
    if (said(body, /have not run any check since/)) return bash('node --test', 'run the tests')
    if (toolCalls(body).some(call => call.name === 'edit')) return { text: 'Fixed.' }
    return edit(cwd, 'a - b', 'a + b')
  }
}

test('a turn about to end on unverified edits is turned back by a verifier written at that moment', async (t) => {
  const box = makeSandbox('verify')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', FILES)

  const offCwd = box.workspace('off', FILES)
  const baseline = await runDsh({ home: path.join(box.dir, 'home-off'), cwd: offCwd, task: 'fix sum', policy: fixerPolicy(offCwd), rsi: false })
  assert.equal(baseline.final.text, 'Fixed.')
  assert.deepEqual(called(baseline), ['edit'])

  const run = await runDsh({ home: box.home, cwd, task: 'fix sum', policy: fixerPolicy(cwd), rsi: { generator: 'synth' } })
  assert.equal(run.final.text, 'Fixed and verified.', run.stderr)
  assert.deepEqual(called(run), ['edit', 'bash'])
  const [session] = readSessions(box.home)
  assert.equal(session.events.filter(event => event.type === 'turn/start').length, 1)
  const steer = session.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'dsh-rsi')
  assert.equal(steer.length, 1)
  assert.match(steer[0].data.content[0].text, /^\[harness adaptation: Require a check after edits before finishing\] You changed .*sum\.js and have not run any check since/)

  const library = box.library()
  const [record] = library.list()
  assert.equal(record.friction.signature, 'turn:unverified-edits')
  assert.deepEqual(record.capabilities, ['verify'])
  assert.equal(record.status, 'active')

  // Next session: the verifier is part of the harness from the first step.
  fs.writeFileSync(path.join(cwd, 'sum.js'), BUGGY)
  const next = await runDsh({ home: box.home, cwd, task: 'fix sum', policy: fixerPolicy(cwd), rsi: { generator: 'synth' } })
  assert.equal(next.final.text, 'Fixed and verified.')
  assert.equal(library.list().length, 1)
})

const EXEC_VERIFIER = `define({
  title: 'Run the test suite before a turn may end',
  description: 'Turns ended with edits nobody tested; the harness runs the tests itself at the stop boundary.',
  capabilities: ['verify', 'exec'],
  setup(h) {
    h.beforeStop(async (turn) => {
      if (turn.edits.length === 0 || turn.verifiedAfterEdits) return undefined
      const run = await h.exec('node --test')
      return run.ok ? undefined : h.continueWith('The harness ran the tests after your edits and they fail:\\n' + run.text.slice(0, 1500))
    })
  },
})`

test('an adaptation that runs commands waits for the user; once approved the harness tests the work itself', async (t) => {
  const box = makeSandbox('exec')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', FILES)
  const library = box.library()
  const generator = () => ({ text: fenced(EXEC_VERIFIER) })

  const first = await runDsh({ home: box.home, cwd, task: 'fix sum', policy: fixerPolicy(cwd, { generator }), rsi: { generator: 'model' } })
  assert.equal(first.final.text, 'Fixed.')
  const [proposed] = library.list()
  assert.equal(proposed.status, 'proposed')
  assert.equal(proposed.tier, 'power')
  assert.match(rsiCli(box.home, 'status'), new RegExp(`dsh-rsi approve ${proposed.id}   # Run the test suite before a turn may end \\[verify, exec\\]`))

  // Unapproved, it does nothing, and the cause is not proposed a second time.
  fs.writeFileSync(path.join(cwd, 'sum.js'), BUGGY)
  const waiting = await runDsh({ home: box.home, cwd, task: 'fix sum', policy: fixerPolicy(cwd, { generator }), rsi: { generator: 'model' } })
  assert.equal(waiting.final.text, 'Fixed.')
  assert.equal(waiting.generatorRequests.length, 0)
  assert.equal(library.list().length, 1)

  assert.match(rsiCli(box.home, 'approve', proposed.id), /candidate/)

  // This model gets the fix wrong first; nobody asks it to test, the harness just does.
  fs.writeFileSync(path.join(cwd, 'sum.js'), BUGGY)
  const sloppy = (body) => {
    const edits = toolCalls(body).filter(call => call.name === 'edit').length
    if (said(body, /The harness ran the tests after your edits and they fail/) && edits === 1) return edit(cwd, 'a * b', 'a + b')
    if (edits === 0) return edit(cwd, 'a - b', 'a * b')
    return { text: edits === 1 ? 'Fixed.' : 'Fixed properly.' }
  }
  const run = await runDsh({ home: box.home, cwd, task: 'fix sum', policy: sloppy, rsi: { generator: 'model' } })
  assert.equal(run.final.text, 'Fixed properly.', run.stderr)
  assert.equal(fs.readFileSync(path.join(cwd, 'sum.js'), 'utf8'), 'export const sum = (a, b) => a + b\n')
  const steer = notices(run.agentRequests.at(-1))
  assert.equal(steer.length, 1)
  assert.match(steer[0], /they fail:[\s\S]*(not ok 1 - sum|✖ sum)[\s\S]*6 !== 5/)
  // The harness's own test runs are not the model's tool calls: the conversation shows only the two edits.
  assert.deepEqual(called(run), ['edit', 'edit'])
  assert.equal(library.statsOf(proposed.id).effects.continue, 1)
  assert.equal(library.get(proposed.id).status, 'active')
})

const GROWN_TOOL = `define({
  title: 'Give the agent a tool that runs this project\\'s tests',
  description: 'frobnicate is missing here; the real test command becomes a tool so the agent stops guessing.',
  capabilities: ['annotate', 'tool', 'exec'],
  setup(h) {
    h.addTool({
      name: 'run_project_tests',
      description: 'Run the test suite of this project and return its output.',
      parameters: {},
      run: async () => {
        const result = await h.exec('node --test')
        return (result.ok ? 'PASSED\\n' : 'FAILED\\n') + result.text
      },
    })
    h.onToolResult({ command: /^frobnicate\\b/ }, (call, result) => result.ok ? undefined
      : h.annotate('frobnicate is not available. Call the run_project_tests tool instead.'))
  },
})`

test('with full autonomy the harness grows a new tool mid-session and the model uses it', async (t) => {
  const box = makeSandbox('tool')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', { ...FILES, 'sum.js': 'export const sum = (a, b) => a + b\n' })
  const policy = (body) => {
    if (isGeneratorRequest(body)) return { text: fenced(GROWN_TOOL) }
    if (toolResults(body).some(result => /^PASSED/.test(result.text))) return { text: 'Tests pass.' }
    if ((body.tools ?? []).some(tool => tool.name === 'run_project_tests')) return { toolCalls: [{ name: 'run_project_tests', input: {} }] }
    return bash('frobnicate test', 'run tests')
  }
  const run = await runDsh({ home: box.home, cwd, task: 'run the tests', policy, rsi: { generator: 'model', autonomy: 'full' } })
  assert.equal(run.final.text, 'Tests pass.', run.stderr)
  const hasTool = run.agentRequests.map(body => body.tools.some(tool => tool.name === 'run_project_tests'))
  assert.deepEqual(hasTool, [false, false, false, true, true])
  // The request that first offers the tool is the one that announces it.
  assert.deepEqual(run.agentRequests.map(body => notices(body).some(text => /The harness adapted itself/.test(text))), [false, false, false, true, true])
  assert.match(toolResults(run.agentRequests.at(-1)).at(-1).text, /^PASSED\n[\s\S]*pass 1/)
  const [record] = box.library().list()
  assert.equal(record.approval.by, 'autonomy')
  assert.deepEqual(record.capabilities, ['annotate', 'tool', 'exec'])

  // Without full autonomy the same adaptation is only proposed and the tool never appears.
  const careful = makeSandbox('tool-held')
  t.after(careful.cleanup)
  const held = await runDsh({ home: careful.home, cwd: careful.workspace('ws', FILES), task: 'run the tests', policy, rsi: { generator: 'model' }, maxRequests: 6 })
  assert.equal(held.agentRequests.some(body => body.tools.some(tool => tool.name === 'run_project_tests')), false)
  assert.equal(careful.library().list()[0].status, 'proposed')
})

test('what the user had to say twice becomes part of the harness prompt for that workspace', async (t) => {
  const box = makeSandbox('correct')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', FILES)
  const other = box.workspace('other', FILES)
  const policy = (body) => {
    if (said(body, /一律用 pnpm/)) return { text: '好的，之后都用 pnpm。' }
    return toolResults(body).length === 0 ? bash('echo "npm install left-pad"', 'install with npm') : { text: 'Installed with npm.' }
  }
  const first = await runDsh({ home: box.home, cwd, task: 'add left-pad', policy, rsi: { generator: 'synth' } })
  assert.equal(first.final.text, 'Installed with npm.')
  assert.equal(box.library().list().length, 0)

  // The correction arrives as the next turn of the same session.
  const second = await runDsh({ home: box.home, cwd, task: '不要用 npm，这个仓库一律用 pnpm', policy, rsi: { generator: 'synth' }, args: ['--session-id', first.final.sessionId] })
  assert.equal(second.final.text, '好的，之后都用 pnpm。', second.stderr)
  const [record] = box.library().list()
  assert.equal(record.friction.kind, 'user-correction')
  assert.deepEqual(record.capabilities, ['prompt'])
  assert.deepEqual(record.scope, { kind: 'workspace', cwd })

  const fresh = policyBody => ({ text: systemText(policyBody).includes('一律用 pnpm') ? 'I will use pnpm.' : 'I will use npm.' })
  const here = await runDsh({ home: box.home, cwd, task: 'add lodash', policy: fresh, rsi: { generator: 'synth' } })
  assert.equal(here.final.text, 'I will use pnpm.')
  assert.match(systemText(here.agentRequests[0]), /\[harness adaptation: Remember the user's instruction: [^\]]+\] Standing instruction from the user of this workspace \(they had to correct this once already\):\n不要用 npm，这个仓库一律用 pnpm/)
  const elsewhere = await runDsh({ home: box.home, cwd: other, task: 'add lodash', policy: fresh, rsi: { generator: 'synth' } })
  assert.equal(elsewhere.final.text, 'I will use npm.')
})

test('advice the model ignores is replaced by enforcement: the adaptation is revised in the same session', async (t) => {
  const box = makeSandbox('revise')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', { ...FILES, 'sum.js': 'export const sum = (a, b) => a + b\n' })
  const advisory = `define({
  title: 'Mention that frobnicate is missing',
  description: 'frobnicate does not exist on this machine; mention it when it fails.',
  capabilities: ['annotate'],
  setup(h) {
    h.onToolResult({ command: /^frobnicate\\b/ }, (call, result) => result.ok ? undefined : h.annotate('Note: frobnicate could not be found.'))
  },
})`
  const enforcing = `define({
  title: 'Refuse frobnicate',
  description: 'frobnicate does not exist on this machine and notes did not stop the retries; refuse the call.',
  capabilities: ['deny'],
  setup(h) {
    h.beforeTool({ command: /^frobnicate\\b/ }, () => h.deny('frobnicate does not exist on this machine, so this call was not run. Use: node --test'))
  },
})`
  const policy = (body) => {
    if (isGeneratorRequest(body)) return { text: fenced(said(body, /An earlier adaptation for this finding is installed/) ? enforcing : advisory) }
    if (toolResults(body).some(result => /pass 1/.test(result.text))) return { text: 'Tests pass.' }
    if (said(body, /was not run/)) return bash('node --test', 'run tests with node')
    return bash('frobnicate test', 'run tests')
  }
  const run = await runDsh({ home: box.home, cwd, task: 'run the tests', policy, rsi: { generator: 'model' } })
  assert.equal(run.final.text, 'Tests pass.', run.stderr)
  assert.equal(run.generatorRequests.length, 2)
  assert.match(userTexts(run.generatorRequests[1]).join('\n'), /the trouble came back 2 more time\(s\)[\s\S]*Mention that frobnicate is missing/)

  const library = box.library()
  const [record] = library.list()
  assert.equal(library.list().length, 1)
  assert.equal(record.version, 2)
  assert.equal(record.title, 'Refuse frobnicate')
  assert.equal(record.origin.revisions.length, 1)
  assert.match(fs.readFileSync(path.join(box.rsiHome, 'adaptations', record.id, 'versions', '1.js'), 'utf8'), /Mention that frobnicate is missing/)
  assert.deepEqual(library.auditTrail().filter(entry => ['create', 'revise'].includes(entry.type)).map(entry => [entry.type, entry.version]), [['create', 1], ['revise', 2]])
  assert.equal(toolResults(run.agentRequests.at(-1)).filter(result => /command not found/.test(result.text)).length, 4)

  // The user can go back to the earlier version.
  assert.match(rsiCli(box.home, 'rollback', record.id), /v1\s+Refuse frobnicate|v1/)
  assert.match(library.readSource(record.id), /Mention that frobnicate is missing/)
})

test('going back, against the real harness: a version, a step, the whole harness, and the stock switch', async (t) => {
  const box = makeSandbox('goback')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', { ...FILES, 'sum.js': 'export const sum = (a, b) => a + b\n' })
  const advisory = `define({
  title: 'Mention that frobnicate is missing',
  description: 'frobnicate does not exist on this machine; mention it when it fails.',
  capabilities: ['annotate'],
  setup(h) {
    h.onToolResult({ command: /^frobnicate\\b/ }, (call, result) => result.ok ? undefined : h.annotate('Note: frobnicate could not be found.'))
  },
})`
  const enforcing = `define({
  title: 'Refuse frobnicate',
  description: 'frobnicate does not exist on this machine and notes did not stop the retries; refuse the call.',
  capabilities: ['deny'],
  setup(h) {
    h.beforeTool({ command: /^frobnicate\\b/ }, () => h.deny('frobnicate does not exist on this machine, so this call was not run. Use: node --test'))
  },
})`
  const policy = (body) => {
    if (isGeneratorRequest(body)) return { text: fenced(said(body, /An earlier adaptation for this finding is installed/) ? enforcing : advisory) }
    if (toolResults(body).some(result => /pass 1/.test(result.text))) return { text: 'Tests pass.' }
    if (said(body, /was not run/)) return bash('node --test', 'run tests with node')
    return bash('frobnicate test', 'run tests')
  }
  const options = { home: box.home, cwd, task: 'run the tests', policy, rsi: { generator: 'model' } }
  assert.equal((await runDsh(options)).final.text, 'Tests pass.')
  const library = box.library()
  const [{ id }] = library.list()
  const now = () => { const record = library.get(id); return [record.version, record.capabilities.join(), ['candidate', 'active'].includes(record.status) ? 'runs' : record.status] }
  assert.deepEqual(now(), [2, 'deny', 'runs'])

  // One version back. It comes back as what it was accepted as, so the next session runs it: it notes, the model
  // ignores the notes, and the rewrite that follows is version 3, never a second "version 2".
  assert.match(rsiCli(box.home, 'rollback', id), /v1 {2}Mention that frobnicate is missing/)
  assert.deepEqual(now(), [1, 'annotate', 'runs'])
  const second = await runDsh(options)
  assert.equal(second.final.text, 'Tests pass.', second.stderr)
  assert.ok(notices(second.agentRequests.at(-1)).some(text => /Note: frobnicate could not be found/.test(text)))
  assert.deepEqual([now()[0], library.versions(id)], [3, [1, 2, 3]])

  // One step back: the rewrite is undone, and the timeline says who did what.
  assert.match(rsiCli(box.home, 'undo'), /^Undid generation \d+ \(revise\): Refuse frobnicate\n\S+ {2}now v1 /)
  assert.deepEqual(now(), [1, 'annotate', 'runs'])
  const timeline = JSON.parse(rsiCli(box.home, 'timeline', '-n', '50', '--json'))
  assert.deepEqual(timeline.map(entry => entry.change).filter(change => change !== 'promote'), ['create', 'revise', 'rollback', 'revise', 'undo'])
  assert.deepEqual(timeline.filter(entry => entry.by === 'user').map(entry => entry.change), ['rollback', 'undo'])
  assert.match(rsiCli(box.home, 'timeline'), /GEN {2}WHEN[\s\S]*rollback[\s\S]*v2 -> v1/)

  // The whole harness as it was after the first session, and from there back to before it learned anything.
  const afterFirst = timeline.find(entry => entry.change === 'rollback').generation - 1
  assert.match(rsiCli(box.home, 'restore', String(afterFirst)), /back as it was at generation \d+: 1 adaptation\(s\) changed/)
  assert.deepEqual(now(), [2, 'deny', 'runs'])
  assert.match(rsiCli(box.home, 'restore', '0'), /generation 0: 1 adaptation/)
  assert.equal(now()[2], 'disabled')
  assert.match(rsiCli(box.home, 'undo'), /Undid generation \d+ \(a restore\)/)
  assert.deepEqual(now(), [2, 'deny', 'runs'])

  // Stock: the same library, and a session that is exactly the stock harness. Then on again.
  assert.match(rsiCli(box.home, 'off', 'looks', 'wrong'), /now runs as stock/)
  assert.match(rsiCli(box.home, 'status'), /OFF: the harness runs as stock since \d+ s ago \(looks wrong\)/)
  const once = body => (toolResults(body).length === 0 ? bash('frobnicate test', 'run tests') : { text: 'It failed.' })
  const bare = await runDsh({ ...options, policy: once })
  assert.equal(bare.final.text, 'It failed.', bare.stderr)
  assert.deepEqual([bare.generatorRequests.length, notices(bare.agentRequests.at(-1)).length], [0, 0])
  assert.match(toolResults(bare.agentRequests.at(-1))[0].text, /command not found/)
  assert.doesNotMatch(systemText(bare.agentRequests[0]), /harness adaptation/)
  assert.match(rsiCli(box.home, 'on'), /Adapting again: 1 adaptation\(s\) are at work/)
  const back = await runDsh({ ...options, policy: once })
  assert.match(toolResults(back.agentRequests.at(-1))[0].text, /was not run/)
})

test('an adaptation that keeps throwing is quarantined while the session carries on untouched', async (t) => {
  const box = makeSandbox('quarantine')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', FILES)
  const library = box.library()
  const record = library.create({
    title: 'Broken on purpose', description: 'reads a field that is never there', capabilities: ['annotate'], tier: 'tighten', status: 'active',
    scope: { kind: 'global' }, friction: { signature: 'bash:other:planted', kind: 'repeated-failure' }, origin: { sessionId: 'planted' },
  }, `define({
  title: 'Broken on purpose', description: 'reads a field that is never there', capabilities: ['annotate'],
  setup(h) { h.onToolResult((call, result) => { if (result.text === 'never') return h.annotate('x'); return call.missing.field }) },
})`)
  const policy = body => (toolResults(body).length < 4 ? bash(`echo step-${toolResults(body).length}`) : { text: 'All four ran.' })
  const run = await runDsh({ home: box.home, cwd, task: 'echo four times', policy, rsi: { generator: 'synth' } })
  assert.equal(run.final.text, 'All four ran.')
  assert.deepEqual(toolResults(run.agentRequests.at(-1)).map(result => result.text.trim()), ['step-0', 'step-1', 'step-2', 'step-3'])
  assert.equal(library.get(record.id).status, 'quarantined')
  assert.equal(library.ledger().filter(entry => entry.type === 'fault').length, 3)
  assert.match(rsiCli(box.home, 'status'), /quarantined/)
})

test('when nothing goes wrong the plugin is invisible: the model sees byte-identical requests', async (t) => {
  const box = makeSandbox('transparent')
  t.after(box.cleanup)
  // The check prints the same text on every run, so the two conversations can be compared byte for byte.
  const cwd = box.workspace('ws', { ...FILES, 'check.mjs': "import { sum } from './sum.js'\nconsole.log(sum(2, 3) === 5 ? 'check ok' : 'check failed')\n" })
  const policy = (body) => {
    const count = toolResults(body).length
    if (count === 0) return { toolCalls: [{ name: 'read', input: { file_path: path.join(cwd, 'sum.js') } }] }
    if (count === 1) return edit(cwd, 'a - b', 'a + b')
    if (count === 2) return bash('node check.mjs', 'run the check')
    return { text: 'Fixed and verified.' }
  }
  const visible = run => run.agentRequests.map(body => JSON.stringify({ system: body.system, messages: body.messages, tools: body.tools }))
  const off = await runDsh({ home: path.join(box.dir, 'home-off'), cwd, task: 'fix sum', policy, rsi: false })
  fs.writeFileSync(path.join(cwd, 'sum.js'), BUGGY)
  const on = await runDsh({ home: box.home, cwd, task: 'fix sum', policy, rsi: { generator: 'synth' } })
  assert.equal(on.final.text, 'Fixed and verified.')
  assert.match(toolResults(on.agentRequests.at(-1)).at(-1).text, /check ok/)
  assert.equal(on.agentRequests.length, 4)
  assert.equal(off.agentRequests.length, 4)
  for (let index = 0; index < 4; index += 1) assert.equal(visible(on)[index] === visible(off)[index], true, `request ${index + 1} differs with the plugin loaded`)
  assert.equal(on.generatorRequests.length, 0)
  assert.equal(box.library().list().length, 0)
  // It still watched: the session is in the ledger, with no friction recorded.
  assert.deepEqual(box.library().ledger().map(entry => entry.type), ['session'])
})

test('a configuration the plugin does not understand stops the plugin, not the harness', async (t) => {
  const box = makeSandbox('config')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', FILES)
  for (const [rsi, message] of [
    [{ mode: 'yolo' }, /\$\.mode expected "observe" \| "propose" \| "adapt" but got "yolo"/],
    [{ signals: { repeatFailures: 3 } }, /unknown signal threshold "repeatFailures"/],
    [{ provider: 'deepseek-official' }, /provider and model must be set together/],
  ]) {
    const run = await runDsh({ home: box.home, cwd, task: 'hi', policy: () => ({ text: 'hello' }), rsi })
    assert.equal(run.final.text, 'hello')
    assert.match(run.stderr, /1 entry did not activate/)
    assert.match(run.stderr, message)
  }
})

test('installed the documented way, the bundle activates by itself and keeps its library under the harness home', async (t) => {
  const box = makeSandbox('install')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', { ...FILES, 'sum.js': 'export const sum = (a, b) => a + b\n' })
  const env = childEnv({ DSH_HOME: box.home, PATH: `${path.join(ROOT, 'node_modules/.bin')}${path.delimiter}${process.env.PATH}` })
  execFileSync(DSH_BIN, ['plugin', '--profile', 'headless', 'add', PLUGIN_DIR], { env, encoding: 'utf8', stdio: 'pipe' })
  const profile = JSON.parse(fs.readFileSync(path.join(box.home, 'profiles/headless/package.json'), 'utf8'))
  assert.deepEqual(profile.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-rsi'])
  assert.match(execFileSync(DSH_BIN, ['--profile', 'headless', '--dump-config'], { env, encoding: 'utf8' }), /# == dsh-rsi\n- id: dsh-rsi\n  name: dsh-rsi\n  config:\n    home: !!js dshHomePath\('rsi'\)/)

  const policy = (body) => {
    if (isGeneratorRequest(body)) return { text: 'I do not know.' }
    if (toolResults(body).some(result => /pass 1/.test(result.text))) return { text: 'Tests pass.' }
    return said(body, /is not installed on this machine/) ? bash('node --test') : bash('frobnicate test')
  }
  // No plugin row in the overlay: the profile's own bundle list is what loads it.
  const run = await runDsh({ home: box.home, cwd, task: 'run the tests', policy, rsi: false })
  assert.equal(run.final.text, 'Tests pass.', run.stderr)
  assert.equal(run.agentRequests.length, 4)
  const [record] = box.library().list()
  assert.equal(record.friction.signature, 'bash:command-not-found:frobnicate')
  // Default configuration: the session model is asked first, the template is the fallback.
  assert.equal(run.generatorRequests.length, 3)
  assert.equal(record.origin.generator, 'synth')
})

test('stored sessions can be mined: what went wrong before the plugin existed becomes a proposal', async (t) => {
  const box = makeSandbox('mine')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', { ...FILES, 'sum.js': 'export const sum = (a, b) => a + b\n' })
  const stubborn = (body) => {
    if (toolResults(body).some(result => /pass 1/.test(result.text))) return { text: 'Tests pass.' }
    if (said(body, /is not installed on this machine/)) return bash('node --test')
    return toolResults(body).length >= 4 ? { text: 'I could not run the tests.' } : bash('frobnicate test')
  }
  const past = await runDsh({ home: box.home, cwd, task: 'run the tests', policy: stubborn, rsi: false })
  assert.equal(past.final.text, 'I could not run the tests.')
  const [session] = readSessions(box.home)

  const report = rsiCli(box.home, 'mine', session.file)
  assert.match(report, /missing-command\s+bash:command-not-found:frobnicate/)
  assert.equal(box.library().list().length, 0)
  const proposed = rsiCli(box.home, 'mine', session.file, '--adapt')
  const id = /proposed (a-[0-9a-z-]+): Stop retrying the missing command frobnicate/.exec(proposed)[1]
  assert.equal(box.library().get(id).status, 'proposed')
  rsiCli(box.home, 'approve', id)

  const run = await runDsh({ home: box.home, cwd, task: 'run the tests', policy: stubborn, rsi: { generator: 'synth' } })
  assert.equal(run.final.text, 'Tests pass.')
  assert.equal(run.agentRequests.length, 3)
})
