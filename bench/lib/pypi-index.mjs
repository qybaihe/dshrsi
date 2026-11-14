#!/usr/bin/env node
// A loopback package index for sealed sessions: PyPI without the project a session is working on.
//
//   node bench/lib/pypi-index.mjs [port]            serve on 127.0.0.1 (default 8792, BENCH_INDEX_PORT)
//
// A session has no network except this port. It serves PyPI's simple index and the files, with every file link
// rewritten to itself, and refuses the projects named in the session's URL prefix:
//
//   http://127.0.0.1:8792/<token>/simple/<project>/         the project's page, from pypi.org
//   http://127.0.0.1:8792/<token>/files/<host>/<path>       one file, from files.pythonhosted.org
//
// A later release of the project under test contains the fix, so that project (and the names it is also published
// or bundled under) is refused for that session. The token is signed with a secret no session can read, so a
// session cannot make itself a prefix that blocks less. Every request is logged with the run and workspace the
// token names; `node bench/lib/swebench.mjs audit <run>` reads that log.
import { spawn } from 'node:child_process'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { INDEX_PORT, prepareRoot, sealed } from './sealed.mjs'

const SECRET_FILE = path.join(sealed.index, 'secret')
const CACHE = path.join(sealed.index, 'cache')
export const INDEX_LOG = path.join(sealed.logs, 'index.jsonl')
const SIMPLE = 'https://pypi.org/simple/'
/** The only hosts a file is fetched from; a rewritten link names its host. */
const FILE_HOSTS = new Set(['files.pythonhosted.org'])
const CACHE_LIMIT = Number(process.env.BENCH_INDEX_CACHE_GB ?? 1) * 2 ** 30
const PAGE_TTL_MS = 600000
export const REFUSAL = 'Not served here: this is the project under test, or a package that contains a copy of it'

/** A project name the way PyPI compares names (PEP 503). */
export const normalize = name => String(name).toLowerCase().replace(/[-_.]+/g, '-')

/** Whether a file of the index belongs to one of these projects, by its name: `<project>-<version>...`. */
export function fileOf(blocked, filename) {
  const name = normalize(filename)
  return blocked.some(project => name.startsWith(`${project}-`) && /\d/.test(name[project.length + 1] ?? ''))
}

function secret() {
  prepareRoot()
  try { fs.writeFileSync(SECRET_FILE, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  return fs.readFileSync(SECRET_FILE, 'utf8').trim()
}
const sign = (body, key) => createHmac('sha256', key).update(body).digest('base64url').slice(0, 22)

/**
 * The URL prefix of one session.
 * @param {{ run: string, name: string, blocked: string[] }} session `blocked` is project names; they are normalised here.
 */
export function indexUrl({ run, name, blocked }) {
  const body = Buffer.from(JSON.stringify({ r: run, n: name, b: [...new Set(blocked.map(normalize))].sort() })).toString('base64url')
  return `http://127.0.0.1:${INDEX_PORT}/${body}.${sign(body, secret())}/simple/`
}

function readToken(token, key) {
  const [body, signature] = String(token).split('.')
  if (!body || !signature) return undefined
  const expected = Buffer.from(sign(body, key))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return Array.isArray(value.b) ? { run: String(value.r), name: String(value.n), blocked: value.b.map(normalize) } : undefined
  } catch { return undefined }
}

const alive = () => fetch(`http://127.0.0.1:${INDEX_PORT}/health`, { signal: AbortSignal.timeout(2000) }).then(reply => reply.ok && reply.text().then(text => text.startsWith('dshrsi index')), () => false)

/** Makes sure the index is serving, starting it if it is not. It keeps running after this process: both arms use it. */
export async function ensureIndex() {
  if (await alive()) return
  prepareRoot()
  const log = fs.openSync(path.join(sealed.logs, 'index.log'), 'a')
  // If the other arm starts one at the same moment, the second fails to bind and exits; one is serving either way.
  spawn(process.execPath, [fileURLToPath(import.meta.url), String(INDEX_PORT)], { detached: true, stdio: ['ignore', log, log] }).unref()
  fs.closeSync(log)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 200))
    if (await alive()) return
  }
  throw new Error(`the package index did not start on 127.0.0.1:${INDEX_PORT}; see ${path.join(sealed.logs, 'index.log')}`)
}

// -------------------------------------------------------------------------------------------------------- server

function serve(port) {
  const key = secret()
  fs.mkdirSync(CACHE, { recursive: true })
  const log = fs.createWriteStream(INDEX_LOG, { flags: 'a' })
  const note = entry => log.write(`${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`)
  const pages = new Map()
  const sizes = new Map(fs.readdirSync(CACHE).filter(entry => /^[0-9a-f]{64}$/.test(entry)).map(entry => [entry, fs.statSync(path.join(CACHE, entry)).size]))
  for (const entry of fs.readdirSync(CACHE)) if (entry.includes('.part-')) fs.rmSync(path.join(CACHE, entry), { force: true })
  let held = [...sizes.values()].reduce((sum, size) => sum + size, 0)

  /** Keeps the file cache under its limit: the files that were asked for longest ago go first. */
  function makeRoom() {
    if (held <= CACHE_LIMIT) return
    const byUse = [...sizes.keys()].map(entry => [entry, fs.statSync(path.join(CACHE, entry), { throwIfNoEntry: false })?.atimeMs ?? 0]).sort((a, b) => a[1] - b[1])
    for (const [entry] of byUse) {
      if (held <= CACHE_LIMIT * 0.8) break
      fs.rmSync(path.join(CACHE, entry), { force: true })
      fs.rmSync(path.join(CACHE, `${entry}.type`), { force: true })
      held -= sizes.get(entry)
      sizes.delete(entry)
    }
  }

  const plain = (response, status, text, reason) => {
    response.writeHead(status, reason ?? http.STATUS_CODES[status], { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`${text}\n`)
  }
  const refuse = response => plain(response, 403, REFUSAL, REFUSAL)

  async function simple(request, response, session, token, project) {
    const name = normalize(project)
    if (session.blocked.includes(name)) {
      note({ run: session.run, name: session.name, kind: 'simple', project: name, status: 403, blocked: true })
      return refuse(response)
    }
    const json = /application\/vnd\.pypi\.simple\.v1\+json/.test(request.headers.accept ?? '')
    const id = `${json ? 'json' : 'html'}:${name}`
    let page = pages.get(id)
    if (!page || Date.now() - page.at > PAGE_TTL_MS) {
      const reply = await fetch(`${SIMPLE}${encodeURIComponent(name)}/`, { headers: { accept: json ? 'application/vnd.pypi.simple.v1+json' : 'application/vnd.pypi.simple.v1+html, text/html;q=0.5', 'user-agent': 'dshrsi-bench-index' }, signal: AbortSignal.timeout(60000) })
      page = { at: Date.now(), status: reply.status, type: reply.headers.get('content-type') ?? 'text/html', text: await reply.text() }
      if (reply.status === 200 || reply.status === 404) pages.set(id, page)
      if (pages.size > 4000) pages.delete(pages.keys().next().value)
    }
    note({ run: session.run, name: session.name, kind: 'simple', project: name, status: page.status })
    if (page.status !== 200) return plain(response, page.status === 404 ? 404 : 502, page.status === 404 ? 'No such project' : `pypi.org answered ${page.status}`)
    // Every file link is made a link to this server, and files of the blocked projects are left out of the page.
    const own = url => `/${token}/files/${url.host}${url.pathname}${url.hash}`
    let body
    if (/json/.test(page.type)) {
      const data = JSON.parse(page.text)
      data.files = (data.files ?? []).filter(file => !fileOf(session.blocked, file.filename ?? '')).map((file) => {
        const url = new URL(file.url, SIMPLE)
        return FILE_HOSTS.has(url.host) ? { ...file, url: own(url) } : undefined
      }).filter(Boolean)
      body = JSON.stringify(data)
    } else {
      body = page.text.replace(/href="([^"]+)"/g, (match, href) => {
        const url = new URL(href.replaceAll('&amp;', '&'), `${SIMPLE}${name}/`)
        return FILE_HOSTS.has(url.host) && !fileOf(session.blocked, path.posix.basename(url.pathname)) ? `href="${own(url)}"` : 'href="#"'
      })
    }
    response.writeHead(200, { 'content-type': page.type, 'content-length': Buffer.byteLength(body) })
    response.end(request.method === 'HEAD' ? undefined : body)
  }

  async function file(request, response, session, host, rest) {
    const filename = path.posix.basename(rest)
    const entry = { run: session.run, name: session.name, kind: 'file', file: filename }
    if (!FILE_HOSTS.has(host) || rest.includes('..')) { note({ ...entry, status: 404 }); return plain(response, 404, 'Not a file of this index') }
    if (fileOf(session.blocked, filename)) { note({ ...entry, status: 403, blocked: true }); return refuse(response) }
    const id = createHash('sha256').update(`${host}/${rest}`).digest('hex')
    const stored = path.join(CACHE, id)
    if (sizes.has(id) && fs.existsSync(stored)) {
      note({ ...entry, status: 200, cached: true })
      const now = new Date()
      fs.utimes(stored, now, now, () => {})
      response.writeHead(200, { 'content-type': fs.existsSync(`${stored}.type`) ? fs.readFileSync(`${stored}.type`, 'utf8') : 'application/octet-stream', 'content-length': sizes.get(id) })
      if (request.method === 'HEAD') return response.end()
      return fs.createReadStream(stored).on('error', () => response.destroy()).pipe(response)
    }
    // The bytes as they are stored, not unpacked on the way: the client checks them against the hash on the page.
    const reply = await fetch(`https://${host}/${rest}`, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: { 'user-agent': 'dshrsi-bench-index', 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(900000) })
    note({ ...entry, status: reply.status })
    if (reply.status !== 200) return plain(response, reply.status === 404 ? 404 : 502, reply.status === 404 ? 'No such file' : `the file host answered ${reply.status}`)
    const type = reply.headers.get('content-type') ?? 'application/octet-stream'
    const length = reply.headers.get('content-encoding') ? null : reply.headers.get('content-length')
    response.writeHead(200, { 'content-type': type, ...(length ? { 'content-length': length } : {}) })
    if (request.method === 'HEAD' || !reply.body) return response.end()
    const part = `${stored}.part-${process.pid}-${randomBytes(4).toString('hex')}`
    const out = fs.createWriteStream(part)
    let written = 0
    let failed = false
    const stream = Readable.fromWeb(reply.body)
    stream.on('data', (chunk) => { written += chunk.length; out.write(chunk) })
    stream.on('error', () => { failed = true; out.destroy(); fs.rmSync(part, { force: true }); response.destroy() })
    stream.on('end', () => out.end(() => {
      if (failed || (length && Number(length) !== written)) return fs.rmSync(part, { force: true })
      fs.writeFileSync(`${stored}.type`, type)
      fs.renameSync(part, stored)
      held += written - (sizes.get(id) ?? 0)
      sizes.set(id, written)
      makeRoom()
    }))
    stream.pipe(response)
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://index')
    const parts = url.pathname.split('/').filter(Boolean)
    if (url.pathname === '/health') return plain(response, 200, `dshrsi index, ${sizes.size} file(s) cached, ${(held / 2 ** 20).toFixed(0)} MB`)
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(response, 405, 'Only GET and HEAD')
    const session = readToken(parts[0], key)
    if (!session) { note({ kind: 'unknown', path: url.pathname.slice(0, 200), status: 403 }); return plain(response, 403, 'Not a session of this index') }
    const work = parts[1] === 'simple' && parts.length === 3 ? simple(request, response, session, parts[0], decodeURIComponent(parts[2]))
      : parts[1] === 'files' && parts.length > 3 ? file(request, response, session, parts[2], parts.slice(3).join('/'))
        : Promise.resolve(plain(response, 404, 'This index serves /simple/<project>/ and the files it links to'))
    work.catch((error) => {
      note({ run: session.run, name: session.name, kind: 'error', path: url.pathname.slice(0, 200), error: String(error?.message ?? error).slice(0, 200) })
      if (!response.headersSent) plain(response, 502, `the index could not reach PyPI: ${error?.message ?? error}`)
      else response.destroy()
    })
  })
  server.on('error', (error) => { console.error(`index: ${error.message}`); process.exit(error.code === 'EADDRINUSE' ? 0 : 1) })
  server.listen(port, '127.0.0.1', () => console.log(`${new Date().toISOString()} index: http://127.0.0.1:${port}, cache ${CACHE} (${(held / 2 ** 20).toFixed(0)} MB of at most ${(CACHE_LIMIT / 2 ** 20).toFixed(0)} MB)`))
  process.on('uncaughtException', error => console.error(`${new Date().toISOString()} index: ${error?.stack ?? error}`))
  process.on('unhandledRejection', error => console.error(`${new Date().toISOString()} index: ${error?.stack ?? error}`))
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) serve(Number(process.argv[2] ?? INDEX_PORT))
