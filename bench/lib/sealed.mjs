// Sealed sessions: what a SWE-bench session may reach, and how that is enforced (macOS).
//
// A session must not be able to obtain the fix of its task, and must not read the user's files. Three layers:
//
//   1. The `dsh` process itself runs under a Seatbelt profile (`harnessProfile`): network to the model relay only,
//      files of the session only. This holds the harness's own tools (read, glob, grep) and anything a plugin does
//      in the process.
//   2. Every command the session runs goes to a broker in the runner's process (`openSession`), which starts it
//      under a second, stricter profile (`commandProfile`): network to the package index only, not the relay, and
//      no view of the harness's own files. Seatbelt profiles cannot be nested, which is why the command is not a
//      child of `dsh`: the harness's sandbox runner is a small client (sealed-client.mjs) that hands it over.
//   3. Everything a session sees is under a root whose path does not name the account (`sealed.root`).
//
// The other suites do not use any of this.
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLUGIN_ENTRY, ROOT } from './env.mjs'

const ROOT_DIR = process.env.DSHRSI_BENCH_SEALED_ROOT || '/Users/Shared/dshrsi-bench'
export const sealed = {
  root: ROOT_DIR,
  toolchains: path.join(ROOT_DIR, 'toolchains'),
  bin: path.join(ROOT_DIR, 'toolchains/bin'),
  pythons: path.join(ROOT_DIR, 'toolchains/python'),
  lib: path.join(ROOT_DIR, 'lib'),
  runs: path.join(ROOT_DIR, 'runs'),
  sockets: path.join(ROOT_DIR, 's'),
  index: path.join(ROOT_DIR, 'index'),
  logs: path.join(ROOT_DIR, 'logs'),
}
export const INDEX_PORT = Number(process.env.BENCH_INDEX_PORT ?? 8792)
/** The interpreters sessions get, oldest first, and the one `python3` and `python` name. */
export const PYTHONS = ['3.9', '3.10', '3.11', '3.12']
export const DEFAULT_PYTHON = '3.12'
/** Commands are refused while the disk has less than this free; the task is then not an answer and runs again. */
export const FLOOR_BYTES = Number(process.env.BENCH_MIN_FREE_GB ?? 3) * 2 ** 30
export const DISK_REFUSAL = 'dshrsi-bench: the disk reserve of this machine is reached; the command was not run'
/** What one session may hold in its workspace and private directories; beyond it, its commands are refused until it removes something. */
export const QUOTA_BYTES = Number(process.env.BENCH_SESSION_GB ?? 3) * 2 ** 30
const CLIENT = path.join(sealed.lib, 'sealed-client.mjs')
const NODE = fs.realpathSync(process.execPath)
const GRACE_MS = 3000

/**
 * Where the workspaces and private directories of a run's sessions are. Not inside the run's own directory: that is
 * named after the run, and a run is usually named after its arm. The two arms must not differ in what a session
 * can read off its own path.
 */
export const visibleDir = (bench, run) => path.join(sealed.root, 'w', createHash('sha256').update(`${bench}\n${run}`).digest('hex').slice(0, 10))

/** Fails when the root would put the account's name into what sessions see. */
export function assertNeutralRoot() {
  const account = os.userInfo().username
  const real = fs.existsSync(sealed.root) ? fs.realpathSync(sealed.root) : sealed.root
  if (real !== sealed.root) throw new Error(`${sealed.root} is a link to ${real}; sessions would see the real path`)
  if (real.startsWith(`${os.homedir()}/`) || real.split('/').includes(account)) throw new Error(`${sealed.root} is inside the home directory or names the account; set DSHRSI_BENCH_SEALED_ROOT to a neutral directory`)
}

/** The root and its fixed parts, closed to other accounts of the machine. */
export function prepareRoot() {
  assertNeutralRoot()
  for (const dir of [sealed.root, sealed.lib, sealed.runs, sealed.sockets, sealed.index, sealed.logs]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  // Sessions run the client from here, so that nothing inside this repository has to be readable for a command.
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sealed-client.mjs'))
  if (!fs.existsSync(CLIENT) || !fs.readFileSync(CLIENT).equals(source)) {
    fs.writeFileSync(`${CLIENT}.${process.pid}`, source)
    fs.renameSync(`${CLIENT}.${process.pid}`, CLIENT)
  }
}

// ---------------------------------------------------------------------------------------------------- toolchains

const pythonHome = (version) => {
  const found = fs.existsSync(sealed.pythons) ? fs.readdirSync(sealed.pythons).filter(entry => entry.startsWith(`cpython-${version}.`) && fs.existsSync(path.join(sealed.pythons, entry, 'bin', `python${version}`))).sort() : []
  return found.length > 0 ? path.join(sealed.pythons, found.at(-1)) : undefined
}

/**
 * The interpreters and `uv`, under the neutral root. Downloads the interpreters once (python-build-standalone,
 * through `uv python install`); sessions cannot download any.
 * @returns {{ version: string, home: string }[]}
 */
export function provideToolchains({ install = true } = {}) {
  prepareRoot()
  fs.mkdirSync(sealed.bin, { recursive: true })
  fs.mkdirSync(sealed.pythons, { recursive: true })
  const missing = PYTHONS.filter(version => !pythonHome(version))
  if (missing.length > 0) {
    if (!install) throw new Error(`no Python ${missing.join(', ')} under ${sealed.pythons}; run bench/setup.sh or: node bench/lib/swebench.mjs toolchains`)
    console.log(`sealed: installing Python ${missing.join(', ')} into ${sealed.pythons}`)
    // uv would otherwise also write shims into ~/.local/bin; nothing here may depend on the home directory.
    execFileSync('uv', ['python', 'install', '--no-bin', '--no-config', ...missing], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, UV_PYTHON_INSTALL_DIR: sealed.pythons } })
  }
  const link = (name, target) => {
    const file = path.join(sealed.bin, name)
    const current = fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() ? fs.readlinkSync(file) : undefined
    if (current === target) return
    fs.rmSync(file, { force: true })
    fs.symlinkSync(target, file)
  }
  const homes = PYTHONS.map((version) => {
    const home = pythonHome(version)
    if (!home) throw new Error(`Python ${version} did not install into ${sealed.pythons}`)
    link(`python${version}`, path.join(home, 'bin', `python${version}`))
    return { version, home }
  })
  const main = pythonHome(DEFAULT_PYTHON)
  for (const name of ['python3', 'python']) link(name, path.join(main, 'bin', `python${DEFAULT_PYTHON}`))
  for (const name of ['pip3', 'pip']) link(name, path.join(main, 'bin', `pip${DEFAULT_PYTHON}`))
  // A copy, not a link: the command sandbox does not let a session read Homebrew's directories.
  const uv = fs.realpathSync(execFileSync('/usr/bin/which', ['uv'], { encoding: 'utf8' }).trim())
  const copy = path.join(sealed.bin, 'uv')
  if (!fs.existsSync(copy) || fs.statSync(copy).size !== fs.statSync(uv).size) {
    fs.rmSync(copy, { force: true })
    execFileSync('/bin/cp', ['-c', uv, copy])
    fs.chmodSync(copy, 0o755)
  }
  return homes
}

// ------------------------------------------------------------------------------------------------------ profiles

/** Where one session's log is kept inside the harness home its run shares. */
export const sessionsRoot = (home, name) => path.join(home, 'sessions', name)

const quote = text => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
const regex = text => `(regex #"${text.replaceAll('"', '\\"')}")`
const list = (form, paths) => paths.map(entry => `(${form} ${quote(entry)})`).join(' ')
function ancestors(paths) {
  const out = new Set()
  for (const entry of paths) for (let dir = path.dirname(entry); dir !== '/'; dir = path.dirname(dir)) out.add(dir)
  return [...out].sort()
}

/**
 * What of the operating system a process may read: its programs, libraries and compilers. Not the user's home,
 * not other volumes, not the shared temporary directories, not software the user installed (/usr/local, Homebrew).
 * Apple's own Python is left out too: its pip carries a copy of `requests`, and the note in the prompt names the
 * interpreters that exist.
 */
const SYSTEM_READS = `(allow file-read*
  (literal "/")
  (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin")
  (subpath "/private/etc") (subpath "/private/var/db/timezone") (subpath "/private/var/select")
  (literal "/private/var/db/xcode_select_link")
  (subpath "/Library/Developer/CommandLineTools") (subpath "/Library/Apple")
  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/tty")
  (literal "/dev/dtracehelper") (literal "/dev/autofs_nowait") (subpath "/dev/fd")
  ${regex('^/private/var/folders/[^/]+/[^/]+/C/xcrun_db')})
(deny file-read*
  (subpath "/usr/local")
  (subpath "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework")
  (subpath "/Library/Developer/CommandLineTools/usr/lib/python3"))
(allow file-read-metadata
  (literal "/private") (literal "/private/var") (literal "/private/var/db") (literal "/private/tmp") (literal "/private/var/folders")
  (literal "/Library") (literal "/Library/Developer") (literal "/dev") (literal "/etc") (literal "/var") (literal "/tmp") (literal "/opt")
  (literal "/usr/local"))`

/**
 * The profile of a session's commands. Closed by default.
 * @param {{ workspace: string, sessionDir: string, hidden?: string[] }} session `hidden` is regular expressions of
 * paths this session may not read although the rest allows them (copies of the project under test).
 */
export function commandProfile({ workspace, sessionDir, hidden = [] }) {
  const own = [workspace, sessionDir]
  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow sysctl-read)
(allow iokit-open (iokit-registry-entry-class "RootDomainUserClient"))
(allow ipc-posix-sem)
(allow ipc-posix-shm)
; The login name of the session the runner was started from is the account's.
(deny syscall-unix (syscall-number SYS_getlogin))
(allow pseudo-tty)
(allow file-read* file-write* file-ioctl (literal "/dev/ptmx"))
(allow file-read* file-write* (require-all (regex #"^/dev/ttys[0-9]+") (extension "com.apple.sandbox.pty")))
(allow file-ioctl (regex #"^/dev/ttys[0-9]+"))
(allow file-write-data file-ioctl (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper"))
${SYSTEM_READS}
(allow file-read-metadata ${list('literal', ancestors([sealed.toolchains, ...own]))})
(allow file-read* (subpath ${quote(sealed.toolchains)}))
(allow file-read* file-write* ${list('subpath', own)})
${hidden.length > 0 ? `(deny file-read* ${hidden.map(regex).join(' ')})` : ''}
; The package index on loopback, and sockets of the session's own files. Nothing else: no DNS, no other port.
(allow system-socket)
(allow network-outbound (remote tcp "localhost:${INDEX_PORT}"))
(allow network-bind network-inbound network-outbound ${list('subpath', own)})
`
}

/**
 * The directories of a package manager this Node is made of: its own and those of the libraries it has loaded. The
 * rest of Homebrew (other software, its configuration and its data) stays closed to the harness process.
 */
function nodeParts() {
  const parts = new Set()
  for (const file of [NODE, ...(process.report?.getReport()?.sharedObjects ?? [])]) {
    let real
    try { real = fs.realpathSync(file) } catch { continue }
    const match = /^((?:\/opt\/homebrew|\/usr\/local)\/Cellar\/[^/]+\/[^/]+)\//.exec(real)
    if (match) parts.add(match[1])
  }
  return [...parts].sort()
}
const NODE_PARTS = nodeParts()

/**
 * The profile of the `dsh` process of one session. Open by default, because Node needs more of the system than a
 * list can name safely; network, files and what it may execute are closed and then opened as far as a session needs.
 * @param {{ workspace: string, sessionDir: string, ctlDir: string, home: string, socket: string, name: string, relayPort: number, rg: string, hidden?: string[] }} session
 */
export function harnessProfile({ workspace, sessionDir, ctlDir, home, socket, name, relayPort, rg, hidden = [] }) {
  const code = [path.join(ROOT, 'node_modules'), path.dirname(PLUGIN_ENTRY)]
  const own = [workspace, sessionDir]
  // A harness home is shared by the sessions of a run, and another session's log holds what it read of its own,
  // possibly later, checkout. Each session therefore keeps its log in a directory of its own (`sessionsRoot`), and
  // the rest of the home's `sessions` is closed to it.
  const logs = path.join(home, 'sessions')
  const mine = sessionsRoot(home, name)
  return `(version 1)
(allow default)
(deny network*)
(allow network-outbound (remote tcp "localhost:${relayPort}"))
(allow network-outbound (literal ${quote(socket)}))
(deny appleevent-send)
(deny lsopen)
(deny user-preference-read)
(deny process-exec*)
(allow process-exec (literal ${quote(NODE)}) (literal ${quote(rg)}))
(deny file-read*)
${SYSTEM_READS}
; Node itself: its program, the libraries it is linked against (reached through the links in opt), and the
; configuration OpenSSL reads when it starts.
(allow file-read* (literal ${quote(NODE)}) ${list('subpath', NODE_PARTS)} (subpath "/opt/homebrew/opt") ${regex('^/opt/homebrew/etc/(openssl@[^/]+|ca-certificates)(/|$)')})
(allow file-read-metadata ${list('literal', ancestors([NODE, ...NODE_PARTS, '/opt/homebrew/opt', '/opt/homebrew/etc/openssl', sealed.toolchains, sealed.lib, ...code, ...own, ctlDir, home, socket]))})
(allow file-read* ${list('subpath', [sealed.toolchains, sealed.lib, ...code, ...own, ctlDir, home])})
(deny file-write*)
(allow file-write* ${list('subpath', [...own, home])} (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))
(deny file-read* file-write* (subpath ${quote(logs)}))
(allow file-read* file-write* (subpath ${quote(mine)}))
; The harness opens the directory above its log directory when it creates it; the names in it are workspace names.
(allow file-read* (literal ${quote(logs)}))
${hidden.length > 0 ? `(deny file-read* ${hidden.map(regex).join(' ')})` : ''}
`
}

// ------------------------------------------------------------------------------------------------------- broker

const frame = (type, payload = Buffer.alloc(0)) => {
  const head = Buffer.alloc(5)
  head.write(type, 0, 'latin1')
  head.writeUInt32BE(payload.length, 1)
  return Buffer.concat([head, payload])
}
const freeBytes = (dir) => { const disk = fs.statfsSync(dir); return disk.bavail * disk.bsize }
const stop = (pid, signal) => { try { process.kill(-pid, signal) } catch { /* the group is gone */ } }

/** Every command group started by a broker of this process, and every socket; stopped and removed with it. */
const groups = new Set()
const sockets = new Set()
process.on('exit', () => {
  for (const pid of groups) stop(pid, 'SIGKILL')
  for (const socket of sockets) fs.rmSync(socket, { force: true })
})

/**
 * Listens on `socket` and runs each command a client hands over under `profile`, with the environment `env` and
 * nothing of this process's own. The command is its own process group; it is stopped when its client goes away.
 * @returns {{ commands: () => number, refused: () => number, close: () => Promise<void> }}
 */
function broker({ socket, profile, env, workspace, sessionDir }) {
  let commands = 0
  let refused = 0
  let held = 0
  const mine = new Set()
  // What the session holds is measured beside its work, not before each command: a count of a large tree takes a while.
  const measure = () => {
    const du = spawn('/usr/bin/du', ['-sk', workspace, sessionDir], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    du.stdout.on('data', (chunk) => { out += chunk })
    du.on('close', () => { held = out.split('\n').reduce((sum, line) => sum + (Number.parseInt(line, 10) || 0), 0) * 1024 })
    du.on('error', () => {})
  }
  const measuring = setInterval(measure, 20000)
  measuring.unref()
  const server = net.createServer((connection) => {
    let pending = Buffer.alloc(0)
    let child
    let finished = false
    let ended = false
    const finish = (status) => {
      if (finished) return
      finished = true
      if (!connection.destroyed) connection.end(frame('X', Buffer.from(JSON.stringify(status))))
      if (child?.pid) {
        // What the command left running goes with it, as it does under the harness's own runner.
        stop(child.pid, 'SIGKILL')
        groups.delete(child.pid)
        mine.delete(child.pid)
      }
    }
    const start = (request) => {
      commands += 1
      if (freeBytes(workspace) < FLOOR_BYTES) {
        refused += 1
        connection.write(frame('R', Buffer.from(`${DISK_REFUSAL}\n`)))
        return finish({ code: 122 })
      }
      // The session's own doing, and its to undo: `rm` is let through.
      if (held > QUOTA_BYTES && !/^\s*(rm|du|ls|find|df)\b/.test(String(request.argv.at(-1)))) {
        connection.write(frame('R', Buffer.from(`dshrsi-bench: this session holds ${(held / 2 ** 30).toFixed(1)} GB in its directory and $TMPDIR, more than the ${(QUOTA_BYTES / 2 ** 30).toFixed(1)} GB it may; remove files (rm) and try again in half a minute\n`)))
        return finish({ code: 122 })
      }
      const cwd = typeof request.cwd === 'string' && fs.statSync(request.cwd, { throwIfNoEntry: false })?.isDirectory() ? request.cwd : workspace
      const passed = Object.fromEntries(Object.entries(request.env ?? {}).filter(([key, value]) => /^(NO_COLOR|TERM|PAGER|GIT_PAGER|DSH_SHELL|DSH_SESSION_ID)$/.test(key) && typeof value === 'string'))
      child = spawn('/usr/bin/sandbox-exec', ['-f', profile, ...request.argv.map(String)], { cwd, env: { ...passed, ...env }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
      if (child.pid) { groups.add(child.pid); mine.add(child.pid) }
      if (ended) child.stdin.end()
      child.stdin.on('error', () => {})
      child.stdout.on('data', chunk => connection.destroyed || connection.write(frame('O', chunk)))
      child.stderr.on('data', chunk => connection.destroyed || connection.write(frame('R', chunk)))
      child.on('error', (error) => {
        connection.destroyed || connection.write(frame('R', Buffer.from(`dshrsi-sealed: the command sandbox did not start: ${error.message}\n`)))
        finish({ code: 125 })
      })
      // A background process the command left behind may hold the pipes open; the status does not wait for it.
      child.on('exit', (code, signal) => setTimeout(() => finish({ code, signal }), child.stdout.readableEnded && child.stderr.readableEnded ? 0 : GRACE_MS).unref())
      child.on('close', (code, signal) => finish({ code, signal }))
    }
    connection.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk])
      while (pending.length >= 5) {
        const size = pending.readUInt32BE(1)
        if (pending.length < 5 + size) break
        const type = String.fromCharCode(pending[0])
        const payload = pending.subarray(5, 5 + size)
        pending = pending.subarray(5 + size)
        if (type === 'S' && !child && !finished) {
          let request
          try { request = JSON.parse(payload.toString('utf8')) } catch { request = undefined }
          if (!Array.isArray(request?.argv) || request.argv.length === 0) { connection.destroy(); return }
          start(request)
        } else if (type === 'I') child?.stdin.write(payload)
        else if (type === 'E') { ended = true; child?.stdin.end() }
      }
    })
    const gone = () => {
      if (finished || !child?.pid) return
      const pid = child.pid
      stop(pid, 'SIGTERM')
      setTimeout(() => { stop(pid, 'SIGKILL'); groups.delete(pid); mine.delete(pid) }, GRACE_MS).unref()
      finished = true
    }
    connection.on('error', gone)
    connection.on('close', gone)
  })
  fs.rmSync(socket, { force: true })
  server.listen(socket)
  sockets.add(socket)
  return {
    commands: () => commands,
    refused: () => refused,
    close: () => new Promise((resolve) => {
      clearInterval(measuring)
      for (const pid of mine) { stop(pid, 'SIGKILL'); groups.delete(pid) }
      // A process that left its group (a daemon the session started) still names the session's directories.
      for (const dir of [workspace, sessionDir]) { try { execFileSync('/usr/bin/pkill', ['-9', '-f', dir], { stdio: 'ignore' }) } catch { /* nothing matched */ } }
      server.close(() => { fs.rmSync(socket, { force: true }); sockets.delete(socket); resolve() })
      // Connections of a harness that was killed are not waited for.
      server.closeAllConnections?.()
    }),
  }
}

// ------------------------------------------------------------------------------------------------------ session

/** The path the harness's ripgrep is at; the only program besides Node the `dsh` process may start. */
function ripgrepPath() {
  const candidates = [`@vscode/ripgrep-${process.platform}-${process.arch}/bin/rg`, '@vscode/ripgrep/bin/rg'].map(entry => path.join(ROOT, 'node_modules', entry))
  const found = candidates.find(entry => fs.existsSync(entry))
  if (!found) throw new Error('the harness\'s ripgrep binary was not found under node_modules/@vscode')
  return fs.realpathSync(found)
}

/**
 * Everything one sealed session needs, made for its workspace: the two profiles, the broker, the environments.
 *
 * @param {{ runDir: string, home: string, name: string, workspace: string, indexUrl: string, relayPort: number, keyEnv: string, hidden?: string[] }} input
 * `runDir` is where the session's private directories go (`visibleDir`), next to its workspace; `home` is the harness
 * home of the run; `name` is the workspace's directory name; `hidden` as in `commandProfile`.
 */
export function openSession({ runDir, home, name, workspace, indexUrl, relayPort, keyEnv, hidden = [] }) {
  prepareRoot()
  const sessionDir = path.join(runDir, 'session', name)
  // The profiles and the harness's configuration name where the harness itself is installed, which is under the
  // account's home. The harness process has to read its configuration, so the directory gets a name the session
  // cannot guess and sits where the session cannot list.
  const control = path.join(runDir, 'ctl')
  for (const entry of fs.existsSync(control) ? fs.readdirSync(control) : []) if (entry.startsWith(`${name}-`)) fs.rmSync(path.join(control, entry), { recursive: true, force: true })
  const ctlDir = path.join(control, `${name}-${randomBytes(12).toString('hex')}`)
  fs.rmSync(sessionDir, { recursive: true, force: true })
  for (const dir of ['tmp', 'home', 'cache/pip', 'cache/uv', 'storages']) fs.mkdirSync(path.join(sessionDir, dir), { recursive: true })
  fs.mkdirSync(ctlDir, { recursive: true })
  fs.mkdirSync(sessionsRoot(home, name), { recursive: true })
  // A socket path is limited to 104 bytes, so it is not inside the run directory.
  const socket = path.join(sealed.sockets, `${createHash('sha256').update(`${runDir}\n${name}`).digest('hex').slice(0, 24)}.sock`)
  const commandsFile = path.join(ctlDir, 'commands.sb')
  const harnessFile = path.join(ctlDir, 'harness.sb')
  fs.writeFileSync(commandsFile, commandProfile({ workspace, sessionDir, hidden }))
  fs.writeFileSync(harnessFile, harnessProfile({ workspace, sessionDir, ctlDir, home, socket, name, relayPort, rg: ripgrepPath(), hidden }))

  const shared = {
    HOME: path.join(sessionDir, 'home'),
    TMPDIR: path.join(sessionDir, 'tmp'),
    USER: 'agent',
    LOGNAME: 'agent',
    SHELL: '/bin/bash',
    LANG: 'en_US.UTF-8',
    TZ: 'UTC',
  }
  /** What a command sees. Nothing is inherited from the runner's own environment, the model key included. */
  const commandEnv = {
    ...shared,
    PATH: [sealed.bin, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    PIP_INDEX_URL: indexUrl,
    PIP_CACHE_DIR: path.join(sessionDir, 'cache/pip'),
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_NO_INPUT: '1',
    UV_DEFAULT_INDEX: indexUrl,
    UV_INDEX_URL: indexUrl,
    UV_CACHE_DIR: path.join(sessionDir, 'cache/uv'),
    UV_PYTHON_INSTALL_DIR: sealed.pythons,
    UV_PYTHON_DOWNLOADS: 'never',
    UV_PYTHON_PREFERENCE: 'only-managed',
    UV_NO_PROGRESS: '1',
    // Git has no remote in a sealed checkout; anything that names one fails at once instead of trying the network.
    GIT_ALLOW_PROTOCOL: 'file',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
  }
  const running = broker({ socket, profile: commandsFile, env: commandEnv, workspace, sessionDir })
  return {
    sessionDir, ctlDir, socket, commandEnv, commandsFile, harnessFile,
    /** The environment of the `dsh` process: the model key, the harness home, and nothing of the user's. */
    harnessEnv: {
      ...shared,
      PATH: [path.dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
      DSH_HOME: home,
      [keyEnv]: process.env[keyEnv] ?? '',
    },
    /** `dsh` and its arguments, wrapped so that the process starts inside the harness profile. */
    wrap: argv => ['/usr/bin/sandbox-exec', '-f', harnessFile, NODE, ...argv],
    /** Lines for the session's overlay: the command runner, a log directory of its own, no web tools, state that goes away with the session. */
    overlay: `- id: sandbox
  config:
    runnerCommand: ${JSON.stringify([NODE, CLIENT, socket])}
    runnerFailureSignatures: ["dshrsi-sealed: "]
- id: session-persistence-jsonl
  config:
    root: ${JSON.stringify(sessionsRoot(home, name))}
    compression: none
- id: storage-json
  config:
    root: ${JSON.stringify(path.join(sessionDir, 'storages'))}
- id: tool-web
  disabled: true
- id: web-fetch-http
  disabled: true
- id: web-search-deepseek
  disabled: true
- id: web-deepseek-api
  disabled: true
- id: web
  disabled: true
`,
    commands: running.commands,
    refused: running.refused,
    /** Runs one command exactly as a session's command runs, for the checks. */
    run: (argv, { cwd = workspace, input = '', timeoutMs = 120000 } = {}) => new Promise((resolve) => {
      const child = spawn('/usr/bin/sandbox-exec', ['-f', harnessFile, NODE, CLIENT, socket, '--ro-bind', '/', '/', '--', ...argv], { cwd, env: { ...shared, PATH: '/usr/bin:/bin', NO_COLOR: '1', TERM: 'dumb' }, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      const started = Date.now()
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, seconds: (Date.now() - started) / 1000 }) })
      child.stdin.end(input)
    }),
    /** Stops what the session left running and removes its private directories. */
    async close() {
      await running.close()
      for (const dir of [sessionDir, ctlDir]) {
        try { fs.rmSync(dir, { recursive: true, force: true }) } catch {
          try { execFileSync('/bin/chmod', ['-R', 'u+rwX', dir], { stdio: 'ignore' }) } catch { /* reported below */ }
          try { fs.rmSync(dir, { recursive: true, force: true }) } catch (error) { console.error(`sealed: could not remove ${dir}: ${error.message}`) }
        }
      }
    },
  }
}
