// Load main.js the way PopCraft does (a plain script) and hand back its createConnector, without auto-starting.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

export function loadConnector() {
  const src = readFileSync(new URL('../main.js', import.meta.url), 'utf8')
  const ctx = vm.createContext({ __NIHMBUS_TEST__: true, URL, TextEncoder, setTimeout, Promise, JSON, Math, Array, Set, String, Number, Error, Object })
  ctx.globalThis = ctx
  vm.runInContext(src + '\n;globalThis.createConnector = createConnector', ctx)
  return ctx.createConnector
}

/** A fake `popcraft` global: storage, ui messages, a tiny document, and every allowed method as a recorder. */
export function fakeApi() {
  const store = new Map()
  const calls = []
  const sent = []
  const api = {
    storage: { get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v) },
    ui: { postMessage: (m) => sent.push(m), onmessage: null },
    showUI: async () => {},
    hideUI: async () => {},
    getCurrentPage: async () => ({ id: 'page-1', name: 'Page 1', childIds: ['f1'] }),
    getSelection: async () => [{ id: 'f1', name: 'Poster', type: 'FRAME', x: 0 }],
    getNode: async (id) => (id === 'f1' ? { id: 'f1', name: 'Poster / Final', type: 'FRAME' } : null),
    createNode: async (type, props) => { calls.push(['createNode', type, props]); return 'n-' + calls.length },
    setText: async (id, text) => { calls.push(['setText', id, text]) },
    setKeyframes: async () => { throw new Error('bad keyframes') },
    exportNode: async (id, opts) => (opts.format === 'SVG' ? '<svg/>' : new Uint8Array([1, 2, 3, 4])),
    upload: async (url, opts) => { calls.push(['upload', url, opts.method, opts.contentType, opts.body.byteLength]); return { ok: true, status: 200, body: '' } },
    // Exists on the real API but must never be callable through `call`.
    storageSet: async () => { calls.push(['storageSet']) },
  }
  return { api, store, calls, sent }
}
