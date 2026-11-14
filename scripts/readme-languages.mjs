#!/usr/bin/env node
// Keeps the language switcher at the top of every README in step with the list below.
//
//   node scripts/readme-languages.mjs            rewrite the switcher line of every README that exists
//   node scripts/readme-languages.mjs --check    also compare each translation's structure with the English README
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const LANGUAGES = [
  ['en', 'English'], ['zh', '简体中文'], ['zh-TW', '繁體中文'], ['ja', '日本語'], ['ko', '한국어'], ['tr', 'Türkçe'], ['ru', 'Русский'],
  ['vi', 'Tiếng Việt'], ['th', 'ไทย'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['uk', 'Українська'], ['pl', 'Polski'],
  ['pt-BR', 'Português (Brasil)'], ['ar', 'العربية'], ['fa', 'فارسی'], ['id', 'Bahasa Indonesia'], ['it', 'Italiano'], ['el', 'Ελληνικά'],
  ['ml', 'മലയാളം'], ['ur-Latn', 'Roman Urdu'], ['ro', 'Română'],
]
const fileOf = code => (code === 'en' ? path.join(ROOT, 'README.md') : path.join(ROOT, 'docs/readme', `README_${code}.md`))
const present = LANGUAGES.filter(([code]) => fs.existsSync(fileOf(code)))

/** The switcher as seen from one README: the language itself in bold, the others as links relative to that file. */
function switcher(current) {
  return present.map(([code, name]) => {
    if (code === current) return `**${name}**`
    const target = current === 'en' ? `docs/readme/README_${code}.md` : code === 'en' ? '../../README.md' : `README_${code}.md`
    return `[${name}](${target})`
  }).join(' · ')
}

for (const [code] of present) {
  const file = fileOf(code)
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const index = lines.findIndex(line => line.includes('**') && line.includes(' · ') && /README(_[\w-]+)?\.md/.test(line))
  if (index < 0 || index > 6) { console.log(`no switcher line found in ${path.relative(ROOT, file)}`); continue }
  if (lines[index] !== switcher(code)) {
    lines[index] = switcher(code)
    fs.writeFileSync(file, lines.join('\n'))
    console.log(`updated   ${path.relative(ROOT, file)}`)
  }
}
console.log(`${present.length} of ${LANGUAGES.length} languages present`)

if (process.argv.includes('--check')) {
  // A translation has to keep everything that is not prose: code blocks, anchors, link targets, images, table shapes.
  const shape = (text) => {
    const body = text.split('\n').slice(4).join('\n')
    return {
      // Commands and source are compared without their comments; diagrams and the file tree carry prose and are not.
      code: [...body.matchAll(/```(?:bash|js|text)\n[\s\S]*?```/g)].map(match => match[0].replace(/\s+#[^\n]*/g, '').replace(/\s+/g, ' ')),
      anchors: [...body.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]),
      links: [...body.matchAll(/\]\(([^)\s]+)\)/g)].map(match => match[1].replace(/^(\.\.\/)+/, '').replace(/README\.zh\.md|README\.md/, 'README')),
      headings: [...body.replace(/```[\s\S]*?```/g, '').matchAll(/^(#{1,6})\s/gm)].map(match => match[1].length),
      rows: body.replace(/```[\s\S]*?```/g, '').split('\n').filter(line => line.startsWith('|')).map(line => line.split('|').length),
      details: (body.match(/<details>/g) ?? []).length,
      // Every number of two or more digits (counts, versions, exit codes, percentages). Single digits are left out:
      // languages differ in whether they spell them.
      numbers: [...body.replace(/```[\s\S]*?```/g, '').matchAll(/\d[\d.]*\d/g)].map(match => match[0]).sort().join(' '),
    }
  }
  const reference = shape(fs.readFileSync(fileOf('en'), 'utf8'))
  let bad = 0
  for (const [code] of present) {
    if (code === 'en') continue
    const mine = shape(fs.readFileSync(fileOf(code), 'utf8'))
    const differing = Object.keys(reference).filter(key => JSON.stringify(reference[key]) !== JSON.stringify(mine[key]))
    if (differing.length > 0) bad += 1
    console.log(`${differing.length === 0 ? 'same shape' : `DIFFERS in ${differing.join(', ')}`}  README_${code}.md`)
    for (const key of differing) {
      if (Array.isArray(reference[key])) {
        const at = reference[key].findIndex((value, index) => value !== mine[key][index])
        console.log(`    ${key}: ${reference[key].length} vs ${mine[key].length}; first difference at ${at}: ${JSON.stringify(reference[key][at])?.slice(0, 90)} vs ${JSON.stringify(mine[key][at])?.slice(0, 90)}`)
      } else console.log(`    ${key}: ${String(reference[key]).slice(0, 60)} vs ${String(mine[key]).slice(0, 60)}`)
    }
  }
  process.exit(bad === 0 ? 0 : 1)
}
