// The core loop against the real harness: friction in a live turn, an
// adaptation written, validated and mounted before the next model request,
// and the library carrying it into later sessions.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { recurrence } from '../../packages/dsh-rsi/src/metrics.js'
import { PLUGIN_DIR, fenced, isGeneratorRequest, makeSandbox, readSessions, runDsh } from '../support/harness.mjs'
import { systemText, toolResults, userTexts } from '../support/sim-llm.mjs'

const FILES = {
  'package.json': '{"name":"demo","type":"module","scripts":{"test":"node --test"}}\n',
  'sum.test.mjs': "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('sum', () => assert.equal(1 + 1, 2))\n",
}
const said = (body, pattern) => pattern.test(JSON.stringify(body.messages))
const bash = (command, description = 'run') => ({ toolCalls: [{ name: 'bash', input: { description, command } }] })
const rsiCli = (home, ...args) => execFileSync(process.execPath, [path.join(PLUGIN_DIR, 'bin/rsi.js'), '--home', path.join(home, 'rsi'), ...args], { encoding: 'utf8' })

/**
 * A model that wants to run the tests with a command this machine does not
 * have. It only changes course when something tells it the command is missing
 * or refuses the call; otherwise it retries, then gives up. `readsPrompt` and
 * `heedsAdvice` say whether it takes that from the system prompt and from notes.
 */
function testerPolicy({ generator, heedsAdvice = true, readsPrompt = true } = {}) {
  return (body) => {
    if (isGeneratorRequest(body)) return generator ? generator(body) : { text: 'I do not know.' }
    const results = toolResults(body)
    if (results.some(result => /pass 1/.test(result.text))) return { text: 'Tests pass.' }
    const told = said(body, /is not installed on this machine/) || (readsPrompt && /is not installed on this machine/.test(systemText(body)))
    const refused = said(body, /was not run|has already failed in this session/)
    if ((told && heedsAdvice) || refused) return bash('node --test', 'run tests with node')
    if (results.length >= 6) return { text: 'I could not run the tests.' }
    return bash('frobnicate test', 'run tests')
  }
}

test('baseline: without the plugin the run burns its retries and fails', async (t) => {
  const box = makeSandbox('baseline')
  t.after(box.cleanup)
  const run = await runDsh({ home: box.home, cwd: box.workspace('ws', FILES), task: 'run the tests', policy: testerPolicy(), rsi: false })
  assert.equal(run.code, 0)
  assert.equal(run.final.text, 'I could not run the tests.')
  assert.equal(run.agentRequests.length, 7)
  assert.equal(run.generatorRequests.length, 0)
})

test('adapts mid-turn, carries the adaptation into later sessions, and enforces it', async (t) => {
  const box = makeSandbox('adapt')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', FILES)
  const library = box.library()

  await t.test('session 1: two failures in, the harness changes and the same turn succeeds', async () => {
    const run = await runDsh({ home: box.home, cwd, task: 'run the tests', policy: testerPolicy(), rsi: { generator: 'synth' } })
    assert.equal(run.code, 0, run.stderr)
    assert.equal(run.final.text, 'Tests pass.')
    assert.equal(run.agentRequests.length, 4)
    assert.equal(run.generatorRequests.length, 0)

    // The third request is the first one after the adaptation: it carries the diagnosis.
    const notice = userTexts(run.agentRequests[2]).find(text => text.startsWith('[harness adaptation:'))
    assert.match(notice, /The harness adapted itself after noticing that bash failed 2 times with identical arguments\. `frobnicate` is not installed on this machine/)
    assert.equal(userTexts(run.agentRequests[1]).some(text => text.startsWith('[harness adaptation:')), false)

    // Model-visible means logged: the notice is a session event with its own source.
    const [session] = readSessions(box.home)
    const logged = session.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'dsh-rsi')
    assert.equal(logged.length, 1)
    assert.deepEqual([logged[0].data.source.form, logged[0].data.source.summary], ['notice', 'Stop retrying the missing command frobnicate'])
    assert.equal(session.events.filter(event => event.type === 'turn/start').length, 1)

    const [record] = library.list()
    assert.equal(record.status, 'candidate')
    assert.equal(record.friction.signature, 'bash:command-not-found:frobnicate')
    assert.deepEqual(record.scope, { kind: 'workspace', cwd })
    assert.deepEqual(record.validation.stages.map(stage => stage.stage), ['static', 'load', 'rehearsal', 'regression', 'policy'])
  })

  await t.test('session 2: the fact is in the harness prompt from the first request, and the mistake is not made', async () => {
    const run = await runDsh({ home: box.home, cwd, task: 'run the tests', policy: testerPolicy(), rsi: { generator: 'synth' } })
    assert.equal(run.final.text, 'Tests pass.')
    assert.equal(run.agentRequests.length, 2)
    assert.match(systemText(run.agentRequests[0]), /\[harness adaptation: Stop retrying the missing command frobnicate\] `frobnicate` is not installed on this machine\. Do not call it/)
    assert.equal(toolResults(run.agentRequests.at(-1)).some(result => /command not found/.test(result.text)), false)

    const [record] = library.list()
    assert.equal(library.list().length, 1)
    assert.equal(record.status, 'active')
    assert.deepEqual(recurrence(library.ledger(), record), {
      before: { sessions: 1, hit: 1, rate: 1, occurrences: 2 },
      after: { sessions: 1, hit: 0, rate: 0, occurrences: 0 },
    })
  })

  await t.test('session 3: a model that ignores the advice is stopped at the tool boundary', async () => {
    const run = await runDsh({ home: box.home, cwd, task: 'run the tests', policy: testerPolicy({ heedsAdvice: false, readsPrompt: false }), rsi: { generator: 'synth' } })
    assert.equal(run.final.text, 'Tests pass.')
    const results = toolResults(run.agentRequests.at(-1))
    assert.equal(results.length, 4)
    assert.match(results[0].text, /frobnicate: command not found/)
    assert.match(results[1].text, /frobnicate: command not found/)
    // Each failure was answered on the spot; this model did not listen.
    assert.equal(userTexts(run.agentRequests.at(-1)).filter(text => /^\[harness adaptation: [^\]]+\] `frobnicate` is not installed on this machine\. Do not retry it/.test(text)).length, 2)
    assert.match(results[2].text, /^Error: \[harness adaptation: Stop retrying the missing command frobnicate\] `frobnicate` is not installed on this machine and has already failed in this session/)
    assert.equal(results[2].isError, true)
    assert.match(results[3].text, /pass 1/)
    // The refusal is the harness acting, not a third occurrence of the friction.
    const [record] = library.list()
    assert.equal(recurrence(library.ledger(), record).after.sessions, 2)
    assert.equal(library.statsOf(record.id).effects.deny, 1)
  })

  await t.test('the command line shows what was learned and whether it helps', () => {
    const [record] = library.list()
    const status = rsiCli(box.home, 'status')
    assert.match(status, /sessions 3/)
    assert.match(status, new RegExp(`${record.id}\\s+active\\s+1\\s+machine\\s+ws\\s+\\d+\\s+0\\s+100% -> 50% \\(2\\)\\s+2\\.0 -> 1\\.0\\s+Stop retrying the missing command frobnicate`))
    const shown = rsiCli(box.home, 'show', record.id)
    assert.match(shown, /answers {7}bash:command-not-found:frobnicate/)
    assert.match(shown, /h\.beforeTool\(/)
    assert.match(rsiCli(box.home, 'log'), /generation\s+bash:command-not-found:frobnicate ok by synth after 1 attempt/)
  })

  await t.test('switched off by the user, it no longer mounts and is not learned again', async () => {
    const [record] = library.list()
    assert.match(rsiCli(box.home, 'disable', record.id), /disabled/)
    const run = await runDsh({ home: box.home, cwd, task: 'run the tests', policy: testerPolicy(), rsi: { generator: 'synth' } })
    assert.equal(run.final.text, 'I could not run the tests.')
    assert.equal(library.list({ signature: record.friction.signature }).length, 1)
    assert.equal(library.get(record.id).status, 'disabled')
    assert.equal(run.agentRequests.some(body => said(body, /Stop retrying the missing command/)), false)
    // The run of failures itself is a different cause, and the harness still answers that one.
    assert.deepEqual(library.list({ status: ['candidate', 'active'] }).map(entry => entry.friction.signature), ['session:stall'])
  })
})

const WRITTEN_BY_MODEL = `define({
  title: 'Point frobnicate at the node test runner',
  description: 'frobnicate does not exist on this machine; the project tests run with node --test.',
  capabilities: ['annotate', 'deny'],
  setup(h) {
    let failures = 0
    h.onToolResult({ command: /^frobnicate\\b/ }, (call, result) => {
      if (result.ok || !/command not found/.test(result.text)) return undefined
      failures += 1
      return h.annotate('frobnicate is not installed on this machine. This project runs its tests with: node --test')
    })
    h.beforeTool({ command: /^frobnicate\\b/ }, () => failures >= 1 ? h.deny('frobnicate is not installed on this machine and was not run. Use: node --test') : undefined)
  },
})`

test('the session model writes the adaptation; a rejected attempt is repaired from the gate\'s reasons', async (t) => {
  const box = makeSandbox('model')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', FILES)
  let attempt = 0
  const generator = () => {
    attempt += 1
    return { text: attempt === 1 ? fenced(`const os = require('os')\n${WRITTEN_BY_MODEL}`) : fenced(WRITTEN_BY_MODEL) }
  }
  const run = await runDsh({ home: box.home, cwd, task: 'run the tests', policy: testerPolicy({ generator }), rsi: { generator: 'model' } })
  assert.equal(run.final.text, 'Tests pass.', run.stderr)
  assert.equal(run.agentRequests.length, 4)

  // The generator is an ordinary request to the session's model: no tools, its own system prompt, the evidence as input.
  assert.equal(run.generatorRequests.length, 2)
  const [first, second] = run.generatorRequests
  assert.equal(first.model, run.agentRequests[0].model)
  assert.equal(first.tools === undefined || first.tools.length === 0, true)
  assert.match(userTexts(first).join('\n'), /Signature: bash:command-not-found:frobnicate[\s\S]*bash "frobnicate test" -> failed \(exit 127\)/)
  assert.match(userTexts(second).join('\n'), /rejected by the validation gate[\s\S]*require\(\) is not available to adaptations/)

  const [record] = box.library().list()
  assert.equal(record.origin.generator, 'model')
  assert.equal(record.title, 'Point frobnicate at the node test runner')
  const notice = userTexts(run.agentRequests[2]).find(text => text.startsWith('[harness adaptation:'))
  assert.match(notice, /This project runs its tests with: node --test/)
  // Generator traffic stays out of the conversation log.
  const [session] = readSessions(box.home)
  assert.equal(JSON.stringify(session.events).includes('You write harness adaptations'), false)
})

test('when the model cannot write a valid adaptation, the built-in template takes over in the same step', async (t) => {
  const box = makeSandbox('fallback')
  t.after(box.cleanup)
  const run = await runDsh({
    home: box.home, cwd: box.workspace('ws', FILES), task: 'run the tests',
    policy: testerPolicy({ generator: () => ({ text: 'Maybe try installing it?' }) }), rsi: { generator: 'model-then-synth', maxRepairs: 1 },
  })
  assert.equal(run.final.text, 'Tests pass.')
  assert.equal(run.generatorRequests.length, 2)
  assert.equal(run.agentRequests.length, 4)
  assert.equal(box.library().list()[0].origin.generator, 'synth')
})

test('a cause seen once in each of two earlier sessions is answered on first sight in the third', async (t) => {
  const box = makeSandbox('prior')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', FILES)
  // This model fixes its own mistake after one failure, so no single session ever reaches the threshold.
  const selfCorrecting = (body) => {
    const results = toolResults(body)
    if (results.some(result => /pass 1/.test(result.text))) return { text: 'Tests pass.' }
    return results.length === 0 ? bash('frobnicate test') : bash('node --test')
  }
  for (let index = 0; index < 2; index += 1) {
    const run = await runDsh({ home: box.home, cwd, task: 'run the tests', policy: selfCorrecting, rsi: { generator: 'synth' } })
    assert.equal(run.final.text, 'Tests pass.')
    assert.equal(box.library().list().length, 0)
  }
  const third = await runDsh({ home: box.home, cwd, task: 'run the tests', policy: selfCorrecting, rsi: { generator: 'synth' } })
  assert.equal(third.final.text, 'Tests pass.')
  const library = box.library()
  assert.equal(library.list().length, 1)
  assert.equal(library.list()[0].origin.priorSessions, 2)
  assert.ok(userTexts(third.agentRequests[1]).some(text => text.startsWith('[harness adaptation:')))
  // From now on the first failure is annotated on the spot.
  const fourth = await runDsh({ home: box.home, cwd, task: 'run the tests', policy: selfCorrecting, rsi: { generator: 'synth' } })
  assert.ok(userTexts(fourth.agentRequests[1]).some(text => /^\[harness adaptation: [^\]]+\] `frobnicate` is not installed/.test(text)))
})

test('met again in a second workspace, the adaptation becomes global instead of being learned twice', async (t) => {
  const box = makeSandbox('global')
  t.after(box.cleanup)
  const first = await runDsh({ home: box.home, cwd: box.workspace('alpha', FILES), task: 'run the tests', policy: testerPolicy(), rsi: { generator: 'synth' } })
  assert.equal(first.final.text, 'Tests pass.')
  const second = await runDsh({ home: box.home, cwd: box.workspace('beta', FILES), task: 'run the tests', policy: testerPolicy(), rsi: { generator: 'synth' } })
  assert.equal(second.final.text, 'Tests pass.')
  const library = box.library()
  assert.equal(library.list().length, 1)
  assert.deepEqual(library.list()[0].scope, { kind: 'global' })
  assert.ok(userTexts(second.agentRequests[2]).some(text => /learned in another workspace and now applies everywhere on this machine/.test(text)))

  // A third workspace has it before anything goes wrong.
  const third = await runDsh({ home: box.home, cwd: box.workspace('gamma', FILES), task: 'run the tests', policy: testerPolicy(), rsi: { generator: 'synth' } })
  assert.equal(third.agentRequests.length, 2)
  assert.match(systemText(third.agentRequests[0]), /`frobnicate` is not installed on this machine/)
})
