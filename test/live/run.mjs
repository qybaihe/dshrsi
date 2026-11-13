// Live runs against a real model. Not part of `npm test`: needs MIMO_API_KEY.
//
//   MIMO_API_KEY=... node test/live/run.mjs <scenario> [--sessions N] [--off] [--keep] [--config '{"generator":"model"}']
//
// Each session is a separate `dsh --profile headless` process sharing one
// harness home, so what one session learns is all the next one starts with.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { summarize } from '../../packages/dsh-rsi/src/metrics.js'
import { normalizeLog } from '../../packages/dsh-rsi/src/normalize.js'
import { DEFAULT_POLICY } from '../../packages/dsh-rsi/src/trigger.js'
import { DSH_BIN, PLUGIN_DIR, childEnv, makeSandbox, readSessions } from '../support/harness.mjs'
import { SCENARIOS } from './scenarios.mjs'

const MODEL = process.env.MIMO_MODEL ?? 'mimo-v2.6-pro'

function overlay(rsi) {
  let text = `- id: session-log-deepseek
  disabled: true
- id: otel
  disabled: true
- id: session-telemetry-otel
  disabled: true
- id: session-title-llm
  disabled: true
- id: session-persistence-jsonl
  config:
    root: !!js dshHomePath('sessions')
    compression: none
- id: llm-pi-ai
  config:
    providers:
      mimo:
        displayName: Xiaomi MiMo
        apiKeyEnv: MIMO_API_KEY
        api: openai-completions
        baseURL: ${process.env.MIMO_BASE_URL ?? 'https://api.xiaomimimo.com/v1'}
        models:
          - id: ${MODEL}
            name: ${MODEL}
- id: agent-default-model
  config:
    provider: mimo
    model: ${MODEL}
`
  if (rsi) text += `- insert:\n    - id: dsh-rsi\n      name: ${JSON.stringify(path.join(PLUGIN_DIR, 'index.js'))}\n      config: ${JSON.stringify(rsi)}\n`
  return text
}

function runOnce({ home, cwd, task, rsi, args = [], timeoutMs = 600000 }) {
  const file = path.join(home, `overlay-${Date.now()}.yml`)
  fs.writeFileSync(file, overlay(rsi))
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(DSH_BIN, ['--profile', 'headless', '--patch', file, '--json', '--permission-mode', 'danger-full-access', ...args, task], { cwd, env: childEnv({ DSH_HOME: home }) })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      fs.rmSync(file, { force: true })
      const events = stdout.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
      resolve({ code, stderr, events, final: events.findLast(event => event.type === 'final'), seconds: Math.round((Date.now() - started) / 100) / 10 })
    })
  })
}

/** What one stored session shows: how many model steps, how many tool calls failed, what the harness said. */
function measure(session) {
  const observations = normalizeLog({ sessionId: session.header.id, cwd: session.header.cwd }, session.events)
  const tools = observations.filter(entry => entry.kind === 'tool')
  return {
    steps: session.events.filter(event => event.type === 'step/start').length,
    calls: tools.length,
    failed: tools.filter(entry => !entry.ok).length,
    refused: observations.filter(entry => entry.kind === 'adapted').length,
    commands: observations.filter(entry => entry.kind === 'tool' || entry.kind === 'adapted')
      .map(entry => (entry.kind === 'adapted'
        ? `HELD ${entry.tool} ${(entry.subject ?? '').slice(0, 70)}   <- answered by an adaptation instead`
        : `${entry.ok ? 'ok ' : 'ERR'} ${entry.tool} ${(entry.command ?? entry.path ?? '').slice(0, 70)}`)),
    notices: session.events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'dsh-rsi').map(event => event.data.content[0].text),
  }
}

const argv = process.argv.slice(2)
const flag = name => argv.includes(name)
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback)
const scenario = SCENARIOS[argv[0]]
if (!scenario) {
  console.error(`usage: node test/live/run.mjs <${Object.keys(SCENARIOS).join('|')}> [--sessions N] [--off] [--keep] [--config JSON]`)
  process.exit(2)
}
if (!process.env.MIMO_API_KEY) {
  console.error('MIMO_API_KEY is not set')
  process.exit(2)
}

const box = makeSandbox(`live-${argv[0]}`)
const rsi = flag('--off') ? false : { ...scenario.config, ...JSON.parse(option('--config', '{}')) }
const sessions = Number(option('--sessions', scenario.sessions ?? 3))
console.log(`scenario ${argv[0]} | model ${MODEL} | plugin ${rsi ? `on ${JSON.stringify(rsi)}` : 'off'} | ${sessions} session(s)\n`)

const rows = []
let previous
for (let index = 0; index < sessions; index += 1) {
  const turn = scenario.turn({ index, box, previous })
  const before = new Set(readSessions(box.home).map(entry => entry.file))
  const run = await runOnce({ home: box.home, cwd: turn.cwd, task: turn.task, rsi, args: turn.resume && previous ? ['--session-id', previous.final.sessionId] : [] })
  previous = run
  const all = readSessions(box.home)
  const session = all.find(entry => !before.has(entry.file)) ?? all.find(entry => entry.header.id === run.final?.sessionId)
  const seen = session ? measure(session) : { steps: 0, calls: 0, failed: 0, refused: 0, commands: [], notices: [] }
  const verdict = scenario.check ? scenario.check({ index, text: run.final?.text ?? '', cwd: turn.cwd }) : undefined
  rows.push({ session: index + 1, ...seen, seconds: run.seconds, verdict })
  console.log(`--- session ${index + 1}: ${JSON.stringify(turn.task)}`)
  for (const command of seen.commands) console.log(`    ${command}`)
  for (const notice of seen.notices) console.log(`    HARNESS> ${notice.slice(0, 400)}`)
  console.log(`    final: ${JSON.stringify((run.final?.text ?? '').slice(0, 300))}${verdict === undefined ? '' : `  [${verdict ? 'correct' : 'WRONG'}]`}`)
  if (run.code !== 0 || !run.final) console.log(`    exit ${run.code} stderr: ${run.stderr.slice(-800)}`)
  else if (/did not activate|dsh-rsi:/.test(run.stderr)) console.log(`    stderr: ${run.stderr.slice(-600)}`)
}

console.log('\nsession  steps  tool calls  failed  refused  seconds  result')
for (const row of rows) {
  console.log(`${String(row.session).padEnd(8)} ${String(row.steps).padEnd(6)} ${String(row.calls).padEnd(11)} ${String(row.failed).padEnd(7)} ${String(row.refused).padEnd(8)} ${String(row.seconds).padEnd(8)} ${row.verdict === undefined ? '' : row.verdict ? 'correct' : 'WRONG'}`)
}
if (rsi) {
  const library = box.library()
  const summary = summarize(library, DEFAULT_POLICY)
  console.log('\nlibrary:')
  for (const entry of summary.adaptations) {
    const { before, after } = entry.judgement.recurrence
    console.log(`  ${entry.id} ${entry.status} v${entry.version} [${entry.capabilities.join(', ')}] by ${entry.origin?.generator} | acted ${entry.stats.fires}x | second-hit ${before.hit}/${before.sessions} -> ${after.hit}/${after.sessions}\n    ${entry.title}\n    answers ${entry.friction?.signature}`)
    if (flag('--source')) console.log(library.readSource(entry.id).split('\n').map(line => `      ${line}`).join('\n'))
  }
  console.log('audit:', library.auditTrail().map(entry => `${entry.type}${entry.generator ? `(${entry.generator})` : ''}${entry.ok === false ? '(failed)' : ''}`).join(' > '))
  for (const entry of library.auditTrail().filter(item => item.type === 'generation')) {
    for (const attempt of entry.attempts ?? []) if (!attempt.ok) console.log(`  rejected ${attempt.generator} attempt: ${attempt.problems?.join(' | ').slice(0, 300)}`)
  }
}
if (flag('--keep')) console.log(`\nkept ${box.dir}`)
else box.cleanup()
