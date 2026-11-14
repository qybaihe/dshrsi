// Turns a finding into validated adaptation source.
//
// The model writes the adaptation from the evidence. Each attempt goes
// through the validation gate; a rejected attempt is sent back with the
// gate's reasons so the next attempt can repair it. When the model cannot
// produce a passing adaptation, a deterministic template is tried.
import { API_REFERENCE } from './capabilities.js'
import { synthesize } from './synth.js'
import { validateAdaptation } from './validate.js'

/** First words of the generator's system prompt; stable so tests and logs can recognise the request. */
export const GENERATOR_IDENTITY = 'You write harness adaptations for DeepSeek Harness.'

const SYSTEM = `${GENERATOR_IDENTITY}

An adaptation is a small script the harness loads into a running agent session. It changes how the harness behaves for this user and this machine, so the agent stops running into a problem it has already run into. It is harness code, not advice to the agent: it observes tool calls and results and acts on them.

${API_REFERENCE}

You are given a finding: what went wrong, how often, and the recorded tool calls that show it. Write one adaptation that would have prevented or shortened that trouble, and that stays silent for unrelated work.

Reply with one fenced javascript block containing the complete script, and nothing else.`

function formatEvidence(finding) {
  return (finding.evidence ?? []).map((entry, index) => {
    if (entry.kind === 'user') return `${index + 1}. user said: ${JSON.stringify(entry.text)}`
    const target = entry.command ?? entry.path ?? ''
    const outcome = entry.ok ? 'ok' : `failed${entry.exitCode !== undefined ? ` (exit ${entry.exitCode})` : ''}${entry.errorCode ? ` [${entry.errorCode}]` : ''}`
    return `${index + 1}. ${entry.tool} ${JSON.stringify(target)} -> ${outcome}\n   ${JSON.stringify(String(entry.text ?? '').slice(0, 400))}`
  }).join('\n')
}

function formatRecent(history) {
  return (history ?? []).filter(entry => entry.kind === 'tool').slice(-12).map((entry) => {
    const target = String(entry.command ?? entry.path ?? '').slice(0, 140)
    return `- ${entry.tool} ${JSON.stringify(target)} -> ${entry.ok ? 'ok' : 'failed'}`
  }).join('\n')
}

/** Builds the generator request for one finding. */
export function buildRequest({ finding, env, previous, withdrawn, attempts, history }) {
  const parts = [
    `Finding: ${finding.summary}`,
    `Kind: ${finding.kind}`,
    `Signature: ${finding.signature}`,
    `Seen: ${finding.count} time(s) this session${finding.priorSessions ? `, and in ${finding.priorSessions} earlier session(s)` : ''}`,
    `Workspace: ${env?.cwd ?? 'unknown'} (${env?.platform ?? 'unknown platform'})`,
  ]
  if (finding.subject?.instruction) parts.push(`What the user said: ${JSON.stringify(finding.subject.instruction)}`)
  parts.push('', 'Recorded evidence, oldest first:', formatEvidence(finding))
  const recent = formatRecent(history)
  if (recent !== '') parts.push('', 'What the session did most recently (for context; these are not the problem unless they are also evidence):', recent)
  if (previous) {
    parts.push('', `An earlier adaptation for this finding is installed, and the trouble came back ${previous.recurrences} more time(s). Its source:`,
      '```javascript', previous.source.trim(), '```', 'Write a replacement that actually stops it. Enforce at the tool boundary where the earlier one only advised.')
  }
  if (withdrawn) {
    parts.push('', `An earlier adaptation for this finding was taken back because it did harm: ${withdrawn.reason}. Its source:`,
      '```javascript', withdrawn.source.trim(), '```', 'Do not write that again. Whatever it wrongly stopped must be left alone by yours.')
  }
  for (const attempt of attempts ?? []) {
    parts.push('', 'Your previous attempt was rejected by the validation gate:', '```javascript', attempt.source.trim(), '```',
      'Reasons:', ...attempt.problems.map(problem => `- ${problem}`), 'Fix these and reply with the complete corrected script.')
  }
  return { system: SYSTEM, user: parts.join('\n') }
}

/** Pulls the script out of a model reply. */
export function extractSource(reply) {
  const text = String(reply ?? '')
  const fenced = /```(?:javascript|js|mjs)?\s*\n([\s\S]*?)```/.exec(text)
  const body = (fenced ? fenced[1] : text).trim()
  return body.includes('define(') ? `${body}\n` : undefined
}

/**
 * @param {object} input
 * @param {object} input.finding
 * @param {object[]} [input.history] observations for the regression stage.
 * @param {(request: { system: string, user: string }) => Promise<string>} [input.complete] model call; omitted when no model is available.
 * @param {'model' | 'synth' | 'model-then-synth'} [input.strategy]
 * @param {number} [input.maxRepairs]
 * @param {object} [input.previous] `{ source, recurrences }` when revising an installed adaptation.
 * @param {object} [input.withdrawn] `{ source, reason }` of an adaptation for this finding that was taken back for doing harm.
 * @param {'tighten' | 'full'} [input.autonomy]
 * @param {object} [input.env]
 * @param {object} [input.limits]
 * @returns {Promise<{ ok: boolean, source?: string, validation?: object, generator?: string, attempts: object[] }>}
 */
export async function generateAdaptation(input) {
  const strategy = input.strategy ?? 'model-then-synth'
  const maxRepairs = input.maxRepairs ?? 2
  const attempts = []
  const same = source => input.previous !== undefined && source.trim() === input.previous.source.trim()
  const harmful = source => input.withdrawn !== undefined && source.trim() === input.withdrawn.source.trim()
  const validate = source => validateAdaptation({
    source, finding: input.finding, history: input.history, autonomy: input.autonomy, env: input.env, limits: input.limits,
  })

  if (strategy !== 'synth' && typeof input.complete === 'function') {
    const rejected = []
    for (let round = 0; round <= maxRepairs; round += 1) {
      let reply
      try {
        reply = await input.complete(buildRequest({ finding: input.finding, env: input.env, previous: input.previous, withdrawn: input.withdrawn, attempts: rejected.slice(-1), history: input.history }))
      } catch (error) {
        attempts.push({ generator: 'model', round, ok: false, problems: [`model request failed: ${error?.message ?? error}`] })
        break
      }
      const source = extractSource(reply)
      if (source === undefined) {
        const problems = ['the reply contained no script calling define()']
        attempts.push({ generator: 'model', round, ok: false, problems })
        rejected.push({ source: String(reply ?? '').slice(0, 2000), problems })
        continue
      }
      if (same(source)) {
        const problems = ['this is the script that is already installed and did not help; write a different one']
        attempts.push({ generator: 'model', round, ok: false, problems })
        rejected.push({ source, problems })
        continue
      }
      if (harmful(source)) {
        const problems = ['this is the script that was taken back for doing harm; write a different one']
        attempts.push({ generator: 'model', round, ok: false, problems })
        rejected.push({ source, problems })
        continue
      }
      const validation = await validate(source)
      attempts.push({ generator: 'model', round, ok: validation.ok, problems: validation.problems, failedAt: validation.report.failedAt })
      if (validation.ok) return { ok: true, source, validation, generator: 'model', attempts }
      rejected.push({ source, problems: validation.problems })
    }
  }

  if (strategy !== 'model') {
    const source = synthesize(input.finding, { stricter: input.previous !== undefined })
    if (source !== undefined && harmful(source)) {
      // A template writes the same script every time; the one that did harm is not installed twice.
      attempts.push({ generator: 'synth', ok: false, problems: ['the template for this friction was already taken back for doing harm'] })
    } else if (source === undefined || same(source)) {
      attempts.push({ generator: 'synth', ok: false, problems: [input.previous ? `no stricter template for friction kind "${input.finding.kind}"` : `no template for friction kind "${input.finding.kind}"`] })
    } else {
      const validation = await validate(source)
      attempts.push({ generator: 'synth', ok: validation.ok, problems: validation.problems, failedAt: validation.report.failedAt })
      if (validation.ok) return { ok: true, source, validation, generator: 'synth', attempts }
    }
  }
  return { ok: false, attempts }
}
