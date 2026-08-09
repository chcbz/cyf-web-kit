/**
 * E8B directed tests: five-prop TMX/manifest/snapshot migration.
 *
 * The frozen E8A prop-sort-spec.json is the single source of truth for the
 * stableId/scene/chunk/floor/elevation/renderBand/sortMode/sortAnchor/tieBias
 * and render (gid -> hall-props tile -> image) binding. E8B mechanically
 * applies that binding to the production TMX (objects 90-94), records it in a
 * machine manifest and a canonical IR snapshot, and proves:
 *
 *   - 5 x N/S/W/E relations from E8A hold for the TMX-derived props;
 *   - bounty-board tieBias -4 gives table < agent at south and boundary;
 *   - declaration/insertion order independence of the world order;
 *   - exact TMX <-> spec and manifest/snapshot consistency;
 *   - fail-closed drift (any single drift is rejected).
 *
 * Fixture regeneration (existing parser conventions, no ad-hoc regex):
 *   node --import tsx tests/juyiting-occlusion-prop-tmx-migration.test.js --update-fixtures
 *
 * v1/v2 separation: the production TMX itself never sets renderSchemaVersion;
 * the snapshot derives a v2 input only for canonical IR serialization.
 */
import { expect } from 'chai'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { atomicWriteUtf8Batch } from '../scripts/juyiting/lib/atomic-write.mjs'
import { Buffer } from 'node:buffer'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { parseTmxStructure } from '../scripts/juyiting/lib/tmx-structure.mjs'
import { parseHallTmx, resolveHallProps } from '../scripts/juyiting/lib/prop-sort-evidence.mjs'
import { canonicalizeJuyitingTmxSource } from '../scripts/juyiting/lib/juyiting-public-path.mjs'
import {
  E1_BASELINE_COMMIT,
  E1_BASELINE_TMX_SHA256,
  E8B_LIVE_TMX_SHA256,
} from '../scripts/juyiting/lib/baseline-provenance.mjs'
import { parseCanonicalIrFromXml, serializeCanonicalIr } from '../src/game/occlusion/canonicalIr.ts'
import { DEFAULT_FLOOR_REGISTRY } from '../src/game/occlusion/schema.ts'
import { computeWorldSortKey, compareWorldSortKeys } from '../src/game/occlusion/worldOrder.ts'

const REPO_ROOT = process.cwd()
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props')
const SPEC_PATH = join(FIXTURE_DIR, 'prop-sort-spec.json')
const MANIFEST_PATH = join(FIXTURE_DIR, 'prop-tmx-manifest.json')
const SNAPSHOT_PATH = join(FIXTURE_DIR, 'prop-canonical-ir.snapshot.json')
const TMX_PATH = join(REPO_ROOT, 'public/juyiting/hall.tmx')
const VERIFIER = join(REPO_ROOT, 'scripts/juyiting/verify-prop-sort-spec.mjs')

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))
const EXPECTED_ORDER = spec.globalConstraints.fivePropSortOrder.order
const AGENT_STABLE_IDS = ['jyt.agent.evidence.aaa.v1', 'jyt.agent.evidence.zzz.v1']
const FIVE_PROP_TMX_IDS = [90, 91, 92, 93, 94]

// ── deterministic helpers ──

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const formatJson = value => `${JSON.stringify(value, null, 2)}\n`
const escapeXml = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function specPropById(tmxId) {
  return spec.props.find(prop => prop.tmxId === tmxId)
}

function readTmxStructure() {
  return parseTmxStructure(readFileSync(TMX_PATH, 'utf8'))
}

/**
 * Extract the five production TMX prop objects (gid-bearing hotspots) with
 * typed custom properties, sorted by TMX id. Existing parser convention:
 * scripts/juyiting/lib/tmx-structure.mjs parseTmxStructure.
 */
function tmxPropObjects() {
  const structure = readTmxStructure()
  const hallProps = structure.tilesets.find(tileset => tileset.name === 'hall-props')
  if (!hallProps) throw new Error('hall-props tileset missing')
  return structure.groups.hotspots
    .filter(object => object.gid !== undefined)
    .slice()
    .sort((a, b) => a.id - b.id)
    .map(object => {
      const tileIndex = object.gid - hallProps.firstGid
      const tile = hallProps.tiles.find(candidate => candidate.id === tileIndex)
      if (!tile) throw new Error(`gid ${object.gid} does not resolve into hall-props`)
      return {
        tmxId: object.id,
        tmxName: object.name,
        type: object.type,
        gid: object.gid,
        tileId: tileIndex,
        imageSource: tile.image,
        rect: { x: object.x, y: object.y, width: object.width, height: object.height },
        properties: object.properties
      }
    })
}

/** Canonical E8B manifest built from the production TMX + frozen E8A spec. */
function buildManifest() {
  const tmxBytes = readFileSync(TMX_PATH, 'utf8')
  const hall = resolveHallProps(parseHallTmx(tmxBytes))
  const props = tmxPropObjects().map(entry => {
    const prop = specPropById(entry.tmxId)
    if (!prop) throw new Error(`spec missing tmxId ${entry.tmxId}`)
    const p = entry.properties
    const sortAnchor = { x: p.sortAnchorX, y: p.sortAnchorY }
    return {
      tmxId: entry.tmxId,
      tmxName: entry.tmxName,
      semanticName: prop.semanticName,
      stableId: p.stableId,
      sceneId: p.sceneId,
      chunkId: p.chunkId,
      floorId: p.floorId,
      elevation: p.elevation,
      renderBand: p.renderBand,
      sortMode: p.sortMode,
      sortAnchor,
      fixedPointY: Math.round(sortAnchor.y * 256),
      tieBias: p.tieBias,
      assetRef: p.assetRef,
      gid: entry.gid,
      tilesetName: hall.tileset.name,
      firstgid: hall.tileset.firstgid,
      tileId: entry.tileId,
      objectalignment: hall.tileset.objectalignment,
      rect: entry.rect
    }
  })
  return {
    $schema: 'jyt.occlusion.prop-tmx-manifest.v2',
    schemaVersion: 2,
    taskId: 'E8B',
    sceneId: spec.sceneId,
    propCount: props.length,
    generatedBy: 'tests/juyiting-occlusion-prop-tmx-migration.test.js',
    specBinding: {
      taskId: 'E8A',
      sourceCommit: spec.baseCommit,
      acceptedCommit: 'da3d9600bd322e3a85d93ebfeaf07cd04a76f33d',
      generationId: spec.generationId,
      sourceTmxSha256: spec.tmxSource.sha256
    },
    tmxProvenance: {
      baselineAnchor: {
        ownerTask: 'E1',
        commit: E1_BASELINE_COMMIT,
        path: 'public/juyiting/hall.tmx',
        sha256: E1_BASELINE_TMX_SHA256,
        description: 'E1 immutable history TMX; verified from replacement-disabled Git blob'
      },
      currentAnchor: {
        ownerTask: 'E8B',
        path: 'public/juyiting/hall.tmx',
        sha256: sha256(Buffer.from(tmxBytes, 'utf8')),
        description: 'E8B live production TMX; five-prop migration from E8A spec binding'
      }
    },
    props
  }
}

/**
 * Derive a v2 render-schema TMX input containing only the five prop objects
 * (production TMX stays v1; renderSchemaVersion is scoped to this derivation).
 */
function deriveV2PropTmx() {
  const objects = tmxPropObjects().map(entry => {
    const attrs = [
      ['id', entry.tmxId], ['name', entry.tmxName], ['type', entry.type],
      ['gid', entry.gid],
      ['x', entry.rect.x], ['y', entry.rect.y],
      ['width', entry.rect.width], ['height', entry.rect.height]
    ].map(([key, value]) => `${key}="${escapeXml(value)}"`).join(' ')
    const props = Object.entries(entry.properties).map(([name, value]) => {
      const type = ['elevation', 'tieBias'].includes(name) ? 'int'
        : ['sortAnchorX', 'sortAnchorY'].includes(name) ? 'float'
          : 'string'
      const typeAttr = type === 'string' ? '' : ` type="${type}"`
      return `    <property name="${escapeXml(name)}"${typeAttr} value="${escapeXml(value)}"/>`
    }).join('\n')
    return `  <object ${attrs}>\n   <properties>\n${props}\n   </properties>\n  </object>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" renderorder="right-down" width="104" height="58" tilewidth="16" tileheight="16" infinite="0">
 <properties>
  <property name="sceneId" value="juyiting-main"/>
  <property name="renderSchemaVersion" value="2"/>
 </properties>
 <objectgroup id="14" name="hotspots">
${objects}
 </objectgroup>
</map>`
}

/** Canonical IR snapshot of the five props via the v2 render-schema parser. */
function buildSnapshotJson() {
  const ir = parseCanonicalIrFromXml(deriveV2PropTmx())
  return formatJson(JSON.parse(serializeCanonicalIr(ir)))
}

function worldKeyForProp(entry, registry = DEFAULT_FLOOR_REGISTRY) {
  const p = entry.properties
  return {
    renderBandOrder: 100,
    floorOrder: registry[p.floorId],
    elevation: p.elevation,
    fixedPointY: Math.round(p.sortAnchorY * 256),
    tieBias: p.tieBias,
    stableId: p.stableId
  }
}

function agentKeyAt(footPoint, stableId, registry = DEFAULT_FLOOR_REGISTRY) {
  return {
    renderBandOrder: 100,
    floorOrder: registry['floor-1'],
    elevation: 0,
    fixedPointY: Math.round(footPoint.y * 256),
    tieBias: 0,
    stableId
  }
}

function shuffle(array, seed) {
  const result = [...array]
  let state = seed
  for (let index = result.length - 1; index > 0; index--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    const swap = state % (index + 1)
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

function sortPropEntries(entries) {
  return [...entries].sort((a, b) => compareWorldSortKeys(worldKeyForProp(a), worldKeyForProp(b)))
}

/** Fail-closed drift: verify one TMX prop binding against the frozen spec. */
function assertTmxBindingMatchesSpec(entry) {
  const prop = specPropById(entry.tmxId)
  if (!prop) throw new Error(`drift: spec missing tmxId ${entry.tmxId}`)
  const p = entry.properties
  const checks = [
    ['stableId', p.stableId, prop.stableId],
    ['sceneId', p.sceneId, prop.sceneId],
    ['chunkId', p.chunkId, prop.chunkId],
    ['floorId', p.floorId, prop.floorId],
    ['elevation', p.elevation, prop.elevation],
    ['renderBand', p.renderBand, prop.renderBand],
    ['sortMode', p.sortMode, prop.sortMode],
    ['sortAnchor.x', p.sortAnchorX, prop.sortAnchor.x],
    ['sortAnchor.y', p.sortAnchorY, prop.sortAnchor.y],
    ['tieBias', p.tieBias, prop.tieBias],
    ['assetRef', p.assetRef, prop.tmxBinding.imageSource],
    ['gid', entry.gid, prop.tmxBinding.gid],
    ['tileId', entry.tileId, prop.tmxBinding.tileId],
    ['rect.x', entry.rect.x, prop.tmxRect.x],
    ['rect.y', entry.rect.y, prop.tmxRect.y],
    ['rect.width', entry.rect.width, prop.tmxRect.width],
    ['rect.height', entry.rect.height, prop.tmxRect.height]
  ]
  for (const [field, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(`drift: prop ${entry.tmxId} ${field} ${JSON.stringify(actual)} != spec ${JSON.stringify(expected)}`)
    }
  }
  if (p.kind !== 'prop') {
    throw new Error(`drift: prop ${entry.tmxId} kind ${JSON.stringify(p.kind)} != spec "prop"`)
  }
  if (canonicalizeJuyitingTmxSource(p.assetRef) !== prop.asset.path) {
    throw new Error(`drift: prop ${entry.tmxId} assetRef does not canonicalize to ${prop.asset.path}`)
  }
}

function runVerifier(tmxOverride) {
  const args = [VERIFIER, '--spec', SPEC_PATH, '--svg', join(FIXTURE_DIR, 'contact-sheet.svg')]
  if (tmxOverride) args.push('--tmx', tmxOverride)
  const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000 })
  return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` }
}

// ── optional fixture regeneration (existing parser conventions) ──

if (process.argv.includes('--update-fixtures')) {
  atomicWriteUtf8Batch([
    { path: MANIFEST_PATH, content: formatJson(buildManifest()), label: 'prop-tmx-manifest.json' },
    { path: SNAPSHOT_PATH, content: buildSnapshotJson(), label: 'prop-canonical-ir.snapshot.json' }
  ], 'E8B fixture update transaction')
  console.log(`updated ${MANIFEST_PATH}`)
  console.log(`updated ${SNAPSHOT_PATH}`)
  process.exit(0)
}

// ── committed fixtures ──

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
const tmxBytes = readFileSync(TMX_PATH, 'utf8')
const tmxSha256 = sha256(Buffer.from(tmxBytes, 'utf8'))

describe('E8B five-prop TMX/manifest/snapshot migration', function () {
  this.timeout(120000)

  describe('frozen contract and committed fixtures', () => {
    it('manifest is schema-valid, E8B-bound, and matches the production TMX hash', () => {
      expect(manifest.$schema).to.equal('jyt.occlusion.prop-tmx-manifest.v2')
      expect(manifest.schemaVersion).to.equal(2)
      expect(manifest.taskId).to.equal('E8B')
      expect(manifest.sceneId).to.equal('juyiting-main')
      expect(manifest.propCount).to.equal(5)
      expect(manifest.props).to.have.length(5)
      expect(manifest.props.map(prop => prop.tmxId)).to.deep.equal(FIVE_PROP_TMX_IDS)
      // specBinding provenance
      expect(manifest.specBinding.taskId).to.equal('E8A')
      expect(manifest.specBinding.sourceCommit).to.equal(spec.baseCommit)
      expect(manifest.specBinding.acceptedCommit).to.equal('da3d9600bd322e3a85d93ebfeaf07cd04a76f33d')
      expect(manifest.specBinding.generationId).to.equal(spec.generationId)
      expect(manifest.specBinding.sourceTmxSha256).to.equal(E1_BASELINE_TMX_SHA256)
      expect(manifest.specBinding.sourceTmxSha256).to.equal(spec.tmxSource.sha256)
      // E1 immutable history and E8A accepted evidence are distinct anchors.
      expect(manifest.tmxProvenance.baselineAnchor).to.deep.include({
        ownerTask: 'E1',
        commit: E1_BASELINE_COMMIT,
        path: 'public/juyiting/hall.tmx',
        sha256: E1_BASELINE_TMX_SHA256
      })
      expect(manifest.tmxProvenance.baselineAnchor.commit).to.not.equal(manifest.specBinding.sourceCommit)
      expect(manifest.tmxProvenance.currentAnchor).to.deep.include({
        ownerTask: 'E8B',
        path: 'public/juyiting/hall.tmx',
        sha256: E8B_LIVE_TMX_SHA256
      })
      expect(manifest.tmxProvenance.currentAnchor.sha256).to.equal(tmxSha256)
      expect(manifest.tmxProvenance.currentAnchor.sha256).to.not.equal(manifest.tmxProvenance.baselineAnchor.sha256)
      // No E8B self-reference
      expect(manifest).to.not.have.property('baseCommit')
      expect(manifest).to.not.have.property('tmxSha256')
      expect(manifest).to.not.have.property('specGenerationId')
      // Does not contain current HEAD
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim()
      expect(JSON.stringify(manifest)).to.not.include(head)
    })

    it('canonical snapshot is a five-object v2 IR with the frozen binding', () => {
      expect(snapshot.sceneId).to.equal('juyiting-main')
      expect(snapshot.renderSchemaVersion).to.equal('2')
      expect(snapshot.floorRegistry).to.deep.equal({ 'floor-1': 0 })
      expect(snapshot.width).to.equal(1664)
      expect(snapshot.height).to.equal(928)
      expect(snapshot.coordinateWidth).to.equal(1664)
      expect(snapshot.coordinateHeight).to.equal(928)
      expect(snapshot.objects).to.have.length(5)
      expect(snapshot.fragments).to.deep.equal([])
      expect(snapshot.zones).to.deep.equal([])
      const byId = new Map(snapshot.objects.map(obj => [obj.stableId, obj]))
      for (const prop of manifest.props) {
        const obj = byId.get(prop.stableId)
        expect(obj, prop.stableId).to.not.equal(undefined)
        expect(obj.sceneId).to.equal('juyiting-main')
        expect(obj.chunkId).to.equal(prop.chunkId)
        expect(obj.kind).to.equal('prop')
        expect(obj.renderBand).to.equal('world')
        expect(obj.floorId).to.equal('floor-1')
        expect(obj.elevation).to.equal(0)
        expect(obj.sortMode).to.equal('fixed')
        expect(obj.sortAnchor).to.deep.equal(prop.sortAnchor)
        expect(obj.tieBias).to.equal(prop.tieBias)
        expect(obj.render).to.deep.equal({
          type: 'asset',
          assetRef: prop.assetRef,
          destinationRect: prop.rect
        })
      }
    })

    it('does not activate v2 in the production TMX (v1/v2 never mixed)', () => {
      const structure = readTmxStructure()
      expect(structure.map.properties.renderSchemaVersion).to.equal(undefined)
      expect(structure.map.properties.sceneId).to.equal('juyiting-main')
    })
  })

  describe('exact TMX <-> E8A spec consistency', () => {
    it('every production prop object carries the frozen binding item-by-item', () => {
      const entries = tmxPropObjects()
      expect(entries).to.have.length(5)
      for (const entry of entries) assertTmxBindingMatchesSpec(entry)
    })

    it('production TMX rect/gid/tileset/image binding matches the spec exactly', () => {
      const hall = resolveHallProps(parseHallTmx(tmxBytes))
      expect(hall.tileset).to.deep.include({
        name: 'hall-props', firstgid: 6033, tilecount: 5, columns: 5,
        objectalignment: 'topleft'
      })
      for (const prop of spec.props) {
        const bound = hall.objects.get(prop.tmxId)
        expect(bound, `tmx:${prop.tmxId}`).to.not.equal(undefined)
        expect(bound.name).to.equal(prop.tmxName)
        expect(bound.type).to.equal('prop')
        expect(bound.gid).to.equal(prop.tmxBinding.gid)
        expect(bound.tile.gid).to.equal(prop.tmxBinding.gid)
        expect(bound.tile.tileId).to.equal(prop.tmxBinding.tileId)
        expect(bound.tile.imageSource).to.equal(prop.tmxBinding.imageSource)
      }
    })
  })

  describe('5 x N/S/W/E relations from E8A', () => {
    it('north asserts agent<prop and south asserts prop<agent for every prop', () => {
      const entries = tmxPropObjects()
      for (const entry of entries) {
        const prop = specPropById(entry.tmxId)
        for (const direction of ['north', 'south']) {
          const probe = prop.probes[direction]
          expect(probe.expectedRelation, `${entry.tmxId}/${direction}`).to.equal(
            direction === 'north' ? 'agent<prop' : 'prop<agent'
          )
          for (const agentStableId of AGENT_STABLE_IDS) {
            const relation = compareWorldSortKeys(
              agentKeyAt(probe.agentFootPoint, agentStableId),
              worldKeyForProp(entry)
            )
            expect(relation, `${entry.tmxId}/${direction}/${agentStableId}`).to.equal(
              direction === 'north' ? -1 : 1
            )
          }
        }
      }
    })

    it('west/east assert zero alpha-AABB overlap with at least a 4px horizontal guard', () => {
      const entries = tmxPropObjects()
      for (const entry of entries) {
        const prop = specPropById(entry.tmxId)
        for (const direction of ['west', 'east']) {
          const probe = prop.probes[direction]
          expect(probe.expectedRelation, `${entry.tmxId}/${direction}`).to.equal('non-overlap')
          expect(probe.alphaAabbIntersection, `${entry.tmxId}/${direction}`).to.equal(false)
          expect(probe.horizontalGuardPixels, `${entry.tmxId}/${direction}`).to.be.at.least(4)
          // The TMX anchor line equals the W/E foot Y, so guard is geometric, not sort-based.
          expect(probe.agentFootPoint.y, `${entry.tmxId}/${direction}`).to.equal(entry.properties.sortAnchorY)
        }
      }
    })
  })

  describe('bounty-board table < agent at south and boundary', () => {
    it('TMX carries tieBias -4 and the frozen anchor (1446,379)', () => {
      const entry = tmxPropObjects().find(item => item.tmxId === 92)
      expect(entry.properties.tieBias).to.equal(-4)
      expect(entry.properties.sortAnchorX).to.equal(1446)
      expect(entry.properties.sortAnchorY).to.equal(379)
      expect(Math.round(entry.properties.sortAnchorY * 256)).to.equal(97024)
    })

    it('table(-4) < agent(0) at south and boundary independently of agent stableId', () => {
      const entry = tmxPropObjects().find(item => item.tmxId === 92)
      const bounty = specPropById(92)
      const footPoints = [
        { label: 'south-probe', point: bounty.probes.south.agentFootPoint },
        { label: 'boundary', point: bounty.bountyBoardMatrix.behindBoundaryFront.boundary.agentFoot }
      ]
      for (const { label, point } of footPoints) {
        for (const agentStableId of AGENT_STABLE_IDS) {
          const agent = agentKeyAt(point, agentStableId)
          expect(compareWorldSortKeys(worldKeyForProp(entry), agent), `${label}/${agentStableId}`).to.equal(-1)
          expect(compareWorldSortKeys(agent, worldKeyForProp(entry)), `${label}/${agentStableId}`).to.equal(1)
        }
      }
    })
  })

  describe('declaration and insertion order independence', () => {
    it('sorting the five props always yields the frozen E8A order', () => {
      const entries = tmxPropObjects()
      expect(sortPropEntries(entries).map(entry => entry.properties.stableId)).to.deep.equal(EXPECTED_ORDER)
      for (let seed = 0; seed < 20; seed++) {
        expect(sortPropEntries(shuffle(entries, seed)).map(entry => entry.properties.stableId))
          .to.deep.equal(EXPECTED_ORDER)
      }
    })

    it('matches the frozen E8A comparator order for the same inputs', () => {
      for (let seed = 0; seed < 20; seed++) {
        const tmwIds = sortPropEntries(shuffle(tmxPropObjects(), seed)).map(entry => entry.properties.stableId)
        const specIds = [...spec.props]
          .sort((a, b) => compareWorldSortKeys(
            { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: a.fixedPointY, tieBias: a.tieBias, stableId: a.stableId },
            { renderBandOrder: 100, floorOrder: 0, elevation: 0, fixedPointY: b.fixedPointY, tieBias: b.tieBias, stableId: b.stableId }
          )).map(prop => prop.stableId)
        expect(tmwIds).to.deep.equal(specIds)
        expect(specIds).to.deep.equal(EXPECTED_ORDER)
      }
    })
  })

  describe('manifest/snapshot consistency and reproducibility', () => {
    it('fresh generation is byte-identical to the committed manifest and snapshot', () => {
      expect(formatJson(buildManifest())).to.equal(readFileSync(MANIFEST_PATH, 'utf8'))
      expect(buildSnapshotJson()).to.equal(readFileSync(SNAPSHOT_PATH, 'utf8'))
    })

    it('canonical serializer round-trips byte-identically for the derived input', () => {
      const ir = parseCanonicalIrFromXml(deriveV2PropTmx())
      expect(serializeCanonicalIr(ir)).to.equal(serializeCanonicalIr(parseCanonicalIrFromXml(deriveV2PropTmx())))
      expect(JSON.parse(serializeCanonicalIr(ir))).to.deep.equal(snapshot)
    })

    it('world-order keys derived from the canonical IR equal the manifest fixedPointY', () => {
      const ir = parseCanonicalIrFromXml(deriveV2PropTmx())
      const byId = new Map(ir.objects.map(obj => [obj.stableId, computeWorldSortKey(obj, DEFAULT_FLOOR_REGISTRY)]))
      for (const prop of manifest.props) {
        const key = byId.get(prop.stableId)
        expect(key, prop.stableId).to.not.equal(undefined)
        expect(key.renderBandOrder).to.equal(100)
        expect(key.floorOrder).to.equal(0)
        expect(key.elevation).to.equal(0)
        expect(key.fixedPointY).to.equal(prop.fixedPointY)
        expect(key.tieBias).to.equal(prop.tieBias)
        expect(key.stableId).to.equal(prop.stableId)
      }
    })
  })

  describe('fail-closed drift', () => {
    const tempDir = () => mkdtempSync(join(tmpdir(), 'e8b-drift-'))

    function withMutatedTmx(mutate) {
      const dir = tempDir()
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
        const entries = structure.groups.hotspots
          .filter(object => object.gid !== undefined)
          .map(object => ({
            tmxId: object.id,
            tmxName: object.name,
            type: object.type,
            gid: object.gid,
            tileId: object.gid - structure.tilesets.find(t => t.name === 'hall-props').firstGid,
            imageSource: object.properties.assetRef,
            rect: { x: object.x, y: object.y, width: object.width, height: object.height },
            properties: object.properties
          }))
        let rejected = false
        let message = ''
        try {
          for (const entry of entries) assertTmxBindingMatchesSpec(entry)
        } catch (error) {
          rejected = true
          message = error.message
        }
        expect(rejected, message).to.equal(true)
        expect(message, marker).to.include(marker)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    const tmxDriftCases = [
      ['sortAnchorY', xml => xml.replace('name="sortAnchorY" type="float" value="268"', 'name="sortAnchorY" type="float" value="269"'), 'drift: prop 90 sortAnchor.y'],
      ['tieBias', xml => xml.replace('name="tieBias" type="int" value="-4"', 'name="tieBias" type="int" value="-3"'), 'drift: prop 92 tieBias'],
      ['stableId', xml => xml.replace('value="jyt.prop.center-north.main-seat.v1"', 'value="jyt.prop.center-north.main-seat.drift"'), 'drift: prop 90 stableId'],
      ['chunkId', xml => xml.replace('name="chunkId" value="east-upper"', 'name="chunkId" value="center"'), 'drift: prop 92 chunkId'],
      ['kind', xml => xml.replace('name="kind" value="prop"', 'name="kind" value="occluder-fragment"'), 'drift: prop 90 kind'],
      ['assetRef', xml => xml.replace('value="images/props/liangshan-hall-prop-main-seat-cropped.png"', 'value="images/props/liangshan-hall-prop-agent-roster-cropped.png"'), 'drift: prop 90 assetRef'],
      ['gid', xml => xml.replace('gid="6033" x="818"', 'gid="6034" x="818"'), 'drift: prop 90 gid']
    ]
    for (const [name, mutate, marker] of tmxDriftCases) {
      it(`rejects injected TMX ${name} drift`, () => expectTmxDriftRejected(mutate, marker))
    }

    it('rejects a manifest that drifts from the production TMX binding', () => {
      const dir = tempDir()
      try {
        const path = join(dir, 'manifest.json')
        const drifted = JSON.parse(JSON.stringify(buildManifest()))
        drifted.props.find(prop => prop.tmxId === 92).tieBias = -3
        drifted.tmxProvenance.currentAnchor.sha256 = sha256(Buffer.from('stale'))
        writeFileSync(path, formatJson(drifted))
        const fresh = buildManifest()
        expect(formatJson(drifted)).to.not.equal(formatJson(fresh))
        expect(drifted.props).to.not.deep.equal(fresh.props)
        expect(drifted.tmxProvenance.currentAnchor.sha256).to.not.equal(fresh.tmxProvenance.currentAnchor.sha256)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('rejects a canonical snapshot that drifts from the derived IR', () => {
      const dir = tempDir()
      try {
        const path = join(dir, 'snapshot.json')
        const drifted = JSON.parse(buildSnapshotJson())
        drifted.objects.find(obj => obj.stableId === 'jyt.prop.northeast.bounty-board.v1').tieBias = 0
        writeFileSync(path, formatJson(drifted))
        const fresh = JSON.parse(buildSnapshotJson())
        expect(JSON.parse(formatJson(drifted))).to.not.deep.equal(fresh)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('frozen E8A verifier fails closed against the migrated production TMX (hash drift)', () => {
      const result = runVerifier(TMX_PATH)
      expect(result.status, result.output).to.not.equal(0)
      expect(result.output).to.include('TMX sha256 mismatch')
    })
  })
})
