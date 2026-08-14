#!/usr/bin/env node
/**
 * E13 · mask→structure mapping machine verifier (independent, read-only).
 *
 * Re-derives every mapping fact from the frozen source fixtures and the
 * committed manifest/SVG, then writes a machine-verifiable report:
 *   tests/fixtures/juyiting/occlusion-e13/mask-structure-mapping/mask-structure-mapping.verify.json
 *
 * Derived per-entry facts are recomputed from source data and never trusted
 * from the manifest:
 *   - maskBoundary.aabb / centroid        ← recomputed from maskBoundary.polygon
 *                                          (project tmx-structure polygonAabb /
 *                                          polygonCentroid definitions)
 *   - ownerBoundary.aabb / runsSha256     ← recomputed from E9A ownershipRuns
 *   - ownerOverlapEvidence (all 4 fields) ← recomputed from E9A ownershipRuns + polygon
 *       ownedPixelsInLegacyPolygon  = boundary-inclusive pixel-center test
 *       targetOwnedOpaquePixelCount = half-open ownershipRuns sum (== declared opaque count)
 *       actualOwnerCount            = fragments with ≥1 owned pixel inside the polygon
 *       polygonToOwnerPixelDistance = 0 iff the target owns a pixel inside the polygon
 *
 * The check surface stays at 16 checks (the E13 evidence gate pins
 * totalChecks===16); the new derived facts are folded into the
 * "every derived ... fact re-derives" check with labeled drift details.
 *
 * Exits non-zero (and records pass=false) on any drift. Never writes the
 * manifest or SVG; only the verification report inside the allowed fixture
 * directory. E13_MASK_STRUCTURE_MAPPING_DIR overrides the fixture dir (used by
 * mutation regression tests against tampered copies in a temp dir).
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { polygonAabb, polygonCentroid } from '../lib/tmx-structure.mjs'
import { countOwnedPixelsInPolygon } from '../lib/mask-migration-evidence.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..', '..')
const DEFAULT_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-e13', 'mask-structure-mapping')
const DIR = process.env.E13_MASK_STRUCTURE_MAPPING_DIR ? resolve(process.env.E13_MASK_STRUCTURE_MAPPING_DIR) : DEFAULT_DIR
const MANIFEST_PATH = join(DIR, 'mask-structure-mapping.json')
const SVG_PATH = join(DIR, 'mask-structure-mapping.svg')
const VERIFY_PATH = join(DIR, 'mask-structure-mapping.verify.json')

const CURRENT_TMX_SHA256 = '885471a17ac080d4d766f3e86c69836bcac8ba66b9cab125a6ca3ac978d82d9f'
const PATHS = {
  ledger: 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json',
  manifest: 'tests/fixtures/juyiting/occlusion-v2-masks/mask-tmx-manifest.json',
  fragSpec: 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json',
  tmx: 'public/juyiting/hall.tmx',
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const stable = (value) => JSON.stringify(value, null, 2)
const read = (p) => readFileSync(resolve(REPO_ROOT, p))
const readJson = (p) => JSON.parse(read(p).toString('utf8'))

function runsAabb(runs) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [y, x0, x1] of runs) {
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x1 - 1)
  }
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Squared Euclidean distance from (px,py) to segment a→b. */
function pointToSegmentDistanceSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const ex = px - (ax + t * dx), ey = py - (ay + t * dy)
  return ex * ex + ey * ey
}

/**
 * Smallest Euclidean distance from any owned pixel center (half-open
 * ownershipRuns) to the polygon boundary. Only consulted when no owned pixel
 * center lies inside/on the polygon (expected distance must then be > 0).
 */
function minOwnedPixelDistanceToPolygon(runs, polygon) {
  let best = Infinity
  const edgeCount = polygon.length
  for (const [y, x0, x1] of runs) {
    for (let x = x0; x < x1; x++) {
      const px = x + 0.5, py = y + 0.5
      for (let i = 0, j = edgeCount - 1; i < edgeCount; j = i++) {
        const d = pointToSegmentDistanceSq(px, py, polygon[j].x, polygon[j].y, polygon[i].x, polygon[i].y)
        if (d < best) best = d
        if (best === 0) return 0
      }
    }
  }
  return Math.sqrt(best)
}

/**
 * Pure verification core: recomputes every derived field and returns the
 * machine-verifiable report. Does not write any file.
 */
export function runVerify({ mapping, svg, ledger, manifest, fragSpec, tmxBytes }) {
  const results = []
  const check = (name, ok, detail = '') => results.push({ check: name, ok: Boolean(ok), detail: String(detail) })

  check('schema is E13 mask-structure-mapping v1', mapping.$schema === 'juyiting.occlusion-e13.mask-structure-mapping.v1' && mapping.schemaVersion === 1 && mapping.taskId === 'E13', `${mapping.$schema} v${mapping.schemaVersion}`)
  check('maskCount field matches entries', mapping.maskCount === 37 && mapping.entries.length === 37, `entries=${mapping.entries.length}`)

  const tmxIds = mapping.entries.map((e) => e.tmxId)
  const expectedRange = Array.from({ length: 37 }, (_, i) => 48 + i)
  check('mask 48..84 full coverage, no duplicates, sorted', new Set(tmxIds).size === 37 && JSON.stringify(tmxIds) === JSON.stringify(expectedRange), `[${tmxIds.join(',')}]`)
  check('tmxIdRange field', JSON.stringify(mapping.tmxIdRange) === JSON.stringify([48, 84]))

  const bindingByTmx = new Map(manifest.maskBindings.map((b) => [b.tmxId, b]))
  const fragByStableId = new Map(fragSpec.fragments.map((f) => [f.stableId, f]))
  const ledgerByTmx = new Map(ledger.entries.map((e) => [e.legacyTmxId, e]))
  let bindDrift = []
  let derivedDrift = []
  for (const entry of mapping.entries) {
    const ledgerEntry = ledgerByTmx.get(entry.tmxId)
    const binding = bindingByTmx.get(entry.tmxId)
    const frag = fragByStableId.get(entry.targetFragmentStableId)
    if (!ledgerEntry) { bindDrift.push(`${entry.tmxId}:no-ledger`); continue }
    if (!binding) { bindDrift.push(`${entry.tmxId}:no-binding`); continue }
    if (!frag) { bindDrift.push(`${entry.tmxId}:no-fragment`); continue }
    if (entry.targetFragmentStableId !== ledgerEntry.targetFragmentStableId) bindDrift.push(`${entry.tmxId}:ledger-target`)
    if (entry.targetFragmentStableId !== binding.targetFragmentId) bindDrift.push(`${entry.tmxId}:binding-target`)
    if (entry.structureName !== ledgerEntry.targetVisualStructure) bindDrift.push(`${entry.tmxId}:structure`)
    if (entry.ledgerOccluderStableId !== ledgerEntry.futureOccluderStableId) bindDrift.push(`${entry.tmxId}:occluder`)
    if (entry.maskBindingStableId !== binding.stableId) bindDrift.push(`${entry.tmxId}:binding-id`)
    if (JSON.stringify(entry.painterBinding.sortAnchor) !== JSON.stringify(ledgerEntry.sortAnchor)) bindDrift.push(`${entry.tmxId}:anchor`)
    if (JSON.stringify(entry.maskBoundary.polygon) !== JSON.stringify(ledgerEntry.polygon)) bindDrift.push(`${entry.tmxId}:polygon`)
    if (entry.ownerBoundary.sourceRect.x !== frag.sourceRect.x || entry.ownerBoundary.sourceRect.y !== frag.sourceRect.y || entry.ownerBoundary.sourceRect.width !== frag.sourceRect.width || entry.ownerBoundary.sourceRect.height !== frag.sourceRect.height) bindDrift.push(`${entry.tmxId}:sourceRect`)
    if (entry.ownerBoundary.ownedOpaquePixelCount !== frag.ownedOpaquePixelCount) bindDrift.push(`${entry.tmxId}:opaque-count`)

    // ownerBoundary.aabb / runsSha256 — recomputed from E9A ownershipRuns
    const expectedOwnerAabb = runsAabb(frag.ownershipRuns)
    if (JSON.stringify(entry.ownerBoundary.aabb) !== JSON.stringify(expectedOwnerAabb)) derivedDrift.push(`${entry.tmxId}:owner-aabb`)
    const expectedRunsSha = sha256(Buffer.from(stable(frag.ownershipRuns), 'utf8'))
    if (entry.ownerBoundary.runsSha256 !== expectedRunsSha) derivedDrift.push(`${entry.tmxId}:runsSha`)

    // maskBoundary.aabb / centroid — recomputed from polygon vertices (project definitions)
    const expectedMaskAabb = polygonAabb(entry.maskBoundary.polygon)
    if (JSON.stringify(entry.maskBoundary.aabb) !== JSON.stringify(expectedMaskAabb)) derivedDrift.push(`${entry.tmxId}:mask-aabb`)
    const expectedCentroid = polygonCentroid(entry.maskBoundary.polygon)
    if (JSON.stringify(entry.maskBoundary.centroid) !== JSON.stringify(expectedCentroid)) derivedDrift.push(`${entry.tmxId}:centroid`)

    // ownerOverlapEvidence — all four fields recomputed from E9A ownershipRuns + polygon
    const ownedInPolygon = countOwnedPixelsInPolygon(frag.ownershipRuns, entry.maskBoundary.polygon)
    const runSum = frag.ownershipRuns.reduce((s, r) => s + (r[2] - r[1]), 0)
    let ownerCount = 0
    for (const candidate of fragSpec.fragments) {
      if (countOwnedPixelsInPolygon(candidate.ownershipRuns, entry.maskBoundary.polygon) > 0) ownerCount++
    }
    const expectedDistance = ownedInPolygon > 0 ? 0 : minOwnedPixelDistanceToPolygon(frag.ownershipRuns, entry.maskBoundary.polygon)
    const ov = entry.ownerOverlapEvidence
    if (ov.ownedPixelsInLegacyPolygon !== ownedInPolygon) derivedDrift.push(`${entry.tmxId}:ownedPixels`)
    if (ov.targetOwnedOpaquePixelCount !== runSum) derivedDrift.push(`${entry.tmxId}:targetOwned`)
    if (runSum !== frag.ownedOpaquePixelCount) derivedDrift.push(`${entry.tmxId}:runsVsDeclared`)
    if (ov.actualOwnerCount !== ownerCount) derivedDrift.push(`${entry.tmxId}:ownerCount`)
    if (ov.polygonToOwnerPixelDistance !== expectedDistance) derivedDrift.push(`${entry.tmxId}:distance`)
  }
  check('every entry binds ledger + mask-tmx-manifest + fragment-ownership-spec', bindDrift.length === 0, bindDrift.slice(0, 8).join('; '))
  check('every derived maskBoundary/ownerBoundary/ownerOverlapEvidence fact re-derives from source data', derivedDrift.length === 0, derivedDrift.slice(0, 8).join('; '))
  check('uniqueTargetFragmentCount matches resolved fragments', mapping.uniqueTargetFragmentCount === new Set(mapping.entries.map((e) => e.targetFragmentStableId)).size, `got ${mapping.uniqueTargetFragmentCount}`)

  const tmxSha = sha256(tmxBytes)
  check('current TMX file hash is bound SHA 885471a1…', tmxSha === CURRENT_TMX_SHA256, tmxSha)
  check('manifest currentTmxSha256 matches bound SHA', mapping.currentTmxSha256 === CURRENT_TMX_SHA256)
  check('manifest tmx provenance matches mask-tmx-manifest current/baseline', mapping.provenance.tmx.currentSha256 === manifest.provenance.tmx.currentSha256 && mapping.provenance.tmx.baselineSha256 === manifest.provenance.tmx.baselineSha256)
  check('provenance wholeFileSha256 fields match source files', mapping.provenance.migrationLedger.wholeFileSha256 === sha256(read(PATHS.ledger)) && mapping.provenance.maskTmxManifest.wholeFileSha256 === sha256(read(PATHS.manifest)) && mapping.provenance.fragmentOwnershipSpec.wholeFileSha256 === sha256(read(PATHS.fragSpec)))

  const recomputedContent = sha256(Buffer.from(stable({ ...mapping, contentSha256: '' }), 'utf8'))
  check('manifest contentSha256 recomputes', recomputedContent === mapping.contentSha256, mapping.contentSha256)

  const svgSha = sha256(Buffer.from(svg, 'utf8'))
  check('visualization.sha256 matches SVG file', mapping.visualization.sha256 === svgSha, svgSha)
  const svgCards = [...svg.matchAll(/data-mask-tmx-id="(\d+)"/g)].map((x) => +x[1])
  check('SVG renders exactly 37 mask cards 48..84', svgCards.length === 37 && new Set(svgCards).size === 37 && JSON.stringify([...svgCards].sort((a, b) => a - b)) === JSON.stringify(expectedRange), `got ${svgCards.length}`)
  const missingAttrs = mapping.entries.filter((e) => !svg.includes(`data-target-owner="${e.targetFragmentStableId}"`) || !svg.includes(`data-mask-tmx-id="${e.tmxId}"`) || !svg.includes(`data-structure-name="${String(e.structureName).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}"`))
  check('SVG cards carry target stableId + structure name for every entry', missingAttrs.length === 0, missingAttrs.map((e) => e.tmxId).join(','))
  check('SVG binds current TMX SHA', svg.includes(CURRENT_TMX_SHA256))

  const pass = results.every((r) => r.ok)
  const report = {
    $schema: 'juyiting.occlusion-e13.mask-structure-mapping.verify.v1',
    schemaVersion: 1,
    taskId: 'E13',
    subtask: 'mask-structure-mapping',
    generatedBy: 'verify-mask-structure-mapping.mjs',
    pass,
    maskCount: mapping.maskCount,
    tmxIdRange: mapping.tmxIdRange,
    uniqueTargetFragmentCount: mapping.uniqueTargetFragmentCount,
    currentTmxSha256: mapping.currentTmxSha256,
    passedChecks: results.filter((r) => r.ok).length,
    totalChecks: results.length,
    failures: results.filter((r) => !r.ok).map((r) => ({ check: r.check, detail: r.detail })),
    checks: results,
    sourceHashes: {
      manifestSha256: sha256(Buffer.from(`${stable(mapping)}\n`, 'utf8')),
      svgSha256: svgSha,
      tmxSha256: tmxSha,
    },
  }
  return report
}

function main() {
  const mapping = readJson(MANIFEST_PATH)
  const svg = read(SVG_PATH).toString('utf8')
  const ledger = readJson(PATHS.ledger)
  const manifest = readJson(PATHS.manifest)
  const fragSpec = readJson(PATHS.fragSpec)
  const report = runVerify({ mapping, svg, ledger, manifest, fragSpec, tmxBytes: read(PATHS.tmx) })
  writeFileSync(VERIFY_PATH, `${stable(report)}\n`)
  console.log(`E13 mask→structure mapping verify: ${report.pass ? 'PASS' : 'FAIL'} ${report.passedChecks}/${report.totalChecks}; TMX=${CURRENT_TMX_SHA256}`)
  process.exit(report.pass ? 0 : 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
