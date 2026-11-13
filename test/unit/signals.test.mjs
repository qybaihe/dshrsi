import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classify, commandFamily, commandHead, scrub, signatureOf, canonicalArgs } from '../../packages/dsh-rsi/src/signature.js'
import { createNormalizer, normalizeLog } from '../../packages/dsh-rsi/src/normalize.js'
import { createObserver, DETECTORS } from '../../packages/dsh-rsi/src/signals.js'

let seq = 0
const session = { sessionId: 's1', cwd: '/work' }

function toolEvents(name, args, text, { isError = false, error, turn = 1, step = 1 } = {}) {
  const callId = `c${seq += 1}`
  return [
    { type: 'tool/call', seq: seq += 1, time: seq, data: { turn, step, callId, name, arguments: JSON.stringify(args) } },
    { type: 'tool/result', seq: seq += 1, time: seq, data: { turn, step, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }], isError }, error } },
  ]
}
const bash = (command, text, options) => toolEvents('bash', { description: 'run', command }, text, options)
const failBash = (command, stderr, code = 1) => bash(command, `[stderr]\n${stderr}\n[exit code: ${code}]`)

function run(events, overrides, disabled) {
  const observer = createObserver(overrides, disabled)
  const findings = []
  for (const observation of normalizeLog(session, events)) findings.push(...observer.observe(observation))
  return { findings, observer }
}
const byDetector = (findings, id) => findings.filter(finding => finding.detector === id)

test('signature: command-not-found survives shell and platform differences', () => {
  for (const text of [
    'bash: npm: command not found',
    'zsh: command not found: npm',
    'sh: 1: npm: not found',
    "'npm' is not recognized as an internal or external command",
    'Error: spawn npm ENOENT',
    '/bin/sh: line 1: npm: command not found',
  ]) assert.deepEqual(classify(text), { category: 'command-not-found', key: 'npm' }, text)
})

test('signature: volatile detail does not change the signature', () => {
  const a = signatureOf({ tool: 'bash', text: "Error: Cannot find module '/Users/a/proj/node_modules/x/index.js'\n    at file:///Users/a/proj/run.js:12:7" })
  const b = signatureOf({ tool: 'bash', text: "Error: Cannot find module '/home/b/other/node_modules/x/index.js'\n    at file:///home/b/other/run.js:98:3" })
  assert.equal(a, b)
  assert.match(a, /^bash:module-not-found:/)
  assert.equal(scrub('failed at 2026-11-13T10:00:00Z id 3f2a9c1e-1111-2222-3333-444455556666'), 'failed at <time> id <id>')
})

test('signature: command head and family skip env assignments and wrappers', () => {
  assert.equal(commandHead('FOO=1 sudo /usr/local/bin/npm run build'), 'npm')
  assert.equal(commandFamily('FOO=1 npm run build'), 'npm run')
  assert.equal(commandFamily('ls -la'), 'ls')
  assert.equal(canonicalArgs({ b: 1, a: { d: 2, c: 3 } }), canonicalArgs({ a: { c: 3, d: 2 }, b: 1 }))
})

test('normalize: shell failure is read from the exit-code marker, not isError', () => {
  const [observation] = normalizeLog(session, failBash('npm test', 'bash: npm: command not found', 127))
  assert.equal(observation.kind, 'tool')
  assert.equal(observation.ok, false)
  assert.equal(observation.exitCode, 127)
  assert.equal(observation.signature, 'bash:command-not-found:npm')
  assert.equal(observation.verifying, true)
  const [fine] = normalizeLog(session, bash('echo hi', 'hi\n'))
  assert.equal(fine.ok, true)
  assert.equal(fine.signature, undefined)
})

test('normalize: deadline overrun and argument errors are recognised', () => {
  const [slow] = normalizeLog(session, bash('sleep 9', '[still running after 500ms; moved to background job bash-1]'))
  assert.equal(slow.backgrounded, true)
  const [bad] = normalizeLog(session, toolEvents('read', { path: 'a' }, 'Error: invalid arguments: missing required property "file_path"', { isError: true, error: { name: 'ToolArgsError', code: 'INVALID_ARGS' } }))
  assert.equal(bad.ok, false)
  assert.match(bad.signature, /^read:invalid-arguments:/)
})

test('normalize: a user message after an interrupted turn carries that fact', () => {
  const normalizer = createNormalizer(session)
  normalizer.push({ type: 'turn/start', seq: 1, data: { turn: 1 } })
  normalizer.push({ type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'aborted' } } })
  const [user] = normalizer.push({ type: 'user/message', seq: 3, data: { content: [{ type: 'text', text: 'use pnpm' }], source: { kind: 'user' } } })
  assert.equal(user.afterReason, 'aborted')
  const [context] = normalizer.push({ type: 'user/message', seq: 4, data: { content: [{ type: 'text', text: 'reminder' }], source: { kind: 'repeat-tool-reminder' } } })
  assert.equal(context.kind, 'context')
})

test('detector repeat-failing-call: fires at the second identical failure and resets on success', () => {
  const { findings } = run([...failBash('npm test', 'bash: npm: command not found', 127), ...failBash('npm test', 'bash: npm: command not found', 127)])
  const [hit] = byDetector(findings, 'repeat-failing-call')
  assert.equal(hit.kind, 'missing-command')
  assert.equal(hit.count, 2)
  assert.ok(hit.severity >= 0.6)
  assert.equal(hit.evidence.length, 2)
  const reset = run([...failBash('make', 'boom'), ...bash('make', 'ok'), ...failBash('make', 'boom')])
  assert.equal(byDetector(reset.findings, 'repeat-failing-call').length, 0)
})

test('detector failure-signature: one cause across different calls; weak on first sight', () => {
  const { findings } = run([...failBash('npm test', 'bash: npm: command not found', 127), ...failBash('npm run build', 'bash: npm: command not found', 127)])
  const hits = byDetector(findings, 'failure-signature')
  assert.equal(hits.length, 2)
  assert.ok(hits[0].severity < 0.6, 'first sighting is only a prior')
  assert.ok(hits[1].severity >= 0.6)
  assert.equal(hits[1].signature, 'bash:command-not-found:npm')
  assert.equal(hits[1].subject.key, 'npm')
})

test('detector command-flailing: three different failing variants of one command family', () => {
  const { findings } = run([...failBash('git push origin a', 'rejected'), ...failBash('git push origin b', 'rejected'), ...failBash('git push -f origin c', 'rejected')])
  const [hit] = byDetector(findings, 'command-flailing')
  assert.equal(hit.signature, 'bash:flailing:git push')
})

test('detector read-thrash: counts reads until the file is edited', () => {
  const read = () => toolEvents('read', { file_path: '/work/a.js' }, 'content')
  assert.equal(byDetector(run([...read(), ...read(), ...read(), ...read()]).findings, 'read-thrash').length, 1)
  const edited = [...read(), ...read(), ...read(), ...toolEvents('edit', { file_path: '/work/a.js', old_string: 'a', new_string: 'b' }, 'ok'), ...read()]
  assert.equal(byDetector(run(edited).findings, 'read-thrash').length, 0)
})

test('detector edit-churn, error-storm and stall', () => {
  const edit = () => toolEvents('edit', { file_path: '/work/a.js', old_string: 'a', new_string: 'b' }, 'ok')
  const churn = run([{ type: 'turn/start', seq: 0, data: { turn: 1 } }, ...edit(), ...edit(), ...edit(), ...edit(), ...edit()])
  assert.equal(byDetector(churn.findings, 'edit-churn').length, 1)
  const failures = Array.from({ length: 8 }, (_, index) => failBash(`cmd${index}`, `bad ${index}`)).flat()
  const storm = run(failures)
  assert.ok(byDetector(storm.findings, 'error-storm').length >= 1)
  assert.ok(byDetector(storm.findings, 'stall').length >= 1)
  assert.equal(byDetector(run([...failures.slice(0, 8), ...bash('ok', 'fine')]).findings, 'stall').length, 0)
})

test('detector timeout-recurrence and output-flood', () => {
  const slow = () => bash('pytest -x', '[still running after 60000ms; moved to background job bash-9]')
  assert.equal(byDetector(run([...slow(), ...slow()]).findings, 'timeout-recurrence')[0].signature, 'bash:slow:pytest')
  const big = () => bash('cat big.log', 'x'.repeat(30000))
  assert.equal(byDetector(run([...big(), ...big()]).findings, 'output-flood')[0].signature, 'bash:flood:cat')
})

test('detector approval-denied and denied-repeat', () => {
  const denied = command => toolEvents('bash', { description: 'x', command }, 'Error: denied: needs approval', { isError: true, error: { name: 'PolicyError', code: 'DENIED' } })
  const { findings } = run([...denied('rm -rf build'), ...denied('rm -rf dist')])
  assert.equal(byDetector(findings, 'approval-denied')[0].signature, 'bash:denied:rm')
  const repeat = run([...denied('rm -rf build'), ...denied('rm -rf build')])
  assert.equal(byDetector(repeat.findings, 'denied-repeat').length, 1)
})

test('detector user-correction: phrasing or an interrupt followed by redirection', () => {
  const events = [
    ...failBash('npm test', 'bash: npm: command not found', 127),
    { type: 'user/message', seq: 900, data: { content: [{ type: 'text', text: '不要用 npm，这个项目用 pnpm' }], source: { kind: 'user' } } },
  ]
  const [hit] = byDetector(run(events).findings, 'user-correction')
  assert.equal(hit.kind, 'user-correction')
  assert.match(hit.subject.instruction, /pnpm/)
  assert.equal(hit.evidence.at(-1).kind, 'user')
  const plain = [{ type: 'user/message', seq: 901, data: { content: [{ type: 'text', text: 'please add a README' }], source: { kind: 'user' } } }]
  assert.equal(byDetector(run(plain).findings, 'user-correction').length, 0)
  const english = [...bash('ls', 'a'), { type: 'user/message', seq: 902, data: { content: [{ type: 'text', text: "don't use yarn here, use pnpm" }], source: { kind: 'user' } } }]
  assert.equal(byDetector(run(english).findings, 'user-correction').length, 1)
})

test('detector user-interrupt and negative-feedback', () => {
  const interrupted = [...bash('npm run dev', 'listening'), { type: 'turn/end', seq: 950, data: { turn: 1, reason: { kind: 'aborted' } } }]
  assert.equal(byDetector(run(interrupted).findings, 'user-interrupt')[0].signature, 'user:interrupt:npm run')
  const feedback = [...bash('ls', 'a'), { type: 'feedback/message-put', seq: 951, data: { sessionId: 's1', item: { messageId: 'm1', rating: 'negative', category: 'instruction-following', note: 'too verbose' } } }]
  assert.equal(byDetector(run(feedback).findings, 'negative-feedback')[0].subject.instruction, 'too verbose')
})

test('detector premature-completion: edits with no check afterwards, at turn end and at the stop probe', () => {
  const edit = toolEvents('edit', { file_path: '/work/a.js', old_string: 'a', new_string: 'b' }, 'ok')
  const start = { type: 'turn/start', seq: 0, data: { turn: 1 } }
  const end = { type: 'turn/end', seq: 999, data: { turn: 1, reason: { kind: 'completed' } } }
  const unverified = run([start, ...edit, end])
  const [hit] = byDetector(unverified.findings, 'premature-completion')
  assert.deepEqual(hit.subject.paths, ['/work/a.js'])
  assert.equal(byDetector(run([start, ...edit, ...bash('npm test', 'ok'), end]).findings, 'premature-completion').length, 0)
  assert.equal(byDetector(run([start, ...bash('ls', 'a'), end]).findings, 'premature-completion').length, 0)
  const open = run([start, ...edit])
  assert.equal(open.observer.probeStop({ turn: 1 })[0].kind, 'premature-completion')
})

test('detector model-instability and context-pressure', () => {
  const retry = index => ({ type: 'llm/retry', seq: 800 + index, data: { turn: 1, failure: { code: 'RATE_LIMIT' } } })
  assert.equal(byDetector(run([retry(1), retry(2), retry(3)]).findings, 'model-instability').length, 1)
  assert.equal(byDetector(run([{ type: 'compaction/end', seq: 810, data: {} }]).findings, 'context-pressure').length, 1)
})

test('observer: detectors can be disabled and thresholds overridden', () => {
  const events = [...failBash('npm test', 'bash: npm: command not found', 127), ...failBash('npm test', 'bash: npm: command not found', 127)]
  assert.equal(byDetector(run(events, {}, ['repeat-failing-call']).findings, 'repeat-failing-call').length, 0)
  assert.equal(byDetector(run(events, { repeatFailure: 3 }).findings, 'repeat-failing-call').length, 0)
  assert.ok(DETECTORS.length >= 15, 'the detector catalogue stays broad')
  assert.equal(new Set(DETECTORS.map(detector => detector.id)).size, DETECTORS.length)
})

test('a missing program is a failure even when the command line hides the exit status', async () => {
  const { detect, log } = await import('../support/events.mjs')
  const notFound = '[stderr]\nbash: python: command not found\nexit: 127'
  const masked = detect(log().user('run').bash('python stats.py; echo "exit: $?"', notFound).bash('python stats.py || true', '[stderr]\nbash: python: command not found').events)
  assert.deepEqual(masked.observations.filter(entry => entry.kind === 'tool').map(entry => [entry.ok, entry.masked, entry.signature]), [
    [false, true, 'bash:command-not-found:python'],
    [false, true, 'bash:command-not-found:python'],
  ])
  assert.equal(masked.best('missing-command').count, 2)

  // The same words in output that is not about the command being run are just output.
  const quoted = detect(log().user('look').bash('cat build.log', 'step 4\nbash: python: command not found\nstep 5').bash('command -v python || echo "python: command not found"', 'python: command not found').events)
  assert.deepEqual(quoted.observations.filter(entry => entry.kind === 'tool').map(entry => entry.ok), [true, true])
  assert.equal(quoted.findings.length, 0)
})

test('running the code counts as checking it; looking at files does not', async () => {
  const { isVerifying } = await import('../../packages/dsh-rsi/src/normalize.js')
  for (const command of ['npm test', 'node --test', 'node -e "import(\'./calc.js\').then(m => console.log(m.mean([2, 4])))"', 'python3 stats.py', 'cd pkg && ./run.sh', 'FOO=1 cargo build', 'make', 'go vet ./...']) {
    assert.equal(isVerifying(command), true, command)
  }
  for (const command of ['ls -la', 'cat calc.js', 'git diff', 'git status && git log -1', 'echo done', 'grep -n mean calc.js | head -3', '', undefined]) {
    assert.equal(isVerifying(command), false, String(command))
  }
})
