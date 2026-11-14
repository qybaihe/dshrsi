#!/usr/bin/env node
// Turns finished benchmark runs into numbers.
//
//   node bench/report.mjs [--write]
//
// Reads every run under the benchmark home, prints one table per benchmark,
// and with --write stores the summaries in bench/results/<benchmark>.json.
//
// Both arms are measured from the stored session logs by the same code, the
// plugin's own normalizer and failure classifier, so a "failed tool call"
// means the same thing with and without the plugin.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeLog } from '../packages/dsh-rsi/src/normalize.js'
import { readSession } from './lib/dsh.mjs'
import { BENCH_HOME, ROOT, paths } from './lib/env.mjs'
import { LANGUAGES } from './lib/polyglot.mjs'

const write = process.argv.includes('--write')
const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined)
const readRows = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [])
const round = (value, digits = 1) => Number(value.toFixed(digits))
const percent = (part, whole) => (whole === 0 ? 0 : round((100 * part) / whole))

/**
 * A failed call is either the work itself not being right yet (tests or the compiler say no) or the surroundings
 * getting in the way (a missing command, a path the sandbox refuses, an edit that did not apply). Only the second
 * kind is something a harness can learn its way out of.
 */
const WORK = new Set(['test-failure', 'syntax-error'])
const kindOf = signature => signature.split(':')[1] ?? 'other'

function failuresOf(home, row) {
  const session = readSession(home, row.sessionId)
  if (!session) return []
  return normalizeLog({ sessionId: session.header.id, cwd: session.header.cwd }, session.events)
    .filter(entry => entry.kind === 'tool' && !entry.ok)
    .map(entry => ({ signature: entry.signature ?? `${entry.tool}:other:`, kind: kindOf(entry.signature ?? '') }))
}

/**
 * What is written out is published. Workspace paths are cut down to the part inside the workspace, and nothing
 * keeps the name of the machine's home directory.
 */
function publishable(value) {
  if (typeof value === 'string') {
    return value
      .replace(new RegExp(`${paths.runs.replace(/[.*+?^${}()|[\]\\]/g, '\\const readLines = file =>')}/[\\w-]+/[\\w-]+/work/`, 'g'), '')
      .split(BENCH_HOME).join('<bench>')
      .split(os.homedir()).join('~')
  }
  if (Array.isArray(value)) return value.map(publishable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, publishable(entry)]))
  return value
}

const readLines = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [])
const passOf = run => Number(/p(\d+)$/.exec(run)?.[1] ?? 1)

/**
 * For each adaptation that reached the whole machine and acted: on the tasks whose session started after that moment,
 * in how many did the failure it answers occur, with the plugin and, on the very same tasks, without it.
 * Tasks before that moment are counted the same way, to show what the two arms looked like before anything was mounted.
 */
function effectsOf(rsi, stock) {
  const home = path.join(rsi.dir, 'home/rsi')
  const audit = readLines(path.join(home, 'audit.jsonl'))
  const started = new Map(readLines(path.join(home, 'ledger.jsonl')).filter(entry => entry.type === 'session').map(entry => [entry.sessionId, entry.time]))
  const twin = new Map(stock.rows.map(row => [row.id, row]))
  const effects = []
  for (const adaptation of rsi.library?.adaptations ?? []) {
    if (adaptation.scope !== 'global' || !(adaptation.fires > 0)) continue
    const moment = (audit.find(entry => entry.type === 'generalize' && entry.adaptationId === adaptation.id) ?? audit.find(entry => entry.type === 'create' && entry.adaptationId === adaptation.id))?.time
    if (!moment) continue
    const tally = (rows) => {
      const side = pick => ({ tasks: rows.length, hit: rows.filter(row => pick(row).some(signature => signature === adaptation.signature)).length, twice: rows.filter(row => pick(row).filter(signature => signature === adaptation.signature).length >= 2).length })
      // The same tasks on both sides, so the two are compared task by task.
      const has = list => list.some(signature => signature === adaptation.signature)
      const onlyStock = rows.filter(row => has(twin.get(row.id).every) && !has(row.every)).length
      const onlyPlugin = rows.filter(row => !has(twin.get(row.id).every) && has(row.every)).length
      return { rsi: side(row => row.every), dsh: side(row => twin.get(row.id).every), onlyStock, onlyPlugin, p: mcnemar(onlyStock, onlyPlugin) }
    }
    const paired = rsi.rows.filter(row => twin.has(row.id) && started.has(row.sessionId))
    effects.push({
      id: adaptation.id, title: adaptation.title, signature: adaptation.signature, capabilities: adaptation.capabilities, fires: adaptation.fires,
      before: tally(paired.filter(row => started.get(row.sessionId) <= moment)), after: tally(paired.filter(row => started.get(row.sessionId) > moment)),
    })
  }
  return effects
}

/** Exact two-sided McNemar test on the discordant pairs. */
function mcnemar(onlyA, onlyB) {
  const n = onlyA + onlyB
  if (n === 0) return 1
  let tail = 0
  let choose = 1
  for (let k = 0; k <= Math.min(onlyA, onlyB); k += 1) {
    if (k > 0) choose = (choose * (n - k + 1)) / k
    tail += choose
  }
  return Math.min(1, round((2 * tail) / 2 ** n, 4))
}

function paired(a, b, pick) {
  const other = new Map(b.rows.map(row => [row.id, row]))
  const counts = { both: 0, onlyA: 0, onlyB: 0, neither: 0 }
  for (const row of a.rows) {
    const twin = other.get(row.id)
    if (!twin) continue
    const x = pick(row)
    const y = pick(twin)
    counts[x && y ? 'both' : x ? 'onlyA' : y ? 'onlyB' : 'neither'] += 1
  }
  return { a: a.run, b: b.run, ...counts, p: mcnemar(counts.onlyA, counts.onlyB) }
}

function loadRun(bench, run) {
  const dir = path.join(paths.runs, bench, run)
  const meta = readJson(path.join(dir, 'meta.json'))
  if (!meta) return undefined
  const byId = new Map()
  for (const row of readRows(path.join(dir, 'results.jsonl'))) if (!row.infra) byId.set(row.id, row)
  const scores = readJson(path.join(dir, 'scores.json'))
  const home = path.join(dir, 'home')
  const rows = [...byId.values()].map((row) => {
    const agents = row.tries.map(entry => entry.agent).filter(Boolean)
    const sum = key => agents.reduce((total, agent) => total + (agent[key] ?? 0), 0)
    const failures = failuresOf(home, row)
    return {
      id: row.id, language: row.language, group: row.group, finishedAt: row.finishedAt, turns: agents.length,
      passed1: bench === 'polyglot' ? row.passed1 === true : undefined,
      passed2: bench === 'polyglot' ? row.passed2 === true : undefined,
      base: bench !== 'polyglot' ? scores?.[row.id]?.base === true : undefined,
      plus: bench !== 'polyglot' ? scores?.[row.id]?.plus === true : undefined,
      calls: sum('calls'), failed: failures.length, refused: sum('refused'), steps: sum('steps'), seconds: round(sum('seconds')),
      inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), notices: sum('notices'),
      friction: failures.filter(entry => !WORK.has(entry.kind)).length,
      signatures: failures.filter(entry => !WORK.has(entry.kind)).map(entry => entry.signature),
      kinds: failures.map(entry => entry.kind), every: failures.map(entry => entry.signature), sessionId: row.sessionId,
      agentTimedOut: agents.some(agent => agent.timedOut), testTimedOut: row.tries.some(entry => entry.testTimedOut),
    }
  })
  return { bench, run, dir, scored: bench === 'polyglot' || scores !== undefined, arm: meta.arm, libraryFrom: meta.libraryFrom, model: meta.model, startedAt: meta.startedAt, concurrency: meta.concurrency, rows, library: readJson(path.join(dir, 'library.json')) }
}

function summarize(loaded) {
  const { rows, bench } = loaded
  const total = key => rows.reduce((sum, row) => sum + (row[key] ?? 0), 0)
  const count = pick => rows.filter(pick).length
  const signatures = new Map()
  for (const row of rows) for (const signature of new Set(row.signatures)) signatures.set(signature, (signatures.get(signature) ?? 0) + 1)
  const byKind = {}
  for (const row of rows) for (const kind of row.kinds) byKind[kind] = (byKind[kind] ?? 0) + 1
  // The order tasks finished in is the order the harness met them: one fifth of the run per bucket.
  const ordered = [...rows].sort((x, y) => String(x.finishedAt).localeCompare(String(y.finishedAt)))
  const fifths = Array.from({ length: 5 }, (_, index) => ordered.slice(Math.floor((index * ordered.length) / 5), Math.floor(((index + 1) * ordered.length) / 5)))
  const summary = {
    run: loaded.run, scored: loaded.scored, arm: loaded.arm, libraryFrom: loaded.libraryFrom ?? null, model: loaded.model, startedAt: loaded.startedAt, concurrency: loaded.concurrency, tasks: rows.length,
    calls: total('calls'), failed: total('failed'), friction: total('friction'), refused: total('refused'), steps: total('steps'),
    agentSeconds: Math.round(total('seconds')), inputTokens: total('inputTokens'), outputTokens: total('outputTokens'),
    failedByKind: byKind, tasksWithFriction: count(row => row.friction > 0), agentTimeouts: count(row => row.agentTimedOut), testTimeouts: count(row => row.testTimedOut),
    frictionByFifth: fifths.map(part => ({ tasks: part.length, friction: part.reduce((sum, row) => sum + row.friction, 0), refused: part.reduce((sum, row) => sum + row.refused, 0) })),
    topFriction: [...signatures.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([signature, sessions]) => ({ signature, sessions })),
  }
  if (bench === 'polyglot') {
    summary.passed1 = count(row => row.passed1)
    summary.passed2 = count(row => row.passed2)
    summary.byLanguage = Object.fromEntries(LANGUAGES.map((language) => {
      const mine = rows.filter(row => row.language === language)
      return [language, { tasks: mine.length, passed1: mine.filter(row => row.passed1).length, passed2: mine.filter(row => row.passed2).length }]
    }))
  } else {
    summary.base = count(row => row.base)
    summary.plus = count(row => row.plus)
    const groups = [...new Set(rows.map(row => row.group).filter(Boolean))].sort()
    if (groups.length > 0) summary.byGroup = Object.fromEntries(groups.map(group => [group, { tasks: count(row => row.group === group), passed: count(row => row.group === group && row.base) }]))
  }
  if (loaded.library) summary.library = loaded.library
  return summary
}

const report = {}
const HEADS = { polyglot: ['first try', 'two tries'], humaneval: ['HumanEval', 'HumanEval+'], mbpp: ['MBPP', 'MBPP+'], livecodebench: ['pass@1', 'pass@1'] }
for (const bench of Object.keys(HEADS)) {
  const root = path.join(paths.runs, bench)
  if (!fs.existsSync(root)) continue
  const runs = fs.readdirSync(root).filter(name => !name.startsWith('pilot') && name !== 'validate').sort().map(name => loadRun(bench, name)).filter(Boolean).filter(run => run.rows.length > 0).sort((x, y) => String(y.model).localeCompare(String(x.model)) || x.run.localeCompare(y.run))
  if (runs.length === 0) continue
  const summaries = runs.map(summarize)
  for (const [index, run] of runs.entries()) {
    if (run.arm !== 'rsi') continue
    const stock = runs.find(other => other.arm === 'dsh' && other.model === run.model && passOf(other.run) === passOf(run.run))
    if (stock) summaries[index].effects = effectsOf(run, stock)
  }
  const pick = bench === 'polyglot' ? [['first try', row => row.passed1], ['within two tries', row => row.passed2]] : [[HEADS[bench][0], row => row.base], [HEADS[bench][1], row => row.plus]]
  // Only runs of the same model are compared with each other.
  const comparisons = []
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      if (runs[i].model !== runs[j].model) continue
      for (const [metric, choose] of pick) comparisons.push({ model: runs[i].model, metric, ...paired(runs[i], runs[j], choose) })
    }
  }
  report[bench] = publishable({ generatedAt: new Date().toISOString(), runs: summaries, comparisons, tasks: Object.fromEntries(runs.map(run => [run.run, run.rows.map(({ signatures, kinds, every, sessionId, ...row }) => row)])) })

  console.log(`\n## ${bench}\n`)
  const head = HEADS[bench]
  console.log(`| model | run | tasks | ${head[0]} | ${head[1]} | tool calls | failed | of which friction | tasks with friction | refused | steps | agent time | tokens in / out |`)
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const s of summaries) {
    const [x, y] = bench === 'polyglot' ? [s.passed1, s.passed2] : [s.base, s.plus]
    console.log(`| ${s.model} | ${s.run} | ${s.tasks} | ${x} (${percent(x, s.tasks)}%) | ${y} (${percent(y, s.tasks)}%) | ${s.calls} | ${s.failed} | ${s.friction} | ${s.tasksWithFriction} | ${s.refused} | ${s.steps} | ${round(s.agentSeconds / 3600, 2)} h | ${round(s.inputTokens / 1e6, 1)}M / ${round(s.outputTokens / 1e6, 2)}M |`)
  }
  if (bench === 'polyglot') {
    console.log(`\n| run | ${LANGUAGES.join(' | ')} |`)
    console.log(`|---|${LANGUAGES.map(() => '---').join('|')}|`)
    for (const s of summaries) console.log(`| ${s.run} | ${LANGUAGES.map(language => `${s.byLanguage[language].passed1} / ${s.byLanguage[language].passed2} of ${s.byLanguage[language].tasks}`).join(' | ')} |`)
  }
  if (summaries.some(s => s.byGroup)) for (const s of summaries) console.log(`  ${s.model} ${s.run}: ${Object.entries(s.byGroup ?? {}).map(([group, value]) => `${group} ${value.passed}/${value.tasks}`).join(' | ')}`)
  console.log('\nfriction per fifth of the run (in the order tasks finished):')
  for (const s of summaries) console.log(`  ${s.run.padEnd(10)} ${s.frictionByFifth.map(part => `${part.friction}${part.refused > 0 ? ` (+${part.refused} refused)` : ''}`).join('  ')}`)
  console.log('\npaired comparisons (same tasks): both | only first | only second | neither | exact McNemar p')
  for (const c of comparisons) console.log(`  ${c.model.padEnd(16)} ${c.metric.padEnd(17)} ${c.a} vs ${c.b}: ${c.both} | ${c.onlyA} | ${c.onlyB} | ${c.neither} | p=${c.p}`)
  for (const s of summaries) {
    for (const effect of s.effects ?? []) {
      const show = side => `${side.hit}/${side.tasks} (twice or more: ${side.twice})`
      console.log(`\neffect of "${effect.title}" [${effect.signature}] in ${s.run}: before it, stock ${show(effect.before.dsh)} vs plugin ${show(effect.before.rsi)}; after it, stock ${show(effect.after.dsh)} vs plugin ${show(effect.after.rsi)}, p=${effect.after.p}`)
    }
    console.log(`\ntop friction in ${s.run} (sessions it occurred in):`)
    for (const entry of s.topFriction.slice(0, 8)) console.log(`  ${String(entry.sessions).padStart(3)}  ${entry.signature.slice(0, 110)}`)
    if (s.library) {
      console.log(`library of ${s.run}: ${s.library.adaptations.length} adaptation(s), audit ${JSON.stringify(s.library.audit)}`)
      for (const entry of s.library.adaptations) console.log(`   ${entry.status.padEnd(11)} ${String(entry.scope).padEnd(9)} [${(entry.capabilities ?? []).join(', ')}] by ${entry.writtenBy} acted ${entry.fires ?? 0}x | ${entry.title} <- ${entry.signature}`)
    }
  }
  if (write) {
    const out = path.join(ROOT, 'bench/results')
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, `${bench}.json`), `${JSON.stringify(report[bench], null, 1)}\n`)
    console.log(`\nwrote bench/results/${bench}.json`)
  }
}

// The website reads the summaries (not the per-task rows) from a script file, so the page also works opened from disk.
// It shows one model; bench/results/*.json keeps every run of every model.
const SITE_MODEL = 'mimo-v2.6-flash'
if (write && Object.keys(report).length > 0) {
  const site = Object.fromEntries(Object.entries(report).map(([bench, { generatedAt, runs, comparisons }]) => [bench, {
    generatedAt, runs: runs.filter(run => run.model === SITE_MODEL), comparisons: comparisons.filter(entry => entry.model === SITE_MODEL),
  }]))
  fs.writeFileSync(path.join(ROOT, 'website/assets/bench-data.js'), `// Written by bench/report.mjs --write. Do not edit by hand.\nwindow.DSHRSI_BENCH = ${JSON.stringify(site, null, 1)}\n`)
  console.log('wrote website/assets/bench-data.js')
}
