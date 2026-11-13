import assert from 'node:assert/strict'
import test from 'node:test'
import { SYNTHESIZABLE, synthesize } from '../../packages/dsh-rsi/src/synth.js'
import { validateAdaptation } from '../../packages/dsh-rsi/src/validate.js'
import { detect, fails, log } from '../support/events.mjs'

const big = 'x'.repeat(25000)

/** For each friction kind: a session that shows it, as the harness would log it. */
const SCENARIOS = {
  'missing-command': () => log().user('test').bash('ls').bash('frobnicate test', fails('bash: frobnicate: command not found', 127)).bash('frobnicate test', fails('bash: frobnicate: command not found', 127)),
  'missing-dependency': () => log().user('run').bash('git status').bash('node app.js', fails("Error: Cannot find module 'left-pad'")).bash('node app.js', fails("Error: Cannot find module 'left-pad'")),
  'invalid-arguments': () => log().user('read').tool('read', { path: 'a.txt' }, { text: 'Error: invalid arguments: missing required property "file_path"', isError: true, code: 'INVALID_ARGS' })
    .tool('read', { path: 'a.txt' }, { text: 'Error: invalid arguments: missing required property "file_path"', isError: true, code: 'INVALID_ARGS' }),
  'edit-mismatch': () => log().user('edit').tool('read', { file_path: '/w/a.js' }).tool('edit', { file_path: '/w/a.js', old_string: 'x', new_string: 'y' }, { text: 'Error: old_string was not found in the file', isError: true })
    .tool('edit', { file_path: '/w/a.js', old_string: 'x', new_string: 'y' }, { text: 'Error: old_string was not found in the file', isError: true }),
  'repeated-failure': () => log().user('build').bash('ls').bash('make build', fails('make: *** [build] Error 2', 2)).bash('make build', fails('make: *** [build] Error 2', 2)),
  timeout: () => log().user('test').bash('ls').bash('npm test', '[still running after 500ms; moved to background job bash-1]').bash('npm test', '[still running after 500ms; moved to background job bash-2]'),
  'output-flood': () => log().user('logs').bash('ls').bash('cat build.log', big).bash('cat build.log', big),
  'read-thrash': () => {
    const run = log().user('look').bash('ls')
    for (let index = 0; index < 4; index += 1) run.tool('read', { file_path: '/w/a.js' }, 'contents')
    return run
  },
  'premature-completion': () => log().user('fix').tool('read', { file_path: '/w/a.js' }).tool('edit', { file_path: '/w/a.js', old_string: 'x', new_string: 'y' }).end(),
  'approval-denied': () => log().user('ship').bash('ls').bash('git push origin main', { text: 'Error: the user rejected tool "bash"', isError: true, code: 'APPROVAL_REJECTED' })
    .bash('git push --force', { text: 'Error: the user rejected tool "bash"', isError: true, code: 'APPROVAL_REJECTED' }),
  'denied-repeat': () => log().user('ship').bash('ls').bash('git push origin main', { text: 'Error: the user rejected tool "bash"', isError: true, code: 'APPROVAL_REJECTED' })
    .bash('git push origin main', { text: 'Error: the user rejected tool "bash"', isError: true, code: 'APPROVAL_REJECTED' }),
  flailing: () => log().user('image').bash('ls').bash('docker build .', fails('ERROR: failed to solve: a')).bash('docker build -t x .', fails('ERROR: failed to solve: b')).bash('docker build --no-cache .', fails('ERROR: failed to solve: c')),
  stall: () => {
    const run = log().user('go').bash('ls')
    for (const name of ['a', 'b', 'c', 'd', 'e']) run.bash(`./${name}.sh`, fails(`${name}: exploded`))
    return run
  },
  'error-storm': () => {
    const run = log().user('go')
    for (const name of ['a', 'b', 'c']) run.bash(`./${name}.sh`, fails(`${name}: exploded`))
    run.bash('ls')
    for (const name of ['d', 'e', 'f']) run.bash(`./${name}.sh`, fails(`${name}: exploded`))
    return run.bash('pwd')
  },
  'edit-churn': () => {
    const run = log().user('tweak').bash('ls')
    for (let index = 0; index < 5; index += 1) run.tool('edit', { file_path: '/w/a.js', old_string: `v${index}`, new_string: `v${index + 1}` })
    return run
  },
  'user-correction': () => log().user('add left-pad').bash('npm install left-pad').end().user("no, don't use npm here, always use pnpm"),
  'network-failure': () => log().user('fetch').bash('ls').bash('curl https://registry.internal/x', fails('curl: (6) Could not resolve host: registry.internal', 6)).bash('curl https://registry.internal/x', fails('curl: (6) Could not resolve host: registry.internal', 6)),
  'permission-failure': () => log().user('write').bash('ls').bash('touch /etc/demo.conf', fails('touch: /etc/demo.conf: Permission denied')).bash('touch /etc/demo.conf', fails('touch: /etc/demo.conf: Permission denied')),
  'port-conflict': () => log().user('serve').bash('ls').bash('node server.js', fails('Error: listen EADDRINUSE: address already in use :::3000')).bash('node server.js', fails('Error: listen EADDRINUSE: address already in use :::3000')),
  'missing-path': () => log().user('read').bash('ls').tool('read', { file_path: '/w/nope.txt' }, { text: "Error: ENOENT: no such file or directory, open '/w/nope.txt'", isError: true })
    .tool('read', { file_path: '/w/nope.txt' }, { text: "Error: ENOENT: no such file or directory, open '/w/nope.txt'", isError: true }),
  'resource-exhaustion': () => log().user('build').bash('ls').bash('node build.js', fails('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory', 134)).bash('node build.js', fails('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory', 134)),
  'negative-feedback': () => log().user('explain').bash('ls').assistant('Here is a very long answer.').raw('feedback/message-put', { sessionId: 's-test', item: { messageId: 'm1', rating: 'negative', category: 'instruction-following', note: 'Answers are too long; keep them under five lines.' } }),
}

test('every friction kind the synthesizer answers has a scenario here', () => {
  assert.deepEqual([...SYNTHESIZABLE].sort(), Object.keys(SCENARIOS).sort())
})

for (const kind of SYNTHESIZABLE) {
  test(`template for ${kind}: detected from a session log, and its adaptation passes the validation gate`, async () => {
    const { observations, best } = detect(SCENARIOS[kind]().events)
    const finding = best(kind)
    assert.ok(finding, `the detectors report a ${kind} finding`)
    assert.ok(finding.severity >= 0.6, `the ${kind} finding is actionable (severity ${finding.severity})`)
    const source = synthesize(finding)
    assert.equal(typeof source, 'string')
    const validation = await validateAdaptation({ source, finding, history: observations, env: { cwd: '/work/alpha', platform: 'linux' } })
    assert.deepEqual(validation.problems, [])
    assert.equal(validation.ok, true)
    assert.deepEqual(validation.needsApproval, [])
  })
}

for (const kind of ['missing-command', 'missing-dependency', 'repeated-failure', 'flailing']) {
  test(`stricter template for ${kind} passes the gate and differs from the first one`, async () => {
    const { observations, best } = detect(SCENARIOS[kind]().events)
    const finding = best(kind)
    const source = synthesize(finding, { stricter: true })
    assert.notEqual(source, synthesize(finding))
    const validation = await validateAdaptation({ source, finding, history: observations })
    assert.deepEqual(validation.problems, [])
    assert.ok(validation.meta.capabilities.includes('deny'))
  })
}

test('a kind without a template, or a finding without its subject, yields nothing', () => {
  assert.equal(synthesize({ kind: 'model-instability', subject: {} }), undefined)
  assert.equal(synthesize({ kind: 'missing-command', subject: {} }), undefined)
  assert.equal(synthesize({ kind: 'stall', subject: {} }, { stricter: true }), undefined)
})

test('text taken from the session cannot break out of the generated script', async () => {
  const hostile = "x'); h.exec('rm -rf /'); ('"
  const run = log().user('add left-pad').bash('npm install left-pad').end().user(`no, never do this: ${hostile} \`\${process.exit(1)}\``)
  const { observations, best } = detect(run.events)
  const finding = best('user-correction')
  const source = synthesize(finding)
  const validation = await validateAdaptation({ source, finding, history: observations })
  assert.deepEqual(validation.problems, [])
  assert.deepEqual(validation.meta.capabilities, ['prompt'])
  assert.ok(validation.registrations[0].text.includes(hostile))
})
