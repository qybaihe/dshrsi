// The project harness: the part of the adapted harness that belongs to a
// repository and travels with it.
//
//   <root>/.dsh-rsi/harness.json         format marker and project-level settings
//   <root>/.dsh-rsi/adaptations/<id>.js  one adaptation per file
//
// A file is the whole unit: dropping one in plugs an adaptation in, deleting
// it plugs it out. Each file may start with one comment line that says what
// the adaptation answers:
//
//   // @dsh-rsi {"signature":"...","kind":"user-correction","summary":"..."}
//
// This directory is a way to hand adaptations around, not what runs. What
// runs is always a record in the personal library, created from a file here
// only after this machine has accepted that file's exact content (engine.js).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const PROJECT_DIR = '.dsh-rsi'
export const MANIFEST = 'harness.json'
export const FORMAT = 1

const HEADER = /^\/\/ @dsh-rsi (\{.*\})[ \t]*\r?\n/
const ENTRY_FILE = /^([\w][\w.-]{0,79})\.js$/

const ABOUT = 'Project harness for DeepSeek Harness, maintained by dsh-rsi. The files under adaptations/ are harness code that runs inside agent sessions in this repository once a machine has accepted them (dsh-rsi trust). Review changes to them like any other code.'

const README = `# Project harness

This directory is the part of the DeepSeek Harness that belongs to this repository.
It is maintained by the [dsh-rsi](https://www.npmjs.com/package/dsh-rsi) plugin.

- \`adaptations/*.js\`: one harness adaptation per file. Each one was learned in a
  session here (or written by hand) and tells the harness how work is done in this
  repository: what to refuse, what to check before a turn may end, what to tell the model.
- \`harness.json\`: format marker and project-level settings.

Nothing here runs on a machine until that machine accepts it:

    dsh-rsi project          # what is here, and what this machine has accepted
    dsh-rsi trust            # accept the files as they are now

A file that changes after it was accepted has to be accepted again.
`

const real = (dir) => {
  try {
    return fs.realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

export const hashOf = text => `sha256-${createHash('sha256').update(text).digest('hex')}`

/** The nearest directory at or above `cwd` that carries a project harness. */
export function findProject(cwd) {
  let dir = real(cwd)
  while (dir) {
    if (fs.existsSync(path.join(dir, PROJECT_DIR, MANIFEST))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
  return undefined
}

/** Where a new project harness belongs: the repository root at or above `cwd`, or `cwd` itself. */
export function projectRootFor(cwd) {
  const start = real(cwd)
  let dir = start
  while (dir) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
  return start
}

/** Splits a project file into its header (if any) and the adaptation source proper. */
export function splitHeader(text) {
  const match = HEADER.exec(text)
  if (!match) return { header: undefined, body: text }
  try {
    const header = JSON.parse(match[1])
    return { header: header !== null && typeof header === 'object' ? header : undefined, body: text.slice(match[0].length) }
  } catch {
    return { header: undefined, body: text }
  }
}

function writeManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
}

/** Creates the project harness directory. Existing files are left as they are. */
export function initProject(root) {
  const dir = path.join(real(root), PROJECT_DIR)
  fs.mkdirSync(path.join(dir, 'adaptations'), { recursive: true })
  if (!fs.existsSync(path.join(dir, MANIFEST))) writeManifest(dir, { format: FORMAT, about: ABOUT, settings: {} })
  if (!fs.existsSync(path.join(dir, 'README.md'))) fs.writeFileSync(path.join(dir, 'README.md'), README)
  return dir
}

/**
 * Reads a project harness as it is on disk.
 * @returns {{ root: string, dir: string, settings: object, entries: { id: string, file: string, source: string, hash: string, header?: object }[], problems: string[] }}
 */
export function readProject(root) {
  const dir = path.join(real(root), PROJECT_DIR)
  const state = { root: real(root), dir, settings: {}, entries: [], problems: [] }
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'))
  } catch (error) {
    state.problems.push(`cannot read ${MANIFEST}: ${error.message}`)
    return state
  }
  if (manifest?.format !== FORMAT) {
    state.problems.push(`${MANIFEST} has format ${JSON.stringify(manifest?.format)}; this version of dsh-rsi reads format ${FORMAT}`)
    return state
  }
  if (manifest.settings !== undefined && (manifest.settings === null || typeof manifest.settings !== 'object' || Array.isArray(manifest.settings))) {
    state.problems.push('settings must be an object; ignored')
  } else state.settings = manifest.settings ?? {}

  const folder = path.join(dir, 'adaptations')
  const names = fs.existsSync(folder) ? fs.readdirSync(folder).filter(name => name.endsWith('.js')).sort() : []
  for (const name of names) {
    const match = ENTRY_FILE.exec(name)
    if (!match) {
      state.problems.push(`adaptations/${name}: file names may use letters, digits, dot, dash and underscore only; ignored`)
      continue
    }
    const file = path.join(folder, name)
    const source = fs.readFileSync(file, 'utf8')
    state.entries.push({ id: match[1], file, source, hash: hashOf(source), header: splitHeader(source).header })
  }
  return state
}

function slug(text) {
  const words = String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return words || 'adaptation'
}

/**
 * Writes one adaptation into the project harness.
 * An adaptation that answers the same friction as a file already there replaces that file, so two machines that
 * learn the same thing converge on one entry instead of piling up two.
 * @param {string} root
 * @param {{ record: object, source: string, entryId?: string, now?: number }} input
 * @returns {{ id: string, file: string, hash: string, replaced: boolean }}
 */
export function publishEntry(root, { record, source, entryId, now = Date.now() }) {
  const state = readProject(root)
  if (state.problems.length > 0 && state.entries.length === 0 && !fs.existsSync(path.join(state.dir, MANIFEST))) {
    throw new Error(`no project harness at ${state.root}; run "dsh-rsi project init" there first`)
  }
  const signature = record.friction?.signature
  const existing = state.entries.find(entry => entry.id === entryId)
    ?? (signature ? state.entries.find(entry => entry.header?.signature === signature) : undefined)
  const id = existing?.id ?? entryId ?? `${slug(record.title)}-${createHash('sha256').update(signature ?? record.title ?? '').digest('hex').slice(0, 6)}`
  const header = {
    signature,
    kind: record.friction?.kind,
    summary: record.friction?.summary,
    writtenBy: record.origin?.generator === 'synth' ? 'template' : record.origin?.generator ?? 'hand',
    addedAt: existing?.header?.addedAt ?? new Date(now).toISOString().slice(0, 10),
  }
  const text = `// @dsh-rsi ${JSON.stringify(header)}\n${splitHeader(source).body}`
  fs.mkdirSync(path.join(state.dir, 'adaptations'), { recursive: true })
  const file = path.join(state.dir, 'adaptations', `${id}.js`)
  fs.writeFileSync(file, text)
  return { id, file, hash: hashOf(text), replaced: existing !== undefined }
}

/** Removes one adaptation file from the project harness. Returns whether it was there. */
export function removeEntry(root, id) {
  const file = path.join(real(root), PROJECT_DIR, 'adaptations', `${id}.js`)
  if (!ENTRY_FILE.test(`${id}.js`) || !fs.existsSync(file)) return false
  fs.rmSync(file)
  return true
}

/** Things in a source that will not mean the same on another machine. */
export function portabilityProblems(source, root) {
  const problems = []
  const home = os.homedir()
  if (root && source.includes(real(root))) problems.push('the source contains the absolute path of this checkout; it will not match on another machine')
  else if (home && home !== '/' && source.includes(home)) problems.push('the source contains a path under your home directory; it will not match on another machine')
  return problems
}
