#!/usr/bin/env node
// Renders the animation at the top of the README from scripts/hero/trace.html, and the still picture of its
// benchmark section from scripts/hero/chart.html.
//
//   node scripts/hero/render.mjs [en|zh ...]
//
// Needs a Chromium (CHROME=/path/to/binary, or the headless shell Playwright keeps in its cache), ffmpeg and
// gifsicle. Writes assets/rsi-trace.gif, and assets/rsi-trace.<lang>.gif for every other language, and copies them
// into website/assets/img for the site. The picture goes to assets/bench-flash.png (and .<lang>.png).
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const WIDTH = 1280
const HEIGHT = 720
const languages = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['en', 'zh']

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright')
  const found = fs.existsSync(cache) ? fs.readdirSync(cache, { recursive: true }).map(String).find(entry => /chrome-headless-shell$/.test(entry)) : undefined
  if (!found) throw new Error('no Chromium found: set CHROME to a Chromium or Chrome binary')
  return path.join(cache, found)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dshrsi-hero-'))
const chrome = spawn(findChrome(), ['--remote-debugging-port=0', `--user-data-dir=${path.join(work, 'profile')}`, `--window-size=${WIDTH},${HEIGHT}`, '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files', 'about:blank'])
const endpoint = await new Promise((resolve, reject) => {
  chrome.stderr.on('data', (chunk) => {
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(String(chunk))
    if (match) resolve(match[1])
  })
  chrome.on('exit', () => reject(new Error('Chromium exited before it was ready')))
})

try {
  const socket = new WebSocket(endpoint)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let nextId = 0
  const waiting = new Map()
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data)
    if (!data.id || !waiting.has(data.id)) return
    const { resolve, reject } = waiting.get(data.id)
    waiting.delete(data.id)
    if (data.error) reject(new Error(data.error.message))
    else resolve(data.result)
  }
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = (nextId += 1)
    waiting.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const { targetInfos } = await send('Target.getTargets')
  const { sessionId } = await send('Target.attachToTarget', { targetId: targetInfos.find(target => target.type === 'page').targetId, flatten: true })
  const page = (method, params) => send(method, params, sessionId)
  const evaluate = async (expression) => {
    const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  await page('Page.enable')
  await page('Runtime.enable')
  await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })

  for (const language of languages) {
    const frames = path.join(work, language)
    fs.mkdirSync(frames)
    await page('Page.navigate', { url: `${pathToFileURL(path.join(HERE, 'trace.html'))}?lang=${language}` })
    await new Promise(resolve => setTimeout(resolve, 900))
    const count = await evaluate('window.frameCount')
    const list = []
    for (let index = 0; index < count; index += 1) {
      const hold = await evaluate(`window.show(${index})`)
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const { data } = await page('Page.captureScreenshot', { format: 'png' })
      const file = path.join(frames, `${String(index).padStart(3, '0')}.png`)
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
      list.push(`file '${file}'\nduration ${(hold / 1000).toFixed(3)}`)
    }
    // The concat demuxer needs the last file named twice for its duration to count.
    list.push(`file '${path.join(frames, `${String(count - 1).padStart(3, '0')}.png`)}'`)
    fs.writeFileSync(path.join(frames, 'list.txt'), `${list.join('\n')}\n`)
    const raw = path.join(frames, 'raw.gif')
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(frames, 'list.txt'),
      '-filter_complex', '[0:v]split[a][b];[a]palettegen=max_colors=64:stats_mode=full[p];[b][p]paletteuse=dither=none', '-fps_mode', 'vfr', raw])
    const out = path.join(ROOT, 'assets', language === 'en' ? 'rsi-trace.gif' : `rsi-trace.${language}.gif`)
    execFileSync('gifsicle', ['-O3', '--loopcount=0', raw, '-o', out])
    fs.copyFileSync(out, path.join(ROOT, 'website/assets/img', path.basename(out)))
    if (process.env.KEEP_FRAMES) fs.cpSync(frames, path.join(process.env.KEEP_FRAMES, language), { recursive: true })
    console.log(`${path.relative(ROOT, out)}  ${count} frames  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
  }

  // The still picture of the benchmark section: one screenshot of chart.html, twice the size for sharp text.
  for (const language of languages) {
    await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false })
    await page('Page.navigate', { url: `${pathToFileURL(path.join(HERE, 'chart.html'))}?lang=${language}` })
    await new Promise(resolve => setTimeout(resolve, 900))
    const height = await evaluate('document.documentElement.scrollHeight')
    await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height, deviceScaleFactor: 2, mobile: false })
    await new Promise(resolve => setTimeout(resolve, 300))
    const { data } = await page('Page.captureScreenshot', { format: 'png' })
    const out = path.join(ROOT, 'assets', language === 'en' ? 'bench-flash.png' : `bench-flash.${language}.png`)
    fs.writeFileSync(out, Buffer.from(data, 'base64'))
    console.log(`${path.relative(ROOT, out)}  ${WIDTH}x${height} at 2x  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
  }
  socket.close()
} finally {
  chrome.kill('SIGKILL')
  fs.rmSync(work, { recursive: true, force: true })
}
