#!/usr/bin/env node
// Draws the DSHRSI mark and writes it wherever it is used.
//
//   node scripts/logo.mjs
//
// The mark is a chambered shell, the kind a nautilus builds in deep water. One rule draws all of it: every chamber is
// the chamber before it, turned by a fixed angle and grown by a fixed factor. So the walls are logarithmic spirals,
// and each wall between two chambers is the same curve at a larger size. The last chamber is open: it is the one
// being lived in, and it carries the bolt the plugin lights in the harness when an adaptation is at work.
//
// What it stands for: the harness is the shell; each chamber is one more piece of harness code, built on the last and
// never thrown away for being old; the animal always lives in the newest one. That is recursive self-improvement.
//
// Two sizes of the same drawing are written: the full one, and one with fewer and thicker chambers for places where
// it is shown small (a browser tab, a navigation bar).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const f = value => Number(value.toFixed(3))
const hex = (r, g, b) => `#${[r, g, b].map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('')}`
const rgb = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(...x.map((value, i) => value + (y[i] - value) * t)) }
const ramp = (stops, u) => {
  if (u <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i += 1) if (u <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (u - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]))
  return stops.at(-1)[1]
}

export function shell(options = {}) {
  const {
    size = 36, margin = 1.5,
    growth = 2.7,          // how many times wider the shell gets in one full turn
    perTurn = 10,          // chambers in one full turn
    turns = 2.1,           // how far in the chambers are drawn
    live = 1.5,            // the angle the open chamber spans, in radians
    gap = 0.09,            // the wall between two chambers, as an angle
    wall = 0.09,           // the wall between two turns, as a share of the inner turn's radius
    bow = 0.2,             // how far a wall between chambers bows back, as a share of its length
    lip = 0.18,            // how far the open end bows forward
    turn = 0.6,            // the whole shell, rotated
    soft = 0.016,          // corner rounding, as a share of the chamber's radius
    colors = [[0, '#6a3fe0'], [0.3, '#5b55f6'], [0.58, '#4d6bfe'], [0.82, '#3a8dff'], [1, '#22b8f5']],
    liveColors = ['#22b8f5', '#3be3f7'],
    colorTurns = 1.5,      // the colours run over this many turns before the open chamber
    shade = 0.07,          // each chamber a little darker at its inner wall and lighter at its outer one
    bolt = 0.2,            // the size of the bolt in the open chamber, 0 for none
    ghosts = [],           // faint walls in the open chamber, where the next ones will be
    ink,                   // one colour for everything (a single-colour mark)
    id = 'dshrsi',
  } = options
  const b = Math.log(growth) / (2 * Math.PI)
  const outer = th => Math.exp(b * th)
  const inner = th => (outer(th) / growth) * (1 + wall)
  const middle = th => (outer(th) + inner(th)) / 2
  const start = -live - 2 * Math.PI * turns
  const at = (r, th) => [r * Math.cos(th + turn), -r * Math.sin(th + turn)]
  // the direction a wall r = k e^(b th) runs in, on screen
  const along = (r, th) => [r * (b * Math.cos(th + turn) - Math.sin(th + turn)), -r * (b * Math.sin(th + turn) + Math.cos(th + turn))]
  const seen = []
  // a stretch of spiral wall as cubic curves that match its direction at both ends
  const wallPath = (radius, from, to) => {
    const pieces = Math.max(1, Math.ceil(Math.abs(to - from) / 0.45))
    const out = []
    for (let i = 0; i < pieces; i += 1) {
      const a = from + ((to - from) * i) / pieces, z = from + ((to - from) * (i + 1)) / pieces, h = (z - a) / 3
      const p0 = at(radius(a), a), p1 = at(radius(z), z), s0 = along(radius(a), a), s1 = along(radius(z), z)
      seen.push(p0, p1)
      out.push(['C', [p0[0] + s0[0] * h, p0[1] + s0[1] * h], [p1[0] - s1[0] * h, p1[1] - s1[1] * h], p1])
    }
    return out
  }
  // from one wall to the other at one angle, bowed by a share of its length: back for a wall, forward for the lip
  const across = (th, toOuter, amount) => {
    const a = at(outer(th), th), z = at(inner(th), th)
    const dir = along(middle(th), th), len = Math.hypot(...dir), chord = Math.hypot(a[0] - z[0], a[1] - z[1])
    const ctrl = [(a[0] + z[0]) / 2 + (dir[0] / len) * chord * amount * 2, (a[1] + z[1]) / 2 + (dir[1] / len) * chord * amount * 2]
    return [['Q', ctrl, toOuter ? a : z]]
  }
  const chamber = (from, to, open) => {
    const a = from + gap / 2, z = open ? to : to - gap / 2
    return [['M', at(outer(a), a)], ...wallPath(outer, a, z), ...across(z, false, open ? lip : -bow), ...wallPath(inner, z, a), ...across(a, true, -bow), ['Z']]
  }
  const cells = [{ path: chamber(-live, 0, true), from: -live, to: 0, open: true }]
  for (let edge = -live; edge - (2 * Math.PI) / perTurn >= start - 1e-9; edge -= (2 * Math.PI) / perTurn) {
    cells.push({ path: chamber(edge - (2 * Math.PI) / perTurn, edge, false), from: edge - (2 * Math.PI) / perTurn, to: edge })
  }
  const first = cells.at(-1).from

  // fit the drawing into the box
  const xs = seen.map(point => point[0]), ys = seen.map(point => point[1])
  const scale = (size - 2 * margin) / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const dx = size / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * scale, dy = size / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * scale
  const xy = ([x, y]) => [x * scale + dx, y * scale + dy]
  const d = path => path.map(([command, ...points]) => command + points.map(point => xy(point).map(f).join(' ')).join(' ')).join('')

  const defs = []
  const parts = []
  const colorAt = th => ramp(colors, 1 - (-live - th) / (2 * Math.PI * colorTurns))
  cells.slice().reverse().forEach((cell, index) => {
    const mid = (cell.from + cell.to) / 2
    let fill
    if (ink) fill = ink
    else if (cell.open) {
      const g0 = xy(at(middle(cell.from), cell.from)), g1 = xy(at(middle(cell.to), cell.to))
      defs.push(`<linearGradient id="${id}-live" gradientUnits="userSpaceOnUse" x1="${f(g0[0])}" y1="${f(g0[1])}" x2="${f(g1[0])}" y2="${f(g1[1])}"><stop offset="0" stop-color="${liveColors[0]}"/><stop offset="1" stop-color="${liveColors[1]}"/></linearGradient>`)
      fill = `url(#${id}-live)`
    } else if (shade && outer(mid) * scale > 1.6) {
      const base = colorAt(mid), g0 = xy(at(inner(mid), mid)), g1 = xy(at(outer(mid), mid))
      defs.push(`<linearGradient id="${id}-${index}" gradientUnits="userSpaceOnUse" x1="${f(g0[0])}" y1="${f(g0[1])}" x2="${f(g1[0])}" y2="${f(g1[1])}"><stop offset="0" stop-color="${mix(base, '#2a2aa8', shade)}"/><stop offset="1" stop-color="${mix(base, '#ffffff', shade)}"/></linearGradient>`)
      fill = `url(#${id}-${index})`
    } else fill = colorAt(mid)
    parts.push(`<path d="${d(cell.path)}" fill="${fill}"${soft ? ` stroke="${fill}" stroke-width="${f(soft * outer(mid) * scale)}" stroke-linejoin="round"` : ''}/>`)
  })
  // everything further in than the first drawn chamber, as one solid piece: the turn before, filled to the pole
  const before = th => outer(th - 2 * Math.PI)
  const seedEnd = first + 2 * Math.PI - gap * 1.5
  const a0 = at(before(first), first), z0 = at(before(seedEnd), seedEnd)
  const dir0 = along(before(seedEnd), seedEnd), len0 = Math.hypot(...dir0), chord0 = Math.hypot(a0[0] - z0[0], a0[1] - z0[1])
  const seed = [['M', a0], ...wallPath(before, first, seedEnd), ['Q', [(a0[0] + z0[0]) / 2 - (dir0[0] / len0) * chord0 * bow * 2, (a0[1] + z0[1]) / 2 - (dir0[1] / len0) * chord0 * bow * 2], a0], ['Z']]
  const seedFill = ink ?? colors[0][1]
  parts.unshift(`<path d="${d(seed)}" fill="${seedFill}"${soft ? ` stroke="${seedFill}" stroke-width="${f(soft * before(seedEnd) * scale)}" stroke-linejoin="round"` : ''}/>`)
  for (const share of ghosts) {
    const th = -live * share
    parts.push(`<path d="${d([['M', at(outer(th) * 0.93, th)], ...across(th, false, -bow).map(([c, ctrl, end]) => [c, ctrl, at(inner(th) * 1.07, th)])])}" fill="none" stroke="#ffffff" stroke-opacity=".42" stroke-width="${f(0.022 * outer(th) * scale)}" stroke-linecap="round"/>`)
  }
  if (bolt) {
    const th = -live * 0.5, c = xy(at(middle(th) * 0.99, th)), s = bolt * scale * outer(th)
    const shape = [[0.2, -1], [-0.64, 0.14], [-0.07, 0.14], [-0.22, 1], [0.64, -0.18], [0.07, -0.18]]
    parts.push(`<path d="M${shape.map(([x, y]) => `${f(c[0] + x * s)} ${f(c[1] + y * s)}`).join('L')}Z" fill="${ink ? 'none' : '#ffffff'}" stroke="${ink ? 'none' : '#ffffff'}" stroke-width="${f(s * 0.12)}" stroke-linejoin="round"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${parts.join('')}</svg>`
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FULL = {}
const SMALL = { perTurn: 7, turns: 1.25, gap: 0.17, wall: 0.16, shade: 0, bolt: 0.24, soft: 0.03, margin: 1.2 }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const write = (file, text) => {
    fs.writeFileSync(path.join(ROOT, file), text)
    console.log(`${file}  ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`)
  }
  const full = `${shell(FULL)}\n`
  write('packages/dsh-rsi/icon.svg', full)
  write('assets/icon.svg', full)
  write('website/assets/logo.svg', `${shell(SMALL)}\n`)
  // Pictures that carry the mark inside them keep it in a group of its own, which is redrawn here.
  for (const file of ['packages/dsh-rsi/docs/preview.svg', 'assets/banner.svg']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8')
    const group = /(<g id="dshrsi-mark"[^>]*>)[\s\S]*?(<\/g>)/
    if (!group.test(text)) throw new Error(`${file}: no <g id="dshrsi-mark"> to redraw`)
    write(file, text.replace(group, (_, open, close) => `${open}${shell(FULL).replace(/^<svg[^>]*>|<\/svg>$/g, '')}${close}`))
  }
}
