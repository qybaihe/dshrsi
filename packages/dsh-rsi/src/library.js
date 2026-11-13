// The personal adaptation library: what this harness has learned about its
// user and machine, kept on disk under the harness home.
//
//   adaptations/<id>/adaptation.json   identity, status, scope, origin
//   adaptations/<id>/source.js         current source
//   adaptations/<id>/versions/<n>.js   earlier sources
//   ledger.jsonl                       friction, mounts, effects, faults (append-only)
//   audit.jsonl                        every decision the system took (append-only)
//   trust.json                         project harness files this machine has accepted, by content hash
//
// Counters are folded from the ledger instead of rewritten in place, so
// several harness processes can share one library without losing updates.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const STATUSES = ['candidate', 'active', 'proposed', 'quarantined', 'retired', 'disabled']
/** Statuses that are mounted into matching sessions. */
export const MOUNTED = ['candidate', 'active']

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
 * @param {{ now?: () => number }} [options]
 */
export function openLibrary(home, options = {}) {
  const now = options.now ?? Date.now
  const adaptationsDir = path.join(home, 'adaptations')
  const ledgerFile = path.join(home, 'ledger.jsonl')
  const auditFile = path.join(home, 'audit.jsonl')
  const trustFile = path.join(home, 'trust.json')
  fs.mkdirSync(adaptationsDir, { recursive: true })

  const recordFile = id => path.join(adaptationsDir, id, 'adaptation.json')
  const sourceFile = id => path.join(adaptationsDir, id, 'source.js')

  function get(id) {
    const file = recordFile(id)
    if (!fs.existsSync(file)) return undefined
    return JSON.parse(fs.readFileSync(file, 'utf8'))
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

  function readSource(id) {
    return fs.readFileSync(sourceFile(id), 'utf8')
  }

  /** Stores a new adaptation and returns its record. */
  function create(input, source) {
    const id = `a-${now().toString(36)}-${randomBytes(3).toString('hex')}`
    const record = {
      id, version: 1, title: input.title, description: input.description, capabilities: input.capabilities, tier: input.tier,
      status: input.status, scope: input.scope, friction: input.friction, origin: input.origin, validation: input.validation,
      approval: input.approval, layer: input.layer, project: input.project, createdAt: now(), installedAt: now(), updatedAt: now(),
    }
    fs.mkdirSync(path.join(adaptationsDir, id, 'versions'), { recursive: true })
    fs.writeFileSync(sourceFile(id), source)
    writeAtomic(recordFile(id), `${JSON.stringify(record, null, 2)}\n`)
    return record
  }

  /** Replaces an adaptation's source, keeping the earlier version on disk. */
  function revise(id, input, source) {
    const record = get(id)
    if (!record) throw new Error(`no adaptation ${id}`)
    fs.copyFileSync(sourceFile(id), path.join(adaptationsDir, id, 'versions', `${record.version}.js`))
    fs.writeFileSync(sourceFile(id), source)
    const next = {
      ...record, version: record.version + 1, title: input.title, description: input.description, capabilities: input.capabilities, tier: input.tier,
      status: input.status ?? record.status, validation: input.validation, approval: input.approval, installedAt: now(),
      origin: { ...record.origin, revisions: [...(record.origin?.revisions ?? []), { version: record.version + 1, ...input.revision }] },
      updatedAt: now(),
    }
    writeAtomic(recordFile(id), `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  /** Restores the previous source of an adaptation. */
  function rollback(id) {
    const record = get(id)
    if (!record) throw new Error(`no adaptation ${id}`)
    if (record.version <= 1) throw new Error(`adaptation ${id} has no earlier version`)
    const previous = path.join(adaptationsDir, id, 'versions', `${record.version - 1}.js`)
    fs.copyFileSync(sourceFile(id), path.join(adaptationsDir, id, 'versions', `${record.version}.js`))
    fs.copyFileSync(previous, sourceFile(id))
    const next = { ...record, version: record.version - 1, rolledBackFrom: record.version, installedAt: now(), updatedAt: now() }
    writeAtomic(recordFile(id), `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  function setStatus(id, status, reason) {
    if (!STATUSES.includes(status)) throw new Error(`unknown status ${status}`)
    const record = get(id)
    if (!record) throw new Error(`no adaptation ${id}`)
    const next = { ...record, status, statusReason: reason, updatedAt: now() }
    writeAtomic(recordFile(id), `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  /** Records the user's consent to an adaptation that was waiting for it, and lets it mount. */
  function approve(id) {
    const record = get(id)
    if (!record) throw new Error(`no adaptation ${id}`)
    if (record.status !== 'proposed') throw new Error(`adaptation ${id} is ${record.status}, not proposed`)
    const next = { ...record, status: 'candidate', statusReason: 'approved by the user', approval: { at: now(), by: 'user', capabilities: record.capabilities }, installedAt: now(), updatedAt: now() }
    writeAtomic(recordFile(id), `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  function setScope(id, scope) {
    const record = get(id)
    if (!record) throw new Error(`no adaptation ${id}`)
    const next = { ...record, scope, updatedAt: now() }
    writeAtomic(recordFile(id), `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  /** Merges fields into a record. */
  function update(id, patch) {
    const record = get(id)
    if (!record) throw new Error(`no adaptation ${id}`)
    const next = { ...record, ...patch, updatedAt: now() }
    writeAtomic(recordFile(id), `${JSON.stringify(next, null, 2)}\n`)
    return next
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
    /** Adaptations to mount for a session in `cwd`. */
    forSession: cwd => list({ status: MOUNTED, cwd }),
    ledger: () => readJsonLines(ledgerFile),
    record: entry => append(ledgerFile, entry),
    audit: entry => append(auditFile, entry),
    auditTrail: () => readJsonLines(auditFile),
  }
}
