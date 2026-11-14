#!/usr/bin/env node
// Renders the animation at the top of the README from scripts/hero/trace.html, and the still picture of its
// benchmark section from scripts/hero/chart.html. Each comes in a light and a dark version, per language.
//
//   node scripts/hero/render.mjs [en|zh ...]
//
//   THEMES=light,dark   which versions (default: both)
//   ONLY=gif|chart      one of the two kinds
//   FPS=20              moments per second the animation is sampled at
//   STILLS=3000,9000    instead of a GIF, write these moments (milliseconds) as PNG files into OUT=<dir>
//
// Needs a Chromium (CHROME=/path/to/binary, or the headless shell Playwright keeps in its cache), ffmpeg and
// gifsicle. Writes assets/rsi-trace[.<lang>][.dark].gif and assets/bench-flash[.<lang>][.dark].png, and copies the
// animations into website/assets/img for the site.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const WIDTH = 1280
const HEIGHT = 720
const FPS = Number(process.env.FPS ?? 20)
const languages = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['en', 'zh']
const themes = (process.env.THEMES ?? 'light,dark').split(',')
const only = process.env.ONLY
const stills = process.env.STILLS ? process.env.STILLS.split(',').map(Number) : null
const named = (base, language, theme, extension) => `${base}${language === 'en' ? '' : `.${language}`}${theme === 'light' ? '' : `.${theme}`}.${extension}`

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
  const painted = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const open = async (file, language, theme) => {
    await page('Page.navigate', { url: `${pathToFileURL(path.join(HERE, file))}?lang=${language}&theme=${theme}` })
    await new Promise(resolve => setTimeout(resolve, 900))
  }
  await page('Page.enable')
  await page('Runtime.enable')
  await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })

  // The animation: the page draws any moment on request, so it is sampled at a fixed rate and a moment that looks
  // like the one before it only makes that one last longer.
  for (const language of only === 'chart' ? [] : languages) {
    for (const theme of themes) {
      await open('trace.html', language, theme)
      const duration = await evaluate('window.DURATION')
      if (stills) {
        fs.mkdirSync(process.env.OUT, { recursive: true })
        for (const moment of stills) {
          await evaluate(`window.render(${moment})`)
          await painted()
          const { data } = await page('Page.captureScreenshot', { format: 'png' })
          fs.writeFileSync(path.join(process.env.OUT, `${language}-${theme}-${String(moment).padStart(5, '0')}.png`), Buffer.from(data, 'base64'))
        }
        continue
      }
      const frames = path.join(work, `${language}-${theme}`)
      fs.mkdirSync(frames)
      const kept = []
      let previous = null
      for (let moment = 0; moment <= duration; moment += 1000 / FPS) {
        await evaluate(`window.render(${moment})`)
        await painted()
        const { data } = await page('Page.captureScreenshot', { format: 'png' })
        if (data === previous) { kept[kept.length - 1].ms += 1000 / FPS; continue }
        previous = data
        fs.writeFileSync(path.join(frames, `${String(kept.length).padStart(4, '0')}.png`), Buffer.from(data, 'base64'))
        kept.push({ ms: 1000 / FPS })
      }
      // ffmpeg picks one palette for the whole animation and writes every kept picture at the same pace; gifsicle then
      // gives each one the time it really lasts (a GIF counts in hundredths of a second) and packs the result.
      const raw = path.join(frames, 'raw.gif')
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frames, '%04d.png'),
        '-filter_complex', '[0:v]split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', raw])
      const delays = []
      kept.forEach((frame, index) => {
        const hundredths = Math.round(frame.ms / 10)
        const last = delays.at(-1)
        if (last && last.hundredths === hundredths) last.to = index
        else delays.push({ hundredths, from: index, to: index })
      })
      const out = path.join(ROOT, 'assets', named('rsi-trace', language, theme, 'gif'))
      execFileSync('gifsicle', [raw, ...delays.flatMap(run => [`-d${run.hundredths}`, `#${run.from}-${run.to}`]), '-O3', '--loopcount=0', '-o', out], { stdio: ['ignore', 'ignore', 'ignore'] })
      fs.copyFileSync(out, path.join(ROOT, 'website/assets/img', path.basename(out)))
      if (process.env.KEEP_FRAMES) fs.cpSync(frames, path.join(process.env.KEEP_FRAMES, `${language}-${theme}`), { recursive: true })
      console.log(`${path.relative(ROOT, out)}  ${kept.length} frames  ${(duration / 1000).toFixed(1)} s  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
    }
  }

  // The still picture of the benchmark section: one screenshot of chart.html, twice the size for sharp text.
  for (const language of only === 'gif' || stills ? [] : languages) {
    for (const theme of themes) {
      await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false })
      await open('chart.html', language, theme)
      const height = await evaluate('document.documentElement.scrollHeight')
      await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height, deviceScaleFactor: 2, mobile: false })
      await new Promise(resolve => setTimeout(resolve, 300))
      const { data } = await page('Page.captureScreenshot', { format: 'png' })
      const out = path.join(ROOT, 'assets', named('bench-flash', language, theme, 'png'))
      fs.writeFileSync(out, Buffer.from(data, 'base64'))
      console.log(`${path.relative(ROOT, out)}  ${WIDTH}x${height} at 2x  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
    }
  }
  socket.close()
} finally {
  chrome.kill('SIGKILL')
  fs.rmSync(work, { recursive: true, force: true })
}
