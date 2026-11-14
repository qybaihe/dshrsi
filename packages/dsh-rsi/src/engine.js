// The adaptation loop, independent of the host it runs in.
//
//   observe   session events -> observations -> findings
//   decide    weigh a finding against the library, the ledger and the budgets
//   adapt     generate source, pass the validation gate, store it
//   mount     bind it to the live session, mid-turn
//   settle    promote what worked, quarantine what faulted, revise what did not help
//   share     what proved itself about a repository is written into its project harness
//
// The host (see ../index.js) supplies the model call, the shell bridge and
// the registration of prompt sections and tools; everything else is here.
import path from 'node:path'
import { needingApproval } from './capabilities.js'
import { generateAdaptation } from './generate.js'
import { LAYERS, layerOf, layerOfRecord } from './layers.js'
import { MOUNTED, isInside, scopeCovers } from './library.js'
import { judge, priorSessions, workspacesHit } from './metrics.js'
import { createMount } from './mount.js'
import { createNormalizer } from './normalize.js'
import { PROJECT_DIR, findProject, publishEntry, readProject } from './project.js'
import { callSummary, turnView } from './runner.js'
import { DEFAULT_SIGNALS, DETECTORS, createObserver } from './signals.js'
import { DEFAULT_POLICY, decide } from './trigger.js'
import { inspectAdaptation } from './validate.js'

export const DEFAULT_OPTIONS = Object.freeze({
  /** observe: record friction only. propose: store adaptations for approval. adapt: mount them. */
  mode: 'adapt',
  /** tighten: power capabilities wait for approval. full: nothing waits. */
  autonomy: 'tighten',
  generator: 'model-then-synth',
  maxRepairs: 2,
  scope: 'workspace',
  /** Which layers of the harness are in use (see layers.js). A layer left out is neither mounted nor learned. */
  layers: LAYERS,
  /**
   * auto: an adaptation of the project layer that proved itself is written into the project harness, if the
   * repository has one. manual: only `dsh-rsi project add` writes there. off: project harnesses are ignored.
   */
  projectHarness: 'auto',
  /** ask: a project harness file runs once this machine accepted its exact content. always: whatever the repository holds runs. */
  projectTrust: 'ask',
  announce: true,
  handlerTimeoutMs: 30000,
  maxHistory: 400,
  signals: {},
  disabledDetectors: [],
  policy: {},
})

/** Friction that comes from the user, not from a tool; never crowded out by tool trouble. */
const FROM_USER = new Set(['user-correction', 'negative-feedback'])

/** From least to most adapting. A project may ask for less than the user configured, never for more. */
const MODES = ['observe', 'propose', 'adapt']
/** What a project harness may set for the sessions inside it. */
const PROJECT_SETTINGS = ['mode', 'signals', 'disabledDetectors']

/** Rejects option values that would otherwise be ignored silently. */
export function checkOptions(options) {
  const problems = []
  const oneOf = (key, allowed) => { if (options[key] !== undefined && !allowed.includes(options[key])) problems.push(`${key} must be one of ${allowed.join(', ')}`) }
  oneOf('mode', ['observe', 'propose', 'adapt'])
  oneOf('autonomy', ['tighten', 'full'])
  oneOf('generator', ['model', 'synth', 'model-then-synth'])
  oneOf('scope', ['workspace', 'global'])
  oneOf('projectHarness', ['auto', 'manual', 'off'])
  oneOf('projectTrust', ['ask', 'always'])
  if (options.layers !== undefined) {
    if (!Array.isArray(options.layers)) problems.push('layers must be a list')
    else for (const layer of options.layers) if (!LAYERS.includes(layer)) problems.push(`unknown layer "${layer}"; the layers are ${LAYERS.join(', ')}`)
  }
  for (const [key, value] of Object.entries(options.signals ?? {})) if (typeof value !== 'number') problems.push(`signal threshold "${key}" must be a number`)
  if (options.disabledDetectors !== undefined && !Array.isArray(options.disabledDetectors)) return [...problems, 'disabledDetectors must be a list']
  for (const key of Object.keys(options.signals ?? {})) if (!(key in DEFAULT_SIGNALS)) problems.push(`unknown signal threshold "${key}"`)
  for (const key of Object.keys(options.policy ?? {})) if (!(key in DEFAULT_POLICY)) problems.push(`unknown policy setting "${key}"`)
  const detectorIds = [...DETECTORS.map(detector => detector.id), 'denied-repeat']
  for (const id of options.disabledDetectors ?? []) if (!detectorIds.includes(id)) problems.push(`unknown detector "${id}"`)
  return problems
}

/**
 * @param {object} input
 * @param {ReturnType<import('./library.js').openLibrary>} input.library
 * @param {Partial<typeof DEFAULT_OPTIONS>} [input.options]
 * @param {object} [input.host]
 * @param {(session: object, request: { system: string, user: string }, signal?: AbortSignal) => Promise<string>} [input.host.complete]
 * @param {(session: object, request: { command: string, options: object }, signal?: AbortSignal) => Promise<object>} [input.host.exec]
 * @param {(session: object, mount: object) => (() => void) | undefined} [input.host.contribute] registers prompt sections and tools; returns their disposer.
 * @param {(level: 'info' | 'warn', message: string) => void} [input.host.log]
 */
export function createEngine({ library, options = {}, host = {} }) {
  const problems = checkOptions(options)
  if (problems.length > 0) throw new Error(`dsh-rsi: invalid configuration: ${problems.join('; ')}`)
  const config = { ...DEFAULT_OPTIONS, ...options }
  const policy = { ...DEFAULT_POLICY, ...config.policy }
  const log = (level, message) => host.log?.(level, message)
  const sessions = new Set()

  // Live copies: the ledger is appended through `record`, records are re-read after each change.
  let entries = library.ledger()
  let records = library.list()
  const record = entry => { const stored = library.record(entry); entries.push(stored); return stored }
  const audit = entry => library.audit(entry)
  const refresh = () => { records = library.list() }
  /** Other processes write to the same library; this takes in what they stored since this one last looked. */
  const reload = () => { records = library.list(); entries = library.ledger() }

  function setStatus(id, status, reason, type) {
    const before = library.get(id)
    library.setStatus(id, status, reason)
    audit({ type, adaptationId: id, from: before?.status, to: status, reason })
    if (type === 'promote') publish(id)
    refresh()
  }

  /** Whether an adaptation's layer is in use. */
  const layerOn = adaptation => config.layers.includes(layerOfRecord(adaptation)) && !(adaptation.project && config.projectHarness === 'off')

  /**
   * An adaptation of the project layer that has proved itself is written into the project harness, where the
   * repository carries it to everyone who works there.
   */
  function publish(id) {
    if (config.projectHarness !== 'auto') return
    const current = library.get(id)
    if (!current || layerOfRecord(current) !== 'project' || current.tier !== 'tighten') return
    if (current.scope?.kind !== 'workspace' || current.project?.version === current.version) return
    const root = findProject(current.project?.root ?? current.scope.cwd)
    if (!root) return
    try {
      const published = publishEntry(root, { record: current, source: library.readSource(id), entryId: current.project?.entry })
      // Written by this machine from an adaptation it already runs: accepted as written.
      library.trust(root, published.id, published.hash)
      library.update(id, { layer: 'project', scope: { kind: 'workspace', cwd: root }, project: { root, entry: published.id, hash: published.hash, version: current.version } })
      audit({ type: 'publish', adaptationId: id, version: current.version, root, entry: published.id })
      log('info', `"${current.title}" is now part of the project harness: ${path.join(PROJECT_DIR, 'adaptations', `${published.id}.js`)}`)
    } catch (error) {
      log('warn', `could not write adaptation ${id} into the project harness: ${error?.message ?? error}`)
    }
  }

  /** Takes an adaptation out of use because the project harness no longer holds its file. */
  function unplug(adaptation, reason = 'no longer in the project harness') {
    if (adaptation.project?.detached || !MOUNTED.includes(adaptation.status)) return
    library.update(adaptation.id, { status: 'disabled', statusReason: reason, project: { ...adaptation.project, detached: true } })
    audit({ type: 'project-remove', adaptationId: adaptation.id, root: adaptation.project.root, entry: adaptation.project.entry, reason })
  }

  /**
   * Brings the library in line with the project harness a session runs under: files this machine has accepted
   * become adaptations, changed files replace what they changed, removed files are unplugged.
   * @returns {{ root: string, settings: object, waiting: { id: string, changed: boolean }[] } | undefined}
   */
  function syncProject(cwd) {
    if (config.projectHarness === 'off') return undefined
    const root = findProject(cwd)
    if (!root) {
      for (const adaptation of records.filter(entry => entry.project && isInside(cwd, entry.project.root))) unplug(adaptation)
      refresh()
      return undefined
    }
    const state = readProject(root)
    for (const problem of state.problems) log('warn', `project harness at ${root}: ${problem}`)
    const linked = records.filter(entry => entry.project?.root === root)
    const waiting = []
    for (const entry of state.entries) {
      const existing = linked.find(adaptation => adaptation.project.entry === entry.id)
      const always = config.projectTrust === 'always'
      const accepted = library.trusted(root, entry.id, entry.hash)
      if (!accepted && !always) {
        // What runs from a project harness runs only while this machine stands by the content it took in.
        waiting.push({ id: entry.id, changed: existing !== undefined && existing.project.hash !== entry.hash })
        if (existing && !library.trusted(root, entry.id, existing.project.hash)) unplug(existing, 'not accepted on this machine any more')
        continue
      }
      if (existing && existing.project.hash === entry.hash) {
        if (existing.project.detached) {
          library.update(existing.id, { status: 'active', statusReason: 'back in the project harness', project: { ...existing.project, detached: false } })
          audit({ type: 'project-import', adaptationId: existing.id, root, entry: entry.id, restored: true })
        }
        continue
      }
      const inspected = inspectAdaptation(entry.source, { env: { cwd, platform: process.platform } })
      if (!inspected.ok) {
        log('warn', `project adaptation ${entry.id} was not loaded: ${inspected.problems[0]}`)
        audit({ type: 'project-reject', root, entry: entry.id, problems: inspected.problems.slice(0, 3) })
        continue
      }
      const { meta, tier } = inspected
      const fields = {
        title: meta.title, description: meta.description, capabilities: meta.capabilities, tier,
        validation: { stages: inspected.stages, tier },
        // Accepting a file by name is the approval its capabilities need; "always" trust is not.
        approval: accepted && tier === 'power' ? { at: Date.now(), by: 'project-trust', capabilities: meta.capabilities } : undefined,
      }
      if (existing) {
        const keep = ['disabled', 'retired'].includes(existing.status) && !existing.project.detached
        const next = library.revise(existing.id, {
          ...fields, status: keep ? existing.status : 'active',
          revision: { at: Date.now(), reason: 'changed in the project harness', generator: entry.header?.writtenBy ?? 'project' },
        }, entry.source)
        library.update(existing.id, { project: { root, entry: entry.id, hash: entry.hash, version: next.version } })
        audit({ type: 'project-update', adaptationId: existing.id, version: next.version, root, entry: entry.id })
      } else {
        const stored = library.create({
          ...fields, status: 'active', layer: 'project', scope: { kind: 'workspace', cwd: root },
          friction: {
            signature: typeof entry.header?.signature === 'string' ? entry.header.signature : `project:rule:${entry.id}`,
            kind: typeof entry.header?.kind === 'string' ? entry.header.kind : 'project-rule',
            summary: typeof entry.header?.summary === 'string' ? entry.header.summary : meta.description,
          },
          origin: { generator: entry.header?.writtenBy ?? 'hand', imported: 'project' },
          project: { root, entry: entry.id, hash: entry.hash, version: 1 },
        }, entry.source)
        audit({ type: 'project-import', adaptationId: stored.id, root, entry: entry.id, capabilities: meta.capabilities })
      }
    }
    const present = new Set(state.entries.map(entry => entry.id))
    for (const adaptation of linked) if (!present.has(adaptation.project.entry)) unplug(adaptation)
    refresh()
    if (waiting.length > 0) {
      log('info', `project harness at ${root}: ${waiting.length} adaptation(s) are not accepted on this machine and do not run; review with "dsh-rsi project", accept with "dsh-rsi trust"`)
    }
    return { root, settings: state.settings, waiting }
  }

  /** What a project harness sets for sessions inside it. A project can ask for less adapting, never for more. */
  function sessionSettings(project) {
    const base = { mode: config.mode, signals: config.signals, disabledDetectors: config.disabledDetectors }
    const settings = project?.settings ?? {}
    if (Object.keys(settings).length === 0) return base
    const problems = [
      ...Object.keys(settings).filter(key => !PROJECT_SETTINGS.includes(key)).map(key => `"${key}" cannot be set by a project`),
      ...checkOptions(settings),
    ]
    if (problems.length > 0) {
      log('warn', `project harness at ${project.root}: settings ignored: ${problems.join('; ')}`)
      return base
    }
    return {
      mode: settings.mode !== undefined && MODES.indexOf(settings.mode) < MODES.indexOf(config.mode) ? settings.mode : config.mode,
      signals: { ...config.signals, ...settings.signals },
      disabledDetectors: [...new Set([...config.disabledDetectors, ...settings.disabledDetectors ?? []])],
    }
  }

  /** Applies what the ledger says about installed adaptations. */
  function maintain() {
    for (const adaptation of records.filter(entry => MOUNTED.includes(entry.status))) {
      const stats = library.statsOf(adaptation.id, entries, adaptation.version)
      const judgement = judge(entries, adaptation, stats, policy)
      if (judgement.verdict === 'faulty') setStatus(adaptation.id, 'quarantined', judgement.reason, 'quarantine')
      else if (judgement.verdict === 'stale') setStatus(adaptation.id, 'retired', judgement.reason, 'retire')
      else if (judgement.verdict === 'effective' && adaptation.status === 'candidate') setStatus(adaptation.id, 'active', judgement.reason, 'promote')
      // An adaptation the friction still gets past is left in place: it may shorten the trouble, and the
      // recurrences themselves are what trigger its revision.
    }
  }

  const envOf = session => ({ cwd: session.cwd, platform: process.platform })

  function detach(session, id) {
    const entry = session.mounts.get(id)
    if (!entry) return
    entry.mount.dead = true
    session.mounts.delete(id)
    try {
      entry.dispose?.()
    } catch (error) {
      log('warn', `could not withdraw adaptation ${id}: ${error?.message ?? error}`)
    }
  }

  function quarantine(id, reason) {
    setStatus(id, 'quarantined', reason, 'quarantine')
    for (const session of sessions) detach(session, id)
    log('warn', `adaptation ${id} quarantined: ${reason}`)
  }

  function onFault(session, mount, seam, error) {
    record({ type: 'fault', adaptationId: mount.id, version: mount.version, sessionId: session.sessionId, seam, message: String(error?.message ?? error).slice(0, 300) })
    const total = library.statsOf(mount.id, entries, mount.version).faults
    if (total >= policy.maxFaults) quarantine(mount.id, `${total} handler faults; last: ${String(error?.message ?? error).slice(0, 120)}`)
  }

  /** Compiles a stored adaptation and binds it to a session. Returns the mount, or undefined when it may not run. */
  function attach(session, adaptation, { fromStart = false } = {}) {
    if (session.mounts.has(adaptation.id)) return session.mounts.get(adaptation.id).mount
    let mount
    try {
      mount = createMount({
        record: adaptation,
        source: library.readSource(adaptation.id),
        env: envOf(session),
        exec: host.exec ? request => host.exec(session, request, session.signal) : undefined,
        handlerTimeoutMs: config.handlerTimeoutMs,
        onEffect: (owner, seam, effect) => record({ type: 'effect', adaptationId: owner.id, version: owner.version, sessionId: session.sessionId, seam, effect: effect.type }),
        onFault: (owner, seam, error) => onFault(session, owner, seam, error),
      })
    } catch (error) {
      record({ type: 'fault', adaptationId: adaptation.id, version: adaptation.version, sessionId: session.sessionId, seam: 'load', message: String(error?.message ?? error).slice(0, 300) })
      quarantine(adaptation.id, `failed to load: ${String(error?.message ?? error).slice(0, 160)}`)
      return undefined
    }
    // The stored source is what runs. If it claims more than its record was accepted with, it does not run.
    const undeclared = mount.meta.capabilities.filter(name => !(adaptation.capabilities ?? []).includes(name))
    if (undeclared.length > 0) {
      quarantine(adaptation.id, `source uses capabilities its record was not accepted with: ${undeclared.join(', ')}`)
      return undefined
    }
    if (needingApproval(mount.meta.capabilities, config.autonomy).length > 0 && !adaptation.approval) {
      setStatus(adaptation.id, 'proposed', 'needs approval for its capabilities', 'hold')
      return undefined
    }
    let dispose
    try {
      dispose = host.contribute?.(session, mount)
    } catch (error) {
      onFault(session, mount, 'contribute', error)
      return undefined
    }
    session.mounts.set(adaptation.id, { mount, dispose, fromStart })
    record({ type: 'mount', adaptationId: adaptation.id, version: adaptation.version, sessionId: session.sessionId, cwd: session.cwd })
    return mount
  }

  function announce(session, mount, finding, detail) {
    if (!config.announce) return
    // The host assembles a request's tools before the step boundary runs, so a new tool is first callable one
    // request later. The notice waits for it instead of naming a tool that is not there yet.
    const structural = mount.tools.length > 0
    session.notices.push({
      mountId: mount.id,
      due: session.steps + (structural ? 1 : 0),
      text: mount.mark(`The harness adapted itself after noticing that ${finding.summary}. ${detail ?? mount.meta.description}`),
    })
  }

  /** Weighs findings and queues the ones worth acting on. `phase` is where in the turn they were seen. */
  function consider(session, findings, phase) {
    const best = new Map()
    for (const finding of findings) {
      const held = best.get(finding.signature)
      if (!held || finding.severity > held.severity) best.set(finding.signature, finding)
    }
    for (const finding of best.values()) {
      const { signature } = finding
      const same = records.filter(entry => entry.friction?.signature === signature)
      const mounted = same.find(entry => session.mounts.has(entry.id))
      // At the stop boundary a mounted adaptation is about to answer; what the turn finally ends with is what counts.
      if (phase === 'stop' && mounted) continue

      const priors = priorSessions(entries, signature, session.sessionId)
      // Worth acting on: by its own weight, or because earlier sessions already met this cause.
      const actionable = Math.min(1, finding.severity + Math.min(policy.maxPriorBoost, policy.priorBoost * priors)) >= policy.threshold
      if (actionable || !session.seen.has(signature)) {
        record({
          type: 'friction', sessionId: session.sessionId, cwd: session.cwd, signature, kind: finding.kind, detector: finding.detector,
          severity: finding.severity, count: finding.count, actionable, summary: finding.summary, turn: finding.turn,
        })
      }
      session.seen.add(signature)
      if (!config.layers.includes(layerOf(finding.kind))) continue

      const context = {
        priorSessions: priors,
        sessionAdaptations: session.created,
        attempts: session.attempts.get(signature) ?? 0,
        stepsSinceAdaptation: session.adaptedAtStep === undefined ? undefined : session.steps - session.adaptedAtStep,
      }
      if (mounted) {
        const since = mounted.installedAt ?? mounted.createdAt
        // Only a session that had the adaptation mounted can show that it did not hold. Sessions that were already
        // running when it was written keep meeting the cause without it.
        const mountedAt = new Map()
        for (const entry of entries) {
          if (entry.type === 'mount' && entry.adaptationId === mounted.id && !mountedAt.has(entry.sessionId)) mountedAt.set(entry.sessionId, entry.time)
        }
        context.covering = {
          id: mounted.id,
          sinceMount: entries.filter(entry => entry.type === 'friction' && entry.signature === signature && entry.actionable
            && entry.time > since && mountedAt.has(entry.sessionId) && entry.time >= mountedAt.get(entry.sessionId)).length,
        }
      } else {
        const inScope = same.filter(entry => scopeCovers(entry.scope, session.cwd))
        // The user's decision on this cause stands: waiting for approval, switched off, or retired.
        if (inScope.some(entry => ['proposed', 'disabled', 'retired'].includes(entry.status))) continue
        if (inScope.filter(entry => entry.status === 'quarantined').length >= 2) continue
      }
      const decision = decide(finding, context, policy)
      if (!decision.act) continue
      if (phase === 'turn-end' && decision.when === 'stop') continue
      session.pending.set(signature, { finding: { ...finding, priorSessions: context.priorSessions }, decision, covering: context.covering })
    }
  }

  async function adaptPending(session, boundary, signal) {
    const due = [...session.pending.values()]
      .filter(item => boundary === 'stop' || item.decision.when === 'step')
      .sort((a, b) => b.decision.severity - a.decision.severity)
    let toolAdaptations = 0
    for (const item of due) {
      session.pending.delete(item.finding.signature)
      if (session.closed) return
      const fromUser = FROM_USER.has(item.finding.kind)
      // One burst of tool trouble has one root cause more often than several: answer the worst, let the rest re-fire.
      if (!fromUser && toolAdaptations >= 1) continue
      if (item.decision.mode === 'create' && session.created >= policy.maxPerSession) continue
      try {
        if (await adapt(session, item, signal) && !fromUser) toolAdaptations += 1
      } catch (error) {
        audit({ type: 'error', sessionId: session.sessionId, signature: item.finding.signature, message: String(error?.message ?? error).slice(0, 300) })
        log('warn', `adapting to ${item.finding.signature} failed: ${error?.message ?? error}`)
      }
    }
  }

  /** @returns {Promise<boolean>} whether the harness changed. */
  async function adapt(session, { finding, decision, covering }, signal) {
    const { signature } = finding
    session.attempts.set(signature, (session.attempts.get(signature) ?? 0) + 1)
    audit({
      type: 'trigger', sessionId: session.sessionId, cwd: session.cwd, signature, kind: finding.kind, detector: finding.detector,
      severity: decision.severity, mode: decision.mode, reason: decision.reason, summary: finding.summary,
    })
    if (session.mode === 'observe') return false

    if (decision.mode === 'create') {
      // A session in another process may have answered this cause while this one was running.
      reload()
      const installed = records.filter(entry => entry.friction?.signature === signature && MOUNTED.includes(entry.status) && layerOn(entry))
      const here = installed.find(entry => scopeCovers(entry.scope, session.cwd))
      if (here) {
        // Stored by another session since this one started.
        const mount = attach(session, here)
        if (mount) announce(session, mount, finding)
        return mount !== undefined
      }
      const elsewhere = installed[0]
      const workspaces = new Set([...workspacesHit(entries, signature), session.cwd])
      if (elsewhere && workspaces.size >= policy.generalizeAfter) {
        // Met in a second workspace: this is about the machine or the user, not one project.
        const widened = library.setScope(elsewhere.id, { kind: 'global' })
        audit({ type: 'generalize', adaptationId: elsewhere.id, sessionId: session.sessionId, workspaces: [...workspaces] })
        refresh()
        const mount = attach(session, widened)
        if (mount) announce(session, mount, finding, `${mount.meta.description} It was learned in another workspace and now applies everywhere on this machine.`)
        session.adaptedAtStep = session.steps
        return mount !== undefined
      }
    }

    const previous = decision.mode === 'revise' && covering
      ? { source: library.readSource(covering.id), recurrences: covering.sinceMount }
      : undefined
    const result = await generateAdaptation({
      finding,
      history: session.history,
      previous,
      complete: host.complete && config.generator !== 'synth' ? request => host.complete(session, request, signal) : undefined,
      strategy: config.generator,
      maxRepairs: config.maxRepairs,
      autonomy: config.autonomy,
      env: envOf(session),
    })
    audit({ type: 'generation', sessionId: session.sessionId, signature, mode: decision.mode, ok: result.ok, generator: result.generator, attempts: result.attempts })
    if (!result.ok || session.closed) return false

    const { meta, report, needsApproval } = result.validation
    const held = needsApproval.length > 0 || session.mode === 'propose'
    const layer = layerOf(finding.kind)
    const fields = {
      title: meta.title, description: meta.description, capabilities: meta.capabilities, tier: report.tier,
      status: held ? 'proposed' : 'candidate', validation: report,
      approval: !held && report.tier === 'power' ? { at: Date.now(), by: 'autonomy', capabilities: meta.capabilities } : undefined,
    }
    let stored
    if (decision.mode === 'revise') {
      stored = library.revise(covering.id, {
        ...fields,
        revision: { at: Date.now(), sessionId: session.sessionId, reason: decision.reason, generator: result.generator },
      }, result.source)
    } else {
      stored = library.create({
        ...fields,
        layer,
        // What a person wants holds wherever they work; everything else starts where it was learned.
        scope: config.scope === 'global' || layer === 'user' ? { kind: 'global' } : { kind: 'workspace', cwd: session.cwd },
        friction: { signature, kind: finding.kind, detector: finding.detector, summary: finding.summary },
        origin: {
          sessionId: session.sessionId, cwd: session.cwd, turn: finding.turn, step: finding.step, generator: result.generator,
          severity: decision.severity, priorSessions: finding.priorSessions ?? 0, evidence: finding.evidence,
        },
      }, result.source)
      session.created += 1
    }
    refresh()
    audit({
      type: decision.mode, adaptationId: stored.id, version: stored.version, status: stored.status, sessionId: session.sessionId,
      signature, generator: result.generator, capabilities: meta.capabilities, needsApproval,
    })
    session.adaptedAtStep = session.steps

    // Every live session drops the superseded version; the ones it covers take the new one.
    const holders = decision.mode === 'revise' ? [...sessions].filter(other => other.mounts.has(stored.id)) : []
    for (const other of holders) detach(other, stored.id)
    if (held) {
      log('info', `adaptation ${stored.id} "${stored.title}" is waiting for approval (${needsApproval.join(', ') || 'propose mode'})`)
      return false
    }
    for (const other of holders) if (other !== session) attach(other, stored)
    const mount = attach(session, stored)
    if (!mount) return false
    const rehearsed = report.stages.find(stage => stage.stage === 'rehearsal')?.effects?.[0]?.text
    announce(session, mount, finding, rehearsed)
    return true
  }

  function settle(session) {
    for (const [id, { mount, fromStart }] of session.mounts) {
      const current = records.find(entry => entry.id === id)
      // A prompt section acts by being there, which only counts for a turn it was there from the start of.
      const acted = mount.fires > 0 || (fromStart && mount.sections.length > 0)
      if (current?.status === 'candidate' && acted && mount.faults === 0) {
        setStatus(id, 'active', 'acted in a live session without faults', 'promote')
      }
    }
    // The stop boundary of this turn has passed.
    for (const [signature, item] of session.pending) if (item.decision.when === 'stop') session.pending.delete(signature)
  }

  /** Keeps the per-session view of the run that handlers and validation read. */
  function track(session, observation) {
    if (observation.kind === 'turn-start') {
      session.turnObservations = []
      session.continuations = 0
      session.turn = observation.turn
    } else if (observation.kind === 'tool') {
      session.history.push(observation)
      if (session.history.length > config.maxHistory) session.history.shift()
      session.turnObservations.push(observation)
    }
  }

  /**
   * Starts adapting one agent session.
   * @param {{ sessionId: string, cwd: string, handle?: unknown, replay?: object[] }} input `handle` is passed back to the host untouched;
   *   `replay` is the events a resumed session already holds.
   */
  function open(input) {
    refresh()
    const project = syncProject(input.cwd)
    const settings = sessionSettings(project)
    maintain()
    const session = {
      sessionId: input.sessionId, cwd: input.cwd, handle: input.handle,
      mode: settings.mode,
      project: project ? { root: project.root, waiting: project.waiting } : undefined,
      normalizer: createNormalizer({ sessionId: input.sessionId, cwd: input.cwd }),
      observer: createObserver(settings.signals, settings.disabledDetectors),
      history: [], turnObservations: [],
      pending: new Map(), notices: [], mounts: new Map(),
      seen: new Set(), attempts: new Map(),
      created: 0, adaptedAtStep: undefined, steps: 0,
      continuations: 0, turn: 0, step: 0, seq: 0, signal: undefined, closed: false,
    }
    for (const event of input.replay ?? []) {
      try {
        if (typeof event.seq === 'number') session.seq = event.seq
        for (const observation of session.normalizer.push(event)) {
          track(session, observation)
          for (const finding of session.observer.observe(observation)) session.seen.add(finding.signature)
        }
      } catch (error) {
        log('warn', `could not replay event ${event?.seq}: ${error?.message ?? error}`)
      }
    }
    record({ type: 'session', sessionId: session.sessionId, cwd: session.cwd })
    for (const adaptation of records.filter(entry => MOUNTED.includes(entry.status) && scopeCovers(entry.scope, session.cwd) && layerOn(entry))) attach(session, adaptation, { fromStart: true })
    sessions.add(session)

    return {
      sessionId: session.sessionId,
      cwd: session.cwd,
      handle: session.handle,
      /** Mounted adaptations, for inspection. */
      mounted: () => [...session.mounts.values()].map(entry => entry.mount),
      /** The project harness this session runs under, and which of its files this machine has not accepted. */
      project: session.project,
      mode: session.mode,

      /** Feeds one session event. Synchronous and never throws: observing must not disturb the run. */
      event(event) {
        if (session.closed) return
        try {
          if (typeof event.seq === 'number') session.seq = event.seq
          for (const observation of session.normalizer.push(event)) {
            track(session, observation)
            const findings = session.observer.observe(observation)
            consider(session, findings, observation.kind === 'turn-end' ? 'turn-end' : 'live')
            if (observation.kind === 'turn-end') settle(session)
          }
        } catch (error) {
          log('warn', `observation failed: ${error?.message ?? error}`)
        }
      },

      /**
       * Before a tool call runs.
       * @returns {Promise<{ deny?: string, ask?: string }>} marked texts.
       */
      async beforeTool(call, signal) {
        if (signal) session.signal = signal
        const verdict = {}
        for (const { mount } of [...session.mounts.values()]) {
          for (const effect of await mount.pre(call)) {
            if (effect.type === 'deny') verdict.deny ??= mount.mark(effect.text)
            else if (effect.type === 'ask') verdict.ask ??= mount.mark(effect.text)
          }
        }
        return verdict
      },

      /**
       * After a tool call returned.
       * @returns {Promise<{ notes: string[], block?: string, replace?: string }>}
       */
      async afterTool(call, result, signal) {
        if (signal) session.signal = signal
        const outcome = { notes: [] }
        for (const { mount } of [...session.mounts.values()]) {
          for (const effect of await mount.post(call, result)) {
            if (effect.type === 'annotate') outcome.notes.push(mount.mark(effect.text))
            else if (effect.type === 'block') outcome.block ??= mount.mark(effect.text)
            else if (effect.type === 'replace') outcome.replace ??= effect.text
          }
        }
        return outcome
      },

      /**
       * Before a model request. Adapts to what was found since the last one.
       * @returns {Promise<string[]>} marked notes to show the model with this request.
       */
      async beforeStep(at) {
        session.turn = at.turn
        session.step = at.step
        session.steps += 1
        if (at.signal) session.signal = at.signal
        await adaptPending(session, 'step', at.signal)
        const notes = session.notices.filter(entry => entry.due <= session.steps).map(entry => entry.text)
        session.notices = session.notices.filter(entry => entry.due > session.steps)
        const state = { turn: at.turn, step: at.step, recent: session.history.slice(-8).map(callSummary) }
        for (const { mount } of [...session.mounts.values()]) {
          if (!mount.has('beforeStep')) continue
          for (const effect of await mount.step(state)) notes.push(mount.mark(effect.text))
        }
        return notes
      },

      /** Returns notes the host could not deliver. */
      requeue(notes) {
        session.notices.unshift(...notes.map(text => ({ text, due: 0 })))
      },

      /**
       * When the model wants to end the turn.
       * @returns {Promise<string | undefined>} marked text that keeps the turn open, if any.
       */
      async beforeStop(at) {
        if (at.signal) session.signal = at.signal
        consider(session, session.observer.probeStop({ turn: at.turn, step: session.step, seq: session.seq }), 'stop')
        await adaptPending(session, 'stop', at.signal)
        if (session.continuations >= policy.maxContinuations) return undefined
        const view = turnView(session.turnObservations)
        for (const { mount } of [...session.mounts.values()]) {
          if (!mount.has('beforeStop')) continue
          const effect = (await mount.stop(view)).find(entry => entry.type === 'continue')
          if (effect) {
            session.continuations += 1
            // What this adaptation has to say is being said right now; its installation notice would repeat it.
            session.notices = session.notices.filter(entry => entry.mountId !== mount.id)
            return mount.mark(effect.text)
          }
        }
        return undefined
      },

      close() {
        if (session.closed) return
        session.closed = true
        for (const id of [...session.mounts.keys()]) detach(session, id)
        sessions.delete(session)
      },
    }
  }

  return {
    config,
    policy,
    open,
    /** Withdraws every mount; used when the plugin itself is unloaded. */
    dispose() {
      for (const session of [...sessions]) {
        session.closed = true
        for (const id of [...session.mounts.keys()]) detach(session, id)
        sessions.delete(session)
      }
    },
  }
}
