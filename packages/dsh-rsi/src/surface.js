// What the harness shows of its own adaptations.
//
//   projection   a per-session read model folded from the session log; the web
//                UI reads it (client.js) and never folds events itself
//   statusText   the answer to the /rsi command
//
// The read model is derived from what the plugin already writes into the log:
// its notices (user messages with source kind "dsh-rsi"), the tool results it
// refused, and the adaptation sections of the system prompt. Nothing extra is
// logged for the sake of the display.
import { layerOfRecord } from './layers.js'

export const PROJECTION_KEY = 'dshRsi'

const MARKED = /\[harness adaptation: ([^\]]{1,90})\] ?/
const MARKED_ALL = new RegExp(MARKED.source, 'g')
const EVOLVED = 'The harness adapted itself'
const MAX_ADAPTATIONS = 40
const TEXT_CAP = 320

const EMPTY = Object.freeze({ v: 1, adaptations: [], counts: { evolved: 0, refused: 0, notes: 0 }, last: null })

const blockText = content => (Array.isArray(content) ? content.map(block => (block?.type === 'text' ? block.text : '')).join('\n') : '')
const clip = text => (text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP - 1)}…` : text)

/** Adaptation sections of a system prompt: `[harness adaptation: Title] text`, each up to the next blank line. */
export function standingIn(prompt) {
  const found = []
  for (const match of String(prompt ?? '').matchAll(MARKED_ALL)) {
    const rest = prompt.slice(match.index + match[0].length)
    const end = rest.search(/\n\s*\n/)
    found.push({ title: match[1], text: clip((end === -1 ? rest : rest.slice(0, end)).trim()) })
  }
  return found
}

function checkState(value) {
  if (value === null || typeof value !== 'object' || value.v !== 1 || !Array.isArray(value.adaptations) || typeof value.counts !== 'object') {
    throw new Error('dsh-rsi: not a harness adaptation read model')
  }
  return value
}

/** One more thing an adaptation did, recorded on its entry. */
function act(state, event, type, title, text) {
  const known = state.adaptations.find(entry => entry.title === title)
  const entry = known ?? { title, text: '', standing: false, evolved: false, refused: 0, notes: 0, seq: event.seq }
  const next = { ...entry }
  if (type === 'evolved') {
    next.evolved = true
    next.text = clip(text)
  } else {
    if (type === 'refused') next.refused += 1
    else next.notes += 1
    if (next.text === '') next.text = clip(text)
  }
  const adaptations = known ? state.adaptations.map(item => (item === known ? next : item)) : [...state.adaptations, next].slice(-MAX_ADAPTATIONS)
  const key = type === 'evolved' ? 'evolved' : type === 'refused' ? 'refused' : 'notes'
  return { ...state, adaptations, counts: { ...state.counts, [key]: state.counts[key] + 1 }, last: { seq: event.seq, type, title } }
}

/** The session-projection unit. State and view are the same plain value, so an unchanged state publishes nothing. */
export const projection = {
  key: PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: { parse: checkState },
  init: () => EMPTY,
  apply(state, event) {
    switch (event.type) {
      case 'system/message': {
        const standing = standingIn(blockText(event.data?.message?.content))
        const titles = new Set(standing.map(item => item.title))
        const unchanged = state.adaptations.every(entry => entry.standing === titles.has(entry.title))
          && standing.every(item => state.adaptations.some(entry => entry.title === item.title))
        if (unchanged) return state
        const kept = state.adaptations.map(entry => (entry.standing === titles.has(entry.title) ? entry : { ...entry, standing: titles.has(entry.title) }))
        const added = standing.filter(item => !kept.some(entry => entry.title === item.title))
          .map(item => ({ title: item.title, text: item.text, standing: true, evolved: false, refused: 0, notes: 0, seq: event.seq }))
        return { ...state, adaptations: [...kept, ...added].slice(-MAX_ADAPTATIONS) }
      }
      case 'user/message': {
        const source = event.data?.source
        if (source?.kind !== 'dsh-rsi' || source.form !== 'notice') return state
        const body = blockText(event.data.content)
        const match = MARKED.exec(body)
        if (!match || match.index !== 0) return state
        const rest = body.slice(match[0].length)
        if (!rest.startsWith(EVOLVED)) return act(state, event, 'note', match[1], rest)
        // "The harness adapted itself after noticing that <what>. <what it does now>"
        const told = rest.indexOf('. ')
        return act(state, event, 'evolved', match[1], told === -1 ? rest : rest.slice(told + 2))
      }
      case 'tool/result': {
        const code = event.data?.error?.code
        if (code !== 'ADAPTATION_DENIED' && code !== 'ADAPTATION_BLOCKED') return state
        const body = blockText(event.data.message?.content)
        const match = MARKED.exec(body)
        if (!match) return state
        return act(state, event, 'refused', match[1], body.slice(match.index + match[0].length))
      }
      default:
        return state
    }
  },
  wire: { viewSchema: { parse: checkState }, view: state => state },
}

/**
 * Plain-text account of the harness's adaptations, for the /rsi command.
 * @param {{ session?: object, library: ReturnType<import('./library.js').openLibrary> }} input `session` is the engine's handle for the asking session.
 */
export function statusText({ session, library }) {
  const lines = []
  const records = library.list()
  const mounted = session?.mounted() ?? []
  if (mounted.length === 0) lines.push('No adaptations are mounted in this session.')
  else {
    lines.push(`${mounted.length} adaptation(s) at work in this session:`)
    for (const mount of mounted) {
      const record = records.find(entry => entry.id === mount.id)
      const acted = mount.fires > 0 ? `, acted ${mount.fires}x here` : ''
      lines.push(`  ${mount.title}`)
      lines.push(`      ${mount.id} · ${record ? layerOfRecord(record) : 'unknown'} layer · ${mount.meta.capabilities.join(', ')}${record?.project ? ' · from the project harness' : ''}${acted}`)
    }
  }
  if (session?.project) {
    const waiting = session.project.waiting.length
    lines.push('', `Project harness: ${session.project.root}${waiting > 0 ? ` (${waiting} file(s) not accepted on this machine; run "dsh-rsi trust")` : ''}`)
  }
  const count = status => records.filter(entry => entry.status === status).length
  const proposed = records.filter(entry => entry.status === 'proposed')
  lines.push('', `Library: ${count('active')} active, ${count('candidate')} on trial, ${proposed.length} waiting for approval, ${count('quarantined')} quarantined, ${count('disabled') + count('retired')} switched off.`)
  for (const entry of proposed.slice(0, 5)) lines.push(`  waiting: dsh-rsi approve ${entry.id}   # ${entry.title} [${(entry.capabilities ?? []).join(', ')}]`)
  if (session && session.mode !== 'adapt') lines.push(`Mode in this session: ${session.mode}.`)
  lines.push('', 'Details and controls: dsh-rsi status | show <id> | disable <id> | project')
  return lines.join('\n')
}
