#!/usr/bin/env node
// SWE-bench Verified: 500 issues from 12 Python repositories, each to be
// resolved in a checkout of the repository at the commit it was reported on.
//
// The agent gets the issue text and the checkout, nothing else. What it
// changed is collected as a unified diff against that commit and written in
// the form SWE-bench's evaluation takes (<run>/predictions.jsonl). The
// evaluation itself runs each project's tests in one container per instance
// and is not done here.
//
// Sessions of this suite are sealed (bench/lib/sealed.mjs): no network but a package index that does not serve the
// project under test, no file of the user, a checkout that holds the history up to its commit and nothing later.
//
//   node bench/lib/swebench.mjs fetch                     the dataset, and the id list of the 50-instance subset
//   node bench/lib/swebench.mjs repos [--subset mini]     every repository's object store, with what its instances need
//   node bench/lib/swebench.mjs toolchains                the interpreters sessions get, under the neutral root
//   node bench/lib/swebench.mjs checkouts [--subset mini] [--concurrency 4]
//                                                         every instance checked out and collected untouched: the patch must be empty
//   node bench/lib/swebench.mjs check <run>               every patch of a run against a fresh checkout (git apply --check)
//   node bench/lib/swebench.mjs seal [instance id]        what a session can and cannot do, tried in a session's sandbox
//   node bench/lib/swebench.mjs audit <run> [--json]      every session log of a run, for attempts to reach outside
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BENCH_HOME, paths, pool } from './env.mjs'
import { INDEX_LOG, REFUSAL, ensureIndex, indexUrl, normalize } from './pypi-index.mjs'
import { DEFAULT_PYTHON, DISK_REFUSAL, FLOOR_BYTES, PYTHONS, openSession, provideToolchains, sealed } from './sealed.mjs'

const DIR = path.join(BENCH_HOME, 'swebench')
const INSTANCES = path.join(DIR, 'instances.jsonl')
const EVALUATION = path.join(DIR, 'evaluation.jsonl')
const MINI = path.join(DIR, 'mini.json')
const STORES = path.join(DIR, 'repos')
const ROWS = 'https://datasets-server.huggingface.co/rows'
const DATASET = 'princeton-nlp/SWE-bench_Verified'
const MINI_DATASET = 'MariusHobbhahn/swe-bench-verified-mini'
/** What a task is made of. The reference patch and the maintainers' hints are not stored at all. */
const TASK_FIELDS = ['instance_id', 'repo', 'base_commit', 'problem_statement']
/**
 * What only the evaluation needs: the test patch and the names of the tests. A session can read any file of this
 * user, and an agent that lacks a dependency searches the disk; so this file is kept with no permissions at all.
 * The sandbox lets a session change nothing outside its workspace, permissions included, so it stays closed to it.
 * To read it: chmod u+r.
 */
const EVALUATION_FIELDS = ['instance_id', 'version', 'environment_setup_commit', 'difficulty', 'FAIL_TO_PASS', 'PASS_TO_PASS', 'test_patch']

/**
 * Never part of a patch: environments, caches and build leftovers an agent makes while it works. The same list is
 * in the checkout's own exclude file, so the agent's `git status` and the collected patch agree.
 */
const EXCLUDED = `.venv/
venv/
.env/
env/
__pycache__/
*.py[cod]
*.egg-info/
.eggs/
.pytest_cache/
.hypothesis/
.mypy_cache/
.ruff_cache/
.tox/
.nox/
node_modules/
.dsh-rsi/
.DS_Store
`
/** A new file larger than this is not a fix (a download, a database, a core dump) and stays out of the patch. */
const NEW_FILE_LIMIT = 1024 * 1024
/**
 * New checkouts wait while the disk has less than this free: running sessions finish and give theirs back. It is
 * above the floor under which a session's commands are refused (BENCH_MIN_FREE_GB, 3 GB), because a session that
 * is already running goes on installing what it needs.
 */
const MIN_FREE_BYTES = FLOOR_BYTES + Number(process.env.BENCH_START_MARGIN_GB ?? 1.5) * 2 ** 30

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const readIf = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

// ---------------------------------------------------------------------------------------------------- dataset

function rowsOf(dataset) {
  const rows = []
  for (;;) {
    const url = `${ROWS}?dataset=${encodeURIComponent(dataset)}&config=default&split=test&offset=${rows.length}&length=100`
    const page = JSON.parse(execFileSync('curl', ['-fsSL', '--retry', '5', '--retry-all-errors', '--max-time', '300', url], { encoding: 'utf8', maxBuffer: 2 ** 29, stdio: ['ignore', 'pipe', 'inherit'] }))
    for (const entry of page.rows ?? []) {
      if (entry.truncated_cells?.length > 0) throw new Error(`${dataset}: row ${entry.row_idx} came back shortened`)
      rows.push(entry.row)
    }
    if (!page.rows?.length || rows.length >= page.num_rows_total) return rows
  }
}

/** Downloads the 500 instances and the id list of the 50-instance subset, once. */
export function fetchData() {
  if (fs.existsSync(INSTANCES) && fs.existsSync(EVALUATION) && fs.existsSync(MINI)) return
  fs.mkdirSync(DIR, { recursive: true })
  const rows = rowsOf(DATASET)
  const ids = new Set(rows.map(row => row.instance_id))
  // Instance ids and repository names become directory names and command arguments; nothing else may pass.
  const sound = row => /^[A-Za-z0-9][\w.-]*$/.test(row.instance_id) && /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(row.repo)
    && /^[0-9a-f]{40}$/.test(row.base_commit) && typeof row.problem_statement === 'string' && row.problem_statement.trim() !== ''
  if (rows.length !== 500 || ids.size !== 500 || !rows.every(sound)) throw new Error(`${DATASET}: expected 500 well-formed instances, got ${rows.length}`)
  const mini = rowsOf(MINI_DATASET).map(row => row.instance_id).sort()
  if (mini.length !== 50 || new Set(mini).size !== 50 || !mini.every(id => ids.has(id))) throw new Error(`${MINI_DATASET}: expected 50 instances of ${DATASET}, got ${mini.length}`)
  // Under a name of this process's own: both arms may be started at the same moment on a machine without the data.
  const place = (file, text, mode = 0o644) => {
    const part = `${file}.part-${process.pid}`
    fs.rmSync(part, { force: true })
    fs.writeFileSync(part, text)
    fs.chmodSync(part, mode)
    fs.renameSync(part, file)
  }
  const lines = fields => rows.map(row => JSON.stringify(Object.fromEntries(fields.map(key => [key, row[key]])))).join('\n') + '\n'
  rows.sort((a, b) => (a.instance_id < b.instance_id ? -1 : 1))
  place(EVALUATION, lines(EVALUATION_FIELDS), 0o000)
  place(MINI, `${JSON.stringify(mini, null, 1)}\n`)
  place(INSTANCES, lines(TASK_FIELDS))
}

/**
 * The tasks, with only what the agent may see and what the checkout needs.
 *
 * An instance id ends in the number of the pull request that fixed the issue, and with that number the fix is one
 * download away. `name`, which the workspace directory is called, is therefore not the id but a digest of it.
 * @param {string} [subset] `mini` for the 50 instances of swe-bench-verified-mini.
 */
export function listTasks(subset) {
  if (subset !== undefined && subset !== 'mini') throw new Error(`unknown subset "${subset}": the only one is "mini"`)
  fetchData()
  const only = subset === 'mini' ? new Set(JSON.parse(fs.readFileSync(MINI, 'utf8'))) : undefined
  return fs.readFileSync(INSTANCES, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(entry => !only || only.has(entry.instance_id))
    .map(entry => ({
      id: entry.instance_id, name: createHash('sha256').update(entry.instance_id).digest('hex').slice(0, 12),
      repo: entry.repo, baseCommit: entry.base_commit, issue: entry.problem_statement,
    }))
}

/**
 * The names a repository's project is published under on PyPI, and packages that carry a copy of it. A later
 * release contains the fix, so the session's package index refuses all of them.
 */
const UNDER_TEST = {
  'astropy/astropy': ['astropy'],
  'django/django': ['django'],
  'matplotlib/matplotlib': ['matplotlib'],
  'mwaskom/seaborn': ['seaborn'],
  'pallets/flask': ['flask'],
  // pip, and what installs pip, carry a copy of requests (pip/_vendor/requests); botocore did until 2019.
  'psf/requests': ['requests', 'pip', 'pipenv', 'virtualenv', 'pex', 'botocore'],
  'pydata/xarray': ['xarray', 'xray'],
  'pylint-dev/pylint': ['pylint'],
  'pytest-dev/pytest': ['pytest'],
  'scikit-learn/scikit-learn': ['scikit-learn', 'sklearn'],
  'sphinx-doc/sphinx': ['sphinx'],
  'sympy/sympy': ['sympy'],
}
/** Files on this machine a session of the repository may not read: copies of the project in the interpreters it is given. */
const HIDDEN = {
  'psf/requests': ['/pip/_vendor/requests(/|$)', '/ensurepip/_bundled/pip-[^/]*\\.whl$'],
}
export const blockedProjects = task => UNDER_TEST[task.repo] ?? [task.repo.split('/')[1]]
export const hiddenPaths = task => HIDDEN[task.repo] ?? []

/**
 * What a session is told about the machine: facts, the same in both arms. `node bench/lib/swebench.mjs seal`
 * tries each of them in a session's sandbox.
 */
export function environmentNote(task) {
  const pythons = PYTHONS.map(version => `python${version}`).join(', ')
  const installing = hiddenPaths(task).length > 0
    ? `They are read-only and no package is installed in them. In this task \`pip\` and \`python3 -m venv\` do not work, because pip contains a copy of this project; \`uv venv\` and \`uv pip install\` work.`
    : `They are read-only and have pip and no other package. A virtual environment inside this directory works (\`python3 -m venv\`, or \`uv venv\` and \`uv pip install\`).`
  return `About this machine:
- There is no internet access. The one network service is a package index, already configured for pip and uv; it does not serve the project in this repository. Programs cannot open network sockets, loopback included.
- Python interpreters: ${pythons}; \`python3\` and \`python\` are ${DEFAULT_PYTHON}. ${installing} The project's dependencies are not installed.
- This directory and $TMPDIR can be written. Nothing else can, /tmp included, and files outside these two and the operating system cannot be read.
- Git has no remote. The history up to this commit is there; the contents of older versions of files are not.`
}

export function firstPrompt(task) {
  return `The repository in the current directory is checked out at the commit the following issue was reported against.

<issue>
${task.issue.trim()}
</issue>

Resolve the issue by changing the source code of this repository. Leave the tests as they are: the fix will be checked by the project's tests.

${environmentNote(task)}
`
}

/** The line SWE-bench's evaluation takes for one answered task. */
export function prediction(row, arm, model) {
  return { instance_id: row.id, model_name_or_path: `${arm === 'rsi' ? 'dsh-rsi' : 'dsh'}+${model}`, model_patch: row.patch ?? '' }
}

// -------------------------------------------------------------------------------------------------------- git

/** This code's own git calls see neither the user's settings nor their credentials, and never stop to ask. */
const PLAIN = { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }
const children = new Set()
process.on('exit', () => { for (const child of children) child.kill('SIGKILL') })

function git(args, { cwd, input = '', env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', `core.excludesFile=${os.devNull}`, ...args], { cwd, env: { ...process.env, ...PLAIN, ...env } })
    children.add(child)
    const out = []
    let err = ''
    child.stdout.on('data', chunk => out.push(chunk))
    child.stderr.on('data', (chunk) => { err = (err + chunk).slice(-2000) })
    // git may exit before it has read everything it was given.
    child.stdin.on('error', () => {})
    child.on('error', (error) => { children.delete(child); reject(error) })
    child.on('close', (code) => {
      children.delete(child)
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'))
      else reject(new Error(`git ${args.slice(0, 2).join(' ')} failed (${code}): ${err.trim().slice(-600)}`))
    })
    child.stdin.end(input)
  })
}

const chains = new Map()
/**
 * One holder at a time, among the tasks of this process and between the processes of two arms.
 * The file names its holder, so a lock left behind by a process that was killed is taken over.
 */
function locked(file, work) {
  const turn = (chains.get(file) ?? Promise.resolve()).then(async () => {
    const mine = String(process.pid)
    for (;;) {
      try {
        fs.writeFileSync(file, mine, { flag: 'wx' })
        // Two processes taking over the same dead lock can each believe they have it; the later writer keeps it.
        await sleep(120)
        if (readIf(file) === mine) break
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const holder = readIf(file)
        if (holder !== '' && alive(Number(holder))) await sleep(300)
        else if (readIf(file) === holder) fs.rmSync(file, { force: true })
      }
    }
    try { return await work() } finally { fs.rmSync(file, { force: true }) }
  })
  chains.set(file, turn.catch(() => {}))
  return turn
}

const storeOf = repo => path.join(STORES, `${repo.replace('/', '__')}.git`)

/** The ids of the files of these commits that the store does not hold yet. */
async function missingFiles(store, commits) {
  const wanted = new Set()
  for (const commit of commits) {
    // "<mode> <type> <id>\t<path>"; a submodule is a `commit` entry and has no content here.
    for (const line of (await git(['ls-tree', '-r', commit], { cwd: store })).split('\n')) {
      const [, type, id] = line.split('\t')[0].split(' ')
      if (type === 'blob') wanted.add(id)
    }
  }
  if (wanted.size === 0) return []
  // Asked without fetching: a partial clone would otherwise go and get each missing object on its own.
  const answer = await git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], { cwd: store, input: [...wanted].join('\n') + '\n', env: { GIT_NO_LAZY_FETCH: '1' } })
  return answer.split('\n').filter(line => line.endsWith(' missing')).map(line => line.split(' ')[0])
}

const hasCommit = (store, commit) => git(['cat-file', '-e', `${commit}^{commit}`], { cwd: store, env: { GIT_NO_LAZY_FETCH: '1' } }).then(() => true, () => false)

/**
 * Takes the branches and tags out of a store, after noting for every instance which tags its commit descends from.
 *
 * A store holds the whole history of its repository, the commits that fixed the issues included, and every checkout
 * names the store it borrows from. With its refs gone, `git log --all` there shows nothing: the later commits are
 * still among the objects, but nothing leads to them.
 */
async function seal(store, repo) {
  fs.mkdirSync(path.join(store, 'bench-tags'), { recursive: true })
  for (const commit of new Set(listTasks().filter(task => task.repo === repo).map(task => task.baseCommit))) {
    // A commit no branch or tag leads to any more is still served by its id.
    if (!(await hasCommit(store, commit))) await git(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--filter=blob:none', 'origin', commit], { cwd: store })
    fs.writeFileSync(path.join(store, 'bench-tags', commit), await git(['for-each-ref', `--merged=${commit}`, '--format=%(objectname) %(refname)', 'refs/tags'], { cwd: store }))
  }
  fs.rmSync(path.join(store, 'packed-refs'), { force: true })
  fs.rmSync(path.join(store, 'refs'), { recursive: true, force: true })
  fs.mkdirSync(path.join(store, 'refs'))
  fs.writeFileSync(path.join(store, 'bench-sealed'), '')
}

/**
 * The shared object store of a repository, holding these commits with every file of their trees.
 *
 * A store is a bare clone without file contents (commits and trees only, `--filter=blob:none`); the contents a
 * commit's checkout needs are fetched in one request the first time the commit is asked for. Checkouts borrow from
 * the store and never write to it, so one store serves every instance of its repository, in both arms, at once.
 */
async function provide(repo, commits) {
  const store = storeOf(repo)
  const mark = commit => path.join(store, 'bench-complete', commit)
  const sealed = () => fs.existsSync(path.join(store, 'bench-sealed'))
  if (sealed() && commits.every(commit => fs.existsSync(mark(commit)))) return store
  fs.mkdirSync(STORES, { recursive: true })
  await locked(`${store}.lock`, async () => {
    if (!fs.existsSync(path.join(store, 'HEAD'))) {
      for (const entry of fs.readdirSync(STORES)) if (entry.startsWith(`${path.basename(store)}.part-`)) fs.rmSync(path.join(STORES, entry), { recursive: true, force: true })
      const part = `${store}.part-${process.pid}`
      console.log(`swebench: cloning ${repo} without file contents`)
      await git(['clone', '--quiet', '--bare', '--filter=blob:none', `https://github.com/${repo}.git`, part])
      // Nothing repacks a store behind the back of the checkouts that read from it, or drops what no ref leads to.
      fs.appendFileSync(path.join(part, 'config'), '[gc]\n\tauto = 0\n\tpruneExpire = never\n[maintenance]\n\tauto = false\n')
      await git(['commit-graph', 'write', '--reachable'], { cwd: part })
      fs.renameSync(part, store)
    }
    if (!sealed()) await seal(store, repo)
    const todo = commits.filter(commit => !fs.existsSync(mark(commit)))
    for (const commit of todo) {
      if (!(await hasCommit(store, commit))) await git(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--filter=blob:none', 'origin', commit], { cwd: store })
    }
    const missing = await missingFiles(store, todo)
    if (missing.length > 0) {
      // What git itself runs when a partial clone lacks an object, for all of them in one request.
      await git(['-c', 'fetch.negotiationAlgorithm=noop', 'fetch', 'origin', '--quiet', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', '--filter=blob:none', '--stdin'], { cwd: store, input: missing.join('\n') + '\n' })
      const left = await missingFiles(store, todo)
      if (left.length > 0) throw new Error(`${repo}: ${left.length} file(s) could not be fetched`)
    }
    fs.mkdirSync(path.join(store, 'bench-complete'), { recursive: true })
    for (const commit of todo) fs.writeFileSync(mark(commit), '')
  })
  return store
}

let told = 0
async function room() {
  const free = () => { const disk = fs.statfsSync(sealed.root); return disk.bavail * disk.bsize }
  while (free() < MIN_FREE_BYTES) {
    if (Date.now() - told > 600000) {
      told = Date.now()
      console.log(`swebench: ${(free() / 2 ** 30).toFixed(1)} GB free, less than the ${(MIN_FREE_BYTES / 2 ** 30).toFixed(1)} GB a new checkout waits for (BENCH_MIN_FREE_GB + BENCH_START_MARGIN_GB); no new checkout until there is room`)
    }
    await sleep(20000)
  }
}

// ----------------------------------------------------------------------------------------------- one instance

/**
 * A clean checkout of the repository at the instance's commit, as a repository of its own that depends on nothing
 * outside its directory.
 *
 * Its `.git` holds one pack: the commits and directory listings the instance's commit descends from, the files of
 * that commit, and the tags that lead to it. Nothing later is in it. The shared store holds the whole history of
 * the project, the fixes included, and the files of every other instance's commit, so a checkout must not borrow
 * from it: `git cat-file --batch-all-objects` lists what a repository can reach, refs or not.
 *
 * There is no remote. The contents of older versions of files were never downloaded, so a command that needs them
 * (`git log -p`, `git blame`, `git show` of a commit) ends at once with "unable to read"; `git log`, `git log
 * --name-status`, `git show <commit>:<file>` for the instance's commit, `git stash`, `git add` and `git commit` work.
 */
export async function prepare(task, workspace) {
  await room()
  const store = await provide(task.repo, [task.baseCommit])
  fs.rmSync(workspace, { recursive: true, force: true })
  fs.mkdirSync(workspace, { recursive: true })
  await git(['init', '--quiet', '--initial-branch=main', '--template='], { cwd: workspace })
  const own = path.join(workspace, '.git')
  fs.mkdirSync(path.join(own, 'info'), { recursive: true })
  fs.mkdirSync(path.join(own, 'objects/pack'), { recursive: true })
  const tags = readIf(path.join(store, 'bench-tags', task.baseCommit))
  const tips = [task.baseCommit, ...tags.split('\n').filter(Boolean).map(line => line.split(' ')[0])]
  // Objects the store lacks (the contents of older versions) are left out instead of being fetched.
  await git(['pack-objects', '--revs', '--missing=allow-any', '--delta-base-offset', '--quiet', path.join(own, 'objects/pack/pack')], { cwd: store, input: `${tips.join('\n')}\n`, env: { GIT_NO_LAZY_FETCH: '1' } })
  fs.writeFileSync(path.join(own, 'info/exclude'), EXCLUDED)
  fs.appendFileSync(path.join(own, 'config'), `[user]
	name = agent
	email = agent@localhost
[advice]
	detachedHead = false
[gc]
	auto = 0
[maintenance]
	auto = false
`)
  fs.writeFileSync(path.join(own, 'packed-refs'), `${task.baseCommit} refs/heads/main\n${tags}`)
  await git(['reset', '--quiet', '--hard'], { cwd: workspace })
}

/** New files that are an environment or a download rather than part of a fix. */
function sift(workspace, files) {
  const environments = new Map()
  const inEnvironment = (dir) => {
    if (dir === '.' || dir === '') return false
    if (!environments.has(dir)) {
      const here = path.join(workspace, dir)
      environments.set(dir, fs.existsSync(path.join(here, 'pyvenv.cfg')) || fs.existsSync(path.join(here, 'conda-meta')) || path.basename(dir) === 'site-packages' || inEnvironment(path.dirname(dir)))
    }
    return environments.get(dir)
  }
  const kept = []
  let leftOut = 0
  for (const file of files) {
    // A directory here is a repository of its own that the agent made; git would record a link to it, not its files.
    const stat = file.endsWith('/') ? undefined : fs.lstatSync(path.join(workspace, file), { throwIfNoEntry: false })
    if (!stat || stat.size > NEW_FILE_LIMIT || inEnvironment(path.dirname(file))) leftOut += 1
    else kept.push(file)
  }
  return { kept, leftOut }
}

/**
 * What the agent changed, as a unified diff against the instance's commit: edits, deletions and new files, minus
 * what `.gitignore` and the list above leave out. Nothing outside the workspace can be in it.
 *
 * The diff is made with a git directory of its own, next to the workspace, from the files as they are on disk. So
 * it does not matter what the agent did to the checkout's `.git`: committed, staged, switched branch or removed it.
 * @returns {Promise<{ patch: string, leftOut: number }>} `leftOut` counts new files that were kept out of the patch.
 */
export async function collect(task, workspace) {
  const scratch = `${workspace}.collect`
  fs.rmSync(scratch, { recursive: true, force: true })
  try {
    await git(['init', '--quiet', '--bare', '--template=', scratch])
    fs.mkdirSync(path.join(scratch, 'info'), { recursive: true })
    fs.mkdirSync(path.join(scratch, 'objects/info'), { recursive: true })
    fs.writeFileSync(path.join(scratch, 'objects/info/alternates'), `${path.join(storeOf(task.repo), 'objects')}\n`)
    fs.writeFileSync(path.join(scratch, 'info/exclude'), EXCLUDED)
    const there = { cwd: workspace, env: { GIT_DIR: scratch, GIT_WORK_TREE: workspace } }
    await git(['read-tree', task.baseCommit], there)
    await git(['add', '--update'], there)
    const others = (await git(['ls-files', '--others', '--exclude-standard', '-z'], there)).split('\0').filter(Boolean)
    const { kept, leftOut } = sift(workspace, others)
    if (kept.length > 0) await git(['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], { ...there, input: kept.join('\0') })
    const patch = await git(['diff', '--cached', '--binary', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', task.baseCommit], there)
    return { patch, leftOut }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

/** Removes the workspace. The patch is in the result row and the session log is in the harness home. */
export function tidy(workspace) {
  try {
    fs.rmSync(workspace, { recursive: true, force: true })
  } catch {
    // A directory the agent (or a tool of its) made read-only keeps its contents from being removed.
    try { execFileSync('chmod', ['-R', 'u+rwX', workspace], { stdio: 'ignore' }) } catch { /* removed below, or reported */ }
    try { fs.rmSync(workspace, { recursive: true, force: true }) } catch (error) { console.error(`swebench: could not remove ${workspace}: ${error.message}`) }
  }
}

// -------------------------------------------------------------------------------------------------- commands

/** What the checks in swebench-audit.mjs use of this suite. */
const SUITE = { listTasks, prepare, tidy, blockedProjects, hiddenPaths }

async function main(argv) {
  const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback)
  const [command] = argv
  if (command === 'fetch') {
    fetchData()
    console.log(`${listTasks().length} instances, ${listTasks('mini').length} in the mini subset, in ${DIR}`)
  } else if (command === 'repos') {
    const byRepo = Map.groupBy(listTasks(option('--subset')), task => task.repo)
    // One repository at a time: a first clone is the largest download there is here.
    for (const [repo, tasks] of byRepo) {
      const started = Date.now()
      await provide(repo, tasks.map(task => task.baseCommit))
      console.log(`${repo.padEnd(28)} ${String(tasks.length).padStart(3)} instance(s) ready  ${Math.round((Date.now() - started) / 1000)}s`)
    }
  } else if (command === 'checkouts') {
    const root = path.join(sealed.runs, 'swebench', '_checkouts', 'work')
    const tasks = listTasks(option('--subset'))
    let bad = 0
    await pool(tasks, Number(option('--concurrency', 4)), async (task) => {
      const workspace = path.join(root, task.name)
      let verdict
      try {
        await prepare(task, workspace)
        const { patch } = await collect(task, workspace)
        verdict = patch === '' ? 'clean' : `NOT CLEAN: ${patch.split('\n').filter(line => line.startsWith('diff --git')).slice(0, 4).join(' | ')}`
      } catch (error) {
        verdict = `FAILED: ${error.message}`
      }
      tidy(workspace)
      if (verdict !== 'clean') { bad += 1; console.log(`${task.id.padEnd(36)} ${verdict}`) }
    })
    fs.rmSync(root, { recursive: true, force: true })
    console.log(`${tasks.length - bad} of ${tasks.length} checkouts are clean`)
    process.exitCode = bad === 0 ? 0 : 1
  } else if (command === 'toolchains') {
    for (const { version, home } of provideToolchains()) console.log(`python${version}  ${home}`)
    console.log(`uv and the python links are in ${sealed.bin}`)
  } else if (command === 'seal') {
    const { sealCheck } = await import('./swebench-audit.mjs')
    const port = Number(new URL(process.env.BENCH_BASE_URL ?? 'http://127.0.0.1:8791').port || 8791)
    process.exitCode = (await sealCheck(SUITE, argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined, { relayPort: port })) ? 0 : 1
  } else if (command === 'audit' && argv[1]) {
    const { audit, printAudit } = await import('./swebench-audit.mjs')
    const report = audit(argv[1], SUITE)
    if (argv.includes('--json')) console.log(JSON.stringify(report, null, 1))
    else printAudit(report)
  } else if (command === 'check' && argv[1]) {
    const dir = (await import('./swebench-audit.mjs')).runDirectory(argv[1])
    const tasks = new Map(listTasks().map(task => [task.id, task]))
    const lines = readIf(path.join(dir, 'predictions.jsonl')).split('\n').filter(Boolean).map(line => JSON.parse(line))
    const counts = { applies: 0, empty: 0, bad: 0 }
    const seen = new Set()
    for (const line of lines) {
      const task = tasks.get(line.instance_id)
      let verdict
      if (!task || seen.has(line.instance_id) || typeof line.model_patch !== 'string' || typeof line.model_name_or_path !== 'string') verdict = 'bad: not a prediction of a known instance, or a repeated one'
      else if (line.model_patch === '') verdict = 'empty'
      else {
        const workspace = path.join(dir, 'check', task.name)
        await prepare(task, workspace)
        verdict = await git(['apply', '--check', '-'], { cwd: workspace, input: line.model_patch }).then(() => 'applies', error => `bad: ${error.message}`)
        tidy(workspace)
      }
      seen.add(line.instance_id)
      counts[verdict.split(':')[0]] += 1
      console.log(`${String(line.instance_id).padEnd(36)} ${String(Buffer.byteLength(line.model_patch ?? '')).padStart(7)} B  ${verdict}`)
    }
    fs.rmSync(path.join(dir, 'check'), { recursive: true, force: true })
    console.log(`${lines.length} prediction(s): ${counts.applies} apply to a fresh checkout, ${counts.empty} empty, ${counts.bad} bad`)
    process.exitCode = counts.bad === 0 ? 0 : 1
  } else {
    console.error('usage: node bench/lib/swebench.mjs fetch | repos [--subset mini] | toolchains | checkouts [--subset mini] [--concurrency N] | check <run> | seal [instance id] | audit <run> [--json]')
    process.exitCode = 2
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2))
