#!/usr/bin/env node
/**
 * E10B: deterministically generate the fragment/occluder manifest, migration
 * snapshot and debug preview from the migrated production TMX + E10A ledger.
 *
 * Usage:
 *   node scripts/juyiting/generate-mask-tmx-migration.mjs            # verify only
 *   node scripts/juyiting/generate-mask-tmx-migration.mjs --update   # write fixtures
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { atomicWriteUtf8Batch } from './lib/atomic-write.mjs'
import {
  buildMaskMigrationDebugSvg, buildMaskMigrationSnapshot, buildMaskTmxManifest,
  readLedger, stableJson,
} from './lib/mask-tmx-migration.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks')
const TMX_PATH = join(REPO_ROOT, 'public/juyiting/hall.tmx')
const LEDGER_PATH = join(FIXTURE_DIR, 'migration-ledger.json')
const MANIFEST_PATH = join(FIXTURE_DIR, 'mask-tmx-manifest.json')
const SNAPSHOT_PATH = join(FIXTURE_DIR, 'mask-migration.snapshot.json')
const PREVIEW_PATH = join(FIXTURE_DIR, 'mask-migration-debug.svg')

export function generateMaskTmxMigrationFixtures({ write = true } = {}) {
  const tmxText = readFileSync(TMX_PATH, 'utf8')
  const ledger = readLedger(LEDGER_PATH)
  const manifest = buildMaskTmxManifest(tmxText, ledger)
  const snapshot = buildMaskMigrationSnapshot(manifest, ledger)
  const preview = buildMaskMigrationDebugSvg(manifest, ledger, manifest.generationId)
  const outputs = [
    { path: MANIFEST_PATH, content: stableJson(manifest), label: 'mask-tmx-manifest.json' },
    { path: SNAPSHOT_PATH, content: stableJson(snapshot), label: 'mask-migration.snapshot.json' },
    { path: PREVIEW_PATH, content: preview, label: 'mask-migration-debug.svg' },
  ]
  if (write) {
    atomicWriteUtf8Batch(outputs.map(output => ({
      path: output.path,
      content: output.content,
      label: output.label,
    })), 'E10B migration fixture update transaction')
  }
  return { manifest, snapshot, preview, outputs }
}

function cli() {
  const args = process.argv.slice(2)
  const update = args.length === 1 && args[0] === '--update'
  if (args.length > 1 || (args.length === 1 && !update)) {
    throw new Error(`Unknown arguments: ${args.join(' ')}`)
  }
  const result = generateMaskTmxMigrationFixtures({ write: update })
  console.log(`E10B fixtures ${update ? 'updated' : 'verified'} (generationId=${result.manifest.generationId.slice(0, 16)}…)`)
  console.log(`  masks=${result.manifest.maskCount} probes=${result.manifest.probeCount} constraints=${result.manifest.constraintCount} recalibrations=${result.manifest.recalibrationCount} uniqueOccluders=${result.manifest.uniqueOccluderStableIds} anonymous=${result.manifest.anonymousOccluderCount}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) cli()
