import assert from 'node:assert/strict'
import test from 'node:test'
import { GENERATOR_IDENTITY, buildRequest, extractSource, generateAdaptation } from '../../packages/dsh-rsi/src/generate.js'
import { synthesize } from '../../packages/dsh-rsi/src/synth.js'
import { detect, fails, log } from '../support/events.mjs'

function missingCommand() {
  const run = log().user('test').bash('ls').bash('frobnicate test', fails('bash: frobnicate: command not found', 127)).bash('frobnicate test', fails('bash: frobnicate: command not found', 127))
  const { observations, best } = detect(run.events)
  return { finding: best('missing-command'), history: observations }
}

const GOOD = `define({
  title: 'Say that frobnicate is missing',
  description: 'frobnicate is not installed here; say so when it fails.',
  capabilities: ['annotate'],
  setup(h) {
    h.onToolResult({ command: /frobnicate/ }, (call, result) => result.ok ? undefined : h.annotate('frobnicate is not installed; use node --test.'))
  },
})`
const fenced = source => `Here you go:\n\n\`\`\`javascript\n${source}\n\`\`\`\n`

test('request: the generator is told what happened, with the recorded evidence', () => {
  const { finding } = missingCommand()
  const request = buildRequest({ finding: { ...finding, priorSessions: 2 }, env: { cwd: '/work/alpha', platform: 'darwin' } })
  assert.ok(request.system.startsWith(GENERATOR_IDENTITY))
  assert.match(request.system, /h\.onToolResult\(filter/)
  assert.match(request.user, /Kind: missing-command/)
  assert.match(request.user, /Signature: bash:command-not-found:frobnicate/)
  assert.match(request.user, /Seen: 2 time\(s\) this session, and in 2 earlier session\(s\)/)
  assert.match(request.user, /Workspace: \/work\/alpha \(darwin\)/)
  assert.match(request.user, /1\. bash "frobnicate test" -> failed \(exit 127\)/)
  assert.match(request.user, /command not found/)
})

test('request: a revision shows the installed script; a repair shows the rejected one and why', () => {
  const { finding } = missingCommand()
  const revision = buildRequest({ finding, previous: { source: GOOD, recurrences: 3 } })
  assert.match(revision.user, /the trouble came back 3 more time\(s\)/)
  assert.ok(revision.user.includes(GOOD))
  const repair = buildRequest({ finding, attempts: [{ source: 'define({})', problems: ['define() needs setup(h)'] }] })
  assert.match(repair.user, /rejected by the validation gate/)
  assert.match(repair.user, /- define\(\) needs setup\(h\)/)
})

test('extractSource: fenced or bare scripts, and replies with no script', () => {
  assert.equal(extractSource(fenced(GOOD)), `${GOOD}\n`)
  assert.equal(extractSource(`\`\`\`js\n${GOOD}\n\`\`\``), `${GOOD}\n`)
  assert.equal(extractSource(GOOD), `${GOOD}\n`)
  assert.equal(extractSource('I would suggest installing npm.'), undefined)
  assert.equal(extractSource(undefined), undefined)
})

test('model strategy: a valid first reply is installed as written', async () => {
  const calls = []
  const result = await generateAdaptation({ ...missingCommand(), strategy: 'model', complete: async (request) => { calls.push(request); return fenced(GOOD) } })
  assert.equal(result.ok, true)
  assert.equal(result.generator, 'model')
  assert.equal(result.source, `${GOOD}\n`)
  assert.equal(calls.length, 1)
  assert.deepEqual(result.validation.report.stages.map(stage => stage.stage), ['static', 'load', 'rehearsal', 'regression', 'policy'])
})

test('repair loop: each rejection is fed back once, and the loop stops at maxRepairs', async () => {
  const replies = [
    'no script here',
    fenced(`const fs = require('fs')\n${GOOD}`),
    fenced(GOOD.replace('/frobnicate/', '/something-else/')),
    fenced(GOOD),
  ]
  const seen = []
  const run = maxRepairs => {
    let index = 0
    seen.length = 0
    return generateAdaptation({ ...missingCommand(), strategy: 'model', maxRepairs, complete: async (request) => { seen.push(request.user); return replies[index++] } })
  }

  const exhausted = await run(2)
  assert.equal(exhausted.ok, false)
  assert.deepEqual(exhausted.attempts.map(attempt => attempt.failedAt), [undefined, 'static', 'rehearsal'])
  assert.match(seen[1], /the reply contained no script calling define\(\)/)
  assert.match(seen[2], /require\(\) is not available/)
  assert.doesNotMatch(seen[2], /no script calling define/)

  const repaired = await run(3)
  assert.equal(repaired.ok, true)
  assert.equal(repaired.attempts.length, 4)
  assert.match(seen[3], /its filters or conditions do not match the evidence/)
})

test('fallback: with no usable model reply the template is used; with no model at all, directly', async () => {
  const fallback = await generateAdaptation({ ...missingCommand(), maxRepairs: 0, complete: async () => 'sorry' })
  assert.equal(fallback.generator, 'synth')
  assert.deepEqual(fallback.attempts.map(attempt => attempt.generator), ['model', 'synth'])

  const direct = await generateAdaptation({ ...missingCommand() })
  assert.equal(direct.generator, 'synth')
  assert.equal(direct.attempts.length, 1)

  const modelOnly = await generateAdaptation({ ...missingCommand(), strategy: 'model', maxRepairs: 0, complete: async () => 'sorry' })
  assert.equal(modelOnly.ok, false)
  assert.equal(modelOnly.source, undefined)
})

test('a kind with no template and no model produces nothing', async () => {
  const { history } = missingCommand()
  const result = await generateAdaptation({ finding: { kind: 'model-instability', signature: 'llm:retry:x', subject: {}, evidence: [] }, history })
  assert.equal(result.ok, false)
  assert.match(result.attempts[0].problems[0], /no template for friction kind "model-instability"/)
})

test('revision: the installed script is never reinstalled, and the template escalates', async () => {
  const { finding, history } = missingCommand()
  const installed = synthesize(finding)
  const same = await generateAdaptation({ finding, history, strategy: 'model', maxRepairs: 0, previous: { source: installed, recurrences: 2 }, complete: async () => fenced(installed) })
  assert.equal(same.ok, false)
  assert.match(same.attempts[0].problems[0], /already installed and did not help/)

  const escalated = await generateAdaptation({ finding, history, previous: { source: installed, recurrences: 2 } })
  assert.equal(escalated.ok, true)
  assert.deepEqual(escalated.validation.meta.capabilities, ['deny'])

  const none = await generateAdaptation({ finding: { ...finding, kind: 'timeout' }, history, previous: { source: installed, recurrences: 2 } })
  assert.equal(none.ok, false)
  assert.match(none.attempts[0].problems[0], /no stricter template/)
})

test('capabilities beyond the autonomy level are reported, not refused', async () => {
  const power = GOOD.replace("capabilities: ['annotate']", "capabilities: ['rewrite']").replace("h.annotate('frobnicate is not installed; use node --test.')", "h.replace('frobnicate is not installed; use node --test.')")
  const held = await generateAdaptation({ ...missingCommand(), strategy: 'model', complete: async () => fenced(power) })
  assert.equal(held.ok, true)
  assert.deepEqual(held.validation.needsApproval, ['rewrite'])
  assert.equal(held.validation.report.tier, 'power')
  const free = await generateAdaptation({ ...missingCommand(), strategy: 'model', autonomy: 'full', complete: async () => fenced(power) })
  assert.deepEqual(free.validation.needsApproval, [])
})

test('an adaptation that would refuse `command -v` on the missing program is sent back', async () => {
  const greedy = `define({
  title: 'Refuse frobnicate anywhere',
  description: 'frobnicate is not installed here; refuse any command line that mentions it.',
  capabilities: ['deny'],
  setup(h) {
    h.beforeTool({ command: /(^|\\s)frobnicate(\\s|$)/ }, () => h.deny('frobnicate is not installed on this machine.'))
  },
})`
  const precise = greedy.replace('/(^|\\s)frobnicate(\\s|$)/', '/(^|[;&|(]\\s*)frobnicate(\\s|$)/').replace('Refuse frobnicate anywhere', 'Refuse running frobnicate')
  const replies = [fenced(greedy), fenced(precise)]
  const seen = []
  const result = await generateAdaptation({ ...missingCommand(), strategy: 'model', complete: async (request) => { seen.push(request.user); return replies.shift() } })
  assert.equal(result.ok, true)
  assert.equal(result.attempts[0].failedAt, 'regression')
  assert.match(seen[1], /deny on `command -v frobnicate`, which only inspects the machine/)
  assert.equal(result.validation.meta.title, 'Refuse running frobnicate')
})
