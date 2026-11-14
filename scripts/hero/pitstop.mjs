#!/usr/bin/env node
// Draws the pit-stop picture: what DSHRSI does, told as what a racing driver does when the car feels wrong in the
// middle of a race. The driver does not wait for the next race: into the pits, a new part, five lights, back out.
//
//   node scripts/hero/pitstop.mjs
//
// Writes assets/pit-stop[.zh][.dark].svg and copies them into website/assets/img. The pictures move (the car laps
// the circuit and stops in the box; the lights come on one by one) with nothing but SVG's own animation, so they also
// move inside a README. Where animation is off, the same picture stands still and reads the same.
//
// The numbers on it are the ones of the real run in bench/results/trace.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shell } from '../logo.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/results/trace.json'), 'utf8'))
const nth = T.adaptation.earlier.length + 1
const seconds = T.adaptation.secondsToMount
const stages = T.session.events.find(event => event.kind === 'gate').stages.map(stage => stage.stage)
const after = { stock: T.arms.dsh.afterWidening, plugin: T.arms.rsi.afterWidening }
const ORDINAL = { en: ['', 'first', 'second', 'third', 'fourth', 'fifth'], zh: ['', '1', '2', '3', '4', '5'] }

const THEMES = {
  light: {
    canvas: '#eef1f7', infield: '#e2e8f5', card: '#ffffff', ink: '#0f1115', dim: '#4f5560', faint: '#858a92', line: '#d6dbe6',
    accent: '#4176e6', soft: '#e6eefe', cyan: '#19b6e6', violet: '#6a3fe0', bad: '#e5383b', good: '#16a34a',
    road: '#2a3040', edge: '#ffffff', lane: '#3a4257', mark: '#8d95a8', housing: '#12151c', off: '#3a404d', tyre: '#0d1016', glow: '#22c55e',
  },
  dark: {
    canvas: '#0a0b0d', infield: '#101319', card: '#17181b', ink: '#f9fafb', dim: '#b9bfc8', faint: '#8d939c', line: '#2b2d33',
    accent: '#6590ff', soft: '#172244', cyan: '#3be3f7', violet: '#9a7bff', bad: '#f25a5a', good: '#4ed17e',
    road: '#262a34', edge: '#6a7180', lane: '#313644', mark: '#7a8192', housing: '#050608', off: '#2e333d', tyre: '#06070a', glow: '#4ed17e',
  },
}

const TEXT = {
  en: {
    title: 'A pit stop in the middle of the race',
    sub: 'A driver who feels the car is wrong does not wait for the next race. Neither does the harness.',
    steps: [
      ['On track', ['mid-session']],
      ['The car feels wrong', [`the same failed call, for the ${ORDINAL.en[nth] ?? `${nth}th`} time`]],
      ['Into the box: a new part', ['the model writes harness code']],
      ['Five lights', ['five checks,', 'all must pass']],
      ['Back out. Same race.', ['fitted before the task is over']],
      ['The next laps tell', [`the same ${after.plugin.total} sessions: ${after.stock.hit} without it, ${after.plugin.hit} with it`]],
      ['The next race starts with this car', ['and the improved car improves again']],
    ],
    legend: [['the car', 'the harness'], ['the driver', 'the model'], ['the part', 'harness code']],
    stop: 'measured', unit: 's',
  },
  zh: {
    title: '跑到一半，进站换件',
    sub: '赛车手觉得车不对劲，不会等到下一场比赛。Harness 也不会。',
    steps: [
      ['在赛道上', ['会话进行到一半']],
      ['车感觉不对', [`同一个失败，第 ${nth} 次了`]],
      ['进站：换上新零件', ['模型给 Harness 写代码']],
      ['五盏灯', ['五道校验，', '全过才装上']],
      ['出站，还是这场比赛', ['这一轮还没结束就装上了']],
      ['后面几圈见分晓', [`同样的 ${after.plugin.total} 个会话：不装 ${after.stock.hit} 次，装上 ${after.plugin.hit} 次`]],
      ['下一场比赛，从这辆车开始', ['改进过的车，还会再改进']],
    ],
    legend: [['赛车', 'Harness'], ['车手', '模型'], ['零件', '一段 Harness 代码']],
    stop: '实测', unit: '秒',
  },
}

const esc = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]))
const f = value => Number(value.toFixed(2))

// ---------- the circuit ----------
const TOP = 268, BOTTOM = 652, LEFT = 272, RIGHT = 1008, R = (BOTTOM - TOP) / 2, MID = (TOP + BOTTOM) / 2
const ROAD = 44, PIT = 344, PIT_IN = 548, PIT_OUT = 1000, BOX = 734
const track = `M${LEFT} ${TOP}H${RIGHT}A${R} ${R} 0 0 1 ${RIGHT} ${BOTTOM}H${LEFT}A${R} ${R} 0 0 1 ${LEFT} ${TOP}Z`
const infield = `M${LEFT} ${TOP + ROAD / 2}H${RIGHT}A${R - ROAD / 2} ${R - ROAD / 2} 0 0 1 ${RIGHT} ${BOTTOM - ROAD / 2}H${LEFT}A${R - ROAD / 2} ${R - ROAD / 2} 0 0 1 ${LEFT} ${TOP + ROAD / 2}Z`
const pitIn = `M${PIT_IN} ${TOP}C${PIT_IN + 46} ${TOP} ${PIT_IN + 58} ${PIT} ${PIT_IN + 104} ${PIT}`
const pitOut = `C${PIT_OUT - 58} ${PIT} ${PIT_OUT - 46} ${TOP} ${PIT_OUT} ${TOP}`
const pitLane = `${pitIn}H${PIT_OUT - 104}${pitOut}`
// the way the car goes: along the top, through the pits, round the rest of the lap
const route = `M${LEFT} ${TOP}H${PIT_IN}${pitIn.slice(pitIn.indexOf('C'))}H${PIT_OUT - 104}${pitOut}H${RIGHT}A${R} ${R} 0 0 1 ${RIGHT} ${BOTTOM}H${LEFT}A${R} ${R} 0 0 1 ${LEFT} ${TOP}`
const cubicLength = (p0, p1, p2, p3) => {
  let length = 0, last = p0
  for (let i = 1; i <= 200; i += 1) {
    const t = i / 200, u = 1 - t
    const point = [0, 1].map(k => u ** 3 * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t ** 3 * p3[k])
    length += Math.hypot(point[0] - last[0], point[1] - last[1])
    last = point
  }
  return length
}
const bend = cubicLength([PIT_IN, TOP], [PIT_IN + 46, TOP], [PIT_IN + 58, PIT], [PIT_IN + 104, PIT])
const legs = [PIT_IN - LEFT, bend, BOX - (PIT_IN + 104), PIT_OUT - 104 - BOX, bend, RIGHT - PIT_OUT, Math.PI * R, RIGHT - LEFT, Math.PI * R]
const total = legs.reduce((sum, leg) => sum + leg, 0)
const upTo = count => legs.slice(0, count).reduce((sum, leg) => sum + leg, 0) / total
// one lap of the picture, in seconds: to the pit entry, into the box, the stop, out again, the rest of the lap
const LAP = 15, ARRIVE = 2.5, LEAVE = 7.7, REJOIN = 8.8
const keyPoints = [0, upTo(1), upTo(3), upTo(3), upTo(5), 1].map(f).join(';')
const keyTimes = [0, 1.35 / LAP, ARRIVE / LAP, LEAVE / LAP, REJOIN / LAP, 1].map(value => Number(value.toFixed(4))).join(';')
const share = second => Number((second / LAP).toFixed(4))
// the lights come on one by one during the stop; the part is on the car when the last one is
const lit = index => 4.2 + index * 0.62
const FITTED = lit(4) + 0.3

// part: 'old' (the wing it started with), 'new' (the one fitted in the box) or 'fitted' (changes during the stop)
function car(c, opacity = 1, part = 'old') {
  // seen from above, nose to the right, 54 long
  const fitted = [0, share(FITTED), share(FITTED + 0.25), 1].join(';')
  const wing = part === 'fitted'
    ? `<rect x="-29.5" y="-14" width="11" height="28" rx="4" fill="${c.glow}" opacity=".3"><animate attributeName="opacity" dur="${LAP}s" repeatCount="indefinite" keyTimes="${fitted}" values="0;0;.3;.3"/></rect>
    <rect x="-27" y="-11.5" width="6" height="23" rx="1.6" fill="${c.glow}"><animate attributeName="fill" dur="${LAP}s" repeatCount="indefinite" keyTimes="${fitted}" values="${c.violet};${c.violet};${c.glow};${c.glow}"/></rect>`
    : `${part === 'new' ? `<rect x="-29.5" y="-14" width="11" height="28" rx="4" fill="${c.glow}" opacity=".3"/>` : ''}<rect x="-27" y="-11.5" width="6" height="23" rx="1.6" fill="${part === 'new' ? c.glow : c.violet}"/>`
  return `<g opacity="${opacity}" transform="scale(1.18)">
    ${wing}
    <rect x="21" y="-12" width="5" height="24" rx="1.6" fill="${c.violet}"/>
    <rect x="-21" y="-14" width="12" height="6.4" rx="2.2" fill="${c.tyre}" stroke="${c.mark}" stroke-width=".7"/>
    <rect x="-21" y="7.6" width="12" height="6.4" rx="2.2" fill="${c.tyre}" stroke="${c.mark}" stroke-width=".7"/>
    <rect x="8.5" y="-13.2" width="10.5" height="5.6" rx="2" fill="${c.tyre}" stroke="${c.mark}" stroke-width=".7"/>
    <rect x="8.5" y="7.6" width="10.5" height="5.6" rx="2" fill="${c.tyre}" stroke="${c.mark}" stroke-width=".7"/>
    <path d="M-15 -8.6h4M-15 8.6h4M11 -8h3M11 8h3" stroke="${c.mark}" stroke-width="1.6"/>
    <path d="M-22 -4.6C-17 -8.4 -6 -8.8 0 -7.2C8 -5.4 14 -3 22 -2.4Q25 -1.8 25 0Q25 1.8 22 2.4C14 3 8 5.4 0 7.2C-6 8.8 -17 8.4 -22 4.6Z" fill="url(#body)"/>
    <path d="M-20 0H22" stroke="#ffffff" stroke-opacity=".5" stroke-width="1.1" stroke-linecap="round"/>
    <ellipse cx="-3.5" cy="0" rx="5.6" ry="3.5" fill="${c.tyre}"/>
    <circle cx="-3.2" cy="0" r="2.5" fill="${c.cyan}"/>
  </g>`
}

/**
 * The picture as SVG text. `still` leaves the animation out and shows the moment the part is fitted: the car in the
 * box, five lights on, the stopwatch stopped. That is the version for print.
 */
export function draw(language, theme, { still = false } = {}) {
  const c = THEMES[theme], s = TEXT[language]
  const font = language === 'zh' ? "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Segoe UI', sans-serif" : "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
  const text = (x, y, value, { size = 16, weight = 400, fill = c.ink, anchor = 'start', spacing } = {}) =>
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}${spacing ? ` letter-spacing="${spacing}"` : ''}>${esc(value)}</text>`
  const step = (number, x, y) => {
    const [title, lines] = s.steps[number - 1]
    return `<g><circle cx="${x}" cy="${y - 6}" r="13" fill="${c.accent}"/><text x="${x}" y="${y - 0.8}" font-size="15" font-weight="700" fill="#ffffff" text-anchor="middle">${number}</text>${text(x + 22, y, title, { size: 20, weight: 700 })}${lines.map((line, index) => text(x + 22, y + 25 + index * 22, line, { size: 17, fill: c.dim })).join('')}</g>`
  }
  const mark = shell({ perTurn: 7, turns: 1.25, gap: 0.17, wall: 0.16, shade: 0, bolt: 0.24, soft: 0.03, margin: 1.2, id: 'mk' }).replace(/^<svg[^>]*>|<\/svg>$/g, '')
  const emblem = shell({ id: 'em' }).replace(/^<svg[^>]*>|<\/svg>$/g, '')
  const lights = stages.map((_, index) => {
    const x = 902 + index * 23
    // dark until its check has passed, then on until the car is back on track
    const times = [0, share(lit(index)), share(lit(index) + 0.12), share(REJOIN + 0.6), share(REJOIN + 1.1), 1].join(';')
    return `<circle cx="${x}" cy="398" r="12.5" fill="${c.glow}" opacity=".22"><animate attributeName="opacity" dur="${LAP}s" repeatCount="indefinite" keyTimes="${times}" values="0;0;.28;.28;0;0"/></circle>
    <circle cx="${x}" cy="398" r="8" fill="${c.glow}"><animate attributeName="fill" dur="${LAP}s" repeatCount="indefinite" keyTimes="${times}" values="${c.off};${c.off};${c.glow};${c.glow};${c.off};${c.off}"/></circle>`
  }).join('')
  const checker = Array.from({ length: 22 }, (_, i) => `<rect x="${252 + (i % 2) * 4}" y="${TOP - ROAD / 2 + Math.floor(i / 2) * 4}" width="4" height="4" fill="${(i % 2 + Math.floor(i / 2)) % 2 ? '#ffffff' : '#0d1016'}"/>`).join('')
  const bays = [0, 1, 2, 3].map(index => {
    const x = 614 + index * 60, live = index === 2
    return `<rect x="${x + 4}" y="372" width="52" height="46" rx="7" fill="${live ? c.soft : 'none'}" stroke="${live ? c.accent : c.line}" stroke-width="${live ? 1.6 : 1}"/>${live ? '' : `<rect x="${x + 16}" y="388" width="28" height="5" rx="2.5" fill="${c.line}"/><rect x="${x + 16}" y="398" width="18" height="5" rx="2.5" fill="${c.line}"/>`}`
  }).join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720" font-family="${font}" role="img">
<title>${esc(`${s.title}. ${s.steps.map(([title, lines], index) => `${index + 1}. ${title}: ${lines.join(' ')}`).join(' ')}`)}</title>
<defs>
  <linearGradient id="body" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c.violet}"/><stop offset=".55" stop-color="${c.accent}"/><stop offset="1" stop-color="${c.cyan}"/></linearGradient>
</defs>
<rect width="1280" height="720" rx="24" fill="${c.canvas}"/>

<g transform="translate(44 30) scale(${f(32 / 36)})">${mark}</g>
${text(86, 53, 'DSHRSI', { size: 19, weight: 700, spacing: '.03em' })}
${text(44, 106, s.title, { size: 36, weight: 700, spacing: '-.01em' })}
${text(44, 138, s.sub, { size: 18, fill: c.dim })}

<path d="${infield}" fill="${c.infield}"/>
<path d="${pitLane}" fill="none" stroke="${c.edge}" stroke-width="37" stroke-linecap="round"/>
<path d="${pitLane}" fill="none" stroke="${c.lane}" stroke-width="33" stroke-linecap="round"/>
<path d="M${PIT_IN + 110} ${PIT}H${PIT_OUT - 110}" stroke="${c.mark}" stroke-opacity=".55" stroke-width="1.4" stroke-dasharray="3 9"/>
<path d="${track}" fill="none" stroke="${c.edge}" stroke-width="${ROAD + 5}"/>
<path d="${track}" fill="none" stroke="${c.road}" stroke-width="${ROAD}"/>
<path d="${track}" fill="none" stroke="${c.mark}" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="12 16"/>
<path d="M${RIGHT} ${TOP + ROAD / 2 + 3.5}A${R - ROAD / 2 - 3.5} ${R - ROAD / 2 - 3.5} 0 0 1 ${RIGHT} ${BOTTOM - ROAD / 2 - 3.5}M${LEFT} ${BOTTOM - ROAD / 2 - 3.5}A${R - ROAD / 2 - 3.5} ${R - ROAD / 2 - 3.5} 0 0 1 ${LEFT} ${TOP + ROAD / 2 + 3.5}" fill="none" stroke="#ffffff" stroke-width="7"/>
<path d="M${RIGHT} ${TOP + ROAD / 2 + 3.5}A${R - ROAD / 2 - 3.5} ${R - ROAD / 2 - 3.5} 0 0 1 ${RIGHT} ${BOTTOM - ROAD / 2 - 3.5}M${LEFT} ${BOTTOM - ROAD / 2 - 3.5}A${R - ROAD / 2 - 3.5} ${R - ROAD / 2 - 3.5} 0 0 1 ${LEFT} ${TOP + ROAD / 2 + 3.5}" fill="none" stroke="${c.accent}" stroke-width="7" stroke-dasharray="13 13"/>
${checker}
<path d="M690 ${TOP - 7}l7 7l-7 7M704 ${TOP - 7}l7 7l-7 7M${RIGHT + R - 7} ${MID - 7}l7 7l7 -7M${RIGHT + R - 7} ${MID + 7}l7 7l7 -7M470 ${BOTTOM - 7}l-7 7l7 7M456 ${BOTTOM - 7}l-7 7l7 7M${LEFT - R - 7} ${MID + 7}l7 -7l7 7M${LEFT - R - 7} ${MID - 7}l7 -7l7 7" fill="none" stroke="${c.mark}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>

<!-- where the car twitches: the same place, lap after lap -->
<path d="M444 ${TOP - 8}q7 -7 14 0t14 0t14 0t14 0M444 ${TOP + 8}q7 -7 14 0t14 0t14 0t14 0" fill="none" stroke="${c.bad}" stroke-width="2.2" stroke-linecap="round"/>
<circle cx="472" cy="${TOP}" r="10" fill="none" stroke="${c.bad}" stroke-width="2.4" opacity="0"><animate attributeName="r" dur="${LAP}s" repeatCount="indefinite" keyTimes="0;${share(0.85)};${share(1.9)};1" values="6;6;34;34"/><animate attributeName="opacity" dur="${LAP}s" repeatCount="indefinite" keyTimes="0;${share(0.85)};${share(0.95)};${share(1.9)};1" values="0;0;.9;0;0"/></circle>
<g transform="translate(472 ${TOP - ROAD / 2 - 15}) scale(.82)"><path d="M0 -13L13 10H-13Z" fill="${c.bad}" stroke="${c.bad}" stroke-width="5" stroke-linejoin="round"/><path d="M0 -6V3" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/><circle cx="0" cy="8" r="1.8" fill="#ffffff"/></g>

<!-- the garage: parts kept from earlier stops, and the box where this one is made -->
<rect x="610" y="366" width="248" height="58" rx="12" fill="${c.card}" stroke="${c.line}" stroke-width="1.2"/>
${bays}
<g transform="translate(764 395)"><path d="M-9 -9q-6 0 -6 5v2q0 3 -4 3q4 0 4 3v2q0 5 6 5M9 -9q6 0 6 5v2q0 3 4 3q-4 0 -4 3v2q0 5 -6 5" fill="none" stroke="${c.accent}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="0" cy="1" r="2.4" fill="${c.accent}"><animate attributeName="opacity" dur="1.2s" repeatCount="indefinite" values="1;.25;1"/></circle></g>
<rect x="${BOX - 37}" y="${PIT - 13}" width="74" height="26" rx="5" fill="none" stroke="${c.mark}" stroke-opacity=".6" stroke-width="1.4" stroke-dasharray="5 5"/>
<g fill="${c.violet}"><circle cx="${BOX - 24}" cy="${PIT - 26}" r="4.8"/><circle cx="${BOX + 18}" cy="${PIT - 26}" r="4.8"/><circle cx="${BOX - 24}" cy="${PIT + 26}" r="4.8"/><circle cx="${BOX + 18}" cy="${PIT + 26}" r="4.8"/><animate attributeName="opacity" dur="${LAP}s" repeatCount="indefinite" keyTimes="0;${share(ARRIVE - 0.5)};${share(ARRIVE)};${share(LEAVE)};${share(LEAVE + 0.5)};1" values="0;0;1;1;0;0"/></g>
<circle cx="${BOX - 31}" cy="${PIT}" r="8" fill="none" stroke="${c.glow}" stroke-width="2.4" opacity="0"><animate attributeName="r" dur="${LAP}s" repeatCount="indefinite" keyTimes="0;${share(FITTED)};${share(FITTED + 0.9)};1" values="8;8;40;40"/><animate attributeName="opacity" dur="${LAP}s" repeatCount="indefinite" keyTimes="0;${share(FITTED)};${share(FITTED + 0.1)};${share(FITTED + 0.9)};1" values="0;0;.9;0;0"/></circle>

<!-- five lights: one for each check of the gate -->
<rect x="880" y="376" width="136" height="44" rx="14" fill="${c.housing}" stroke="${c.line}" stroke-width="1"/>
${lights}

<!-- the stop, timed -->
<g transform="translate(1104 ${MID - 34})"><circle r="30" fill="${c.card}" stroke="${c.ink}" stroke-width="3.2"/><path d="M-6 -39h12M0 -39v9M22 -26l5 -5" stroke="${c.ink}" stroke-width="3.2" stroke-linecap="round"/><path d="M0 0V-19" stroke="${c.accent}" stroke-width="3.2" stroke-linecap="round"${still ? ' transform="rotate(220)"' : ''}><animateTransform attributeName="transform" type="rotate" dur="${LAP}s" repeatCount="indefinite" keyTimes="0;${share(ARRIVE)};${share(LEAVE)};1" values="0;0;220;220"/></path><circle r="3.2" fill="${c.accent}"/></g>
<text x="1104" y="${MID + 38}" text-anchor="middle" font-size="34" font-weight="800" fill="${c.ink}" letter-spacing="-.02em">${seconds}<tspan font-size="18" font-weight="600" fill="${c.faint}" dx="5">${s.unit}</tspan></text>
${text(1104, MID + 62, s.stop, { size: 16, fill: c.faint, anchor: 'middle' })}

<!-- every lap builds on the last -->
<g transform="translate(${LEFT - 148} ${MID - 62}) scale(${f(124 / 36)})">${emblem}</g>

<!-- who is who -->
<rect x="296" y="312" width="286" height="118" rx="14" fill="${c.card}" stroke="${c.line}" stroke-width="1.2"/>
<g transform="translate(332 342) scale(.62)">${car(c)}</g><circle cx="332" cy="372" r="5.5" fill="${c.cyan}" stroke="${c.tyre}" stroke-width="2.4"/>
<g transform="translate(332 402) scale(.62)"><path d="M-9 -9q-6 0 -6 5v2q0 3 -4 3q4 0 4 3v2q0 5 6 5M9 -9q6 0 6 5v2q0 3 4 3q-4 0 -4 3v2q0 5 -6 5" fill="none" stroke="${c.accent}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></g>
${s.legend.map(([what, means], index) => `<text x="360" y="${347 + index * 30}" font-size="17" fill="${c.dim}"><tspan font-weight="700" fill="${c.ink}">${esc(what)}</tspan><tspan dx="7" fill="${c.faint}">=</tspan><tspan dx="7">${esc(means)}</tspan></text>`).join('')}

<!-- the car that was here before, and the one that is moving -->
<g transform="translate(332 ${TOP})">${car(c, 0.3)}</g>
<g transform="translate(640 ${BOTTOM}) rotate(180)">${car(c, 0.42, 'new')}</g>
<g transform="translate(${BOX} ${PIT})"><g>${car(c, 1, 'fitted')}</g><animateTransform attributeName="transform" type="translate" dur="${LAP}s" repeatCount="indefinite" values="0 0;0 0"/><animateMotion dur="${LAP}s" repeatCount="indefinite" rotate="auto" calcMode="linear" path="${route}" keyPoints="${keyPoints}" keyTimes="${keyTimes}"/></g>

${step(1, 262, 186)}
${step(2, 440, 186)}
${step(5, 838, 186)}
${step(3, 596, 464)}
${step(4, 880, 464)}
${step(7, 296, 560)}
${step(6, 694, 560)}
</svg>
`
  return still ? svg.replace(/<animate(?:Transform|Motion)?\b[^>]*\/>/g, '') : svg
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const named = (language, theme) => `pit-stop${language === 'en' ? '' : `.${language}`}${theme === 'light' ? '' : `.${theme}`}.svg`
  for (const language of ['en', 'zh']) {
    for (const theme of ['light', 'dark']) {
      const svg = draw(language, theme)
      fs.writeFileSync(path.join(ROOT, 'assets', named(language, theme)), svg)
      fs.writeFileSync(path.join(ROOT, 'website/assets/img', named(language, theme)), svg)
      console.log(`assets/${named(language, theme)}  ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`)
    }
  }
}
