#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
const FROZEN_GENERATION_ID = 'e10a-20260809-37mask-ledger-v1'

function loadJson(p) { return JSON.parse(readFileSync(join(repoRoot, p), 'utf-8')) }

function pointInPolygon(px, py, poly) {
  let inside = false, n = poly.length, j = n - 1
  for (let i = 0; i < n; i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
    if ((yi > py) !== (yj > py) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside
    j = i
  }
  return inside
}

function main() {
  const ledger = loadJson('tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json')
  const fragSpec = loadJson('tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json')
  const inventory = loadJson('tests/fixtures/juyiting/occlusion-v0/inventory.json')

  const fragMap = new Map()
  for (const f of fragSpec.fragments) fragMap.set(f.stableId, f)

  const errors = [], warnings = []
  const fail = (m) => errors.push(m)
  const warn = (m) => warnings.push(m)

  // 1. generationId
  if (ledger.generationId !== FROZEN_GENERATION_ID) fail(`generationId mismatch`)

  // 2. content hash
  const { contentSha256, ...ledgerBody } = ledger
  const recomputed = createHash('sha256').update(JSON.stringify(ledgerBody, null, 2)).digest('hex')
  if (contentSha256 !== recomputed) fail(`contentSha256 mismatch`)

  // 3. count
  if (ledger.entries.length !== 37) fail(`Expected 37 entries, got ${ledger.entries.length}`)

  // 4. TMX IDs
  const tmxIds = ledger.entries.map(e => e.legacyTmxId)
  const uniqueIds = new Set(tmxIds)
  if (uniqueIds.size !== 37) fail(`Duplicate TMX IDs`)
  for (let id = 48; id <= 84; id++) if (!uniqueIds.has(id)) fail(`Missing TMX ID ${id}`)

  // 5. index uniqueness
  const indices = ledger.entries.map(e => e.legacyIndex)
  const uniqueIdx = new Set(indices)
  if (uniqueIdx.size !== 37) fail(`Duplicate indices`)
  for (let i = 1; i <= 37; i++) if (!uniqueIdx.has(i)) fail(`Missing index ${i}`)

  // 6. per-entry validation
  for (const entry of ledger.entries) {
    const id = entry.legacyTmxId

    // Required string fields
    for (const f of ['targetVisualStructure','nineGridRegionDeclared','homeChunk','sceneId','floorId','renderBand','sortMode']) {
      if (typeof entry[f] !== 'string' || entry[f].length === 0) fail(`Mask ${id}: ${f} must be non-empty string`)
    }

    // Polygon
    if (!Array.isArray(entry.polygon) || entry.polygon.length < 3) fail(`Mask ${id}: polygon must have >=3 vertices`)
    for (const v of entry.polygon) {
      if (typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y))
        fail(`Mask ${id}: polygon vertex must be finite numbers`)
    }

    // AABB
    const aabb = entry.aabb
    if (aabb.minX > aabb.maxX || aabb.minY > aabb.maxY) fail(`Mask ${id}: invalid AABB`)
    if (aabb.width !== aabb.maxX - aabb.minX) fail(`Mask ${id}: AABB width mismatch`)
    if (aabb.height !== aabb.maxY - aabb.minY) fail(`Mask ${id}: AABB height mismatch`)

    // Polygon vertices in AABB
    for (const v of entry.polygon) {
      if (v.x < aabb.minX || v.x > aabb.maxX) fail(`Mask ${id}: vertex x=${v.x} outside AABB`)
      if (v.y < aabb.minY || v.y > aabb.maxY) fail(`Mask ${id}: vertex y=${v.y} outside AABB`)
    }

    // Centroid in AABB
    const c = entry.centroid
    if (c.x < aabb.minX || c.x > aabb.maxX || c.y < aabb.minY || c.y > aabb.maxY) fail(`Mask ${id}: centroid outside AABB`)

    // Sort anchor
    const sa = entry.sortAnchor
    if (typeof sa.x !== 'number' || typeof sa.y !== 'number' || !Number.isFinite(sa.x) || !Number.isFinite(sa.y))
      fail(`Mask ${id}: invalid sortAnchor`)
    if (sa.x < 0 || sa.x > 1664 || sa.y < 0 || sa.y > 928) fail(`Mask ${id}: sortAnchor out of map bounds`)

    // Render band and elevation
    if (entry.renderBand !== 'world') fail(`Mask ${id}: renderBand must be world`)
    if (entry.elevation !== 0) fail(`Mask ${id}: elevation must be 0`)
    if (typeof entry.tieBias !== 'number' || !Number.isInteger(entry.tieBias) || Math.abs(entry.tieBias) > 128)
      fail(`Mask ${id}: invalid tieBias`)

    // Target fragments exist
    if (entry.targetFragmentCount !== entry.targetFragmentStableIds.length) fail(`Mask ${id}: targetFragmentCount mismatch`)
    if (entry.targetFragmentCount !== entry.targetFragments.length) fail(`Mask ${id}: targetFragments count mismatch`)
    for (const tf of entry.targetFragments) {
      if (!tf.found) fail(`Mask ${id}: fragment ${tf.stableId} not found`)
      if (!tf.stableId.match(/^jyt\.occ\.[a-z0-9-]+\.[a-z0-9-]+\.v2$/)) fail(`Mask ${id}: bad stableId pattern`)
    }

    // One-to-many rationale
    if (entry.targetFragmentCount > 1) {
      if (!entry.oneToManyRationale || !Array.isArray(entry.oneToManyRationale) || entry.oneToManyRationale.length === 0)
        fail(`Mask ${id}: one-to-many requires rationale`)
    }

    // Future occluder
    if (!Array.isArray(entry.futureOccluderStableIds) || entry.futureOccluderStableIds.length !== entry.targetFragmentStableIds.length)
      fail(`Mask ${id}: futureOccluderStableIds mismatch`)

    // Probes
    for (const key of ['behind','boundary','front']) {
      const probe = entry.probes[key]
      if (!probe || typeof probe !== 'object') { fail(`Mask ${id}: missing ${key} probe`); continue }
      const fp = probe.footPoint
      if (typeof fp.x !== 'number' || typeof fp.y !== 'number') { fail(`Mask ${id}: probe ${key} invalid footPoint`); continue }
      if (!pointInPolygon(fp.x, fp.y, entry.polygon)) fail(`Mask ${id}: probe ${key} (${fp.x},${fp.y}) outside polygon`)
      if (probe.insideMaskPolygon !== true) fail(`Mask ${id}: probe ${key} insideMaskPolygon flag wrong`)
      if (!probe.probeId || !probe.expectedRelation || !probe.expectedAgentDrawOrder || !probe.rationale)
        fail(`Mask ${id}: probe ${key} missing required string fields`)
    }

    // Recalibration
    const recal = entry.recalibrationDecision
    if (recal && recal !== 'none') {
      if (typeof recal !== 'object' || recal.action !== 'recalibrate') fail(`Mask ${id}: invalid recalibration`)
      if (!recal.nineGridRegion || !recal.homeChunk || !recal.reason) fail(`Mask ${id}: recalibration missing fields`)
    }

    // Constraint
    const con = entry.constraintDecision
    if (con !== null) {
      if (!con.type || !con.decision || !Array.isArray(con.targets) || con.targets.length === 0) fail(`Mask ${id}: invalid constraint`)
      if (!con.relation || !con.priority || !con.scope || !con.rationale) fail(`Mask ${id}: constraint missing fields`)
      for (const ct of con.targets) if (!fragMap.has(ct)) fail(`Mask ${id}: constraint target ${ct} not found`)
    }

    // No TBD
    if (entry.targetVisualStructure.includes('TBD') || entry.targetVisualStructure.includes('TODO'))
      fail(`Mask ${id}: contains TBD/TODO`)

    // Overlap evidence
    if (!Array.isArray(entry.fragmentOverlapEvidence) || entry.fragmentOverlapEvidence.length === 0)
      fail(`Mask ${id}: missing overlap evidence`)

    // Valid homeChunk
    if (!['west-upper','center','east-upper','west-lower','entrance','east-lower'].includes(entry.homeChunk))
      fail(`Mask ${id}: invalid homeChunk ${entry.homeChunk}`)

    // Match inventory
    const invMask = inventory.masks.find(m => m.tmxId === id)
    if (!invMask) fail(`Mask ${id}: not in inventory`)
    else if (entry.legacyIndex !== invMask.index) fail(`Mask ${id}: index mismatch`)

    // Probe collision checks (warnings only)
    for (const [key, probe] of Object.entries(entry.probes)) {
      if (!probe) continue
      const fp = probe.footPoint
      for (const col of inventory.collision) {
        if (pointInPolygon(fp.x, fp.y, col.polygon)) warn(`Mask ${id}: probe ${key} inside collision ${col.tmxId}`)
      }
      for (const nav of inventory.navObstacles) {
        if (pointInPolygon(fp.x, fp.y, nav.polygon)) warn(`Mask ${id}: probe ${key} inside nav obstacle ${nav.tmxId}`)
      }
    }
  }

  // Summary checks
  const s = ledger.summary
  if (s.totalMasks !== 37) fail('Summary totalMasks wrong')
  if (s.tmxIdRange[0] !== 48 || s.tmxIdRange[1] !== 84) fail('Summary tmxIdRange wrong')
  const aRecal = ledger.entries.filter(e => e.recalibrationDecision && e.recalibrationDecision !== 'none').length
  const aCon = ledger.entries.filter(e => e.constraintDecision !== null).length
  const aOtM = ledger.entries.filter(e => e.targetFragmentCount > 1).length
  const aRegM = ledger.entries.filter(e => !e.nineGridRegionMatch).length
  if (s.recalibrationCount !== aRecal) fail('Summary recalibrationCount mismatch')
  if (s.constraintCount !== aCon) fail('Summary constraintCount mismatch')
  if (s.oneToManyCount !== aOtM) fail('Summary oneToManyCount mismatch')
  if (s.regionMismatchCount !== aRegM) fail('Summary regionMismatchCount mismatch')

  // Provenance
  if (ledger.provenance.tmxSha256 !== '291a38cc66ebd60c8577500a5afc18ce5398570fe4c35ca66d9eebe818826a97') fail('TMX SHA mismatch')
  if (ledger.provenance.e9aGenerationId !== '7f8bbdd8f3ca49952d0bcfceadf60a50ad998fc7033e370cbef665ee331f3d3b') fail('E9A genId mismatch')
  if (ledger.provenance.e9bCommit !== 'b8adb0988cd17f777e44064cf79c376cd9254b92') fail('E9B commit mismatch')

  console.log(`\n=== E10A Migration Ledger Validation ===`)
  console.log(`  Entries: ${ledger.entries.length}/37`)
  console.log(`  Errors: ${errors.length}`)
  console.log(`  Warnings: ${warnings.length}`)
  if (errors.length) { console.log('\n  ERRORS:'); for (const e of errors) console.log(`    ❌ ${e}`) }
  if (warnings.length) { console.log('\n  WARNINGS:'); for (const w of warnings) console.log(`    ⚠️  ${w}`) }
  if (errors.length === 0) { console.log('\n  ✅ VALIDATION PASSED'); return { ok: true } }
  else { console.log('\n  ❌ VALIDATION FAILED'); process.exit(1) }
}

main()
