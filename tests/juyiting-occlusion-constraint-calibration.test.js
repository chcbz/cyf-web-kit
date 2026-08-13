// ── E11 Constraint Calibration Tests ──
// Covers: calibration report validation, zones=0 proof,
// 108-agent zero-edges, mutation tests, determinism,
// hysteresis cross-check, computeHysteresis boundary tests.
//
// Uses exported validateCalibrationReport and generateCalibrationReport
// from the production scripts (no inline copies).

import assert from 'node:assert/strict'
import { describe, it, before } from 'mocha'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function loadJson(p) { return JSON.parse(readFileSync(p, 'utf-8')) }

// ── Paths ──
const REPORT_PATH = path.join(ROOT, 'tests/fixtures/juyiting/occlusion-v2-constraint/calibration-report.json')
const LEDGER_PATH = path.join(ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json')
const MANIFEST_PATH = path.join(ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/mask-tmx-manifest.json')

const EXPECTED_LEDGER_WHOLE_SHA = '700b2ac6d27ceb58ce5fe0dd92b3f0dc7012a6ecafd03f7c23a9d3a3c42704b1'
const EXPECTED_MANIFEST_WHOLE_SHA = '96053f6cda115ecc437085ef431ef1d4ec766403f4c2e6a2bda6c8093bbdb0e7'
const EXPECTED_TMX_SHA = '885471a17ac080d4d766f3e86c69836bcac8ba66b9cab125a6ca3ac978d82d9f'

const CONTRACT_PATHS = [
  'src/game/occlusion/schema.ts',
  'src/game/occlusion/worldOrder.ts',
  'src/game/occlusion/constraintResolver.ts',
  'src/game/occlusion/polygonGeometry.ts',
  'src/game/occlusion/validation.ts',
]
const EXPECTED_CONTRACTS = {
  'src/game/occlusion/schema.ts': '172a293a9b873482be25fed706da05e49ddcc02cfa8717ff329311159e51b9d1',
  'src/game/occlusion/worldOrder.ts': 'ccb3bc5eaa55055c78f04090a74f0fea4b37e36780349f09eff4ac9f9249942c',
  'src/game/occlusion/constraintResolver.ts': 'fe2e2903c1830b402db3ca18edfdbd132306ffbde3523397a356bb3541ca88bd',
  'src/game/occlusion/polygonGeometry.ts': '586c716e541e874776ab28aed60212f2550957ab3df5661443d931653dc31a4e',
  'src/game/occlusion/validation.ts': '7b4bcfed5ec2cb39003d2f06709113c837b89600138e991a0aec60d1903b0eeb',
}

// ═══════════════════════════════════════════════
// Hysteresis cross-check (fail closed)
// ═══════════════════════════════════════════════

describe('E11 - hysteresis cross-check', () => {
  let HYSTERESIS_PX
  let HYSTERESIS_WORLD_PX
  let computeHysteresis

  before(async () => {
    const schemaMod = await import('../src/game/occlusion/schema.js')
    HYSTERESIS_PX = schemaMod.HYSTERESIS_PX
    const polyMod = await import('../src/game/occlusion/polygonGeometry.js')
    HYSTERESIS_WORLD_PX = polyMod.HYSTERESIS_WORLD_PX
    computeHysteresis = polyMod.computeHysteresis
  })

  it('HYSTERESIS_PX from schema.js is 3', () => {
    assert.equal(HYSTERESIS_PX, 3,
      `HYSTERESIS_PX must be 3, got ${HYSTERESIS_PX} — fail closed`)
  })

  it('HYSTERESIS_WORLD_PX from polygonGeometry.js is 3', () => {
    assert.equal(HYSTERESIS_WORLD_PX, 3,
      `HYSTERESIS_WORLD_PX must be 3, got ${HYSTERESIS_WORLD_PX} — fail closed`)
  })

  it('HYSTERESIS_PX === HYSTERESIS_WORLD_PX (both must be 3)', () => {
    assert.equal(HYSTERESIS_PX, HYSTERESIS_WORLD_PX,
      `HYSTERESIS_PX (${HYSTERESIS_PX}) !== HYSTERESIS_WORLD_PX (${HYSTERESIS_WORLD_PX}) — fail closed`)
  })

  // ── computeHysteresis boundary tests ──
  // FixedPolygon = array of {x, y} in fixed-point scale (FIXED_SCALE=256)
  // Square from (0,0) to (100,100) world pixels → (0,0) to (25600,25600) fixed-point
  const unitSquare = [
    { x: 0, y: 0 },
    { x: 25600, y: 0 },
    { x: 25600, y: 25600 },
    { x: 0, y: 25600 },
  ]

  it('computeHysteresis with previous=null: sd >= 0 is inside', () => {
    // Center of square: well inside, sd should be large positive
    const result = computeHysteresis(unitSquare, 12800, 12800, null)
    assert.equal(typeof result.inside, 'boolean')
    assert.equal(typeof result.signedDistance, 'number')
    assert.equal(result.inside, true, 'Center should be inside with previous=null')
    assert.ok(result.signedDistance > 0, 'signedDistance should be positive at center')
  })

  it('computeHysteresis with previous=null: sd < 0 is outside', () => {
    // Far outside the square
    const result = computeHysteresis(unitSquare, -10000, -10000, null)
    assert.equal(result.inside, false, 'Far outside should be outside with previous=null')
    assert.ok(result.signedDistance < 0, 'signedDistance should be negative outside')
  })

  it('computeHysteresis with previous=true: sd > -3px stays inside (hysteresis margin)', () => {
    // Use a point just barely outside (sd just below 0 but > -HYSTERESIS_WORLD_PX * FIXED_SCALE)
    // HYSTERESIS_WORLD_PX = 3, FIXED_SCALE = 256, so threshold = 3 * 256 = 768
    // Point just 2px outside the right edge: x = 25600 + 2*256 = 26112
    const result = computeHysteresis(unitSquare, 26112, 12800, true)
    // sd will be slightly negative (~ -2*256 = -512) which is > -768
    assert.equal(result.inside, true,
      `previous=true, sd=${result.signedDistance}: should stay inside (sd > -HYSTERESIS_WORLD_PX*FIXED_SCALE)`)
    assert.ok(result.signedDistance > -768, 'sd should be > -768 (3px * 256)')
  })

  it('computeHysteresis with previous=true: sd < -3px transitions to outside', () => {
    // Point 5px outside: x = 25600 + 5*256 = 26880
    const result = computeHysteresis(unitSquare, 26880, 12800, true)
    assert.equal(result.inside, false,
      `previous=true, sd=${result.signedDistance}: should transition to outside (sd < -3px)`)
    assert.ok(result.signedDistance < 0, 'sd should be negative outside')
  })

  it('computeHysteresis with previous=false: sd >= 3px transitions to inside', () => {
    // Center of square is deep inside, sd >> HYSTERESIS_WORLD_PX * FIXED_SCALE
    const result = computeHysteresis(unitSquare, 12800, 12800, false)
    assert.equal(result.inside, true,
      `previous=false, sd=${result.signedDistance}: should transition to inside (sd >= 3px)`)
    assert.ok(result.signedDistance > 0, 'sd should be positive inside')
  })

  it('computeHysteresis with previous=false: sd < 3px stays outside', () => {
    // Point 2px inside from edge: x = 25500 - 254*256 = ... actually let's use a point 2px inside
    // 2px inside right edge: x = 25600 - 2*256 = 25088, sd ≈ 2*256 = 512 which is < 768
    const result = computeHysteresis(unitSquare, 25088, 12800, false)
    assert.equal(result.inside, false,
      `previous=false, sd=${result.signedDistance}: should stay outside (sd < 3px)`)
    assert.ok(result.signedDistance < 768, 'sd should be < 768 (3px * 256)')
  })

  it('computeHysteresis transition at exact 3px boundary: previous=true, sd=-768', () => {
    // Exactly 3px outside: x = 25600 + 3*256 = 26368, sd ≈ -768
    const result = computeHysteresis(unitSquare, 26368, 12800, true)
    // sd > -HYSTERESIS_WORLD_PX * FIXED_SCALE means inside; sd == -768 is NOT > -768
    assert.equal(result.inside, false,
      `previous=true, sd=${result.signedDistance} at exact -3px: should be outside (not > -3px)`)
  })

  it('computeHysteresis transition at exact 3px boundary: previous=false, sd=768', () => {
    // Exactly 3px inside: x = 25600 - 3*256 = 24832, sd ≈ 768
    const result = computeHysteresis(unitSquare, 24832, 12800, false)
    // sd >= HYSTERESIS_WORLD_PX * FIXED_SCALE means inside; sd == 768 IS >= 768
    assert.equal(result.inside, true,
      `previous=false, sd=${result.signedDistance} at exact +3px: should be inside (>= 3px)`)
  })
})

// ═══════════════════════════════════════════════
// Calibration report validity (using production validator)
// ═══════════════════════════════════════════════

describe('E11 - calibration report', () => {
  let validateCalibrationReport
  let HYSTERESIS_PX
  let HYSTERESIS_WORLD_PX

  before(async () => {
    const valMod = await import('../scripts/juyiting/validate-constraint-calibration.mjs')
    validateCalibrationReport = valMod.validateCalibrationReport
    const schemaMod = await import('../src/game/occlusion/schema.js')
    HYSTERESIS_PX = schemaMod.HYSTERESIS_PX
    const polyMod = await import('../src/game/occlusion/polygonGeometry.js')
    HYSTERESIS_WORLD_PX = polyMod.HYSTERESIS_WORLD_PX
  })

  it('conclusion is zones=0', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.conclusion, 'zones=0')
  })

  it('all 37 bindings have constraintDecision=none', () => {
    const m = loadJson(MANIFEST_PATH)
    for (const b of m.maskBindings) {
      assert.equal(b.constraintDecision, 'none',
        `Binding ${b.stableId} has constraintDecision=${b.constraintDecision}`)
    }
  })

  it('all 111 probes pass sort-key verification', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.proofs.probes.total, 111)
    assert.equal(r.proofs.probes.passed, 111)
    assert.equal(r.proofs.probes.failed, 0)
  })

  it('32/32 target fragment coverage', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.proofs.targetCoverage.uniqueTargetFragments, 32)
    assert.equal(r.proofs.targetCoverage.totalCanonicalFragments, 32)
    assert.deepEqual(r.proofs.targetCoverage.uncoveredTargets, [])
  })

  it('zones = 0, canonicalParseZones = []', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.proofs.zones.count, 0)
    assert.deepEqual(r.proofs.zones.canonicalParseZones, [])
  })

  it('relations = 0', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.proofs.relations.count, 0)
  })

  it('edges = 0 (all sets empty)', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.proofs.edges.count, 0)
    assert.deepEqual(r.proofs.edges.oppositeOverlapSet, [])
    assert.deepEqual(r.proofs.edges.staticEdgeSet, [])
    assert.deepEqual(r.proofs.edges.activationEdgeSet, [])
    assert.deepEqual(r.proofs.edges.runtimeEdgeSet, [])
  })

  it('conflicts = 0', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.proofs.conflicts.count, 0)
  })

  it('cycles = 0', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.proofs.cycles.count, 0)
  })

  it('no global semantics (behindMask, depthHalving, characterState)', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.proofs.globalSemantics.hasGlobalBehindMask, false)
    assert.equal(r.proofs.globalSemantics.hasLegacyDepthHalving, false)
    assert.equal(r.proofs.globalSemantics.hasGlobalCharacterState, false)
  })

  it('hysteresis contract = 3px, membership = none', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.proofs.hysteresis.contractPx, 3)
    assert.equal(r.proofs.hysteresis.membershipState, 'none (zones=0)')
  })

  it('no overhead targets', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.proofs.overheadTargets.count, 0)
  })

  it('no cross-scene or cross-floor targets', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.proofs.crossSceneTargets.count, 0)
    assert.equal(r.proofs.crossFloorTargets.count, 0)
  })

  it('all target fragments are world-band in manifest', () => {
    const m = loadJson(MANIFEST_PATH)
    for (const f of m.canonicalFragments) {
      assert.equal(f.renderBand, 'world',
        `Fragment ${f.stableId} has renderBand=${f.renderBand}`)
    }
  })

  it('uncoveredTargets is derived from live manifest (not hardcoded)', () => {
    const m = loadJson(MANIFEST_PATH)
    const r = loadJson(REPORT_PATH)
    const allCanonicalIds = m.canonicalFragments.map(f => f.stableId)
    const bindingTargets = new Set(m.maskBindings.map(b => b.targetFragmentId))
    const expectedUncovered = allCanonicalIds.filter(id => !bindingTargets.has(id)).sort()
    assert.deepEqual(r.proofs.targetCoverage.uncoveredTargets, expectedUncovered,
      'uncoveredTargets must match live manifest derivation')
  })

  it('counts derived from live manifest/bindings match fixture', () => {
    const m = loadJson(MANIFEST_PATH)
    const r = loadJson(REPORT_PATH)
    assert.equal(m.maskBindings.length, 37, 'Live bindings count')
    assert.equal(m.canonicalFragments.length, 32, 'Live canonical fragments count')
    assert.equal(r.bindingSummary.totalBindings, m.maskBindings.length,
      'totalBindings must match live manifest')
    assert.equal(r.proofs.targetCoverage.totalCanonicalFragments, m.canonicalFragments.length,
      'totalCanonicalFragments must match live manifest')
  })
})

// ═══════════════════════════════════════════════
// Provenance binding
// ═══════════════════════════════════════════════

describe('E11 - provenance', () => {
  it('binds correct E10A ledger SHA and generationId', () => {
    const r = loadJson(REPORT_PATH)
    const actualSha = sha256(readFileSync(LEDGER_PATH))
    assert.equal(r.provenance.e10aLedger.wholeFileSha256, actualSha)
    assert.equal(r.provenance.e10aLedger.generationId,
      'fc855f90cbfc13c5ad8b24659825bc1dccaa03ec17866735fd923452dbdc7611')
  })

  it('binds correct E10B manifest SHA and generationId', () => {
    const r = loadJson(REPORT_PATH)
    const actualSha = sha256(readFileSync(MANIFEST_PATH))
    assert.equal(r.provenance.e10bManifest.wholeFileSha256, actualSha)
    assert.equal(r.provenance.e10bManifest.generationId,
      '0440e4963703f0d2f572d60c37f2ea1c1bd34f3fa9a77889b6f672bb108c57f0')
  })

  it('binds correct TMX SHA', () => {
    const r = loadJson(REPORT_PATH)
    assert.equal(r.provenance.tmx.sha256,
      '885471a17ac080d4d766f3e86c69836bcac8ba66b9cab125a6ca3ac978d82d9f')
  })

  it('binds correct E4/E5 contract hashes', () => {
    const r = loadJson(REPORT_PATH)
    for (const cp of CONTRACT_PATHS) {
      const expected = sha256(readFileSync(path.join(ROOT, cp)))
      assert.equal(r.provenance.e4e5Contracts[cp], expected,
        `Contract hash mismatch for ${cp}`)
    }
  })
})

// ═══════════════════════════════════════════════
// Validator function (reuses production core)
// ═══════════════════════════════════════════════

describe('E11 - validator function', () => {
  let validateCalibrationReport
  let HYSTERESIS_PX
  let HYSTERESIS_WORLD_PX

  before(async () => {
    const valMod = await import('../scripts/juyiting/validate-constraint-calibration.mjs')
    validateCalibrationReport = valMod.validateCalibrationReport
    const schemaMod = await import('../src/game/occlusion/schema.js')
    HYSTERESIS_PX = schemaMod.HYSTERESIS_PX
    const polyMod = await import('../src/game/occlusion/polygonGeometry.js')
    HYSTERESIS_WORLD_PX = polyMod.HYSTERESIS_WORLD_PX
  })

  function validateReportObj(report) {
    return validateCalibrationReport(report, {
      schemaHysteresisPx: HYSTERESIS_PX,
      polygonHysteresisPx: HYSTERESIS_WORLD_PX,
    })
  }

  it('validates report without errors', () => {
    const r = loadJson(REPORT_PATH)
    const result = validateReportObj(r)
    assert.equal(result.passed, true, `Validation errors: ${result.errors.join('; ')}`)
    assert.deepEqual(result.errors, [])
  })

  it('rejects report with injected zone', () => {
    const orig = loadJson(REPORT_PATH)
    const mutated = JSON.parse(JSON.stringify(orig))
    mutated.proofs.zones.count = 1
    mutated.proofs.zones.canonicalParseZones = [{
      stableId: 'jyt.zone.injected.v1',
      targetFragmentId: 'jyt.occ.west-upper.pillar-01.v2',
      relation: 'behind',
      priority: 0,
    }]
    mutated.conclusion = 'zones>0'
    const result = validateReportObj(mutated)
    assert.equal(result.passed, false, 'Should fail on injected zone')
    assert.ok(result.errors.some(e => e.includes('Zones') || e.includes('zone')),
      `Errors should mention zones: ${result.errors.join(', ')}`)
  })

  it('rejects report with changed constraintDecision', () => {
    const orig = loadJson(REPORT_PATH)
    const mutated = JSON.parse(JSON.stringify(orig))
    mutated.bindingSummary.allConstraintDecisionNone = false
    const result = validateReportObj(mutated)
    assert.equal(result.passed, false)
    assert.ok(result.errors.some(e => e.includes('constraintDecision') || e.includes('None')),
      `Errors: ${result.errors.join(', ')}`)
  })

  it('rejects report with overhead target', () => {
    const orig = loadJson(REPORT_PATH)
    const mutated = JSON.parse(JSON.stringify(orig))
    mutated.proofs.overheadTargets.count = 1
    const result = validateReportObj(mutated)
    assert.equal(result.passed, false)
    assert.ok(result.errors.some(e => e.includes('Overhead') || e.includes('overhead')),
      `Errors: ${result.errors.join(', ')}`)
  })

  it('rejects report with cross-scene target', () => {
    const orig = loadJson(REPORT_PATH)
    const mutated = JSON.parse(JSON.stringify(orig))
    mutated.proofs.crossSceneTargets.count = 1
    const result = validateReportObj(mutated)
    assert.equal(result.passed, false)
    assert.ok(result.errors.some(e => e.includes('Cross')),
      `Errors: ${result.errors.join(', ')}`)
  })

  it('rejects report with opposite overlap', () => {
    const orig = loadJson(REPORT_PATH)
    const mutated = JSON.parse(JSON.stringify(orig))
    mutated.proofs.edges.oppositeOverlapSet = [{ agent: 'a', fragment: 'b' }]
    const result = validateReportObj(mutated)
    assert.equal(result.passed, false)
    assert.ok(result.errors.some(e => e.includes('oppositeOverlap')),
      `Errors: ${result.errors.join(', ')}`)
  })

  it('rejects report with cycle', () => {
    const orig = loadJson(REPORT_PATH)
    const mutated = JSON.parse(JSON.stringify(orig))
    mutated.proofs.cycles.count = 1
    const result = validateReportObj(mutated)
    assert.equal(result.passed, false)
    assert.ok(result.errors.some(e => e.includes('Cycles')),
      `Errors: ${result.errors.join(', ')}`)
  })

  it('rejects report with hysteresis != 3', () => {
    const orig = loadJson(REPORT_PATH)
    const mutated = JSON.parse(JSON.stringify(orig))
    mutated.proofs.hysteresis.contractPx = 5
    const result = validateReportObj(mutated)
    assert.equal(result.passed, false)
    assert.ok(result.errors.some(e => e.includes('Hysteresis') || e.includes('3')),
      `Errors: ${result.errors.join(', ')}`)
  })

  it('rejects report with missing target coverage', () => {
    const orig = loadJson(REPORT_PATH)
    const mutated = JSON.parse(JSON.stringify(orig))
    mutated.proofs.targetCoverage.uncoveredTargets = ['jyt.occ.west-upper.pillar-01.v2']
    const result = validateReportObj(mutated)
    assert.equal(result.passed, false)
    assert.ok(result.errors.some(e => e.includes('Uncovered')),
      `Errors: ${result.errors.join(', ')}`)
  })

  it('rejects report with provenance drift (wrong ledger SHA)', () => {
    const orig = loadJson(REPORT_PATH)
    const mutated = JSON.parse(JSON.stringify(orig))
    mutated.provenance.e10aLedger.wholeFileSha256 = 'deadbeef'
    const result = validateReportObj(mutated)
    assert.equal(result.passed, false)
    assert.ok(result.errors.some(e => e.includes('Ledger') || e.includes('SHA')),
      `Errors: ${result.errors.join(', ')}`)
  })

  it('rejects report with hysteresis mismatch (provided both constants but different)', () => {
    const orig = loadJson(REPORT_PATH)
    // If we provide mismatched hysteresis constants, it should fail
    const result = validateCalibrationReport(JSON.parse(JSON.stringify(orig)), {
      schemaHysteresisPx: 3,
      polygonHysteresisPx: 5,
    })
    assert.equal(result.passed, false,
      'Should fail when provided hysteresis constants differ')
    assert.ok(result.errors.some(e => e.includes('HYSTERESIS') || e.includes('!==')),
      `Errors should mention hysteresis mismatch: ${result.errors.join(', ')}`)
  })

  it('rejects report when schema hysteresis != 3', () => {
    const orig = loadJson(REPORT_PATH)
    const result = validateCalibrationReport(JSON.parse(JSON.stringify(orig)), {
      schemaHysteresisPx: 5,
      polygonHysteresisPx: 5,
    })
    assert.equal(result.passed, false,
      'Should fail when schema HYSTERESIS_PX != 3')
    assert.ok(result.errors.some(e => e.includes('3') && e.includes('schema')),
      `Errors: ${result.errors.join(', ')}`)
  })
})

// ═══════════════════════════════════════════════
// Constraint subsystem verification (zones=0)
// ═══════════════════════════════════════════════

describe('E11 - constraint subsystem (zones=0)', () => {
  it('canonical IR parse with zones=[] succeeds', async () => {
    const { DEFAULT_FLOOR_REGISTRY } =
      await import('../src/game/occlusion/schema.js')
    const { computeWorldSortKey, baseOrderSort } =
      await import('../src/game/occlusion/worldOrder.js')

    const fragments = loadJson(MANIFEST_PATH).canonicalFragments.map(f => ({
      stableId: f.stableId,
      sceneId: f.sceneId,
      chunkId: f.chunkId,
      kind: 'occluder-fragment',
      renderBand: f.renderBand,
      floorId: f.floorId,
      elevation: f.elevation,
      sortMode: f.sortMode,
      sortAnchor: f.sortAnchor,
      tieBias: f.tieBias,
    }))

    // Verify all 32 fragments can compute sort keys
    for (const f of fragments) {
      const key = computeWorldSortKey(f, DEFAULT_FLOOR_REGISTRY)
      assert.equal(key.renderBandOrder, 100) // world
      assert.equal(key.floorOrder, 0) // floor-1
      assert.ok(Number.isSafeInteger(key.fixedPointY))
      assert.ok(key.tieBias >= -32 && key.tieBias <= 32)
    }

    // Base order with zero zones is deterministic
    const sorted1 = baseOrderSort(fragments, DEFAULT_FLOOR_REGISTRY)
    const sorted2 = baseOrderSort([...fragments].reverse(), DEFAULT_FLOOR_REGISTRY)
    assert.equal(sorted1.length, sorted2.length)
    for (let i = 0; i < sorted1.length; i++) {
      assert.equal(sorted1[i].stableId, sorted2[i].stableId)
    }
  })

  it('constraint resolver with empty zone registry produces zero edges', async () => {
    const { resolveConstraintOrder, sceneObjectToConstraintNode, fragmentToConstraintNode, createConstraintInstrumentation, createTestCandidateProvider } =
      await import('../src/game/occlusion/constraintResolver.js')
    const { DEFAULT_FLOOR_REGISTRY } =
      await import('../src/game/occlusion/schema.js')

    const manifest = loadJson(MANIFEST_PATH)

    const agents = []
    for (let i = 0; i < 108; i++) {
      agents.push({
        stableId: `jyt.agent.test${i}.v1`,
        sceneId: 'juyiting-main',
        chunkId: 'center',
        kind: 'agent',
        renderBand: 'world',
        floorId: 'floor-1',
        elevation: 0,
        sortMode: 'y',
        sortAnchor: { x: (i * 15 + 50) % 1664, y: (i * 8 + 30) % 928 },
        tieBias: 0,
      })
    }

    const fragNodes = manifest.canonicalFragments.map(f => ({
      stableId: f.stableId,
      sceneId: f.sceneId,
      chunkId: f.chunkId,
      floorId: f.floorId,
      elevation: f.elevation,
      sortAnchor: f.sortAnchor,
      tieBias: f.tieBias,
      renderBand: f.renderBand,
    }))

    const nodes = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragNodes.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const zoneRegistry = new Map()
    const candidateProvider = createTestCandidateProvider(() => new Set())
    const instr = createConstraintInstrumentation()

    const result = resolveConstraintOrder(
      nodes, candidateProvider, zoneRegistry,
      DEFAULT_FLOOR_REGISTRY, 'juyiting-main',
      { instrumentation: instr, _trustTestProvider: true },
    )

    assert.equal(result.edges.length, 0)
    assert.equal(result.order.length, 108 + 32)
    assert.equal(instr.edgeCount, 0)
    assert.equal(instr.zoneCount, 0)
    assert.equal(instr.agentCount, 108)
    assert.equal(instr.cycleDetected, false)

    // Total order is deterministic
    const shuffledNodes = [...nodes]
    for (let i = shuffledNodes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffledNodes[i], shuffledNodes[j]] = [shuffledNodes[j], shuffledNodes[i]]
    }
    const result2 = resolveConstraintOrder(
      shuffledNodes, candidateProvider, zoneRegistry,
      DEFAULT_FLOOR_REGISTRY, 'juyiting-main',
      { _trustTestProvider: true },
    )
    assert.deepEqual(result.order, result2.order)
  })

  it('3px hysteresis constant is correctly exported from schema', async () => {
    const { HYSTERESIS_PX } = await import('../src/game/occlusion/schema.js')
    assert.equal(HYSTERESIS_PX, 3)
  })

  it('polygonGeometry exports computeHysteresis with 3px contract', async () => {
    const { computeHysteresis } = await import('../src/game/occlusion/polygonGeometry.js')
    assert.equal(typeof computeHysteresis, 'function')
    const result = computeHysteresis(
      { vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } },
      50 * 256, 50 * 256, null,
    )
    assert.equal(typeof result.inside, 'boolean')
    assert.equal(typeof result.signedDistance, 'number')
  })
})

// ═══════════════════════════════════════════════
// Generator byte-determinism (production function, run twice)
// ═══════════════════════════════════════════════

describe('E11 - generator byte-determinism', () => {
  let generateCalibrationReport

  before(async () => {
    const genMod = await import('../scripts/juyiting/generate-constraint-calibration.mjs')
    generateCalibrationReport = genMod.generateCalibrationReport
  })

  it('two calls produce identical complete output', () => {
    const report1 = generateCalibrationReport()
    const report2 = generateCalibrationReport()

    const json1 = JSON.stringify(report1, null, 2)
    const json2 = JSON.stringify(report2, null, 2)

    assert.equal(json1, json2, 'Two generator calls must produce identical JSON output')
    assert.equal(sha256(json1), sha256(json2), 'SHA-256 must match between calls')
  })

  it('generator output matches committed fixture structure', () => {
    const report = generateCalibrationReport()
    const fixture = loadJson(REPORT_PATH)

    // Key fields should match
    assert.equal(report.conclusion, fixture.conclusion)
    assert.equal(report.schemaVersion, fixture.schemaVersion)
    assert.equal(report.taskId, fixture.taskId)
    // Timestamp is deterministic in both
    assert.equal(report.timestamp, fixture.timestamp)

    // Provenance SHAs should match
    assert.equal(report.provenance.e10aLedger.wholeFileSha256, fixture.provenance.e10aLedger.wholeFileSha256)
    assert.equal(report.provenance.e10bManifest.wholeFileSha256, fixture.provenance.e10bManifest.wholeFileSha256)
    assert.equal(report.provenance.tmx.sha256, fixture.provenance.tmx.sha256)

    // Proofs match
    assert.equal(report.proofs.zones.count, fixture.proofs.zones.count)
    assert.equal(report.proofs.probes.total, fixture.proofs.probes.total)
    assert.equal(report.proofs.probes.passed, fixture.proofs.probes.passed)
    assert.equal(report.proofs.probes.failed, fixture.proofs.probes.failed)
    assert.equal(report.proofs.targetCoverage.uniqueTargetFragments, fixture.proofs.targetCoverage.uniqueTargetFragments)
    assert.equal(report.proofs.targetCoverage.totalCanonicalFragments, fixture.proofs.targetCoverage.totalCanonicalFragments)
    assert.deepEqual(report.proofs.targetCoverage.uncoveredTargets, fixture.proofs.targetCoverage.uncoveredTargets)
    assert.equal(report.proofs.hysteresis.contractPx, fixture.proofs.hysteresis.contractPx)
    assert.equal(report.proofs.edges.count, fixture.proofs.edges.count)
    assert.equal(report.proofs.conflicts.count, fixture.proofs.conflicts.count)
    assert.equal(report.proofs.cycles.count, fixture.proofs.cycles.count)

    // Binding summary matches
    assert.equal(report.bindingSummary.totalBindings, fixture.bindingSummary.totalBindings)
    assert.deepEqual(report.bindingSummary.uniqueTargetFragments, fixture.bindingSummary.uniqueTargetFragments)
    assert.equal(report.bindingSummary.probeResults.total, fixture.bindingSummary.probeResults.total)
    assert.equal(report.bindingSummary.probeResults.pass, fixture.bindingSummary.probeResults.pass)
    assert.equal(report.bindingSummary.probeResults.fail, fixture.bindingSummary.probeResults.fail)
  })

  it('fixture passes validator with live hysteresis constants', async () => {
    const { validateCalibrationReport } = await import('../scripts/juyiting/validate-constraint-calibration.mjs')
    const schemaMod = await import('../src/game/occlusion/schema.js')
    const polyMod = await import('../src/game/occlusion/polygonGeometry.js')

    const report = generateCalibrationReport()
    const result = validateCalibrationReport(report, {
      schemaHysteresisPx: schemaMod.HYSTERESIS_PX,
      polygonHysteresisPx: polyMod.HYSTERESIS_WORLD_PX,
    })
    assert.equal(result.passed, true,
      `Generated report should pass validator: ${result.errors.join('; ')}`)
  })
})

// ═══════════════════════════════════════════════
// Generator determinism (manifest-based proofs)
// ═══════════════════════════════════════════════

describe('E11 - generator determinism (manifest proofs)', () => {
  it('generator logic produces deterministic output from manifest', () => {
    const r = loadJson(REPORT_PATH)
    const m = loadJson(MANIFEST_PATH)

    // Re-derive the core proofs independently
    const nonNone = m.maskBindings.filter(b => b.constraintDecision !== 'none')
    assert.equal(nonNone.length, 0)

    let probePass = 0, probeFail = 0
    for (const b of m.maskBindings) {
      const fragFixedY = b.fixedPointY
      const fragTieBias = b.tieBias ?? -1
      for (const probe of (b.probes || [])) {
        const agentFixedY = probe.fixedPointY
        const agentTieBias = 0

        let derived
        if (agentFixedY < fragFixedY) derived = 'agent<fragment'
        else if (agentFixedY > fragFixedY) derived = 'fragment<agent'
        else derived = (fragTieBias < agentTieBias) ? 'fragment<agent' : 'agent<fragment'

        if (derived === probe.expectedPainterRelation) probePass++
        else probeFail++
      }
    }

    assert.equal(probePass, 111)
    assert.equal(probeFail, 0)
    assert.equal(m.maskBindings.length, 37)

    const uniqueFrags = new Set(m.maskBindings.map(b => b.targetFragmentId))
    assert.equal(uniqueFrags.size, 32)
    assert.equal(m.canonicalFragments.length, 32)

    // Check everything is world-band
    for (const f of m.canonicalFragments) {
      assert.equal(f.renderBand, 'world')
    }
    for (const f of m.canonicalFragments) {
      assert.equal(f.sceneId, 'juyiting-main')
      assert.equal(f.floorId, 'floor-1')
    }
  })

  it('generator fixture matches expected structure', () => {
    const r = loadJson(REPORT_PATH)
    assert.ok(r.provenance?.e10aLedger?.generationId)
    assert.ok(r.provenance?.e10bManifest?.generationId)
    assert.ok(r.proofs?.zones)
    assert.ok(r.proofs?.edges)
    assert.ok(r.proofs?.probes)
    assert.ok(r.proofs?.targetCoverage)
    assert.ok(r.proofs?.hysteresis)
    assert.ok(r.bindingSummary)
  })
})

// ═══════════════════════════════════════════════
// 108-agent pressure test (zones=0 produces 0 edges)
// ═══════════════════════════════════════════════

describe('E11 - 108-agent pressure', () => {
  it('108 agents scattered across map with zones=[] produce zero mandatory edges', async () => {
    const { resolveConstraintOrder, sceneObjectToConstraintNode, fragmentToConstraintNode, createConstraintInstrumentation, createTestCandidateProvider } =
      await import('../src/game/occlusion/constraintResolver.js')
    const { DEFAULT_FLOOR_REGISTRY } =
      await import('../src/game/occlusion/schema.js')

    const manifest = loadJson(MANIFEST_PATH)

    const agents = []
    for (let i = 0; i < 108; i++) {
      const frac = i / 108
      const x = 50 + frac * 1568
      const y = 150 + (i * 7 + 30) % 700
      agents.push({
        stableId: `jyt.agent.stress${i}.v1`,
        sceneId: 'juyiting-main',
        chunkId: 'center',
        kind: 'agent',
        renderBand: 'world',
        floorId: 'floor-1',
        elevation: 0,
        sortMode: 'y',
        sortAnchor: { x, y },
        tieBias: 0,
      })
    }

    const fragNodes = manifest.canonicalFragments.map(f => ({
      stableId: f.stableId,
      sceneId: f.sceneId,
      chunkId: f.chunkId,
      floorId: f.floorId,
      elevation: f.elevation,
      sortAnchor: f.sortAnchor,
      tieBias: f.tieBias,
      renderBand: f.renderBand,
    }))

    const nodes = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragNodes.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const zoneRegistry = new Map()
    const candidateProvider = createTestCandidateProvider(() => new Set())
    const instr = createConstraintInstrumentation()

    const result = resolveConstraintOrder(
      nodes, candidateProvider, zoneRegistry,
      DEFAULT_FLOOR_REGISTRY, 'juyiting-main',
      { instrumentation: instr, _trustTestProvider: true },
    )

    assert.equal(result.edges.length, 0,
      `Expected 0 edges with zones=[], got ${result.edges.length}`)
    assert.equal(instr.edgeCount, 0)
    assert.equal(instr.zoneCount, 0)
    assert.equal(result.order.length, 108 + 32)
    assert.equal(instr.cycleDetected, false)
  })

  it('total order is insertion-order independent with zones=[]', async () => {
    const { resolveConstraintOrder, sceneObjectToConstraintNode, fragmentToConstraintNode, createTestCandidateProvider } =
      await import('../src/game/occlusion/constraintResolver.js')
    const { DEFAULT_FLOOR_REGISTRY } =
      await import('../src/game/occlusion/schema.js')

    const manifest = loadJson(MANIFEST_PATH)

    const agents = []
    for (let i = 0; i < 50; i++) {
      agents.push({
        stableId: `jyt.agent.iso${i}.v1`,
        sceneId: 'juyiting-main',
        chunkId: 'center',
        kind: 'agent',
        renderBand: 'world',
        floorId: 'floor-1',
        elevation: 0,
        sortMode: 'y',
        sortAnchor: { x: i * 32, y: 300 + (i % 5) * 50 },
        tieBias: 0,
      })
    }

    const fragNodes = manifest.canonicalFragments.map(f => ({
      stableId: f.stableId,
      sceneId: f.sceneId,
      chunkId: f.chunkId,
      floorId: f.floorId,
      elevation: f.elevation,
      sortAnchor: f.sortAnchor,
      tieBias: f.tieBias,
      renderBand: f.renderBand,
    }))

    const baseNodes = [
      ...agents.map(a => sceneObjectToConstraintNode(a, DEFAULT_FLOOR_REGISTRY)),
      ...fragNodes.map(f => fragmentToConstraintNode(f, DEFAULT_FLOOR_REGISTRY)),
    ]

    const zoneRegistry = new Map()
    const candidateProvider = createTestCandidateProvider(() => new Set())

    const ref = resolveConstraintOrder(
      [...baseNodes], candidateProvider, zoneRegistry,
      DEFAULT_FLOOR_REGISTRY, 'juyiting-main',
      { _trustTestProvider: true },
    )

    for (let run = 0; run < 5; run++) {
      const shuffled = [...baseNodes]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      const result = resolveConstraintOrder(
        shuffled, candidateProvider, zoneRegistry,
        DEFAULT_FLOOR_REGISTRY, 'juyiting-main',
        { _trustTestProvider: true },
      )
      assert.deepEqual(result.order, ref.order, `Insertion-order run ${run}`)
      assert.equal(result.edges.length, 0)
    }
  })
})

// ═══════════════════════════════════════════════
// Validator determinism (production function)
// ═══════════════════════════════════════════════

describe('E11 - validator determinism', () => {
  let validateCalibrationReport
  let HYSTERESIS_PX
  let HYSTERESIS_WORLD_PX

  before(async () => {
    const valMod = await import('../scripts/juyiting/validate-constraint-calibration.mjs')
    validateCalibrationReport = valMod.validateCalibrationReport
    const schemaMod = await import('../src/game/occlusion/schema.js')
    HYSTERESIS_PX = schemaMod.HYSTERESIS_PX
    const polyMod = await import('../src/game/occlusion/polygonGeometry.js')
    HYSTERESIS_WORLD_PX = polyMod.HYSTERESIS_WORLD_PX
  })

  it('produces identical validation result across repeated calls', () => {
    const r = loadJson(REPORT_PATH)
    for (let i = 0; i < 5; i++) {
      const result = validateCalibrationReport(r, {
        schemaHysteresisPx: HYSTERESIS_PX,
        polygonHysteresisPx: HYSTERESIS_WORLD_PX,
      })
      assert.equal(result.passed, true, `Run ${i}: ${result.errors.join('; ')}`)
      assert.deepEqual(result.errors, [])
    }
  })
})
