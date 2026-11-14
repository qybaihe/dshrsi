// The Aider Polyglot benchmark: 225 Exercism exercises in six languages.
//
// Prompts, the two-try protocol and the scoring commands follow Aider's own
// benchmark script (aider/benchmark/benchmark.py). What differs is who edits
// the files: here the agent harness under test works in the exercise
// directory with its own tools, instead of Aider applying a model's edits.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { paths, toolEnv } from './env.mjs'

export const LANGUAGES = ['cpp', 'go', 'java', 'javascript', 'python', 'rust']

/** Aider's benchmark/prompts.py, unchanged. */
const ADDENDUM = `
####

Use the above instructions to modify the supplied files: {file_list}
Don't change the names of existing functions or classes, as they may be referenced from other code like unit tests, etc.
Only use standard libraries, don't suggest installing any packages.
`
const TEST_FAILURES = `
####

See the testing errors above.
The tests are correct, don't try and change them.
Fix the code in {file_list} to resolve the errors.
`

/** Reference solutions and write-ups. Aider keeps them out of the model's sight; an agent with a file system must not find them. */
const HIDDEN = ['.meta', '.approaches', '.articles']
const BUILD_LEFTOVERS = ['target', 'build', '.gradle', 'node_modules', 'package-lock.json', '.pytest_cache', '__pycache__']
/** Aider's limit is 180 seconds. Many sessions compile at once here, so a build gets more room. */
const TEST_TIMEOUT_MS = 300000
const OUTPUT_CAP = 20000

const readIf = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')

export function listTasks(only = LANGUAGES) {
  const tasks = []
  for (const language of LANGUAGES.filter(entry => only.includes(entry))) {
    const root = path.join(paths.polyglot, language, 'exercises/practice')
    for (const name of fs.readdirSync(root).sort()) {
      if (fs.existsSync(path.join(root, name, '.meta/config.json'))) tasks.push({ id: `${language}/${name}`, language, name, source: path.join(root, name) })
    }
  }
  return tasks
}

/** The file sets of an exercise, with Aider's rule for what counts as a file to edit. */
export function filesOf(task) {
  const config = JSON.parse(fs.readFileSync(path.join(task.source, '.meta/config.json'), 'utf8')).files ?? {}
  const test = config.test ?? []
  const example = config.example ?? []
  const ignored = new Set(['CMakeLists.txt', 'Cargo.toml', ...test, ...example])
  const solution = (config.solution ?? []).filter(file => !ignored.has(file) && !file.startsWith('.meta/') && !file.startsWith('.docs/'))
  return { solution, test, example }
}

export function firstPrompt(task) {
  const docs = path.join(task.source, '.docs')
  const fileList = filesOf(task).solution.filter(file => fs.existsSync(path.join(task.source, file))).map(file => path.basename(file)).join(' ')
  return readIf(path.join(docs, 'introduction.md')) + readIf(path.join(docs, 'instructions.md')) + readIf(path.join(docs, 'instructions.append.md'))
    + ADDENDUM.replace('{file_list}', fileList)
}

export function retryPrompt(task, errors) {
  const fileList = filesOf(task).solution.map(file => path.basename(file)).join(' ')
  const shown = errors.length > OUTPUT_CAP ? `${errors.slice(0, 4000)}\n[... ${errors.length - OUTPUT_CAP} characters of test output left out ...]\n${errors.slice(-(OUTPUT_CAP - 4000))}` : errors
  return shown + TEST_FAILURES.replace('{file_list}', fileList)
}

/** A fresh copy of the exercise for the agent to work in. */
export function prepare(task, workspace) {
  fs.rmSync(workspace, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(workspace), { recursive: true })
  fs.cpSync(task.source, workspace, { recursive: true })
  for (const entry of HIDDEN) fs.rmSync(path.join(workspace, entry), { recursive: true, force: true })
  if (task.language === 'javascript') fs.symlinkSync(paths.jsModules, path.join(workspace, 'node_modules'))
  if (task.language === 'java') fs.chmodSync(path.join(workspace, 'gradlew'), 0o755)
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: toolEnv(), detached: true })
    let output = ''
    let timedOut = false
    const take = (chunk) => { output = (output + chunk).slice(-400000) }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }, TEST_TIMEOUT_MS)
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, timedOut, output: `${output}\n${error?.message ?? error}` }) })
    child.on('exit', (code) => { clearTimeout(timer); resolve({ ok: code === 0 && !timedOut, timedOut, output }) })
  })
}

const COMMANDS = {
  python: cwd => run('pytest', [], cwd),
  rust: cwd => run('cargo', ['test', '--', '--include-ignored'], cwd),
  go: cwd => run('go', ['test', './...'], cwd),
  javascript: cwd => run('npm', ['run', 'test'], cwd),
  java: cwd => run('./gradlew', ['test'], cwd),
  async cpp(cwd) {
    const build = path.join(cwd, 'build')
    fs.rmSync(build, { recursive: true, force: true })
    fs.mkdirSync(build)
    const configured = await run('cmake', ['-DEXERCISM_RUN_ALL_TESTS=1', '-G', 'Unix Makefiles', '..'], build)
    if (!configured.ok) return configured
    const made = await run('make', [], build)
    return { ...made, output: `${configured.output}\n${made.output}` }
  },
}

/**
 * Scores the workspace the way Aider does: the benchmark's own test files are put back first, tests that Exercism
 * ships switched off are switched on, and the exit status of the language's test command decides.
 * @returns {Promise<{ passed: boolean, timedOut: boolean, errors: string, seconds: number }>} `errors` is the cleaned test output of a failed run.
 */
export async function score(task, workspace) {
  const started = Date.now()
  const { test } = filesOf(task)
  for (const file of test) {
    const source = path.join(task.source, file)
    if (!fs.existsSync(source)) continue
    fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true })
    fs.copyFileSync(source, path.join(workspace, file))
  }
  for (const file of test) {
    const target = path.join(workspace, file)
    if (!fs.existsSync(target)) continue
    if (file.endsWith('.java')) fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(/@Disabled\([^)]*\)\s*\n/g, ''))
    if (file.endsWith('.spec.js')) fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(/\bxtest\(/g, 'test('))
  }
  if (task.language === 'javascript' && !fs.existsSync(path.join(workspace, 'node_modules'))) fs.symlinkSync(paths.jsModules, path.join(workspace, 'node_modules'))
  const result = await COMMANDS[task.language](workspace)
  const errors = result.timedOut
    ? 'Tests timed out!'
    : result.output.replace(/\bin \d+\.\d+s\b/g, '').replaceAll(workspace, path.basename(workspace))
  return { passed: result.ok, timedOut: result.timedOut, errors: result.ok ? '' : errors, seconds: Math.round((Date.now() - started) / 100) / 10 }
}

/** Removes what builds leave behind. The edited files stay. */
export function tidy(workspace) {
  for (const entry of BUILD_LEFTOVERS) fs.rmSync(path.join(workspace, entry), { recursive: true, force: true })
}

/** Puts the benchmark's reference solution in place, to check that the toolchains score a correct answer as correct. */
export function applyReference(task, workspace) {
  const { solution, example } = filesOf(task)
  const open = new Set(solution)
  const place = (from, to) => {
    fs.mkdirSync(path.dirname(path.join(workspace, to)), { recursive: true })
    fs.copyFileSync(path.join(task.source, from), path.join(workspace, to))
    open.delete(to)
  }
  const unnamed = []
  for (const from of example) {
    const same = solution.find(file => path.basename(file) === path.basename(from))
    if (same) place(from, same)
    else unnamed.push(from)
  }
  for (const from of unnamed) {
    // A Java reference may bring helper classes the starting files do not have.
    if (task.language === 'java') { place(from, path.join('src/main/java', path.basename(from))); continue }
    // "example.h" stands in for the header, "example.cpp" for the source; a header-only reference leaves the source as it is.
    const sameType = [...open].find(file => path.extname(file) === path.extname(from))
    const target = sameType ?? (task.language === 'cpp' ? undefined : [...open][0])
    if (target) place(from, target)
  }
  // A few Rust references need a crate the starting Cargo.toml does not list.
  const manifest = path.join(task.source, '.meta/Cargo-example.toml')
  if (fs.existsSync(manifest)) fs.copyFileSync(manifest, path.join(workspace, 'Cargo.toml'))
}
