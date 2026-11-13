// What an adaptation may do, grouped by how much trust it needs.
//
// `tighten` capabilities can only add information, refuse an action, or ask
// for more work. `power` capabilities change what runs or what the model is
// told happened. There is deliberately no capability that grants permission:
// an adaptation can never approve an action the harness would have refused.

export const CAPABILITIES = Object.freeze({
  annotate: { tier: 'tighten', summary: 'attach a note after a tool result' },
  steer: { tier: 'tighten', summary: 'add a note before a model step' },
  deny: { tier: 'tighten', summary: 'refuse a tool call with a reason' },
  ask: { tier: 'tighten', summary: 'require user approval for a tool call' },
  block: { tier: 'tighten', summary: 'turn a tool result into an error with corrective feedback' },
  verify: { tier: 'tighten', summary: 'keep a turn open until a condition holds' },
  prompt: { tier: 'tighten', summary: 'add a system prompt section' },
  rewrite: { tier: 'power', summary: 'replace the text of a tool result' },
  tool: { tier: 'power', summary: 'register a new model-facing tool' },
  exec: { tier: 'power', summary: 'run shell commands through the harness tool pipeline' },
})

export const TIGHTEN = Object.keys(CAPABILITIES).filter(name => CAPABILITIES[name].tier === 'tighten')
export const POWER = Object.keys(CAPABILITIES).filter(name => CAPABILITIES[name].tier === 'power')

/** Capabilities in `declared` that the autonomy level does not allow unattended. */
export function needingApproval(declared, autonomy) {
  if (autonomy === 'full') return []
  return declared.filter(name => CAPABILITIES[name]?.tier === 'power')
}

/** Reference text handed to the generator and printed in the README. */
export const API_REFERENCE = `An adaptation is one JavaScript script. It calls define() exactly once:

define({
  title: 'short imperative title',
  description: 'one sentence: what friction this removes and how',
  capabilities: ['annotate'],          // every capability the code uses
  setup(h) { /* register handlers on h */ },
})

No imports, no require, no process, no network, no file access. Only \`h\` reaches the harness.

Views passed to handlers (plain data):
  call   = { tool, args, command, commandHead, commandFamily, path }
           command* fields exist for shell tools; path for file tools.
  result = { ok, isError, exitCode, text, bytes }
           shell commands report failure through exitCode and text, not isError.
           text can be a truncated copy; bytes is the size of the full result.

Registration (inside setup):
  h.onToolResult(filter, (call, result) => effect | undefined)
      effects: h.annotate(text)   [annotate]  note shown to the model after the result
               h.block(feedback)  [block]     result becomes an error carrying feedback
               h.replace(text)    [rewrite]   result text is replaced
  h.beforeTool(filter, (call) => effect | undefined)
      effects: h.deny(reason)     [deny]      call is refused; the model sees the reason
               h.ask(reason)      [ask]       call needs user approval first
  h.beforeStop(async (turn) => effect | undefined)
      turn = { calls: [{ tool, command, path, ok, exitCode, mutating, verifying, text }], edits: [paths], verifiedAfterEdits }
      effects: h.continueWith(text) [verify]  the turn stays open and the model receives text
  h.beforeStep((state) => effect | undefined)
      state = { turn, step, recent: [same shape as turn.calls] }
      effects: h.note(text)       [steer]     note added before the model's next request
  h.promptSection(text)           [prompt]    standing system prompt text
  h.addTool({ name, description, parameters, run })   [tool]
      parameters = { field: { type: 'string' | 'number' | 'boolean', required?: true, description } }
      run = async (args) => string
  await h.exec(command, { timeoutMs })               [exec]
      runs through the harness shell tool, under the same sandbox and approval rules;
      resolves { ok, exitCode, text }. Usable inside beforeStop and addTool.run.

filter = { tool?: 'bash' | ['read','edit'], command?: /regex/ | 'prefix', path?: /regex/ } or omitted for all calls.
  \`command\` tests the full command line.

Rules:
  - Match narrowly: use the specific command, error text, or path from the evidence.
  - Handlers must be fast and must not throw. Return undefined when the case does not apply.
  - Prefer enforcement over advice: deny or block a known-bad action instead of only commenting on it.
  - When the cause is a fact about this machine or this user's rules (a tool that is missing, the command to use
    instead), also state it with h.promptSection so later sessions do not make the mistake at all.
  - A command filter must match the program where it is run (start of the line, or after ; & | ( ), not where it is
    an argument: "command -v X", "which X" and "type X" must keep working, they are how the agent finds an alternative.
  - When asking for a check, ask for one that exercises behaviour (the project's tests, or running the changed code),
    not one that only parses the file.
  - Only claim what the evidence shows. Name an alternative command only if the evidence shows it working.
  - Text shown to the model states the fact and the action to take, in one or two sentences.`
