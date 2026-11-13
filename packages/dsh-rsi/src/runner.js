// Runs an adaptation's handlers against one situation and collects effects.
// Validation replays recorded observations through these functions; the live
// mount calls the same functions with live data, so a handler behaves the
// same in rehearsal and in production.
import { isCheckable } from './normalize.js'
import { AdaptationError } from './sandbox.js'

const SEAM_EFFECTS = {
  onToolResult: ['annotate', 'block', 'replace'],
  beforeTool: ['deny', 'ask'],
  beforeStop: ['continue'],
  beforeStep: ['note'],
}

/** Handler-facing description of a tool call. */
export function callView(source) {
  return {
    tool: source.tool, args: source.args ?? {}, command: source.command, commandHead: source.commandHead,
    commandFamily: source.commandFamily, path: source.path,
  }
}

/** Handler-facing description of a tool outcome. */
export function resultView(source) {
  const text = String(source.text ?? '')
  // `text` may be a truncated copy; `bytes` is the size of the full result.
  return { ok: source.ok === true, isError: source.isError === true, exitCode: source.exitCode, text, bytes: source.bytes ?? text.length }
}

/** Handler-facing entry of a turn or step summary. */
export function callSummary(observation) {
  return {
    tool: observation.tool, command: observation.command, path: observation.path, ok: observation.ok === true,
    exitCode: observation.exitCode, mutating: observation.mutating === true, verifying: observation.verifying === true,
    text: String(observation.text ?? '').slice(0, 800),
  }
}

/** Summary of one turn's tool activity for `beforeStop` handlers. */
export function turnView(observations) {
  const calls = observations.filter(observation => observation.kind === 'tool')
  let verifiedAfterEdits = true
  const edits = []
  for (const call of calls) {
    if (call.mutating && call.ok && isCheckable(call.path)) { verifiedAfterEdits = false; if (!edits.includes(call.path)) edits.push(call.path) }
    else if (call.verifying) verifiedAfterEdits = true
  }
  return { calls: calls.slice(-40).map(callSummary), edits, verifiedAfterEdits }
}

function fieldMatches(rule, value, mode) {
  if (rule === undefined) return true
  if (value === undefined || value === null) return false
  const text = String(value)
  if (rule.regex !== undefined) return new RegExp(rule.regex, rule.flags).test(text)
  if (rule.any !== undefined) return rule.any.includes(text)
  if (mode === 'prefix') return text.trim() === rule.exact || text.trim().startsWith(`${rule.exact} `)
  if (mode === 'suffix') return text === rule.exact || text.endsWith(`/${rule.exact}`) || text.endsWith(`\\${rule.exact}`)
  return text === rule.exact
}

/** Whether a registration's filter selects this call. */
export function matches(compiled, registration, call) {
  const filter = registration.filter ?? { all: true }
  if (filter.all) return true
  if (filter.predicate !== undefined) return compiled.test(filter.predicate, [call])
  return fieldMatches(filter.tool, call.tool, 'exact')
    && fieldMatches(filter.command, call.command, 'prefix')
    && fieldMatches(filter.path, call.path, 'suffix')
}

function checkEffect(seam, value) {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'object' || typeof value.$effect !== 'string') {
    throw new AdaptationError(`${seam} handler returned a value that is not an effect; return h.<effect>(...) or undefined`, 'handler')
  }
  if (!SEAM_EFFECTS[seam].includes(value.$effect)) {
    throw new AdaptationError(`${seam} handler returned "${value.$effect}", which is not valid there (allowed: ${SEAM_EFFECTS[seam].join(', ')})`, 'handler')
  }
  if (typeof value.text !== 'string' || value.text.trim() === '') throw new AdaptationError(`${seam} effect has no text`, 'handler')
  return { type: value.$effect, text: value.text.slice(0, 4000) }
}

async function runSeam(compiled, seam, call, args) {
  const effects = []
  for (const registration of compiled.registrations) {
    if (registration.seam !== seam) continue
    if (call !== undefined && !matches(compiled, registration, call)) continue
    const effect = checkEffect(seam, await compiled.invoke(registration.handler, args))
    if (effect) effects.push(effect)
  }
  return effects
}

export function runPre(compiled, call) {
  return runSeam(compiled, 'beforeTool', call, [call])
}

export function runPost(compiled, call, result) {
  return runSeam(compiled, 'onToolResult', call, [call, result])
}

export function runStop(compiled, turn) {
  return runSeam(compiled, 'beforeStop', undefined, [turn])
}

export function runStep(compiled, state) {
  return runSeam(compiled, 'beforeStep', undefined, [state])
}

export function hasSeam(compiled, seam) {
  return compiled.registrations.some(registration => registration.seam === seam)
}
