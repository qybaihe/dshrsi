#!/usr/bin/env node
// The harness's sandbox runner for sealed sessions. It runs nothing itself.
//
//   node sealed-client.mjs <socket> [runner arguments the harness appends] -- <program> [arguments]
//
// The harness spawns this in place of the command; it hands the command to the broker listening on <socket>
// (bench/lib/sealed.mjs), which runs it in the session's command sandbox, and passes input, output and the exit
// status through. When this process is killed, the connection closes and the broker stops the command.
import net from 'node:net'

const FAILED = 125
const [socketPath, ...rest] = process.argv.slice(2)
const argv = rest.slice(rest.indexOf('--') + 1)
const fail = (message) => { process.stderr.write(`dshrsi-sealed: ${message}\n`); process.exit(FAILED) }
if (!socketPath || !rest.includes('--') || argv.length === 0) fail('usage: sealed-client.mjs <socket> [...] -- <program> [arguments]')

const frame = (type, payload = Buffer.alloc(0)) => {
  const head = Buffer.alloc(5)
  head.write(type, 0, 'latin1')
  head.writeUInt32BE(payload.length, 1)
  return Buffer.concat([head, payload])
}

const socket = net.createConnection(socketPath)
let done = false
let pending = Buffer.alloc(0)
socket.on('connect', () => {
  // The broker builds the command's environment itself; only these presentation settings of the harness pass.
  const env = Object.fromEntries(['NO_COLOR', 'TERM', 'PAGER', 'GIT_PAGER', 'DSH_SHELL', 'DSH_SESSION_ID'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
  socket.write(frame('S', Buffer.from(JSON.stringify({ argv, cwd: process.cwd(), env }))))
  process.stdin.on('data', chunk => socket.write(frame('I', chunk)))
  process.stdin.on('end', () => socket.write(frame('E')))
  process.stdin.on('error', () => socket.write(frame('E')))
})
socket.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk])
  while (pending.length >= 5) {
    const size = pending.readUInt32BE(1)
    if (pending.length < 5 + size) break
    const type = String.fromCharCode(pending[0])
    const payload = pending.subarray(5, 5 + size)
    pending = pending.subarray(5 + size)
    if (type === 'O') process.stdout.write(payload)
    else if (type === 'R') process.stderr.write(payload)
    else if (type === 'X') {
      done = true
      const { code, signal } = JSON.parse(payload.toString('utf8'))
      // Output written above is flushed before the status is passed on.
      const leave = () => {
        if (signal) { try { process.kill(process.pid, signal) } catch { /* reported as a failure below */ } }
        process.exit(typeof code === 'number' ? code : FAILED)
      }
      process.stdout.write('', () => process.stderr.write('', leave))
    }
  }
})
socket.on('error', (error) => { if (!done) fail(`the command broker cannot be reached: ${error.message}`) })
socket.on('close', () => { if (!done) fail('the command broker closed the connection before the command ended') })
