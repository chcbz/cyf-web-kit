/**
 * E1: Juyiting baseline asset + texture-memory report.
 *
 * Records (machine-readable, committed fixture):
 *   1. initial production build artifact size (dist/ is gitignored; measured when present)
 *   2. auditable runtime asset references derived from resources.js, hall.tmx, and the persona sprite manifest
 *   3. decoded texture-size estimate (w×h×4 per actually referenced image path; content hashes deduplicated separately)
 *   4. draw call / runtime performance -> BLOCKED at E1 (no reliable automated sampling
 *      harness on this host); no numbers are fabricated.
 *
 * Output:
 *   tests/fixtures/juyiting/occlusion-v0/asset-report.json
 *
 * CLI contract: no args verifies the committed fixture; --update rewrites it; --stdout prints.
 * Verify mode requires dist/ to exist (run `npm run build` first); when dist/ is absent the
 * buildArtifact section is recorded as not_generated and verify skips only that section.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseTmxStructure, sha256Bytes } from './lib/tmx-structure.mjs'
import { assertBaselineProvenance, fixtureBaselineCommit } from './lib/baseline-provenance.mjs'

const worktreeRoot = fileURLToPath(new URL('../../', import.meta.url))
const tmxPath = process.env.JIA_JUYITING_TMX_PATH
  ?? fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
const fixtureDir = process.env.JIA_JUYITING_OCCLUSION_FIXTURE_DIR
  ?? fileURLToPath(new URL('../../tests/fixtures/juyiting/occlusion-v0/', import.meta.url))
const fixturePath = resolve(fixtureDir, 'asset-report.json')
const sourceHashesPath = resolve(fixtureDir, 'source-hashes.json')
const distDir = resolve(worktreeRoot, 'dist')
const resourcesPath = resolve(worktreeRoot, 'src/game/resources.js')
const spriteManifestPath = resolve(worktreeRoot, 'src/game/sprites/personaSpriteManifest.ts')

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

  const network = enumerateNetworkAssets()
  const runtimeReferenceAudit = buildRuntimeReferenceAudit(tmxBytes, network)
  const textures = buildTextureEstimate(runtimeReferenceAudit.files, sourceHashes.canonicalSource.path)

  return {
    schemaVersion: 1,
    generatedBy: 'scripts/juyiting/asset-report-juyiting.mjs',
    baselineCommit,
    tmxSha256,
    buildArtifact: buildArtifactReport(),
    juyitingNetworkAssets: {
      totalPublicTreeBytes: sum(network.map(entry => entry.sizeBytes)),
      runtimeCoreBytes: sum(runtimeReferenceAudit.files.map(entry => entry.sizeBytes)),
      runtimeCoreFiles: runtimeReferenceAudit.files,
      runtimeReferenceAudit: {
        sources: runtimeReferenceAudit.sources,
        loaderContractChecks: runtimeReferenceAudit.loaderContractChecks,
        missingReferences: runtimeReferenceAudit.missingReferences,
      },
      files: network.map(entry => ({
        ...entry,
        runtimeReferenced: runtimeReferenceAudit.referencePaths.has(entry.path),
      })),
      note: 'runtimeCoreBytes is the exact sum of runtimeCoreFiles derived from resources.js boot wiring, hall.tmx image/tileset refs, and personaSpriteManifest.ts sprite src values. Directory membership alone is not treated as a runtime reference.',
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

function enumerateNetworkAssets() {
  const publicRoot = fileURLToPath(new URL('../../public/juyiting/', import.meta.url))
  const entries = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (stat.isFile()) {
        const rel = relative(fileURLToPath(new URL('../../public/', import.meta.url)), full).replaceAll('\\', '/')
        const category = categoryFor(rel)
        const role = rel === 'juyiting/images/liangshan-hall-mid-occluders-v3.webp' ? 'canonical-occluder'
          : rel === 'juyiting/images/liangshan-hall-foreground-occluders-v3.webp' ? 'duplicate-occluder'
            : category
        entries.push({
          path: `public/${rel}`,
          sizeBytes: stat.size,
          sha256: sha256Bytes(readFileSync(full)),
          category,
          role,
        })
      }
    }
  }
  walk(publicRoot)
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

function categoryFor(relativePath) {
  for (const [category, prefixes] of Object.entries(ASSET_CATEGORY_RULES)) {
    if (prefixes.some(prefix => prefix.endsWith('/') ? relativePath.includes(prefix) : relativePath === prefix)) return category
  }
  return 'other'
}

function buildRuntimeReferenceAudit(tmxText, network) {
  const resourcesSource = readRequiredFile(resourcesPath, 'Juyiting resources.js')
  const spriteManifestSource = readRequiredFile(spriteManifestPath, 'Juyiting persona sprite manifest')
  const structure = parseTmxStructure(tmxText)
  const references = new Map()
  const addReference = (publicPath, referencedBy) => {
    const normalized = publicPath.startsWith('public/')
      ? publicPath
      : `public/${publicPath.replace(/^\//, '')}`
    if (!references.has(normalized)) references.set(normalized, new Set())
    references.get(normalized).add(referencedBy)
  }

  const bootMatch = resourcesSource.match(/HALL_MAP_RESOURCE\s*=\s*\{[^}]*src:\s*['"]([^'"]+)['"]/s)
  if (!bootMatch) throw new Error('Unable to derive HALL_MAP_RESOURCE src from src/game/resources.js')
  addReference(bootMatch[1], 'src/game/resources.js:HALL_MAP_RESOURCE')

  const tmxPublicDir = dirname(relative(worktreeRoot, tmxPath).replaceAll('\\', '/'))
  const addTmxReference = (source, referencedBy) => {
    if (!source) return
    addReference(relative(worktreeRoot, resolve(worktreeRoot, tmxPublicDir, source)).replaceAll('\\', '/'), referencedBy)
  }
  for (const tileset of structure.tilesets) {
    addTmxReference(tileset.image, `public/juyiting/hall.tmx:tileset:${tileset.name}`)
    for (const tile of tileset.tiles) {
      addTmxReference(tile.image, `public/juyiting/hall.tmx:tileset:${tileset.name}:tile:${tile.id}`)
    }
  }
  for (const layer of structure.layers.filter(layer => layer.kind === 'imagelayer')) {
    addTmxReference(layer.source, `public/juyiting/hall.tmx:imagelayer:${layer.name}`)
  }

  const spriteSources = [...spriteManifestSource.matchAll(/src:\s*['"](\/juyiting\/sprites\/[^'"]+)['"]/g)]
    .map(match => match[1])
  if (spriteSources.length === 0) throw new Error('No persona sprite src values found in personaSpriteManifest.ts')
  for (const source of spriteSources) addReference(source, 'src/game/sprites/personaSpriteManifest.ts:personas')

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

  return {
    files,
    referencePaths: new Set(files.map(entry => entry.path)),
    missingReferences,
    sources: {
      bootLoader: 'src/game/resources.js:HALL_MAP_RESOURCE',
      mapImages: 'public/juyiting/hall.tmx tileset/image-layer refs consumed by buildHallMapResources',
      personaSprites: 'src/game/sprites/personaSpriteManifest.ts persona src values consumed by buildPersonaSpriteResource',
    },
    loaderContractChecks: {
      hallBootResourceDeclared: resourcesSource.includes('HALL_BOOT_RESOURCES = [HALL_MAP_RESOURCE]'),
      tmxTilesetImagesConsumed: resourcesSource.includes('tileset.imageSource || tileset.source'),
      tmxCollectionTilesConsumed: resourcesSource.includes('tile.source'),
      tmxImageLayersConsumed: resourcesSource.includes('mapData?.imageLayers'),
      personaSpriteMappingConsumed: resourcesSource.includes('buildPersonaSpriteResource'),
    },
  }
}

function buildTextureEstimate(runtimeFiles, canonicalPath) {
  const imageFiles = runtimeFiles.filter(entry => /\.(?:png|webp)$/i.test(entry.path))
  const rows = imageFiles.map(entry => {
    const dims = imageDimensions(resolve(worktreeRoot, entry.path))
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
  const report = buildAssetReport()
  const json = serializeAssetReport(report)
  if (mode === 'stdout') {
    process.stdout.write(json)
    return report
  }
  if (mode === 'update') {
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(fixturePath, json, 'utf8')
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
