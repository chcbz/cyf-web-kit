#!/usr/bin/env node
/**
 * E9B fail-closed validator for the six-region occluder atlas manifest.
 *
 * Structural phase (no image decode): provenance bindings, atlas presence and
 * SHA-256, dimensions, fragment mapping geometry, packing order, non-overlap,
 * bounds, format, and deterministic ordering.
 *
 * Golden phase (unless --no-golden): independently decodes the six atlas PNGs
 * and the canonical WebP, reconstructs 1664x928 via the manifest, and requires
 * 0 missing / 0 overlap / 0 channel mismatch against canonical full RGBA, plus
 * the transparent-RGB policy and exact zoom seam evidence.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

import {
  ALPHA_THRESHOLD,
  ATLAS_OUTPUT_DIR,
  CANONICAL_EXPECTED_SHA256,
  CANONICAL_HEIGHT,
  CANONICAL_PATH,
  CANONICAL_WIDTH,
  E9A_GENERATION_ID,
  E9A_SPEC_PATH,
  EXTRUSION_PIXELS,
  FORMAT_CHOICE,
  MANIFEST_PATH,
  PADDING_PIXELS,
  REGION_DEFS,
  REGION_ORDER,
  SEAM_FOCUSES,
  ZOOMS,
  atlasFilePath,
  compareGolden,
  decodeCanonicalRgba,
  decodePng,
  reconstructFromManifest,
  regionAtlasWidth,
  scaledCropComparison,
  transparentRgbAnalysis,
} from './lib/occluder-atlases-v2.mjs'
import { E8B_TMX_SHA256, CHROMIUM } from './lib/fragment-ownership-v2.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

function resolveFromRepoRoot(path) {
  return join(REPO_ROOT, path)
}

function validateStructural(manifest, spec, errors, warnings) {
  if (manifest.$schema !== 'jyt.occlusion.atlas-manifest.v1' || manifest.schemaVersion !== 1) {
    errors.push('manifest must use jyt.occlusion.atlas-manifest.v1 / schemaVersion 1')
  }
  if (manifest.taskId !== 'E9B') errors.push('manifest taskId must be E9B')
  if (manifest.e9aGenerationId !== E9A_GENERATION_ID) {
    errors.push(`E9A generationId mismatch: expected ${E9A_GENERATION_ID}, got ${manifest.e9aGenerationId}`)
  }
  if (manifest.generationId !== E9A_GENERATION_ID) errors.push('manifest generationId must equal the frozen E9A generationId')
  if (manifest.canonical?.sha256 !== CANONICAL_EXPECTED_SHA256) errors.push('manifest canonical SHA-256 must remain frozen')
  if (manifest.canonical?.width !== CANONICAL_WIDTH || manifest.canonical?.height !== CANONICAL_HEIGHT) errors.push('manifest canonical dimensions must be 1664x928')
  if (manifest.e8bTmx?.sha256 !== E8B_TMX_SHA256) errors.push('manifest E8B TMX SHA-256 must remain frozen')
  if (!manifest.generator?.script || !manifest.generator?.nodeVersion || !manifest.generator?.pngjsVersion || !manifest.generator?.format) {
    errors.push('manifest generator/tool versions must be recorded')
  }
  if (!manifest.manifestId || !/^[a-f0-9]{64}$/.test(manifest.manifestId)) errors.push('manifest manifestId must be a sha256 hex string')
  if (JSON.stringify(manifest.canonical?.path) !== JSON.stringify(CANONICAL_PATH)) errors.push('manifest canonical path must match')

  const specIds = spec.fragments.map(fragment => fragment.stableId)
  const manifestIds = manifest.fragments?.map(fragment => fragment.stableId) ?? []
  if (JSON.stringify(manifestIds) !== JSON.stringify(specIds)) {
    errors.push('manifest fragment order/ids must exactly match the frozen spec stableId order')
  }
  if (new Set(manifestIds).size !== manifestIds.length) errors.push('manifest contains duplicate stableId')

  const expectedAtlases = REGION_ORDER.map(region => ({
    region,
    file: atlasFilePath(region),
    width: regionAtlasWidth(region),
  }))
  const manifestAtlases = manifest.atlases ?? []
  if (manifestAtlases.length !== 6 || JSON.stringify(manifestAtlases.map(atlas => atlas.region)) !== JSON.stringify(REGION_ORDER)) {
    errors.push('manifest must list exactly the six regions in REGION_ORDER')
  }

  const atlasByRegion = new Map()
  for (const atlas of manifestAtlases) {
    const expected = expectedAtlases.find(entry => entry.region === atlas.region)
    if (!expected) { errors.push(`unknown atlas region ${atlas.region}`); continue }
    if (atlas.file !== expected.file) errors.push(`atlas ${atlas.region} file must be ${expected.file}`)
    const filePath = resolveFromRepoRoot(atlas.file)
    if (!existsSync(filePath)) { errors.push(`atlas file missing: ${atlas.file}`); continue }
    const bytes = readFileSync(filePath)
    if (atlas.sha256 !== createHash('sha256').update(bytes).digest('hex')) errors.push(`atlas ${atlas.region} SHA-256 mismatch (tampered file)`)
    if (atlas.bytes !== bytes.length) errors.push(`atlas ${atlas.region} byte length mismatch`)
    if (bytes.length < 8 || bytes.readUInt32BE(0) !== 0x89504e47) errors.push(`atlas ${atlas.region} is not a PNG file`)
    const decoded = PNG.sync.read(bytes)
    if (decoded.width !== atlas.width || decoded.height !== atlas.height) errors.push(`atlas ${atlas.region} decoded dimensions mismatch`)
    if (atlas.width !== expected.width) errors.push(`atlas ${atlas.region} width must equal its home region chunk width (${expected.width})`)
    if (atlas.fragmentCount !== manifest.fragments.filter(fragment => fragment.homeRegion === atlas.region).length) {
      errors.push(`atlas ${atlas.region} fragmentCount mismatch`)
    }
    if (JSON.stringify(atlas.packingOrder) !== JSON.stringify(manifest.fragments.filter(fragment => fragment.homeRegion === atlas.region).map(fragment => fragment.stableId))) {
      errors.push(`atlas ${atlas.region} packingOrder must equal home-region fragment stableId order`)
    }
    atlasByRegion.set(atlas.region, { atlas, decoded })
  }

  const rectsByAtlas = new Map()
  for (let index = 0; index < manifest.fragments.length; index++) {
    const mapping = manifest.fragments[index]
    const fragment = spec.fragments[index]
    if (!fragment || mapping.stableId !== fragment.stableId) { errors.push(`fragment ${index} stableId mismatch with spec`); continue }
    const atlas = atlasByRegion.get(mapping.homeRegion)
    if (!atlas) { errors.push(`fragment ${mapping.stableId} homeRegion has no atlas`); continue }
    if (mapping.atlasFile !== atlasFilePath(mapping.homeRegion)) errors.push(`fragment ${mapping.stableId} atlasFile mismatch`)
    if (mapping.encoding !== 'png' && mapping.encoding !== 'lossless-webp') errors.push(`fragment ${mapping.stableId} encoding must be lossless png or lossless-webp`)
    if (mapping.paddingPixels !== PADDING_PIXELS || mapping.extrusionPixels !== EXTRUSION_PIXELS) {
      errors.push(`fragment ${mapping.stableId} padding/extrusion must be ${PADDING_PIXELS}/${EXTRUSION_PIXELS}`)
    }
    if (JSON.stringify(mapping.destinationRect) !== JSON.stringify(mapping.sourceRect)) errors.push(`fragment ${mapping.stableId} destinationRect must equal sourceRect`)
    if (JSON.stringify(mapping.destinationRect) !== JSON.stringify(fragment.destinationRect)) errors.push(`fragment ${mapping.stableId} destinationRect must match spec`)
    if (JSON.stringify(mapping.sourceRect) !== JSON.stringify(fragment.sourceRect)) errors.push(`fragment ${mapping.stableId} sourceRect must match spec`)
    const rect = mapping.atlasRect
    const atlasInfo = atlas.atlas
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > atlasInfo.width || rect.y + rect.height > atlasInfo.height) {
      errors.push(`fragment ${mapping.stableId} atlasRect out of atlas bounds`)
    }
    const bounds = mapping.pixelBounds
    const source = mapping.sourceRect
    if (bounds.x < source.x || bounds.y < source.y || bounds.x + bounds.width > source.x + source.width || bounds.y + bounds.height > source.y + source.height) {
      errors.push(`fragment ${mapping.stableId} pixelBounds must lie within sourceRect`)
    }
    const expectedCount = fragment.ownedOpaquePixelCount
    if (mapping.ownedOpaquePixelCount !== expectedCount) errors.push(`fragment ${mapping.stableId} ownedOpaquePixelCount drift`)
    if (rect.width !== bounds.width + 2 * EXTRUSION_PIXELS || rect.height !== bounds.height + 2 * EXTRUSION_PIXELS) {
      errors.push(`fragment ${mapping.stableId} atlasRect must equal pixelBounds plus extrusion`)
    }
    if (!rectsByAtlas.has(mapping.homeRegion)) rectsByAtlas.set(mapping.homeRegion, [])
    rectsByAtlas.get(mapping.homeRegion).push({ stableId: mapping.stableId, rect })
  }

  for (const [region, rects] of rectsByAtlas) {
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const left = rects[i].rect
        const right = rects[j].rect
        if (left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y) {
          errors.push(`atlas ${region} packing overlap: ${rects[i].stableId} and ${rects[j].stableId}`)
        }
      }
    }
  }

  const expectedOrder = JSON.stringify(REGION_ORDER.map(region => manifest.fragments.filter(fragment => fragment.homeRegion === region).map(fragment => fragment.stableId)))
  const manifestOrder = JSON.stringify(REGION_ORDER.map(region => manifest.packingOrder?.[region]))
  if (expectedOrder !== manifestOrder) errors.push('manifest packingOrder permutation or drift')

  if (manifest.encoding?.format !== 'png' && manifest.encoding?.format !== 'lossless-webp') errors.push('manifest encoding format must be lossless png or lossless-webp')
  if (manifest.encoding?.lossless !== true) errors.push('manifest encoding must be lossless')
  if (manifest.packing?.algorithm !== 'deterministic-shelf') errors.push('manifest packing algorithm must be deterministic-shelf')
  if (JSON.stringify(manifest.packing?.extrusionPixels) !== JSON.stringify(EXTRUSION_PIXELS)) errors.push('manifest packing extrusionPixels mismatch')

  const expectedSpecSha = createHash('sha256').update(readFileSync(resolveFromRepoRoot(E9A_SPEC_PATH))).digest('hex')
  const recordedSpec = JSON.parse(readFileSync(resolveFromRepoRoot(E9A_SPEC_PATH), 'utf8'))
  if (recordedSpec.generationId !== E9A_GENERATION_ID) errors.push('frozen E9A spec generationId drift')
  warnings.push(`E9A spec file sha256=${expectedSpecSha}`)

  if (manifest.canonical.totalOpaquePixels !== spec.sourceProvenance.totalOpaquePixels) {
    errors.push('manifest canonical totalOpaquePixels must match spec')
  }
}

function validateGolden(manifest, spec, errors) {
  const canonicalPath = resolveFromRepoRoot(manifest.canonical.path)
  if (!existsSync(canonicalPath)) { errors.push(`canonical source missing: ${manifest.canonical.path}`); return }
  const canonicalBytes = readFileSync(canonicalPath)
  const canonicalSha = createHash('sha256').update(canonicalBytes).digest('hex')
  if (canonicalSha !== CANONICAL_EXPECTED_SHA256) errors.push('canonical source SHA-256 mismatch')

  const decoded = decodeCanonicalRgba(canonicalBytes)
  const canonicalRgba = decoded.rgba

  const decodedAtlases = []
  for (const atlas of manifest.atlases) {
    const filePath = resolveFromRepoRoot(atlas.file)
    if (!existsSync(filePath)) { errors.push(`atlas file missing: ${atlas.file}`); continue }
    const png = decodePng(readFileSync(filePath))
    if (png.width !== atlas.width || png.height !== atlas.height) errors.push(`atlas ${atlas.region} decoded dimensions mismatch`)
    decodedAtlases.push({ file: atlas.file, width: png.width, height: png.height, rgba: png.rgba })
  }
  if (errors.length > 0) return

  const { canvas: reconstructed } = reconstructFromManifest(manifest, decodedAtlases, { width: CANONICAL_WIDTH, height: CANONICAL_HEIGHT })
  const golden = compareGolden(canonicalRgba, reconstructed, spec, { width: CANONICAL_WIDTH, height: CANONICAL_HEIGHT })
  if (golden.missingPixels !== 0) errors.push(`golden missing pixels: ${golden.missingPixels}`)
  if (golden.overlapPixels !== 0) errors.push(`golden overlap pixels: ${golden.overlapPixels}`)
  if (golden.channelMismatchPixels !== 0) errors.push(`golden channel mismatch: ${JSON.stringify(golden.channelMismatchByChannel)}`)
  const canonicalTransparent = transparentRgbAnalysis(canonicalRgba, { width: CANONICAL_WIDTH, height: CANONICAL_HEIGHT })
  if (canonicalTransparent.alpha0NonZeroRgb !== 0) {
    errors.push(`canonical transparent-RGB policy violation: ${canonicalTransparent.alpha0NonZeroRgb} transparent pixels have non-zero RGB`)
  }
  for (const focus of SEAM_FOCUSES) {
    for (const zoom of ZOOMS) {
      const comparison = scaledCropComparison(canonicalRgba, reconstructed, focus.crop, zoom)
      if (!comparison.exact) {
        errors.push(`zoom seam evidence mismatch at ${focus.id} ${zoom}x: ${comparison.mismatchPixels} px, max delta ${comparison.maxChannelDelta}`)
      }
    }
  }
}

function main() {
  const args = process.argv.slice(2)
  const manifestArg = args.find(arg => !arg.startsWith('--'))
  const noGolden = args.includes('--no-golden')
  const manifestPath = manifestArg ? manifestArg : MANIFEST_PATH
  const manifest = JSON.parse(readFileSync(resolveFromRepoRoot(manifestPath), 'utf8'))
  const spec = JSON.parse(readFileSync(resolveFromRepoRoot(E9A_SPEC_PATH), 'utf8'))
  const errors = []
  const warnings = []
  validateStructural(manifest, spec, errors, warnings)
  if (!noGolden) validateGolden(manifest, spec, errors)
  if (errors.length > 0) {
    process.stderr.write(`E9B atlas validation FAILED:\n${errors.map(error => `- ${error}`).join('\n')}\n`)
    process.exit(1)
  }
  process.stdout.write(`E9B atlas validation PASSED: fragments=${manifest.fragments.length} atlases=${manifest.atlases.length} golden=${noGolden ? 'skipped' : 'exact'} warnings=${warnings.length}\n`)
}

main()
