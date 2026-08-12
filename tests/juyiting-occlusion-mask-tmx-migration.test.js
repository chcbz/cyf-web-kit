/** E10B directed tests: 37 legacy audit bindings + 32 canonical fragments. */
import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { parseTmxStructure } from '../scripts/juyiting/lib/tmx-structure.mjs'
import {
  E10A_GENERATION_ID, E10A_LEDGER_CONTENT_SHA256, E10A_LEDGER_WHOLE_SHA256,
  E9A_GENERATION_ID, E9A_SPEC_SHA256, E9B_MANIFEST_ID, E9B_MANIFEST_SHA256,
  MASK_TMX_PROPERTY_ORDER, buildCanonicalFragments, buildMaskMigrationDebugSvg,
  buildMaskMigrationSnapshot, buildMaskTmxManifest, readFragmentInputs, readLedger,
  sha256, stableJson, verifyMaskTmxMigration, verifyNavigationGeometry,
} from '../scripts/juyiting/lib/mask-tmx-migration.mjs'
import { parseCanonicalIrFromXml } from '../src/game/occlusion/canonicalIr.ts'

const ROOT = process.cwd()
const FIX = join(ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks')
const TMX_PATH = join(ROOT, 'public/juyiting/hall.tmx')
const LEDGER_PATH = join(FIX, 'migration-ledger.json')
const E9A_PATH = join(ROOT, 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json')
const E9B_PATH = join(ROOT, 'tests/fixtures/juyiting/occlusion-v2-atlases/atlas-manifest.json')
const INVENTORY_PATH = join(ROOT, 'tests/fixtures/juyiting/occlusion-v0/inventory.json')
const MANIFEST_PATH = join(FIX, 'mask-tmx-manifest.json')
const SNAPSHOT_PATH = join(FIX, 'mask-migration.snapshot.json')
const PREVIEW_PATH = join(FIX, 'mask-migration-debug.svg')

const tmx = readFileSync(TMX_PATH, 'utf8')
const ledger = readLedger(LEDGER_PATH)
const { e9a, e9b } = readFragmentInputs(E9A_PATH, E9B_PATH)
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
const preview = readFileSync(PREVIEW_PATH, 'utf8')

function injectV2(xml) {
  return xml.replace('  <property name="sceneId" value="juyiting-main"/>', '  <property name="sceneId" value="juyiting-main"/>\n  <property name="renderSchemaVersion" value="2"/>')
}
function maskGroup(xml) { return xml.match(/<objectgroup id="13" name="mask">([\s\S]*?)<\/objectgroup>/)?.[1] ?? '' }
function fragmentGroup(xml) { return xml.match(/<objectgroup id="25" name="v2-fragments-occluders">([\s\S]*?)<\/objectgroup>/)?.[1] ?? '' }
function expectRejected(xml, marker) {
  const result = verifyMaskTmxMigration(xml, ledger, { e9a, e9b })
  expect(result.ok).to.equal(false)
  expect(result.errors.join('; ')).to.include(marker)
}

describe('E10B mask binding and canonical fragment migration', function () {
  this.timeout(30000)

  it('independently verifies E10A/E9A/E9B whole-file and content provenance', () => {
    expect(sha256(readFileSync(LEDGER_PATH))).to.equal(E10A_LEDGER_WHOLE_SHA256)
    const blank = JSON.stringify({ ...JSON.parse(readFileSync(LEDGER_PATH, 'utf8')), contentSha256: '' }, null, 2)
    expect(createHash('sha256').update(blank).digest('hex')).to.equal(E10A_LEDGER_CONTENT_SHA256)
    expect(ledger.generationId).to.equal(E10A_GENERATION_ID)
    expect(sha256(readFileSync(E9A_PATH))).to.equal(E9A_SPEC_SHA256)
    expect(e9a.generationId).to.equal(E9A_GENERATION_ID)
    expect(sha256(readFileSync(E9B_PATH))).to.equal(E9B_MANIFEST_SHA256)
    expect(e9b.manifestId).to.equal(E9B_MANIFEST_ID)
  })

  it('uses canonical-compatible literal binding metadata, not shared-helper-only assertions', () => {
    const structure = parseTmxStructure(tmx)
    expect(structure.groups.mask).to.have.length(37)
    for (const object of structure.groups.mask) {
      expect(object.properties.stableId).to.equal(`jyt.mask-binding.mask-${object.id}.v1`)
      expect(object.properties.ledgerOccluderStableId).to.match(/^jyt\.occluder\..+\.v1$/)
      expect(object.properties).to.have.property('chunkId')
      expect(object.properties).not.to.have.property('chunk-id')
      expect(object.properties.kind).to.equal('legacy-mask-binding')
      expect(object.properties.sortMode).to.equal('fixed')
      expect(object.properties.ledgerSortContract).to.equal('fixed-point-y')
      expect(object.properties.fixedPointY).to.equal(Math.round(object.properties.sortAnchorY * 256))
      expect(object.properties.targetFragmentId).to.match(/^jyt\.occ\..+\.v2$/)
    }
    expect(MASK_TMX_PROPERTY_ORDER).to.include('chunkId')
    expect(MASK_TMX_PROPERTY_ORDER).not.to.include('chunk-id')
  })

  it('cross-validates all 32 authoritative fragments against independent E9A and E9B inputs', () => {
    const fragments = buildCanonicalFragments(ledger, e9a, e9b)
    expect(fragments).to.have.length(32)
    expect(new Set(fragments.map(fragment => fragment.stableId)).size).to.equal(32)
    const e9aById = new Map(e9a.fragments.map(fragment => [fragment.stableId, fragment]))
    const e9bById = new Map(e9b.fragments.map(fragment => [fragment.stableId, fragment]))
    for (const fragment of fragments) {
      const spec = e9aById.get(fragment.stableId)
      const atlas = e9bById.get(fragment.stableId)
      expect(fragment.kind).to.equal('occluder-fragment')
      expect(fragment.sortMode).to.equal('fixed')
      expect(fragment.assetRef).to.equal(atlas.atlasFile.replace('public/juyiting/', ''))
      expect(fragment.sourceRect).to.deep.equal({
        x: atlas.atlasRect.x + atlas.extrusionPixels,
        y: atlas.atlasRect.y + atlas.extrusionPixels,
        width: atlas.pixelBounds.width,
        height: atlas.pixelBounds.height,
      })
      expect(fragment.destinationRect).to.deep.equal(atlas.pixelBounds)
      expect(spec.stableId).to.equal(fragment.stableId)
      expect(spec.chunkId).to.equal(fragment.chunkId)
      expect(atlas.ownedOpaquePixelCount).to.equal(spec.ownedOpaquePixelCount)
    }
  })

  it('temporarily activates schema v2: 32 fragments parse, 37 bindings are ignored, five E8B props remain', () => {
    expect(parseTmxStructure(tmx).map.properties.renderSchemaVersion).to.equal(undefined)
    const ir = parseCanonicalIrFromXml(injectV2(tmx))
    expect(ir.fragments).to.have.length(32)
    expect(ir.objects).to.have.length(5)
    expect(ir.zones).to.have.length(0)
    expect(ir.objects.every(object => object.kind === 'prop')).to.equal(true)
    const bindingIds = new Set(manifest.maskBindings.map(binding => binding.stableId))
    expect(ir.objects.some(object => bindingIds.has(object.stableId))).to.equal(false)
    expect(ir.fragments.some(fragment => bindingIds.has(fragment.stableId))).to.equal(false)
    expect(ir.fragments.map(fragment => fragment.stableId)).to.deep.equal([...e9a.fragments.map(fragment => fragment.stableId)].sort())
  })

  it('separates 37 non-drawable bindings from 32 canonical drawable fragments in fixtures', () => {
    expect(manifest.$schema).to.equal('jyt.occlusion.mask-fragment-tmx-manifest.v2')
    expect(manifest.maskBindingCount).to.equal(37)
    expect(manifest.canonicalFragmentCount).to.equal(32)
    expect(new Set(manifest.maskBindings.map(binding => binding.stableId)).size).to.equal(37)
    expect(new Set(manifest.maskBindings.map(binding => binding.ledgerOccluderStableId)).size).to.equal(32)
    expect(manifest.maskBindings.every(binding => binding.kind === 'legacy-mask-binding' && binding.canonicalDrawable === false)).to.equal(true)
    expect(manifest.canonicalFragments.every(fragment => fragment.kind === 'occluder-fragment' && fragment.sortMode === 'fixed')).to.equal(true)
    expect(manifest.anonymousBindingCount).to.equal(0)
    expect(manifest.anonymousTargetFragmentCount).to.equal(0)
    expect(snapshot.maskBindingCount).to.equal(37)
    expect(snapshot.canonicalFragmentCount).to.equal(32)
  })

  it('preserves 111 probes, zero constraints and exact accepted fixed-point Y facts', () => {
    expect(manifest.probeCount).to.equal(111)
    expect(manifest.constraintCount).to.equal(0)
    for (const binding of manifest.maskBindings) {
      const entry = ledger.entries.find(candidate => candidate.legacyTmxId === binding.tmxId)
      expect(binding.sortAnchor).to.deep.equal(entry.sortAnchor)
      expect(binding.fixedPointY).to.equal(entry.fixedPointY)
      expect(binding.tieBias).to.equal(entry.tieBias)
      expect(binding.targetFragmentId).to.equal(entry.targetFragmentStableId)
      expect(binding.probes.map(probe => probe.probeId)).to.deep.equal(['behind', 'boundary', 'front'].map(name => entry.probes[name].probeId))
    }
  })

  it('fresh manifest/snapshot/debug preview generation is byte-deterministic', () => {
    const freshManifest = buildMaskTmxManifest(tmx, ledger, e9a, e9b)
    const freshSnapshot = buildMaskMigrationSnapshot(freshManifest, ledger)
    const freshPreview = buildMaskMigrationDebugSvg(freshManifest, ledger, freshManifest.generationId)
    expect(stableJson(freshManifest)).to.equal(readFileSync(MANIFEST_PATH, 'utf8'))
    expect(stableJson(freshSnapshot)).to.equal(readFileSync(SNAPSHOT_PATH, 'utf8'))
    expect(freshPreview).to.equal(preview)
    expect(preview.match(/data-mask-tmx-id=/g)).to.have.length(37)
    expect(preview.match(/data-fragment-id=/g)).to.have.length(32)
    expect(preview.match(/data-probe-id=/g)).to.have.length(111)
  })

  it('hard-verifies navigation geometry against E1', async () => {
    const nav = await verifyNavigationGeometry(tmx, INVENTORY_PATH)
    expect(nav.ok).to.equal(true)
    expect(nav.collisionCount).to.equal(38)
    expect(nav.navObstacleCount).to.equal(38)
  })

  it('rejects property-name, binding-kind and canonical fragment schema mutations', () => {
    expectRejected(tmx.replace('name="chunkId" value="west-upper"', 'name="chunk-id" value="west-upper"'), 'property chunkId drift')
    expectRejected(tmx.replace('name="kind" value="legacy-mask-binding"', 'name="kind" value="occluder-fragment"'), 'property kind drift')
    expectRejected(tmx.replace('name="ledgerSortContract" value="fixed-point-y"', 'name="ledgerSortContract" value="y"'), 'property ledgerSortContract drift')
    expectRejected(tmx.replace('type="occluder-fragment"', 'type="legacy-mask-binding"'), 'canonical kind/type drift')
    const fragmentOnly = fragmentGroup(tmx)
    expect(fragmentOnly).not.to.include('name="chunk-id"')
    expect(fragmentOnly).not.to.include('name="sortMode" value="fixed-point-y"')
    expect(maskGroup(tmx)).to.include('name="chunkId"')
  })

  it('rejects atlas sourceRect and destinationRect drift', () => {
    expectRejected(tmx.replace('name="sourceRectX" type="int" value="2"', 'name="sourceRectX" type="int" value="3"'), 'property')
    expectRejected(tmx.replace('name="fragment-207" type="occluder-fragment" x="1112"', 'name="fragment-207" type="occluder-fragment" x="1113"'), 'fragment')
  })
})
