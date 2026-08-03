/**
 * E1: Juyiting baseline asset + texture-memory report.
 *
 * Records (machine-readable, committed fixture):
 *   1. initial production build artifact size (dist/ is gitignored; measured when present)
 *   2. juyiting network asset bytes (TMX, image layers, props, tiles, persona sheets)
 *   3. decoded texture-size estimate (w×h×4 RGBA per image; duplicate occluder counted twice)
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

import { sha256Bytes } from './lib/tmx-structure.mjs'
import { assertBaselineProvenance, fixtureBaselineCommit } from './lib/baseline-provenance.mjs'

const worktreeRoot = fileURLToPath(new URL('../../', import.meta.url))
const tmxPath = process.env.JIA_JUYITING_TMX_PATH
  ?? fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
const fixtureDir = process.env.JIA_JUYITING_OCCLUSION_FIXTURE_DIR
  ?? fileURLToPath(new URL('../../tests/fixtures/juyiting/occlusion-v0/', import.meta.url))
const fixturePath = resolve(fixtureDir, 'asset-report.json')
const sourceHashesPath = resolve(fixtureDir, 'source-hashes.json')
const distDir = resolve(worktreeRoot, 'dist')

const ASSET_CATEGORY_RULES = {
  tmx: ['juyiting/hall.tmx'],
  'map-layer': ['juyiting/images/liangshan-hall-base-clean-v3.webp', 'juyiting/images/liangshan-hall-mid-occluders-v3.webp', 'juyiting/images/liangshan-hall-foreground-occluders-v3.webp', 'juyiting/images/liangshan-hall-lighting-overlay-v3.webp'],
  prop: ['juyiting/images/props/'],
  tiles: ['juyiting/tiles/'],
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
  const textures = buildTextureEstimate(sourceHashes)

  return {
    schemaVersion: 1,
    generatedBy: 'scripts/juyiting/asset-report-juyiting.mjs',
    baselineCommit,
    tmxSha256,
    buildArtifact: buildArtifactReport(),
    juyitingNetworkAssets: {
      totalBytes: sum(network.map(entry => entry.sizeBytes)),
      runtimeCoreBytes: sum(network.filter(entry => ['tmx', 'map-layer', 'canonical-occluder', 'duplicate-occluder', 'prop', 'tiles', 'sprite'].includes(entry.category)).map(entry => entry.sizeBytes)),
      runtimeCoreNote: 'runtimeCore excludes dev-preview-modular images (not loaded by the game runtime).',
      files: network,
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

function buildTextureEstimate(sourceHashes) {
  const rows = []
  const uniqueBytes = new Map()
  for (const entry of sourceHashes.entries) {
    if (!['map-layer', 'canonical-occluder-source', 'duplicate-occluder', 'prop', 'tmx'].includes(entry.role)) continue
    if (entry.role === 'tmx') continue
    const full = resolve(worktreeRoot, entry.path)
    const dims = imageDimensions(full)
    const decodedBytes = dims.width * dims.height * 4
    const duplicateOf = entry.role === 'duplicate-occluder' ? sourceHashes.canonicalSource.path : null
    const effectiveBytes = duplicateOf ? decodedBytes * 2 : decodedBytes
    uniqueBytes.set(entry.path, { decodedBytes, count: duplicateOf ? 2 : 1 })
    rows.push({
      path: entry.path,
      role: entry.role,
      width: dims.width,
      height: dims.height,
      bpp: 4,
      decodedBytes,
      duplicateOf,
      effectiveDecodedBytes: effectiveBytes,
    })
  }
  const totalDecoded = rows.reduce((acc, row) => acc + row.effectiveDecodedBytes, 0)
  const uniqueTotal = [...uniqueBytes.values()].reduce((acc, v) => acc + v.decodedBytes, 0)
  return {
    bpp: 4,
    rows,
    totalEffectiveDecodedBytes: totalDecoded,
    totalUniqueDecodedBytes: uniqueTotal,
    duplicateOccluderExtraBytes: totalDecoded - uniqueTotal,
    note: 'RGBA decode estimate (width×height×4). The duplicate mid/foreground occluder pair is counted twice because the current runtime loads both files.',
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
