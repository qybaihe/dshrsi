// The gate every adaptation passes before it touches a live session.
//
// 1. static     size, forbidden constructs, declared capabilities are used
// 2. load       the script compiles, calls define(), and registers something
// 3. rehearsal  replayed on the observations that triggered it, it must act
// 4. regression replayed on observations that went fine, it must stay quiet
// 5. policy     capabilities beyond the autonomy level wait for approval
import { CAPABILITIES, needingApproval } from './capabilities.js'
import { AdaptationError, compileAdaptation } from './sandbox.js'
import { callView, hasSeam, resultView, runPost, runPre, runStep, runStop, turnView, callSummary } from './runner.js'

export const DEFAULT_LIMITS = Object.freeze({
  maxSourceChars: 20000,
  maxHistory: 300,
  maxAnnotateRate: 0.1,
  maxTitleChars: 90,
})

const FORBIDDEN = [
  [/\brequire\s*\(/, 'require()'],
  [/\bimport\s*[({]|\bimport\s+[\w*{]/, 'import'],
  [/\bprocess\b/, 'process'],
  [/\bglobalThis\b/, 'globalThis'],
  [/\beval\s*\(/, 'eval()'],
  [/\bFunction\s*\(/, 'Function()'],
  [/\.constructor\b/, '.constructor'],
  [/__proto__/, '__proto__'],
  [/\b(?:fetch|XMLHttpRequest|WebSocket)\b/, 'network access'],
  [/\b(?:WebAssembly|SharedArrayBuffer|Atomics)\b/, 'low-level runtime objects'],
  [/\bwhile\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/, 'unbounded loops'],
]

const CAPABILITY_TOKEN = {
  annotate: 'annotate(', block: 'block(', rewrite: 'replace(', deny: 'deny(', ask: 'ask(',
  verify: 'beforeStop(', steer: 'beforeStep(', prompt: 'promptSection(', tool: 'addTool(', exec: 'exec(',
}

/** Checks that need no execution. */
export function staticCheck(source, limits = DEFAULT_LIMITS) {
  const problems = []
  if (typeof source !== 'string' || source.trim() === '') return ['the adaptation source is empty']
  if (source.length > limits.maxSourceChars) problems.push(`source is ${source.length} characters; the limit is ${limits.maxSourceChars}`)
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
    // String contents are text shown to the model or passed to a shell; the realm, not this check, is what confines the code.
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
    .replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, '``')
  for (const [pattern, label] of FORBIDDEN) if (pattern.test(code)) problems.push(`${label} is not available to adaptations; use only the \`h\` object`)
  return problems
}

const REHEARSAL_EXEC = async () => ({ ok: false, exitCode: 1, text: '(rehearsal: command not run)' })

/**
 * Stages 1 and 2 alone: what can be said about a script with no evidence to replay.
 * This is all that can be checked for an adaptation that arrives from outside (a project harness, an imported pack).
 * @returns {{ ok: boolean, problems: string[], failedAt?: string, stages: object[], tier?: string, meta?: object, registrations?: object[], compiled?: object }}
 */
export function inspectAdaptation(source, { env, limits } = {}) {
  const merged = { ...DEFAULT_LIMITS, ...limits }
  const stages = []
  const staticProblems = staticCheck(source, merged)
  stages.push({ stage: 'static', problems: staticProblems.length })
  if (staticProblems.length > 0) return { ok: false, problems: staticProblems, failedAt: 'static', stages }

  let compiled
  try {
    // Rehearsal never runs real commands: h.exec answers as an inconclusive check.
    compiled = compileAdaptation(source, { env, exec: REHEARSAL_EXEC, asyncTimeoutMs: 2000 })
  } catch (error) {
    if (!(error instanceof AdaptationError)) throw error
    stages.push({ stage: 'load', problems: 1 })
    return { ok: false, problems: [error.message], failedAt: 'load', stages }
  }
  const { meta, registrations } = compiled
  const loadProblems = []
  if (meta.title.trim() === '') loadProblems.push('define() needs a title')
  if (meta.title.length > merged.maxTitleChars) loadProblems.push(`title is longer than ${merged.maxTitleChars} characters`)
  if (meta.description.trim() === '') loadProblems.push('define() needs a description')
  if (registrations.length === 0) loadProblems.push('setup() registered nothing; register at least one handler')
  for (const name of meta.capabilities) {
    if (!source.includes(CAPABILITY_TOKEN[name])) loadProblems.push(`capability "${name}" is declared but never used; remove it`)
  }
  stages.push({ stage: 'load', problems: loadProblems.length, registrations: registrations.map(entry => entry.seam) })
  if (loadProblems.length > 0) return { ok: false, problems: loadProblems, failedAt: 'load', stages }
  const tier = meta.capabilities.some(name => CAPABILITIES[name].tier === 'power') ? 'power' : 'tighten'
  return { ok: true, problems: [], stages, tier, meta, registrations, compiled }
}

function trimForReport(effects) {
  return effects.map(effect => ({ type: effect.type, text: effect.text.slice(0, 500) }))
}

/**
 * @param {object} input
 * @param {string} input.source
 * @param {object} [input.finding] the finding this adaptation answers; its evidence drives the rehearsal.
 * @param {object[]} [input.history] observations the adaptation must leave alone.
 * @param {'tighten' | 'full'} [input.autonomy]
 * @param {object} [input.env]
 * @param {object} [input.limits]
 * @returns {Promise<{ ok: boolean, problems: string[], meta?: object, registrations?: object[], report: object, needsApproval: string[] }>}
 */
export async function validateAdaptation(input) {
  const limits = { ...DEFAULT_LIMITS, ...input.limits }
  const report = { stages: [] }
  const fail = (stage, problems) => ({ ok: false, problems, report: { ...report, failedAt: stage }, needsApproval: [] })

  const inspected = inspectAdaptation(input.source, { env: input.env, limits })
  report.stages.push(...inspected.stages)
  if (!inspected.ok) return fail(inspected.failedAt, inspected.problems)
  let { compiled } = inspected
  const { meta, registrations } = inspected

  const evidence = (input.finding?.evidence ?? []).filter(observation => observation.kind === 'tool' || observation.tool !== undefined)
  const structural = hasSeam(compiled, 'addTool') || hasSeam(compiled, 'promptSection')
  const rehearsal = { observations: evidence.length, effects: [] }
  try {
    for (const observation of evidence) {
      const call = callView(observation)
      rehearsal.effects.push(...await runPre(compiled, call))
      rehearsal.effects.push(...await runPost(compiled, call, resultView(observation)))
    }
    if (hasSeam(compiled, 'beforeStop')) {
      rehearsal.effects.push(...await runStop(compiled, turnView(evidence)))
    }
    if (hasSeam(compiled, 'beforeStep')) {
      const last = evidence.at(-1)
      rehearsal.effects.push(...await runStep(compiled, { turn: last?.turn ?? 1, step: (last?.step ?? 0) + 1, recent: evidence.slice(-8).map(callSummary) }))
    }
  } catch (error) {
    if (!(error instanceof AdaptationError)) throw error
    report.stages.push({ stage: 'rehearsal', problems: 1 })
    return fail('rehearsal', [`while replaying the triggering observations: ${error.message}`])
  }
  report.stages.push({ stage: 'rehearsal', observations: rehearsal.observations, effects: trimForReport(rehearsal.effects) })
  if (input.finding && rehearsal.effects.length === 0 && !structural) {
    return fail('rehearsal', ['replayed on the observations that triggered it, the adaptation did nothing; its filters or conditions do not match the evidence'])
  }

  // The triggering observations are what the adaptation is for; everything else that went fine must stay untouched.
  const triggering = new Set(evidence.map(observation => observation.seq).filter(seq => seq !== undefined))
  const history = (input.history ?? [])
    .filter(observation => observation.kind === 'tool' && observation.ok && !triggering.has(observation.seq))
    .slice(-limits.maxHistory)
  const regression = { observations: history.length, annotated: 0, collateral: [] }
  try {
    // A fresh instance: state built up during rehearsal must not leak into this replay.
    compiled = compileAdaptation(input.source, { env: input.env, exec: REHEARSAL_EXEC, asyncTimeoutMs: 2000 })
    for (const observation of history) {
      const call = callView(observation)
      for (const effect of await runPre(compiled, call)) {
        regression.collateral.push(`${effect.type} on a call that had succeeded: ${observation.tool} ${String(observation.command ?? observation.path ?? '').slice(0, 80)}`)
      }
      for (const effect of await runPost(compiled, call, resultView(observation))) {
        if (effect.type === 'annotate') regression.annotated += 1
        else regression.collateral.push(`${effect.type} on a result that was fine: ${observation.tool} ${String(observation.command ?? observation.path ?? '').slice(0, 80)}`)
      }
    }
    // Asking whether a program exists is how the agent finds the alternative; refusing that would trap it.
    const subject = input.finding?.subject?.category === 'command-not-found' ? input.finding.subject.key : input.finding?.subject?.commandHead
    if (subject && /^[\w.@+-]+$/.test(subject)) {
      for (const command of [`command -v ${subject}`, `which ${subject}`, `type ${subject}`, `ls -la; command -v ${subject} || echo missing`]) {
        const probe = callView({ tool: 'bash', args: { command }, command, commandHead: command.split(' ')[0], commandFamily: command.split(' ').slice(0, 2).join(' ') })
        for (const effect of await runPre(compiled, probe)) {
          regression.collateral.push(`${effect.type} on \`${command}\`, which only inspects the machine; match \`${subject}\` where it is the program being run (start of a command, or after ; & | ( ), not as an argument`)
        }
      }
    }
    if (hasSeam(compiled, 'beforeStop')) {
      const quiet = [{ calls: [], edits: [], verifiedAfterEdits: true }]
      quiet.push(turnView([
        { kind: 'tool', tool: 'edit', path: 'src/example.js', ok: true, mutating: true },
        { kind: 'tool', tool: 'bash', command: 'npm test', ok: true, exitCode: undefined, verifying: true, text: 'ok' },
      ]))
      for (const turn of quiet) {
        for (const effect of await runStop(compiled, turn)) {
          regression.collateral.push(`${effect.type} on a turn that ${turn.calls.length === 0 ? 'made no tool calls' : 'had already verified its edits'}`)
        }
      }
    }
    if (hasSeam(compiled, 'beforeStep')) {
      const calm = { turn: 1, step: 2, recent: [{ tool: 'read', path: 'README.md', ok: true, mutating: false, verifying: false, text: 'contents' }] }
      for (const effect of await runStep(compiled, calm)) regression.collateral.push(`${effect.type} on a step with nothing going wrong`)
    }
  } catch (error) {
    if (!(error instanceof AdaptationError)) throw error
    report.stages.push({ stage: 'regression', problems: 1 })
    return fail('regression', [`while replaying observations that went fine: ${error.message}`])
  }
  const regressionProblems = [...new Set(regression.collateral)].slice(0, 5)
  if (regression.annotated > Math.max(1, Math.ceil(history.length * limits.maxAnnotateRate))) {
    regressionProblems.push(`it annotated ${regression.annotated} of ${history.length} results that were fine; narrow its conditions`)
  }
  report.stages.push({ stage: 'regression', observations: history.length, annotated: regression.annotated, collateral: regression.collateral.length })
  if (regressionProblems.length > 0) return fail('regression', regressionProblems)

  const needsApproval = needingApproval(meta.capabilities, input.autonomy ?? 'tighten')
  report.stages.push({ stage: 'policy', needsApproval })
  report.tier = inspected.tier
  return { ok: true, problems: [], meta, registrations, report, needsApproval }
}
