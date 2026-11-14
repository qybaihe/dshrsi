// MBPP and MBPP+ (EvalPlus): 378 short Python functions, each described in one
// sentence with one example assertion.
//
// The agent gets that description as the head of solution.py and writes the
// function with its own tools. Scoring is EvalPlus's own evaluator on the
// finished file: the original MBPP tests ("base") and EvalPlus's larger test
// set ("plus"). The tests are never placed in the workspace.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { paths, toolEnv } from './env.mjs'

const PYTHON = path.join(paths.evalplus, 'bin/python')
const DIR = path.join(paths.humaneval, '..', 'mbpp')
const PROBLEMS = path.join(DIR, 'problems.jsonl')

const EXPORT = `
import json, sys
from evalplus.data import get_mbpp_plus
with open(sys.argv[1], "w") as out:
    for task_id, problem in get_mbpp_plus().items():
        out.write(json.dumps({"task_id": task_id, "entry_point": problem["entry_point"], "prompt": problem["prompt"]}) + "\\n")
`

export function listTasks() {
  if (!fs.existsSync(PROBLEMS)) {
    fs.mkdirSync(DIR, { recursive: true })
    execFileSync(PYTHON, ['-I', '-c', EXPORT, PROBLEMS], { stdio: ['ignore', 'ignore', 'inherit'] })
  }
  return fs.readFileSync(PROBLEMS, 'utf8').split('\n').filter(Boolean).map((line) => {
    const problem = JSON.parse(line)
    return { id: problem.task_id, name: problem.task_id.replace('/', '_'), entryPoint: problem.entry_point, stub: problem.prompt }
  })
}

export function firstPrompt(task) {
  return `solution.py starts with a description of a function and one example assertion.
Write the function \`${task.entryPoint}\` in solution.py so that it does what the description says and the assertion holds.
Keep the description at the top of the file. Only use the standard library.
`
}

export function prepare(task, workspace) {
  fs.rmSync(workspace, { recursive: true, force: true })
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, 'solution.py'), task.stub)
}

export function collect(workspace) {
  const file = path.join(workspace, 'solution.py')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

/**
 * Scores every collected solution in one EvalPlus run (see humaneval.mjs for the memory-limit switch).
 * @param {{ id: string, solution: string }[]} samples
 * @param {string} dir where the sample file and EvalPlus's result file are written.
 * @returns {Map<string, { base: boolean, plus: boolean }>} `plus` means the base tests and the extra tests both pass.
 */
export function scoreAll(samples, dir) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'samples.jsonl')
  // EvalPlus refuses a sample file that does not cover every problem; a partial run is filled up with the bare descriptions.
  const given = new Set(samples.map(sample => sample.id))
  const filler = listTasks().filter(task => !given.has(task.id)).map(task => ({ id: task.id, solution: task.stub }))
  fs.writeFileSync(file, [...samples, ...filler].map(sample => JSON.stringify({ task_id: sample.id, solution: sample.solution })).join('\n') + '\n')
  fs.rmSync(path.join(dir, 'samples_eval_results.json'), { force: true })
  const ran = spawnSync(PYTHON, ['-m', 'evalplus.evaluate', '--dataset', 'mbpp', '--samples', file, '--parallel', '8'], {
    cwd: dir, env: toolEnv({ EVALPLUS_MAX_MEMORY_BYTES: '-1' }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  })
  const results = path.join(dir, 'samples_eval_results.json')
  if (!fs.existsSync(results)) throw new Error(`EvalPlus produced no result file: ${(ran.stderr ?? '').slice(-600)}`)
  const scored = new Map()
  for (const [id, [entry]] of Object.entries(JSON.parse(fs.readFileSync(results, 'utf8')).eval)) {
    if (given.has(id)) scored.set(id, { base: entry.base_status === 'pass', plus: entry.base_status === 'pass' && entry.plus_status === 'pass' })
  }
  return scored
}
