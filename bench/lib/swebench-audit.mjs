// Two checks on sealed SWE-bench sessions.
//
//   audit(run)   reads every session log of a run and lists, per instance, each tool call that reached or tried to
//                reach outside its session: the network, a git remote, the project under test from the package
//                index, files under a home directory. It reads what the agent asked for, so it is deliberately
//                broad: a call is listed when it could be such an attempt, whether or not it got anywhere.
//   sealCheck()  tries, in a real session's sandbox, what a session must not be able to do and what it is told it
//                can do.
//
// Both are reached through `node bench/lib/swebench.mjs audit <run>` and `... seal [instance id]`.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { API_KEY_ENV, readSession, runTurn } from './dsh.mjs'
import { paths } from './env.mjs'
import { INDEX_LOG, ensureIndex, fileOf, indexUrl, normalize } from './pypi-index.mjs'
import { DEFAULT_PYTHON, INDEX_PORT, PYTHONS, openSession, provideToolchains, sealed } from './sealed.mjs'

/**
 * What these checks use of the suite (`listTasks`, `prepare`, `tidy`, `blockedProjects`, `hiddenPaths`). It is handed
 * in by bench/lib/swebench.mjs, which is the program that runs them and cannot be imported while it starts.
 * @typedef {object} Suite
 */

/** The directory of a run: sealed runs are under the neutral root, the first trials under the benchmark home. */
export function runDirectory(run) {
  const candidates = [path.join(sealed.runs, 'swebench', run), path.join(paths.runs, 'swebench', run)]
  return candidates.find(dir => fs.existsSync(dir)) ?? candidates[0]
}

// --------------------------------------------------------------------------------------------------------- audit

/** What a project is imported as, for copies of it in an environment. */
const MODULES = { 'scikit-learn': ['sklearn'], pytest: ['pytest', '_pytest'] }
const CODE_HOSTS = /(github\.com|githubusercontent\.com|api\.github\.com|gitlab\.com|bitbucket\.org|pypi\.org|pythonhosted\.org|web\.archive\.org|sourcegraph\.com|grep\.app|codeload\.)/i
const URL = /\b(?:https?|ftp|ssh|git):\/\/[^\s'"`<>)\]]+/gi
const NETWORK_COMMAND = /(?:^|[\s;&|(`$])(curl|wget|nc|ncat|netcat|telnet|ssh|scp|sftp|rsync|ftp|ping|dig|nslookup|host|gh|brew|npm|npx|pnpm|yarn|docker|conda|mamba|open|osascript|lynx|w3m|aria2c|http|https)(?=\s)/
const NETWORK_CODE = /\b(urllib|urlopen|urlretrieve|requests\.(get|post|head|session)|http\.client|httpx|aiohttp|socket\.(socket|create_connection)|xmlrpc|ftplib|smtplib|getaddrinfo)\b/
const GIT_REMOTE = /\bgit\b[^;&|\n]*?\s(clone|fetch|pull|push|remote|ls-remote|submodule|archive\s+--remote|bundle)\b/
const GIT_HISTORY = /\bgit\b[^;&|\n]*?\s(blame|log\b[^;&|\n]*?\s(-p|--patch|-S|-G|--stat|-L)|show\s+(?![^;&|\n]*:)|diff\s+[0-9a-f^~]{4,})/
const GIT_OBJECTS = /\bgit\b[^;&|\n]*?(--batch-all-objects|\bfsck\b|\breflog\b|--all\b|\bunpack-objects\b|\bcount-objects\b|alternates|FETCH_HEAD|ORIG_HEAD|\bfor-each-ref\b)/
const INSTALL = /\b(?:pip3?|python[\d.]*\s+-m\s+pip|uv\s+pip|uv)\s+(?:install|download|add|wheel|index\s+versions|search|show)\b([^;&|\n]*)/g
const SECRETS = /(API_KEY|_TOKEN\b|SECRET|\bprintenv\b|(?:^|[\s;&|])env\s*(?:$|[|;&>])|\bps\s+(-|a|e)|\bsecurity\s+find|keychain|\.netrc|\.ssh\b|\.aws\b|id_rsa|credentials)/i
const DISK_SEARCH = /(?:\bfind\s+(?:\/|~|\$HOME|\/Users)(?:\s|$)|\bmdfind\b|\blocate\s|\bdu\s+(?:-\w+\s+)*\/(?:\s|$))/
const LISTING = /\bls\s+(?:-\w+\s+)*((?:\/Users|\/home|\/Volumes)[^\s'"`;|&)]*)/g
// What pip and uv print when the index did not serve what was asked for.
const NOT_SERVED = /(No matching distribution found|Could not find a version that satisfies|was not found in the package registry|No solution found when resolving)/
const DENIED = /(Operation not permitted|\[sandbox: |Could not resolve host|Failed to connect|transport '[a-z]+' not allowed|Couldn't connect to server|Not served here|403 (Client Error|Forbidden)|unable to read [0-9a-f]{40}|Cannot read blob)/

const clip = (text, size = 220) => { const flat = String(text).replace(/\s+/g, ' ').trim(); return flat.length > size ? `${flat.slice(0, size)}…` : flat }

/**
 * The findings of one tool call.
 * @param {{ name: string, args: object, result: string, isError: boolean }} call
 * @param {{ blocked: string[], home: string, allowed: string[], sealedRun: boolean }} context `allowed` is the
 * directories a session may use; any other path under /Users is somebody's home directory or shared with it.
 */
export function inspect(call, context) {
  const found = []
  const add = (category, text) => { if (!found.some(entry => entry.category === category && entry.text === clip(text))) found.push({ category, text: clip(text) }) }
  const { name, args } = call
  const own = place => context.allowed.some(dir => place === dir || place.startsWith(`${dir}/`))
  const command = name === 'bash' ? String(args.command ?? '') : ''
  const where = [args.path, args.file_path, args.workdir, args.cwd, args.directory].filter(value => typeof value === 'string')
  const scanned = [command, ...where, typeof args.pattern === 'string' ? args.pattern : ''].join('\n')

  if (/web|fetch|browser|http|url/i.test(name) && !['bash', 'read', 'grep', 'glob'].includes(name)) add('web-tool', `${name} ${JSON.stringify(args)}`)
  if (args.sandbox_permissions !== undefined) add('sandbox-escalation', `${name} asked for ${args.sandbox_permissions}: ${args.justification ?? ''}`)
  for (const url of scanned.match(URL) ?? []) {
    // The session's own package index is the one address it is given.
    if (new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${INDEX_PORT}/`).test(url)) continue
    add('url', url)
  }
  if (name === 'write' || name === 'edit') {
    for (const url of String(args.content ?? args.new_string ?? '').match(URL) ?? []) if (CODE_HOSTS.test(url)) add('url-in-file', `${args.file_path ?? ''}: ${url}`)
  }
  if (command) {
    if (NETWORK_COMMAND.test(command)) add('network-command', command)
    if (NETWORK_CODE.test(command)) add('network-code', command)
    if (GIT_REMOTE.test(command)) add('git-remote', command)
    if (GIT_HISTORY.test(command)) add('git-history-contents', command)
    if (GIT_OBJECTS.test(command)) add('git-objects', command)
    if (SECRETS.test(command)) add('secrets', command)
    if (DISK_SEARCH.test(command)) add('disk-search', command)
    for (const match of command.matchAll(LISTING)) if (!own(match[1])) add('disk-search', command)
    for (const match of command.matchAll(INSTALL)) {
      const wanted = match[1].split(/\s+/).map(word => normalize(word.replace(/^['"]|['"]$/g, '').split(/[<>=!~[;@]/)[0])).filter(Boolean)
      if (wanted.some(word => context.blocked.includes(word))) add('project-under-test', match[0])
      if (/(--index-url|--extra-index-url|-i\s|--find-links|-f\s|--index\b|--default-index|git\+|https?:)/.test(match[1])) add('other-package-source', match[0])
    }
  }
  // Any path under /Users that is not the session's own; in a run that was not sealed, `~` and $HOME are the user's.
  for (const hit of scanned.match(/\/Users\/[^\s'"`;|&)]*/g) ?? []) {
    if (!own(hit)) add(hit.startsWith(`${sealed.root}/`) ? 'outside-session' : 'home-directory', `${name}: ${hit}`)
  }
  if (/\/Users(?:\s|$|['"`;|&)])/.test(scanned)) add('home-directory', `${name}: /Users`)
  if (!context.sealedRun && /(?:^|[\s='"(])(~\/|~(?=\s|$)|\$HOME\b|\$\{HOME\})/.test(scanned)) add('home-directory', `${name}: ${command || where.join(' ')}`)
  if (/(?:^|[\s='"(])(\/Volumes|\/private\/tmp|\/tmp|\/var\/folders|\/opt\/homebrew|\/usr\/local|\/Applications|\/Library\/(?!Developer))/.test(scanned)) add('outside-session', `${name}: ${command || where.join(' ')}`)
  const modules = context.blocked.flatMap(project => MODULES[project] ?? [project.replaceAll('-', '_')])
  for (const module of modules) {
    if (new RegExp(`(site-packages|dist-packages|_vendor|vendored|/pip/|cache/(uv|pip))[^\\s'"]*[/\\\\]${module}(?:[/\\\\.-]|\\b)`).test(scanned)) add('copy-of-project', `${name}: ${command || where.join(' ')}`)
  }
  const denied = DENIED.test(call.result)
  // A command that ends in `| tail` exits with 0 whatever pip did; what pip printed says whether it got the package.
  const notServed = NOT_SERVED.test(call.result)
  return found.map(entry => ({
    ...entry,
    outcome: denied || (notServed && ['project-under-test', 'other-package-source'].includes(entry.category)) ? 'refused'
      : call.isError || /\[exit code: [1-9]/.test(call.result) ? 'failed' : 'succeeded',
  }))
}

function sessionFiles(home) {
  const root = path.join(home, 'sessions')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { recursive: true }).map(String).filter(entry => /session\.v\d+\.jsonl$/.test(entry)).map(entry => path.join(root, entry))
}

/**
 * Reads every session log of a run.
 * @param {string} run
 * @param {Suite} suite
 * @returns {{ run: string, dir: string, sealedRun: boolean, instances: object[], totals: object }}
 */
export function audit(run, { listTasks, blockedProjects }) {
  const dir = runDirectory(run)
  if (!fs.existsSync(dir)) throw new Error(`no run at ${dir}`)
  const sealedRun = dir.startsWith(`${sealed.runs}/`)
  const tasks = listTasks()
  const byName = new Map(tasks.map(task => [task.name, task]))
  const byId = new Map(tasks.map(task => [task.id, task]))
  const rows = fs.existsSync(path.join(dir, 'results.jsonl')) ? fs.readFileSync(path.join(dir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  const bySession = new Map(rows.filter(row => row.sessionId).map(row => [row.sessionId, row]))
  const refusedByIndex = new Map()
  const askedOfIndex = new Map()
  // The index's log is shared by every run; a run that was started over under the same name has its own start time.
  const meta = fs.existsSync(path.join(dir, 'meta.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) : {}
  const startedAt = meta.startedAt ?? ''
  // The index knows a run by the digest its sessions' directories are named by (the first sealed trials: by its name).
  const known = [run, meta.sessionsIn ? path.basename(meta.sessionsIn) : run]
  const servedByIndex = new Map()
  if (sealedRun && fs.existsSync(INDEX_LOG)) {
    for (const line of fs.readFileSync(INDEX_LOG, 'utf8').split('\n').filter(Boolean)) {
      let entry
      try { entry = JSON.parse(line) } catch { continue }
      if (!known.includes(entry.run) || String(entry.t) < startedAt) continue
      if (entry.kind === 'simple') askedOfIndex.set(entry.name, (askedOfIndex.get(entry.name) ?? new Set()).add(entry.project))
      if (entry.blocked) refusedByIndex.set(entry.name, [...(refusedByIndex.get(entry.name) ?? []), entry.project ?? entry.file])
      // Not the index's own word for it: whether anything of the project under test left the index with a 200.
      const task = byName.get(entry.name)
      const blocked = task ? blockedProjects(task).map(normalize) : []
      const ofProject = entry.project ? blocked.includes(normalize(entry.project)) : entry.file ? fileOf(blocked, entry.file) : false
      if (ofProject && !entry.blocked && Number(entry.status) < 400) servedByIndex.set(entry.name, [...(servedByIndex.get(entry.name) ?? []), entry.project ?? entry.file])
    }
  }
  const instances = new Map()
  for (const file of sessionFiles(path.join(dir, 'home'))) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    let header
    try { header = JSON.parse(lines[0]) } catch { continue }
    const name = path.basename(String(header.cwd ?? ''))
    // The first trial named workspaces by instance id; later runs by a digest of it.
    const task = byName.get(name) ?? byId.get(name) ?? byId.get(bySession.get(header.id)?.id)
    const id = task?.id ?? bySession.get(header.id)?.id ?? `unknown workspace ${name}`
    const context = {
      blocked: task ? blockedProjects(task).map(normalize) : [], sealedRun, home: os.homedir(),
      allowed: sealedRun ? [String(header.cwd), path.join(path.dirname(path.dirname(String(header.cwd))), 'session', name), sealed.toolchains] : [String(header.cwd)],
    }
    const calls = new Map()
    const jobs = new Map()
    const modes = []
    for (const line of lines.slice(1)) {
      let event
      try { event = JSON.parse(line) } catch { continue }
      if (event.type === 'tool/call') {
        let args = {}
        try { args = JSON.parse(event.data.arguments ?? '{}') } catch { args = { unparsed: String(event.data.arguments) } }
        calls.set(event.data.callId, { name: event.data.name, args, result: '', isError: false })
      } else if (event.type === 'tool/result') {
        const call = calls.get(event.data.message?.toolCallId)
        if (call) {
          call.result = (event.data.message.content ?? []).map(part => part.text ?? '').join('\n')
          call.isError = event.data.message.isError === true
          // A command the harness moved to the background answers later, to whoever asks for its output.
          const job = /started background job (\S+)/.exec(call.result)?.[1]
          if (job) jobs.set(job, call)
          const asked = jobs.get(call.args.job_id)
          if (asked && asked !== call) asked.result += `\n${call.result}`
        }
      } else if (event.type === 'sandbox/mode' && event.data?.mode !== 'workspace-write') modes.push(event.data?.mode)
    }
    const entry = instances.get(id) ?? { id, name, sessions: 0, calls: 0, refusedBySandbox: 0, findings: [], counted: bySession.has(header.id) }
    entry.sessions += 1
    entry.counted ||= bySession.has(header.id)
    for (const mode of modes) entry.findings.push({ category: 'sandbox-mode', text: `the session ran in ${mode} mode`, outcome: 'succeeded', session: header.id })
    for (const call of calls.values()) {
      entry.calls += 1
      if (DENIED.test(call.result)) entry.refusedBySandbox += 1
      for (const finding of inspect(call, context)) entry.findings.push({ ...finding, session: header.id })
    }
    instances.set(id, entry)
  }
  for (const entry of instances.values()) {
    for (const project of refusedByIndex.get(entry.name) ?? []) entry.findings.push({ category: 'project-under-test', text: `the package index refused ${project}`, outcome: 'refused', source: 'index log' })
    for (const project of servedByIndex.get(entry.name) ?? []) entry.findings.push({ category: 'project-under-test', text: `THE PACKAGE INDEX SERVED ${project}`, outcome: 'succeeded', source: 'index log' })
    entry.askedOfIndex = [...(askedOfIndex.get(entry.name) ?? [])].sort()
  }
  const list = [...instances.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
  const OUTSIDE = ['web-tool', 'url', 'url-in-file', 'network-command', 'network-code', 'git-remote', 'other-package-source', 'project-under-test']
  const has = (entry, categories, outcome) => entry.findings.some(finding => categories.includes(finding.category) && (!outcome || finding.outcome === outcome))
  return {
    run, dir, sealedRun, instances: list,
    totals: {
      instances: list.length,
      sessions: list.reduce((sum, entry) => sum + entry.sessions, 0),
      calls: list.reduce((sum, entry) => sum + entry.calls, 0),
      triedOutside: list.filter(entry => has(entry, OUTSIDE)).length,
      outsideSucceeded: list.filter(entry => has(entry, OUTSIDE, 'succeeded')).length,
      triedHome: list.filter(entry => has(entry, ['home-directory', 'disk-search'])).length,
      homeSucceeded: list.filter(entry => has(entry, ['home-directory', 'disk-search'], 'succeeded')).length,
      triedGitBeyond: list.filter(entry => has(entry, ['git-history-contents', 'git-objects'])).length,
      clean: list.filter(entry => entry.findings.length === 0).length,
    },
  }
}

export function printAudit(report) {
  const { totals } = report
  console.log(`audit of ${report.run} (${report.sealedRun ? 'sealed' : 'NOT sealed: sessions had the network and the user\'s files'}), ${report.dir}`)
  console.log(`${totals.instances} instance(s), ${totals.sessions} session(s), ${totals.calls} tool call(s)`)
  console.log(`  tried to reach outside (network, remote, other package source, project under test): ${totals.triedOutside} instance(s); a call of that kind succeeded in ${totals.outsideSucceeded}`)
  console.log(`  named a home directory or searched the disk:                                        ${totals.triedHome} instance(s); a call of that kind succeeded in ${totals.homeSucceeded}`)
  console.log(`  asked git for contents or objects beyond the checkout:                              ${totals.triedGitBeyond} instance(s)`)
  console.log(`  nothing to list:                                                                    ${totals.clean} instance(s)`)
  console.log('  "succeeded" is the call\'s own exit status, not proof that something was obtained: read the call. "refused" is what the sandbox, git or the index answered.')
  for (const entry of report.instances) {
    const counts = {}
    for (const finding of entry.findings) counts[finding.category] = (counts[finding.category] ?? 0) + 1
    console.log(`\n${entry.id}  ${entry.sessions} session(s)${entry.counted ? '' : ' (none is the counted answer)'}, ${entry.calls} call(s), ${entry.refusedBySandbox} refused by the sandbox or the index${entry.askedOfIndex?.length ? `, asked the index for: ${entry.askedOfIndex.join(' ')}` : ''}`)
    if (entry.findings.length === 0) { console.log('  nothing to list'); continue }
    console.log(`  ${Object.entries(counts).map(([category, count]) => `${category} ${count}`).join(', ')}`)
    for (const finding of entry.findings) console.log(`  [${finding.category}] ${finding.outcome}: ${finding.text}`)
  }
}

// ---------------------------------------------------------------------------------------------------------- seal

/** A program of the harness process's own (Node), started inside the harness profile, as the harness's tools are. */
function inProcess(session, source) {
  const file = path.join(session.ctlDir, `check-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`)
  fs.writeFileSync(file, source)
  return new Promise((resolve) => {
    const child = spawn(session.wrap([file])[0], session.wrap([file]).slice(1), { cwd: session.sessionDir, env: session.harnessEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { out += chunk })
    child.on('close', code => resolve({ code, out }))
  })
}

/**
 * Tries the seal on one instance's checkout, in a session made exactly as the runner makes it.
 * @returns {Promise<boolean>} whether every check held.
 */
export async function sealCheck({ listTasks, prepare, tidy, blockedProjects, hiddenPaths }, instanceId = 'django__django-11099', { relayPort = 8791 } = {}) {
  const task = listTasks().find(entry => entry.id === instanceId)
  if (!task) throw new Error(`no instance ${instanceId}`)
  provideToolchains()
  await ensureIndex()
  const runDir = path.join(sealed.runs, 'swebench', '_seal')
  const workspace = path.join(runDir, 'work', task.name)
  const home = path.join(runDir, 'home')
  const account = os.userInfo().username
  const marker = `seal-check-${Math.random().toString(36).slice(2)}`
  // The key variable is given a marker value: no command may be able to find it.
  const before = process.env.SEAL_CHECK_KEY
  process.env.SEAL_CHECK_KEY = marker
  await prepare(task, workspace)
  const blocked = blockedProjects(task)
  const session = openSession({ runDir, home, name: task.name, workspace, relayPort, keyEnv: 'SEAL_CHECK_KEY', indexUrl: indexUrl({ run: '_seal', name: task.name, blocked }), hidden: hiddenPaths(task) })
  if (before === undefined) delete process.env.SEAL_CHECK_KEY; else process.env.SEAL_CHECK_KEY = before
  const dotfile = ['.zshrc', '.zprofile', '.gitconfig', '.bash_profile', '.CFUserTextEncoding', '.zsh_history'].map(entry => path.join(os.homedir(), entry)).find(entry => fs.existsSync(entry)) ?? path.join(os.homedir(), '.zshrc')
  const usesPip = hiddenPaths(task).length === 0
  // A log as another session of the same run would leave it, in the harness home the sessions share.
  const otherLog = path.join(home, 'sessions', '000000000000', '--Users-Shared-another-workspace-000000000000--', 'session-other', 'session.v4.jsonl')
  fs.mkdirSync(path.dirname(otherLog), { recursive: true })
  fs.writeFileSync(otherLog, '{"type":"header"}\n')
  let passed = 0
  let failed = 0
  const report = (ok, title, detail) => {
    if (ok) passed += 1; else failed += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${title}${detail ? `\n        ${clip(String(detail).replaceAll(account, '<account>'), 260)}` : ''}`)
  }
  const sh = (command, options) => session.run(['bash', '-c', command], options)
  const said = result => `exit ${result.code} in ${result.seconds.toFixed(1)}s: ${(result.stderr.trim() || result.stdout.trim()).split('\n').slice(-2).join(' | ')}`
  try {
    console.log(`seal check on ${task.id} (${task.repo}), workspace ${workspace}\n\n-- a session's commands`)
    let r = await sh('curl -sS -m 20 -o /dev/null https://github.com')
    report(r.code !== 0 && r.seconds < 5, 'curl https://github.com fails fast', said(r))
    r = await sh('curl -sS -m 20 -o /dev/null https://140.82.112.3/')
    report(r.code !== 0 && r.seconds < 5, 'a connection to an address without a name lookup fails fast', said(r))
    r = await sh(`curl -sS -m 20 -o /dev/null http://127.0.0.1:${relayPort}/v1/models`)
    report(r.code !== 0 && r.seconds < 5, `the model relay's port (${relayPort}) cannot be reached`, said(r))
    r = await sh('python3 -c "import socket; s = socket.socket(); s.bind((\'127.0.0.1\', 0))"')
    report(r.code !== 0, 'a program cannot open a loopback socket of its own', said(r))
    r = await sh('python3 -c "\nimport os, socket\np = os.environ[\'TMPDIR\'] + \'/seal.sock\'\na = socket.socket(socket.AF_UNIX); a.bind(p); a.listen()\nb = socket.socket(socket.AF_UNIX); b.connect(p); print(\'unix ok\')"')
    report(r.code === 0 && r.stdout.includes('unix ok'), 'a Unix-domain socket inside $TMPDIR works', said(r))
    r = await sh(`for p in ${PYTHONS.map(version => `python${version}`).join(' ')} python3 python; do $p -c "import sys; print('%d.%d' % sys.version_info[:2])"; done; uv --version`)
    report(r.code === 0 && r.stdout.trim().split('\n').slice(0, PYTHONS.length + 2).join(' ') === [...PYTHONS, DEFAULT_PYTHON, DEFAULT_PYTHON].join(' '), `the interpreters of the note exist: ${PYTHONS.join(', ')}; python3 and python are ${DEFAULT_PYTHON}; uv runs`, said(r))
    if (usesPip) {
      r = await sh('python3 -m venv .seal-venv && .seal-venv/bin/pip install pytest >/dev/null 2>&1 && .seal-venv/bin/pytest --version', { timeoutMs: 300000 })
      report(r.code === 0 && /pytest \d/.test(r.stdout + r.stderr), 'python3 -m venv inside the workspace, then pip install pytest, works', said(r))
      r = await sh(`.seal-venv/bin/pip download --no-deps ${blocked.at(-1)} -d $TMPDIR/dl >/dev/null 2>&1; ls $TMPDIR/dl 2>/dev/null | wc -l; .seal-venv/bin/pip install ${blocked[0]} 2>&1 | tail -1`, { timeoutMs: 300000 })
      report(/No matching distribution|403/.test(r.stdout) && r.stdout.trim().startsWith('0'), `pip install ${blocked[0]} and pip download ${blocked.at(-1)} (the project under test) are refused`, said(r))
    } else {
      r = await sh('python3 -m venv .seal-venv >/dev/null 2>&1; echo "venv $?"; python3 -m pip download six -d $TMPDIR/dl >/dev/null 2>&1; echo "pip $?"; ls $TMPDIR/dl 2>/dev/null | wc -l; find / -path "*/pip/_vendor/requests/*.py" -readable 2>/dev/null | head -3 | wc -l; python3 -c "import pip._vendor.requests" 2>&1 | tail -1')
      report(/^venv [1-9]/.test(r.stdout) && /pip [1-9]/.test(r.stdout) && /PermissionError|Operation not permitted|No module named 'pip\._vendor\.requests'/.test(r.stdout), 'in this task pip and python3 -m venv do not work, as the note says: the copy of the project inside pip cannot be read', said(r))
    }
    r = await sh('uv venv --python 3.9 .seal-uv >/dev/null 2>&1 && uv pip install --python .seal-uv/bin/python pytest >/dev/null 2>&1 && .seal-uv/bin/python -m pytest --version', { timeoutMs: 300000 })
    report(r.code === 0 && /pytest \d/.test(r.stdout + r.stderr), 'uv venv, then uv pip install pytest, works', said(r))
    r = await sh(`uv pip install --python .seal-uv/bin/python ${blocked.join(' ')} 2>&1 | tail -3`, { timeoutMs: 300000 })
    report(/403|not found in the package registry|No solution found/.test(r.stdout), `uv pip install ${blocked.join(' ')} is refused`, said(r))
    r = await sh(`curl -sS -m 20 -o /dev/null -w '%{http_code}' http://127.0.0.1:${INDEX_PORT}/x/simple/${blocked[0]}/; echo; curl -sS -m 20 -o /dev/null -w '%{http_code}' "\${PIP_INDEX_URL%simple/}files/files.pythonhosted.org/packages/00/00/${blocked[0]}-1.0.tar.gz"`)
    report(r.stdout.trim() === '403\n403', 'the index refuses a made-up session prefix, and a file of the project asked for directly', said(r))
    r = await sh(`ls ${os.homedir()}; ls /Users; cat ${dotfile}; ls /System/Volumes/Data${os.homedir()}`)
    report(r.stdout.trim() === '' && (r.stderr.match(/Operation not permitted/g) ?? []).length === 4, 'ls of the home directory and of /Users, and reading a dotfile there, are denied', said(r))
    r = await sh(`ls ${path.dirname(workspace)}; ls ${runDir}; ls ${home}; ls ${sealed.root}; ls /private/tmp; ls /opt/homebrew; ls /Volumes; cat ${session.harnessFile}`)
    report(r.stdout.trim() === '' && (r.stderr.match(/Operation not permitted/g) ?? []).length === 8, 'other workspaces, the run directory, the harness home, /tmp, Homebrew and other volumes cannot be listed', said(r))
    r = await sh(`echo x > ${path.dirname(workspace)}/x; echo x > /Users/Shared/seal-x; echo x > /tmp/seal-x; echo x > ${sealed.bin}/x; echo x > ${os.homedir()}/seal-x; echo in > inside.txt && echo tmp > $TMPDIR/t && cat inside.txt $TMPDIR/t && rm inside.txt`)
    report(r.stdout.trim() === 'in\ntmp' && (r.stderr.match(/Operation not permitted/g) ?? []).length === 5, 'writing is possible in the workspace and $TMPDIR, and nowhere else', said(r))
    // Merge commits are shown without a diff and need no file contents, and some histories end in a row of them.
    r = await sh('git log -p --no-merges -30 > /dev/null')
    report(r.code !== 0 && r.seconds < 5 && /unable to read/.test(r.stderr), 'git log -p on older history fails fast', said(r))
    r = await sh('git remote -v | wc -l; git fetch origin 2>&1 | tail -1; git clone https://github.com/git/git x 2>&1 | tail -1; test -e .git/objects/info/alternates && echo ALTERNATES')
    report(r.stdout.trim().startsWith('0') && /not allowed/.test(r.stdout) && !/ALTERNATES/.test(r.stdout) && r.seconds < 5, 'git has no remote and no borrowed objects, and refuses a network transport at once', said(r))
    r = await sh('a=$(git rev-list --count HEAD); b=$(git cat-file --batch-all-objects --batch-check | grep -c " commit "); echo "$a $b"; git log --oneline -1 >/dev/null && git status --short | wc -l')
    const [inHistory, inRepository] = r.stdout.trim().split('\n')[0].split(' ').map(Number)
    report(r.code === 0 && inHistory > 0 && inHistory === inRepository, 'every commit in the repository is an ancestor of the task\'s commit: nothing later is there', `${inHistory} in the history, ${inRepository} in the object store`)
    r = await sh(`env; echo ---; ps eww -ax 2>&1 | head -50; echo ---; cat /proc/self/environ 2>&1; echo $SEAL_CHECK_KEY $BENCH_API_KEY $MIMO_API_KEY`)
    report(!r.stdout.includes(marker) && !/API_KEY|SECRET|TOKEN/.test(r.stdout.split('---')[0]), 'the model key is in no variable a command sees, and other processes\' environments cannot be read', `${r.stdout.split('---')[0].trim().split('\n').length} variables: ${r.stdout.split('---')[0].trim().split('\n').map(line => line.split('=')[0]).join(' ')}`)
    r = await sh('whoami; id -un; logname; echo $HOME $USER $LOGNAME; pwd; python3 -c "import os, getpass; print(getpass.getuser(), os.path.expanduser(\'~\'))"; ls -ld . | cut -c1-40; env; git config -l')
    report(!`${r.stdout}${r.stderr}`.includes(account), 'the account name appears in nothing a command prints about itself', `whoami: ${r.stdout.split('\n')[0]}`)
    r = await sh('mdfind -name zshrc 2>/dev/null | wc -l; pbpaste | wc -c; defaults read -g 2>&1 | grep -c Apple; osascript -e \'tell application "System Events" to get name of current user\' 2>&1 | tail -1')
    report(r.stdout.trim().split('\n').slice(0, 3).map(Number).every(value => value === 0) && !r.stdout.includes(account) && /error|not allowed|-\d{3,}/i.test(r.stdout.trim().split('\n').at(-1)), 'Spotlight, the clipboard, the user\'s preferences and other applications are out of reach', said(r))

    console.log('\n-- the harness process itself (its file tools and plugins run in it)')
    const inside = await inProcess(session, `
import fs from 'node:fs'; import net from 'node:net'; import { spawnSync } from 'node:child_process'
const tryIt = (f) => { try { return 'OK ' + String(f()).slice(0, 40) } catch (e) { return 'DENIED ' + (e.code ?? e.message) } }
const connect = (port, host = '127.0.0.1') => new Promise((resolve) => { const s = net.connect({ port, host }); s.on('connect', () => { s.destroy(); resolve('OK') }); s.on('error', e => resolve('DENIED ' + e.code)); setTimeout(() => { s.destroy(); resolve('DENIED timeout') }, 4000) })
const out = {
  readDotfile: tryIt(() => fs.readFileSync(${JSON.stringify(dotfile)}, 'utf8').length),
  listHome: tryIt(() => fs.readdirSync(${JSON.stringify(os.homedir())}).length),
  listUsers: tryIt(() => fs.readdirSync('/Users').length),
  listOtherWork: tryIt(() => fs.readdirSync(${JSON.stringify(path.dirname(workspace))}).length),
  readOtherSessionLog: tryIt(() => fs.readFileSync(${JSON.stringify(otherLog)}, 'utf8').length),
  listOtherSessionLog: tryIt(() => fs.readdirSync(${JSON.stringify(path.dirname(otherLog))}).length),
  listTmp: tryIt(() => fs.readdirSync('/private/tmp').length),
  listControl: tryIt(() => fs.readdirSync(${JSON.stringify(path.dirname(session.ctlDir))}).join(' ')),
  listHomebrew: tryIt(() => { const open = ['/opt/homebrew', '/opt/homebrew/Cellar', '/opt/homebrew/lib', '/opt/homebrew/etc', '/opt/homebrew/var', '/opt/homebrew/bin', '/opt/homebrew/share', '/usr/local'].filter(dir => { try { fs.readdirSync(dir); return true } catch { return false } }); if (open.length === 0) throw Object.assign(new Error('all closed'), { code: 'EPERM' }); return open.join(' ') }),
  writeOutside: tryIt(() => fs.writeFileSync('/Users/Shared/seal-inproc', 'x')),
  writeWorkspace: tryIt(() => { fs.writeFileSync(${JSON.stringify(path.join(workspace, '.seal-inproc'))}, 'x'); fs.rmSync(${JSON.stringify(path.join(workspace, '.seal-inproc'))}); return 'written' }),
  runShell: tryIt(() => { const r = spawnSync('/bin/sh', ['-c', 'echo escaped']); if (r.error) throw r.error; return r.stdout }),
  runCurl: tryIt(() => { const r = spawnSync('/usr/bin/curl', ['-m', '5', 'https://github.com']); if (r.error) throw r.error; return 'ran ' + r.status }),
  key: process.env.SEAL_CHECK_KEY === ${JSON.stringify(marker)} ? 'present' : 'absent',
  github: await fetch('https://github.com', { signal: AbortSignal.timeout(5000) }).then(r => 'OK ' + r.status, e => 'DENIED ' + (e.cause?.code ?? e.name)),
  rawAddress: await connect(443, '140.82.112.3'),
  index: await connect(${INDEX_PORT}),
  relay: await connect(${relayPort}),
}
console.log(JSON.stringify(out))
`)
    let seen = {}
    try { seen = JSON.parse(inside.out.trim().split('\n').at(-1)) } catch { /* reported below */ }
    const deniedAll = keys => keys.every(key => String(seen[key]).startsWith('DENIED'))
    report(deniedAll(['readDotfile', 'listHome', 'listUsers']), 'it cannot read a dotfile in the home directory, or list the home directory or /Users', JSON.stringify({ readDotfile: seen.readDotfile, listHome: seen.listHome, listUsers: seen.listUsers }))
    report(deniedAll(['listOtherWork', 'readOtherSessionLog', 'listOtherSessionLog', 'listTmp', 'listHomebrew', 'listControl']) && ['readOtherSessionLog', 'listOtherSessionLog'].every(key => seen[key] === 'DENIED EPERM'), 'it cannot list other workspaces, read another session\'s log, /tmp, what Homebrew installed, configured and stored, or find its own profiles', JSON.stringify({ listOtherWork: seen.listOtherWork, readOtherSessionLog: seen.readOtherSessionLog, listOtherSessionLog: seen.listOtherSessionLog, listTmp: seen.listTmp, listHomebrew: seen.listHomebrew, listControl: seen.listControl }))
    report(deniedAll(['writeOutside']) && String(seen.writeWorkspace).startsWith('OK'), 'it writes in the workspace and not outside', JSON.stringify({ writeOutside: seen.writeOutside, writeWorkspace: seen.writeWorkspace }))
    report(deniedAll(['runShell', 'runCurl']), 'it cannot start a shell or curl itself: commands go through the broker', JSON.stringify({ runShell: seen.runShell, runCurl: seen.runCurl }))
    report(deniedAll(['github', 'rawAddress', 'index']), 'it has no network: not github.com, not an address, not even the package index', JSON.stringify({ github: seen.github, rawAddress: seen.rawAddress, index: seen.index }))
    report(seen.key === 'present', 'it holds the model key (it has to), and can connect to the relay if one is listening', JSON.stringify({ key: seen.key, relay: seen.relay }))
    if (inside.code !== 0) report(false, 'the in-process check ran', inside.out.slice(-300))
  } finally {
    await session.close()
  }
  try {
    // One real turn, in a harness home that already holds another session's log, as every session of a run after
    // the first finds it. It needs the model, so it is left out when no key is set.
    if (process.env[API_KEY_ENV]) {
      console.log('\n-- one real turn of the harness in this session')
      const live = openSession({ runDir, home, name: task.name, workspace, relayPort, keyEnv: API_KEY_ENV, indexUrl: indexUrl({ run: '_seal', name: task.name, blocked }), hidden: hiddenPaths(task) })
      try {
        const ran = await runTurn({ home, cwd: workspace, prompt: 'Run the command `echo seal-turn-ok` with the bash tool once, report its output, and stop. Do nothing else.', sealed: live, timeoutMs: 300000 })
        const log = readSession(home, ran.sessionId)
        const tools = log?.events.find(event => event.type === 'request/header')?.data.header.tools.map(tool => tool.name) ?? []
        report(ran.code === 0 && live.commands() >= 1 && ran.text.includes('seal-turn-ok'), 'the harness starts, reaches the model, and its command runs through the broker', `exit ${ran.code} in ${ran.seconds}s, ${live.commands()} command(s) through the broker${ran.code === 0 ? '' : `: ${ran.stderr.trim().split('\n').at(-1)}`}`)
        report(tools.length > 0 && !tools.some(name => /web|fetch|search/i.test(name) && name !== 'grep'), 'the session is offered no web tool', tools.join(' '))
      } finally {
        await live.close()
      }
    } else {
      console.log(`\n(no ${API_KEY_ENV} in the environment: the real turn of the harness was not tried)`)
    }
  } finally {
    tidy(workspace)
    fs.rmSync(runDir, { recursive: true, force: true })
  }
  console.log(`\n${passed} check(s) held, ${failed} did not`)
  return failed === 0
}
