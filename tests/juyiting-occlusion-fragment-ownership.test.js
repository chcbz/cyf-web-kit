import { expect } from 'chai'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { atomicWriteUtf8Batch } from '../scripts/juyiting/lib/atomic-write.mjs'
import {
  CANONICAL_EXPECTED_SHA256,
  E8B_TMX_SHA256,
  REGION_DEFS,
  REGION_ORDER,
  SEMANTIC_OWNER_CATALOG,
  computeGenerationId,
} from '../scripts/juyiting/lib/fragment-ownership-v2.mjs'
import { E8B_LIVE_TMX_SHA256 } from '../scripts/juyiting/lib/baseline-provenance.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const FIXTURE_DIR = 'tests/fixtures/juyiting/occlusion-v2-fragments'
const SPEC_PATH = join(FIXTURE_DIR, 'fragment-ownership-spec.json')
const REPORT_PATH = join(FIXTURE_DIR, 'ownership-report.json')
const CONTACT_PATH = join(FIXTURE_DIR, 'contact-sheet.svg')
const CANONICAL_PATH = 'public/juyiting/images/liangshan-hall-mid-occluders-v3.webp'
const CHROMIUM_ENV = { ...process.env, CHROMIUM_HEADLESS: '/usr/local/bin/chromium-headless-smoke' }

const spec = JSON.parse(readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf8'))
const report = JSON.parse(readFileSync(join(REPO_ROOT, REPORT_PATH), 'utf8'))
const contactSheet = readFileSync(join(REPO_ROOT, CONTACT_PATH), 'utf8')
const canonicalBytes = readFileSync(join(REPO_ROOT, CANONICAL_PATH))

function runNode(script, args = [], timeout = 30000) {
  return spawnSync(process.execPath, [join(REPO_ROOT, script), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout,
    env: CHROMIUM_ENV,
  })
}

function updateDeclaredCounts(mutated) {
  mutated.outputConstraints.fragmentCount = mutated.fragments.length
  mutated.outputConstraints.regionFragmentCounts = Object.fromEntries(REGION_ORDER.map(region => [
    region,
    mutated.fragments.filter(fragment => fragment.homeRegion === region).length,
  ]))
}

function unionRect(left, right) {
  const x = Math.min(left.x, right.x)
  const y = Math.min(left.y, right.y)
  const maxX = Math.max(left.x + left.width, right.x + right.width)
  const maxY = Math.max(left.y + left.height, right.y + right.height)
  return { x, y, width: maxX - x, height: maxY - y }
}

function compareRuns(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

function runPixels(runs) {
  return runs.reduce((sum, [, start, end]) => sum + end - start, 0)
}

describe('E9A V2 Fragment Ownership Spec', () => {
  it('locks canonical source provenance and E8B TMX anchor', () => {
    expect(createHash('sha256').update(canonicalBytes).digest('hex')).to.equal(CANONICAL_EXPECTED_SHA256)
    expect(spec.sourceProvenance.path).to.equal(CANONICAL_PATH)
    expect(spec.sourceProvenance.sha256).to.equal(CANONICAL_EXPECTED_SHA256)
    expect(spec.sourceProvenance.width).to.equal(1664)
    expect(spec.sourceProvenance.height).to.equal(928)
    expect(spec.sourceProvenance.alphaThreshold).to.equal(1)
    expect(spec.inputProvenance.tmxAnchor.sha256).to.equal(E8B_TMX_SHA256)
    expect(spec.inputProvenance.tmxAnchor.sha256).to.equal(E8B_LIVE_TMX_SHA256)
  })

  it('uses the V2 alpha-RLE schema and deterministic generationId', () => {
    expect(spec.$schema).to.equal('jyt.occlusion.fragment-ownership-spec.v2')
    expect(spec.schemaVersion).to.equal(2)
    expect(spec.taskId).to.equal('E9A')
    expect(spec.outputConstraints.pixelOwnershipModel).to.equal('alpha-rle-v1')
    expect(spec.generationId).to.equal(computeGenerationId(spec))
    expect(spec.generation.generationId).to.equal(spec.generationId)
    expect(spec.generation.stableIdBasis).to.include('not-declaration-order')
  })

  it('defines exact six-region coverage as home/chunk guides rather than clip boundaries', () => {
    expect(Object.keys(spec.regionPartition.regions).sort()).to.deep.equal([...REGION_ORDER].sort())
    expect(spec.regionPartition.semantics).to.equal('atlas-home-region-only-not-a-pixel-clip-boundary')
    for (const region of REGION_ORDER) {
      const actual = spec.regionPartition.regions[region]
      const expected = REGION_DEFS[region]
      expect(actual.xRange).to.deep.equal([expected.xMin, expected.xMax])
      expect(actual.yRange).to.deep.equal([expected.yMin, expected.yMax])
      expect(actual.chunkId).to.equal(region)
      expect(spec.visualStructureExplanation[region]).to.be.a('string').and.not.be.empty
    }
  })

  it('serializes all reviewed semantic owners in stableId order with no generic labels', () => {
    const ids = spec.fragments.map(fragment => fragment.stableId)
    expect(ids).to.deep.equal([...ids].sort((a, b) => Buffer.from(a).compare(Buffer.from(b))))
    expect(new Set(ids).size).to.equal(ids.length)
    expect(ids).to.have.members(SEMANTIC_OWNER_CATALOG.map(entry => entry.stableId))
    expect(spec.fragments).to.have.length(32)
    expect(spec.outputConstraints.regionFragmentCounts).to.deep.equal({
      'west-upper': 7,
      center: 1,
      'east-upper': 6,
      'west-lower': 8,
      entrance: 4,
      'east-lower': 6,
    })
    for (const fragment of spec.fragments) {
      expect(fragment.semanticType).not.to.be.oneOf(['structure', 'detail', 'element'])
      expect(fragment.observableDescription).to.be.a('string').and.not.be.empty
      expect(fragment.chunkId).to.equal(fragment.homeRegion)
      expect(fragment.region).to.equal(fragment.homeRegion)
    }
  })

  it('renames the center object to a wall sconce rather than pillar', () => {
    const center = spec.fragments.find(fragment => fragment.homeRegion === 'center')
    expect(center.stableId).to.equal('jyt.occ.center.wall-sconce-01.v2')
    expect(center.semanticType).to.equal('wall-sconce')
    expect(center.observableDescription).to.include('not a pillar')
    expect(center.sourceRect).to.deep.equal({ x: 1111, y: 229, width: 20, height: 56 })
  })

  it('keeps all four y=580 continuous structures as single cross-guide owners', () => {
    const ids = [
      'jyt.occ.west-upper.wall-panel-assembly-01.v2',
      'jyt.occ.east-upper.pillar-02.v2',
      'jyt.occ.east-lower.diagonal-brace-01.v2',
      'jyt.occ.east-lower.worktable-01.v2',
    ]
    for (const stableId of ids) {
      const fragment = spec.fragments.find(candidate => candidate.stableId === stableId)
      expect(fragment, stableId).to.exist
      expect(fragment.sourceRect.y, stableId).to.be.below(580)
      expect(fragment.sourceRect.y + fragment.sourceRect.height, stableId).to.be.above(580)
      expect(fragment.semanticOwnership.canonicalComponentIds).not.to.be.empty
    }
  })

  it('uses exact identity destination mapping and authoritative sorted RLE runs', () => {
    for (const fragment of spec.fragments) {
      expect(fragment.destinationRect).to.deep.equal(fragment.sourceRect)
      expect(fragment.destinationMapping).to.deep.equal({
        mode: 'source-coordinate-identity', scaleNumerator: 1, scaleDenominator: 1, sampling: 'none',
      })
      expect(fragment.pixelOwnershipRule.model).to.equal('alpha-rle-v1')
      expect(fragment.ownershipRuns).not.to.be.empty
      expect(fragment.ownedOpaquePixelCount).to.equal(runPixels(fragment.ownershipRuns))
      for (let index = 1; index < fragment.ownershipRuns.length; index++) {
        expect(compareRuns(fragment.ownershipRuns[index - 1], fragment.ownershipRuns[index])).to.be.below(0)
      }
    }
  })

  it('permits overlapping sourceRects because only opaque RLE runs confer ownership', () => {
    let sourceRectOverlapCount = 0
    for (let i = 0; i < spec.fragments.length; i++) for (let j = i + 1; j < spec.fragments.length; j++) {
      const left = spec.fragments[i].sourceRect, right = spec.fragments[j].sourceRect
      if (left.x < right.x + right.width && left.x + left.width > right.x &&
          left.y < right.y + right.height && left.y + left.height > right.y) sourceRectOverlapCount++
    }
    expect(sourceRectOverlapCount).to.be.above(0)
    expect(spec.outputConstraints.sourceRectOverlapPolicy).to.equal('allowed-because-runs-are-authoritative')
    expect(spec.outputConstraints.paddingPolicy).to.include('clears every pixel not listed')
    expect(spec.outputConstraints.opaqueCutEdgeExceptions).to.deep.equal([])
  })

  it('allows disconnected components only for the explicitly approved same-object worktable parts', () => {
    const grouped = spec.fragments.filter(fragment => fragment.semanticOwnership.componentGroupPolicy.mode === 'approved-same-observable-object-parts')
    expect(grouped.map(fragment => fragment.stableId)).to.deep.equal(['jyt.occ.east-lower.worktable-01.v2'])
    expect(grouped[0].semanticOwnership.canonicalComponentIds).to.have.length(2)
    expect(grouped[0].semanticOwnership.componentGroupPolicy.observableObject).to.equal('east worktable')
    expect(grouped[0].semanticOwnership.componentGroupPolicy.approvedParts).to.deep.equal([
      { componentKey: '1499,574,120,100,5297', role: 'tabletop-scrolls-vessels-near-edge-and-main-legs' },
      { componentKey: '1592,674,21,27,274', role: 'separated-lower-right-leg-cap' },
    ])
    for (const fragment of spec.fragments.filter(candidate => candidate !== grouped[0])) {
      expect(fragment.semanticOwnership.componentGroupPolicy.mode).to.equal('single-component')
      expect(fragment.semanticOwnership.canonicalComponentIds).to.have.length(1)
    }
  })

  it('splits the southwest wall and two illuminated fixtures by exact component identity', () => {
    const expected = [
      ['jyt.occ.west-lower.wall-panel-assembly-01.v2', 'wall-panel-assembly', { x: 17, y: 573, width: 402, height: 339 }, 31548],
      ['jyt.occ.west-lower.wall-lantern-01.v2', 'wall-lantern', { x: 11, y: 706, width: 48, height: 35 }, 850],
      ['jyt.occ.west-lower.floor-lantern-01.v2', 'floor-lantern', { x: 357, y: 876, width: 48, height: 52 }, 1348],
    ]
    for (const [stableId, semanticType, bounds, opaquePixelCount] of expected) {
      const fragment = spec.fragments.find(candidate => candidate.stableId === stableId)
      expect(fragment, stableId).to.exist
      expect(fragment.semanticType).to.equal(semanticType)
      expect(fragment.ownedOpaquePixelCount).to.equal(opaquePixelCount)
      expect(fragment.semanticOwnership.componentGroupPolicy.mode).to.equal('single-component')
      expect(fragment.semanticOwnership.canonicalComponents).to.have.length(1)
      expect(fragment.semanticOwnership.canonicalComponents[0]).to.deep.include({ bounds, opaquePixelCount })
      expect(fragment.semanticOwnership.canonicalComponents[0].identitySha256).to.match(/^[a-f0-9]{64}$/)
      expect(fragment.semanticOwnership.canonicalComponents[0].componentId).to.equal(fragment.semanticOwnership.canonicalComponentIds[0])
    }
  })

  it('locks the five reviewer-corrected coordinate semantics without changing their runs', () => {
    const corrected = [
      [{ x: 1597, y: 747, width: 67, height: 84 }, 'jyt.occ.east-lower.fabric-rack-01.v2', 'fabric-rack'],
      [{ x: 1498, y: 573, width: 122, height: 129 }, 'jyt.occ.east-lower.worktable-01.v2', 'worktable'],
      [{ x: 1383, y: 254, width: 97, height: 31 }, 'jyt.occ.east-upper.scroll-table-front-01.v2', 'scroll-table-front'],
      [{ x: 116, y: 600, width: 124, height: 120 }, 'jyt.occ.west-lower.long-table-frame-01.v2', 'long-table-frame'],
      [{ x: 214, y: 276, width: 141, height: 76 }, 'jyt.occ.west-upper.lantern-table-frame-01.v2', 'lantern-table-frame'],
    ]
    for (const [sourceRect, stableId, semanticType] of corrected) {
      const fragment = spec.fragments.find(candidate => JSON.stringify(candidate.sourceRect) === JSON.stringify(sourceRect))
      expect(fragment, JSON.stringify(sourceRect)).to.exist
      expect(fragment.stableId).to.equal(stableId)
      expect(fragment.semanticType).to.equal(semanticType)
      expect(fragment.stableId).not.to.match(/(hanging-signboard|railing-corner|diagonal-brace-03|west-lower\.diagonal-brace-01|west-upper\.railing-01)/)
    }
  })

  it('has an exact ownership report with zero cut edges', () => {
    expect(report.generationId).to.equal(spec.generationId)
    expect(report.ownershipResult).to.deep.include({
      passed: true,
      totalOpaquePixels: 248283,
      opaqueOwned: 248283,
      opaqueUnowned: 0,
      overlapPixels: 0,
      transparentOwned: 0,
      opaqueCutEdgeCount: 0,
    })
    expect(report.semanticResult.genericSemanticLabels).to.deep.equal([])
    expect(report.regionFragmentCounts).to.deep.equal(spec.outputConstraints.regionFragmentCounts)
  })

  it('declares E9B zoom seam evidence and E10A mask mapping dependency without runtime changes', () => {
    expect(spec.downstreamRequirements.E9B.zoomSeamEvidence.requiredZooms).to.deep.equal(['0.75', '1', '1.25', '1.5', '2'])
    expect(spec.downstreamRequirements.E9B.zoomSeamEvidence.requiredFocus).to.have.length(4)
    expect(spec.downstreamRequirements.E10A.expectedLegacyMaskCount).to.equal(37)
    expect(spec.downstreamRequirements.E10A.dependency).to.include('37 legacy masks')
  })

  it('provides a self-contained contact sheet with dynamic counts and complete index coverage', () => {
    expect(contactSheet).to.include('data:image/webp;base64,')
    expect(contactSheet).not.to.include('file://')
    expect(contactSheet).to.include(`data-generation-id="${spec.generationId}"`)
    expect(contactSheet).to.include(`data-fragment-count="${spec.fragments.length}"`)
    expect(contactSheet).to.include('data-opaque-cut-edge-count="0"')
    const cropIndexes = [...contactSheet.matchAll(/data-fragment-index="(\d+)"/g)].map(match => Number(match[1]))
    const legendIndexes = [...contactSheet.matchAll(/data-legend-index="(\d+)"/g)].map(match => Number(match[1]))
    expect(cropIndexes).to.deep.equal([...spec.fragments.keys()])
    expect(legendIndexes).to.deep.equal([...spec.fragments.keys()])
    for (const fragment of spec.fragments) expect(contactSheet).to.include(fragment.stableId)
    for (const label of ['west wall crosses y=580', 'east pillar crosses y=580', 'east diagonal crosses y=580', 'east worktable crosses y=580']) {
      expect(contactSheet).to.include(label)
    }
    for (const [region, count] of Object.entries(spec.outputConstraints.regionFragmentCounts)) {
      expect(contactSheet).to.include(`${region}: ${count}`)
    }
  })

  it('validator accepts the committed spec', function () {
    this.timeout(30000)
    const result = runNode('scripts/juyiting/validate-fragment-ownership.mjs')
    expect(result.status).to.equal(0, result.stderr)
    expect(result.stderr).to.include('opaqueCutEdgeCount=0')
  })

  it('reproduces spec, report, and contact sheet byte-for-byte', function () {
    this.timeout(60000)
    const first = runNode('scripts/juyiting/generate-fragment-ownership-spec.mjs', [], 40000)
    const second = runNode('scripts/juyiting/generate-fragment-ownership-spec.mjs', [], 40000)
    expect(first.status).to.equal(0, first.stderr)
    expect(second.status).to.equal(0, second.stderr)
    expect(first.stdout).to.equal(second.stdout)
    expect(first.stdout).to.equal(readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf8'))
    const generatedReport = runNode('scripts/juyiting/generate-ownership-report.mjs', [], 40000)
    expect(generatedReport.status).to.equal(0, generatedReport.stderr)
    expect(generatedReport.stdout).to.equal(readFileSync(join(REPO_ROOT, REPORT_PATH), 'utf8'))
    const generatedContact = runNode('scripts/juyiting/render-fragment-contact-sheet.mjs')
    expect(generatedContact.status).to.equal(0, generatedContact.stderr)
    expect(generatedContact.stdout).to.equal(contactSheet)
  })

  it('uses atomicWriteUtf8Batch for every fixture update path', () => {
    for (const path of [
      'scripts/juyiting/generate-fragment-ownership-spec.mjs',
      'scripts/juyiting/generate-ownership-report.mjs',
      'scripts/juyiting/render-fragment-contact-sheet.mjs',
    ]) {
      const source = readFileSync(join(REPO_ROOT, path), 'utf8')
      expect(source).to.include('atomicWriteUtf8Batch')
      expect(source).not.to.match(/writeFileSync\([^)]*(fragment-ownership-spec|ownership-report|contact-sheet)/)
    }
  })
})

describe('E9A V2 Fragment Ownership Mutation Tests', () => {
  let tempPath

  beforeEach(() => {
    tempPath = join(REPO_ROOT, FIXTURE_DIR, `mutated-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  })

  afterEach(() => {
    try { if (existsSync(tempPath)) unlinkSync(tempPath) } catch {}
  })

  function validateMutation(mutate) {
    const mutated = structuredClone(spec)
    mutate(mutated)
    atomicWriteUtf8Batch([{ path: tempPath, content: `${JSON.stringify(mutated, null, 2)}\n`, label: 'E9A mutation fixture' }], 'E9A mutation fixture update')
    return runNode('scripts/juyiting/validate-fragment-ownership.mjs', [tempPath.slice(REPO_ROOT.length + 1)], 30000)
  }

  function expectRejected(mutate, message) {
    const result = validateMutation(mutate)
    expect(result.status, result.stderr).not.to.equal(0)
    expect(result.stderr).to.include(message)
  }

  it('rejects wrong canonical hash', () => expectRejected(mutated => { mutated.sourceProvenance.sha256 = '0'.repeat(64) }, 'Source SHA-256 mismatch'))
  it('rejects wrong source dimensions', () => expectRejected(mutated => { mutated.sourceProvenance.width = 100 }, 'Width mismatch'))
  it('rejects duplicate stableId', () => expectRejected(mutated => { mutated.fragments[1].stableId = mutated.fragments[0].stableId }, 'Duplicate stableId'))
  it('rejects invalid stableId syntax', () => expectRejected(mutated => { mutated.fragments[0].stableId = 'INVALID!' }, 'invalid stableId format'))
  it('rejects sourceRect out of bounds', () => expectRejected(mutated => { mutated.fragments[0].sourceRect.x = 2000; mutated.fragments[0].destinationRect.x = 2000 }, 'sourceRect out of bounds'))
  it('rejects non-identity destination mapping', () => expectRejected(mutated => { mutated.fragments[0].destinationRect.x++ }, 'destinationRect differs'))
  it('rejects wrong region/home chunk assignment', () => expectRejected(mutated => {
    mutated.fragments[0].region = 'east-upper'; mutated.fragments[0].homeRegion = 'east-upper'; mutated.fragments[0].chunkId = 'east-upper'; updateDeclaredCounts(mutated)
  }, 'wrong region/homeRegion/chunk'))
  it('rejects a region coverage gap', () => expectRejected(mutated => { mutated.regionPartition.regions['west-upper'].xRange[1] = 700 }, 'bounds mismatch or gap'))
  it('rejects wrong alpha threshold', () => expectRejected(mutated => { mutated.sourceProvenance.alphaThreshold = 2 }, 'alpha threshold must be 1'))
  it('rejects wrong ownership model', () => expectRejected(mutated => { mutated.outputConstraints.pixelOwnershipModel = 'rectangle-exclusive' }, 'pixelOwnershipModel must be alpha-rle-v1'))
  it('rejects non-lossless global output', () => expectRejected(mutated => { mutated.outputConstraints.losslessOnly = false }, 'losslessOnly must be true'))
  it('rejects missing PNG/lossless WebP formats', () => expectRejected(mutated => { mutated.outputConstraints.formats = ['png'] }, 'formats must include lossless-webp and png'))
  it('rejects non-lossless fragment output', () => expectRejected(mutated => { mutated.fragments[0].outputEncoding.losslessRequired = false }, 'output format must permit lossless-webp/png'))
  it('rejects a generic semantic label', () => expectRejected(mutated => { mutated.fragments[0].semanticType = 'structure' }, 'forbidden generic semantic label'))
  it('rejects any opaque cut-edge seam exception', () => expectRejected(mutated => { mutated.outputConstraints.opaqueCutEdgeExceptions = [{ x: 1, y: 1 }] }, 'permits no seam exceptions'))
  it('rejects unsorted RLE runs', () => expectRejected(mutated => {
    const runs = mutated.fragments.find(fragment => fragment.ownershipRuns.length > 2).ownershipRuns
    ;[runs[0], runs[1]] = [runs[1], runs[0]]
  }, 'ownershipRuns are unsorted'))
  it('rejects out-of-bounds RLE runs', () => expectRejected(mutated => {
    const fragment = mutated.fragments[0]
    fragment.ownershipRuns.unshift([-1, 0, 1])
    fragment.ownedOpaquePixelCount++
  }, 'RLE run out of bounds'))
  it('rejects RLE ownership of a transparent pixel', () => expectRejected(mutated => {
    const fragment = mutated.fragments[0]
    fragment.sourceRect = unionRect(fragment.sourceRect, { x: 0, y: 0, width: 1, height: 1 })
    fragment.destinationRect = { ...fragment.sourceRect }
    fragment.ownershipRuns.push([0, 0, 1])
    fragment.ownershipRuns.sort(compareRuns)
    fragment.ownedOpaquePixelCount++
  }, 'RLE owns transparent pixel'))
  it('rejects RLE overlap between owners', () => expectRejected(mutated => {
    const source = mutated.fragments[0]
    const target = mutated.fragments[1]
    const copied = [...source.ownershipRuns[0]]
    target.sourceRect = unionRect(target.sourceRect, { x: copied[1], y: copied[0], width: copied[2] - copied[1], height: 1 })
    target.destinationRect = { ...target.sourceRect }
    target.ownershipRuns.push(copied)
    target.ownershipRuns.sort(compareRuns)
    target.ownedOpaquePixelCount = runPixels(target.ownershipRuns)
  }, 'RLE overlap pixels'))
  it('rejects an RLE ownership gap', () => expectRejected(mutated => {
    const fragment = mutated.fragments.find(candidate => candidate.ownershipRuns.some(([, start, end]) => end - start >= 3))
    const index = fragment.ownershipRuns.findIndex(([, start, end]) => end - start >= 3)
    fragment.ownershipRuns[index] = [fragment.ownershipRuns[index][0], fragment.ownershipRuns[index][1] + 1, fragment.ownershipRuns[index][2]]
    fragment.ownedOpaquePixelCount--
  }, 'opaque pixels have no RLE owner'))
  it('rejects an opaque-neighbor owner split with nonzero cut edges', () => expectRejected(mutated => {
    const source = mutated.fragments.find(candidate => candidate.ownershipRuns.some(([, start, end]) => end - start >= 3))
    const target = mutated.fragments.find(candidate => candidate !== source)
    const runIndex = source.ownershipRuns.findIndex(([, start, end]) => end - start >= 3)
    const [y, start, end] = source.ownershipRuns[runIndex]
    source.ownershipRuns[runIndex] = [y, start + 1, end]
    source.ownedOpaquePixelCount--
    target.ownershipRuns.push([y, start, start + 1])
    target.ownershipRuns.sort(compareRuns)
    target.sourceRect = unionRect(target.sourceRect, { x: start, y, width: 1, height: 1 })
    target.destinationRect = { ...target.sourceRect }
    target.ownedOpaquePixelCount++
  }, 'opaque cut edge count must be zero'))
  it('rejects a broad owner that absorbs an unreviewed disconnected semantic group', () => expectRejected(mutated => {
    const target = mutated.fragments.find(fragment => fragment.stableId === 'jyt.occ.center.wall-sconce-01.v2')
    const donorIndex = mutated.fragments.findIndex(fragment => fragment.stableId === 'jyt.occ.east-lower.lantern-01.v2')
    const donor = mutated.fragments[donorIndex]
    target.sourceRect = unionRect(target.sourceRect, donor.sourceRect)
    target.destinationRect = { ...target.sourceRect }
    target.ownershipRuns.push(...donor.ownershipRuns.map(run => [...run]))
    target.ownershipRuns.sort(compareRuns)
    target.ownedOpaquePixelCount = runPixels(target.ownershipRuns)
    target.semanticOwnership.componentGroupPolicy = {
      mode: 'approved-same-observable-object-parts',
      observableObject: 'mutated arbitrary grouping',
      approvalBasis: 'none',
      approvedParts: [],
    }
    target.semanticOwnership.canonicalComponentIds.push(...donor.semanticOwnership.canonicalComponentIds)
    target.semanticOwnership.canonicalComponentIds.sort()
    target.semanticOwnership.canonicalComponents.push(...donor.semanticOwnership.canonicalComponents)
    target.semanticOwnership.canonicalComponents.sort((left, right) => left.geometryKey.localeCompare(right.geometryKey))
    mutated.fragments.splice(donorIndex, 1)
    updateDeclaredCounts(mutated)
  }, 'broad/disconnected semantic group differs from reviewed catalog'))
  it('rejects a multi-component owner without the exact approved componentGroupPolicy', () => expectRejected(mutated => {
    const worktable = mutated.fragments.find(fragment => fragment.stableId === 'jyt.occ.east-lower.worktable-01.v2')
    worktable.semanticOwnership.componentGroupPolicy = {
      mode: 'single-component', observableObject: 'worktable', approvedParts: [],
    }
  }, 'componentGroupPolicy differs from reviewed catalog'))
  it('rejects component identity hash or bounds drift', () => expectRejected(mutated => {
    mutated.fragments[0].semanticOwnership.canonicalComponents[0].identitySha256 = '0'.repeat(64)
  }, 'component identity/bounds/hash differs from decoded source'))
  it('rejects changed generationId', () => expectRejected(mutated => { mutated.generationId = 'f'.repeat(64); mutated.generation.generationId = mutated.generationId }, 'generationId mismatch'))
  it('fails closed when canonical source is missing', () => expectRejected(mutated => { mutated.sourceProvenance.path = 'public/juyiting/images/missing.webp' }, 'Canonical source not found'))
})

describe('E9A V2 Provenance Chain', () => {
  it('leaves E1 baseline fixtures intact', () => {
    const inventory = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v0/inventory.json'), 'utf8'))
    const hashes = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v0/source-hashes.json'), 'utf8'))
    expect(inventory.counts.masks).to.equal(37)
    expect(inventory.counts.props).to.equal(5)
    expect(hashes.canonicalSource.expectedSha256).to.equal(CANONICAL_EXPECTED_SHA256)
  })

  it('leaves E8A/E8B accepted artifacts intact', () => {
    const propSpec = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json'), 'utf8'))
    const tmxManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props/prop-tmx-manifest.json'), 'utf8'))
    expect(propSpec.taskId).to.equal('E8A')
    expect(tmxManifest.taskId).to.equal('E8B')
    expect(spec.inputProvenance.immutableAcceptedArtifacts).to.deep.equal(['E1', 'E8A', 'E8B'])
  })
})
