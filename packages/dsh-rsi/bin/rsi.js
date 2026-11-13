#!/usr/bin/env node
// Inspect and steer what the harness has learned.
//
//   dsh-rsi status                  what was learned, and whether it helps
//   dsh-rsi show <id>               one adaptation: record, source, validation, counters
//   dsh-rsi approve <id>            let a proposed adaptation mount
//   dsh-rsi disable|enable <id>     switch an adaptation off or back on
//   dsh-rsi retire <id>             remove it for good (the cause is not re-learned)
//   dsh-rsi rollback <id>           restore the previous version of a revised adaptation
//   dsh-rsi scope <id> global|<dir> change where it applies
//   dsh-rsi log [-n 20]             decisions the system took
//   dsh-rsi mine <session.jsonl>    run the detectors over a stored session; --adapt proposes adaptations
//
//   dsh-rsi project [dir]           the project harness of a repository, and what this machine has accepted of it
//   dsh-rsi project init [dir]      start a project harness (<repository>/.dsh-rsi)
//   dsh-rsi project add <id> [dir]  write a learned adaptation into the project harness
//   dsh-rsi project remove <entry> [dir]
//   dsh-rsi trust [dir]             accept the project harness files as they are now, so they run on this machine
//   dsh-rsi untrust [dir]           withdraw that
//   dsh-rsi export [id...] [-o file] [--layer machine|user|project]   adaptations as a pack file
//   dsh-rsi import <file> [--scope global|<dir>] [--trust]            take a pack in (as proposals unless --trust)
//
// Options: --home <dir> (default <DSH home>/rsi), --json
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { generateAdaptation } from '../src/generate.js'
import { LAYERS, layerOfRecord } from '../src/layers.js'
import { openLibrary } from '../src/library.js'
import { judge, summarize } from '../src/metrics.js'
import { normalizeLog } from '../src/normalize.js'
import { exportPack, importPack } from '../src/pack.js'
import { PROJECT_DIR, findProject, initProject, portabilityProblems, projectRootFor, publishEntry, readProject, removeEntry } from '../src/project.js'
import { inspectAdaptation } from '../src/validate.js'
import { createObserver } from '../src/signals.js'
import { DEFAULT_POLICY } from '../src/trigger.js'

function parse(argv) {
  const options = { json: false, adapt: false, trust: false, tail: 20 }
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--adapt') options.adapt = true
    else if (arg === '--trust') options.trust = true
    else if (arg === '--home') options.home = argv[++index]
    else if (arg === '-o' || arg === '--out') options.out = argv[++index]
    else if (arg === '--layer') options.layer = argv[++index]
    else if (arg === '--scope') options.scope = argv[++index]
    else if (arg === '-n' || arg === '--tail') options.tail = Number(argv[++index])
    else if (arg === '-h' || arg === '--help') options.help = true
    else positional.push(arg)
  }
  return { options, command: positional[0] ?? 'status', args: positional.slice(1) }
}

const defaultHome = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'rsi')
const percent = rate => `${Math.round(rate * 100)}%`
const pad = (text, width) => String(text).padEnd(width).slice(0, Math.max(width, String(text).length))

function scopeLabel(scope) {
  return !scope || scope.kind === 'global' ? 'global' : path.basename(scope.cwd ?? '') || 'workspace'
}

function fail(message) {
  process.stderr.write(`dsh-rsi: ${message}\n`)
  process.exitCode = 1
}

function status(library, options) {
  const summary = summarize(library, DEFAULT_POLICY)
  if (options.json) return process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  const lines = [`library  ${library.home}`, `sessions ${summary.sessions}`, '']
  if (summary.adaptations.length === 0) lines.push('No adaptations yet.')
  else {
    lines.push(`${pad('ID', 20)} ${pad('STATUS', 11)} ${pad('V', 2)} ${pad('LAYER', 7)} ${pad('SCOPE', 14)} ${pad('FIRES', 5)} ${pad('FAULTS', 6)} ${pad('SECOND-HIT', 16)} ${pad('PER SESSION', 11)} TITLE`)
    for (const entry of summary.adaptations) {
      const { before, after } = entry.judgement.recurrence
      const perSession = side => (side.sessions === 0 ? 'n/a' : (side.occurrences / side.sessions).toFixed(1))
      const trend = `${percent(before.rate)} -> ${after.sessions === 0 ? 'n/a' : percent(after.rate)} (${after.sessions})`
      const load = `${perSession(before)} -> ${perSession(after)}`
      lines.push(`${pad(entry.id, 20)} ${pad(entry.status, 11)} ${pad(entry.version, 2)} ${pad(layerOfRecord(entry), 7)} ${pad(entry.project ? `${scopeLabel(entry.scope)} (repo)` : scopeLabel(entry.scope), 14)} ${pad(entry.stats.fires, 5)} ${pad(entry.stats.faults, 6)} ${pad(trend, 16)} ${pad(load, 11)} ${entry.title}`)
    }
    lines.push('', 'SECOND-HIT:  share of sessions in which the friction occurred, before -> after the adaptation (later sessions).',
      'PER SESSION: how often it occurred per session, before -> after.')
  }
  const open = summary.frictions.filter(entry => !entry.covered && entry.actionable > 0).slice(0, 8)
  if (open.length > 0) {
    lines.push('', 'Friction without an adaptation:')
    for (const entry of open) lines.push(`  ${pad(entry.signature, 48)} ${entry.actionable} hit(s) in ${entry.sessions} session(s)`)
  }
  const waiting = summary.adaptations.filter(entry => entry.status === 'proposed')
  if (waiting.length > 0) {
    lines.push('', 'Waiting for approval:')
    for (const entry of waiting) lines.push(`  dsh-rsi approve ${entry.id}   # ${entry.title} [${entry.capabilities.join(', ')}]`)
  }
  const root = findProject(process.cwd())
  if (root) {
    const entries = projectView(library, root).entries
    const pending = entries.filter(entry => entry.state !== 'accepted').length
    lines.push('', `Project harness: ${root} - ${entries.length} adaptation(s)${pending > 0 ? `, ${pending} not accepted on this machine (dsh-rsi project)` : ''}`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

/** A project harness as this machine sees it: each file, what it would do, and whether it is accepted here. */
function projectView(library, root) {
  const state = readProject(root)
  const linked = library.list().filter(record => record.project?.root === state.root)
  const entries = state.entries.map((entry) => {
    const inspected = inspectAdaptation(entry.source, { env: { cwd: state.root, platform: process.platform } })
    const record = linked.find(item => item.project.entry === entry.id)
    const accepted = library.trusted(state.root, entry.id, entry.hash)
    return {
      id: entry.id,
      file: path.relative(state.root, entry.file),
      title: inspected.ok ? inspected.meta.title : undefined,
      capabilities: inspected.ok ? inspected.meta.capabilities : [],
      tier: inspected.tier,
      problems: inspected.problems,
      answers: entry.header?.summary,
      state: !inspected.ok ? 'invalid' : accepted ? 'accepted' : record ? 'changed' : 'new',
      adaptationId: record?.id,
      status: record?.status,
    }
  })
  return { root: state.root, settings: state.settings, problems: state.problems, entries }
}

function project(library, args, options) {
  const [verb, ...rest] = ['init', 'add', 'remove', 'status'].includes(args[0]) ? args : ['status', ...args]
  if (verb === 'init') {
    const root = projectRootFor(rest[0] ?? process.cwd())
    const dir = initProject(root)
    process.stdout.write(`project harness at ${dir}\nAdaptations of the project layer that prove themselves here are written into it. Commit it to share them.\n`)
    return
  }
  if (verb === 'add') {
    const record = library.get(rest[0])
    if (!record) return fail(`no adaptation ${rest[0]}`)
    const root = findProject(rest[1] ?? (record.scope?.kind === 'workspace' ? record.scope.cwd : process.cwd())) ?? findProject(process.cwd())
    if (!root) return fail('no project harness here; run "dsh-rsi project init" in the repository first')
    const source = library.readSource(record.id)
    const published = publishEntry(root, { record, source, entryId: record.project?.entry })
    library.trust(root, published.id, published.hash)
    library.update(record.id, { layer: 'project', scope: { kind: 'workspace', cwd: root }, project: { root, entry: published.id, hash: published.hash, version: record.version } })
    library.audit({ type: 'publish', adaptationId: record.id, version: record.version, root, entry: published.id, by: 'user' })
    process.stdout.write(`${published.replaced ? 'updated' : 'added'} ${path.relative(root, published.file)}  ${record.title}\n`)
    for (const problem of portabilityProblems(source, root)) process.stdout.write(`  note: ${problem}\n`)
    return
  }
  const root = findProject(rest[verb === 'remove' ? 1 : 0] ?? process.cwd())
  if (!root) return fail('no project harness here; run "dsh-rsi project init" in the repository first')
  if (verb === 'remove') {
    if (!removeEntry(root, rest[0])) return fail(`no adaptation file "${rest[0]}" in ${path.join(root, PROJECT_DIR, 'adaptations')}`)
    library.untrust(root, rest[0])
    process.stdout.write(`removed ${rest[0]}; sessions in this repository drop it from their next start\n`)
    return
  }
  const view = projectView(library, root)
  if (options.json) return process.stdout.write(`${JSON.stringify(view, null, 2)}\n`)
  const lines = [`project harness  ${path.join(view.root, PROJECT_DIR)}`]
  if (Object.keys(view.settings).length > 0) lines.push(`settings         ${JSON.stringify(view.settings)}`)
  for (const problem of view.problems) lines.push(`problem          ${problem}`)
  lines.push('')
  if (view.entries.length === 0) lines.push('No adaptations yet.')
  else {
    lines.push(`${pad('FILE', 44)} ${pad('ON THIS MACHINE', 16)} ${pad('CAPABILITIES', 22)} TITLE`)
    for (const entry of view.entries) {
      const here = entry.state === 'accepted' ? (entry.status ? `runs (${entry.status})` : 'accepted') : entry.state === 'changed' ? 'changed, old runs' : entry.state === 'new' ? 'not accepted' : 'invalid'
      lines.push(`${pad(`${entry.id}.js`, 44)} ${pad(here, 16)} ${pad(entry.capabilities.join(', '), 22)} ${entry.title ?? entry.problems[0]}`)
    }
    if (view.entries.some(entry => entry.state === 'new' || entry.state === 'changed')) {
      lines.push('', 'Files that are not accepted do not run here. Read them, then: dsh-rsi trust')
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

function trust(library, command, args) {
  const root = findProject(args[0] ?? process.cwd())
  if (!root) return fail('no project harness here')
  if (command === 'untrust') {
    library.untrust(root)
    library.audit({ type: 'untrust', root })
    process.stdout.write(`${root}: nothing from this project harness is accepted any more; sessions there stop running it from their next start\n`)
    return
  }
  const view = projectView(library, root)
  const state = readProject(root)
  let accepted = 0
  for (const entry of view.entries) {
    if (entry.state === 'invalid') {
      process.stdout.write(`  skipped   ${entry.id}.js  ${entry.problems[0]}\n`)
      continue
    }
    if (entry.state !== 'accepted') {
      library.trust(root, entry.id, state.entries.find(item => item.id === entry.id).hash)
      accepted += 1
    }
    process.stdout.write(`  ${entry.state === 'accepted' ? 'unchanged' : 'accepted '} ${entry.id}.js  [${entry.capabilities.join(', ')}]  ${entry.title}\n`)
  }
  library.audit({ type: 'trust', root, accepted })
  process.stdout.write(`${accepted} file(s) accepted; they run from the next session started in ${root}\n`)
}

function pack(library, command, args, options) {
  if (command === 'export') {
    if (options.layer !== undefined && !LAYERS.includes(options.layer)) return fail(`--layer must be one of ${LAYERS.join(', ')}`)
    let bundle
    try {
      bundle = exportPack(library, { ids: args, layer: options.layer })
    } catch (error) {
      return fail(error.message)
    }
    const text = `${JSON.stringify(bundle, null, 2)}\n`
    if (!options.out) return process.stdout.write(text)
    fs.writeFileSync(options.out, text)
    process.stdout.write(`${bundle.adaptations.length} adaptation(s) written to ${options.out}\n`)
    return
  }
  if (!args[0] || !fs.existsSync(args[0])) return fail(`no pack file at ${args[0]}`)
  let results
  try {
    const scope = options.scope === undefined ? undefined : options.scope === 'global' ? { kind: 'global' } : { kind: 'workspace', cwd: path.resolve(options.scope) }
    results = importPack(library, JSON.parse(fs.readFileSync(args[0], 'utf8')), { scope, trust: options.trust })
  } catch (error) {
    return fail(error.message)
  }
  if (options.json) return process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
  for (const result of results) {
    process.stdout.write(result.imported
      ? `  ${result.status === 'proposed' ? `proposed  ${result.title}\n            dsh-rsi approve ${result.id}` : `imported  ${result.id}  ${result.title}`}\n`
      : `  skipped   ${result.title ?? '(untitled)'}: ${result.reason}\n`)
  }
}

function show(library, id, options) {
  const record = library.get(id)
  if (!record) return fail(`no adaptation ${id}`)
  const ledger = library.ledger()
  const stats = library.statsOf(id, ledger)
  const judgement = judge(ledger, record, stats, DEFAULT_POLICY)
  const source = library.readSource(id)
  if (options.json) return process.stdout.write(`${JSON.stringify({ ...record, stats, judgement, source }, null, 2)}\n`)
  const lines = [
    `${record.title}`,
    `  ${record.description}`,
    '',
    `id            ${record.id} (version ${record.version})`,
    `status        ${record.status}${record.statusReason ? ` - ${record.statusReason}` : ''}`,
    `scope         ${record.scope?.kind === 'global' ? 'global' : record.scope?.cwd}`,
    `capabilities  ${record.capabilities.join(', ')} (${record.tier})`,
    `answers       ${record.friction?.signature} - ${record.friction?.summary}`,
    `written by    ${record.origin?.generator} in session ${record.origin?.sessionId}`,
    `counters      mounted ${stats.mounts}x in ${stats.sessions} session(s), acted ${stats.fires}x, faults ${stats.faults}`,
    `verdict       ${judgement.verdict} - ${judgement.reason}`,
    '',
    source.trimEnd(),
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}

function change(library, action, id, extra) {
  const record = library.get(id)
  if (!record) return fail(`no adaptation ${id}`)
  let next
  try {
    if (action === 'approve') next = library.approve(id)
    else if (action === 'disable') next = library.setStatus(id, 'disabled', 'switched off by the user')
    else if (action === 'enable') {
      if (!['disabled', 'quarantined'].includes(record.status)) return fail(`adaptation ${id} is ${record.status}; only disabled or quarantined adaptations can be enabled`)
      next = library.setStatus(id, 'candidate', 'switched on by the user')
    } else if (action === 'retire') next = library.setStatus(id, 'retired', 'retired by the user')
    else if (action === 'rollback') next = library.rollback(id)
    else if (action === 'scope') {
      if (!extra) return fail('scope needs "global" or a directory')
      next = library.setScope(id, extra === 'global' ? { kind: 'global' } : { kind: 'workspace', cwd: path.resolve(extra) })
    }
  } catch (error) {
    return fail(error.message)
  }
  library.audit({ type: 'user', action, adaptationId: id, from: record.status, to: next.status })
  process.stdout.write(`${next.id}  ${next.status}  v${next.version}  ${next.title}\n`)
}

function log(library, options) {
  const trail = library.auditTrail().slice(-options.tail)
  if (options.json) return process.stdout.write(`${JSON.stringify(trail, null, 2)}\n`)
  for (const entry of trail) {
    const when = new Date(entry.time).toISOString().replace('T', ' ').slice(0, 19)
    const detail = entry.type === 'trigger' ? `${entry.signature} (${entry.mode}; ${entry.reason})`
      : entry.type === 'generation' ? `${entry.signature} ${entry.ok ? `ok by ${entry.generator}` : 'failed'} after ${entry.attempts?.length ?? 0} attempt(s)`
        : `${entry.adaptationId ?? entry.signature ?? ''} ${entry.from ? `${entry.from} -> ${entry.to}` : ''} ${entry.reason ?? ''}`
    process.stdout.write(`${when}  ${pad(entry.type, 11)} ${detail.trim()}\n`)
  }
}

async function mine(library, file, options) {
  if (!file || !fs.existsSync(file)) return fail(`no session log at ${file}`)
  const raw = file.endsWith('.zstd') ? zlib.zstdDecompressSync(fs.readFileSync(file)).toString() : fs.readFileSync(file, 'utf8')
  const lines = raw.split('\n').filter(Boolean).map(line => JSON.parse(line))
  const header = lines[0]?.type === 'session' ? lines.shift() : {}
  const session = { sessionId: header.id ?? path.basename(path.dirname(file)), cwd: header.cwd ?? process.cwd() }
  const observations = normalizeLog(session, lines)
  const observer = createObserver()
  const best = new Map()
  for (const observation of observations) {
    for (const finding of observer.observe(observation)) {
      const held = best.get(finding.signature)
      if (!held || finding.severity >= held.severity) best.set(finding.signature, finding)
    }
  }
  const findings = [...best.values()].sort((a, b) => b.severity - a.severity)
  const proposed = []
  if (options.adapt) {
    const known = new Set(library.list().map(record => record.friction?.signature))
    for (const finding of findings.filter(entry => entry.severity >= DEFAULT_POLICY.threshold && !known.has(entry.signature))) {
      const result = await generateAdaptation({ finding, history: observations, strategy: 'synth', env: { cwd: session.cwd, platform: process.platform } })
      if (!result.ok) continue
      const { meta, report } = result.validation
      const record = library.create({
        title: meta.title, description: meta.description, capabilities: meta.capabilities, tier: report.tier, status: 'proposed', validation: report,
        scope: { kind: 'workspace', cwd: session.cwd },
        friction: { signature: finding.signature, kind: finding.kind, detector: finding.detector, summary: finding.summary },
        origin: { sessionId: session.sessionId, cwd: session.cwd, generator: 'synth', mined: true, severity: finding.severity, evidence: finding.evidence },
      }, result.source)
      library.audit({ type: 'create', adaptationId: record.id, version: 1, status: 'proposed', sessionId: session.sessionId, signature: finding.signature, generator: 'synth', mined: true })
      proposed.push(record)
    }
  }
  if (options.json) return process.stdout.write(`${JSON.stringify({ session, observations: observations.length, findings, proposed }, null, 2)}\n`)
  process.stdout.write(`${observations.length} observations in session ${session.sessionId}\n`)
  if (findings.length === 0) process.stdout.write('No friction found.\n')
  for (const finding of findings) {
    process.stdout.write(`  ${finding.severity.toFixed(2)}  ${pad(finding.kind, 22)} ${finding.signature}\n        ${finding.summary}\n`)
  }
  for (const record of proposed) process.stdout.write(`proposed ${record.id}: ${record.title}\n  dsh-rsi approve ${record.id}\n`)
}

const { options, command, args } = parse(process.argv.slice(2))
if (options.help) {
  process.stdout.write(`${fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 23).map(line => line.replace(/^\/\/ ?/, '')).join('\n')}\n`)
} else {
  const library = openLibrary(path.resolve(options.home ?? defaultHome()))
  if (command === 'status') status(library, options)
  else if (command === 'show') show(library, args[0], options)
  else if (['approve', 'disable', 'enable', 'retire', 'rollback', 'scope'].includes(command)) change(library, command, args[0], args[1])
  else if (command === 'log') log(library, options)
  else if (command === 'mine') await mine(library, args[0], options)
  else if (command === 'project') project(library, args, options)
  else if (command === 'trust' || command === 'untrust') trust(library, command, args)
  else if (command === 'export' || command === 'import') pack(library, command, args, options)
  else fail(`unknown command "${command}"; try --help`)
}
