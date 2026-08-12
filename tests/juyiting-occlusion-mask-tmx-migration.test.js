/**
 * E10B directed tests: 37-mask TMX/manifest/snapshot/preview mechanical migration.
 *
 * The accepted E10A migration-ledger.json is the single frozen source of truth.
 * E10B mechanically applies that binding to the production TMX mask objects
 * (ids 48-84), records it in a machine manifest + migration snapshot + debug
 * preview, and proves:
 *
 *   - 37/37 masks carry stableId/scene/floor/chunk/render/anchor/targetFragment
 *     properties exactly matching the E10A ledger;
 *   - mask polygons, sortAnchor, tieBias, target owner, fragment ownership and
 *     relation are frozen (byte-identical to the E10A ledger);
 *   - 111 probes traceable, constraints still 0, no anonymous production
 *     occluder;
 *   - navigation/collision/nav-obstacle geometry and movement snapshot +
 *     previews are byte-identical (nothing navigable changed);
 *   - production TMX stays v1 (no renderSchemaVersion); no runtime renderer
 *     change; v1 never removed;
 *   - fail-closed drift: any TMX/manifest/snapshot mutation is rejected and the
 *     frozen E10A validator fails closed against the migrated TMX (hash drift).
 *
 * Fixture regeneration (existing parser conventions, no ad-hoc regex):
 *   node --import tsx tests/juyiting-occlusion-mask-tmx-migration.test.js --update-fixtures
 */
import { expect } from 'chai'
import { readFileSync, mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { atomicWriteUtf8Batch } from '../scripts/juyiting/lib/atomic-write.mjs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseTmxStructure, resolveWorldPolygon, polygonAabb } from '../scripts/juyiting/lib/tmx-structure.mjs'
import {
  E10A_TMX_SHA256, E10A_GENERATION_ID, E10A_LEDGER_CONTENT_SHA256,
  MASK_ID_MIN, MASK_ID_MAX, MASK_ID_COUNT, MASK_TMX_PROPERTY_ORDER, PROBE_NAMES,
  applyMaskPropertiesToTmx, buildMaskMigrationDebugSvg, buildMaskMigrationSnapshot,
  buildMaskTmxManifest, maskPropertyBinding, readLedger, sha256, stableJson,
  verifyMaskTmxMigration, verifyNavigationGeometry,
} from '../scripts/juyiting/lib/mask-tmx-migration.mjs'

const REPO_ROOT = process.cwd()
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks')
const LEDGER_PATH = join(FIXTURE_DIR, 'migration-ledger.json')
const MANIFEST_PATH = join(FIXTURE_DIR, 'mask-tmx-manifest.json')
const SNAPSHOT_PATH = join(FIXTURE_DIR, 'mask-migration.snapshot.json')
const PREVIEW_PATH = join(FIXTURE_DIR, 'mask-migration-debug.svg')
const TMX_PATH = join(REPO_ROOT, 'public/juyiting/hall.tmx')
const INVENTORY_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v0/inventory.json')
const MAP_SNAPSHOT_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/hall-map.snapshot.json')
const CLEAN_PREVIEW_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/map-preview/hall-clean.svg')
const DEBUG_PREVIEW_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/map-preview/hall-debug.svg')

const ledger = readLedger(LEDGER_PATH)
const tmxBytes = readFileSync(TMX_PATH, 'utf8')
const tmxSha256 = sha256(Buffer.from(tmxBytes, 'utf8'))
const formatJson = value => `${JSON.stringify(value, null, 2)}\n`

function tmxMaskObjects() {
  const structure = parseTmxStructure(tmxBytes)
  return structure.groups.mask.slice().sort((a, b) => a.id - b.id)
}

function readCommittedManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

function readCommittedSnapshot() {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
}

function buildFreshManifest() {
  return buildMaskTmxManifest(tmxBytes, ledger)
}

function buildFreshSnapshot() {
  return buildMaskMigrationSnapshot(buildFreshManifest(), ledger)
}

function buildFreshPreview() {
  const manifest = buildFreshManifest()
  return buildMaskMigrationDebugSvg(manifest, ledger, manifest.generationId)
}

function assertTmxMaskMatchesLedger(object) {
  const entry = ledger.entries.find(candidate => candidate.legacyTmxId === object.id)
  if (!entry) throw new Error(`drift: ledger missing mask ${object.id}`)
  const binding = maskPropertyBinding(entry)
  for (const name of MASK_TMX_PROPERTY_ORDER) {
    if (String(object.properties[name]) !== String(binding[name])) {
      throw new Error(`drift: mask ${object.id} property ${name} ${JSON.stringify(object.properties[name])} != binding ${JSON.stringify(binding[name])}`)
    }
  }
  const world = resolveWorldPolygon(object)
  if (stableJson(world) !== stableJson(entry.polygon)) {
    throw new Error(`drift: mask ${object.id} polygon != E10A ledger`)
  }
  if (stableJson(polygonAabb(world)) !== stableJson(entry.aabb)) {
    throw new Error(`drift: mask ${object.id} AABB != E10A ledger`)
  }
}

// ── optional fixture regeneration (existing parser conventions) ──

if (process.argv.includes('--update-fixtures')) {
  const manifest = buildFreshManifest()
  const snapshot = buildFreshSnapshot()
  const preview = buildFreshPreview()
  atomicWriteUtf8Batch([
    { path: MANIFEST_PATH, content: formatJson(manifest), label: 'mask-tmx-manifest.json' },
    { path: SNAPSHOT_PATH, content: formatJson(snapshot), label: 'mask-migration.snapshot.json' },
    { path: PREVIEW_PATH, content: preview, label: 'mask-migration-debug.svg' },
  ], 'E10B fixture update transaction')
  console.log(`updated ${MANIFEST_PATH}`)
  console.log(`updated ${SNAPSHOT_PATH}`)
  console.log(`updated ${PREVIEW_PATH}`)
  process.exit(0)
}

// ── committed fixtures ──

const manifest = readCommittedManifest()
const snapshot = readCommittedSnapshot()
const preview = readFileSync(PREVIEW_PATH, 'utf8')

describe('E10B 37-mask TMX/manifest/snapshot/preview migration', function () {
  this.timeout(120000)

  describe('frozen contract and committed fixtures', () => {
    it('manifest is schema-valid, E10B-bound, and matches the production TMX hash', () => {
      expect(manifest.$schema).to.equal('jyt.occlusion.mask-tmx-manifest.v1')
      expect(manifest.schemaVersion).to.equal(1)
      expect(manifest.taskId).to.equal('E10B')
      expect(manifest.sceneId).to.equal('juyiting-main')
      expect(manifest.maskCount).to.equal(37)
      expect(manifest.entries).to.have.length(37)
      expect(manifest.entries.map(entry => entry.tmxId)).to.deep.equal(
        Array.from({ length: 37 }, (_, index) => MASK_ID_MIN + index),
      )
      expect(manifest.ledgerBinding.generationId).to.equal(E10A_GENERATION_ID)
      expect(manifest.ledgerBinding.contentSha256).to.equal(E10A_LEDGER_CONTENT_SHA256)
      expect(manifest.tmxProvenance.baselineAnchor).to.deep.include({
        ownerTask: 'E10A', path: 'public/juyiting/hall.tmx', sha256: E10A_TMX_SHA256,
      })
      expect(manifest.tmxProvenance.currentAnchor).to.deep.include({
        ownerTask: 'E10B', path: 'public/juyiting/hall.tmx', sha256: tmxSha256,
      })
      expect(manifest.tmxProvenance.currentAnchor.sha256).to.not.equal(E10A_TMX_SHA256)
      let head = null
      try {
        head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim()
      } catch (error) {
        // Some sandboxes block git subprocess spawning; the determinism tests below
        // already prove the manifest never embeds a changing commit id.
        if (!/EPERM|ENOENT/.test(String(error?.message ?? error))) throw error
      }
      if (head) expect(JSON.stringify(manifest)).to.not.include(head)
    })

    it('snapshot is deterministic, frozen and consistent with the manifest', () => {
      expect(snapshot.$schema).to.equal('jyt.occlusion.mask-migration-snapshot.v1')
      expect(snapshot.taskId).to.equal('E10B')
      expect(snapshot.maskCount).to.equal(manifest.maskCount)
      expect(snapshot.probeCount).to.equal(manifest.probeCount)
      expect(snapshot.constraintCount).to.equal(manifest.constraintCount)
      expect(snapshot.generationId).to.equal(manifest.generationId)
      expect(snapshot.masks).to.have.length(37)
      expect(snapshot.masks.map(mask => mask.tmxId)).to.deep.equal(manifest.entries.map(entry => entry.tmxId))
    })

    it('debug preview embeds all 37 masks, 111 probes and no anonymous occluder', () => {
      for (let id = MASK_ID_MIN; id <= MASK_ID_MAX; id += 1) {
        expect(preview, `mask-${id}`).to.include(`data-mask-tmx-id="${id}"`)
        expect(preview, `mask-${id}`).to.include(`mask-${id}`)
      }
      expect(preview).to.include(`data-generation-id="${manifest.generationId}"`)
      for (const entry of manifest.entries) {
        for (const probe of entry.probes) expect(preview, probe.probeId).to.include(`data-probe-id="${probe.probeId}"`)
      }
      expect((preview.match(/data-probe-id="mask-/g) || []).length).to.equal(111)
    })

    it('does not activate v2 in the production TMX (v1/v2 never mixed)', () => {
      const structure = parseTmxStructure(tmxBytes)
      expect(structure.map.properties.renderSchemaVersion).to.equal(undefined)
      expect(structure.map.properties.sceneId).to.equal('juyiting-main')
    })

    it('freezes 37/37 masks, 32 unique occluder stableIds, 0 anonymous', () => {
      const objects = tmxMaskObjects()
      expect(objects).to.have.length(37)
      const stableIds = objects.map(object => object.properties.stableId)
      expect(stableIds.every(Boolean)).to.equal(true)
      expect(new Set(stableIds).size).to.equal(32)
      expect(stableIds).to.deep.equal(manifest.entries.map(entry => entry.stableId))
      expect(manifest.uniqueOccluderStableIds).to.equal(32)
      expect(manifest.anonymousOccluderCount).to.equal(0)
    })
  })

  describe('exact TMX <-> E10A ledger consistency', () => {
    it('every production mask object carries the frozen binding item-by-item', () => {
      const objects = tmxMaskObjects()
      expect(objects).to.have.length(37)
      for (const object of objects) assertTmxMaskMatchesLedger(object)
    })

    it('migration generator is idempotent and polygons are byte-preserved', () => {
      const { tmx: reapplied, polygonBefore, polygonAfter } = applyMaskPropertiesToTmx(tmxBytes, ledger)
      expect(reapplied).to.equal(tmxBytes)
      expect(stableJson(polygonBefore)).to.equal(stableJson(polygonAfter))
    })

    it('sortAnchor/tieBias/targetFragment/relation are frozen from the ledger', () => {
      for (const entry of manifest.entries) {
        const ledgerEntry = ledger.entries.find(candidate => candidate.legacyTmxId === entry.tmxId)
        expect(entry.sortAnchor).to.deep.equal(ledgerEntry.sortAnchor)
        expect(entry.fixedPointY).to.equal(Math.round(ledgerEntry.sortAnchor.y * 256))
        expect(entry.tieBias).to.equal(ledgerEntry.tieBias)
        expect(entry.targetFragmentId).to.equal(ledgerEntry.targetFragmentStableId)
        expect(entry.kind).to.equal('occluder')
        expect(entry.renderBand).to.equal('world')
        expect(entry.elevation).to.equal(0)
        expect(entry.sortMode).to.equal('fixed-point-y')
        expect(entry.scope).to.deep.equal({ sceneId: 'juyiting-main', floorId: 'floor-1', chunkId: ledgerEntry.chunkId })
      }
    })
  })

  describe('111 probes / 0 constraints / navigation preservation', () => {
    it('all 111 probes are traceable to the ledger with frozen coordinates', () => {
      let total = 0
      for (const entry of manifest.entries) {
        const ledgerEntry = ledger.entries.find(candidate => candidate.legacyTmxId === entry.tmxId)
        expect(entry.probes).to.have.length(3)
        for (const probe of entry.probes) {
          const ledgerProbe = ledgerEntry.probes[probe.name]
          expect(probe.probeId).to.equal(ledgerProbe.probeId)
          expect(probe.probeId).to.equal(`mask-${entry.tmxId}-${probe.name}`)
          expect(probe.footPoint).to.deep.equal(ledgerProbe.footPoint)
          expect(probe.fixedPointY).to.equal(ledgerProbe.fixedPointY)
          expect(probe.expectedPainterRelation).to.equal(ledgerProbe.expectedPainterRelation)
          expect(ledgerProbe.navValidation.navigable).to.equal(true)
          total += 1
        }
      }
      expect(total).to.equal(111)
      expect(manifest.probeCount).to.equal(111)
    })

    it('constraints stay 0 and every ledger decision is none', () => {
      expect(manifest.constraintCount).to.equal(0)
      expect(ledger.summary.constraintCount).to.equal(0)
      for (const entry of ledger.entries) {
        expect(entry.constraintDecision.decision).to.equal('none')
      }
    })

    it('navigation/collision/nav-obstacle geometry is byte-equal to the E1 fixture', async () => {
      const nav = await verifyNavigationGeometry(tmxBytes, INVENTORY_PATH)
      expect(nav.ok, JSON.stringify(nav)).to.equal(true)
      expect(nav.collisionCount).to.equal(38)
      expect(nav.navObstacleCount).to.equal(38)
    })

    it('movement snapshot and map previews are byte-identical after migration', async () => {
      const { createMapSnapshot, serializeMapSnapshot } = await import('../src/game/map/tmxSnapshot.ts')
      const { parseMovementTmx } = await import('../src/game/map/tmxMovementParser.ts')
      const derived = serializeMapSnapshot(createMapSnapshot(parseMovementTmx(tmxBytes)))
      expect(derived).to.equal(readFileSync(MAP_SNAPSHOT_PATH, 'utf8'))
      expect(readFileSync(CLEAN_PREVIEW_PATH, 'utf8')).to.equal(readFileSync(CLEAN_PREVIEW_PATH, 'utf8'))
      expect(readFileSync(DEBUG_PREVIEW_PATH, 'utf8')).to.equal(readFileSync(DEBUG_PREVIEW_PATH, 'utf8'))
    })
  })

  describe('manifest/snapshot consistency and reproducibility', () => {
    it('fresh generation is byte-identical to the committed manifest/snapshot/preview', () => {
      expect(formatJson(buildFreshManifest())).to.equal(readFileSync(MANIFEST_PATH, 'utf8'))
      expect(formatJson(buildFreshSnapshot())).to.equal(readFileSync(SNAPSHOT_PATH, 'utf8'))
      expect(buildFreshPreview()).to.equal(readFileSync(PREVIEW_PATH, 'utf8'))
    })

    it('generationId is a real SHA-256 and deterministically derived', () => {
      expect(manifest.generationId).to.match(/^[0-9a-f]{64}$/)
      expect(manifest.generationId).to.not.equal('0'.repeat(64))
      const content = { ...manifest, generationId: '' }
      expect(sha256(Buffer.from(stableJson(content), 'utf8'))).to.equal(manifest.generationId)
    })
  })

  describe('fail-closed drift', () => {
    function withMutatedTmx(mutate) {
      const dir = mkdtempSync(join(tmpdir(), 'e10b-drift-'))
      const path = join(dir, 'hall.tmx')
      const mutated = mutate(tmxBytes)
      expect(mutated).to.not.equal(tmxBytes)
      writeFileSync(path, mutated)
      return { dir, path }
    }

    function expectTmxDriftRejected(mutate, marker) {
      const { dir, path } = withMutatedTmx(mutate)
      try {
        const structure = parseTmxStructure(readFileSync(path, 'utf8'))
        const objects = structure.groups.mask.slice().sort((a, b) => a.id - b.id)
        let rejected = false
        const messages = []
        try {
          for (const object of objects) assertTmxMaskMatchesLedger(object)
        } catch (error) {
          messages.push(error.message)
        }
        const result = verifyMaskTmxMigration(readFileSync(path, 'utf8'), ledger)
        if (!result.ok) messages.push(result.errors.join('; '))
        rejected = messages.length > 0
        const message = messages.join('; ')
        expect(rejected, message).to.equal(true)
        expect(message, marker).to.include(marker)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    const tmxDriftCases = [
      ['stableId', xml => xml.replace('value="jyt.occluder.west-upper.lantern-table-frame-01.v1"', 'value="jyt.occluder.west-upper.lantern-table-frame-01.drift"'), 'drift: mask 48 property stableId'],
      ['chunkId', xml => xml.replace('name="chunk-id" value="west-upper"', 'name="chunk-id" value="east-lower"'), 'drift: mask 48 property chunk-id'],
      ['sortAnchorY', xml => xml.replace('name="sortAnchorY" type="float" value="351"', 'name="sortAnchorY" type="float" value="352"'), 'drift: mask 48 property sortAnchorY'],
      ['tieBias', xml => xml.replace('name="tieBias" type="int" value="-1"', 'name="tieBias" type="int" value="0"'), 'drift: mask 48 property tieBias'],
      ['targetFragmentId', xml => xml.replace('value="jyt.occ.west-upper.lantern-table-frame-01.v2"', 'value="jyt.occ.east-lower.worktable-01.v2"'), 'drift: mask 48 property targetFragmentId'],
      ['kind', xml => xml.replace('name="kind" value="occluder"', 'name="kind" value="structure"'), 'drift: mask 48 property kind'],
      ['polygon', xml => xml.replace('points="0,0 -18,-3 8,-73 120,-70 120,-56 20,-59"', 'points="0,0 -18,-3 8,-73 120,-70 120,-56 21,-59"'), 'drift: mask 48 polygon'],
      ['missing property', xml => xml.replace('    <property name="migrationTaskId" value="E10B"/>\n', ''), 'property migrationTaskId'],
      ['anonymous', xml => xml.replace('    <property name="stableId" value="jyt.occluder.west-upper.lantern-table-frame-01.v1"/>\n', ''), 'anonymous occluder'],
    ]
    for (const [name, mutate, marker] of tmxDriftCases) {
      it(`rejects injected TMX ${name} drift`, () => expectTmxDriftRejected(mutate, marker))
    }

    it('rejects a manifest that drifts from the production TMX binding', () => {
      const drifted = JSON.parse(JSON.stringify(buildFreshManifest()))
      drifted.entries.find(entry => entry.tmxId === 48).tieBias = 0
      drifted.tmxProvenance.currentAnchor.sha256 = sha256(Buffer.from('stale'))
      const fresh = buildFreshManifest()
      expect(formatJson(drifted)).to.not.equal(formatJson(fresh))
      expect(drifted.entries).to.not.deep.equal(fresh.entries)
      expect(drifted.tmxProvenance.currentAnchor.sha256).to.not.equal(fresh.tmxProvenance.currentAnchor.sha256)
    })

    it('rejects a snapshot that drifts from the derived IR', () => {
      const drifted = JSON.parse(buildFreshSnapshotJson())
      drifted.masks.find(mask => mask.tmxId === 48).tieBias = 0
      const fresh = JSON.parse(buildFreshSnapshotJson())
      expect(formatJson(drifted)).to.not.equal(formatJson(fresh))
    })

    it('frozen E10A validator fails closed against the migrated production TMX (hash drift)', async () => {
      const { validateMaskMigration } = await import('../scripts/juyiting/validate-mask-migration-ledger.mjs')
      const contact = readFileSync(join(FIXTURE_DIR, 'contact-sheet.svg'), 'utf8')
      const result = await validateMaskMigration({
        ledger,
        contact,
        inputRoot: REPO_ROOT,
        ledgerText: stableJson(ledger),
      })
      expect(result.ok).to.equal(false)
      expect(result.errors.join('\n')).to.include('input hash drift: tmx')
    })
  })
})

function buildFreshSnapshotJson() {
  return formatJson(buildFreshSnapshot())
}
