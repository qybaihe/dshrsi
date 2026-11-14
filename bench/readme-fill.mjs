#!/usr/bin/env node
// Writes the benchmark numbers into the README tables, in every language.
//
//   node bench/readme-fill.mjs
//
// The table sits between `<!-- bench:table:start -->` and `<!-- bench:table:end -->`. Its rows are in a fixed order;
// the first two cells of a row (the name and the number of tasks) belong to the translation and are kept, the other
// four are replaced with the numbers from bench/results/*.json (pass 1, both models, both arms).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = name => JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/results', `${name}.json`), 'utf8'))

const ROWS = [
  ['polyglot', 'passed1'], ['polyglot', 'passed2'],
  ['humaneval', 'base'], ['humaneval', 'plus'],
  ['mbpp', 'base'], ['mbpp', 'plus'],
]
const COLUMNS = [
  ['mimo-v2.6-pro', 'dsh'], ['mimo-v2.6-pro', 'rsi'],
  ['mimo-v2.6-flash', 'dsh'], ['mimo-v2.6-flash', 'rsi'],
]

const loaded = {}
/** A run that has not gone through all of its tasks yet is left out rather than shown as a smaller number. */
function cell(bench, field, model, arm, expected) {
  let data
  try { data = loaded[bench] ??= results(bench) } catch { return '–' }
  const run = data.runs.find(entry => entry.model === model && entry.arm === arm && /p1$/.test(entry.run))
  if (!run || run.scored === false || run.tasks !== expected) return '–'
  return `${run[field]} (${((100 * run[field]) / run.tasks).toFixed(1)}%)`
}

const files = [path.join(ROOT, 'README.md'), ...fs.readdirSync(path.join(ROOT, 'docs/readme')).filter(name => /^README_.*\.md$/.test(name)).map(name => path.join(ROOT, 'docs/readme', name))]
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const match = /(<!-- bench:table:start -->\n)([\s\S]*?)(\n<!-- bench:table:end -->)/.exec(text)
  if (!match) { console.log(`no table  ${path.relative(ROOT, file)}`); continue }
  const lines = match[2].split('\n')
  const body = lines.slice(2)
  if (body.length !== ROWS.length) { console.log(`${body.length} rows, expected ${ROWS.length}  ${path.relative(ROOT, file)}`); continue }
  const filled = body.map((line, index) => {
    const cells = line.split('|').slice(1, -1).map(part => part.trim())
    const [bench, field] = ROWS[index]
    return `| ${[cells[0], cells[1], ...COLUMNS.map(([model, arm]) => cell(bench, field, model, arm, Number(cells[1])))].join(' | ')} |`
  })
  const next = text.replace(match[0], `${match[1]}${[...lines.slice(0, 2), ...filled].join('\n')}${match[3]}`)
  if (next !== text) fs.writeFileSync(file, next)
  console.log(`${next === text ? 'unchanged' : 'filled   '} ${path.relative(ROOT, file)}`)
}
