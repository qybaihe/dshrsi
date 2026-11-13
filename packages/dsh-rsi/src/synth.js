// Deterministic adaptations for friction kinds with a known remedy.
//
// The model-written path is preferred because it can use the evidence to say
// something specific (which alternative command exists, what the user meant).
// These templates are the floor: what the harness installs when no model is
// available or the model's attempts do not pass validation.

import { commandPositionSource } from './signature.js'

const literal = value => JSON.stringify(String(value))
const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
/** Whether a signature key is literal text that can be searched for in a result. */
const literalKey = key => typeof key === 'string' && key !== '' && !/<(?:path|n|id|hex|time|line)>/.test(key)
const short = (text, max = 60) => String(text).replace(/\s+/g, ' ').trim().slice(0, max)

function script({ title, description, capabilities, body }) {
  return `define({
  title: ${literal(short(title, 88))},
  description: ${literal(description)},
  capabilities: ${JSON.stringify(capabilities)},
  setup(h) {
${body.split('\n').map(line => `    ${line}`).join('\n')}
  },
})
`
}

const TEMPLATES = {
  'missing-command'(finding) {
    const command = finding.subject?.key
    if (!command) return undefined
    const pattern = commandPositionSource(command)
    return script({
      title: `Stop retrying the missing command ${command}`,
      description: `\`${command}\` is not installed on this machine; state it up front, say so on first failure, and refuse repeats.`,
      capabilities: ['prompt', 'annotate', 'deny'],
      body: `h.promptSection(${literal(`\`${command}\` is not installed on this machine. Do not call it; use an installed equivalent.`)})
let failures = 0
const missing = /(?:${escapeRegExp(command)}: (?:command )?not found|command not found: ${escapeRegExp(command)}|'${escapeRegExp(command)}' is not recognized|spawn ${escapeRegExp(command)} ENOENT)/
h.onToolResult({ command: /${pattern}/ }, (call, result) => {
  if (!missing.test(result.text)) return undefined
  failures += 1
  return h.annotate(${literal(`\`${command}\` is not installed on this machine. Do not retry it. Check which equivalent tool is available (for example with \`command -v\`) and use that instead.`)})
})
h.beforeTool({ command: /${pattern}/ }, () => {
  if (failures < 2) return undefined
  return h.deny(${literal(`\`${command}\` is not installed on this machine and has already failed in this session. Use an installed equivalent instead.`)})
})`,
    })
  },

  'missing-dependency'(finding) {
    const module = finding.subject?.key
    if (!module) return undefined
    return script({
      title: `Explain the missing module ${short(module, 40)}`,
      description: `Runs here fail because \`${module}\` cannot be resolved; point at installing dependencies instead of retrying.`,
      capabilities: ['annotate'],
      body: `h.onToolResult((call, result) => {
  if (result.ok || !result.text.includes(${literal(module)})) return undefined
  if (!/Cannot find (?:module|package)|No module named|ERR_MODULE_NOT_FOUND/.test(result.text)) return undefined
  return h.annotate(${literal(`\`${module}\` is not installed in this workspace. Install the project's dependencies with its package manager before running this again; retrying the same command will fail the same way.`)})
})`,
    })
  },

  'invalid-arguments'(finding) {
    const tool = finding.subject?.tool
    const detail = finding.subject?.key
    if (!tool) return undefined
    return script({
      title: `Correct argument mistakes for the ${tool} tool`,
      description: `Calls to \`${tool}\` keep failing argument validation; restate the rejection as an instruction.`,
      capabilities: ['annotate'],
      body: `h.onToolResult({ tool: ${literal(tool)} }, (call, result) => {
  if (!/invalid arguments/i.test(result.text)) return undefined
  const given = Object.keys(call.args).join(', ') || 'none'
  return h.annotate(${literal(`The \`${tool}\` tool rejected the arguments (${detail}). Arguments given: `)} + given + ${literal('. Use exactly the parameter names in the tool schema and include every required one.')})
})`,
    })
  },

  'edit-mismatch'(finding) {
    const tool = finding.subject?.tool ?? 'edit'
    return script({
      title: 'Re-read before retrying a failed edit',
      description: 'Edits fail because the text to replace does not match the file; require a fresh read before the next attempt.',
      capabilities: ['annotate', 'deny'],
      body: `const stale = new Set()
h.onToolResult({ tool: ${literal(tool)} }, (call, result) => {
  if (result.ok) { stale.delete(call.path); return undefined }
  if (!/not found|not unique|no match|matched \\d+ times|multiple/i.test(result.text)) return undefined
  stale.add(call.path)
  return h.annotate('The edit did not apply because old_string does not match the file exactly. Read ' + call.path + ' again and copy the text to replace verbatim, including indentation.')
})
h.onToolResult({ tool: 'read' }, call => { stale.delete(call.path); return undefined })
h.beforeTool({ tool: ${literal(tool)} }, call => stale.has(call.path)
  ? h.deny('The last edit of ' + call.path + ' failed to match. Read the file again before editing it.')
  : undefined)`,
    })
  },

  'repeated-failure'(finding) {
    const tool = finding.subject?.tool
    if (!tool) return undefined
    return script({
      title: `Refuse a third identical failing ${tool} call`,
      description: 'The same call was repeated after failing with the same result; stop the loop at the tool boundary.',
      capabilities: ['annotate', 'deny'],
      body: `const failures = new Map()
const keyOf = call => call.tool + ' ' + JSON.stringify(call.args)
h.onToolResult({ tool: ${literal(tool)} }, (call, result) => {
  const key = keyOf(call)
  if (result.ok) { failures.delete(key); return undefined }
  const count = (failures.get(key) || 0) + 1
  failures.set(key, count)
  return count === 2 ? h.annotate('This exact call has now failed twice with the same result. Change the arguments or the approach; repeating it will not help.') : undefined
})
h.beforeTool({ tool: ${literal(tool)} }, call => (failures.get(keyOf(call)) || 0) >= 2
  ? h.deny('This exact call already failed twice in this session. Try a different command or fix the cause first.')
  : undefined)`,
    })
  },

  timeout(finding) {
    const family = finding.subject?.commandFamily
    if (!family) return undefined
    return script({
      title: `Warn that ${short(family, 40)} outlives its deadline here`,
      description: `\`${family}\` keeps running past the tool deadline on this machine; steer toward background jobs or a narrower run.`,
      capabilities: ['annotate'],
      body: `h.onToolResult({ command: ${literal(family)} }, (call, result) => {
  if (!/^\\[still running after \\d+ms/.test(result.text)) return undefined
  return h.annotate(${literal(`\`${family}\` regularly exceeds the tool deadline on this machine. It is now a background job: read its output with the job tools instead of starting it again, or run a narrower target.`)})
})`,
    })
  },

  'output-flood'(finding) {
    const family = finding.subject?.commandFamily
    if (!family) return undefined
    return script({
      title: `Ask for filtered output from ${short(family, 40)}`,
      description: `\`${family}\` returns far more text than is useful; ask for a filtered form.`,
      capabilities: ['annotate'],
      body: `h.onToolResult({ command: ${literal(family)} }, (call, result) => {
  if (result.bytes < 10000) return undefined
  return h.annotate(${literal(`\`${family}\` produces very large output here. Next time pipe it through a filter such as \`tail -n 40\`, \`grep\`, or \`head\` so only the relevant lines come back.`)})
})`,
    })
  },

  'read-thrash'(finding) {
    return script({
      title: 'Point out repeated reads of an unchanged file',
      description: 'The same file was read many times without being edited; say that it has not changed.',
      capabilities: ['annotate'],
      body: `const reads = new Map()
h.onToolResult({ tool: ['edit', 'write'] }, (call, result) => { if (result.ok) reads.delete(call.path); return undefined })
h.onToolResult({ tool: 'read' }, (call, result) => {
  if (!result.ok) return undefined
  const count = (reads.get(call.path) || 0) + 1
  reads.set(call.path, count)
  return count >= 3 ? h.annotate(call.path + ' has not changed since you last read it (' + count + ' reads). Use what you already have instead of reading it again.') : undefined
})`,
    })
  },

  'premature-completion'() {
    return script({
      title: 'Require a check after edits before finishing',
      description: 'Turns ended after edits that nothing verified; keep the turn open until a test, build, or lint command has run.',
      capabilities: ['verify'],
      body: `let asked = ''
h.beforeStop(turn => {
  if (turn.edits.length === 0 || turn.verifiedAfterEdits) return undefined
  const key = turn.edits.join('|')
  if (asked === key) return undefined
  asked = key
  return h.continueWith('You changed ' + turn.edits.join(', ') + ' and have not run any check since. Run the relevant tests, build, or linter now and fix what it reports before finishing. If this workspace has no such check, say so explicitly.')
})`,
    })
  },

  'approval-denied'(finding) {
    const family = finding.subject?.commandFamily
    if (!family) return undefined
    return script({
      title: `Do not attempt ${short(family, 40)} without asking`,
      description: `The user has refused \`${family}\` repeatedly here; refuse it up front with the reason.`,
      capabilities: ['deny'],
      body: `h.beforeTool({ command: ${literal(family)} }, () => h.deny(${literal(`The user has repeatedly refused \`${family}\` in this workspace. Do not attempt it; explain what you need and let the user decide.`)}))`,
    })
  },

  'denied-repeat'(finding) {
    return TEMPLATES['approval-denied'](finding)
  },

  flailing(finding) {
    const family = finding.subject?.commandFamily
    if (!family) return undefined
    return script({
      title: `Break the retry loop on ${short(family, 40)}`,
      description: `Several variants of \`${family}\` failed in a row; after the third failure ask for a diagnosis instead of another variant.`,
      capabilities: ['annotate'],
      body: `let streak = 0
h.onToolResult({ command: ${literal(family)} }, (call, result) => {
  if (result.ok) { streak = 0; return undefined }
  streak += 1
  return streak >= 3 ? h.annotate(${literal(`Three attempts at \`${family}\` have failed. Stop varying the arguments: read the error text, check the preconditions it names, and state what is actually wrong before running it again.`)}) : undefined
})`,
    })
  },

  stall() {
    return script({
      title: 'Call for a re-plan after a run of failures',
      description: 'Many tool calls failed in a row; interrupt the streak with a request to re-plan.',
      capabilities: ['steer'],
      body: `let notedAt = 0
h.beforeStep(state => {
  let streak = 0
  for (let index = state.recent.length - 1; index >= 0 && !state.recent[index].ok; index -= 1) streak += 1
  if (streak < 4) { notedAt = 0; return undefined }
  if (notedAt !== 0 && streak - notedAt < 3) return undefined
  notedAt = streak
  return h.note('The last ' + streak + ' tool calls all failed. Stop and re-plan: state what you were trying to achieve, what the errors have in common, and one different approach before making another call.')
})`,
    })
  },

  'error-storm'() {
    return TEMPLATES.stall()
  },

  'edit-churn'(finding) {
    return script({
      title: 'Slow down repeated edits to one file',
      description: 'One file was edited many times in a turn; ask for a single considered change.',
      capabilities: ['annotate'],
      body: `const edits = new Map()
h.onToolResult({ tool: ['edit', 'write'] }, (call, result) => {
  if (!result.ok) return undefined
  const count = (edits.get(call.path) || 0) + 1
  edits.set(call.path, count)
  return count === 5 ? h.annotate('You have edited ' + call.path + ' five times this session. Read the whole file once, decide the final shape, and make one edit instead of many small ones.') : undefined
})`,
    })
  },

  'user-correction'(finding) {
    const instruction = finding.subject?.instruction
    if (!instruction) return undefined
    return script({
      title: `Remember the user's instruction: ${short(instruction, 50)}`,
      description: 'The user corrected the agent; keep the instruction in front of the model in this workspace.',
      capabilities: ['prompt'],
      body: `h.promptSection(${literal(`Standing instruction from the user of this workspace (they had to correct this once already):\n${instruction.slice(0, 600)}`)})`,
    })
  },

  'network-failure'(finding) {
    const detail = finding.subject?.key
    if (!detail) return undefined
    const needle = literalKey(detail) ? `result.text.includes(${literal(detail)})` : 'true'
    return script({
      title: `Explain the network failure ${short(detail, 40)}`,
      description: `Commands here fail on the network (${detail}); say that retrying will not help and point at offline options.`,
      capabilities: ['annotate'],
      body: `h.onToolResult((call, result) => {
  if (result.ok || !/ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|ENOTFOUND|Could not resolve host|certificate|proxy/i.test(result.text)) return undefined
  if (!(${needle})) return undefined
  return h.annotate(${literal(`This machine could not reach the network for that (${detail}). It has failed the same way before, so do not retry it unchanged: use what is already installed or cached locally, or tell the user that network access is needed.`)})
})`,
    })
  },

  'permission-failure'(finding) {
    const detail = finding.subject?.key
    if (!detail) return undefined
    const where = detail.replace(/^<path>\//, '')
    const needle = literalKey(detail) ? `result.text.includes(${literal(detail)})` : `result.text.includes(${literal(where)})`
    return script({
      title: `Explain the permission failure on ${short(where, 40)}`,
      description: `Writes or runs touching ${where} are refused by the operating system; stop retries and point at a location the agent may use.`,
      capabilities: ['annotate'],
      body: `h.onToolResult((call, result) => {
  if (result.ok || !/EACCES|EPERM|Permission denied/.test(result.text)) return undefined
  if (!(${needle})) return undefined
  return h.annotate(${literal(`The operating system refuses access to ${where} for this user. Do not retry and do not reach for sudo: work inside the workspace or a temporary directory, or ask the user to change the permission.`)})
})`,
    })
  },

  'port-conflict'(finding) {
    const port = finding.subject?.key
    if (!port) return undefined
    return script({
      title: `Explain that port ${short(port, 10)} is taken`,
      description: `Port ${port} is already in use on this machine; point at choosing another port instead of restarting the same command.`,
      capabilities: ['annotate'],
      body: `h.onToolResult((call, result) => {
  if (result.ok || !/EADDRINUSE|address already in use/i.test(result.text) || !result.text.includes(${literal(port)})) return undefined
  return h.annotate(${literal(`Port ${port} is already in use on this machine, and it was the last time too. Start the server on a different port, or find the owning process first (for example with lsof -i :${port}) and decide with the user whether to stop it.`)})
})`,
    })
  },

  'missing-path'(finding) {
    const tool = finding.subject?.tool
    if (!tool) return undefined
    return script({
      title: `Check paths before reusing a missing one with ${tool}`,
      description: 'Calls keep naming files that do not exist; ask for a directory listing before the path is used again.',
      capabilities: ['annotate'],
      body: `let misses = 0
h.onToolResult({ tool: ${literal(tool)} }, (call, result) => {
  if (result.ok || !/ENOENT|No such file or directory/.test(result.text)) return undefined
  misses += 1
  return misses >= 2 ? h.annotate('That path does not exist, and this is not the first missing path in this session. List the directory (glob or ls) and use a path you have seen, instead of guessing another one.') : undefined
})`,
    })
  },

  'resource-exhaustion'(finding) {
    const family = finding.subject?.commandFamily
    if (!family) return undefined
    return script({
      title: `Warn that ${short(family, 40)} runs out of memory here`,
      description: `\`${family}\` is killed for memory on this machine; ask for a smaller run.`,
      capabilities: ['annotate'],
      body: `h.onToolResult({ command: ${literal(family)} }, (call, result) => {
  if (result.ok || !/heap out of memory|Killed: 9|MemoryError|ENOMEM/.test(result.text)) return undefined
  return h.annotate(${literal(`\`${family}\` ran out of memory on this machine. Run a narrower target (one package, one test file) or lower its parallelism instead of repeating the full run.`)})
})`,
    })
  },

  'negative-feedback'(finding) {
    const instruction = finding.subject?.instruction
    if (!instruction) return undefined
    return TEMPLATES['user-correction']({ ...finding, subject: { ...finding.subject, instruction } })
  },
}

const STRICTER = {
  'missing-command'(finding) {
    const command = finding.subject?.key
    if (!command) return undefined
    const pattern = commandPositionSource(command)
    return script({
      title: `Refuse the missing command ${command} outright`,
      description: `\`${command}\` is not installed on this machine and advice did not stop the retries; refuse it before it runs.`,
      capabilities: ['deny'],
      body: `h.beforeTool({ command: /${pattern}/ }, () => h.deny(${literal(`\`${command}\` is not installed on this machine. This call was not run. Use an installed equivalent; check with \`command -v\` if unsure which.`)}))`,
    })
  },

  'missing-dependency'(finding) {
    const module = finding.subject?.key
    if (!module) return undefined
    return script({
      title: `Block reruns until ${short(module, 40)} is installed`,
      description: `Runs keep failing on the unresolved module \`${module}\` and advice did not stop the retries; refuse the same command until something else has run.`,
      capabilities: ['block', 'deny'],
      body: `let failed
h.onToolResult((call, result) => {
  if (result.ok) { if (call.command !== failed) failed = undefined; return undefined }
  if (!result.text.includes(${literal(module)}) || !/Cannot find (?:module|package)|No module named|ERR_MODULE_NOT_FOUND/.test(result.text)) return undefined
  failed = call.command
  return h.block(${literal(`This failed because \`${module}\` is not installed in this workspace. Install the project's dependencies with its package manager first; the same command is refused until you have run something else.`)})
})
h.beforeTool(call => (failed !== undefined && call.command === failed)
  ? h.deny(${literal(`This command just failed because \`${module}\` is missing. Install dependencies before running it again.`)})
  : undefined)`,
    })
  },

  'repeated-failure'(finding) {
    const tool = finding.subject?.tool
    if (!tool) return undefined
    return script({
      title: `Refuse any identical failing ${tool} call`,
      description: 'The same call kept being repeated after failing; refuse the first repeat instead of the second.',
      capabilities: ['deny'],
      body: `const failed = new Set()
const keyOf = call => call.tool + ' ' + JSON.stringify(call.args)
h.onToolResult({ tool: ${literal(tool)} }, (call, result) => {
  if (result.ok) failed.delete(keyOf(call))
  else failed.add(keyOf(call))
  return undefined
})
h.beforeTool({ tool: ${literal(tool)} }, call => failed.has(keyOf(call))
  ? h.deny('This exact call already failed in this session and was not run again. Change the arguments or fix the cause first.')
  : undefined)`,
    })
  },

  flailing(finding) {
    const family = finding.subject?.commandFamily
    if (!family) return undefined
    return script({
      title: `Refuse further blind attempts at ${short(family, 40)}`,
      description: `Variants of \`${family}\` kept failing after advice; refuse the next attempt after two failures in a row until another command has succeeded.`,
      capabilities: ['deny'],
      body: `let streak = 0
h.onToolResult((call, result) => {
  if (call.commandFamily === ${literal(family)}) streak = result.ok ? 0 : streak + 1
  else if (result.ok) streak = 0
  return undefined
})
h.beforeTool({ command: ${literal(family)} }, () => streak >= 2
  ? h.deny(${literal(`\`${family}\` keeps failing and was not run again. Inspect the cause with a different command first; it is allowed again after something else succeeds.`)})
  : undefined)`,
    })
  },
}

/** Friction kinds the synthesizer can answer. */
export const SYNTHESIZABLE = Object.freeze(Object.keys(TEMPLATES))

/**
 * @param {object} finding
 * @param {{ stricter?: boolean }} [options] ask for the enforcing variant, used when revising.
 * @returns {string | undefined} adaptation source, or undefined when no template fits.
 */
export function synthesize(finding, options = {}) {
  if (options.stricter) return STRICTER[finding.kind]?.(finding)
  return TEMPLATES[finding.kind]?.(finding)
}
