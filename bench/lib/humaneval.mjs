// HumanEval and HumanEval+ (EvalPlus): 164 Python functions to complete.
//
// The agent gets the function stub as a file and completes it with its own
// tools. Scoring is EvalPlus's own evaluator on the finished file: the
// original HumanEval tests ("base") and EvalPlus's much larger test set
// ("plus"). The tests are never placed in the workspace.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { paths, toolEnv } from './env.mjs'

const PYTHON = path.join(paths.evalplus, 'bin/python')
const PROBLEMS = path.join(paths.humaneval, 'problems.jsonl')

const EXPORT = `
import json, sys
from evalplus.data import get_human_eval_plus
with open(sys.argv[1], "w") as out:
    for task_id, problem in get_human_eval_plus().items():
        out.write(json.dumps({"task_id": task_id, "entry_point": problem["entry_point"], "prompt": problem["prompt"]}) + "\\n")
`

export function listTasks() {
  if (!fs.existsSync(PROBLEMS)) {
    fs.mkdirSync(paths.humaneval, { recursive: true })
    execFileSync(PYTHON, ['-c', EXPORT, PROBLEMS], { stdio: ['ignore', 'ignore', 'inherit'] })
  }
  return fs.readFileSync(PROBLEMS, 'utf8').split('\n').filter(Boolean).map((line) => {
    const problem = JSON.parse(line)
    return { id: problem.task_id, name: problem.task_id.replace('/', '_'), entryPoint: problem.entry_point, stub: problem.prompt }
  })
}

export function firstPrompt(task) {
  return `Complete the function \`${task.entryPoint}\` in solution.py so that it does what its docstring says.
Keep the function's name and signature, and keep everything else that is already in the file.
Only use the standard library.
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
 * Scores every collected solution in one EvalPlus run.
 * macOS cannot set the address-space limit EvalPlus asks for, and with it every task is reported as a timeout;
 * EVALPLUS_MAX_MEMORY_BYTES=-1 is EvalPlus's own switch for running without that limit.
 * @param {{ id: string, solution: string }[]} samples
 * @param {string} dir where the sample file and EvalPlus's result file are written.
 * @returns {Map<string, { base: boolean, plus: boolean }>} `plus` means the base tests and the extra tests both pass.
 */
export function scoreAll(samples, dir) {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'samples.jsonl')
  // EvalPlus refuses a sample file that does not cover all 164 problems; a partial run is filled up with the bare stubs.
  const given = new Set(samples.map(sample => sample.id))
  const filler = listTasks().filter(task => !given.has(task.id)).map(task => ({ id: task.id, solution: `${task.stub}    pass\n` }))
  fs.writeFileSync(file, [...samples, ...filler].map(sample => JSON.stringify({ task_id: sample.id, solution: sample.solution })).join('\n') + '\n')
  fs.rmSync(path.join(dir, 'samples_eval_results.json'), { force: true })
  const ran = spawnSync(PYTHON, ['-m', 'evalplus.evaluate', '--dataset', 'humaneval', '--samples', file, '--parallel', '8'], {
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
