#!/usr/bin/env node
// Writes market/index.json: a plugin index in the format DeepSeek Harness reads
// (Plugins → Discover → Add index source), listing this repository's plugin at
// one pinned commit.
//
//   node scripts/market-index.mjs <40-hex commit> [unix seconds]
//
// The commit is the one users install; it has to exist on the remote.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dir = path.join(root, 'packages/dsh-rsi')
const [commit, stamp] = process.argv.slice(2)
if (!/^[0-9a-f]{40}$/.test(commit ?? '')) {
  console.error('usage: node scripts/market-index.mjs <40-hex commit> [unix seconds]')
  process.exit(2)
}
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
const locale = name => JSON.parse(fs.readFileSync(path.join(dir, 'locale', `${name}.json`), 'utf8')).meta
const en = locale('en')
const zh = locale('zh')
const icon = fs.readFileSync(path.join(dir, 'icon.svg'))
const publishTimestamp = Number(stamp ?? execFileSync('git', ['show', '-s', '--format=%ct', commit], { cwd: root, encoding: 'utf8' }).trim())
const web = manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')

const index = {
  format: 1,
  title: { en: 'DSHRSI', zh: 'DSHRSI' },
  description: { en: 'Recursive Self-Improvement for DeepSeek Harness.', zh: 'DeepSeek Harness 上的递归自我改进。' },
  plugins: [{
    name: manifest.name,
    title: { en: en.title, zh: zh.title },
    description: { en: en.description, zh: zh.description },
    icon: `data:image/svg+xml;base64,${icon.toString('base64')}`,
    author: manifest.author,
    homepage: manifest.homepage,
    repository: { url: web, directory: manifest.repository.directory },
    versions: [{
      version: manifest.version,
      publishTimestamp,
      source: { type: 'git', url: web, commit, path: manifest.repository.directory },
      engines: { dsh: manifest.engines.dsh },
    }],
  }],
}
fs.mkdirSync(path.join(root, 'market'), { recursive: true })
fs.writeFileSync(path.join(root, 'market/index.json'), `${JSON.stringify(index, null, 2)}\n`)
console.log(`market/index.json: ${manifest.name}@${manifest.version} at ${commit.slice(0, 12)}`)
