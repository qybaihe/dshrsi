// One adaptation, compiled and ready to act inside a live session.
//
// A mount never lets generated code break the host: every handler call is
// guarded, a failure is counted and reported, and the tool call or turn it
// was attached to proceeds as if the adaptation had said nothing.
import { mark } from './marks.js'
import { compileAdaptation } from './sandbox.js'
import { hasSeam, runPost, runPre, runStep, runStop } from './runner.js'

/**
 * @param {object} input
 * @param {object} input.record library record of the adaptation.
 * @param {string} input.source adaptation script.
 * @param {{ cwd?: string, platform?: string }} input.env
 * @param {(request: { command: string, options: object }) => Promise<object>} [input.exec] shell bridge for `h.exec`.
 * @param {(mount: object, seam: string, effect: { type: string, text: string }) => void} [input.onEffect]
 * @param {(mount: object, seam: string, error: Error) => void} [input.onFault]
 * @param {number} [input.handlerTimeoutMs]
 * @throws {import('./sandbox.js').AdaptationError} when the source does not load.
 */
export function createMount(input) {
  const { record } = input
  const compiled = compileAdaptation(input.source, {
    filename: `adaptation-${record.id}.js`,
    env: input.env,
    exec: input.exec,
    asyncTimeoutMs: input.handlerTimeoutMs,
  })

  const mount = {
    id: record.id,
    version: record.version,
    title: compiled.meta.title,
    signature: record.friction?.signature,
    meta: compiled.meta,
    fires: 0,
    faults: 0,
    /** Set when the mount is withdrawn; handlers still in flight then answer nothing. */
    dead: false,
    sections: compiled.registrations.filter(entry => entry.seam === 'promptSection').map(entry => entry.text),
    tools: compiled.registrations.filter(entry => entry.seam === 'addTool'),
    has: seam => hasSeam(compiled, seam),
    /** Prefixes text so the model and the observer can attribute it. */
    mark: text => mark(compiled.meta.title, text),
    pre: call => guarded('beforeTool', () => runPre(compiled, call)),
    post: (call, result) => guarded('onToolResult', () => runPost(compiled, call, result)),
    stop: turn => guarded('beforeStop', () => runStop(compiled, turn)),
    step: state => guarded('beforeStep', () => runStep(compiled, state)),
    /** Runs the body of a tool the adaptation registered. Failures surface to the caller as a tool error. */
    async runTool(registration, args) {
      try {
        const value = await compiled.invoke(registration.handler, [args])
        mount.fires += 1
        input.onEffect?.(mount, 'addTool', { type: 'tool', text: registration.name })
        return typeof value === 'string' ? value : JSON.stringify(value ?? null)
      } catch (error) {
        mount.faults += 1
        input.onFault?.(mount, 'addTool', error)
        throw error
      }
    },
  }

  async function guarded(seam, run) {
    if (mount.dead) return []
    try {
      const effects = await run()
      if (mount.dead) return []
      for (const effect of effects) {
        mount.fires += 1
        input.onEffect?.(mount, seam, effect)
      }
      return effects
    } catch (error) {
      mount.faults += 1
      input.onFault?.(mount, seam, error)
      return []
    }
  }

  return mount
}
