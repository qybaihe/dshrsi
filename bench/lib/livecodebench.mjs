// LiveCodeBench, code generation, release v6 (the 175 problems added in that
// release: LeetCode and AtCoder contests from early 2025).
//
// The agent gets the problem statement as problem.md and writes solution.py
// with its own tools: a `class Solution` for LeetCode problems (the starter
// code is in the file), a program that reads standard input for the others.
// Scoring is LiveCodeBench's own evaluator on the finished file, on the public
// and the hidden tests, with its default limit of 6 seconds per test. The
// hidden tests are never placed in the workspace.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BENCH_HOME, paths, toolEnv } from './env.mjs'

const PYTHON = path.join(paths.evalplus, 'bin/python')
const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lcb_tool.py')
const DIR = path.join(BENCH_HOME, 'livecodebench')
const RELEASE = path.join(DIR, 'data/test6.jsonl')
const PROBLEMS = path.join(DIR, 'problems.jsonl')
const CHECKOUT = path.join(BENCH_HOME, 'src/livecodebench/LiveCodeBench')
const SOURCE = 'https://huggingface.co/datasets/livecodebench/code_generation_lite/resolve/main/test6.jsonl'

export function listTasks() {
  if (!fs.existsSync(PROBLEMS)) {
    if (!fs.existsSync(RELEASE)) {
      fs.mkdirSync(path.dirname(RELEASE), { recursive: true })
      execFileSync('curl', ['-fsSL', '--retry', '3', '-o', `${RELEASE}.part`, SOURCE], { stdio: ['ignore', 'ignore', 'inherit'] })
      fs.renameSync(`${RELEASE}.part`, RELEASE)
    }
    execFileSync(PYTHON, ['-I', TOOL, 'export', RELEASE, PROBLEMS], { stdio: ['ignore', 'ignore', 'inherit'] })
  }
  return fs.readFileSync(PROBLEMS, 'utf8').split('\n').filter(Boolean).map((line) => {
    const problem = JSON.parse(line)
    return {
      id: problem.id, name: problem.id.replace(/[^\w.-]/g, '_'), group: problem.difficulty, platform: problem.platform,
      title: problem.title, content: problem.content, starter: problem.starter ?? '',
    }
  })
}

export function firstPrompt(task) {
  const how = task.starter.trim()
    ? 'solution.py already holds the starter code. Complete it there, and keep the class name, the method name and its signature.'
    : 'solution.py must be a program that reads its input from standard input and writes the answer to standard output.'
  return `problem.md describes a programming problem. Solve it in Python in solution.py.
${how}
The solution is judged on hidden tests with a time limit of a few seconds each, so it has to be correct and fast enough for the full constraints, not only for the examples.
Only use the standard library.
`
}

export function prepare(task, workspace) {
  fs.rmSync(workspace, { recursive: true, force: true })
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, 'problem.md'), `# ${task.title}\n\n${task.content}\n`)
  fs.writeFileSync(path.join(workspace, 'solution.py'), task.starter.trim() ? `${task.starter.trimEnd()}\n` : '')
}

export function collect(workspace) {
  const file = path.join(workspace, 'solution.py')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

/**
 * Scores every collected solution with LiveCodeBench's evaluator.
 * @param {{ id: string, solution: string }[]} samples
 * @param {string} dir where the sample file and the verdicts are written.
 * @returns {Map<string, { base: boolean, plus: boolean }>} one verdict per problem; both fields carry it, for the report's sake.
 */
export function scoreAll(samples, dir) {
  if (!fs.existsSync(CHECKOUT)) throw new Error(`no LiveCodeBench checkout at ${CHECKOUT} (git clone https://github.com/LiveCodeBench/LiveCodeBench there)`)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'samples.jsonl')
  const out = path.join(dir, 'verdicts.json')
  fs.writeFileSync(file, samples.map(sample => JSON.stringify({ id: sample.id, solution: sample.solution })).join('\n') + '\n')
  fs.rmSync(out, { force: true })
  const ran = spawnSync(PYTHON, ['-I', TOOL, 'score', CHECKOUT, RELEASE, file, out, process.env.LCB_PROCESSES ?? '6', '6'], {
    cwd: dir, env: toolEnv(), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  })
  if (!fs.existsSync(out)) throw new Error(`LiveCodeBench scoring produced no verdicts: ${(ran.stderr ?? '').slice(-800)}`)
  const scored = new Map()
  for (const [id, passed] of Object.entries(JSON.parse(fs.readFileSync(out, 'utf8')))) scored.set(id, { base: passed === true, plus: passed === true })
  return scored
}
