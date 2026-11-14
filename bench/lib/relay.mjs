#!/usr/bin/env node
// A loopback relay to a model endpoint whose name this network resolves wrongly.
//
//   node bench/lib/relay.mjs [--keep-alive] <origin> <address[,address...]> [port]
//   node bench/lib/relay.mjs --keep-alive https://api.example.com 203.0.113.7,203.0.113.8 8791
//
// Listens on 127.0.0.1:<port> (default 8791) and passes every request on to <origin> over TLS, connecting to the
// given addresses instead of asking DNS. The certificate is still checked against the origin's name, so a wrong
// address cannot pose as the endpoint. Point the benchmark at http://127.0.0.1:<port>/v1.
//
// With --keep-alive this process only watches over the relay: it starts it, and starts it again whenever it
// exits, so that a crash costs the sessions in flight a failed request and not the rest of the run. The benchmark
// runner waits for the endpoint to answer again and starts those sessions over (bench/run.mjs).
import { spawn } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const keepAlive = args.includes('--keep-alive')
const [origin, addresses, port = '8791'] = args.filter(entry => entry !== '--keep-alive')
if (!origin || !addresses) {
  console.error('usage: node bench/lib/relay.mjs [--keep-alive] <origin> <address[,address...]> [port]')
  process.exit(2)
}
const stamp = () => new Date().toISOString()

if (keepAlive) {
  let child
  let stopping = false
  let quick = 0
  const start = () => {
    const began = Date.now()
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), origin, addresses, port], { stdio: 'inherit' })
    child.on('exit', (code, signal) => {
      if (stopping) return
      // A relay that keeps dying at once (the port is taken, the arguments are wrong) is started less and less often.
      quick = Date.now() - began < 5000 ? quick + 1 : 0
      const wait = Math.min(1000 * 2 ** quick, 30000)
      console.log(`${stamp()} relay: exited (${signal ?? code}); starting it again in ${wait / 1000}s`)
      setTimeout(start, wait)
    })
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { stopping = true; child?.kill(signal); process.exit(0) })
  start()
} else {
  const target = new URL(origin)
  const list = addresses.split(',')
  let turn = 0
  const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 512,
    lookup(hostname, options, callback) {
      const address = list[(turn += 1) % list.length]
      const family = address.includes(':') ? 6 : 4
      if (options?.all) callback(null, [{ address, family }])
      else callback(null, address, family)
    },
  })

  let served = 0
  let failed = 0
  const server = http.createServer((request, response) => {
    const upstream = https.request({
      host: target.hostname, port: target.port || 443, servername: target.hostname, agent,
      method: request.method, path: request.url, headers: { ...request.headers, host: target.host },
    }, (reply) => {
      served += 1
      response.writeHead(reply.statusCode ?? 502, reply.headers)
      reply.on('error', () => response.destroy())
      reply.pipe(response)
    })
    upstream.on('error', (error) => {
      failed += 1
      if (response.destroyed) return
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: `relay: ${error.message}`, type: 'relay_error' } }))
    })
    // A client that goes away in the middle of a request or a response is not this process's failure.
    request.on('error', () => upstream.destroy())
    response.on('error', () => upstream.destroy())
    response.on('close', () => upstream.destroy())
    request.pipe(upstream)
  })
  // A model response can take minutes; the defaults would cut it off.
  server.requestTimeout = 0
  server.headersTimeout = 0
  server.keepAliveTimeout = 120000
  server.on('clientError', (error, socket) => { if (!socket.destroyed) socket.destroy() })
  server.on('error', (error) => { console.error(`${stamp()} relay: ${error.message}`); process.exit(1) })
  // One connection's failure must not end the relay for every session using it.
  process.on('uncaughtException', error => console.error(`${stamp()} relay: ${error?.stack ?? error}`))
  process.on('unhandledRejection', error => console.error(`${stamp()} relay: ${error?.stack ?? error}`))
  server.listen(Number(port), '127.0.0.1', () => console.log(`${stamp()} relay: http://127.0.0.1:${port} -> ${target.origin} at ${list.join(', ')}`))
  setInterval(() => console.log(`${stamp()} relay: ${served} served, ${failed} failed`), 600000).unref()
}
