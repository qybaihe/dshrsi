import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AdaptationError, compileAdaptation } from '../../packages/dsh-rsi/src/sandbox.js'
import { callView, matches, resultView, runPost, runPre, runStep, runStop, turnView } from '../../packages/dsh-rsi/src/runner.js'
import { staticCheck, validateAdaptation } from '../../packages/dsh-rsi/src/validate.js'

const NPM_TO_PNPM = `define({
  title: 'Point npm at pnpm on this machine',
  description: 'npm is not installed here; tell the model to use pnpm.',
  capabilities: ['annotate', 'deny'],
  setup(h) {
    h.onToolResult({ tool: 'bash', command: /\\bnpm\\b/ }, (call, result) => {
      if (/npm: command not found|command not found: npm/.test(result.text)) return h.annotate('npm is not installed on this machine. Use pnpm with the same subcommand.')
    })
    h.beforeTool({ tool: 'bash', command: /^\\s*npm\\b/ }, call => h.deny('npm is not installed on this machine. Run the same subcommand with pnpm.'))
  },
})`

const failing = { kind: 'tool', tool: 'bash', command: 'npm test', commandHead: 'npm', commandFamily: 'npm test', ok: false, exitCode: 127, text: '[stderr]\nbash: npm: command not found\n[exit code: 127]', args: { command: 'npm test' } }
const fine = { kind: 'tool', tool: 'bash', command: 'pnpm test', commandHead: 'pnpm', commandFamily: 'pnpm test', ok: true, text: 'ok', args: { command: 'pnpm test' } }
const finding = { kind: 'missing-command', signature: 'bash:command-not-found:npm', evidence: [failing, failing] }

function rejects(source, pattern, stage) {
  assert.throws(() => compileAdaptation(source), error => {
    assert.ok(error instanceof AdaptationError, `expected AdaptationError, got ${error}`)
    assert.match(error.message, pattern)
    if (stage) assert.equal(error.stage, stage)
    return true
  })
}

test('sandbox: compiles, exposes meta and registrations, and runs handlers', async () => {
  const compiled = compileAdaptation(NPM_TO_PNPM, { env: { cwd: '/work' } })
  assert.equal(compiled.meta.title, 'Point npm at pnpm on this machine')
  assert.deepEqual(compiled.meta.capabilities, ['annotate', 'deny'])
  assert.deepEqual(compiled.registrations.map(entry => entry.seam), ['onToolResult', 'beforeTool'])
  const post = await runPost(compiled, callView(failing), resultView(failing))
  assert.equal(post[0].type, 'annotate')
  assert.match(post[0].text, /pnpm/)
  assert.deepEqual(await runPost(compiled, callView(fine), resultView(fine)), [])
  assert.equal((await runPre(compiled, callView(failing)))[0].type, 'deny')
  assert.deepEqual(await runPre(compiled, callView(fine)), [])
})

test('sandbox: filters match by tool, command prefix or regex, path, or predicate', () => {
  const compiled = compileAdaptation(`define({ title: 't', description: 'd', capabilities: ['annotate'], setup(h) {
    h.onToolResult({ tool: ['read', 'edit'], path: /\\.lock$/ }, () => h.annotate('a'))
    h.onToolResult({ command: 'git push' }, () => h.annotate('b'))
    h.onToolResult(call => call.tool === 'grep', () => h.annotate('c'))
    h.onToolResult(() => undefined)
  } })`)
  const [byPath, byPrefix, byPredicate, all] = compiled.registrations
  assert.equal(matches(compiled, byPath, { tool: 'read', path: '/w/pnpm-lock.lock' }), true)
  assert.equal(matches(compiled, byPath, { tool: 'bash', path: '/w/pnpm-lock.lock' }), false)
  assert.equal(matches(compiled, byPrefix, { tool: 'bash', command: 'git push origin main' }), true)
  assert.equal(matches(compiled, byPrefix, { tool: 'bash', command: 'git pushx' }), false)
  assert.equal(matches(compiled, byPrefix, { tool: 'read', path: 'a' }), false)
  assert.equal(matches(compiled, byPredicate, { tool: 'grep' }), true)
  assert.equal(matches(compiled, all, { tool: 'anything' }), true)
})

test('sandbox: the realm has no host globals and cannot build code from strings', () => {
  const probe = name => compileAdaptation(`define({ title: typeof ${name}, description: 'd', capabilities: [], setup(h) { h.onToolResult(() => undefined) } })`).meta.title
  for (const name of ['process', 'require', 'fetch', 'setTimeout', 'Buffer', 'module', 'global']) assert.equal(probe(name), 'undefined', name)
  rejects(`define({ title: 't', description: 'd', capabilities: [], setup(h) { new Function('return 1')() } })`, /Code generation from strings disallowed|setup failed/)
  rejects(`const host = define.constructor('return this')(); define({ title: 't', description: 'd', capabilities: [], setup() {} })`, /disallowed|load failed/)
})

test('sandbox: values crossing into handlers are frozen realm data, not host objects', async () => {
  const compiled = compileAdaptation(`define({ title: 't', description: 'd', capabilities: ['annotate'], setup(h) {
    h.onToolResult((call, result) => {
      const own = Object.getPrototypeOf(call) === Object.prototype && Object.isFrozen(call) && Object.isFrozen(call.args)
      return h.annotate(own ? 'realm-owned' : 'host-leak')
    })
  } })`)
  const [effect] = await runPost(compiled, callView(failing), resultView(failing))
  assert.equal(effect.text, 'realm-owned')
})

test('sandbox: capability use is enforced where the effect is created', async () => {
  rejects(`define({ title: 't', description: 'd', capabilities: [], setup(h) { h.beforeStop(() => undefined) } })`, /needs capability "verify"/, 'setup')
  rejects(`define({ title: 't', description: 'd', capabilities: ['root'], setup() {} })`, /unknown capability "root"/, 'load')
  const compiled = compileAdaptation(`define({ title: 't', description: 'd', capabilities: [], setup(h) { h.onToolResult(() => h.annotate('x')) } })`)
  await assert.rejects(runPost(compiled, callView(failing), resultView(failing)), /needs capability "annotate"/)
})

test('sandbox: malformed scripts fail with a stage the generator can act on', () => {
  rejects('define({', /syntax error/, 'syntax')
  rejects('const x = 1', /never called define/, 'define')
  rejects(`define({ title: 't', setup() {} }); define({ title: 'u', setup() {} })`, /only once/, 'load')
  rejects(`define({ title: 't', description: 'd', capabilities: [], setup(h) { h.onToolResult({ nope: 1 }, () => undefined) } })`, /unknown filter field/, 'setup')
  rejects('for (;;) {}', /load failed/, 'load')
})

test('sandbox: handler faults and wrong return values surface as AdaptationError', async () => {
  const thrower = compileAdaptation(`define({ title: 't', description: 'd', capabilities: ['annotate'], setup(h) { h.onToolResult(() => { throw new Error('boom') }) } })`)
  await assert.rejects(runPost(thrower, callView(failing), resultView(failing)), /handler failed: boom/)
  const wrong = compileAdaptation(`define({ title: 't', description: 'd', capabilities: ['annotate', 'deny'], setup(h) {
    h.onToolResult(() => 'just text')
    h.beforeTool(() => h.annotate('wrong seam'))
  } })`)
  await assert.rejects(runPost(wrong, callView(failing), resultView(failing)), /not an effect/)
  await assert.rejects(runPre(wrong, callView(failing)), /not valid there/)
  const spinner = compileAdaptation(`define({ title: 't', description: 'd', capabilities: [], setup(h) { h.onToolResult(() => { for (;;) {} }) } })`, { syncTimeoutMs: 50 })
  await assert.rejects(runPost(spinner, callView(failing), resultView(failing)), /handler failed/)
  const sleeper = compileAdaptation(`define({ title: 't', description: 'd', capabilities: [], setup(h) { h.onToolResult(() => new Promise(() => {})) } })`, { asyncTimeoutMs: 40 })
  await assert.rejects(runPost(sleeper, callView(failing), resultView(failing)), /exceeded 40ms/)
})

test('sandbox: h.exec goes through the bridge and returns plain data', async () => {
  const seen = []
  const compiled = compileAdaptation(`define({ title: 't', description: 'd', capabilities: ['verify', 'exec'], setup(h) {
    h.beforeStop(async turn => {
      if (turn.edits.length === 0) return undefined
      const check = await h.exec('pnpm test', { timeoutMs: 1000 })
      if (!check.ok) return h.continueWith('Tests fail: ' + check.text)
    })
  } })`, { exec: async request => { seen.push(request); return { ok: false, exitCode: 1, text: '1 failing' } } })
  const turn = turnView([{ kind: 'tool', tool: 'edit', path: 'a.js', ok: true, mutating: true }])
  const [effect] = await runStop(compiled, turn)
  assert.equal(effect.type, 'continue')
  assert.match(effect.text, /1 failing/)
  assert.deepEqual(seen, [{ command: 'pnpm test', options: { timeoutMs: 1000 } }])
  assert.deepEqual(await runStop(compiled, turnView([])), [])
})

test('runner: turn view tracks edits and whether a check followed them', () => {
  const edit = { kind: 'tool', tool: 'edit', path: 'a.js', ok: true, mutating: true }
  const check = { kind: 'tool', tool: 'bash', command: 'pnpm test', ok: true, verifying: true }
  assert.equal(turnView([edit]).verifiedAfterEdits, false)
  assert.equal(turnView([edit, check]).verifiedAfterEdits, true)
  assert.equal(turnView([edit, check, edit]).verifiedAfterEdits, false)
  assert.deepEqual(turnView([edit, edit]).edits, ['a.js'])
})

test('runner: beforeStep handlers produce notes', async () => {
  const compiled = compileAdaptation(`define({ title: 't', description: 'd', capabilities: ['steer'], setup(h) {
    h.beforeStep(state => state.recent.filter(call => !call.ok).length >= 2 ? h.note('Two failures in a row: re-read the error before retrying.') : undefined)
  } })`)
  const bad = { tool: 'bash', ok: false, text: 'x' }
  assert.equal((await runStep(compiled, { turn: 1, step: 3, recent: [bad, bad] }))[0].type, 'note')
  assert.deepEqual(await runStep(compiled, { turn: 1, step: 3, recent: [] }), [])
})

test('validate: static check names what is forbidden and ignores comments', () => {
  assert.deepEqual(staticCheck(NPM_TO_PNPM), [])
  assert.match(staticCheck(`const fs = require('fs')`)[0], /require\(\)/)
  assert.match(staticCheck(`process.exit(1)`)[0], /process/)
  assert.match(staticCheck(`x.constructor.constructor('return 1')()`).join(), /constructor/)
  assert.deepEqual(staticCheck(`// process is mentioned only in a comment\n/* require( */\ndefine({})`), [])
  assert.match(staticCheck('x'.repeat(30000))[0], /limit/)
  assert.deepEqual(staticCheck(''), ['the adaptation source is empty'])
})

test('validate: accepts an adaptation that acts on the evidence and stays quiet otherwise', async () => {
  const result = await validateAdaptation({ source: NPM_TO_PNPM, finding, history: [fine, fine] })
  assert.equal(result.ok, true, result.problems.join('; '))
  assert.equal(result.meta.title, 'Point npm at pnpm on this machine')
  assert.deepEqual(result.needsApproval, [])
  const rehearsal = result.report.stages.find(stage => stage.stage === 'rehearsal')
  assert.ok(rehearsal.effects.length >= 2)
  assert.equal(result.report.tier, 'tighten')
})

test('validate: rejects an adaptation that does not touch the evidence', async () => {
  const source = NPM_TO_PNPM.replaceAll('npm', 'yarn').replace('Point yarn at pyarn', 'Point yarn at pnpm')
  const result = await validateAdaptation({ source, finding, history: [] })
  assert.equal(result.ok, false)
  assert.equal(result.report.failedAt, 'rehearsal')
  assert.match(result.problems[0], /did nothing/)
})

test('validate: rejects collateral damage on calls that had been fine', async () => {
  const greedy = `define({ title: 'Deny shell', description: 'd', capabilities: ['deny'], setup(h) { h.beforeTool({ tool: 'bash' }, () => h.deny('no shell')) } })`
  const result = await validateAdaptation({ source: greedy, finding, history: [fine] })
  assert.equal(result.ok, false)
  assert.equal(result.report.failedAt, 'regression')
  assert.match(result.problems[0], /deny on a call that had succeeded/)
  const chatty = `define({ title: 'Note', description: 'd', capabilities: ['annotate'], setup(h) { h.onToolResult(() => h.annotate('careful')) } })`
  const noisy = await validateAdaptation({ source: chatty, finding, history: [fine, fine, fine] })
  assert.equal(noisy.ok, false)
  assert.match(noisy.problems.join(), /annotated 3 of 3/)
})

test('validate: a verifier must stay quiet on verified and tool-free turns', async () => {
  const nag = `define({ title: 'Always continue', description: 'd', capabilities: ['verify'], setup(h) { h.beforeStop(() => h.continueWith('keep going')) } })`
  const result = await validateAdaptation({ source: nag, finding: { kind: 'premature-completion', evidence: [{ kind: 'tool', tool: 'edit', path: 'a.js', ok: true, mutating: true }] } })
  assert.equal(result.ok, false)
  assert.match(result.problems.join(), /made no tool calls|already verified/)
  const good = `define({ title: 'Run checks before finishing', description: 'd', capabilities: ['verify'], setup(h) {
    h.beforeStop(turn => turn.edits.length > 0 && !turn.verifiedAfterEdits ? h.continueWith('You edited ' + turn.edits.join(', ') + ' and ran no check. Run the tests before finishing.') : undefined)
  } })`
  const accepted = await validateAdaptation({ source: good, finding: { kind: 'premature-completion', evidence: [{ kind: 'tool', tool: 'edit', path: 'a.js', ok: true, mutating: true }] } })
  assert.equal(accepted.ok, true, accepted.problems.join('; '))
})

test('validate: power capabilities wait for approval unless autonomy is full; unused ones are refused', async () => {
  const rewrite = `define({ title: 'Trim noise', description: 'd', capabilities: ['rewrite'], setup(h) {
    h.onToolResult({ tool: 'bash', command: /npm/ }, (call, result) => result.ok ? undefined : h.replace('npm is missing; use pnpm'))
  } })`
  const gated = await validateAdaptation({ source: rewrite, finding, history: [fine] })
  assert.equal(gated.ok, true, gated.problems.join('; '))
  assert.deepEqual(gated.needsApproval, ['rewrite'])
  assert.equal(gated.report.tier, 'power')
  assert.deepEqual((await validateAdaptation({ source: rewrite, finding, history: [fine], autonomy: 'full' })).needsApproval, [])
  const padded = NPM_TO_PNPM.replace("['annotate', 'deny']", "['annotate', 'deny', 'exec']")
  const refused = await validateAdaptation({ source: padded, finding })
  assert.equal(refused.ok, false)
  assert.match(refused.problems[0], /"exec" is declared but never used/)
})

test('validate: load problems are reported together', async () => {
  const result = await validateAdaptation({ source: `define({ title: '', description: '', capabilities: [], setup() {} })`, finding })
  assert.equal(result.ok, false)
  assert.equal(result.problems.length, 3)
  const broken = await validateAdaptation({ source: 'define({', finding })
  assert.match(broken.problems[0], /syntax error/)
})
