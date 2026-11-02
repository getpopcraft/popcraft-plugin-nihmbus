#!/usr/bin/env node
// Build an installable package: dist/popcraft.nihmbus-<version>.json (a single-file bundle PopCraft installs with
// Manage plugins → Installed → Install from file…). Checks the version in manifest.json matches main.js and package.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const read = (f) => readFileSync(join(root, f), 'utf8')
const manifest = JSON.parse(read('manifest.json'))
const main = read(manifest.main)
const ui = manifest.ui ? read(manifest.ui) : undefined
const pkg = JSON.parse(read('package.json'))
const inMain = /version: '([^']+)'/.exec(main)?.[1]
if (manifest.version !== inMain || manifest.version !== pkg.version) {
  console.error(`Version mismatch: manifest ${manifest.version}, main.js ${inMain}, package.json ${pkg.version}`)
  process.exit(1)
}
mkdirSync(join(root, 'dist'), { recursive: true })
const out = join(root, 'dist', `${manifest.id}-${manifest.version}.json`)
writeFileSync(out, JSON.stringify({ manifest, main, ...(ui ? { ui } : {}) }))
console.log(out)
