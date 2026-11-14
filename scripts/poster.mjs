#!/usr/bin/env node
// Draws the X-banner for the project stand: 80 cm x 180 cm, portrait.
//
//   node scripts/poster.mjs
//
// Writes assets/poster/dshrsi-x-banner.svg (one user unit is one millimetre), prints it to
// assets/poster/dshrsi-x-banner.pdf at exactly 800 mm x 1800 mm with the type embedded, and leaves a small PNG next
// to them to look at. The PDF and the PNG need a Chromium (CHROME=/path/to/binary, or the headless shell Playwright
// keeps in its cache); without one only the SVG is written.
//
// Laid out for how a banner is read: the claim and the mark at eye level, the code to scan at hand height, the
// pit stop (how it works) in the middle, thirty real sessions with and without the plugin below it. Nothing that
// matters sits within 4 cm of an edge, and the corners are left empty for the stand's hooks.
//
// The mark and the data are the project's own: scripts/logo.mjs and bench/results/trace.json.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { shell } from './logo.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets/poster')
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/results/trace.json'), 'utf8'))
const stock = T.arms.dsh, plugin = T.arms.rsi

const W = 800, H = 1800, M = 56
const C = {
  ink: '#0f1115', text: '#3f434b', dim: '#7c818b', line: '#e2e6ee', band: '#eef1f7',
  brand: '#4d6bfe', violet: '#7c5cff', cyan: '#12b5e5',
}
const SANS = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Helvetica Neue', Arial, sans-serif"
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

const esc = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]))
const inner = svg => svg.replace(/^<svg[^>]*>|<\/svg>\s*$/g, '')
const text = (x, y, value, { size, weight = 400, fill = C.ink, anchor, spacing, family } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor ? ` text-anchor="${anchor}"` : ''}${spacing ? ` letter-spacing="${spacing}"` : ''}${family ? ` font-family="${family}"` : ''}>${value}</text>`
const kicker = (x, y, value) => text(x, y, esc(value), { size: 13.5, weight: 600, fill: C.brand, spacing: '.14em', family: MONO })

// The code to scan: https://github.com/qybaihe/dshrsi, version 4, error correction Q (made once with segno).
const QR = '111111100111111110100010001111111|100000101110111011010110001000001|101110100101000101110010001011101|101110101101010000010000001011101|101110101110101011101101101011101|100000100000011000101111001000001|111111101010101010101010101111111|000000001001110100111000100000000|010111101010010001011010011011010|110110011001110010110011000011100|011000101101010011100101101011111|110110010100011011000001101100100|100011111110011011111110101000010|011110010010011000010110000101100|010101110111100010000001101111100|110010010110111110010011010000101|100001100011001010010010111111000|001000001101011011111110001010101|011110110000100101010001111101101|110100000110111000100100000011101|100100101100110101101100100101011|101001010100001101001010100111000|100000101101110011000001111010011|100110001010011100100001111010110|111100100110101100111001111111011|000000001010011010001001100010110|111111100001101101011111101010100|100000101101011010100001100011111|101110101111101010111101111110001|101110101001111110001100110100101|101110100100011101001001010111111|100000101010101010100010110111111|111111100010011011000000100111000'.split('|')
function qr(x, y, size) {
  const cell = size / QR.length
  let d = ''
  QR.forEach((row, r) => {
    // one rectangle for each run of dark cells in a row
    for (const run of row.matchAll(/1+/g)) d += `M${(x + run.index * cell).toFixed(3)} ${(y + r * cell).toFixed(3)}h${(run[0].length * cell).toFixed(3)}v${cell.toFixed(3)}h${(-run[0].length * cell).toFixed(3)}z`
  })
  return `<path d="${d}" fill="${C.ink}" shape-rendering="crispEdges"/>`
}

// The headline's colours run from violet through the brand blue to cyan, one flat colour to a character. A gradient
// on live type would look the same on screen, but some print software paints the gradient's whole box instead of the
// letters; flat fills print the same everywhere.
const channel = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16))
const blend = (a, b, t) => `#${channel(a).map((value, index) => Math.round(value + (channel(b)[index] - value) * t).toString(16).padStart(2, '0')).join('')}`
const along = t => (t <= 0.45 ? blend(C.violet, C.brand, t / 0.45) : blend(C.brand, C.cyan, (t - 0.45) / 0.55))
const sweep = word => [...word].map((char, index, all) => `<tspan fill="${along((index + 0.5) / all.length)}">${esc(char)}</tspan>`).join('')

// DeepSeek's whale, read from the reference clone of DeepSeek Harness when it is there. It is used once or twice
// as a label on the name of their product, next to words that say what this project is to it, and never as this
// project's own mark: their brand guidelines ask that official material not be shown in a way that suggests
// endorsement. Without the clone the labels are words only.
const WHALE_FILE = path.join(ROOT, 'deepseek-harness/apps/web/public/favicon.svg')
const whalePath = fs.existsSync(WHALE_FILE) ? /<path[^>]*\sd="([^"]+)"/.exec(fs.readFileSync(WHALE_FILE, 'utf8'))?.[1] : undefined
const whale = (x, y, size, fill) => (whalePath ? `<path transform="translate(${x} ${y}) scale(${(size / 50).toFixed(4)})" d="${whalePath}" fill="${fill}"/>` : '')

// ---------- the car, seen from above, nose to the right; 560 long ----------
// Print software disagrees about gradients that fade to transparent (one renderer showed parts of the car at half
// strength, and the browser turned some of them into coarse pictures). So light and shade here are built from flat
// colours and flat transparency: a glow is a stack of faint ellipses, the roundness of the body a few clipped bands.
const glow = (cx, cy, rx, ry, colour, steps, each) => Array.from({ length: steps }, (_, index) => {
  const t = 1 - index / steps
  return `<ellipse cx="${cx}" cy="${cy}" rx="${(rx * t).toFixed(1)}" ry="${(ry * t).toFixed(1)}" fill="${colour}" fill-opacity="${each}"/>`
}).join('')

function car() {
  const tyre = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h * 0.3}" fill="#0b0d13" stroke="#3a4560" stroke-width="1.2"/>
    <rect x="${x + 5}" y="${y + h * 0.3}" width="${w - 10}" height="${h * 0.4}" rx="${h * 0.16}" fill="#1b2130"/>
    <rect x="${x + 9}" y="${y + h * 0.43}" width="${w - 18}" height="${h * 0.14}" rx="${h * 0.07}" fill="#2a3246"/>
    <path d="${[0.22, 0.4, 0.6, 0.78].map(t => `M${(x + w * t).toFixed(1)} ${y + 3}v${h - 6}`).join('')}" stroke="#05060a" stroke-width="1.6"/>`
  // everything that exists on both sides is drawn once and mirrored
  const side = `
    <path d="M150 -22L170 -66M204 -15L190 -66M178 -18L180 -66M-152 -20L-176 -64M-214 -13L-202 -64M-190 -14L-190 -64" fill="none" stroke="#5b6789" stroke-width="3.4" stroke-linecap="round"/>
    ${tyre(-232, -108, 84, 46)}
    ${tyre(142, -102, 74, 38)}
    <path d="M222 -101Q230 -72 240 -57V-19L231 -17V-52Q219 -76 222 -101Z" fill="#3552d6"/>
    <path d="M240 -104H260Q270 -104 270 -93V-17L251 -13V-63Q242 -84 240 -104Z" fill="#2fd0f5"/>
    <path d="M261 -99V-17" stroke="#b9f1ff" stroke-width="1.4"/>
    <rect x="218" y="-110" width="56" height="7" rx="3.5" fill="#0b0e15" stroke="#3a4560" stroke-width="1"/>
    <path d="M20 -66C40 -64 52 -46 60 -35L46 -33C40 -46 32 -55 18 -57Z" fill="#0a0d14"/>
    <path d="M77 -30L74 -40" stroke="#5b6789" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="66" y="-46" width="16" height="8" rx="3.5" fill="#5878ff"/>
    <rect x="-282" y="-86" width="50" height="9" rx="4" fill="#0b0e15" stroke="#4ade80" stroke-width="1.5"/>`
  const body = 'M-238 -9L-150 -22C-120 -27 -112 -68 -70 -71H18C44 -71 58 -42 72 -31L120 -24C170 -20 228 -11 266 -7Q279 0 266 7C228 11 170 20 120 24L72 31C58 42 44 71 18 71H-70C-112 68 -120 27 -150 22L-238 9Z'
  // the body is round: darker towards both edges, a little lighter along the top. Each layer is the same outline,
  // squeezed towards the centre line, so the shade follows the shape.
  const layer = (squeeze, shade) => `<g transform="scale(1 ${squeeze})"><path d="${body}" fill="url(#c-body)"/>${shade ? `<path d="${body}" fill="#060818" fill-opacity="${shade}"/>` : ''}</g>`
  return `
    ${glow(-258, 0, 78, 138, '#22c55e', 30, 0.016)}
    <path d="M-226 -36L-150 -80H58Q84 -80 100 -52L116 -30V30L100 52Q84 80 58 80H-150L-226 36Z" fill="#121727" stroke="#2c3654" stroke-width="1.6" stroke-linejoin="round"/>
    ${side}<g transform="scale(1 -1)">${side}</g>
    <path d="M-240 -8H-224M-240 8H-224" stroke="#5b6789" stroke-width="3.4" stroke-linecap="round"/>
    <rect x="-276" y="-78" width="36" height="156" rx="7" fill="#22c55e"/>
    <rect x="-264" y="-72" width="10" height="144" rx="5" fill="#86efac"/>
    ${layer(1, 0.34)}${layer(0.9, 0.2)}${layer(0.8, 0.09)}${layer(0.68, 0)}
    <g transform="scale(1 .22)"><path d="${body}" fill="#ffffff" fill-opacity=".13"/></g>
    <path d="M-98 -43C-58 -48 -10 -48 22 -41M-98 43C-58 48 -10 48 22 41" fill="none" stroke="#ffffff" stroke-opacity=".3" stroke-width="2" stroke-linecap="round"/>
    <path d="M-92 -33h30M-92 -26h30M-92 33h30M-92 26h30" stroke="#0a0d14" stroke-opacity=".4" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M-226 0H258" stroke="#ffffff" stroke-opacity=".5" stroke-width="2.2" stroke-linecap="round"/>
    <ellipse cx="50" cy="0" rx="34" ry="16.5" fill="#0a0d14"/>
    <rect x="13" y="-10" width="18" height="20" rx="6" fill="#1c2438"/>
    <ellipse cx="2" cy="0" rx="8" ry="6.5" fill="#0a0d14"/>
    <rect x="-22" y="-3" width="13" height="6" rx="2" fill="#0a0d14"/>
    <circle cx="46" cy="0" r="12" fill="#35c9f0"/>
    <circle cx="43" cy="-3.5" r="5.2" fill="#b9f6ff"/>
    <path d="M53 -8.6A12 12 0 0 1 53 8.6" fill="none" stroke="#0a0d14" stroke-width="4.4" stroke-linecap="round"/>
    <path d="M86 0H66M66 0C56 -19 34 -21 15 -18M66 0C56 19 34 21 15 18" fill="none" stroke="#dbe2f5" stroke-width="3.6" stroke-linecap="round"/>`
}

function draw() {
  const emblem = inner(shell({ id: 'pe', perTurn: 12, turns: 2.75, gap: 0.075, shade: 0.09 }))
  const WHITE = '#ffffff', PALE = '#b7c0da'

  // ---------- the hero ----------
  const EMBLEM = 352
  const mine = whalePath ? 32 : 0
  const hero = `
<rect width="${W}" height="900" fill="url(#p-sky)"/>
<circle cx="90" cy="60" r="430" fill="url(#p-glow-a)"/>
<circle cx="720" cy="330" r="400" fill="url(#p-glow-b)"/>

${text(M - 2, 96, 'DSHRSI', { size: 38, weight: 800, spacing: '.05em' })}
${whale(M, 116, 25, C.brand)}
${text(M + mine, 135.5, '为 DeepSeek Harness 而做的开源插件', { size: 15.5, fill: C.text })}

<circle cx="${W - 44 - EMBLEM / 2}" cy="${40 + EMBLEM / 2}" r="${EMBLEM * 0.62}" fill="url(#p-halo)"/>
<g transform="translate(${W - 44 - EMBLEM} 40) scale(${(EMBLEM / 36).toFixed(4)})">${emblem}</g>

<rect x="${M}" y="296" width="318" height="42" rx="21" fill="#ffffff" fill-opacity=".78" stroke="#ffffff"/>
<circle cx="${M + 22}" cy="317" r="5" fill="${C.brand}"/>
${text(M + 38, 322.5, 'RSI = Recursive Self-Improvement', { size: 15.5, weight: 600, fill: C.ink })}

${text(M - 4, 476, '让 Harness', { size: 114, weight: 700, spacing: '-.015em' })}
${text(M - 4, 608, sweep('自己变强'), { size: 114, weight: 700, spacing: '-.005em' })}

${text(M, 678, '同一个错再出现时，Harness 用会话里的', { size: 25, fill: C.text })}
${text(M, 718, '模型给自己写代码，校验通过，当场装上。', { size: 25, fill: C.text })}
${text(M, 766, '下一次运行，从更好的自己开始。', { size: 25, weight: 600 })}

<rect x="${W - M - 150}" y="640" width="150" height="182" rx="16" fill="#ffffff" stroke="${C.line}" stroke-width="1"/>
${qr(W - M - 150 + 14, 654, 122)}
${text(W - M - 75, 806, '扫码看项目', { size: 13.5, weight: 600, anchor: 'middle' })}`

  // ---------- how it works: the pit stop, at night ----------
  const TOP = 990, TALL = 392, LEFT = 32, RIGHT = W - 32, BOTTOM = TOP + TALL
  const SCALE = 0.86, CX = 360, CY = TOP + 206
  const CARD = { cx: CX + 20, cy: CY }
  const at = (x, y) => [CX + x * SCALE, CY + y * SCALE]
  const SHELF = TOP + 88
  const [wingX] = at(-258, 0), [helmetX] = at(46, 0), [podX, podY] = at(-112, 68)
  // a part of the car, a thin line, and what it stands for
  const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="7.5" fill="${WHITE}" fill-opacity=".16"/><circle cx="${x}" cy="${y}" r="3.2" fill="${WHITE}"/>`
  const lights = [0, 1, 2, 3, 4].map((index) => {
    const x = RIGHT - 32 - 172 + 22 + index * 32
    return `${glow(x, TOP + 55, 17.5, 17.5, '#22c55e', 4, 0.13)}<circle cx="${x}" cy="${TOP + 55}" r="10.5" fill="#22c55e"/><circle cx="${x - 3}" cy="${TOP + 52}" r="3.2" fill="#b6f5cb"/>`
  }).join('')
  // a streak of light that fades in towards the car: three flat pieces, each shorter and on top of the last
  const streak = (y, from, to, opacity) => [0, 0.4, 0.7].map(t => `<path d="M${(from + (to - from) * t).toFixed(1)} ${y}H${to}" stroke="#8fa4ff" stroke-opacity="${(opacity * 0.16).toFixed(3)}" stroke-width="2.4" stroke-linecap="round"/>`).join('')
  const how = `
${kicker(M, 878, 'HOW IT WORKS')}
${text(M - 2, 932, '跑到一半，进站换件', { size: 46, weight: 700, spacing: '-.01em' })}
${text(M, 966, '车手觉得车不对劲，不会等到下一场比赛。Harness 也不会。', { size: 17.5, fill: C.text })}

<rect x="${LEFT}" y="${TOP}" width="${RIGHT - LEFT}" height="${TALL}" rx="30" fill="url(#c-night)"/>
<rect x="${LEFT + 0.8}" y="${TOP + 0.8}" width="${RIGHT - LEFT - 1.6}" height="${TALL - 1.6}" rx="29.2" fill="none" stroke="#8fa4ff" stroke-opacity=".3" stroke-width="1.6"/>
<rect x="${(at(-296, 0)[0]).toFixed(1)}" y="${CY - 106}" width="${(588 * SCALE).toFixed(1)}" height="212" rx="10" fill="${WHITE}" fill-opacity=".022" stroke="${WHITE}" stroke-opacity=".16" stroke-width="1.4" stroke-dasharray="9 9"/>
${streak(CY - 54, 44, 300, 0.9)}${streak(CY - 18, 60, 250, 0.55)}${streak(CY + 26, 40, 280, 0.75)}${streak(CY + 62, 70, 240, 0.5)}

<g transform="translate(${CX} ${CY}) scale(${SCALE})">${car()}</g>

<path d="M${wingX} ${CY - 78}V${SHELF}H${M + 8}" fill="none" stroke="${WHITE}" stroke-opacity=".55" stroke-width="1.3"/>
${dot(wingX, CY - 78)}
${text(M + 8, SHELF - 36, '新零件', { size: 23, weight: 700, fill: '#4ade80' })}
${text(M + 8, SHELF - 12, '模型当场写的 Harness 代码', { size: 15.5, fill: PALE })}

<path d="M${helmetX} ${CY - 14}V${SHELF}H${helmetX + 150}" fill="none" stroke="${WHITE}" stroke-opacity=".55" stroke-width="1.3"/>
${dot(helmetX, CY - 14)}
${text(helmetX + 12, SHELF - 12, '<tspan font-weight="700" fill="#ffffff">车手</tspan><tspan dx="8" fill="#7f8aab">=</tspan><tspan dx="8">模型</tspan>', { size: 20, fill: PALE })}

<path d="M${podX} ${podY}V${BOTTOM - 62}H${podX + (whalePath ? 268 : 178)}" fill="none" stroke="${WHITE}" stroke-opacity=".55" stroke-width="1.3"/>
${dot(podX, podY)}
${text(podX + 12, BOTTOM - 33, `<tspan font-weight="700" fill="#ffffff">赛车</tspan><tspan dx="8" fill="#7f8aab">=</tspan>${whalePath ? '' : '<tspan dx="8">Harness</tspan>'}`, { size: 20, fill: PALE })}
${whalePath ? `${whale(podX + 86, BOTTOM - 52, 24, '#8fa4ff')}${text(podX + 116, BOTTOM - 33, 'DeepSeek Harness', { size: 20, fill: PALE })}` : ''}

<rect x="${RIGHT - 32 - 172}" y="${TOP + 30}" width="172" height="50" rx="18" fill="#05070d" stroke="#2a3350" stroke-width="1.2"/>
${lights}
${text(RIGHT - 32, TOP + 112, '五盏灯', { size: 20, weight: 700, fill: WHITE, anchor: 'end' })}
${text(RIGHT - 32, TOP + 135, '五道校验', { size: 15.5, fill: PALE, anchor: 'end' })}

${text(RIGHT - 32, BOTTOM - 80, '进站用时', { size: 15.5, fill: PALE, anchor: 'end' })}
${text(RIGHT - 32 - 30, BOTTOM - 32, T.adaptation.secondsToMount, { size: 56, weight: 700, fill: WHITE, anchor: 'end', spacing: '-.02em' })}
${text(RIGHT - 32, BOTTOM - 32, '秒', { size: 23, weight: 600, fill: PALE, anchor: 'end' })}`

  // ---------- in practice: thirty sessions, with and without ----------
  const P = BOTTOM + 50
  const CELL = 16, GAP = 3.5, TALLCELL = 40, GRID = 30 * CELL + 29 * GAP
  const wroteAt = plugin.sessions.findIndex(session => session.task === T.adaptation.writtenIn.task)
  const wideAt = plugin.sessions.findIndex(session => session.startedMs > T.adaptation.widenedAtMs)
  const cellX = index => M + index * (CELL + GAP)
  const lane = (y, arm, label, idle, count, colour) => `
${text(M, y - 9, label, { size: 15.5, weight: 600 })}
${arm.sessions.map((session, index) => `<rect x="${cellX(index).toFixed(2)}" y="${y}" width="${CELL}" height="${TALLCELL}" rx="5" fill="${session.failed > 0 ? '#e5383b' : idle}"/>`).join('')}
${text(W - M - 40, y + 32, count, { size: 36, weight: 700, fill: colour, anchor: 'end', spacing: '-.02em' })}
${text(W - M, y + 32, `/ ${arm.sessions.length}`, { size: 15.5, fill: C.dim, anchor: 'end' })}`
  const R1 = P + 92, R2 = P + 162
  const practice = `
${kicker(M, P, 'IN PRACTICE')}
${text(M - 2, P + 48, '学一次，后面的会话都记得', { size: 40, weight: 700, spacing: '-.01em' })}
${lane(R1, stock, '原版 Harness', '#dfe3ea', stock.hit, C.ink)}
<rect x="${(M + GRID - 163).toFixed(1)}" y="${R1 - 20.5}" width="12" height="12" rx="3.5" fill="#e5383b"/>
${text(M + GRID, R1 - 9, '撞上同一个失败的会话', { size: 14.5, fill: C.text, anchor: 'end' })}
${lane(R2, plugin, '装上 DSHRSI', '#cddafe', plugin.hit, C.brand)}
<rect x="${(cellX(wroteAt) - 3).toFixed(2)}" y="${R2 - 3}" width="${CELL + 6}" height="${TALLCELL + 6}" rx="7.5" fill="none" stroke="${C.brand}" stroke-width="2.2"/>
<path d="M${(cellX(wroteAt) + CELL / 2).toFixed(2)} ${R2 + TALLCELL + 4}v12" stroke="${C.brand}" stroke-width="1.6" stroke-linecap="round"/>
${text(cellX(wroteAt) + CELL / 2, R2 + TALLCELL + 34, '改进', { size: 15, weight: 600, fill: C.brand, anchor: 'middle' })}
<path d="M${cellX(wideAt).toFixed(2)} ${R2 + TALLCELL + 17}v-9h${(cellX(29) + CELL - cellX(wideAt)).toFixed(2)}v9" fill="none" stroke="${C.brand}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
${text(cellX(wideAt) + 2, R2 + TALLCELL + 34, '从这里起，每个会话都带着这次改进', { size: 15, weight: 600, fill: C.brand })}`

  // ---------- the foot ----------
  const F = H - 56
  const foot = `
<path d="M${M} ${F - 34}H${W - M}" stroke="${C.line}" stroke-width="1.2"/>
${text(M, F, 'github.com/qybaihe/dshrsi', { size: 19, weight: 600, family: MONO })}
${text(W - M, F, '开源 · MIT · 社区项目，非 DeepSeek 官方出品', { size: 12.5, fill: C.dim, anchor: 'end' })}`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm" font-family="${SANS}" role="img">
<title>DSHRSI：让 Harness 自己变强。为 DeepSeek Harness 而做的递归自我改进插件。</title>
<defs>
  <linearGradient id="p-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dbe6ff"/><stop offset=".55" stop-color="#edf2ff"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
  <radialGradient id="p-glow-a"><stop offset="0" stop-color="${C.brand}" stop-opacity=".3"/><stop offset="1" stop-color="${C.brand}" stop-opacity="0"/></radialGradient>
  <radialGradient id="p-glow-b"><stop offset="0" stop-color="#73a3d2" stop-opacity=".36"/><stop offset="1" stop-color="#73a3d2" stop-opacity="0"/></radialGradient>
  <radialGradient id="p-halo"><stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset=".6" stop-color="#ffffff" stop-opacity=".45"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  <radialGradient id="c-night" gradientUnits="userSpaceOnUse" cx="${CARD.cx}" cy="${CARD.cy}" r="430"><stop offset="0" stop-color="#27378a"/><stop offset=".45" stop-color="#172052"/><stop offset="1" stop-color="#0a0e1f"/></radialGradient>
  <linearGradient id="c-body" gradientUnits="userSpaceOnUse" x1="-240" y1="0" x2="272" y2="0"><stop offset="0" stop-color="#6a3fe0"/><stop offset=".5" stop-color="${C.brand}"/><stop offset="1" stop-color="#2fd0f5"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${hero}
${how}
${practice}
${foot}
</svg>
`
}

// ---------- print ----------
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright')
  const found = fs.existsSync(cache) ? fs.readdirSync(cache, { recursive: true }).map(String).find(entry => /chrome-headless-shell$/.test(entry)) : undefined
  return found ? path.join(cache, found) : undefined
}

async function print(svg, pdfFile, pngFile) {
  const binary = findChrome()
  if (!binary) { console.log('no Chromium found: only the SVG was written (set CHROME to print the PDF)'); return }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dshrsi-poster-'))
  const page = path.join(work, 'poster.html')
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>@page{size:${W}mm ${H}mm;margin:0}html,body{margin:0;background:#fff}svg{display:block}body.look svg{width:${W}px;height:${H}px}</style>${svg}`)
  const chrome = spawn(binary, ['--remote-debugging-port=0', `--user-data-dir=${path.join(work, 'profile')}`, '--hide-scrollbars', '--no-first-run', 'about:blank'])
  try {
    const endpoint = await new Promise((resolve, reject) => {
      chrome.stderr.on('data', (chunk) => { const match = /DevTools listening on (ws:\/\/\S+)/.exec(String(chunk)); if (match) resolve(match[1]) })
      chrome.on('exit', () => reject(new Error('Chromium exited before it was ready')))
    })
    const socket = new WebSocket(endpoint)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    let nextId = 0
    const waiting = new Map()
    socket.onmessage = (message) => {
      const data = JSON.parse(message.data)
      if (!data.id || !waiting.has(data.id)) return
      const { resolve, reject } = waiting.get(data.id)
      waiting.delete(data.id)
      if (data.error) reject(new Error(data.error.message)); else resolve(data.result)
    }
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = (nextId += 1); waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })) })
    const { targetInfos } = await send('Target.getTargets')
    const { sessionId } = await send('Target.attachToTarget', { targetId: targetInfos.find(target => target.type === 'page').targetId, flatten: true })
    const call = (method, params) => send(method, params, sessionId)
    await call('Page.enable')
    await call('Page.navigate', { url: pathToFileURL(page).href })
    await new Promise(resolve => setTimeout(resolve, 1200))
    const inch = 25.4
    const pdf = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, paperWidth: W / inch, paperHeight: H / inch, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 })
    fs.writeFileSync(pdfFile, Buffer.from(pdf.data, 'base64'))
    // the same drawing at one pixel a millimetre, to look at
    await call('Runtime.evaluate', { expression: 'document.body.className = "look"' })
    await call('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1.5, mobile: false })
    await new Promise(resolve => setTimeout(resolve, 400))
    const shot = await call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(pngFile, Buffer.from(shot.data, 'base64'))
    socket.close()
  } finally {
    chrome.kill('SIGKILL')
    fs.rmSync(work, { recursive: true, force: true })
  }
}

fs.mkdirSync(OUT, { recursive: true })
const svg = draw()
const base = path.join(OUT, 'dshrsi-x-banner')
fs.writeFileSync(`${base}.svg`, svg)
console.log(`assets/poster/dshrsi-x-banner.svg  ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`)
await print(svg, `${base}.pdf`, `${base}.png`)
for (const extension of ['pdf', 'png']) if (fs.existsSync(`${base}.${extension}`)) console.log(`assets/poster/dshrsi-x-banner.${extension}  ${(fs.statSync(`${base}.${extension}`).size / 1024).toFixed(1)} KB`)
