#!/usr/bin/env node
// Set the plugin's version everywhere it lives: manifest.json, main.js (PLUGIN.version) and package.json.
// The release workflow runs it with the version sem picked.   node scripts/set-version.mjs 1.2.3
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('Usage: node scripts/set-version.mjs <semver>')
  process.exit(1)
}
// Replace the top-level "version" in place, so the file keeps its formatting.
const setJsonVersion = (file) => {
  const text = readFileSync(file, 'utf8')
  const next = text.replace(/^(\s{2}"version":\s*")[^"]*(")/m, `$1${version}$2`)
  if (JSON.parse(next).version !== version) throw new Error(`${file}: could not set "version"`)
  writeFileSync(file, next)
}
setJsonVersion('manifest.json')
setJsonVersion('package.json')
const main = readFileSync('main.js', 'utf8')
const next = main.replace(/(const PLUGIN = \{ id: '[^']+', version: ')[^']+(' \})/, `$1${version}$2`)
if (next === main && !main.includes(`version: '${version}'`)) {
  console.error('main.js: could not find PLUGIN.version')
  process.exit(1)
}
writeFileSync('main.js', next)
console.log(`version ${version}`)
