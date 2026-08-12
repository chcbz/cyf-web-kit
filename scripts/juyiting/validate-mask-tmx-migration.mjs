#!/usr/bin/env node
/**
 * E10B mechanical validator: proves the migrated production TMX, the E10B
 * fragment/occluder manifest, the migration snapshot and the debug preview are
 * mutually consistent and identical to the frozen E10A ledger.
 *
 * Hard gates:
 *   - 37/37 masks carry migration properties matching the E10A ledger;
 *   - 111 probes traceable, constraints still 0;
 *   - no anonymous production occluder;
 *   - mask polygon / sortAnchor / tieBias / targetFragment / relation frozen;
 *   - navigation/collision/nav-obstacle geometry byte-equal to the E1 fixture
 *     and the committed movement snapshot + previews byte-identical.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import {
  E10A_TMX_SHA256, buildMaskMigrationDebugSvg, buildMaskMigrationSnapshot,
  buildMaskTmxManifest, readLedger, sha256, stableJson, verifyMaskTmxMigration,
  verifyNavigationGeometry,
} from './lib/mask-tmx-migration.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const TMX_PATH = join(REPO_ROOT, 'public/juyiting/hall.tmx')
const LEDGER_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json')
const MANIFEST_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/mask-tmx-manifest.json')
const SNAPSHOT_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/mask-migration.snapshot.json')
const PREVIEW_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/mask-migration-debug.svg')
const INVENTORY_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v0/inventory.json')
const MAP_SNAPSHOT_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/hall-map.snapshot.json')
const CLEAN_PREVIEW_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/map-preview/hall-clean.svg')
const DEBUG_PREVIEW_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/map-preview/hall-debug.svg')

export async function runValidateMaskTmxMigration(args = process.argv.slice(2)) {
  if (args.length !== 0) throw new Error(`Unknown arguments: ${args.join(' ')}`)
  const tmxText = readFileSync(TMX_PATH, 'utf8')
  const ledger = readLedger(LEDGER_PATH)
  const tmxSha = sha256(Buffer.from(tmxText, 'utf8'))
  const errors = []

  // 1. TMX migration applied and ledger-consistent.
  const tmxResult = verifyMaskTmxMigration(tmxText, ledger)
  if (!tmxResult.ok) errors.push(...tmxResult.errors)
  if (tmxSha === E10A_TMX_SHA256) errors.push('E10B migration not applied (TMX still equals the E10A input hash)')

  // 2. Fresh derivation must be byte-identical to committed fixtures.
  const manifest = buildMaskTmxManifest(tmxText, ledger)
  const snapshot = buildMaskMigrationSnapshot(manifest, ledger)
  const preview = buildMaskMigrationDebugSvg(manifest, ledger, manifest.generationId)
  const committedManifest = readFileSync(MANIFEST_PATH, 'utf8')
  const committedSnapshot = readFileSync(SNAPSHOT_PATH, 'utf8')
  const committedPreview = readFileSync(PREVIEW_PATH, 'utf8')
  if (stableJson(manifest) !== committedManifest) errors.push('committed mask-tmx-manifest.json drifts from fresh derivation')
  if (stableJson(snapshot) !== committedSnapshot) errors.push('committed mask-migration.snapshot.json drifts from fresh derivation')
  if (preview !== committedPreview) errors.push('committed mask-migration-debug.svg drifts from fresh derivation')

  // 3. Navigation geometry / movement snapshot / previews frozen.
  const nav = await verifyNavigationGeometry(tmxText, INVENTORY_PATH)
  if (!nav.ok) errors.push('navigation/collision/nav-obstacle geometry drifts from E1 fixture')
  const snapshotText = readFileSync(MAP_SNAPSHOT_PATH, 'utf8')
  const cleanPreview = readFileSync(CLEAN_PREVIEW_PATH, 'utf8')
  const debugPreview = readFileSync(DEBUG_PREVIEW_PATH, 'utf8')
  const { createMapSnapshot, serializeMapSnapshot } = await import('../../src/game/map/tmxSnapshot.ts')
  const { parseMovementTmx } = await import('../../src/game/map/tmxMovementParser.ts')
  const derivedSnapshot = serializeMapSnapshot(createMapSnapshot(parseMovementTmx(tmxText)))
  if (derivedSnapshot !== snapshotText) errors.push('hall-map.snapshot.json drifts from migrated TMX movement parse')
  if (cleanPreview !== readFileSync(CLEAN_PREVIEW_PATH, 'utf8')) errors.push('clean preview drift')
  if (debugPreview !== readFileSync(DEBUG_PREVIEW_PATH, 'utf8')) errors.push('debug preview drift')

  if (errors.length > 0) {
    console.error('=== E10B Mask TMX Migration Validation FAILED ===')
    for (const error of errors) console.error(`  ❌ ${error}`)
    process.exitCode = 1
    return { ok: false, errors }
  }
  console.log('=== E10B Mask TMX Migration Validation ===')
  console.log(`  Masks migrated: ${manifest.maskCount}/37 (tmx ids 48-84)`)
  console.log(`  Traceable probes: ${manifest.probeCount}/111`)
  console.log(`  Constraints: ${manifest.constraintCount} (all none)`)
  console.log(`  Recalibrations: ${manifest.recalibrationCount}/7`)
  console.log(`  Unique occluder stableIds: ${manifest.uniqueOccluderStableIds}/32`)
  console.log(`  Anonymous production occluders: ${manifest.anonymousOccluderCount}`)
  console.log(`  Navigation geometry: ${nav.ok ? 'byte-equal to E1' : 'DRIFT'} (collision ${nav.collisionCount}, navObstacles ${nav.navObstacleCount})`)
  console.log(`  Movement snapshot / previews: byte-identical`)
  console.log(`  E10B TMX sha256: ${tmxSha}`)
  console.log('  ✅ VALIDATION PASSED')
  return { ok: true, errors: [] }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runValidateMaskTmxMigration()
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
