/**
 * E1: Juyiting baseline asset + texture-memory report.
 *
 * Records (machine-readable, committed fixture):
 *   1. initial production build artifact size (dist/ is gitignored; measured when present)
 *   2. auditable runtime asset references derived from executable resources.js/manifest exports and hall.tmx
 *   3. decoded texture-size estimate (w×h×4 per actually referenced image path; content hashes deduplicated separately)
 *   4. draw call / runtime performance -> BLOCKED at E1 (no reliable automated sampling
 *      harness on this host); no numbers are fabricated.
 *
 * Output:
 *   tests/fixtures/juyiting/occlusion-v0/asset-report.json
 *
 * CLI contract: no args verifies the committed fixture; --update validates the
 * candidate against the fixed baseline commit, then atomically rewrites it; --stdout prints.
 * Verify mode requires dist/ to exist (run `npm run build` first); when dist/ is absent the
 * buildArtifact section is recorded as not_generated and verify skips only that section.
 */

import { readFileSync, statSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  HALL_BOOT_RESOURCES,
  buildHallMapResources,
  buildPersonaSpriteResource,
} from '../../src/game/resources.js'
import { PERSONA_SPRITE_MANIFEST } from '../../src/game/sprites/personaSpriteManifest.ts'
import { atomicWriteUtf8 } from './lib/atomic-write.mjs'
import { parseTmxStructure, sha256Bytes } from './lib/tmx-structure.mjs'
import {
  assertBaselineProvenance,
  assertBaselinePublicTree,
  fixtureBaselineCommit,
  readJsonIfPresent,
} from './lib/baseline-provenance.mjs'
import {
  canonicalizeJuyitingRuntimeSource,
  canonicalizeJuyitingTmxSource,
  resolveJuyitingPublicFile,
} from './lib/juyiting-public-path.mjs'

const worktreeRoot = fileURLToPath(new URL('../../', import.meta.url))
const tmxPath = process.env.JIA_JUYITING_TMX_PATH
  ?? fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
const fixtureDir = process.env.JIA_JUYITING_OCCLUSION_FIXTURE_DIR
  ?? fileURLToPath(new URL('../../tests/fixtures/juyiting/occlusion-v0/', import.meta.url))
const fixturePath = resolve(fixtureDir, 'asset-report.json')
const sourceHashesPath = resolve(fixtureDir, 'source-hashes.json')
const distDir = resolve(worktreeRoot, 'dist')
const publicRoot = resolve(
  process.env.JIA_JUYITING_PUBLIC_ROOT
    ?? fileURLToPath(new URL('../../public/', import.meta.url)),
)

const ASSET_CATEGORY_RULES = {
  tmx: ['juyiting/hall.tmx'],
  'map-layer': ['juyiting/images/liangshan-hall-base-clean-v3.webp', 'juyiting/images/liangshan-hall-mid-occluders-v3.webp', 'juyiting/images/liangshan-hall-foreground-occluders-v3.webp', 'juyiting/images/liangshan-hall-lighting-overlay-v3.webp'],
  prop: ['juyiting/images/props/'],
  'unreferenced-legacy': ['juyiting/tiles/hall-tileset.json', 'juyiting/tiles/hall-tileset.png'],
  sprite: ['juyiting/sprites/'],
  'dev-preview-modular': ['juyiting/images/modular/'],
}

export function buildAssetReport(options = {}) {
  const tmxBytes = readRequiredFile(tmxPath, 'Juyiting TMX source')
  const tmxSha256 = sha256Bytes(Buffer.from(tmxBytes, 'utf8'))
  const sourceHashes = options.sourceHashes
    ?? JSON.parse(readRequiredFile(sourceHashesPath, 'Juyiting source-hashes fixture'))
  const baselineCommit = fixtureBaselineCommit(sourceHashes)
  assertBaselineProvenance(baselineCommit, sourceHashes.entries.map(entry => ({ path: entry.path, sha256: entry.sha256 })))

  const publicTreeAudit = assertBaselinePublicTree(publicRoot, baselineCommit)
  const network = classifyNetworkAssets(publicTreeAudit.files)
  const networkTmx = network.find(entry => entry.path === 'public/juyiting/hall.tmx')
  if (!networkTmx || networkTmx.sha256 !== tmxSha256) {
    throw new Error(`Juyiting TMX source does not match audited public tree hall.tmx: source=${tmxSha256}, tree=${networkTmx?.sha256 ?? 'missing'}`)
  }
  const structure = parseTmxStructure(tmxBytes)
  const runtimeReferenceAudit = buildRuntimeReferenceAudit({
    structure,
    network,
    bootResources: HALL_BOOT_RESOURCES,
    buildMapResources: buildHallMapResources,
    personaManifest: PERSONA_SPRITE_MANIFEST,
    buildSpriteResource: buildPersonaSpriteResource,
  })
  const textures = buildTextureEstimate(runtimeReferenceAudit.files, sourceHashes.canonicalSource.path, publicRoot)

  return {
    schemaVersion: 1,
    generatedBy: 'scripts/juyiting/asset-report-juyiting.mjs',
    baselineCommit,
    tmxSha256,
    buildArtifact: buildArtifactReport(),
    juyitingNetworkAssets: {
      baselinePublicTreeAudit: {
        baselineCommit: publicTreeAudit.baselineCommit,
        pathPrefix: publicTreeAudit.pathPrefix,
        authority: publicTreeAudit.authority,
        acceptedBlobModes: publicTreeAudit.acceptedBlobModes,
        exactPathSet: publicTreeAudit.exactPathSet,
        currentBytesMatchBaseline: publicTreeAudit.currentBytesMatchBaseline,
        fileCount: publicTreeAudit.fileCount,
      },
      totalPublicTreeBytes: sum(network.map(entry => entry.sizeBytes)),
      runtimeCoreBytes: sum(runtimeReferenceAudit.files.map(entry => entry.sizeBytes)),
      runtimeCoreFiles: runtimeReferenceAudit.files,
      runtimeReferenceAudit: {
        sources: runtimeReferenceAudit.sources,
        pathCanonicalization: runtimeReferenceAudit.pathCanonicalization,
        loaderContractChecks: runtimeReferenceAudit.loaderContractChecks,
        missingReferences: runtimeReferenceAudit.missingReferences,
      },
      files: network.map(entry => ({
        ...entry,
        runtimeReferenced: runtimeReferenceAudit.referencePaths.has(entry.path),
      })),
      note: 'runtimeCoreBytes is the exact sum of runtimeCoreFiles derived from executable resources.js/manifest exports plus hall.tmx image/tileset refs. Directory membership and source-code text alone are not treated as runtime references.',
    },
    textureDecodeEstimate: textures,
    drawCallsRuntimePerf: {
      status: 'blocked',
      reason: 'E1 has no reliable automated draw-call / runtime perf sampling harness on this host (no puppeteer/playwright instrumentation; headless Chromium smoke only). No numbers are fabricated.',
      deferredTo: ['E6 debug overlay (agent/prop/fragment depth + render stats)', 'E14 fixed 108-agent benchmark (10s warmup + 60s sampling)'],
      requiredFields: ['drawCalls', 'drawCallBreakdown', 'worldOrderUpdateP95Ms', 'worldOrderUpdateP99Ms', 'gpuTextureBytes', 'jsHeapSamples'],
    },
  }
}

function classifyNetworkAssets(files) {
  return files.map(entry => {
    const relativePath = entry.path.slice('public/'.length)
    const category = categoryFor(relativePath)
    const role = relativePath === 'juyiting/images/liangshan-hall-mid-occluders-v3.webp' ? 'canonical-occluder'
      : relativePath === 'juyiting/images/liangshan-hall-foreground-occluders-v3.webp' ? 'duplicate-occluder'
        : category
    return { ...entry, category, role }
  })
}

function categoryFor(relativePath) {
  for (const [category, prefixes] of Object.entries(ASSET_CATEGORY_RULES)) {
    if (prefixes.some(prefix => prefix.endsWith('/') ? relativePath.includes(prefix) : relativePath === prefix)) return category
  }
  return 'other'
}

export function buildRuntimeReferenceAudit({
  structure,
  network,
  bootResources,
  buildMapResources,
  personaManifest,
  buildSpriteResource,
  tmxPublicPath = 'public/juyiting/hall.tmx',
}) {
  if (!structure || !Array.isArray(structure.tilesets) || !Array.isArray(structure.layers)) {
    throw new Error('Runtime reference audit requires parseTmxStructure() output')
  }
  if (!Array.isArray(network)) throw new Error('Runtime reference audit requires enumerated network assets')
  if (!Array.isArray(bootResources)) throw new Error('HALL_BOOT_RESOURCES export must be an array')
  if (typeof buildMapResources !== 'function') throw new Error('buildHallMapResources export must be a function')
  if (!personaManifest || typeof personaManifest.personas !== 'object' || Array.isArray(personaManifest.personas)) {
    throw new Error('PERSONA_SPRITE_MANIFEST.personas export must be an object')
  }
  if (typeof buildSpriteResource !== 'function') throw new Error('buildPersonaSpriteResource export must be a function')

  const references = new Map()
  const addReference = (resource, referencedBy, allowedTypes) => {
    const { path } = validateRuntimeResource(resource, referencedBy, allowedTypes)
    if (!references.has(path)) references.set(path, new Set())
    references.get(path).add(referencedBy)
    return path
  }

  for (const [index, resource] of bootResources.entries()) {
    addReference(resource, `src/game/resources.js:HALL_BOOT_RESOURCES[${index}]`, new Set(['tmx', 'image']))
  }
  if (!references.has(tmxPublicPath)) {
    throw new Error(`HALL_BOOT_RESOURCES does not reference the audited TMX: ${tmxPublicPath}`)
  }

  const { mapData, expectedReferences, coverage } = buildLoaderMapData(structure)
  const mapResources = buildMapResources(mapData)
  if (!Array.isArray(mapResources)) throw new Error('buildHallMapResources(mapData) must return an array')
  const actualMapSources = new Set()
  for (const [index, resource] of mapResources.entries()) {
    const referencedBy = `src/game/resources.js:buildHallMapResources[${index}]`
    const { path } = validateRuntimeResource(resource, referencedBy, new Set(['image']))
    const expected = expectedReferences.get(path)
    if (!expected) throw new Error(`buildHallMapResources returned unexpected TMX resource: ${path}`)
    actualMapSources.add(path)
    for (const sourceLabel of expected) addReference(resource, sourceLabel, new Set(['image']))
  }
  assertExactReferenceSet('buildHallMapResources', actualMapSources, new Set(expectedReferences.keys()))

  const personaEntries = Object.entries(personaManifest.personas)
  if (personaEntries.length === 0) throw new Error('PERSONA_SPRITE_MANIFEST.personas must not be empty')
  for (const [personaKey, definition] of personaEntries) {
    if (!definition || typeof definition !== 'object') {
      throw new Error(`Invalid persona definition for ${personaKey}`)
    }
    const resource = buildSpriteResource(definition)
    addReference(resource, `src/game/sprites/personaSpriteManifest.ts:personas.${personaKey}`, new Set(['image']))
  }

  const byPath = new Map(network.map(entry => [entry.path, entry]))
  const missingReferences = [...references.keys()].filter(path => !byPath.has(path)).sort()
  if (missingReferences.length > 0) {
    throw new Error(`Runtime asset references missing from public/juyiting: ${missingReferences.join(', ')}`)
  }

  const files = [...references.entries()]
    .map(([path, referencedBy]) => ({
      path,
      sizeBytes: byPath.get(path).sizeBytes,
      sha256: byPath.get(path).sha256,
      category: byPath.get(path).category,
      role: byPath.get(path).role,
      referencedBy: [...referencedBy].sort(),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

  const loaderContractChecks = {
    hallBootResourcesConsumed: true,
    tmxTilesetImagesConsumed: coverage.tilesetImages === 0 || coverage.tilesetImages === actualCoverage(structure, actualMapSources, 'tileset-image'),
    tmxCollectionTilesConsumed: coverage.collectionTiles === 0 || coverage.collectionTiles === actualCoverage(structure, actualMapSources, 'collection-tile'),
    tmxImageLayersConsumed: coverage.imageLayers === 0 || coverage.imageLayers === actualCoverage(structure, actualMapSources, 'image-layer'),
    personaSpriteResourcesConsumed: personaEntries.length > 0,
  }
  const failedChecks = Object.entries(loaderContractChecks).filter(([, passed]) => !passed).map(([name]) => name)
  if (failedChecks.length > 0) throw new Error(`Runtime loader contract checks failed: ${failedChecks.join(', ')}`)

  return {
    files,
    referencePaths: new Set(files.map(entry => entry.path)),
    missingReferences,
    sources: {
      bootLoader: 'executable src/game/resources.js HALL_BOOT_RESOURCES export',
      mapImages: 'parseTmxStructure(hall.tmx) adapted into executable buildHallMapResources export',
      personaSprites: 'executable PERSONA_SPRITE_MANIFEST definitions mapped by buildPersonaSpriteResource export',
    },
    pathCanonicalization: {
      implementation: 'scripts/juyiting/lib/juyiting-public-path.mjs',
      outputPrefix: 'public/juyiting/',
      policy: 'WHATWG-checked ASCII unreserved segments only; percent encoding, dot/empty segments, backslash, controls, origin/host, query, and hash fail closed.',
    },
    loaderContractChecks,
  }
}

export function buildLoaderMapData(structure) {
  const expectedReferences = new Map()
  const coverage = { tilesetImages: 0, collectionTiles: 0, imageLayers: 0 }
  const remember = (source, label, kind) => {
    if (!source) return undefined
    const path = tmxSourceToPublicPath(source)
    if (!expectedReferences.has(path)) expectedReferences.set(path, new Set())
    expectedReferences.get(path).add(label)
    coverage[kind] += 1
    return `/${path.slice('public/'.length)}`
  }

  const tilesets = structure.tilesets.map(tileset => ({
    name: tileset.name,
    tilesetResourceName: tileset.name,
    imageSource: remember(
      tileset.image,
      `public/juyiting/hall.tmx:tileset:${tileset.name}`,
      'tilesetImages',
    ),
    tiles: tileset.tiles.map(tile => ({
      resourceName: `${tileset.name}-tile-${tile.id}`,
      source: remember(
        tile.image,
        `public/juyiting/hall.tmx:tileset:${tileset.name}:tile:${tile.id}`,
        'collectionTiles',
      ),
    })),
  }))

  const imageLayers = Object.fromEntries(
    structure.layers
      .filter(layer => layer.kind === 'imagelayer')
      .map(layer => [layer.name, {
        id: layer.name,
        resourceName: layer.name,
        source: remember(
          layer.source,
          `public/juyiting/hall.tmx:imagelayer:${layer.name}`,
          'imageLayers',
        ),
      }]),
  )

  return { mapData: { tilesets, imageLayers }, expectedReferences, coverage }
}

function validateRuntimeResource(resource, referencedBy, allowedTypes) {
  if (!resource || typeof resource !== 'object') throw new Error(`Invalid runtime resource from ${referencedBy}`)
  if (typeof resource.name !== 'string' || resource.name.trim() === '') {
    throw new Error(`Runtime resource from ${referencedBy} is missing name`)
  }
  if (!allowedTypes.has(resource.type)) {
    throw new Error(`Unsupported runtime resource type from ${referencedBy}: ${JSON.stringify(resource.type)}`)
  }
  if (typeof resource.src !== 'string' || resource.src.trim() === '') {
    throw new Error(`Runtime resource from ${referencedBy} is missing src`)
  }
  return { path: runtimeSourceToPublicPath(resource.src) }
}

function runtimeSourceToPublicPath(source) {
  return canonicalizeJuyitingRuntimeSource(source)
}

function tmxSourceToPublicPath(source) {
  return canonicalizeJuyitingTmxSource(source)
}

function assertExactReferenceSet(label, actual, expected) {
  const missing = [...expected].filter(path => !actual.has(path)).sort()
  const unexpected = [...actual].filter(path => !expected.has(path)).sort()
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`${label} reference mismatch; missing=[${missing.join(', ')}] unexpected=[${unexpected.join(', ')}]`)
  }
}

function actualCoverage(structure, actualSources, kind) {
  if (kind === 'tileset-image') {
    return structure.tilesets.filter(tileset => tileset.image && actualSources.has(tmxSourceToPublicPath(tileset.image))).length
  }
  if (kind === 'collection-tile') {
    return structure.tilesets.flatMap(tileset => tileset.tiles)
      .filter(tile => tile.image && actualSources.has(tmxSourceToPublicPath(tile.image))).length
  }
  return structure.layers
    .filter(layer => layer.kind === 'imagelayer' && layer.source && actualSources.has(tmxSourceToPublicPath(layer.source))).length
}

function buildTextureEstimate(runtimeFiles, canonicalPath, root) {
  const imageFiles = runtimeFiles.filter(entry => /\.(?:png|webp)$/i.test(entry.path))
  const rows = imageFiles.map(entry => {
    const dims = imageDimensions(resolveJuyitingPublicFile(root, entry.path))
    return {
      path: entry.path,
      role: entry.role,
      sha256: entry.sha256,
      width: dims.width,
      height: dims.height,
      bpp: 4,
      decodedBytes: dims.width * dims.height * 4,
    }
  })

  const contentGroups = new Map()
  for (const row of rows) {
    if (!contentGroups.has(row.sha256)) contentGroups.set(row.sha256, [])
    contentGroups.get(row.sha256).push(row)
  }
  const duplicates = []
  let uniqueContentDecodedBytes = 0
  for (const [sha256, group] of contentGroups) {
    const representative = group.find(row => row.path === canonicalPath) ?? group[0]
    uniqueContentDecodedBytes += representative.decodedBytes
    if (group.length > 1) {
      duplicates.push({
        sha256,
        representativePath: representative.path,
        paths: group.map(row => row.path).sort(),
        decodedBytesPerPath: representative.decodedBytes,
        duplicateContentOverheadBytes: representative.decodedBytes * (group.length - 1),
      })
    }
  }
  const loadedPathDecodedBytes = sum(rows.map(row => row.decodedBytes))
  return {
    bpp: 4,
    rows,
    loadedPathDecodedBytes,
    uniqueContentDecodedBytes,
    duplicateContentOverheadBytes: loadedPathDecodedBytes - uniqueContentDecodedBytes,
    duplicateContentGroups: duplicates.sort((a, b) => a.sha256.localeCompare(b.sha256)),
    note: 'Each actually referenced image path contributes decodedBytes exactly once. uniqueContentDecodedBytes deduplicates rows by file SHA-256; duplicateContentOverheadBytes = loadedPathDecodedBytes - uniqueContentDecodedBytes.',
  }
}

function buildArtifactReport() {
  try {
    const files = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = resolve(dir, name)
        const stat = statSync(full)
        if (stat.isDirectory()) walk(full)
        else if (stat.isFile()) files.push({ path: relative(distDir, full).replaceAll('\\', '/'), sizeBytes: stat.size })
      }
    }
    walk(distDir)
    return {
      status: 'measured',
      distDir: 'dist/ (gitignored; rebuilt locally)',
      fileCount: files.length,
      totalBytes: sum(files.map(entry => entry.sizeBytes)),
      largestFiles: files.sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 8),
    }
  } catch {
    return {
      status: 'not_generated',
      distDir: 'dist/ (gitignored; rebuilt locally)',
      note: 'dist/ not present. Run npm run build before generating/verifying the committed asset report.',
    }
  }
}

function imageDimensions(path) {
  const bytes = readFileSync(path)
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const type = bytes.subarray(offset, offset + 4).toString('ascii')
      const length = bytes.readUInt32LE(offset + 4)
      const chunk = bytes.subarray(offset + 8, offset + 8 + length)
      if (type === 'VP8X' && chunk.length >= 10) return { width: 1 + chunk.readUIntLE(4, 3), height: 1 + chunk.readUIntLE(7, 3) }
      if (type === 'VP8 ' && chunk.length >= 10) return { width: chunk.readUInt16LE(6) & 0x3fff, height: chunk.readUInt16LE(8) & 0x3fff }
      offset += 8 + length + (length % 2)
    }
    throw new Error(`Unsupported WebP at ${path}`)
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function sum(values) {
  return values.reduce((acc, value) => acc + value, 0)
}

export function serializeAssetReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`
}

export function runAssetReport(args = process.argv.slice(2)) {
  const mode = parseArguments(args)
  const existingFixture = readJsonIfPresent(fixturePath)
  if (!existingFixture) {
    throw new Error('Juyiting asset report verification requires a committed fixture with the locked baselineCommit')
  }
  fixtureBaselineCommit(existingFixture)
  const report = buildAssetReport()
  const json = serializeAssetReport(report)
  if (mode === 'stdout') {
    process.stdout.write(json)
    return report
  }
  if (mode === 'update') {
    atomicWriteUtf8(fixturePath, json, 'Juyiting asset-report fixture')
    console.log(`Juyiting asset report updated: ${fixturePath}`)
    return report
  }
  const committed = readRequiredFile(fixturePath, 'Juyiting asset-report fixture', 'utf8')
  if (report.buildArtifact.status === 'not_generated' && committed !== json) {
    throw new Error('Juyiting asset report mismatch (dist/ missing locally). Run npm run build, then npm run asset:juyiting-report -- --update.')
  }
  if (committed !== json) {
    throw new Error('Juyiting asset report mismatch. Run npm run build, then npm run asset:juyiting-report -- --update.')
  }
  console.log('Juyiting asset report valid')
  return report
}

function parseArguments(args) {
  if (args.length === 0) return 'verify'
  if (args.length === 1 && args[0] === '--update') return 'update'
  if (args.length === 1 && args[0] === '--stdout') return 'stdout'
  throw new Error(`Unknown arguments: ${args.join(' ')}`)
}

function readRequiredFile(path, label) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} is missing: ${path}`)
    throw new Error(`Unable to read ${label} at ${path}: ${error?.code ?? error}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runAssetReport()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
