// Read the plugin's own constants out of main.js (it's a plain script, not a module).
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

export function loadConnectorSource() {
  const src = readFileSync(new URL('../main.js', import.meta.url), 'utf8')
  const ctx = vm.createContext({ __NIHMBUS_TEST__: true, URL, TextEncoder, setTimeout, Set, Math })
  vm.runInContext(src + '\n;globalThis.__out = { allowed: ALLOWED_METHODS, protocol: EXTENSION_PROTOCOL }', Object.assign(ctx, { globalThis: ctx }))
  const tools = [...src.matchAll(/command\.tool === '([a-z_]+)'/g)].map((m) => m[1])
  return { allowed: ctx.__out.allowed, protocol: ctx.__out.protocol, tools }
}
