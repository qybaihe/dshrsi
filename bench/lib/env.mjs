// Where the benchmark data, toolchains and run directories live, and the
// environment every agent session and every test run gets.
//
// Nothing here is inside the repository: agent sessions run real shell
// commands, and a workspace inside this checkout would put its `.git` within
// their reach.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const PLUGIN_ENTRY = path.join(ROOT, 'packages/dsh-rsi/index.js')
export const DSH_BIN = path.join(ROOT, 'node_modules/.bin/dsh')
export const BENCH_HOME = process.env.DSHRSI_BENCH_HOME || path.join(os.homedir(), '.cache/dshrsi-bench')

export const paths = {
  polyglot: path.join(BENCH_HOME, 'src/polyglot-benchmark'),
  python: path.join(BENCH_HOME, 'env/py'),
  evalplus: path.join(BENCH_HOME, 'env/evalplus'),
  jsModules: path.join(BENCH_HOME, 'env/js/node_modules'),
  humaneval: path.join(BENCH_HOME, 'humaneval'),
  cache: path.join(BENCH_HOME, 'cache'),
  runs: path.join(BENCH_HOME, 'runs'),
}

const JAVA_PREFIX = process.env.DSHRSI_BENCH_JAVA || '/opt/homebrew/opt/openjdk@21'

/**
 * Build caches are shared between sessions and kept in one directory, which the agent's sandbox is allowed to write
 * to. Without that, `go test`, `cargo test` and `./gradlew test` fail inside the sandbox before compiling anything.
 */
export function prepareCaches() {
  for (const dir of ['go-build', 'gopath', 'cargo', 'gradle', 'npm']) fs.mkdirSync(path.join(paths.cache, dir), { recursive: true })
  const properties = path.join(paths.cache, 'gradle/gradle.properties')
  // One JVM per build and no lingering daemons: dozens of sessions run at once on a 16 GB machine.
  if (!fs.existsSync(properties)) fs.writeFileSync(properties, 'org.gradle.daemon=false\norg.gradle.jvmargs=-Xmx512m\norg.gradle.console=plain\n')
}

/** Environment for agent sessions and for scoring alike, so the agent sees the toolchains the tests are scored with. */
export function toolEnv(extra = {}) {
  const env = { ...process.env }
  // The Node test runner marks its children; an agent's own `node --test` would then report in the runner's wire format.
  delete env.NODE_TEST_CONTEXT
  return {
    ...env,
    PATH: [path.join(paths.python, 'bin'), path.join(JAVA_PREFIX, 'bin'), env.PATH].join(path.delimiter),
    VIRTUAL_ENV: paths.python,
    JAVA_HOME: path.join(JAVA_PREFIX, 'libexec/openjdk.jdk/Contents/Home'),
    GOCACHE: path.join(paths.cache, 'go-build'),
    GOPATH: path.join(paths.cache, 'gopath'),
    GOTOOLCHAIN: 'local',
    CARGO_HOME: path.join(paths.cache, 'cargo'),
    GRADLE_USER_HOME: path.join(paths.cache, 'gradle'),
    npm_config_cache: path.join(paths.cache, 'npm'),
    npm_config_update_notifier: 'false',
    // The benchmark's own container runs in UTC, and one exercise's expected dates depend on it.
    TZ: 'UTC',
    ...extra,
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. Results keep the order of `items`. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function lane() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane))
  return results
}

/** A fixed order that mixes the tasks, the same for every arm and every pass. */
export function shuffled(items, seed = 20261113) {
  let state = seed >>> 0
  const random = () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[out[index], out[other]] = [out[other], out[index]]
  }
  return out
}
