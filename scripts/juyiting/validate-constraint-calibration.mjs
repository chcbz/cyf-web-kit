#!/usr/bin/env node
// ── E11 Constraint Calibration Validator ──
// Validates the E11 calibration report against frozen inputs.
// Verifies: zones=0 proof, probe coverage, no crosses, no cycles, 3px hysteresis.
//
// Usage: node scripts/juyiting/validate-constraint-calibration.mjs [report-path]
// Default report: tests/fixtures/juyiting/occlusion-v2-constraint/calibration-report.json

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function sha256File(filePath) {
  return sha256(readFileSync(filePath))
}

let errors = 0
let warnings = 0

function error(msg) {
  console.error(`ERROR: ${msg}`)
  errors++
}

function warn(msg) {
  console.error(`WARN: ${msg}`)
  warnings++
}

function check(condition, msg) {
  if (!condition) error(msg)
  return condition
}

// ── Frozen constants ──
const EXPECTED_LEDGER_WHOLE_SHA = '700b2ac6d27ceb58ce5fe0dd92b3f0dc7012a6ecafd03f7c23a9d3a3c42704b1'
const EXPECTED_MANIFEST_WHOLE_SHA = '183dadfa3221306eaac82b815d16023f21589323a7659ceb15cde0c227f916b0'
const EXPECTED_TMX_SHA = '4f94e3a52da71369d9c29d96e0ac0ceb2126a1a441b6cd63911701957e1ed49b'
const EXPECTED_E10A_GENERATION_ID = 'fc855f90cbfc13c5ad8b24659825bc1dccaa03ec17866735fd923452dbdc7611'
const EXPECTED_E10B_GENERATION_ID = 'a79959fd081f6c76fe5cf371b0587b5efaef463ade443e63e65f1afb4e32bbc9'
const HYSTERESIS_PX = 3

const CONTRACT_SOURCES = {
  'src/game/occlusion/schema.ts': '172a293a9b873482be25fed706da05e49ddcc02cfa8717ff329311159e51b9d1',
  'src/game/occlusion/worldOrder.ts': 'ccb3bc5eaa55055c78f04090a74f0fea4b37e36780349f09eff4ac9f9249942c',
  'src/game/occlusion/constraintResolver.ts': '55c696e56f4db1aabe3233c19eda525f86319997d58920aaef055da8dd7095c5',
  'src/game/occlusion/polygonGeometry.ts': '586c716e541e874776ab28aed60212f2550957ab3df5661443d931653dc31a4e',
  'src/game/occlusion/validation.ts': '7b4bcfed5ec2cb39003d2f06709113c837b89600138e991a0aec60d1903b0eeb',
}

function main() {
  const reportPath = process.argv[2] ||
    path.join(ROOT, 'tests/fixtures/juyiting/occlusion-v2-constraint/calibration-report.json')

  console.error(`Validating: ${reportPath}`)

  let report
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf-8'))
  } catch (e) {
    error(`Cannot parse report: ${e.message}`)
    process.exit(1)
  }

  // ── Schema check ──
  check(report.$schema === 'juyiting-occlusion-constraint-calibration-v1',
    `Invalid $schema: ${report.$schema}`)
  check(report.schemaVersion === 1, `Invalid schemaVersion: ${report.schemaVersion}`)
  check(report.taskId === 'E11', `Invalid taskId: ${report.taskId}`)
  check(report.conclusion === 'zones=0', `Invalid conclusion: ${report.conclusion}`)

  // ── Provenance verification ──
  const prov = report.provenance
  if (!prov) { error('Missing provenance'); process.exit(1) }

  check(prov.e10aLedger?.wholeFileSha256 === EXPECTED_LEDGER_WHOLE_SHA,
    `Ledger SHA mismatch: ${prov.e10aLedger?.wholeFileSha256}`)
  check(prov.e10aLedger?.generationId === EXPECTED_E10A_GENERATION_ID,
    `Ledger generationId mismatch: ${prov.e10aLedger?.generationId}`)

  check(prov.e10bManifest?.wholeFileSha256 === EXPECTED_MANIFEST_WHOLE_SHA,
    `Manifest SHA mismatch: ${prov.e10bManifest?.wholeFileSha256}`)
  check(prov.e10bManifest?.generationId === EXPECTED_E10B_GENERATION_ID,
    `Manifest generationId mismatch: ${prov.e10bManifest?.generationId}`)

  check(prov.tmx?.sha256 === EXPECTED_TMX_SHA,
    `TMX SHA mismatch: ${prov.tmx?.sha256}`)

  // Verify live contract hashes
  for (const [relPath, expectedHash] of Object.entries(CONTRACT_SOURCES)) {
    const actual = sha256File(path.join(ROOT, relPath))
    check(actual === expectedHash,
      `Contract hash mismatch for ${relPath}: expected ${expectedHash}, got ${actual}`)
  }

  const reportContracts = prov.e4e5Contracts || {}
  for (const [relPath, expectedHash] of Object.entries(CONTRACT_SOURCES)) {
    check(reportContracts[relPath] === expectedHash,
      `Report contract hash mismatch for ${relPath}`)
  }

  // ── Proofs verification ──
  const proofs = report.proofs
  if (!proofs) { error('Missing proofs'); process.exit(1) }

  // Zones
  check(proofs.zones?.count === 0, `Zones count should be 0, got ${proofs.zones?.count}`)
  check(Array.isArray(proofs.zones?.canonicalParseZones) && proofs.zones.canonicalParseZones.length === 0,
    `canonicalParseZones should be [], got ${JSON.stringify(proofs.zones?.canonicalParseZones)}`)

  // Relations
  check(proofs.relations?.count === 0, `Relations count should be 0, got ${proofs.relations?.count}`)

  // Edges
  check(proofs.edges?.count === 0, `Edges count should be 0, got ${proofs.edges?.count}`)
  check(Array.isArray(proofs.edges?.oppositeOverlapSet) && proofs.edges.oppositeOverlapSet.length === 0,
    'oppositeOverlapSet should be empty')
  check(Array.isArray(proofs.edges?.staticEdgeSet) && proofs.edges.staticEdgeSet.length === 0,
    'staticEdgeSet should be empty')
  check(Array.isArray(proofs.edges?.activationEdgeSet) && proofs.edges.activationEdgeSet.length === 0,
    'activationEdgeSet should be empty')
  check(Array.isArray(proofs.edges?.runtimeEdgeSet) && proofs.edges.runtimeEdgeSet.length === 0,
    'runtimeEdgeSet should be empty')

  // Conflicts
  check(proofs.conflicts?.count === 0, `Conflicts count should be 0, got ${proofs.conflicts?.count}`)

  // Cycles
  check(proofs.cycles?.count === 0, `Cycles count should be 0, got ${proofs.cycles?.count}`)

  // Target coverage
  const tc = proofs.targetCoverage
  check(tc?.uniqueTargetFragments === 32, `Unique target fragments: expected 32, got ${tc?.uniqueTargetFragments}`)
  check(tc?.totalCanonicalFragments === 32, `Total canonical: expected 32, got ${tc?.totalCanonicalFragments}`)
  check(Array.isArray(tc?.uncoveredTargets) && tc.uncoveredTargets.length === 0,
    `Uncovered targets should be empty, got ${tc?.uncoveredTargets?.length}`)

  // Probes
  check(proofs.probes?.total === 111, `Probe total: expected 111, got ${proofs.probes?.total}`)
  check(proofs.probes?.passed === 111, `Probes passed: expected 111, got ${proofs.probes?.passed}`)
  check(proofs.probes?.failed === 0, `Probes failed: expected 0, got ${proofs.probes?.failed}`)

  // Global semantics
  check(proofs.globalSemantics?.hasGlobalBehindMask === false, 'hasGlobalBehindMask should be false')
  check(proofs.globalSemantics?.hasLegacyDepthHalving === false, 'hasLegacyDepthHalving should be false')
  check(proofs.globalSemantics?.hasGlobalCharacterState === false, 'hasGlobalCharacterState should be false')

  // Hysteresis
  check(proofs.hysteresis?.contractPx === HYSTERESIS_PX,
    `Hysteresis contract: expected ${HYSTERESIS_PX}, got ${proofs.hysteresis?.contractPx}`)
  check(proofs.hysteresis?.membershipState === 'none (zones=0)',
    `Membership state should be 'none (zones=0)', got ${proofs.hysteresis?.membershipState}`)

  // Overhead targets
  check(proofs.overheadTargets?.count === 0, `Overhead targets: expected 0, got ${proofs.overheadTargets?.count}`)

  // Cross-scene/floor
  check(proofs.crossSceneTargets?.count === 0, `Cross-scene targets: expected 0, got ${proofs.crossSceneTargets?.count}`)
  check(proofs.crossFloorTargets?.count === 0, `Cross-floor targets: expected 0, got ${proofs.crossFloorTargets?.count}`)

  // ── Binding summary ──
  const bs = report.bindingSummary
  check(bs?.totalBindings === 37, `Total bindings: expected 37, got ${bs?.totalBindings}`)
  check(bs?.allConstraintDecisionNone === true, 'allConstraintDecisionNone should be true')
  check(bs?.probeResults?.total === 111, `Probe results total: expected 111, got ${bs?.probeResults?.total}`)
  check(bs?.probeResults?.pass === 111, `Probe results pass: expected 111, got ${bs?.probeResults?.pass}`)
  check(bs?.probeResults?.fail === 0, `Probe results fail: expected 0, got ${bs?.probeResults?.fail}`)
  check(bs?.uniqueTargetFragments?.length === 32, `Unique targets: expected 32, got ${bs?.uniqueTargetFragments?.length}`)

  // ── Final result ──
  console.error('')
  if (errors > 0) {
    console.error(`VALIDATION FAILED: ${errors} error(s), ${warnings} warning(s)`)
    process.exit(1)
  } else {
    console.error(`VALIDATION PASSED: 0 errors, ${warnings} warning(s)`)
    console.log('PASS')
  }
}

main()
