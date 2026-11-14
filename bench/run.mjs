#!/usr/bin/env node
// Runs a benchmark through real `dsh` sessions, with or without the plugin.
//
//   node bench/run.mjs polyglot  --arm dsh|rsi --run <name> [--concurrency 8] [--only python,go] [--limit N] [--library-from <run>]
//   node bench/run.mjs humaneval --arm dsh|rsi --run <name> [--concurrency 8] [--limit N] [--library-from <run>]
//   node bench/run.mjs mbpp      --arm dsh|rsi --run <name> [--concurrency 8] [--limit N] [--library-from <run>]
//   node bench/run.mjs livecodebench --arm dsh|rsi --run <name> [--concurrency 8] [--limit N] [--library-from <run>]
//   node bench/run.mjs swebench  --arm dsh|rsi --run <name> [--concurrency 8] [--limit N] [--tasks id,id] [--subset mini]
//   node bench/run.mjs polyglot  --validate [--concurrency 6]      reference solutions through the scoring commands
//
// `dsh` is DeepSeek Harness as shipped; `rsi` is the same harness with the
// dsh-rsi plugin at its default settings. Model, prompts, sandbox, toolchains
// and task order are the same for both. BENCH_BASE_URL, BENCH_MODEL and BENCH_API_KEY name the model endpoint;
// without them it is Xiaomi MiMo, with MIMO_MODEL (default mimo-v2.6-pro) and MIMO_API_KEY.
//
// A run is resumable: finished tasks are in <run>/results.jsonl and are
// skipped. All sessions of a run share one harness home, so in the `rsi` arm
// what one session learns is there for every session that starts after it.
// `--library-from` starts a run with the adaptation library another run ended with,
// for a second visit to the same repositories.
//
// SWE-bench sessions are sealed (bench/lib/sealed.mjs): their runs are under the neutral root, not under the
// benchmark home, and the model endpoint has to be a loopback relay. The other suites run as they always did.
import fs from 'node:fs'
import path from 'node:path'
import { openLibrary } from '../packages/dsh-rsi/src/library.js'
import { summarize } from '../packages/dsh-rsi/src/metrics.js'
import { DEFAULT_POLICY } from '../packages/dsh-rsi/src/trigger.js'
import { API_KEY_ENV, BASE_URL, MODEL, measure, readSession, runTurn, stopAll } from './lib/dsh.mjs'
import { paths, pool, prepareCaches, shuffled } from './lib/env.mjs'
import { ensureIndex, indexUrl } from './lib/pypi-index.mjs'
import { DISK_REFUSAL, openSession, provideToolchains, sealed, visibleDir } from './lib/sealed.mjs'
import * as humaneval from './lib/humaneval.mjs'
import * as livecodebench from './lib/livecodebench.mjs'
import * as mbpp from './lib/mbpp.mjs'
import * as polyglot from './lib/polyglot.mjs'
import * as swebench from './lib/swebench.mjs'

const argv = process.argv.slice(2)
const flag = name => argv.includes(name)
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback)
const bench = argv[0]
const SUITES = { polyglot, humaneval, mbpp, livecodebench, swebench }
if (!Object.hasOwn(SUITES, bench)) {
  console.error('usage: node bench/run.mjs <polyglot|humaneval|mbpp|livecodebench|swebench> --arm dsh|rsi --run <name> [--concurrency N] [--only a,b] [--limit N] [--tasks id,id] [--subset mini] [--library-from <run>]\n       node bench/run.mjs polyglot --validate')
  process.exit(2)
}
const concurrency = Number(option('--concurrency', 8))
const stamp = () => new Date().toISOString().slice(11, 19)
const NOTHING = { steps: 0, calls: 0, failed: 0, refused: 0, notices: 0, inputTokens: 0, outputTokens: 0, failures: [], events: 0 }

prepareCaches()

if (flag('--validate')) {
  const tasks = polyglot.listTasks(option('--only', polyglot.LANGUAGES.join(',')).split(','))
  const root = path.join(paths.runs, 'polyglot', 'validate', 'work')
  const rows = await pool(tasks, concurrency, async (task) => {
    const workspace = path.join(root, task.language, task.name)
    polyglot.prepare(task, workspace)
    const stub = await polyglot.score(task, workspace)
    polyglot.applyReference(task, workspace)
    const reference = await polyglot.score(task, workspace)
    polyglot.tidy(workspace)
    console.log(`${stamp()} ${task.id.padEnd(40)} stub ${stub.passed ? 'PASSES' : 'fails '}  reference ${reference.passed ? 'passes' : 'FAILS '}  ${reference.seconds}s`)
    if (!reference.passed) console.log(reference.errors.split('\n').slice(-14).map(line => `      ${line}`).join('\n'))
    return { id: task.id, language: task.language, stub: stub.passed, reference: reference.passed }
  })
  for (const language of polyglot.LANGUAGES) {
    const mine = rows.filter(row => row.language === language)
    if (mine.length > 0) console.log(`${language.padEnd(11)} reference passes ${mine.filter(row => row.reference).length}/${mine.length}, untouched stub passes ${mine.filter(row => row.stub).length}/${mine.length}`)
  }
  fs.writeFileSync(path.join(paths.runs, 'polyglot', 'validate', 'validate.json'), JSON.stringify(rows, null, 1))
  process.exit(rows.every(row => row.reference) ? 0 : 1)
}

const arm = option('--arm')
const runName = option('--run')
if (!['dsh', 'rsi'].includes(arm) || !runName) {
  console.error('--arm dsh|rsi and --run <name> are required')
  process.exit(2)
}
if (!process.env[API_KEY_ENV]) {
  console.error(`${API_KEY_ENV} is not set`)
  process.exit(2)
}

const isSealed = bench === 'swebench'
const dir = path.join(isSealed ? sealed.runs : paths.runs, bench, runName)
const home = path.join(dir, 'home')
/** Where a sealed run's sessions work: a directory whose name says nothing about the run. */
const sessionsDir = isSealed ? visibleDir(bench, runName) : dir
const resultsFile = path.join(dir, 'results.jsonl')
fs.mkdirSync(home, { recursive: true })
const rsi = arm === 'rsi' ? JSON.parse(option('--config', '{}')) : false

// Two processes on one run would write the same workspaces and count tasks twice.
const lockFile = path.join(dir, 'lock')
const holder = fs.existsSync(lockFile) ? Number(fs.readFileSync(lockFile, 'utf8')) : 0
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
if (holder && holder !== process.pid && alive(holder)) {
  console.error(`run ${runName} is already being worked on by process ${holder}`)
  process.exit(3)
}
fs.writeFileSync(lockFile, String(process.pid))
process.on('exit', () => { try { if (Number(fs.readFileSync(lockFile, 'utf8')) === process.pid) fs.rmSync(lockFile) } catch { /* already gone */ } })
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { stopAll(); process.exit(130) })

const inherited = option('--library-from')
if (inherited && arm === 'rsi' && !fs.existsSync(path.join(home, 'rsi'))) {
  const from = path.join(paths.runs, bench, inherited, 'home/rsi')
  if (!fs.existsSync(from)) { console.error(`no library at ${from}`); process.exit(2) }
  fs.cpSync(from, path.join(home, 'rsi'), { recursive: true })
  // Adaptations start out scoped to the workspace they were learned in. The second pass visits the same
  // repositories again, so the workspace paths of the earlier run are mapped onto this run's.
  const before = `${path.join(paths.runs, bench, inherited)}/`
  const after = `${dir}/`
  for (const entry of fs.readdirSync(path.join(home, 'rsi'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = path.join(entry.parentPath, entry.name)
    const text = fs.readFileSync(file, 'utf8')
    if (text.includes(before)) fs.writeFileSync(file, text.split(before).join(after))
  }
}

const suite = SUITES[bench]
let tasks = bench === 'polyglot' ? polyglot.listTasks(option('--only', polyglot.LANGUAGES.join(',')).split(','))
  : bench === 'swebench' ? swebench.listTasks(option('--subset')) : suite.listTasks()
tasks = shuffled(tasks)
if (option('--tasks')) tasks = tasks.filter(task => option('--tasks').split(',').includes(task.id))
if (option('--limit')) tasks = tasks.slice(0, Number(option('--limit')))

const readRows = () => (fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [])
// A task whose session never reached the model (an API outage, not an answer) is run again.
const done = new Set(readRows().filter(row => !row.infra).map(row => row.id))
const todo = tasks.filter(task => !done.has(task.id))

// SWE-bench is scored elsewhere, from one line per answered task. The file is written anew from the result rows,
// so resuming a run never repeats a line, and a task that is run again has one line.
const predictionsFile = path.join(dir, 'predictions.jsonl')
const predictionLine = row => `${JSON.stringify(swebench.prediction(row, arm, MODEL))}\n`
const relay = new URL(BASE_URL)
if (bench === 'swebench') {
  // A sealed session's only way out is one loopback port; an endpoint elsewhere cannot be named in its profile.
  if (!['127.0.0.1', 'localhost'].includes(relay.hostname) || !relay.port) {
    console.error(`SWE-bench sessions reach the model through a loopback relay only (bench/lib/relay.mjs); BENCH_BASE_URL is ${relay.origin}`)
    process.exit(2)
  }
  provideToolchains()
  await ensureIndex()
  fs.writeFileSync(predictionsFile, [...new Map(readRows().filter(row => !row.infra).map(row => [row.id, row])).values()].map(predictionLine).join(''))
  // Checkouts and private directories of tasks a stopped run was in the middle of; those tasks start over.
  fs.rmSync(sessionsDir, { recursive: true, force: true })
}

const metaFile = path.join(dir, 'meta.json')
// A run belongs to one model; resuming it with another would mix two experiments in one result file.
if (fs.existsSync(metaFile) && JSON.parse(fs.readFileSync(metaFile, 'utf8')).model !== MODEL) {
  console.error(`run ${runName} was started with ${JSON.parse(fs.readFileSync(metaFile, 'utf8')).model}, not ${MODEL}`)
  process.exit(2)
}
if (!fs.existsSync(metaFile)) {
  fs.writeFileSync(metaFile, JSON.stringify({ bench, arm, run: runName, model: MODEL, rsi, libraryFrom: inherited ?? null, concurrency, tasks: tasks.length, startedAt: new Date().toISOString(), ...(isSealed ? { sealed: 1, sessionsIn: sessionsDir } : {}) }, null, 1))
}
console.log(`${stamp()} ${bench} | arm ${arm} | run ${runName} | model ${MODEL} | ${todo.length} of ${tasks.length} task(s) to run | concurrency ${concurrency}`)

/** DSH's own words for a provider that will not serve the request: no balance, no valid key, too many requests. */
const REFUSED = /dsh: (QUOTA|AUTH|RATE_LIMIT)\b/
/** DSH's words for a request the provider or the connection failed, after the harness's own retries. */
const TROUBLE = /dsh: (SERVER|TRANSPORT|TIMEOUT|STREAM_CLOSED|EMPTY_RESPONSE|MALFORMED_RESPONSE)\b/
let refusals = 0

/**
 * Whether the model endpoint serves a request right now: a one-token completion. An answer of any kind from the
 * provider counts, a refusal included (those have their own rule above); no connection, a relay that cannot reach
 * the provider, and a server error do not.
 */
async function endpointAnswers() {
  try {
    const reply = await fetch(`${BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env[API_KEY_ENV]}` },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
    })
    await reply.arrayBuffer()
    return reply.status < 500
  } catch {
    return false
  }
}

let waiting
/** Waits until the endpoint serves again, however long that takes. One probe loop serves every lane. */
function untilEndpointAnswers() {
  waiting ??= (async () => {
    const since = Date.now()
    console.error(`${stamp()} the model endpoint ${relay.origin} is not answering; waiting for it. Tasks that were running start over and lose no attempt.`)
    for (let probe = 1; ; probe += 1) {
      await new Promise(resolve => setTimeout(resolve, Math.min(15000 * probe, 60000)))
      if (await endpointAnswers()) break
      if (probe % 10 === 0) console.error(`${stamp()} still no answer from ${relay.origin} after ${Math.round((Date.now() - since) / 60000)} min`)
    }
    console.error(`${stamp()} the model endpoint answers again after ${Math.round((Date.now() - since) / 1000)}s; carrying on`)
    waiting = undefined
  })()
  return waiting
}

/**
 * One agent turn plus what its session log shows. A session that never reached the model, or that the provider
 * refused, is tried again; if it stays that way the task is not an answer, and it runs again when the run is resumed.
 *
 * With `session` (a sealed session), a turn that ended without an answer while the endpoint is not answering is an
 * outage, not an attempt: the caller waits for the endpoint and starts the task over. A turn the provider failed
 * in the middle of its work is `interrupted`: the caller starts it over too, from a fresh checkout.
 */
async function turn(workspace, prompt, sessionId, seen, session) {
  let last
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 15000 * attempt))
    const ran = await runTurn({ home, cwd: workspace, prompt, rsi, sessionId, sealed: session })
    const log = readSession(home, ran.sessionId)
    const measured = log ? measure(log, seen) : NOTHING
    const refused = ran.code !== 0 && REFUSED.test(ran.stderr)
    last = { code: ran.code, timedOut: ran.timedOut, seconds: ran.seconds, sessionId: ran.sessionId, answered: ran.text !== '', ...measured, attempts: attempt + 1, stderr: ran.code === 0 ? undefined : ran.stderr.slice(-300) }
    if (session && !refused && !ran.timedOut && (ran.code !== 0 || measured.steps === 0)) {
      if (!(await endpointAnswers())) return { ...last, outage: true }
      // The provider failed this session in the middle of its work although it serves again: its checkout is half done.
      if (measured.steps > 0 && TROUBLE.test(ran.stderr)) return { ...last, interrupted: true }
    }
    if (refused) {
      refusals += 1
      // Every session of the run is being turned away: going on would only mark the remaining tasks as not answered.
      if (refusals >= 8) {
        console.error(`${stamp()} the model provider keeps refusing requests (${ran.stderr.trim().slice(-160)}); stopping. Resume the run when it serves again.`)
        stopAll()
        process.exit(4)
      }
      continue
    }
    refusals = 0
    if (measured.steps > 0 || ran.timedOut) return last
  }
  return { ...last, infra: true }
}

let finished = 0
async function runPolyglot(task) {
  const workspace = path.join(dir, 'work', task.language, 'exercises/practice', task.name)
  suite.prepare(task, workspace)
  const tries = []
  let sessionId
  let seen = 0
  let prompt = suite.firstPrompt(task)
  let infra = false
  for (let index = 0; index < 2; index += 1) {
    const agent = await turn(workspace, prompt, sessionId, seen)
    sessionId = agent.sessionId ?? sessionId
    seen = agent.events
    if (agent.infra) { infra = true; tries.push({ passed: false, agent }); break }
    const scored = await suite.score(task, workspace)
    tries.push({ passed: scored.passed, testTimedOut: scored.timedOut, testSeconds: scored.seconds, agent })
    if (scored.passed) break
    prompt = suite.retryPrompt(task, scored.errors)
  }
  suite.tidy(workspace)
  return { id: task.id, language: task.language, sessionId, tries, passed1: tries[0]?.passed === true, passed2: tries.some(entry => entry.passed), infra }
}

async function runHumanEval(task) {
  const workspace = path.join(dir, 'work', task.name)
  suite.prepare(task, workspace)
  const agent = await turn(workspace, suite.firstPrompt(task), undefined, 0)
  return { id: task.id, group: task.group, sessionId: agent.sessionId, tries: [{ agent }], solution: suite.collect(workspace), infra: agent.infra === true }
}

/**
 * One turn on a checkout of the repository, in a sealed session; what the agent changed is the answer. Nothing is
 * scored here. A turn cut short by an outage of the model endpoint, or one whose commands were refused because the
 * disk reserve was reached, is not an answer: the first starts over once the endpoint serves again, the second is
 * left for the run to be resumed.
 */
async function runSwebench(task) {
  const workspace = path.join(sessionsDir, 'work', task.name)
  let outages = 0
  let interruptions = 0
  for (;;) {
    let session
    try {
      await suite.prepare(task, workspace)
      session = openSession({
        runDir: sessionsDir, home, name: task.name, workspace, relayPort: Number(relay.port), keyEnv: API_KEY_ENV,
        // The session can read its index address; the run is in it under the digest its directories are named by.
        indexUrl: indexUrl({ run: path.basename(sessionsDir), name: task.name, blocked: suite.blockedProjects(task) }), hidden: suite.hiddenPaths(task),
      })
      const agent = await turn(workspace, suite.firstPrompt(task), undefined, 0, session)
      if (agent.outage) {
        outages += 1
        await untilEndpointAnswers()
        continue
      }
      if (agent.interrupted && interruptions < 2) {
        interruptions += 1
        continue
      }
      const starved = session.refused() > 0
      const infra = agent.infra === true || agent.interrupted === true || starved
      const { patch, leftOut } = infra ? { patch: '', leftOut: 0 } : await suite.collect(task, workspace)
      return { id: task.id, repo: task.repo, sessionId: agent.sessionId, tries: [{ agent }], patch, patchBytes: Buffer.byteLength(patch), leftOut, commands: session.commands(), outages, interruptions, infra, ...(starved ? { error: DISK_REFUSAL } : {}) }
    } finally {
      await session?.close()
      suite.tidy(workspace)
    }
  }
}

await pool(todo, concurrency, async (task) => {
  let row
  try {
    row = bench === 'polyglot' ? await runPolyglot(task) : bench === 'swebench' ? await runSwebench(task) : await runHumanEval(task)
  } catch (error) {
    row = { id: task.id, language: task.language, tries: [], infra: true, error: String(error?.stack ?? error).slice(0, 600) }
  }
  fs.appendFileSync(resultsFile, `${JSON.stringify({ ...row, finishedAt: new Date().toISOString() })}\n`)
  if (bench === 'swebench' && !row.infra) fs.appendFileSync(predictionsFile, predictionLine(row))
  finished += 1
  const agents = row.tries.map(entry => entry.agent).filter(Boolean)
  const sum = key => agents.reduce((total, agent) => total + (agent[key] ?? 0), 0)
  const verdict = bench === 'polyglot' ? row.tries.map((entry, index) => `try${index + 1} ${entry.passed ? 'pass' : 'FAIL'}`).join(' ')
    : bench === 'swebench' ? (row.patchBytes > 0 ? `patch ${row.patchBytes} B` : 'no patch') : 'collected'
  console.log(`${stamp()} [${String(finished).padStart(3)}/${todo.length}] ${task.id.padEnd(38)} ${row.infra ? 'INFRA ' : ''}${verdict.padEnd(22)} ${String(Math.round(sum('seconds'))).padStart(4)}s steps ${String(sum('steps')).padStart(3)} failed ${sum('failed')} refused ${sum('refused')}${sum('notices') > 0 ? ` notices ${sum('notices')}` : ''}`)
})

const rows = [...new Map(readRows().map(row => [row.id, row])).values()].filter(row => tasks.some(task => task.id === row.id))
if (bench === 'swebench') {
  console.log(`${stamp()} swebench ${rows.filter(row => row.patchBytes > 0).length}/${rows.length} task(s) with a patch | not scored here; SWE-bench's evaluation takes ${predictionsFile}`)
} else if (bench !== 'polyglot') {
  const scored = suite.scoreAll(rows.map(row => ({ id: row.id, solution: row.solution ?? '' })), path.join(dir, 'evalplus'))
  fs.writeFileSync(path.join(dir, 'scores.json'), JSON.stringify(Object.fromEntries(scored), null, 1))
  const base = [...scored.values()].filter(entry => entry.base).length
  const plus = [...scored.values()].filter(entry => entry.plus).length
  console.log(`${stamp()} ${bench} base tests ${base}/${rows.length} | base + extra tests ${plus}/${rows.length}`)
} else {
  console.log(`${stamp()} first try ${rows.filter(row => row.passed1).length}/${rows.length} | within two tries ${rows.filter(row => row.passed2).length}/${rows.length}`)
}
const agentsOf = row => row.tries.map(entry => entry.agent).filter(Boolean)
const total = key => rows.reduce((all, row) => all + agentsOf(row).reduce((sum, agent) => sum + (agent[key] ?? 0), 0), 0)
console.log(`${stamp()} tool calls ${total('calls')} | failed ${total('failed')} | refused by an adaptation ${total('refused')} | model steps ${total('steps')} | infra failures ${rows.filter(row => row.infra).length}`)

if (arm === 'rsi' && fs.existsSync(path.join(home, 'rsi'))) {
  const library = openLibrary(path.join(home, 'rsi'))
  const summary = summarize(library, DEFAULT_POLICY)
  const audit = library.auditTrail()
  const counts = {}
  for (const entry of audit) counts[entry.type] = (counts[entry.type] ?? 0) + 1
  const adaptations = summary.adaptations.map(entry => ({
    id: entry.id, title: entry.title, status: entry.status, version: entry.version, layer: entry.layer, scope: entry.scope?.kind,
    capabilities: entry.capabilities, writtenBy: entry.origin?.generator, signature: entry.friction?.signature, kind: entry.friction?.kind,
    summary: entry.friction?.summary, fires: entry.stats?.fires, faults: entry.stats?.faults, recurrence: entry.judgement?.recurrence,
  }))
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ adaptations, audit: counts }, null, 1))
  console.log(`${stamp()} library: ${adaptations.length} adaptation(s) | audit ${JSON.stringify(counts)}`)
  for (const entry of adaptations) console.log(`    ${entry.status.padEnd(11)} ${String(entry.scope).padEnd(9)} [${(entry.capabilities ?? []).join(', ')}] by ${entry.writtenBy} | acted ${entry.fires ?? 0}x | ${entry.title}  <- ${entry.signature}`)
}
