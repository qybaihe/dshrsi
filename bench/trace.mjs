#!/usr/bin/env node
// Lifts one adaptation's story out of the raw logs of a benchmark run, for the website's trace page.
//
//   node bench/trace.mjs [--write]
//
// It reads the session logs of both arms and the plugin's own audit log, and writes nothing that was not in them:
// the track (every session of one language, in start order, with whether the failure occurred), the session in which
// the adaptation was written (every step from the first one), the adaptation itself and what happened to it later.
// Paths of the machine the run was made on are cut down to the part inside the exercise.
import fs from 'node:fs'
import path from 'node:path'
import { BENCH_HOME, ROOT } from './lib/env.mjs'

const write = process.argv.includes('--write')
const CASE = {
  bench: 'polyglot',
  language: 'rust',
  model: 'mimo-v2.6-flash',
  runs: { dsh: 'flash-dsh-p1', rsi: 'flash-rsi-p1' },
  adaptation: 'a-mwfck31z-5c8ad2',
  /** The failure the adaptation answers, as a test on one tool call and its result. */
  failure: (call, text) => call.name === 'read' && /lib\.rs$/.test(call.file ?? '') && /not found/.test(text),
}

const runDir = run => path.join(BENCH_HOME, 'runs', CASE.bench, run)
const jsonl = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
const clock = time => new Date(time).toISOString().slice(11, 19)
/** Whether a tool result reads as a success. */
/** The first two lines of a task, which is how a session shows it. */
const headOf = text => { const head = text.split('\n').filter(Boolean).slice(0, 2).join(' '); return head.length > 150 ? `${head.slice(0, 150).trimEnd()} …` : head }
const succeeded = text => !/^Error:/.test(text) && !/\[exit code: [1-9]/.test(text) && !/^error:/m.test(text) && !/FAILED/.test(text)

/** Everything up to and including the exercise directory goes; what is left is the path as the agent meant it. */
function tidy(text, run, task) {
  return String(text)
    .replaceAll(`${runDir(run)}/work/${CASE.language}/exercises/practice/${task}/`, '')
    .replaceAll(`${runDir(run)}/work/${CASE.language}/exercises/practice/${task}`, '.')
    .replaceAll(runDir(run), '<run>')
    .replaceAll(BENCH_HOME, '<bench>')
}

function sessionsOf(run) {
  const root = path.join(runDir(run), 'home/sessions')
  const scored = new Map(jsonl(path.join(runDir(run), 'results.jsonl')).map(row => [row.id, row]))
  const rows = []
  for (const dir of fs.readdirSync(root)) {
    const task = new RegExp(`work-${CASE.language}-exercises-practice-(.+)--$`).exec(dir)?.[1]
    if (!task) continue
    for (const session of fs.readdirSync(path.join(root, dir))) {
      const file = path.join(root, dir, session, 'session.v4.jsonl')
      if (!fs.existsSync(file)) continue
      const lines = jsonl(file)
      const results = new Map(lines.filter(line => line.type === 'tool/result').map(line => [line.data.message.toolCallId, line.data.message.content?.[0]?.text ?? '']))
      const calls = lines.filter(line => line.type === 'tool/call').map((line) => {
        let args = {}
        try { args = JSON.parse(line.data.arguments) } catch { /* arguments the model did not finish */ }
        return { id: line.data.callId, name: line.data.name, file: args.file_path === undefined ? undefined : tidy(args.file_path, run, task), what: tidy(args.file_path ?? args.command ?? args.pattern ?? '', run, task) }
      })
      // How the session opened: every call up to and including the first one that failed this way.
      const firstFailure = calls.findIndex(call => CASE.failure(call, results.get(call.id) ?? ''))
      const opening = calls.slice(0, firstFailure + 1).map(call => ({ tool: call.name, what: call.what.length > 120 ? `${call.what.slice(0, 120).trimEnd()} …` : call.what, ok: succeeded(results.get(call.id) ?? '') }))
      const asked = lines.map(line => (line.type === 'user/message' ? line.data.content?.[0]?.text ?? '' : '')).find(text => text && !/^<system-reminder>/.test(text)) ?? ''
      const row = scored.get(`${CASE.language}/${task}`)
      rows.push({
        task, id: session, file, lines, startedMs: lines[0].createdAt, startedAt: clock(lines[0].createdAt),
        failed: calls.filter(call => CASE.failure(call, results.get(call.id) ?? '')).length, opening, head: headOf(tidy(asked, run, task)),
        calls: calls.length, steps: lines.filter(line => line.type === 'step/start').length,
        passed1: row?.passed1 ?? null, passed2: row?.passed2 ?? null,
      })
    }
  }
  return rows.sort((a, b) => a.startedMs - b.startedMs)
}

const arms = { dsh: sessionsOf(CASE.runs.dsh), rsi: sessionsOf(CASE.runs.rsi) }
const home = path.join(runDir(CASE.runs.rsi), 'home/rsi')
const record = JSON.parse(fs.readFileSync(path.join(home, 'adaptations', CASE.adaptation, 'adaptation.json'), 'utf8'))
const source = fs.readFileSync(path.join(home, 'adaptations', CASE.adaptation, 'source.js'), 'utf8')
const audit = jsonl(path.join(home, 'audit.jsonl'))
const signature = record.friction.signature
const mine = audit.filter(entry => entry.adaptationId === CASE.adaptation || entry.signature === signature)
const created = mine.find(entry => entry.type === 'create')
const trigger = mine.find(entry => entry.type === 'trigger' && entry.sessionId === created.sessionId)
const generation = mine.find(entry => entry.type === 'generation' && entry.sessionId === created.sessionId)
const generalize = mine.find(entry => entry.type === 'generalize')
const promote = mine.find(entry => entry.type === 'promote')
const origin = arms.rsi.find(session => session.id === created.sessionId)
const taskOf = cwd => String(cwd).split('/practice/')[1]

// ---------- the session the adaptation was written in, from its first event ----------
const events = []
const at = time => Number(((time - origin.startedMs) / 1000).toFixed(1))
const short = (text, limit) => (text.length > limit ? `${text.slice(0, limit).trimEnd()} …` : text)
let userMessages = 0
for (const line of origin.lines) {
  const data = line.data ?? {}
  if (line.type === 'user/message') {
    const text = tidy(data.content?.[0]?.text ?? '', CASE.runs.rsi, origin.task)
    if (/^<system-reminder>/.test(text)) continue
    if (/^\[harness adaptation/.test(text)) events.push({ at: at(line.time), time: clock(line.time), kind: 'notice', text })
    else if ((userMessages += 1) === 1) {
      // The exercise text is Exercism's; the last lines are the instruction the benchmark adds, which name the file.
      const tail = text.slice(text.lastIndexOf('####') + 4).trim()
      events.push({ at: at(line.time), time: clock(line.time), kind: 'task', head: headOf(text), characters: text.length, tail })
    }
  } else if (line.type === 'assistant/message') {
    const parts = data.message.content
    const thought = parts.filter(part => part.type === 'reasoning').map(part => part.text).join(' ')
    const said = parts.filter(part => part.type === 'text').map(part => part.text).join(' ')
    events.push({ at: at(line.time), time: clock(line.time), kind: 'model', step: data.step, thought: short(thought, 220), said: short(said, 260) })
  } else if (line.type === 'tool/call') {
    let args = {}
    try { args = JSON.parse(data.arguments) } catch { /* unfinished arguments */ }
    const what = args.file_path ?? args.command ?? args.pattern ?? ''
    events.push({ at: at(line.time), time: clock(line.time), kind: 'call', id: data.callId, tool: data.name, what: short(tidy(what, CASE.runs.rsi, origin.task), 120) })
  } else if (line.type === 'tool/result') {
    const text = tidy(data.message.content?.[0]?.text ?? '', CASE.runs.rsi, origin.task)
    const call = events.find(event => event.kind === 'call' && event.id === data.message.toolCallId)
    if (call) {
      call.ok = succeeded(text)
      call.result = short(text.replace(/<\/?(path|type|content)>/g, ' ').replace(/\s+/g, ' ').trim(), 150)
    }
  } else if (line.type === 'turn/end') {
    events.push({ at: at(line.time), time: clock(line.time), kind: 'end', reason: data.reason?.kind })
  }
}
// What the plugin did between the failed call and the next model request, from its audit log.
const pluginAt = events.findIndex(event => event.kind === 'notice')
events.splice(pluginAt, 0,
  { at: at(trigger.time), time: clock(trigger.time), kind: 'trigger', detector: trigger.detector, reason: trigger.reason, severity: trigger.severity, afterMs: trigger.time - origin.lines.find(line => line.type === 'tool/result' && /not found/.test(line.data.message.content?.[0]?.text ?? '')).time },
  ...generation.attempts.map((attempt, index) => ({ at: null, kind: 'draft', number: index + 1, generator: attempt.generator, ok: attempt.ok, failedAt: attempt.failedAt ?? null, problems: attempt.problems })),
  { at: at(created.time), time: clock(created.time), kind: 'gate', stages: record.validation.stages.map(stage => ({ stage: stage.stage, registrations: stage.registrations, effects: stage.effects?.map(effect => effect.type), observations: stage.observations, collateral: stage.collateral })) },
  { at: at(created.time), time: clock(created.time), kind: 'mounted', seconds: Number(((created.time - trigger.time) / 1000).toFixed(1)), status: created.status, capabilities: created.capabilities },
)
for (const event of events) delete event.id

// ---------- what the prompt of later sessions gained ----------
const systemOf = session => session.lines.find(line => line.type === 'system/message')?.data.message.content.map(part => part.text).join('\n') ?? ''
const later = arms.rsi.find(session => session.startedMs > generalize.time)
const promptSection = systemOf(later).split('\n').find(line => line.includes(`[harness adaptation: ${record.title}]`)) ?? null

const strip = sessions => sessions.map(({ task, startedAt, startedMs, failed, calls, steps, passed1, passed2 }) => ({ task, startedAt, startedMs, failed, calls, steps, passed1, passed2 }))
// "After" is the same set of tasks for both arms: the ones that started, in the plugin's run, once the adaptation
// applied to the whole machine. Stock DSH on those very tasks is the control.
const afterTasks = new Set(arms.rsi.filter(session => session.startedMs > generalize.time).map(session => session.task))
const after = sessions => sessions.filter(session => afterTasks.has(session.task))
const count = sessions => ({ total: sessions.length, hit: sessions.filter(session => session.failed > 0).length })
const trace = {
  bench: CASE.bench, language: CASE.language, model: CASE.model, runs: CASE.runs, signature,
  arms: Object.fromEntries(Object.entries(arms).map(([arm, sessions]) => [arm, {
    sessions: strip(sessions), ...count(sessions),
    afterWidening: count(after(sessions)),
    firstTry: sessions.filter(session => session.passed1).length, twoTries: sessions.filter(session => session.passed2).length,
    calls: sessions.reduce((sum, session) => sum + session.calls, 0), steps: sessions.reduce((sum, session) => sum + session.steps, 0),
  }])),
  adaptation: {
    id: record.id, title: record.title, description: record.description, capabilities: record.capabilities, tier: record.tier, source,
    earlier: arms.rsi.filter(session => session.failed > 0 && session.startedMs < origin.startedMs).map(session => ({ task: session.task, startedAt: session.startedAt, head: session.head, opening: session.opening })),
    writtenIn: { task: origin.task, startedAt: origin.startedAt }, triggeredAt: clock(trigger.time), mountedAt: clock(created.time),
    secondsToMount: Number(((created.time - trigger.time) / 1000).toFixed(1)), drafts: generation.attempts.length,
    widenedAt: clock(generalize.time), widenedAtMs: generalize.time, widenedAfter: generalize.workspaces.map(taskOf),
    promotedAt: clock(promote.time), promotedAtMs: promote.time, promoteReason: promote.reason, promptSection,
  },
  session: { task: `${CASE.language}/${origin.task}`, startedAt: origin.startedAt, passed1: origin.passed1, steps: origin.steps, calls: origin.calls, events },
}

const say = (label, value) => console.log(`${label.padEnd(34)} ${value}`)
say('track', `${CASE.bench} · ${CASE.language} · ${CASE.model}`)
for (const [arm, data] of Object.entries(trace.arms)) {
  say(`${arm}: sessions with the failure`, `${data.hit} of ${data.sessions.length}   ${data.sessions.map(session => (session.failed ? 'x' : '.')).join('')}`)
  say(`${arm}: after the widening`, `${data.afterWidening.hit} of ${data.afterWidening.total}`)
  say(`${arm}: solved first try / two tries`, `${data.firstTry} / ${data.twoTries}`)
  say(`${arm}: tool calls, model steps`, `${data.calls}, ${data.steps}`)
}
say('adaptation', `${trace.adaptation.title} (${trace.adaptation.capabilities.join(', ')})`)
say('written in', `${trace.session.task} at ${trace.adaptation.triggeredAt}, mounted ${trace.adaptation.secondsToMount} s later, ${trace.adaptation.drafts} draft(s)`)
say('widened / promoted', `${trace.adaptation.widenedAt} / ${trace.adaptation.promotedAt} (${trace.adaptation.promoteReason})`)
say('events in the session', String(events.length))

if (write) {
  fs.writeFileSync(path.join(ROOT, 'bench/results/trace.json'), `${JSON.stringify(trace, null, 1)}\n`)
  fs.writeFileSync(path.join(ROOT, 'website/assets/trace-data.js'), `// Written by bench/trace.mjs --write. Do not edit by hand.\nwindow.DSHRSI_TRACE = ${JSON.stringify(trace, null, 1)}\n`)
  console.log('wrote bench/results/trace.json and website/assets/trace-data.js')
}
