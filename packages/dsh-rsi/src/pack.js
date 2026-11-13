// Packs: adaptations as one file that can be carried to another machine or
// handed to another person.
//
// A pack holds sources and what each one answers. It holds nothing about
// where it was learned: no session ids, no working directories, no recorded
// tool output.
import { LAYERS, layerOf, layerOfRecord } from './layers.js'
import { scopeCovers } from './library.js'
import { hashOf, splitHeader } from './project.js'
import { inspectAdaptation } from './validate.js'

export const PACK_FORMAT = 'dsh-rsi-pack/1'

/**
 * @param {ReturnType<import('./library.js').openLibrary>} library
 * @param {{ ids?: string[], layer?: string, now?: number }} [options] without ids: everything that is in use.
 */
export function exportPack(library, { ids = [], layer, now = Date.now() } = {}) {
  const missing = ids.filter(id => !library.get(id))
  if (missing.length > 0) throw new Error(`no adaptation ${missing.join(', ')}`)
  const chosen = library.list()
    .filter(record => (ids.length > 0 ? ids.includes(record.id) : ['candidate', 'active'].includes(record.status)))
    .filter(record => layer === undefined || layerOfRecord(record) === layer)
  return {
    format: PACK_FORMAT,
    exportedAt: new Date(now).toISOString(),
    adaptations: chosen.map(record => ({
      title: record.title,
      description: record.description,
      capabilities: record.capabilities,
      layer: layerOfRecord(record),
      friction: { signature: record.friction?.signature, kind: record.friction?.kind, summary: record.friction?.summary },
      writtenBy: record.origin?.generator,
      source: splitHeader(library.readSource(record.id)).body,
    })),
  }
}

/**
 * Stores a pack's adaptations in the library.
 * Each source is checked again here; what the pack says about its own capabilities is not used. Adaptations arrive
 * as proposals that wait for `dsh-rsi approve`, unless `trust` is set.
 * @param {ReturnType<import('./library.js').openLibrary>} library
 * @param {object} pack
 * @param {{ scope?: object, trust?: boolean, cwd?: string, now?: number }} [options] `scope` overrides where they apply;
 *   by default the project layer applies to `cwd` and the other layers everywhere.
 * @returns {{ title?: string, imported: boolean, id?: string, status?: string, reason?: string }[]}
 */
export function importPack(library, pack, { scope, trust = false, cwd = process.cwd(), now = Date.now() } = {}) {
  if (pack?.format !== PACK_FORMAT || !Array.isArray(pack.adaptations)) throw new Error(`not a dsh-rsi pack (expected format "${PACK_FORMAT}")`)
  const results = []
  for (const item of pack.adaptations) {
    const source = typeof item?.source === 'string' ? item.source : ''
    const inspected = inspectAdaptation(source, { env: { cwd, platform: process.platform } })
    if (!inspected.ok) {
      results.push({ title: typeof item?.title === 'string' ? item.title : undefined, imported: false, reason: inspected.problems[0] })
      continue
    }
    const { meta, tier } = inspected
    const kind = typeof item.friction?.kind === 'string' ? item.friction.kind : 'imported'
    const layer = LAYERS.includes(item.layer) ? item.layer : layerOf(kind)
    const target = scope ?? (layer === 'project' ? { kind: 'workspace', cwd } : { kind: 'global' })
    const signature = typeof item.friction?.signature === 'string' ? item.friction.signature : `pack:${hashOf(source).slice(7, 19)}`
    const twin = library.list().find(record => record.friction?.signature === signature
      && !['retired', 'quarantined'].includes(record.status)
      && (target.kind === 'global' ? record.scope?.kind === 'global' : scopeCovers(record.scope, target.cwd)))
    if (twin) {
      results.push({ title: meta.title, imported: false, reason: `adaptation ${twin.id} already answers this` })
      continue
    }
    const record = library.create({
      title: meta.title, description: meta.description, capabilities: meta.capabilities, tier,
      status: trust ? 'candidate' : 'proposed',
      validation: { stages: inspected.stages, tier },
      approval: trust ? { at: now, by: 'user', capabilities: meta.capabilities } : undefined,
      layer, scope: target,
      friction: { signature, kind, summary: typeof item.friction?.summary === 'string' ? item.friction.summary : meta.description },
      origin: { generator: typeof item.writtenBy === 'string' ? item.writtenBy : 'unknown', imported: 'pack' },
    }, source)
    library.audit({ type: 'import', adaptationId: record.id, status: record.status, signature, capabilities: meta.capabilities })
    results.push({ title: meta.title, imported: true, id: record.id, status: record.status })
  }
  return results
}
