/**
 * E1: canonical source SHA-256 ledger for the Juyiting occlusion baseline.
 *
 * Records the frozen canonical source triple (assetRef/path/sha256), the five
 * prop PNGs, the lighting overlay, the duplicate mid/foreground occluder pair,
 * all persona sprite sheets exported by the runtime manifest, and the TMX itself.
 * Emits a committed fixture:
 *   tests/fixtures/juyiting/occlusion-v0/source-hashes.json
 *
 * CLI contract: no args verifies the committed fixture; --update validates the
 * candidate against the fixed baseline commit, then atomically rewrites it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildPersonaSpriteResource } from '../../src/game/resources.js'
import { PERSONA_SPRITE_MANIFEST } from '../../src/game/sprites/personaSpriteManifest.ts'
import { atomicWriteUtf8 } from './lib/atomic-write.mjs'
import { sha256Bytes } from './lib/tmx-structure.mjs'
import {
  assertBaselineProvenance,
  fixtureBaselineCommit,
  readJsonIfPresent,
} from './lib/baseline-provenance.mjs'
import { canonicalizeJuyitingRuntimeSource, readJuyitingPublicFile } from './lib/juyiting-public-path.mjs'

const tmxPath = process.env.JIA_JUYITING_TMX_PATH
  ?? fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
const imagesDir = process.env.JIA_JUYITING_IMAGES_DIR
  ?? fileURLToPath(new URL('../../public/juyiting/images/', import.meta.url))
const fixtureDir = process.env.JIA_JUYITING_OCCLUSION_FIXTURE_DIR
  ?? fileURLToPath(new URL('../../tests/fixtures/juyiting/occlusion-v0/', import.meta.url))
const fixturePath = resolve(fixtureDir, 'source-hashes.json')
const inventoryPath = resolve(fixtureDir, 'inventory.json')
const publicRoot = resolve(
  process.env.JIA_JUYITING_PUBLIC_ROOT
    ?? fileURLToPath(new URL('../../public/', import.meta.url)),
)

// Frozen canonical source contract from docs/juyiting-occlusion-system-design.md §8.1.
const CANONICAL_SOURCE = {
  assetRef: 'jyt.occlusion-source.hall-v3',
  path: 'public/juyiting/images/liangshan-hall-mid-occluders-v3.webp',
  expectedSha256: '3e4f3f90b4d84411a844978237a7d3530bd481c37a62bcd73b9d694a7d2dd432',
}

export function buildSourceHashes(options = {}) {
  const { baselineCommit = null } = options
  const entries = []
  const add = (label, path, bytes, role) => {
    entries.push({
      role,
      label,
      path: path.replace(`${process.cwd()}/`, ''),
      sizeBytes: bytes.length,
      sha256: sha256Bytes(bytes),
    })
  }

  const tmxBytes = readRequiredFile(tmxPath, 'Juyiting TMX source')
  add('hall.tmx', canonicalizeJuyitingRuntimeSource('/juyiting/hall.tmx'), tmxBytes, 'tmx')

  const canonicalBytes = readRequiredFile(resolve(imagesDir, 'liangshan-hall-mid-occluders-v3.webp'), 'canonical occluder source')
  add(CANONICAL_SOURCE.assetRef, CANONICAL_SOURCE.path, canonicalBytes, 'canonical-occluder-source')

  for (const name of [
    'liangshan-hall-base-clean-v3.webp',
    'liangshan-hall-foreground-occluders-v3.webp',
    'liangshan-hall-lighting-overlay-v3.webp',
  ]) {
    const bytes = readRequiredFile(resolve(imagesDir, name), name)
    add(name, `public/juyiting/images/${name}`, bytes, name.includes('foreground') ? 'duplicate-occluder' : 'map-layer')
  }

  for (const name of [
    'liangshan-hall-prop-main-seat-cropped.png',
    'liangshan-hall-prop-agent-roster-cropped.png',
    'liangshan-hall-prop-bounty-board-cropped.png',
    'liangshan-hall-prop-library-shelf-cropped.png',
    'liangshan-hall-prop-roster-book-cropped.png',
  ]) {
    const bytes = readRequiredFile(resolve(imagesDir, `props/${name}`), name)
    add(name, `public/juyiting/images/props/${name}`, bytes, 'prop')
  }

  const personaDefinitions = Object.values(PERSONA_SPRITE_MANIFEST.personas)
  if (personaDefinitions.length === 0) throw new Error('PERSONA_SPRITE_MANIFEST.personas must not be empty')
  for (const definition of personaDefinitions) {
    const resource = buildPersonaSpriteResource(definition)
    const publicPath = personaSpritePublicPath(resource)
    const bytes = readJuyitingPublicFile(publicRoot, publicPath).bytes
    add(definition.personaCode, publicPath, bytes, 'persona-sprite')
  }

  const bySha = new Map()
  for (const entry of entries) {
    if (!bySha.has(entry.sha256)) bySha.set(entry.sha256, [])
    bySha.get(entry.sha256).push(entry.path)
  }
  const duplicates = [...bySha.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha256, paths]) => ({ sha256, paths }))

  return {
    schemaVersion: 1,
    generatedBy: 'scripts/juyiting/hash-juyiting-sources.mjs',
    baselineCommit,
    canonicalSource: {
      ...CANONICAL_SOURCE,
      actualSha256: sha256Bytes(canonicalBytes),
      matches: sha256Bytes(canonicalBytes) === CANONICAL_SOURCE.expectedSha256,
    },
    entries,
    duplicates,
  }
}

function personaSpritePublicPath(resource) {
  if (!resource || typeof resource !== 'object') throw new Error('buildPersonaSpriteResource returned an invalid resource')
  if (resource.type !== 'image') throw new Error(`Unsupported persona sprite resource type: ${JSON.stringify(resource.type)}`)
  if (typeof resource.name !== 'string' || resource.name.trim() === '') throw new Error('Persona sprite resource is missing name')
  const publicPath = canonicalizeJuyitingRuntimeSource(resource.src)
  if (!publicPath.startsWith('public/juyiting/sprites/')) {
    throw new Error(`Persona sprite resource must use /juyiting/sprites/: ${JSON.stringify(resource.src)}`)
  }
  return publicPath
}

export function serializeSourceHashes(report) {
  return `${JSON.stringify(report, null, 2)}\n`
}

export function runHashSources(args = process.argv.slice(2)) {
  const mode = parseArguments(args)
  const existingFixture = readJsonIfPresent(fixturePath)
  if (!existingFixture) {
    throw new Error('Juyiting source hash verification requires a committed fixture with the locked baselineCommit')
  }
  const inventoryFixture = readJsonIfPresent(inventoryPath)
  if (inventoryFixture) fixtureBaselineCommit(inventoryFixture)
  const baselineCommit = fixtureBaselineCommit(existingFixture)
  const expectedFiles = existingFixture?.entries?.map(entry => ({ path: entry.path, sha256: entry.sha256 })) ?? []
  if (expectedFiles.length > 0) assertBaselineProvenance(baselineCommit, expectedFiles)
  const report = buildSourceHashes({ baselineCommit })
  assertBaselineProvenance(
    baselineCommit,
    report.entries.map(entry => ({ path: entry.path, sha256: entry.sha256 })),
  )
  const json = serializeSourceHashes(report)
  if (mode === 'stdout') {
    process.stdout.write(json)
    return report
  }
  if (mode === 'update') {
    atomicWriteUtf8(fixturePath, json, 'Juyiting source-hashes fixture')
    console.log(`Juyiting source hashes updated: ${fixturePath}`)
    return report
  }
  const committed = readRequiredFile(fixturePath, 'Juyiting source-hashes fixture', 'utf8')
  if (committed !== json) {
    throw new Error('Juyiting source hashes mismatch. Run npm run hash:juyiting-sources -- --update.')
  }
  console.log('Juyiting source hashes valid')
  return report
}

function parseArguments(args) {
  if (args.length === 0) return 'verify'
  if (args.length === 1 && args[0] === '--update') return 'update'
  if (args.length === 1 && args[0] === '--stdout') return 'stdout'
  throw new Error(`Unknown arguments: ${args.join(' ')}`)
}

function readRequiredFile(path, label, encoding) {
  try {
    return encoding ? readFileSync(path, encoding) : readFileSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} is missing: ${path}`)
    throw new Error(`Unable to read ${label} at ${path}: ${error?.code ?? error}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runHashSources()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
