#!/usr/bin/env node
// Takes back the tasks of a run whose sessions the model provider refused (an exhausted account, an outage), so that
// they are not counted as answers and run again when the run is resumed.
//
//   node bench/void.mjs <benchmark> <run> [--match "text in the session's error output"] [--dry]
//
// A row of results.jsonl is voided when its stored error output contains the text (by default the provider errors
// DSH reports: QUOTA, AUTH, RATE_LIMIT). For a run with the plugin, what those sessions left in the adaptation
// library's ledger and audit log is removed as well, so the library is what it was without them.
// The files as they were are kept next to the new ones with the suffix .before-void.
import fs from 'node:fs'
import path from 'node:path'
import { paths } from './lib/env.mjs'

const [bench, run] = process.argv.slice(2)
const option = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const dry = process.argv.includes('--dry')
if (!bench || !run) { console.error('usage: node bench/void.mjs <benchmark> <run> [--match text] [--dry]'); process.exit(2) }

const dir = path.join(paths.runs, bench, run)
const file = path.join(dir, 'results.jsonl')
if (!fs.existsSync(file)) { console.error(`no results at ${file}`); process.exit(2) }
if (fs.existsSync(path.join(dir, 'lock'))) { console.error(`run ${run} looks like it is still running (lock file present)`); process.exit(3) }

const wanted = option('--match')
const refused = (row) => {
  const errors = (row.tries ?? []).map(entry => entry.agent?.stderr ?? '').join('\n') + (row.error ?? '')
  return wanted ? errors.includes(wanted) : /dsh: (QUOTA|AUTH|RATE_LIMIT)\b/.test(errors)
}
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
const voided = rows.filter(row => !row.infra && refused(row))
const sessions = new Set(voided.flatMap(row => [row.sessionId, ...(row.tries ?? []).map(entry => entry.agent?.sessionId)]).filter(Boolean))
console.log(`${bench}/${run}: ${rows.length} rows, ${voided.length} to void, ${rows.filter(row => !row.infra && !refused(row)).length} stay`)
if (dry || voided.length === 0) process.exit(0)

const keep = (target) => { if (!fs.existsSync(`${target}.before-void`)) fs.copyFileSync(target, `${target}.before-void`) }
keep(file)
fs.writeFileSync(file, rows.map(row => JSON.stringify(voided.includes(row) ? { ...row, infra: true, voided: 'the provider refused the session' } : row)).join('\n') + '\n')

for (const name of ['ledger.jsonl', 'audit.jsonl']) {
  const target = path.join(dir, 'home/rsi', name)
  if (!fs.existsSync(target)) continue
  const entries = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean)
  const left = entries.filter((line) => { try { return !sessions.has(JSON.parse(line).sessionId) } catch { return true } })
  if (left.length === entries.length) continue
  keep(target)
  fs.writeFileSync(target, left.join('\n') + '\n')
  console.log(`  ${name}: removed ${entries.length - left.length} entries of those sessions`)
}
