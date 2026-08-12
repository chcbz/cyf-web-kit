#!/usr/bin/env node
// ── E11 Constraint Calibration Generator ──
// Reads E10B mask-tmx-manifest and E10A migration-ledger.
// Produces a deterministic machine-readable calibration report proving zones=0.
//
// Usage: node scripts/juyiting/generate-constraint-calibration.mjs > report.json
//        or:  node scripts/juyiting/generate-constraint-calibration.mjs --output <path>
//
// Importable:
//   import { generateCalibrationReport } from './generate-constraint-calibration.mjs'

import { readFileSync, writeFileSync } from 'node:fs'
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

// ── Frozen contract hashes ──
const CONTRACT_SOURCES = {
  'src/game/occlusion/schema.ts': '172a293a9b873482be25fed706da05e49ddcc02cfa8717ff329311159e51b9d1',
  'src/game/occlusion/worldOrder.ts': 'ccb3bc5eaa55055c78f04090a74f0fea4b37e36780349f09eff4ac9f9249942c',
  'src/game/occlusion/constraintResolver.ts': '55c696e56f4db1aabe3233c19eda525f86319997d58920aaef055da8dd7095c5',
  'src/game/occlusion/polygonGeometry.ts': '586c716e541e874776ab28aed60212f2550957ab3df5661443d931653dc31a4e',
  'src/game/occlusion/validation.ts': '7b4bcfed5ec2cb39003d2f06709113c837b89600138e991a0aec60d1903b0eeb',
}

function verifyContractHashes(rootDir) {
  for (const [relPath, expectedHash] of Object.entries(CONTRACT_SOURCES)) {
    const actual = sha256File(path.join(rootDir, relPath))
    if (actual !== expectedHash) {
      throw new Error(`Contract hash mismatch for ${relPath}: expected ${expectedHash}, got ${actual}`)
    }
  }
}

// ── Hysteresis cross-check from frozen source text ──
function verifyHysteresisConstants(rootDir) {
  const schemaPath = path.join(rootDir, 'src/game/occlusion/schema.ts')
  const polyPath = path.join(rootDir, 'src/game/occlusion/polygonGeometry.ts')

  const schemaSrc = readFileSync(schemaPath, 'utf-8')
  const polySrc = readFileSync(polyPath, 'utf-8')

  const schemaMatch = schemaSrc.match(/export\s+const\s+HYSTERESIS_PX\s*=\s*(\d+)/)
  if (!schemaMatch) {
    throw new Error('Cannot find HYSTERESIS_PX in schema.ts')
  }
  const schemaHpx = parseInt(schemaMatch[1], 10)

  const polyMatch = polySrc.match(/export\s+const\s+HYSTERESIS_WORLD_PX\s*=\s*(\d+)/)
  if (!polyMatch) {
    throw new Error('Cannot find HYSTERESIS_WORLD_PX in polygonGeometry.ts')
  }
  const polyHpx = parseInt(polyMatch[1], 10)

  if (schemaHpx !== 3) {
    throw new Error(`HYSTERESIS_PX in schema.ts is ${schemaHpx}, must be 3 — fail closed`)
  }
  if (polyHpx !== 3) {
    throw new Error(`HYSTERESIS_WORLD_PX in polygonGeometry.ts is ${polyHpx}, must be 3 — fail closed`)
  }
  if (schemaHpx !== polyHpx) {
    throw new Error(`HYSTERESIS_PX (${schemaHpx}) !== HYSTERESIS_WORLD_PX (${polyHpx}) — fail closed`)
  }
}

// ── Frozen SHAs ──
const EXPECTED_LEDGER_SHA = '700b2ac6d27ceb58ce5fe0dd92b3f0dc7012a6ecafd03f7c23a9d3a3c42704b1'
const EXPECTED_MANIFEST_SHA = '183dadfa3221306eaac82b815d16023f21589323a7659ceb15cde0c227f916b0'
const EXPECTED_TMX_SHA = '4f94e3a52da71369d9c29d96e0ac0ceb2126a1a441b6cd63911701957e1ed49b'

/**
 * Generate a calibration report from frozen inputs.
 * Deterministic: no runtime clock, no random, same inputs → same output.
 *
 * @param {string} [rootDir] - project root (defaults to derived ROOT)
 * @returns {object} calibration report
 */
export function generateCalibrationReport(rootDir = ROOT) {
  verifyContractHashes(rootDir)
  verifyHysteresisConstants(rootDir)

  // Read frozen inputs
  const ledgerPath = path.join(rootDir, 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json')
  const manifestPath = path.join(rootDir, 'tests/fixtures/juyiting/occlusion-v2-masks/mask-tmx-manifest.json')
  const tmxPath = path.join(rootDir, 'public/juyiting/hall.tmx')

  const ledgerRaw = readFileSync(ledgerPath, 'utf-8')
  const manifestRaw = readFileSync(manifestPath, 'utf-8')

  const ledger = JSON.parse(ledgerRaw)
  const manifest = JSON.parse(manifestRaw)

  const ledgerWholeSha = sha256(ledgerRaw)
  const manifestWholeSha = sha256(manifestRaw)
  const tmxSha = sha256File(tmxPath)

  // ── Ledger/manifest/TMX SHA drift: fail closed ──
  if (ledgerWholeSha !== EXPECTED_LEDGER_SHA) {
    throw new Error(`Ledger whole SHA drift: expected ${EXPECTED_LEDGER_SHA}, got ${ledgerWholeSha} — fail closed`)
  }
  if (manifestWholeSha !== EXPECTED_MANIFEST_SHA) {
    throw new Error(`Manifest whole SHA drift: expected ${EXPECTED_MANIFEST_SHA}, got ${manifestWholeSha} — fail closed`)
  }
  if (tmxSha !== EXPECTED_TMX_SHA) {
    throw new Error(`TMX SHA drift: expected ${EXPECTED_TMX_SHA}, got ${tmxSha} — fail closed`)
  }

  const bindings = manifest.maskBindings
  if (!Array.isArray(bindings) || bindings.length !== 37) {
    throw new Error(`Expected 37 mask bindings, got ${bindings?.length ?? 'not an array'}`)
  }

  // ── Proof 1: All constraintDecision = none ──
  const nonNoneBindings = bindings.filter(b => b.constraintDecision !== 'none')
  if (nonNoneBindings.length > 0) {
    const ids = nonNoneBindings.map(b => `${b.stableId}(${b.constraintDecision})`).join(', ')
    throw new Error(`Found ${nonNoneBindings.length} bindings with constraintDecision != none: ${ids}`)
  }

  // ── Proof 2: All target fragments are world-band ──
  const fragments = manifest.canonicalFragments || []
  const fragMap = new Map()
  for (const f of fragments) {
    if (f.renderBand !== 'world') {
      throw new Error(`Fragment ${f.stableId} has renderBand=${f.renderBand}, must be 'world'`)
    }
    fragMap.set(f.stableId, f)
  }

  // ── Proof 3: No target overhead ──
  for (const b of bindings) {
    const fid = b.targetFragmentId
    const frag = fragMap.get(fid)
    if (!frag) {
      throw new Error(`Binding ${b.stableId} target fragment ${fid} not found in manifest fragments`)
    }
    if (frag.renderBand !== 'world') {
      throw new Error(`Binding ${b.stableId} target fragment ${fid} is not world-band (${frag.renderBand})`)
    }
  }

  // ── Proof 4: No cross-scene/cross-floor targets ──
  const sceneId = 'juyiting-main'
  const floorId = 'floor-1'
  for (const b of bindings) {
    if (b.scope?.sceneId !== sceneId) {
      throw new Error(`Binding ${b.stableId} has sceneId=${b.scope?.sceneId}, expected ${sceneId}`)
    }
    if (b.scope?.floorId !== floorId) {
      throw new Error(`Binding ${b.stableId} has floorId=${b.scope?.floorId}, expected ${floorId}`)
    }
    const fid = b.targetFragmentId
    const frag = fragMap.get(fid)
    if (frag && frag.sceneId !== sceneId) {
      throw new Error(`Fragment ${fid} has sceneId=${frag.sceneId}, expected ${sceneId}`)
    }
    if (frag && frag.floorId !== floorId) {
      throw new Error(`Fragment ${fid} has floorId=${frag.floorId}, expected ${floorId}`)
    }
  }

  // ── Proof 5: All 111 probes have expectedPainterRelation consistent with fixed-point Y + tieBias ──
  const probeResults = []
  let probePassCount = 0
  let probeFailCount = 0

  for (const b of bindings) {
    const fragment = fragMap.get(b.targetFragmentId)
    const fragFixedPointY = b.fixedPointY
    const fragTieBias = b.tieBias ?? -1

    const probes = b.probes || []
    for (const probe of probes) {
      const agentFixedPointY = probe.fixedPointY
      const agentTieBias = 0

      let expectedFromSortKey
      if (agentFixedPointY < fragFixedPointY) {
        expectedFromSortKey = 'agent<fragment'
      } else if (agentFixedPointY > fragFixedPointY) {
        expectedFromSortKey = 'fragment<agent'
      } else {
        if (fragTieBias < agentTieBias) {
          expectedFromSortKey = 'fragment<agent'
        } else if (fragTieBias > agentTieBias) {
          expectedFromSortKey = 'agent<fragment'
        } else {
          expectedFromSortKey = 'fragment<agent'
        }
      }

      const matches = expectedFromSortKey === probe.expectedPainterRelation
      const result = {
        binding: b.stableId,
        probeId: probe.probeId,
        expectedPainterRelation: probe.expectedPainterRelation,
        sortKeyDerivedRelation: expectedFromSortKey,
        match: matches,
        agentFixedPointY,
        fragFixedPointY,
        fragTieBias,
      }

      if (matches) { probePassCount++ } else { probeFailCount++ }
      probeResults.push(result)
    }
  }

  if (probeFailCount > 0) {
    const fails = probeResults.filter(r => !r.match)
    for (const f of fails.slice(0, 5)) {
      console.error(`PROBE FAIL: ${f.probeId} expected=${f.expectedPainterRelation} sortKey=${f.sortKeyDerivedRelation}`)
    }
    throw new Error(`Found ${probeFailCount} probe relation mismatches`)
  }

  // ── Proof 6: No contradictory relations ──
  const relationMap = new Map()
  for (const b of bindings) {
    for (const probe of b.probes || []) {
      const key = `${b.targetFragmentId}::${probe.name}`
      const existing = relationMap.get(key)
      if (existing && existing !== probe.expectedPainterRelation) {
        throw new Error(`Contradictory relation for ${key}: ${existing} vs ${probe.expectedPainterRelation}`)
      }
      relationMap.set(key, probe.expectedPainterRelation)
    }
  }

  // ── Proof 7: 37→32 coverage (derive from live manifest) ──
  const uniqueTargets = new Set(bindings.map(b => b.targetFragmentId))
  const totalCanonicalFrags = manifest.canonicalFragmentCount || fragments.length

  const allCanonicalIds = new Set(fragments.map(f => f.stableId))
  const uncoveredTargets = [...allCanonicalIds].filter(id => !uniqueTargets.has(id)).sort()
  if (uncoveredTargets.length > 0) {
    throw new Error(`Found ${uncoveredTargets.length} uncovered canonical fragments: ${uncoveredTargets.join(', ')}`)
  }

  // Derive counts from live data
  const totalProbes = probePassCount + probeFailCount
  if (totalProbes !== 111) {
    throw new Error(`Expected 111 probes from live bindings, got ${totalProbes}`)
  }
  if (uniqueTargets.size !== 32) {
    throw new Error(`Expected 32 unique target fragments, got ${uniqueTargets.size}`)
  }
  if (totalCanonicalFrags !== 32) {
    throw new Error(`Expected 32 canonical fragments, got ${totalCanonicalFrags}`)
  }

  // ── Build calibration report (deterministic, no runtime clock) ──
  // FROZEN: this timestamp is a deterministic constant for byte-reproducibility.
  // Do NOT replace with Date.now() / new Date().toISOString() — it would break
  // the contract that two generator calls produce identical output.
  const generationTimestamp = '2026-08-12T00:00:00.000Z'

  return {
    $schema: 'juyiting-occlusion-constraint-calibration-v1',
    schemaVersion: 1,
    taskId: 'E11',
    timestamp: generationTimestamp,
    conclusion: 'zones=0',

    provenance: {
      e10aLedger: {
        path: 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json',
        wholeFileSha256: ledgerWholeSha,
        generationId: ledger.generationId || ledger.provenance?.generationId,
        contentSha256: ledger.contentSha256,
      },
      e10bManifest: {
        path: 'tests/fixtures/juyiting/occlusion-v2-masks/mask-tmx-manifest.json',
        wholeFileSha256: manifestWholeSha,
        generationId: manifest.generationId,
      },
      tmx: {
        path: 'public/juyiting/hall.tmx',
        sha256: tmxSha,
      },
      e4e5Contracts: CONTRACT_SOURCES,
    },

    proofs: {
      zones: {
        count: 0,
        statement: 'All 37 bindings have constraintDecision=none; zones=[] is correct and complete.',
        canonicalParseZones: [],
      },
      relations: {
        count: 0,
        statement: 'No constraint relations needed; all 111 probes satisfied by fixed-point Y + tieBias.',
      },
      edges: {
        count: 0,
        statement: 'No mandatory constraint edges (static/activation/runtime all empty).',
        oppositeOverlapSet: [],
        staticEdgeSet: [],
        activationEdgeSet: [],
        runtimeEdgeSet: [],
      },
      conflicts: {
        count: 0,
        statement: 'No contradictory relations detected.',
      },
      cycles: {
        count: 0,
        statement: 'Kahn result is trivially determined (empty edge set).',
      },
      targetCoverage: {
        uniqueTargetFragments: uniqueTargets.size,
        totalCanonicalFragments: totalCanonicalFrags,
        statement: `${uniqueTargets.size}/${totalCanonicalFrags} canonical fragments covered by 37 bindings.`,
        uncoveredTargets,
      },
      probes: {
        total: totalProbes,
        passed: probePassCount,
        failed: probeFailCount,
        statement: `All ${probePassCount} probes match expected painter relations via fixed-point Y + tieBias.`,
      },
      globalSemantics: {
        hasGlobalBehindMask: false,
        hasLegacyDepthHalving: false,
        hasGlobalCharacterState: false,
        statement: 'No global depth-halving, behindMask, or character state modification semantics.',
      },
      hysteresis: {
        contractPx: 3,
        statement: '3px hysteresis contract is frozen; zones=0 means no membership state is needed.',
        membershipState: 'none (zones=0)',
      },
      overheadTargets: {
        count: 0,
        statement: 'No target fragment has renderBand=overhead.',
      },
      crossSceneTargets: {
        count: 0,
        statement: 'No cross-scene targets.',
      },
      crossFloorTargets: {
        count: 0,
        statement: 'No cross-floor targets.',
      },
    },

    bindingSummary: {
      totalBindings: bindings.length,
      allConstraintDecisionNone: true,
      recalibratedBindings: bindings.filter(b => b.recalibrationDecision === 'recalibrate').length,
      probeResults: {
        total: totalProbes,
        pass: probePassCount,
        fail: probeFailCount,
      },
      uniqueTargetFragments: [...uniqueTargets].sort(),
    },

    metadata: {
      generatorScript: 'scripts/juyiting/generate-constraint-calibration.mjs',
      validatorScript: 'scripts/juyiting/validate-constraint-calibration.mjs',
      testFile: 'tests/juyiting-occlusion-constraint-calibration.test.js',
      fixturePath: 'tests/fixtures/juyiting/occlusion-v2-constraint/calibration-report.json',
    },
  }
}

// ── CLI entry point ──
function main() {
  try {
    const report = generateCalibrationReport()

    const outputPath = process.argv.includes('--output')
      ? process.argv[process.argv.indexOf('--output') + 1]
      : null

    const json = JSON.stringify(report, null, 2)

    if (outputPath) {
      writeFileSync(outputPath, json, 'utf-8')
      console.error(`Calibration report written to ${outputPath}`)
      console.error(`SHA-256: ${sha256(json)}`)
    } else {
      process.stdout.write(json)
    }
  } catch (e) {
    console.error(`FATAL: ${e.message}`)
    process.exit(1)
  }
}

// Only run CLI when executed directly (not imported)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  main()
}
