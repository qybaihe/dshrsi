// Runs the real `dsh --profile headless` against the simulated model, with or
// without the dsh-rsi plugin patched in, and collects everything a test wants
// to assert on: the model requests, the session log, and the library.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { openLibrary } from '../../packages/dsh-rsi/src/library.js'
import { GENERATOR_IDENTITY } from '../../packages/dsh-rsi/src/generate.js'
import { startSimLlm, systemText } from './sim-llm.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const PLUGIN_DIR = path.join(ROOT, 'packages/dsh-rsi')
export const DSH_BIN = path.join(ROOT, 'node_modules/.bin/dsh')

/** Rows every test run needs: no telemetry, no title side request, readable session logs. */
const QUIET_ROWS = `- id: session-log-deepseek
  disabled: true
- id: otel
  disabled: true
- id: session-telemetry-otel
  disabled: true
- id: session-title-llm
  disabled: true
- id: session-persistence-jsonl
  config:
    root: !!js dshHomePath('sessions')
    compression: none
`

/** A throwaway harness home plus workspaces, removed by `cleanup()`. */
export function makeSandbox(label = 'run') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `dshrsi-${label}-`)))
  const home = path.join(dir, 'home')
  fs.mkdirSync(home, { recursive: true })
  return {
    dir,
    home,
    rsiHome: path.join(home, 'rsi'),
    /** Creates a workspace directory with the given files. */
    workspace(name = 'ws', files = {}) {
      const cwd = path.join(dir, 'work', name)
      fs.mkdirSync(cwd, { recursive: true })
      for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
        fs.writeFileSync(path.join(cwd, file), content)
      }
      return cwd
    },
    library: () => openLibrary(path.join(home, 'rsi')),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

/**
 * Environment for the harness process. The test runner marks its children through NODE_TEST_CONTEXT, which would
 * make a `node --test` started by the agent inside the workspace report in the runner's wire format instead of text.
 */
export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.NODE_TEST_CONTEXT
  return env
}

/** Whether a model request is the adaptation generator's, not the agent's. */
export function isGeneratorRequest(body) {
  return systemText(body).startsWith(GENERATOR_IDENTITY)
}

/** Wraps adaptation source the way a model would reply with it. */
export function fenced(source) {
  return `\`\`\`javascript\n${source.trim()}\n\`\`\``
}

function overlayText(rsi, extra) {
  let text = QUIET_ROWS
  if (rsi) {
    text += `- insert:\n    - id: dsh-rsi\n      name: ${JSON.stringify(path.join(PLUGIN_DIR, 'index.js'))}\n      config: ${JSON.stringify(rsi === true ? {} : rsi)}\n`
  }
  if (extra) text += extra
  return text
}

/** Every event of every session stored under a harness home, grouped by session, oldest session first. */
export function readSessions(home) {
  const root = path.join(home, 'sessions')
  if (!fs.existsSync(root)) return []
  const sessions = []
  for (const entry of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, String(entry))
    if (!/session\.v\d+\.jsonl(?:\.zstd)?$/.test(file)) continue
    const raw = file.endsWith('.zstd') ? zlib.zstdDecompressSync(fs.readFileSync(file)).toString() : fs.readFileSync(file, 'utf8')
    const lines = raw.split('\n').filter(Boolean).map(line => JSON.parse(line))
    sessions.push({ file, header: lines[0], events: lines.slice(1) })
  }
  return sessions.sort((a, b) => (a.header.createdAt ?? 0) - (b.header.createdAt ?? 0))
}

/**
 * One headless run.
 * @param {object} input
 * @param {string} input.home harness home (DSH_HOME).
 * @param {string} input.cwd workspace.
 * @param {string} input.task the user's prompt.
 * @param {(body: object, info: object) => object} input.policy simulated model; sees agent and generator requests alike.
 * @param {object | boolean} [input.rsi] plugin config, `true` for defaults, falsy to run without the plugin.
 * @param {string} [input.overlay] extra patch rows.
 * @param {string[]} [input.args] extra CLI arguments.
 * @param {number} [input.timeoutMs]
 */
export async function runDsh(input) {
  fs.mkdirSync(input.home, { recursive: true })
  // A scripted model that never reaches its goal would otherwise loop until the timeout.
  let served = 0
  const limit = input.maxRequests ?? 30
  const sim = await startSimLlm((body, info) => ((served += 1) > limit ? { text: 'request limit reached' } : input.policy(body, info)))
  const overlay = path.join(input.home, `overlay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.yml`)
  let stdout = ''
  let stderr = ''
  let code
  // The simulated model is a listening server: left open after a failure it would keep the test process alive.
  try {
    fs.writeFileSync(overlay, overlayText(input.rsi, input.overlay))
    const args = ['--profile', 'headless', '--patch', overlay, '--json', '--permission-mode', 'danger-full-access', ...input.args ?? [], input.task]
    const child = spawn(DSH_BIN, args, {
      cwd: input.cwd,
      env: childEnv({ DSH_HOME: input.home, DEEPSEEK_BASE_URL: sim.baseUrl, DEEPSEEK_API_KEY: 'sim-key', ...input.env }),
    })
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => child.kill('SIGKILL'), input.timeoutMs ?? 60000)
    code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject) })
    clearTimeout(timer)
  } finally {
    await sim.close()
    fs.rmSync(overlay, { force: true })
  }

  const events = stdout.split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
  const agentRequests = sim.requests.filter(body => !isGeneratorRequest(body))
  const generatorRequests = sim.requests.filter(isGeneratorRequest)
  const final = events.findLast(event => event.type === 'final')
  return {
    code, stdout, stderr, events, final,
    finalText: final?.text ?? final?.message ?? events.filter(event => event.type === 'text').map(event => event.text ?? event.delta ?? '').join(''),
    requests: sim.requests, agentRequests, generatorRequests,
    toolCalls: events.filter(event => event.type === 'tool_call'),
    toolResults: events.filter(event => event.type === 'tool_result'),
  }
}
