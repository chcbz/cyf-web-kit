#!/usr/bin/env node
/**
 * E10B: mechanically migrate the 37 legacy mask TMX objects (ids 48-84) from
 * the accepted E10A ledger. Only adds migration `<properties>`; polygon,
 * sortAnchor, probe, target owner, fragment ownership, relation and navigation
 * geometry are preserved byte-for-byte (verified before writing).
 *
 * Usage:
 *   node scripts/juyiting/apply-mask-tmx-migration.mjs            # verify only
 *   node scripts/juyiting/apply-mask-tmx-migration.mjs --update   # migrate TMX
 *
 * The script refuses to run unless the live TMX still matches the E10A frozen
 * input hash (i.e. migration has not been applied yet). Re-running after a
 * migration fails closed instead of double-applying properties.
 */
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import { atomicWriteUtf8 } from './lib/atomic-write.mjs'
import {
  E10A_TMX_SHA256, applyMaskPropertiesToTmx, readLedger, sha256, stableJson,
} from './lib/mask-tmx-migration.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const TMX_PATH = join(REPO_ROOT, 'public/juyiting/hall.tmx')
const LEDGER_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json')

function readTmx() {
  return readFileSync(TMX_PATH, 'utf8')
}

function migrate() {
  const tmxText = readTmx()
  const currentSha = sha256(Buffer.from(tmxText, 'utf8'))
  if (currentSha !== E10A_TMX_SHA256) {
    throw new Error(
      `E10B migration precondition failed: live TMX sha256 ${currentSha} != E10A frozen input ${E10A_TMX_SHA256}. ` +
      'Either the migration was already applied, or the TMX drifted from the accepted E10A ledger. Stop; do not guess.',
    )
  }
  const ledger = readLedger(LEDGER_PATH)
  const { tmx: migrated } = applyMaskPropertiesToTmx(tmxText, ledger)
  const migratedSha = sha256(Buffer.from(migrated, 'utf8'))
  if (migratedSha === currentSha) throw new Error('E10B migration produced no change')
  return { migrated, currentSha, migratedSha, ledger }
}

function verifyApplied() {
  const tmxText = readTmx()
  const ledger = readLedger(LEDGER_PATH)
  const { tmx: migrated } = applyMaskPropertiesToTmx(tmxText, ledger)
  if (migrated !== tmxText) {
    throw new Error('E10B TMX migration is NOT applied (live TMX differs from expected migrated form)')
  }
  return {
    sha256: sha256(Buffer.from(tmxText, 'utf8')),
    polygonPreserved: true,
  }
}

function cli() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    const result = verifyApplied()
    console.log('E10B TMX migration applied; polygons preserved byte-for-byte')
    console.log(`  TMX sha256: ${result.sha256}`)
    return
  }
  if (args.length === 1 && args[0] === '--update') {
    const { migrated, currentSha, migratedSha } = migrate()
    atomicWriteUtf8(TMX_PATH, migrated, 'E10B migrated hall.tmx')
    console.log(`E10B TMX migration applied (37 masks, ids 48-84)`)
    console.log(`  before: ${currentSha}`)
    console.log(`  after : ${migratedSha}`)
    return
  }
  throw new Error(`Unknown arguments: ${args.join(' ')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli() } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
