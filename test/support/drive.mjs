// Drives the engine the way the harness does, without a harness: tool calls
// go through beforeTool/afterTool and are logged as session events, steps and
// stops go through their boundaries. Used by the engine unit tests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEngine } from '../../packages/dsh-rsi/src/engine.js'
import { openLibrary } from '../../packages/dsh-rsi/src/library.js'
import { isMarked } from '../../packages/dsh-rsi/src/marks.js'
import { describeCall, describeOutcome } from '../../packages/dsh-rsi/src/normalize.js'

/** A library in a temp directory with a controllable clock. */
export function tempLibrary() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshrsi-lib-'))
  let clock = 1_700_000_000_000
  const library = openLibrary(home, { now: () => (clock += 10) })
  return { home, library, advance: ms => { clock += ms }, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) }
}

/** A host that records what the engine asks of it. */
export function fakeHost(overrides = {}) {
  const host = {
    logs: [],
    contributed: [],
    disposed: [],
    completions: [],
    log: (level, message) => host.logs.push(`${level}: ${message}`),
    contribute(session, mount) {
      if (mount.sections.length === 0 && mount.tools.length === 0) return undefined
      const entry = { sessionId: session.sessionId, id: mount.id, sections: [...mount.sections], tools: mount.tools.map(tool => tool.name), mount }
      host.contributed.push(entry)
      return () => host.disposed.push(entry)
    },
    ...overrides,
  }
  return host
}

/**
 * @param {ReturnType<typeof createEngine>} engine
 * @param {{ sessionId: string, cwd: string, replay?: object[] }} input
 * @param {(tool: string, args: object) => { text: string, isError?: boolean }} world what each tool call returns when it runs.
 */
export function drive(engine, input, world) {
  const session = engine.open(input)
  const events = []
  let seq = (input.replay?.length ?? 0)
  let turn = 0
  let step = 0
  let callCount = 0
  const emit = (type, data) => {
    const event = { type, seq: ++seq, time: 1_700_000_000_000 + seq * 1000, data }
    events.push(event)
    session.event(event)
    return event
  }

  return {
    session,
    events,
    /** Starts a turn with a user message. */
    user(text) {
      turn += 1
      step = 0
      emit('turn/start', { turn })
      emit('user/message', { content: [{ type: 'text', text }], source: { kind: 'user' }, role: 'user', id: `u${seq}` })
    },
    /** The step boundary before a model request. Returns the notes the model would see. */
    async step() {
      step += 1
      const notes = await session.beforeStep({ turn, step })
      for (const note of notes) emit('user/message', { content: [{ type: 'text', text: note }], source: { kind: 'dsh-rsi', form: 'notice' }, role: 'user', id: `n${seq}` })
      return notes
    },
    /** One tool call through the full pipeline. Returns what the model would see. */
    async call(tool, args) {
      const callId = `call-${++callCount}`
      const described = describeCall(tool, args)
      const verdict = await session.beforeTool(described)
      let text
      let isError = false
      let notes = []
      let ran = false
      if (verdict.deny) {
        text = `Error: ${verdict.deny}`
        isError = true
      } else {
        const raw = world(tool, args)
        ran = true
        text = raw.text
        isError = raw.isError === true
        const outcome = describeOutcome(tool, text, isError, undefined, args.command)
        const after = await session.afterTool(described, { ok: outcome.ok, isError, exitCode: outcome.exitCode, text, bytes: text.length })
        notes = after.notes
        if (after.block) { text = after.block; isError = true } else if (after.replace !== undefined) text = after.replace
      }
      emit('tool/call', { turn, step, callId, name: tool, arguments: JSON.stringify(args) })
      emit('tool/result', { turn, step, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }], isError } })
      for (const note of notes) emit('user/message', { content: [{ type: 'text', text: note }], source: { kind: 'dsh-rsi', form: 'notice' }, role: 'user', id: `n${seq}` })
      return { text, isError, notes, ran, denied: Boolean(verdict.deny), asked: verdict.ask, marked: isMarked(text) }
    },
    /** Any other session event, as the harness would log it. */
    raw: (type, data) => emit(type, data),
    /** The stop boundary. Returns the text that keeps the turn open, if any. */
    stop: () => session.beforeStop({ turn }),
    /** Ends the turn. */
    end(reason = 'completed') {
      emit('turn/end', { turn, reason: { kind: reason } })
    },
    close: () => session.close(),
  }
}

/** A shell where one command does not exist and everything else succeeds. */
export function missingCommandWorld(missing = 'frobnicate') {
  return (tool, args) => {
    if (tool === 'bash' && new RegExp(`(^|\\s)${missing}(\\s|$)`).test(args.command ?? '')) {
      return { text: `[stderr]\nbash: ${missing}: command not found\n[exit code: 127]` }
    }
    return { text: 'ok' }
  }
}
