#!/usr/bin/env node
/**
 * E9B deterministic six-region occluder atlas generator.
 *
 * Consumes the frozen E9A fragment ownership spec and the canonical WebP,
 * builds one lossless PNG atlas per home region (only ownershipRuns are copied
 * from canonical RGBA; every other sourceRect pixel is cleared to transparent),
 * reconstructs the full 1664x928 frame from the encoded atlases via the
 * manifest, and fails closed unless the golden comparison is pixel-exact
 * (0 missing / 0 overlap / 0 channel mismatch).
 *
 * All outputs (atlas PNGs, manifest, golden report, seam evidence reports and
 * contact sheets) are installed in a single binary-safe transactional batch.
 * Regeneration is byte-for-byte deterministic.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { atomicWriteBytesBatch } from './lib/atomic-write-bytes.mjs'
import {
  ATLAS_OUTPUT_DIR,
  CANONICAL_HEIGHT,
  CANONICAL_PATH,
  CANONICAL_WIDTH,
  E9A_GENERATION_ID,
  E9A_SPEC_PATH,
  E9B_FIXTURE_DIR,
  EXTRUSION_PIXELS,
  FORMAT_CHOICE,
  GOLDEN_REPORT_PATH,
  MANIFEST_PATH,
  REGION_ORDER,
  SEAM_EVIDENCE_DIR,
  SEAM_FOCUSES,
  SEAM_REPORT_PATH,
  ZOOMS,
  buildFragmentSprites,
  buildGoldenReport,
  buildManifest,
  buildSeamContactSheet,
  buildSeamEvidenceReport,
  compareGolden,
  decodeCanonicalRgba,
  decodePng,
  encodePng,
  jsonStringifyDeterministic,
  packRegionAtlas,
  reconstructFromManifest,
  sha256,
} from './lib/occluder-atlases-v2.mjs'
import { CANONICAL_EXPECTED_SHA256, CHROMIUM } from './lib/fragment-ownership-v2.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const require = createRequire(import.meta.url)

function resolveFromRepoRoot(path) {
  return join(REPO_ROOT, path)
}

function validateFocusCropCoverage(spec) {
  for (const focus of SEAM_FOCUSES) {
    const fragment = spec.fragments.find(candidate => candidate.stableId === focus.stableId)
    if (!fragment) throw new Error(`seam focus ${focus.id} references unknown stableId ${focus.stableId}`)
    const crop = focus.crop
    if (crop.y > 580 || crop.y + crop.height <= 580) {
      throw new Error(`seam focus ${focus.id} crop does not contain y=580`)
    }
    let crossingOwnedPixels = 0
    for (const [y, xStart, xEnd] of fragment.ownershipRuns) {
      if (y !== 580) continue
      const clippedStart = Math.max(xStart, crop.x)
      const clippedEnd = Math.min(xEnd, crop.x + crop.width)
      crossingOwnedPixels += Math.max(0, clippedEnd - clippedStart)
    }
    if (crossingOwnedPixels === 0) {
      throw new Error(`seam focus ${focus.id} crop contains no owned pixels at y=580 for ${focus.stableId}`)
    }
  }
}

export function generateOccluderAtlases({ specPath = E9A_SPEC_PATH, canonicalPath = CANONICAL_PATH, chromium = CHROMIUM } = {}) {
  const spec = JSON.parse(readFileSync(resolveFromRepoRoot(specPath), 'utf8'))
  if (spec.generationId !== E9A_GENERATION_ID) {
    throw new Error(`E9A generationId mismatch: expected ${E9A_GENERATION_ID}, got ${spec.generationId}`)
  }
  validateFocusCropCoverage(spec)

  const canonicalBytes = readFileSync(resolveFromRepoRoot(canonicalPath))
  const canonicalSha = sha256(canonicalBytes)
  if (canonicalSha !== CANONICAL_EXPECTED_SHA256) {
    throw new Error(`Canonical SHA-256 mismatch: expected ${CANONICAL_EXPECTED_SHA256}, got ${canonicalSha}`)
  }

  const decoded = decodeCanonicalRgba(canonicalBytes, { chromium })
  const canonicalRgba = decoded.rgba

  const sprites = buildFragmentSprites(spec, canonicalRgba, { width: CANONICAL_WIDTH, height: CANONICAL_HEIGHT })
  const atlases = new Map()
  const packingOrder = new Map()
  let packingIndex = 0
  for (const region of REGION_ORDER) {
    const fragments = spec.fragments.filter(fragment => fragment.homeRegion === region)
    const packed = packRegionAtlas(fragments, sprites, { extrusion: EXTRUSION_PIXELS })
    const bytes = encodePng(packed.width, packed.height, packed.data)
    for (const placement of packed.placements) packingOrder.set(placement.stableId, packingIndex++)
    atlases.set(region, {
      region,
      width: packed.width,
      height: packed.height,
      data: packed.data,
      bytes,
      placements: packed.placements,
    })
  }

  const pngjsVersion = JSON.parse(readFileSync(join(REPO_ROOT, 'node_modules/pngjs/package.json'), 'utf8')).version
  const generatorInfo = {
    script: 'scripts/juyiting/generate-occluder-atlases.mjs',
    nodeVersion: process.version,
    pngjsVersion,
    chromium,
    format: FORMAT_CHOICE.chosen,
    formatChoiceRationale: FORMAT_CHOICE.rationale,
  }

  const manifest = buildManifest(spec, atlases, sprites, packingOrder, canonicalSha, canonicalBytes, generatorInfo)

  // Independent decode path: pngjs decode of each atlas PNG + manifest placement.
  const decodedAtlases = REGION_ORDER.map(region => {
    const atlas = atlases.get(region)
    const decodedPng = decodePng(atlas.bytes)
    if (decodedPng.width !== atlas.width || decodedPng.height !== atlas.height) {
      throw new Error(`atlas ${region} decode dimensions mismatch`)
    }
    return { file: manifest.atlases.find(entry => entry.region === region).file, width: decodedPng.width, height: decodedPng.height, rgba: decodedPng.rgba }
  })

  const { canvas: reconstructed } = reconstructFromManifest(manifest, decodedAtlases, { width: CANONICAL_WIDTH, height: CANONICAL_HEIGHT })
  const golden = compareGolden(canonicalRgba, reconstructed, spec, { width: CANONICAL_WIDTH, height: CANONICAL_HEIGHT })
  if (!golden.passed) {
    throw new Error(`golden comparison failed before install: ${JSON.stringify({ missing: golden.missingPixels, overlap: golden.overlapPixels, channelMismatch: golden.channelMismatchPixels })}`)
  }

  // Zoom seam evidence: canonical vs reconstructed at all required zooms.
  const seamSheets = SEAM_FOCUSES.map(focus => buildSeamContactSheet(focus, ZOOMS, canonicalRgba, reconstructed))
  const cellsByFocus = seamSheets.map(sheet => sheet.cells)
  const seamReport = buildSeamEvidenceReport(SEAM_FOCUSES, ZOOMS, cellsByFocus, manifest.manifestId)
  if (!seamReport.allExact) {
    throw new Error('zoom seam evidence is not exact at every focus/zoom')
  }

  const goldenReport = buildGoldenReport(manifest, golden, canonicalRgba, [...atlases.values()].map(atlas => ({
    region: atlas.region,
    width: atlas.width,
    height: atlas.height,
    bytes: atlas.bytes.length,
    placements: atlas.placements,
  })), canonicalBytes, reconstructed)

  const entries = [
    ...REGION_ORDER.map(region => ({
      path: resolveFromRepoRoot(join(ATLAS_OUTPUT_DIR, `${region}-v2.png`)),
      bytes: atlases.get(region).bytes,
      label: `atlas ${region}`,
    })),
    { path: resolveFromRepoRoot(MANIFEST_PATH), bytes: Buffer.from(jsonStringifyDeterministic(manifest), 'utf8'), label: 'E9B manifest' },
    { path: resolveFromRepoRoot(GOLDEN_REPORT_PATH), bytes: Buffer.from(jsonStringifyDeterministic(goldenReport), 'utf8'), label: 'E9B golden report' },
    { path: resolveFromRepoRoot(SEAM_REPORT_PATH), bytes: Buffer.from(jsonStringifyDeterministic(seamReport), 'utf8'), label: 'E9B seam evidence report' },
    ...SEAM_FOCUSES.map((focus, index) => ({
      path: resolveFromRepoRoot(join(SEAM_EVIDENCE_DIR, `contact-sheet-${String(focus.index).padStart(2, '0')}-${focus.id}.svg`)),
      bytes: Buffer.from(seamSheets[index].svg, 'utf8'),
      label: `seam contact sheet ${focus.id}`,
    })),
  ]

  atomicWriteBytesBatch(entries, 'E9B occluder atlas batch', {})

  return {
    taskId: 'E9B',
    generationId: E9A_GENERATION_ID,
    manifestId: manifest.manifestId,
    golden: {
      passed: golden.passed,
      missingPixels: golden.missingPixels,
      overlapPixels: golden.overlapPixels,
      channelMismatchPixels: golden.channelMismatchPixels,
    },
    transparentRgb: {
      canonicalAlpha0NonZeroRgb: golden.transparentRgb.canonicalAlpha0NonZeroRgb,
    },
    metrics: {
      networkBytes: goldenReport.metrics.networkBytes,
      decodedTextureAreaPx: goldenReport.metrics.decodedTextureAreaPx,
      packedSpriteAreaPx: goldenReport.metrics.packedSpriteAreaPx,
      packingEfficiency: goldenReport.metrics.packingEfficiency,
      canonicalSourceBytes: canonicalBytes.length,
    },
    atlases: manifest.atlases.map(atlas => ({
      region: atlas.region,
      file: atlas.file,
      sha256: atlas.sha256,
      width: atlas.width,
      height: atlas.height,
      bytes: atlas.bytes,
      fragmentCount: atlas.fragmentCount,
    })),
    seamEvidence: {
      allExact: seamReport.allExact,
      zooms: ZOOMS,
      focuses: SEAM_FOCUSES.map(focus => focus.id),
    },
    installedFiles: entries.map(entry => entry.path.slice(REPO_ROOT.length + 1)),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = generateOccluderAtlases()
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}
