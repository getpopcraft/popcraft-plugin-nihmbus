#!/usr/bin/env node
// Publish this plugin to the PopCraft marketplace (the plugin half of getpopcraft/plugins' scripts/publish.mjs).
//
//   POPCRAFT_TOKEN=pop_… node scripts/publish.mjs     publish the version in manifest.json
//   node scripts/publish.mjs --dry-run                build and check the bundle, send nothing
//
// Versions are immutable: an already-published version comes back 409 and is skipped, so re-runs stay green.
// A new version lands in marketplace review before it is listed.
import { readFileSync } from 'node:fs'

const dryRun = process.argv.includes('--dry-run')
const base = (process.env.POPCRAFT_URL || 'https://popcraft.app').replace(/\/$/, '')
const token = process.env.POPCRAFT_TOKEN
const fail = (msg) => {
  console.error(`✖ ${msg}`)
  process.exit(1)
}
if (!dryRun && !token) fail('Set POPCRAFT_TOKEN to a personal access token with the marketplace:publish scope')

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'))
for (const f of ['id', 'name', 'version', 'main']) if (!manifest[f]) fail(`manifest.json needs "${f}"`)
const bundle = { manifest, main: readFileSync(manifest.main, 'utf8') }
if (manifest.ui) bundle.ui = readFileSync(manifest.ui, 'utf8')
const label = `${manifest.id}@${manifest.version}`

if (dryRun) {
  console.log(`✓ ${label}  (${JSON.stringify(bundle).length} bytes)`)
  process.exit(0)
}
const res = await fetch(`${base}/api/v1/plugins`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(bundle),
})
const text = await res.text()
if (res.status === 409) console.log(`· ${label} already published`)
else if (res.ok) console.log(`✓ ${label} sent to marketplace review (${res.status})`)
else fail(`${label}  ${res.status} ${text.slice(0, 300)}`)
