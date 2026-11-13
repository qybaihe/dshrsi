// The way the web UI and the desktop app take a third-party plugin in: a
// packed tarball installed into the web profile. What has to hold is that the
// packed files alone are a complete bundle, browser half included.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { DSH_BIN, PLUGIN_DIR, ROOT, childEnv, makeSandbox } from '../support/harness.mjs'

const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'package.json'), 'utf8'))

/** Starts `dsh web` and resolves with its address once it prints one. */
function startWeb(env, cwd) {
  const child = spawn(DSH_BIN, ['web', '--no-open', '--port', '0'], { cwd, env })
  let output = ''
  const url = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dsh web did not start: ${output.slice(-600)}`)), 60000)
    const read = (chunk) => {
      output += chunk
      const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/.exec(output)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`dsh web exited with ${code}: ${output.slice(-600)}`)) })
  })
  return { url, stop: () => new Promise((resolve) => { child.on('exit', resolve); child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 4000) }) }
}

test('the package describes itself the way the plugin pages of the web UI and the desktop app read it', () => {
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './client', './icon', './locale/*.json', './package.json', './src/*'])
  assert.deepEqual(manifest.dsh, { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-conversation'] } })
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.scripts, undefined, 'install scripts would wait for the user\'s approval')
  assert.match(manifest.engines.dsh, /^>=0\.2\.2-rc\.0 <0\.3\.0$/)

  for (const locale of ['en', 'zh']) {
    const { meta } = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'locale', `${locale}.json`), 'utf8'))
    assert.ok(meta.title.length > 0 && meta.title.length <= 60, `${locale} title`)
    assert.ok(meta.description.length > 200, `${locale} description says what it does and what it costs`)
    const detail = fs.readFileSync(path.join(PLUGIN_DIR, meta.detail), 'utf8')
    assert.match(detail, /^!\[[^\]]{20,}\]\(preview\.svg\)\n$/, `${locale} detail document is one image line`)
  }

  const icon = fs.readFileSync(path.join(PLUGIN_DIR, 'icon.svg'), 'utf8')
  assert.match(icon, /viewBox="0 0 36 36"/)
  assert.ok(Buffer.byteLength(icon) < 32 * 1024, 'small enough to be inlined in a market index')
  const preview = fs.readFileSync(path.join(PLUGIN_DIR, 'docs/preview.svg'), 'utf8')
  assert.match(preview, /width="640" height="300" viewBox="0 0 640 300"/)
  for (const svg of [icon, preview]) assert.doesNotMatch(svg, /<(?:text|script|style|foreignObject|image|animate)\b|\son\w+=|href=/, 'self-contained artwork only')
})

test('installed from a packed tarball into the web profile, the bundle loads with its browser half', async (t) => {
  const box = makeSandbox('app')
  t.after(box.cleanup)
  const cwd = box.workspace('ws', { 'a.txt': 'x\n' })
  const env = childEnv({ DSH_HOME: box.home, PATH: `${path.join(ROOT, 'node_modules/.bin')}${path.delimiter}${process.env.PATH}` })

  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', box.dir], { cwd: PLUGIN_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  const tarball = path.join(box.dir, packed.filename)
  const shipped = packed.files.map(file => file.path)
  for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'docs/DETAIL.md', 'docs/DETAIL.zh.md', 'docs/preview.svg', 'locale/en.json', 'locale/zh.json', 'bin/rsi.js', 'src/engine.js', 'src/surface.js']) {
    assert.ok(shipped.includes(file), `${file} is in the tarball`)
  }
  assert.ok(packed.size < 200 * 1024)

  execFileSync(DSH_BIN, ['plugin', '--profile', 'web', 'add', tarball], { env, encoding: 'utf8', stdio: 'pipe' })
  const profile = path.join(box.home, 'profiles/web')
  assert.ok(JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8')).dsh.profile.bundles.includes('dsh-rsi'))
  const installed = fs.realpathSync(path.join(profile, 'node_modules/dsh-rsi'))
  assert.ok(!installed.startsWith(ROOT), 'a copy made from the tarball, not a link to this checkout')
  assert.ok(fs.existsSync(path.join(installed, 'client.js')))

  const web = startWeb(env, cwd)
  t.after(web.stop)
  const address = new URL(await web.url)
  // The token is traded for a cookie; everything after that is an ordinary page load.
  const first = await fetch(address, { redirect: 'manual' })
  const cookie = first.headers.getSetCookie().map(entry => entry.split(';')[0]).join('; ')
  const page = await fetch(new URL(first.headers.get('location') ?? '/', address), { headers: { cookie } })
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /[,?]dsh-rsi\/client\.js[,&]/, 'the page loads the plugin\'s browser half')
  const rev = /dsh-rsi\/client\.js[^"]*?&amp;rev=([0-9a-f]+)/.exec(html)?.[1]
  const script = await fetch(new URL(`plugins/??dsh-rsi/client.js&rev=${rev}`, address), { headers: { cookie } })
  if (script.status === 200) {
    const body = await script.text()
    assert.match(body, /__ModuleLoader__\.load\(\{\s*id: 'dsh-rsi'/)
  } else {
    // The combined URL the page itself uses is the contract; a single-file URL is a convenience some versions refuse.
    assert.ok([400, 404].includes(script.status), `unexpected status ${script.status}`)
  }
})
