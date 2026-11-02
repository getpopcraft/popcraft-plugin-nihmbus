#!/usr/bin/env node
// Check this plugin against the PopCraft extension's manifest: same tools, same extension protocol, and the same
// `call` method allowlist. Usage:
//   node scripts/contract-check.mjs [path or URL to nihmbus.extension.json]
// Default: https://raw.githubusercontent.com/nihmbus/nihmbus-popcraft/main/nihmbus.extension.json
import { readFileSync } from 'node:fs'
import { loadConnectorSource } from './source.mjs'

const ref = process.argv[2] ?? 'https://raw.githubusercontent.com/nihmbus/nihmbus-popcraft/main/nihmbus.extension.json'
const manifest = JSON.parse(/^https?:/.test(ref) ? await (await fetch(ref)).text() : readFileSync(ref, 'utf8'))
const { allowed, tools, protocol } = loadConnectorSource()
const problems = []
const device = manifest.device ?? {}
if (device.protocol !== protocol) problems.push(`extension protocol: manifest ${device.protocol}, plugin ${protocol}`)
const declared = (device.tools ?? []).map((t) => t.name).sort()
if (declared.join() !== [...tools].sort().join())
  problems.push(`tools: manifest [${declared}], plugin [${[...tools].sort()}]`)
const call = (device.tools ?? []).find((t) => t.name === 'call')
const enumList = call?.inputSchema?.properties?.method?.enum ?? []
const missing = enumList.filter((m) => !allowed.has(m))
const extra = [...allowed].filter((m) => !enumList.includes(m))
if (missing.length) problems.push(`in the manifest but not allowed by the plugin: ${missing.join(', ')}`)
if (extra.length) problems.push(`allowed by the plugin but not in the manifest: ${extra.join(', ')}`)
if (problems.length) {
  for (const p of problems) console.error('✖ ' + p)
  process.exit(1)
}
console.log(`✓ contract matches: protocol ${protocol}, tools ${declared.join(', ')}, ${enumList.length} methods`)
