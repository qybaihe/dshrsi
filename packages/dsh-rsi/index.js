// DSHRSI: Recursive Self-Improvement for DeepSeek Harness. A plugin through
// which the harness improves itself from its own runs, each improvement being
// where the next one starts.
//
// This file is the host binding only. It turns harness extension points into
// calls on the engine (src/engine.js) and turns the engine's answers back
// into harness decisions. Nothing here decides what to adapt.
import os from 'node:os'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createEngine, DEFAULT_OPTIONS } from './src/engine.js'
import { LAYERS } from './src/layers.js'
import { openLibrary } from './src/library.js'
import { isMarked } from './src/marks.js'
import { describeCall, describeOutcome } from './src/normalize.js'
import { DEFAULT_SIGNALS } from './src/signals.js'
import { projection, statusText, stockText, undoText } from './src/surface.js'
import { DEFAULT_POLICY } from './src/trigger.js'
import { inspectAdaptation } from './src/validate.js'

export const name = 'dsh-rsi'
export const inject = ['agents', 'tools']

export const Config = z.object({
  enabled: z.boolean().default(true).description('Turn the whole plugin off without unloading it.'),
  home: z.string().default('').description('Directory of the adaptation library. Empty means <DSH home>/rsi.'),
  mode: z.union(['observe', 'propose', 'adapt']).default(DEFAULT_OPTIONS.mode)
    .description('observe: record friction only. propose: store adaptations for approval. adapt: mount them into the running session.'),
  autonomy: z.union(['tighten', 'full']).default(DEFAULT_OPTIONS.autonomy)
    .description('tighten: adaptations that rewrite results, add tools, or run commands wait for approval. full: nothing waits.'),
  generator: z.union(['model', 'synth', 'model-then-synth']).default(DEFAULT_OPTIONS.generator)
    .description('Who writes adaptations: the session model, the built-in templates, or the model with templates as fallback.'),
  maxRepairs: z.number().default(DEFAULT_OPTIONS.maxRepairs).description('Times a rejected model-written adaptation is sent back with the reasons.'),
  generatorMaxTokens: z.number().default(8000).description('Output cap of one generator request.'),
  generatorTimeoutMs: z.number().default(120000).description('Deadline of one generator request.'),
  provider: z.string().description('Provider route for generator requests. Defaults to the session route; set together with model.'),
  model: z.string().description('Model for generator requests. Defaults to the session model; set together with provider.'),
  scope: z.union(['workspace', 'global']).default(DEFAULT_OPTIONS.scope).description('Where a new adaptation applies until it is seen in a second workspace.'),
  layers: z.array(z.string()).default([...LAYERS]).description(`Layers of the harness in use: ${LAYERS.join(', ')}. A layer left out is neither mounted nor learned.`),
  projectHarness: z.union(['auto', 'manual', 'off']).default(DEFAULT_OPTIONS.projectHarness)
    .description('auto: project-level adaptations that proved themselves are written into <repository>/.dsh-rsi when the repository has one. manual: only "dsh-rsi project add" writes there. off: project harnesses are ignored.'),
  projectTrust: z.union(['ask', 'always']).default(DEFAULT_OPTIONS.projectTrust)
    .description('ask: a project harness file runs once this machine accepted its content (dsh-rsi trust). always: whatever the repository holds runs.'),
  announce: z.boolean().default(DEFAULT_OPTIONS.announce).description('Tell the model when the harness has adapted itself.'),
  handlerTimeoutMs: z.number().default(DEFAULT_OPTIONS.handlerTimeoutMs).description('Deadline of one adaptation handler call.'),
  signals: z.dict(z.number()).default({}).description(`Detector thresholds. Keys: ${Object.keys(DEFAULT_SIGNALS).join(', ')}.`),
  disabledDetectors: z.array(z.string()).default([]).description('Detector ids to switch off.'),
  policy: z.dict(z.number()).default({}).description(`Trigger policy. Keys: ${Object.keys(DEFAULT_POLICY).join(', ')}.`),
})

/** Position of adaptation prompt sections: after tool guidance, before deployment-specific trailers. */
const SECTION_ORDER = 9800
/** Call ids of commands the plugin runs on behalf of an adaptation; its own hooks leave them alone. */
const INTERNAL_CALL = 'dsh-rsi-exec-'
const SOURCE = 'dsh-rsi'

const blockText = content => (Array.isArray(content) ? content.map(block => (block?.type === 'text' ? block.text : '')).join('\n') : '')
const asArgs = value => (value !== null && typeof value === 'object' ? value : { $raw: String(value ?? '') })

/** A model-visible, logged message from the harness itself. */
function notice(text) {
  const title = /^\[harness adaptation: ([^\]]{1,90})\]/.exec(text)?.[1] ?? 'harness adaptation'
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: SOURCE, form: 'notice', summary: title } })
}

export function apply(ctx, config) {
  // DSH_RSI=off is the same switch for one process, without touching any configuration.
  if (config.enabled === false || process.env.DSH_RSI === 'off') return
  if ((config.provider === undefined) !== (config.model === undefined)) {
    throw new Error('dsh-rsi: provider and model must be set together')
  }
  const home = config.home || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'rsi')
  const warn = message => ctx.logger?.warn?.(`dsh-rsi: ${message}`)
  const byAgent = new WeakMap()
  const bySession = new WeakMap()
  const routes = new WeakMap()
  let execCount = 0

  const host = {
    log(level, message) {
      const logger = ctx.logger
      if (level === 'warn') logger?.warn?.(`dsh-rsi: ${message}`)
      else logger?.info?.(`dsh-rsi: ${message}`)
    },

    /** One auxiliary model request on the session's own route; the reply text is the adaptation. */
    async complete(session, request, signal) {
      const llm = ctx.get('llm')
      if (llm === undefined) throw new Error('no llm service is mounted')
      const agent = session.handle
      const route = config.provider !== undefined
        ? { provider: config.provider, model: config.model }
        : routes.get(agent) ?? agent.model?.current?.()
      if (!route?.provider || !route?.model) throw new Error('no model route is known for this session yet')
      const deadline = AbortSignal.timeout(config.generatorTimeoutMs)
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
      const call = await llm.prepareCall({ provider: route.provider, model: route.model, maxTokens: config.generatorMaxTokens }, combined)
      const assembler = new BlockAssembler()
      const stream = call.stream({
        ...call.config,
        system: request.system,
        messages: [createUserMessage({ content: [{ type: 'text', text: request.user }], source: { kind: SOURCE } })],
        sessionId: agent.id,
        purpose: 'harness-adaptation',
        signal: combined,
      })
      for await (const chunk of stream) assembler.push(chunk)
      const finish = assembler.finish
      if (finish?.kind === 'error' || finish?.kind === 'aborted') throw new Error(finish.failure?.message ?? `generator request ${finish.kind}`)
      return assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('')
    },

    /** Runs a command for an adaptation through the harness shell tool, under the session's sandbox and approval rules. */
    async exec(session, request, signal) {
      const args = { description: 'Check run by a harness adaptation', command: request.command }
      if (Number.isFinite(request.options?.timeoutMs)) args.timeoutMs = request.options.timeoutMs
      execCount += 1
      const batch = await ctx.tools.execute({
        calls: [{ type: 'tool-call', id: `${INTERNAL_CALL}${execCount}`, name: 'bash', arguments: JSON.stringify(args) }],
        signal: signal ?? AbortSignal.timeout(120000),
        agent: session.handle,
      })
      const result = batch.results[0]?.result
      const text = blockText(result?.content)
      const outcome = describeOutcome('bash', text, result?.isError, undefined, request.command)
      return { ok: outcome.ok, exitCode: outcome.exitCode ?? (outcome.ok ? 0 : 1), text: text.slice(0, 8000) }
    },

    /** Registers what an adaptation adds to the model's surface, in the agent's own scope. */
    contribute(session, mount) {
      if (mount.sections.length === 0 && mount.tools.length === 0) return undefined
      const agent = session.handle
      for (const tool of mount.tools) {
        // A scoped tool would shadow a harness tool of the same name.
        if (ctx.tools.get(tool.name, agent) !== undefined) throw new Error(`tool name "${tool.name}" is already in use`)
      }
      const fiber = agent.ctx.inject(['systemPrompt', 'tools'], (scope) => {
        mount.sections.forEach((text, index) => {
          scope.systemPrompt.section({ name: `dsh-rsi:${mount.id}:${index}`, order: SECTION_ORDER + index / 100, text: mount.mark(text), interpolate: false })
        })
        for (const tool of mount.tools) {
          scope.tools.register(defineTool({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
            execute: args => mount.runTool(tool, args),
          }))
        }
      })
      return () => {
        Promise.resolve(fiber.dispose()).catch(error => warn(`could not withdraw ${mount.id}: ${error?.message ?? error}`))
      }
    },
  }

  const library = openLibrary(home, {
    // Versions stored before each kept its own description get it from their source.
    describe(source) {
      const inspected = inspectAdaptation(source)
      return inspected.ok ? { title: inspected.meta.title, description: inspected.meta.description, capabilities: inspected.meta.capabilities, tier: inspected.tier } : undefined
    },
  })
  const engine = createEngine({
    library,
    host,
    options: {
      mode: config.mode, autonomy: config.autonomy, generator: config.generator, maxRepairs: config.maxRepairs,
      scope: config.scope, announce: config.announce, handlerTimeoutMs: config.handlerTimeoutMs,
      layers: config.layers ?? [...LAYERS], projectHarness: config.projectHarness, projectTrust: config.projectTrust,
      signals: config.signals ?? {}, disabledDetectors: config.disabledDetectors ?? [], policy: config.policy ?? {},
    },
  })
  ctx.effect(() => () => engine.dispose(), 'dsh-rsi.engine')

  // What the harness shows of itself. Both services are optional: a profile without them simply shows nothing.
  ctx.inject(['sessionProjections'], (inner) => {
    Promise.resolve(inner.sessionProjections.register(projection)).catch(error => warn(`could not register the session read model: ${error?.message ?? error}`))
  })
  ctx.inject(['commands'], (inner) => {
    inner.commands.register({
      name: 'rsi',
      description: 'Show how the harness has adapted itself; "/rsi undo" takes the last change back, "/rsi off" runs the stock harness',
      handler: (invocation) => {
        try {
          const session = byAgent.get(invocation.agent)
          const [word, ...rest] = String(invocation.rawInput ?? '').trim().split(/\s+/).filter(Boolean)
          if (word === undefined || word === 'status') return { kind: 'success', text: statusText({ session, library }) }
          if (word === 'undo') return { kind: 'success', text: undoText(engine.undo({ sessionId: session?.sessionId })) }
          if (word === 'off' || word === 'on') {
            const changed = engine.setStock(word === 'off', { sessionId: session?.sessionId, reason: rest.join(' ') || undefined })
            return { kind: 'success', text: stockText(word === 'off', changed, session?.mounted().length ?? 0) }
          }
          return { kind: 'error', text: `dsh-rsi: "/rsi ${word}" is not known; /rsi takes nothing, "undo", "off" or "on"` }
        } catch (error) {
          return { kind: 'error', text: `dsh-rsi: ${error?.message ?? error}` }
        }
      },
    })
  })

  ctx.on('agent/created', ({ agent, source }) => {
    try {
      const session = engine.open({
        sessionId: String(agent.id),
        cwd: agent.session.meta?.cwd ?? process.cwd(),
        handle: agent,
        replay: source === 'resume' ? agent.session.ownEvents?.() ?? [] : [],
      })
      byAgent.set(agent, session)
      bySession.set(agent.session, session)
    } catch (error) {
      warn(`could not start for session ${agent.id}: ${error?.message ?? error}`)
    }
    return undefined
  })

  ctx.on('agent/disposed', ({ agent }) => {
    byAgent.get(agent)?.close()
    byAgent.delete(agent)
    bySession.delete(agent.session)
  })

  ctx.on('session/event', (session, event) => {
    bySession.get(session)?.event(event)
  })

  // An adaptation can refuse a call or ask the user about it. It cannot allow
  // one: whatever the rest of the chain decided is only ever made stricter.
  ctx.on('tools/pre-execute', async (exec, next) => {
    const session = exec.agent ? byAgent.get(exec.agent) : undefined
    if (!session || String(exec.callId).startsWith(INTERNAL_CALL)) return next()
    let verdict = {}
    try {
      verdict = await session.beforeTool(describeCall(exec.name, asArgs(exec.arguments)), exec.signal)
    } catch (error) {
      warn(`beforeTool failed: ${error?.message ?? error}`)
    }
    const downstream = await next()
    if (downstream.kind === 'deny' || downstream.kind === 'cancel') return downstream
    if (verdict.deny) return { kind: 'deny', reason: verdict.deny, info: { name: 'HarnessAdaptation', code: 'ADAPTATION_DENIED' } }
    if (downstream.kind === 'ask') return downstream
    if (verdict.ask) return { kind: 'ask', reason: verdict.ask }
    return downstream
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const session = exec.agent ? byAgent.get(exec.agent) : undefined
    if (!session || String(exec.callId).startsWith(INTERNAL_CALL)) return next()
    const text = blockText(result.content)
    // A refusal issued by an adaptation comes through here as a result; it is not something to adapt to again.
    if (isMarked(text)) return next()
    let outcome = { notes: [] }
    try {
      const described = describeOutcome(exec.name, text, result.isError, result.error?.info?.code, asArgs(exec.arguments).command)
      outcome = await session.afterTool(
        describeCall(exec.name, asArgs(exec.arguments)),
        { ok: described.ok, isError: described.isError, exitCode: described.exitCode, text: text.slice(0, 20000), bytes: text.length },
        exec.signal,
      )
    } catch (error) {
      warn(`afterTool failed: ${error?.message ?? error}`)
    }
    const downstream = await next()
    const contexts = [...outcome.notes.map(notice), ...downstream.additionalContexts ?? []]
    const extra = contexts.length > 0 ? { additionalContexts: contexts } : {}
    if (downstream.kind === 'block') return { ...downstream, ...extra }
    if (outcome.block) {
      return { kind: 'block', feedback: [{ type: 'text', text: outcome.block }], info: { name: 'HarnessAdaptation', code: 'ADAPTATION_BLOCKED' }, ...extra }
    }
    if (outcome.replace !== undefined && !result.isError) return { kind: 'accept', content: [{ type: 'text', text: outcome.replace }], ...extra }
    return { ...downstream, ...extra }
  })

  // The step boundary is where the harness changes: findings from the tool
  // results just logged are answered before the model is asked again.
  ctx.on('agent/pre-step', async (payload, next) => {
    const session = byAgent.get(payload.agent)
    if (!session) return next()
    routes.set(payload.agent, payload.modelSelection)
    let notes = []
    try {
      notes = await session.beforeStep({ turn: payload.turn, step: payload.step, signal: payload.signal })
    } catch (error) {
      warn(`beforeStep failed: ${error?.message ?? error}`)
    }
    const downstream = await next()
    if (notes.length === 0) return downstream
    // A step that admits nothing spends no model call; a note must not be what starts one.
    if (downstream.kind !== 'enter' || (downstream.messages.length === 0 && payload.step === 1)) {
      session.requeue(notes)
      return downstream
    }
    return { ...downstream, messages: [...downstream.messages, ...notes.map(notice)] }
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
    const session = byAgent.get(agent)
    if (!session) return
    try {
      const text = await session.beforeStop({ turn, signal })
      if (text !== undefined) agent.steer(notice(text))
    } catch (error) {
      warn(`beforeStop failed: ${error?.message ?? error}`)
    }
  })
}
