// Evaluates adaptation source in its own realm.
//
// Generated code never holds a host object. The bootstrap below builds the
// `h` facade inside the realm; the only link to the host is one bridge
// function kept in a closure, and everything crossing it is a JSON string.
// Host functions and host promises therefore cannot be reached from generated
// code through `.constructor` walks. This limits accidents and casual misuse;
// it is not a security boundary against a determined author.
import vm from 'node:vm'
import { CAPABILITIES } from './capabilities.js'

const BOOTSTRAP = `(function (bridge, env, capabilityNames) {
  'use strict'
  const handlers = []
  const predicates = []
  let spec
  let declared = new Set()
  let phase = 'load'

  function need(capability, what) {
    if (!declared.has(capability)) throw new Error(what + ' needs capability "' + capability + '" in define({ capabilities })')
  }
  function effect(type, capability, fields) {
    need(capability, 'h.' + type + '()')
    return Object.freeze(Object.assign({ $effect: type }, fields))
  }
  function text(value, what) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(what + ' needs non-empty text')
    return value
  }
  function encodeFilter(filter) {
    if (filter === undefined || filter === null) return { all: true }
    if (typeof filter === 'function') { predicates.push(filter); return { predicate: predicates.length - 1 } }
    if (typeof filter !== 'object') throw new Error('filter must be an object, a function, or omitted')
    const out = {}
    for (const key of Object.keys(filter)) {
      if (key !== 'tool' && key !== 'command' && key !== 'path') throw new Error('unknown filter field "' + key + '"')
      const value = filter[key]
      if (value instanceof RegExp) out[key] = { regex: value.source, flags: value.flags.replace(/[gy]/g, '') }
      else if (Array.isArray(value)) out[key] = { any: value.map(String) }
      else out[key] = { exact: String(value) }
    }
    return out
  }
  function register(seam, filter, handler, extra) {
    if (phase !== 'setup') throw new Error('h.' + seam + ' may only be called inside setup()')
    if (typeof handler !== 'function') throw new Error('h.' + seam + ' needs a handler function')
    handlers.push(handler)
    bridge('register', JSON.stringify(Object.assign({ seam: seam, filter: encodeFilter(filter), handler: handlers.length - 1 }, extra || {})))
  }
  function deepFreeze(value) {
    if (value && typeof value === 'object') { Object.freeze(value); for (const key of Object.keys(value)) deepFreeze(value[key]) }
    return value
  }

  const h = Object.freeze({
    cwd: env.cwd,
    platform: env.platform,
    onToolResult(filter, handler) { if (typeof filter === 'function' && handler === undefined) { handler = filter; filter = undefined } register('onToolResult', filter, handler) },
    beforeTool(filter, handler) { if (typeof filter === 'function' && handler === undefined) { handler = filter; filter = undefined } register('beforeTool', filter, handler) },
    beforeStop(handler) { need('verify', 'h.beforeStop()'); register('beforeStop', undefined, handler) },
    beforeStep(handler) { need('steer', 'h.beforeStep()'); register('beforeStep', undefined, handler) },
    promptSection(value) {
      need('prompt', 'h.promptSection()')
      if (phase !== 'setup') throw new Error('h.promptSection may only be called inside setup()')
      bridge('register', JSON.stringify({ seam: 'promptSection', text: text(value, 'h.promptSection()') }))
    },
    addTool(definition) {
      need('tool', 'h.addTool()')
      if (phase !== 'setup') throw new Error('h.addTool may only be called inside setup()')
      if (!definition || typeof definition !== 'object') throw new Error('h.addTool needs a definition object')
      if (!/^[a-z][a-z0-9_]{2,40}$/.test(String(definition.name))) throw new Error('tool name must match /^[a-z][a-z0-9_]{2,40}$/')
      if (typeof definition.run !== 'function') throw new Error('h.addTool needs run(args)')
      handlers.push(definition.run)
      bridge('register', JSON.stringify({
        seam: 'addTool', handler: handlers.length - 1, name: definition.name,
        description: text(definition.description, 'tool description'), parameters: definition.parameters || {},
      }))
    },
    annotate: function (value) { return effect('annotate', 'annotate', { text: text(value, 'h.annotate()') }) },
    block: function (value) { return effect('block', 'block', { text: text(value, 'h.block()') }) },
    replace: function (value) { return effect('replace', 'rewrite', { text: text(value, 'h.replace()') }) },
    deny: function (value) { return effect('deny', 'deny', { text: text(value, 'h.deny()') }) },
    ask: function (value) { return effect('ask', 'ask', { text: text(value, 'h.ask()') }) },
    continueWith: function (value) { return effect('continue', 'verify', { text: text(value, 'h.continueWith()') }) },
    note: function (value) { return effect('note', 'steer', { text: text(value, 'h.note()') }) },
    exec(command, options) {
      need('exec', 'h.exec()')
      if (phase !== 'run') throw new Error('h.exec may only be called from a handler')
      return new Promise(function (resolve, reject) {
        bridge('exec', JSON.stringify({ command: text(command, 'h.exec()'), options: options || {} }),
          function (json) { resolve(deepFreeze(JSON.parse(json))) }, function (message) { reject(new Error(message)) })
      })
    },
    log() { bridge('log', JSON.stringify(Array.prototype.map.call(arguments, String))) },
  })

  globalThis.define = function define(input) {
    if (spec) throw new Error('define() may be called only once')
    if (!input || typeof input !== 'object') throw new Error('define() needs an object')
    if (typeof input.setup !== 'function') throw new Error('define() needs setup(h)')
    const capabilities = Array.isArray(input.capabilities) ? input.capabilities.map(String) : []
    for (const name of capabilities) if (capabilityNames.indexOf(name) === -1) throw new Error('unknown capability "' + name + '"')
    declared = new Set(capabilities)
    spec = input
  }

  return Object.freeze({
    meta() {
      if (!spec) throw new Error('the script never called define()')
      return JSON.stringify({ title: String(spec.title || ''), description: String(spec.description || ''), capabilities: Array.from(declared) })
    },
    setup() { phase = 'setup'; try { spec.setup(h) } finally { phase = 'run' } },
    // The handler's synchronous part runs inside this call so the host's
    // evaluation timeout covers it; deferring it to a microtask would not.
    dispatch(id, json) {
      const args = JSON.parse(json).map(deepFreeze)
      let value
      try { value = handlers[id].apply(undefined, args) } catch (error) { return Promise.reject(error) }
      return Promise.resolve(value).then(function (settled) { return JSON.stringify(settled === undefined ? null : settled) })
    },
    test(id, json) { return predicates[id].apply(undefined, JSON.parse(json).map(deepFreeze)) ? 1 : 0 },
  })
})`

export class AdaptationError extends Error {
  constructor(message, stage) {
    super(message)
    this.name = 'AdaptationError'
    this.stage = stage
  }
}

function describe(error) {
  // Errors raised in the realm are not instances of the host Error.
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
}

/**
 * Compiles and sets up one adaptation.
 * @param {string} source adaptation script.
 * @param {object} options
 * @param {string} [options.filename]
 * @param {{ cwd?: string, platform?: string }} [options.env]
 * @param {(request: { command: string, options: object }) => Promise<object>} [options.exec] shell bridge for `h.exec`.
 * @param {(line: string) => void} [options.log]
 * @param {number} [options.syncTimeoutMs] budget for each synchronous slice of generated code.
 * @param {number} [options.asyncTimeoutMs] budget for one whole handler call.
 */
export function compileAdaptation(source, options = {}) {
  const filename = options.filename ?? 'adaptation.js'
  const syncTimeoutMs = options.syncTimeoutMs ?? 250
  const asyncTimeoutMs = options.asyncTimeoutMs ?? 30000
  const registrations = []
  const logs = []

  const bridge = (name, json, resolve, reject) => {
    try {
      const payload = JSON.parse(json)
      if (name === 'register') { registrations.push(payload); return undefined }
      if (name === 'log') { const line = payload.join(' ').slice(0, 500); logs.push(line); options.log?.(line); return undefined }
      if (name === 'exec') {
        if (typeof options.exec !== 'function') { reject('h.exec is not available here'); return undefined }
        options.exec(payload).then(value => resolve(JSON.stringify(value)), error => reject(describe(error)))
        return undefined
      }
      throw new Error(`unknown bridge call ${name}`)
    } catch (error) {
      if (typeof reject === 'function') { reject(describe(error)); return undefined }
      // Synchronous bridge failures surface in the realm as a plain string so no host Error leaks.
      return `bridge error: ${describe(error)}`
    }
  }

  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, name: filename })
  let realm
  try {
    const factory = vm.runInContext(BOOTSTRAP, context, { filename: 'dsh-rsi-bootstrap.js', timeout: 1000 })
    const env = vm.runInContext(`(${JSON.stringify({ cwd: options.env?.cwd ?? '', platform: options.env?.platform ?? process.platform })})`, context)
    const names = vm.runInContext(`(${JSON.stringify(Object.keys(CAPABILITIES))})`, context)
    realm = factory(bridge, env, names)
    Object.defineProperty(context, '__rsi', { value: realm, enumerable: false })
  } catch (error) {
    throw new AdaptationError(`bootstrap failed: ${describe(error)}`, 'bootstrap')
  }

  let script
  try {
    script = new vm.Script(source, { filename })
  } catch (error) {
    throw new AdaptationError(`syntax error: ${describe(error)}`, 'syntax')
  }
  try {
    script.runInContext(context, { timeout: syncTimeoutMs * 4 })
  } catch (error) {
    throw new AdaptationError(`load failed: ${describe(error)}`, 'load')
  }

  let meta
  try {
    meta = JSON.parse(vm.runInContext('__rsi.meta()', context, { timeout: syncTimeoutMs }))
  } catch (error) {
    throw new AdaptationError(describe(error), 'define')
  }
  try {
    vm.runInContext('__rsi.setup()', context, { timeout: syncTimeoutMs * 4 })
  } catch (error) {
    throw new AdaptationError(`setup failed: ${describe(error)}`, 'setup')
  }

  /** Calls one registered handler with JSON-serializable arguments. */
  async function invoke(handlerId, args) {
    context.__rsi_id = handlerId
    context.__rsi_json = JSON.stringify(args)
    let pending
    try {
      pending = vm.runInContext('__rsi.dispatch(__rsi_id, __rsi_json)', context, { timeout: syncTimeoutMs })
    } catch (error) {
      throw new AdaptationError(`handler failed: ${describe(error)}`, 'handler')
    }
    let timer
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AdaptationError(`handler exceeded ${asyncTimeoutMs}ms`, 'timeout')), asyncTimeoutMs)
    })
    try {
      const json = await Promise.race([pending, deadline])
      return JSON.parse(json)
    } catch (error) {
      if (error instanceof AdaptationError) throw error
      throw new AdaptationError(`handler failed: ${describe(error)}`, 'handler')
    } finally {
      clearTimeout(timer)
    }
  }

  /** Evaluates a function-form filter. */
  function test(predicateId, args) {
    context.__rsi_id = predicateId
    context.__rsi_json = JSON.stringify(args)
    try {
      return vm.runInContext('__rsi.test(__rsi_id, __rsi_json)', context, { timeout: syncTimeoutMs }) === 1
    } catch (error) {
      throw new AdaptationError(`filter failed: ${describe(error)}`, 'handler')
    }
  }

  return { meta, registrations, logs, invoke, test }
}
