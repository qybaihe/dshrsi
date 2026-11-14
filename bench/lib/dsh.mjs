// One agent turn: a real `dsh --profile headless` process on the model under
// test, with or without the dsh-rsi plugin, and what its session log shows.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeLog } from '../../packages/dsh-rsi/src/normalize.js'
import { DSH_BIN, PLUGIN_ENTRY, paths, toolEnv } from './env.mjs'

// The model endpoint: any OpenAI-compatible one, named by BENCH_BASE_URL, BENCH_MODEL and BENCH_API_KEY
// (BENCH_PROVIDER gives it a display name). The MIMO_* names the first runs were made with still work, and with
// only those set the sessions are configured as they were then.
const named = process.env.BENCH_PROVIDER?.trim()
const ownEndpoint = Boolean(process.env.BENCH_BASE_URL)
export const MODEL = process.env.BENCH_MODEL ?? process.env.MIMO_MODEL ?? 'mimo-v2.6-pro'
export const BASE_URL = process.env.BENCH_BASE_URL ?? process.env.MIMO_BASE_URL ?? 'https://api.xiaomimimo.com/v1'
/**
 * The NAME of the variable that holds the API key. DSH reads the key from its own environment; the key is never
 * written to the overlay or anywhere else. A MiMo key is not sent to an endpoint given with BENCH_BASE_URL.
 */
export const API_KEY_ENV = ownEndpoint || process.env.BENCH_API_KEY ? 'BENCH_API_KEY' : 'MIMO_API_KEY'
const PROVIDER_NAME = named || (ownEndpoint ? 'Benchmark endpoint' : 'Xiaomi MiMo')
// The id is this benchmark's own, so that it cannot be taken for a provider the harness ships with.
const PROVIDER_ID = named ? `bench-${named.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/, '') : ownEndpoint ? 'bench' : 'mimo'

/**
 * The patch both arms share, plus the plugin for the `rsi` arm. Nothing else differs between the arms.
 * @param {object | boolean} rsi the plugin's configuration, or false for the stock harness.
 * @param {string} [sealedLines] what a sealed session adds for both arms (bench/lib/sealed.mjs).
 */
export function overlay(rsi, sealedLines = '') {
  let text = `- id: session-log-deepseek
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
- id: llm-pi-ai
  config:
    providers:
      ${PROVIDER_ID}:
        displayName: ${JSON.stringify(PROVIDER_NAME)}
        apiKeyEnv: ${API_KEY_ENV}
        api: openai-completions
        baseURL: ${JSON.stringify(BASE_URL)}
        models:
          - id: ${JSON.stringify(MODEL)}
            name: ${JSON.stringify(MODEL)}
- id: agent-default-model
  config:
    provider: ${PROVIDER_ID}
    model: ${JSON.stringify(MODEL)}
`
  text += sealedLines
  if (rsi) text += `- insert:\n    - id: dsh-rsi\n      name: ${JSON.stringify(PLUGIN_ENTRY)}\n      config: ${JSON.stringify(rsi === true ? {} : rsi)}\n`
  return text
}

let overlays = 0

/** Sessions in flight. Each is its own process group, so it would outlive this process unless stopped with it. */
const running = new Set()
export function stopAll() {
  for (const pid of running) { try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ } }
  running.clear()
}

/**
 * Runs one turn and waits for the process to exit.
 * The agent may write inside `cwd` and inside the shared build caches, nowhere else (DSH's workspace-write sandbox),
 * and no approval is ever asked for.
 *
 * With `sealed` (a session from bench/lib/sealed.mjs) the process itself starts inside that session's profile, with
 * that session's environment instead of this process's, and its commands go to the session's broker; the writable
 * directory besides `cwd` is then the session's own, not the shared caches.
 * @param {{ home: string, cwd: string, prompt: string, rsi?: object | boolean, sessionId?: string, timeoutMs?: number, sealed?: object }} input
 */
export function runTurn({ home, cwd, prompt, rsi = false, sessionId, timeoutMs = 1800000, sealed }) {
  fs.mkdirSync(home, { recursive: true })
  const file = path.join(sealed ? sealed.ctlDir : home, `overlay-${process.pid}-${overlays += 1}.yml`)
  fs.writeFileSync(file, overlay(rsi, sealed?.overlay))
  const args = [
    '--profile', 'headless', '--patch', file, '--json',
    '--permission-mode', 'workspace-write', '--approval-policy', 'never', '--add-dir', sealed ? sealed.sessionDir : paths.cache,
    ...(sessionId ? ['--session-id', sessionId] : []),
    // A prompt is free text and may begin with a dash.
    '--', prompt,
  ]
  const [program, ...argv] = sealed ? sealed.wrap([fs.realpathSync(DSH_BIN), ...args]) : [DSH_BIN, ...args]
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn(program, argv, { cwd, env: sealed ? sealed.harnessEnv : toolEnv({ DSH_HOME: home }), detached: true })
    if (child.pid) running.add(child.pid)
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000) })
    // The agent's own children (compilers, test runners) are in its process group and go with it.
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }, timeoutMs)
    const finish = (code, failure) => {
      clearTimeout(timer)
      running.delete(child.pid)
      fs.rmSync(file, { force: true })
      const events = stdout.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } })
      const final = events.findLast(event => event.type === 'final')
      resolve({
        code, timedOut, failure, stderr,
        sessionId: final?.sessionId ?? events.find(event => typeof event.sessionId === 'string')?.sessionId ?? sessionId,
        text: final?.text ?? '',
        seconds: Math.round((Date.now() - started) / 100) / 10,
      })
    }
    child.on('error', error => finish(null, String(error?.message ?? error)))
    child.on('exit', code => finish(code))
  })
}

/** The stored events of one session, or undefined when it left no log. */
export function readSession(home, sessionId) {
  const root = path.join(home, 'sessions')
  if (!sessionId || !fs.existsSync(root)) return undefined
  const files = fs.readdirSync(root, { recursive: true }).map(String).filter(entry => /session\.v\d+\.jsonl$/.test(entry))
  const named = files.find(entry => entry.includes(sessionId))
  for (const entry of named ? [named] : files) {
    const lines = fs.readFileSync(path.join(root, entry), 'utf8').split('\n').filter(Boolean)
    let header
    try { header = JSON.parse(lines[0]) } catch { continue }
    if (header.id !== sessionId) continue
    return { header, events: lines.slice(1).flatMap((line) => { try { return [JSON.parse(line)] } catch { return [] } }) }
  }
  return undefined
}

function usageOf(events) {
  let input = 0
  let output = 0
  for (const event of events) {
    const usage = event.data?.usage ?? event.data?.message?.usage
    if (!usage || typeof usage !== 'object') continue
    // The provider reports the cached part of a prompt separately; both are what the model read.
    input += (Number(usage.inputTokens ?? 0) || 0) + (Number(usage.cacheReadTokens ?? 0) || 0)
    output += Number(usage.outputTokens ?? usage.output ?? usage.completion_tokens ?? 0) || 0
  }
  return { input, output }
}

/**
 * What a session did, counted the same way for both arms.
 * `failed` is tool calls that ended in an error; `refused` is calls an adaptation answered before they ran.
 * @param {{ header: object, events: object[] }} session
 * @param {number} [from] count only events from this index on (a resumed session's earlier turns are already counted).
 */
export function measure(session, from = 0) {
  const all = normalizeLog({ sessionId: session.header.id, cwd: session.header.cwd }, session.events)
  const events = session.events.slice(from)
  const firstSeq = events[0]?.seq ?? Infinity
  const observations = all.filter(entry => (entry.seq ?? firstSeq) >= firstSeq)
  const tools = observations.filter(entry => entry.kind === 'tool')
  const usage = usageOf(events)
  return {
    steps: events.filter(event => event.type === 'step/start').length,
    calls: tools.length,
    failed: tools.filter(entry => !entry.ok).length,
    refused: observations.filter(entry => entry.kind === 'adapted').length,
    notices: events.filter(event => event.type === 'user/message' && event.data?.source?.kind === 'dsh-rsi').length,
    inputTokens: usage.input,
    outputTokens: usage.output,
    failures: tools.filter(entry => !entry.ok).map(entry => `${entry.tool} ${(entry.command ?? entry.path ?? '').replace(/\s+/g, ' ').slice(0, 100)}`).slice(0, 12),
    events: session.events.length,
  }
}
