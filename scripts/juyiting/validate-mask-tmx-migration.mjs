#!/usr/bin/env node
/** E10B mechanical validator for 37 audit bindings + 32 canonical fragments. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import {
  E10A_TMX_SHA256, buildMaskMigrationDebugSvg, buildMaskMigrationSnapshot,
  buildMaskTmxManifest, readFragmentInputs, readLedger, sha256, stableJson,
  verifyMaskTmxMigration, verifyNavigationGeometry,
} from './lib/mask-tmx-migration.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const TMX_PATH = join(REPO_ROOT, 'public/juyiting/hall.tmx')
const LEDGER_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json')
const E9A_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json')
const E9B_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-atlases/atlas-manifest.json')
const MANIFEST_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/mask-tmx-manifest.json')
const SNAPSHOT_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/mask-migration.snapshot.json')
const PREVIEW_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/mask-migration-debug.svg')
const INVENTORY_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v0/inventory.json')
const MAP_SNAPSHOT_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/hall-map.snapshot.json')
const CLEAN_PREVIEW_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/map-preview/hall-clean.svg')
const DEBUG_PREVIEW_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/map-preview/hall-debug.svg')

function injectRenderSchemaV2(tmx) {
  return tmx.replace(
    '  <property name="sceneId" value="juyiting-main"/>',
    '  <property name="sceneId" value="juyiting-main"/>\n  <property name="renderSchemaVersion" value="2"/>',
  )
}

export async function runValidateMaskTmxMigration(args = process.argv.slice(2)) {
  if (args.length !== 0) throw new Error(`Unknown arguments: ${args.join(' ')}`)
  const tmxText = readFileSync(TMX_PATH, 'utf8')
  const ledger = readLedger(LEDGER_PATH)
  const { e9a, e9b } = readFragmentInputs(E9A_PATH, E9B_PATH)
  const tmxSha = sha256(Buffer.from(tmxText, 'utf8'))
  const errors = []

  const manifest = buildMaskTmxManifest(tmxText, ledger, e9a, e9b)
  const tmxResult = verifyMaskTmxMigration(tmxText, ledger, { manifest, e9a, e9b })
  if (!tmxResult.ok) errors.push(...tmxResult.errors)
  if (tmxSha === E10A_TMX_SHA256) errors.push('E10B migration not applied')

  const snapshot = buildMaskMigrationSnapshot(manifest, ledger)
  const preview = buildMaskMigrationDebugSvg(manifest, ledger, manifest.generationId)
  if (stableJson(manifest) !== readFileSync(MANIFEST_PATH, 'utf8')) errors.push('committed manifest drifts from fresh derivation')
  if (stableJson(snapshot) !== readFileSync(SNAPSHOT_PATH, 'utf8')) errors.push('committed snapshot drifts from fresh derivation')
  if (preview !== readFileSync(PREVIEW_PATH, 'utf8')) errors.push('committed debug preview drifts from fresh derivation')

  const nav = await verifyNavigationGeometry(tmxText, INVENTORY_PATH)
  if (!nav.ok) errors.push('navigation/collision/nav-obstacle geometry drifts from E1 fixture')
  const { createMapSnapshot, serializeMapSnapshot } = await import('../../src/game/map/tmxSnapshot.ts')
  const { parseMovementTmx } = await import('../../src/game/map/tmxMovementParser.ts')
  const derivedSnapshot = serializeMapSnapshot(createMapSnapshot(parseMovementTmx(tmxText)))
  if (derivedSnapshot !== readFileSync(MAP_SNAPSHOT_PATH, 'utf8')) errors.push('hall-map.snapshot.json drift')
  const { deriveMapPreviews } = await import('./render-map-preview.mjs')
  const derivedPreviews = deriveMapPreviews(tmxText, TMX_PATH)
  if (derivedPreviews.clean !== readFileSync(CLEAN_PREVIEW_PATH, 'utf8')) errors.push('clean preview derivation drift')
  if (derivedPreviews.debug !== readFileSync(DEBUG_PREVIEW_PATH, 'utf8')) errors.push('debug preview derivation drift')

  const { parseCanonicalIrFromXml } = await import('../../src/game/occlusion/canonicalIr.ts')
  let canonical
  try { canonical = parseCanonicalIrFromXml(injectRenderSchemaV2(tmxText)) }
  catch (error) { errors.push(`canonical parse failed: ${error instanceof Error ? error.message : String(error)}`) }
  if (canonical) {
    if (canonical.fragments.length !== 32) errors.push(`canonical fragment parse count ${canonical.fragments.length} != 32`)
    if (canonical.objects.length !== 5) errors.push(`canonical object parse count ${canonical.objects.length} != 5 E8B props`)
    if (canonical.zones.length !== 0) errors.push(`canonical zone parse count ${canonical.zones.length} != 0`)
    const maskBindingIds = new Set(manifest.maskBindings.map(binding => binding.stableId))
    if (canonical.objects.some(object => maskBindingIds.has(object.stableId)) || canonical.fragments.some(fragment => maskBindingIds.has(fragment.stableId))) {
      errors.push('legacy mask binding leaked into canonical IR')
    }
  }

  if (errors.length > 0) {
    console.error('=== E10B Mask/Fragment TMX Validation FAILED ===')
    for (const error of errors) console.error(`  ❌ ${error}`)
    process.exitCode = 1
    return { ok: false, errors }
  }
  console.log('=== E10B Mask/Fragment TMX Validation ===')
  console.log(`  Legacy bindings: ${manifest.maskBindingCount}/37; canonical fragments: ${manifest.canonicalFragmentCount}/32`)
  console.log(`  Canonical parse: objects=${canonical.objects.length} fragments=${canonical.fragments.length} zones=${canonical.zones.length}; bindings ignored=37`)
  console.log(`  Traceable probes: ${manifest.probeCount}/111; constraints=${manifest.constraintCount}; recalibrations=${manifest.recalibrationCount}/7`)
  console.log(`  Anonymous bindings=${manifest.anonymousBindingCount}; anonymous authoritative fragments=${manifest.anonymousTargetFragmentCount}`)
  console.log(`  E9A/E9B cross-validation: 32/32; atlas sourceRect uses extrusion-adjusted pixelBounds`)
  console.log(`  Navigation geometry: byte-equal to E1 (collision ${nav.collisionCount}, navObstacles ${nav.navObstacleCount})`)
  console.log('  Movement snapshot and freshly derived map previews: byte-identical')
  console.log(`  E10B TMX sha256: ${tmxSha}`)
  console.log('  ✅ VALIDATION PASSED')
  return { ok: true, errors: [], canonical }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await runValidateMaskTmxMigration(); if (!result.ok) process.exitCode = 1 }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
