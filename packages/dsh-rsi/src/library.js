// The personal adaptation library: what this harness has learned about its
// user and machine, kept on disk under the harness home.
//
//   adaptations/<id>/adaptation.json     identity, status, scope, origin; `version` is the one in use
//   adaptations/<id>/source.js           source of the version in use
//   adaptations/<id>/versions/<n>.js     every version ever stored; a number is never given out twice
//   adaptations/<id>/versions/<n>.json   what that version was accepted as (title, capabilities, validation)
//   ledger.jsonl                         friction, mounts, effects, faults (append-only)
//   audit.jsonl                          every decision the system took (append-only)
//   timeline.jsonl                       every change to what the harness runs, and the whole state it left (append-only)
//   switch.json                          present while the user has set the harness back to stock
//   trust.json                           project harness files this machine has accepted, by content hash
//
// Counters are folded from the ledger instead of rewritten in place, so
// several harness processes can share one library without losing updates.
//
// Nothing here is ever deleted. Going back is a matter of pointing at an
// earlier version or an earlier state, which is why it can itself be undone.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const STATUSES = ['candidate', 'active', 'proposed', 'quarantined', 'retired', 'disabled']
/** Statuses that are mounted into matching sessions. */
export const MOUNTED = ['candidate', 'active']

/** What a version is stored as beside its source: another version may declare other capabilities. */
const VERSION_FIELDS = ['title', 'description', 'capabilities', 'tier', 'validation', 'approval']

const scopeKey = scope => (scope?.kind === 'workspace' ? scope.cwd : null)
/** The part of a record that decides whether, as what and where it runs. */
const brief = record => (record ? { version: record.version, status: record.status, scope: record.scope ?? { kind: 'global' } } : undefined)
/** The same as one comparable value; undefined while it does not run at all. */
export const running = state => (state && MOUNTED.includes(state.status) ? `${state.version}@${scopeKey(state.scope) ?? '*'}` : undefined)

function readJsonLines(file) {
  if (!fs.existsSync(file)) return []
  const out = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // A torn final line from a crashed writer is skipped; earlier lines stay valid.
    }
  }
  return out
}

function writeAtomic(file, text) {
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(temporary, text)
  fs.renameSync(temporary, file)
}

/** A directory as the file system names it, so that a path reached through a link compares equal to itself. */
export function canon(dir) {
  try {
    return fs.realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

export function isInside(child, parent) {
  if (!child || !parent) return false
  const relative = path.relative(canon(parent), canon(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Whether an adaptation's scope covers a session working directory. */
export function scopeCovers(scope, cwd) {
  if (!scope || scope.kind === 'global') return true
  return isInside(cwd, scope.cwd)
}

/**
 * Opens (creating if needed) the library rooted at `home`.
 * @param {string} home absolute directory.
 * @param {object} [options]
 * @param {() => number} [options.now]
 * @param {(source: string) => object | undefined} [options.describe] reads title, capabilities and tier out of a source;
 *   used for versions stored before those were kept beside each version.
 */
export function openLibrary(home, options = {}) {
  const now = options.now ?? Date.now
  const adaptationsDir = path.join(home, 'adaptations')
  const ledgerFile = path.join(home, 'ledger.jsonl')
  const auditFile = path.join(home, 'audit.jsonl')
  const timelineFile = path.join(home, 'timeline.jsonl')
  const switchFile = path.join(home, 'switch.json')
  const trustFile = path.join(home, 'trust.json')
  fs.mkdirSync(adaptationsDir, { recursive: true })

  const recordFile = id => path.join(adaptationsDir, id, 'adaptation.json')
  const sourceFile = id => path.join(adaptationsDir, id, 'source.js')
  const versionSource = (id, version) => path.join(adaptationsDir, id, 'versions', `${version}.js`)
  const versionFields = (id, version) => path.join(adaptationsDir, id, 'versions', `${version}.json`)

  function get(id) {
    const file = recordFile(id)
    if (!fs.existsSync(file)) return undefined
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      // A record that cannot be read is treated as absent: it does not run. Its files stay for a person to look at.
      return undefined
    }
  }

  function must(id) {
    const record = get(id)
    if (!record) throw new Error(`no adaptation ${id}`)
    return record
  }

  const store = (record) => { writeAtomic(recordFile(record.id), `${JSON.stringify(record, null, 2)}\n`); return record }

  /** Version numbers of an adaptation that can be pointed at, oldest first. */
  function versions(id) {
    const held = new Set()
    try {
      for (const name of fs.readdirSync(path.join(adaptationsDir, id, 'versions'))) if (/^\d+\.js$/.test(name)) held.add(Number(name.slice(0, -3)))
    } catch {
      // no versions directory yet
    }
    const record = get(id)
    if (record) held.add(record.version)
    return [...held].sort((a, b) => a - b)
  }

  /** Puts the version in use where no later change can overwrite it. */
  function keep(record, source) {
    fs.mkdirSync(path.join(adaptationsDir, record.id, 'versions'), { recursive: true })
    if (!fs.existsSync(versionSource(record.id, record.version))) fs.writeFileSync(versionSource(record.id, record.version), source)
    if (!fs.existsSync(versionFields(record.id, record.version))) {
      writeAtomic(versionFields(record.id, record.version), `${JSON.stringify(Object.fromEntries(VERSION_FIELDS.map(key => [key, record[key]])), null, 2)}\n`)
    }
  }

  /** The record as it reads once another stored version is the one in use. Writes the source, not the record. */
  function point(record, version) {
    keep(record, fs.readFileSync(sourceFile(record.id), 'utf8'))
    if (!fs.existsSync(versionSource(record.id, version))) throw new Error(`adaptation ${record.id} has no version ${version}`)
    const source = fs.readFileSync(versionSource(record.id, version), 'utf8')
    let fields
    try {
      fields = JSON.parse(fs.readFileSync(versionFields(record.id, version), 'utf8'))
    } catch {
      fields = options.describe?.(source)
    }
    writeAtomic(sourceFile(record.id), source)
    return {
      ...record, ...fields, version, latest: Math.max(record.latest ?? 0, record.version, version),
      rolledBackFrom: version < record.version ? record.version : undefined, installedAt: now(), updatedAt: now(),
    }
  }

  function list(filter = {}) {
    const records = []
    for (const id of fs.readdirSync(adaptationsDir)) {
      const record = get(id)
      if (!record) continue
      if (filter.status && ![].concat(filter.status).includes(record.status)) continue
      if (filter.cwd && !scopeCovers(record.scope, filter.cwd)) continue
      if (filter.signature && record.friction?.signature !== filter.signature) continue
      records.push(record)
    }
    return records.sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Source of the version in use, or of any stored version. */
  function readSource(id, version) {
    return fs.readFileSync(version === undefined || version === get(id)?.version ? sourceFile(id) : versionSource(id, version), 'utf8')
  }

  /** Stores a new adaptation and returns its record. */
  function create(input, source, meta) {
    baseline()
    const id = `a-${now().toString(36)}-${randomBytes(3).toString('hex')}`
    const record = {
      id, version: 1, title: input.title, description: input.description, capabilities: input.capabilities, tier: input.tier,
      status: input.status, scope: input.scope, friction: input.friction, origin: input.origin, validation: input.validation,
      approval: input.approval, layer: input.layer, project: input.project, createdAt: now(), installedAt: now(), updatedAt: now(),
    }
    fs.mkdirSync(path.join(adaptationsDir, id, 'versions'), { recursive: true })
    fs.writeFileSync(sourceFile(id), source)
    store(record)
    keep(record, source)
    stamp('create', undefined, record, meta)
    return record
  }

  /** Replaces an adaptation's source. Every earlier version stays on disk under its own number. */
  function revise(id, input, source, meta) {
    baseline()
    const record = must(id)
    keep(record, fs.readFileSync(sourceFile(id), 'utf8'))
    // Never a number that was used before, so "version 3" means one source for good, also after going back to 2.
    const version = Math.max(record.latest ?? 0, ...versions(id)) + 1
    writeAtomic(sourceFile(id), source)
    const next = store({
      ...record, version, latest: version, rolledBackFrom: undefined, title: input.title, description: input.description, capabilities: input.capabilities, tier: input.tier,
      status: input.status ?? record.status, validation: input.validation, approval: input.approval, installedAt: now(),
      origin: { ...record.origin, revisions: [...(record.origin?.revisions ?? []), { version, ...input.revision }] },
      updatedAt: now(),
    })
    keep(next, source)
    stamp('revise', record, next, meta)
    return next
  }

  /**
   * Makes an earlier version of an adaptation the one in use again: the newest one below the current that was not
   * withdrawn for doing harm, or exactly `to`. The version left behind stays on disk and can be pointed at again.
   */
  function rollback(id, to, meta) {
    baseline()
    const record = must(id)
    const held = versions(id)
    let target = to
    if (target === undefined) {
      const withdrawn = (record.withdrawn ?? []).map(entry => entry.version)
      target = held.filter(version => version < record.version && !withdrawn.includes(version)).at(-1)
      if (target === undefined) throw new Error(`adaptation ${id} has no earlier version`)
    } else if (target === record.version) throw new Error(`adaptation ${id} is already at version ${target}`)
    else if (!held.includes(target)) throw new Error(`adaptation ${id} has no version ${target}; it has ${held.join(', ')}`)
    const next = store(point(record, target))
    stamp('rollback', record, next, meta)
    return next
  }

  function setStatus(id, status, reason, meta) {
    if (!STATUSES.includes(status)) throw new Error(`unknown status ${status}`)
    baseline()
    const record = must(id)
    const next = store({ ...record, status, statusReason: reason, updatedAt: now() })
    stamp('status', record, next, { reason, ...meta })
    return next
  }

  /** Records the user's consent to an adaptation that was waiting for it, and lets it mount. */
  function approve(id, meta) {
    baseline()
    const record = must(id)
    if (record.status !== 'proposed') throw new Error(`adaptation ${id} is ${record.status}, not proposed`)
    const next = store({ ...record, status: 'candidate', statusReason: 'approved by the user', approval: { at: now(), by: 'user', capabilities: record.capabilities }, installedAt: now(), updatedAt: now() })
    stamp('approve', record, next, { by: 'user', ...meta })
    return next
  }

  function setScope(id, scope, meta) {
    baseline()
    const record = must(id)
    const next = store({ ...record, scope, updatedAt: now() })
    stamp('scope', record, next, meta)
    return next
  }

  /** Merges fields into a record. */
  function update(id, patch, meta) {
    baseline()
    const record = must(id)
    const next = store({ ...record, ...patch, updatedAt: now() })
    // Bookkeeping that leaves version, status and scope alone is not a change to the harness.
    if (JSON.stringify(brief(record)) !== JSON.stringify(brief(next))) stamp('update', record, next, { reason: next.statusReason, ...meta })
    return next
  }

  // ---------- the timeline: every change to what the harness runs, and how to go back ----------

  /** Version, status and scope of every adaptation right now. */
  function snapshot() {
    const state = {}
    for (const record of list()) state[record.id] = [record.version, record.status, scopeKey(record.scope)]
    return state
  }

  /** A library that was in use before it kept a timeline starts it with what it holds, so that there is a state to go back to. */
  function baseline() {
    if (fs.existsSync(timelineFile) || list().length === 0) return
    append(timelineFile, { key: randomBytes(4).toString('hex'), change: 'baseline', by: 'harness', reason: 'what the library held when its timeline began', state: snapshot() })
  }

  /**
   * Adds one change to the timeline, together with the whole state it left behind.
   * @param {{ change?: string, by?: 'harness' | 'user' | 'project', sessionId?: string, reason?: string, extra?: object }} [meta]
   */
  function stamp(change, before, after, meta = {}) {
    const subject = after ?? before
    return append(timelineFile, {
      key: randomBytes(4).toString('hex'), change: meta.change ?? change, adaptationId: subject?.id, title: subject?.title,
      by: meta.by ?? 'harness', sessionId: meta.sessionId, reason: meta.reason, before: brief(before), after: brief(after),
      ...meta.extra, state: snapshot(),
    })
  }

  /** The timeline, oldest first. A generation is a position in it; generation 0 is the harness before it learned anything. */
  const timeline = () => readJsonLines(timelineFile).map((entry, index) => ({ generation: index + 1, ...entry }))

  /**
   * Puts every adaptation back to the version, status and scope it had at a generation. What was learned later is
   * switched off, not deleted, and restoring is itself a generation, so it can be taken back the same way.
   * @returns {{ generation: number, to: number, changes: { id: string, title: string, before: object, after: object }[] }}
   */
  function restore(generation, meta = {}) {
    baseline()
    const entries = readJsonLines(timelineFile)
    if (!Number.isInteger(generation) || generation < 0 || generation > entries.length) {
      throw new Error(`no generation ${generation}: the timeline runs from 0 (nothing learned yet) to ${entries.length}`)
    }
    const wanted = generation === 0 ? {} : entries[generation - 1].state ?? {}
    const records = list()
    for (const record of records) {
      const version = wanted[record.id]?.[0]
      if (version !== undefined && version !== record.version && !fs.existsSync(versionSource(record.id, version))) {
        throw new Error(`cannot go back to generation ${generation}: version ${version} of adaptation ${record.id} is no longer on disk`)
      }
    }
    const changes = []
    for (const record of records) {
      const want = wanted[record.id]
      let next = record
      if (want === undefined) {
        if (!['disabled', 'retired'].includes(record.status)) next = { ...record, status: 'disabled', statusReason: `not yet learned at generation ${generation}` }
      } else {
        const [version, status, cwd] = want
        if (version !== record.version) next = point(next, version)
        if (scopeKey(next.scope) !== cwd) next = { ...next, scope: cwd === null ? { kind: 'global' } : { kind: 'workspace', cwd } }
        if (status !== next.status) next = { ...next, status, statusReason: `as at generation ${generation}` }
      }
      if (next === record) continue
      store({ ...next, updatedAt: now() })
      changes.push({ id: record.id, title: next.title, before: brief(record), after: brief(next) })
    }
    // Nothing differed: there is no step to record, and none to take back.
    if (changes.length === 0) return { generation: entries.length, to: generation, changes }
    append(timelineFile, {
      key: randomBytes(4).toString('hex'), change: meta.change ?? 'restore', to: generation, by: meta.by ?? 'user', sessionId: meta.sessionId,
      reason: meta.reason, changed: changes.length, ...meta.extra, state: snapshot(),
    })
    return { generation: entries.length + 1, to: generation, changes }
  }

  /**
   * Takes back the most recent change that put something new to work: an adaptation that was written, revised,
   * widened, approved or switched back on, or a restore that was the very last thing done. Changes that only took
   * something out of use are not undone by this; `restore` and `enable` bring those back.
   * @returns {{ undoes: number, change: string, title?: string, record?: object, restored?: object } | undefined} `title` is what the undone
   *   change had put to work; undefined when there is nothing to undo.
   */
  function undo(meta = {}) {
    const entries = readJsonLines(timelineFile)
    const undone = new Set(entries.filter(entry => entry.change === 'undo').map(entry => entry.undoes))
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      if (entry.change === 'undo' || entry.change === 'baseline' || undone.has(entry.key)) continue
      if (entry.change === 'restore') {
        // A restore replaced the whole state; putting the earlier one back is only right while nothing came after.
        if (index !== entries.length - 1) continue
        const restored = restore(index, { ...meta, change: 'undo', reason: `undo of generation ${index + 1}`, extra: { undoes: entry.key } })
        return { undoes: index + 1, change: 'restore', restored }
      }
      if (!entry.adaptationId || running(entry.after) === undefined || running(entry.after) === running(entry.before)) continue
      const record = get(entry.adaptationId)
      // Something else has changed it since; what that entry put to work is not what runs now.
      if (!record || running(brief(record)) !== running(entry.after)) continue
      const reason = `undo of generation ${index + 1}`
      let next
      if (entry.before && MOUNTED.includes(entry.before.status)) {
        // It ran before, as another version or in another scope: that comes back.
        next = entry.before.version !== record.version ? point(record, entry.before.version) : record
        next = { ...next, scope: entry.before.scope, status: entry.before.status, statusReason: reason, updatedAt: now() }
      } else {
        next = { ...record, status: entry.before?.status ?? 'disabled', statusReason: reason, updatedAt: now() }
      }
      store(next)
      stamp('undo', record, next, { by: 'user', ...meta, reason, extra: { undoes: entry.key } })
      return { undoes: index + 1, change: entry.change, title: entry.title ?? record.title, record: next }
    }
    return undefined
  }

  /** Whether the user has set the harness back to stock: nothing mounted, nothing written, until switched on again. */
  function stock() {
    try {
      const stored = JSON.parse(fs.readFileSync(switchFile, 'utf8'))
      return stored?.off === true ? stored : undefined
    } catch {
      return undefined
    }
  }

  /** Sets the harness back to stock, or ends that. No adaptation is changed by either. */
  function setStock(off, meta = {}) {
    if (off === (stock() !== undefined)) return false
    if (off) writeAtomic(switchFile, `${JSON.stringify({ off: true, time: now(), by: meta.by ?? 'user', reason: meta.reason })}\n`)
    else fs.rmSync(switchFile, { force: true })
    append(timelineFile, { key: randomBytes(4).toString('hex'), change: off ? 'off' : 'on', by: meta.by ?? 'user', sessionId: meta.sessionId, reason: meta.reason, state: snapshot() })
    return true
  }

  /** A value that changes whenever what the harness should run changed, in this process or another. Cheap enough to ask before every model request. */
  function pulse() {
    return [timelineFile, switchFile].map((file) => {
      try {
        const stat = fs.statSync(file)
        return `${stat.size}:${stat.mtimeMs}`
      } catch {
        return '-'
      }
    }).join(';')
  }

  function readTrust() {
    try {
      const stored = JSON.parse(fs.readFileSync(trustFile, 'utf8'))
      return stored !== null && typeof stored === 'object' ? stored : {}
    } catch {
      return {}
    }
  }

  /** Whether this machine accepted exactly this content of a project harness file. */
  function trusted(root, entry, hash) {
    return readTrust()[canon(root)]?.[entry] === hash
  }

  function trust(root, entry, hash) {
    const all = readTrust()
    const key = canon(root)
    all[key] = { ...all[key], [entry]: hash }
    writeAtomic(trustFile, `${JSON.stringify(all, null, 2)}\n`)
  }

  /** Withdraws acceptance of one file, or of the whole project harness. */
  function untrust(root, entry) {
    const all = readTrust()
    const key = canon(root)
    if (entry === undefined) delete all[key]
    else if (all[key]) delete all[key][entry]
    writeAtomic(trustFile, `${JSON.stringify(all, null, 2)}\n`)
  }

  function append(file, entry) {
    const stored = { time: now(), ...entry }
    fs.appendFileSync(file, `${JSON.stringify(stored)}\n`)
    return stored
  }

  /**
   * Counters for one adaptation, folded from the ledger.
   * With `version`, faults of other versions are left out: a revision starts clean.
   */
  function statsOf(id, ledger = readJsonLines(ledgerFile), version = undefined) {
    const stats = { mounts: 0, fires: 0, faults: 0, effects: {}, sessions: new Set(), lastFiredAt: undefined }
    for (const entry of ledger) {
      if (entry.adaptationId !== id) continue
      if (entry.type === 'mount') { stats.mounts += 1; stats.sessions.add(entry.sessionId) }
      else if (entry.type === 'effect') {
        stats.fires += 1
        stats.effects[entry.effect] = (stats.effects[entry.effect] ?? 0) + 1
        stats.lastFiredAt = entry.time
      } else if (entry.type === 'fault' && (version === undefined || entry.version === undefined || entry.version === version)) stats.faults += 1
    }
    return { ...stats, sessions: stats.sessions.size }
  }

  return {
    home,
    get, list, readSource, create, revise, rollback, setStatus, setScope, approve, statsOf, update, trusted, trust, untrust,
    versions, timeline, restore, undo, stock, setStock, pulse,
    /** Adaptations to mount for a session in `cwd`. */
    forSession: cwd => list({ status: MOUNTED, cwd }),
    ledger: () => readJsonLines(ledgerFile),
    record: entry => append(ledgerFile, entry),
    audit: entry => append(auditFile, entry),
    auditTrail: () => readJsonLines(auditFile),
  }
}
