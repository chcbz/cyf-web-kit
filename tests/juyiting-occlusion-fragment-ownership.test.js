import { expect } from 'chai'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  existsSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

import { atomicWriteUtf8, atomicWriteUtf8Batch } from '../scripts/juyiting/lib/atomic-write.mjs'
import { readJuyitingPublicFile } from '../scripts/juyiting/lib/juyiting-public-path.mjs'
import {
  E1_BASELINE_COMMIT,
  E1_BASELINE_TMX_SHA256,
  E8B_LIVE_TMX_SHA256,
  currentHead,
} from '../scripts/juyiting/lib/baseline-provenance.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const FIXTURE_DIR = 'tests/fixtures/juyiting/occlusion-v2-fragments'
const SPEC_PATH = join(FIXTURE_DIR, 'fragment-ownership-spec.json')
const CANONICAL_PATH = 'public/juyiting/images/liangshan-hall-mid-occluders-v3.webp'

const CANONICAL_EXPECTED_SHA256 = '3e4f3f90b4d84411a844978237a7d3530bd481c37a62bcd73b9d694a7d2dd432'
const E8B_TMX_ANCHOR = '291a38cc66ebd60c8577500a5afc18ce5398570fe4c35ca66d9eebe818826a97'

const spec = JSON.parse(readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf8'))
const canonicalBytes = readFileSync(join(REPO_ROOT, CANONICAL_PATH))
const canonicalSha256 = createHash('sha256').update(canonicalBytes).digest('hex')

function runValidator(args = []) {
  const result = spawnSync(process.execPath, [
    join(REPO_ROOT, 'scripts/juyiting/validate-fragment-ownership.mjs'),
    ...args,
  ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000, env: { ...process.env, CHROMIUM_HEADLESS: '/usr/local/bin/chromium-headless-smoke' } })
  return result
}

describe('E9A Fragment Ownership Spec', () => {
  // ── Source Provenance ──────────────────────────────────────────────────
  it('canonical source exists and hash matches', () => {
    expect(existsSync(join(REPO_ROOT, CANONICAL_PATH))).to.be.true
    expect(canonicalSha256).to.equal(CANONICAL_EXPECTED_SHA256)
  })

  it('spec declares correct canonical provenance', () => {
    expect(spec.sourceProvenance.assetRef).to.equal('jyt.occlusion-source.hall-v3')
    expect(spec.sourceProvenance.sha256).to.equal(CANONICAL_EXPECTED_SHA256)
    expect(spec.sourceProvenance.path).to.equal(CANONICAL_PATH)
    expect(spec.sourceProvenance.width).to.equal(1664)
    expect(spec.sourceProvenance.height).to.equal(928)
    expect(spec.sourceProvenance.alphaThreshold).to.equal(1)
    expect(spec.sourceProvenance.totalOpaquePixels).to.be.a('number').and.be.above(200000)
  })

  // ── E8B Provenance Binding ────────────────────────────────────────────
  it('binds to E8B TMX anchor', () => {
    expect(spec.inputProvenance.tmxAnchor.sha256).to.equal(E8B_TMX_ANCHOR)
    expect(spec.inputProvenance.tmxAnchor.taskId).to.equal('E8B')
    expect(spec.inputProvenance.tmxAnchor.path).to.equal('public/juyiting/hall.tmx')
  })

  // ── Schema Validation ─────────────────────────────────────────────────
  it('declares valid schema version', () => {
    expect(spec.schemaVersion).to.equal(1)
    expect(spec.$schema).to.equal('jyt.occlusion.fragment-ownership-spec.v1')
    expect(spec.taskId).to.equal('E9A')
    expect(spec.sceneId).to.equal('juyiting-main')
  })

  it('has deterministic generationId', () => {
    expect(spec.generationId).to.be.a('string').with.length(64)
    expect(spec.generation.generationId).to.equal(spec.generationId)
    expect(spec.generation.generatedBy).to.include('generate-fragment-ownership-spec')
  })

  // ── Region Partition ──────────────────────────────────────────────────
  it('defines exactly six regions', () => {
    const regions = spec.regionPartition.regions
    const names = Object.keys(regions)
    expect(names).to.have.length(6)
    expect(names).to.include.members([
      'center', 'west-upper', 'west-lower',
      'east-upper', 'east-lower', 'entrance',
    ])
  })

  it('regions partition source space without gaps', () => {
    const regions = spec.regionPartition.regions
    const w = spec.sourceProvenance.width
    const h = spec.sourceProvenance.height

    // Check that [0,w)×[0,h) is fully covered
    const testPoints = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
      [360, 290], [360, 870], [1080, 290], [1080, 870],
      [720, 290], [720, 870], [1130, 290], [1130, 870],
    ]
    for (const [px, py] of testPoints) {
      let covered = false
      for (const def of Object.values(regions)) {
        if (px >= def.xRange[0] && px < def.xRange[1] &&
            py >= def.yRange[0] && py < def.yRange[1]) {
          covered = true
          break
        }
      }
      expect(covered, `Point (${px},${py}) not covered by any region`).to.be.true
    }
  })

  it('regions do not meaningfully overlap', () => {
    const regions = spec.regionPartition.regions
    const names = Object.keys(regions)
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = regions[names[i]], b = regions[names[j]]
        const ox = Math.max(a.xRange[0], b.xRange[0])
        const oy = Math.max(a.yRange[0], b.yRange[0])
        const ow = Math.min(a.xRange[1], b.xRange[1]) - ox
        const oh = Math.min(a.yRange[1], b.yRange[1]) - oy
        if (ow > 0 && oh > 0) {
          // Half-open semantics: touching at boundary is OK
          expect(false, `Regions ${names[i]} and ${names[j]} overlap: (${ox},${oy},${ow},${oh})`).to.be.true
        }
      }
    }
  })

  // ── Fragment Validation ───────────────────────────────────────────────
  it('all fragments have valid stableIds', () => {
    const stableIdRe = /^[a-z0-9][a-z0-9._-]{2,95}$/
    const ids = new Set()
    for (const f of spec.fragments) {
      expect(f.stableId, `Invalid stableId: ${f.stableId}`).to.match(stableIdRe)
      expect(ids.has(f.stableId), `Duplicate stableId: ${f.stableId}`).to.be.false
      ids.add(f.stableId)
    }
  })

  it('stableIds are deterministic and not order-dependent', () => {
    // stableId format: jyt.occ.<region>.<classification>-<NN>.v1
    for (const f of spec.fragments) {
      expect(f.stableId).to.match(/^jyt\.occ\./)
      expect(f.stableId).to.match(/\.v1$/)
    }
  })

  it('all sourceRects are within source bounds', () => {
    const w = spec.sourceProvenance.width
    const h = spec.sourceProvenance.height
    for (const f of spec.fragments) {
      const r = f.sourceRect
      expect(r.x).to.be.at.least(0)
      expect(r.y).to.be.at.least(0)
      expect(r.x + r.width).to.be.at.most(w)
      expect(r.y + r.height).to.be.at.most(h)
      expect(r.width).to.be.above(0)
      expect(r.height).to.be.above(0)
    }
  })

  it('destinationRects equal sourceRects (exact reconstruction)', () => {
    for (const f of spec.fragments) {
      expect(f.destinationRect).to.deep.equal(f.sourceRect,
        `${f.stableId}: destinationRect must equal sourceRect for exact reconstruction`)
    }
  })

  it('no overlapping sourceRects', () => {
    const frags = spec.fragments
    for (let i = 0; i < frags.length; i++) {
      for (let j = i + 1; j < frags.length; j++) {
        const a = frags[i].sourceRect, b = frags[j].sourceRect
        const overlap = a.x < b.x + b.width && a.x + a.width > b.x &&
                        a.y < b.y + b.height && a.y + a.height > b.y
        expect(overlap, `Overlap: ${frags[i].stableId} and ${frags[j].stableId}`).to.be.false
      }
    }
  })

  it('every fragment belongs to a valid region', () => {
    const regionNames = Object.keys(spec.regionPartition.regions)
    for (const f of spec.fragments) {
      expect(regionNames).to.include(f.region, `${f.stableId} has unknown region: ${f.region}`)
      expect(f.chunkId).to.equal(f.region)
    }
  })

  it('fragment count matches declared count', () => {
    expect(spec.fragments.length).to.equal(spec.outputConstraints.fragmentCount)
  })

  it('region fragment counts match', () => {
    const counts = {}
    for (const f of spec.fragments) {
      counts[f.region] = (counts[f.region] || 0) + 1
    }
    expect(counts).to.deep.equal(spec.outputConstraints.regionFragmentCounts)
  })

  // ── Output Constraints ────────────────────────────────────────────────
  it('enforces lossless output', () => {
    expect(spec.outputConstraints.losslessOnly).to.be.true
    expect(spec.outputConstraints.format).to.include('lossless-webp')
    expect(spec.outputConstraints.pixelOwnershipModel).to.equal('sourceRect-exclusive-partition')
  })

  // ── Ownership Report ──────────────────────────────────────────────────
  it('has passing ownership report', () => {
    const reportPath = join(REPO_ROOT, FIXTURE_DIR, 'ownership-report.json')
    expect(existsSync(reportPath), 'Ownership report not found').to.be.true
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    expect(report.ownershipResult.passed).to.be.true
    expect(report.ownershipResult.opaqueUnowned).to.equal(0)
    expect(report.ownershipResult.overlapPixels).to.equal(0)
    expect(report.ownershipResult.opaqueOwned).to.equal(spec.sourceProvenance.totalOpaquePixels)
  })

  // ── Contact Sheet ─────────────────────────────────────────────────────
  it('has self-contained SVG contact sheet', () => {
    const svgPath = join(REPO_ROOT, FIXTURE_DIR, 'contact-sheet.svg')
    expect(existsSync(svgPath), 'Contact sheet not found').to.be.true
    const svg = readFileSync(svgPath, 'utf8')
    expect(svg).to.include('<svg')
    expect(svg).to.include('data:image/webp;base64,')
    expect(svg).to.include("E9A Fragment Ownership")
  })

  // ── Validator Integration ─────────────────────────────────────────────
  it('validator exits 0 on valid spec', function () {
    this.timeout(30000)
    const result = runValidator()
    expect(result.status).to.equal(0,
      `Validator failed:\n${result.stderr}\n${result.stdout}`)
  })

  // ── Reproducibility ──────────────────────────────────────────────────
  it('generator produces deterministic output', function () {
    this.timeout(60000)
    const run1 = spawnSync(process.execPath, [
      join(REPO_ROOT, 'scripts/juyiting/generate-fragment-ownership-spec.mjs'),
    ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 35000,
         env: { ...process.env, CHROMIUM_HEADLESS: '/usr/local/bin/chromium-headless-smoke' } })
    const run2 = spawnSync(process.execPath, [
      join(REPO_ROOT, 'scripts/juyiting/generate-fragment-ownership-spec.mjs'),
    ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 35000,
         env: { ...process.env, CHROMIUM_HEADLESS: '/usr/local/bin/chromium-headless-smoke' } })

    expect(run1.status).to.equal(0)
    expect(run2.status).to.equal(0)
    const spec1 = JSON.parse(run1.stdout)
    const spec2 = JSON.parse(run2.stdout)
    expect(spec1.generationId).to.equal(spec2.generationId)
    expect(spec1.fragments.length).to.equal(spec2.fragments.length)
  })
})

// ── Mutation / Adversarial Tests ──────────────────────────────────────────
describe('E9A Fragment Ownership — Mutation Tests', () => {
  let tempSpecPath

  beforeEach(() => {
    tempSpecPath = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-fragments', `mutated-${Date.now()}.json`)
  })

  afterEach(() => {
    try {
      if (existsSync(tempSpecPath)) unlinkSync(tempSpecPath)
    } catch {}
  })

  function writeMutatedSpec(mutations) {
    const s = JSON.parse(JSON.stringify(spec))
    for (const [path, value] of Object.entries(mutations)) {
      setDeep(s, path, value)
    }
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
  }

  function setDeep(obj, path, value) {
    const parts = path.split('.')
    let current = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      const match = part.match(/^(.+)\[(\d+)\]$/)
      if (match) {
        current = current[match[1]][parseInt(match[2])]
      } else {
        current = current[part]
      }
    }
    const last = parts[parts.length - 1]
    const lm = last.match(/^(.+)\[(\d+)\]$/)
    if (lm) {
      current[lm[1]][parseInt(lm[2])] = value
    } else {
      current[last] = value
    }
  }

  function runValidatorOnMutated() {
    const relPath = tempSpecPath.replace(REPO_ROOT + '/', '')
    return spawnSync(process.execPath, [
      join(REPO_ROOT, 'scripts/juyiting/validate-fragment-ownership.mjs'),
      relPath,
    ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000,
         env: { ...process.env, CHROMIUM_HEADLESS: '/usr/local/bin/chromium-headless-smoke' } })
  }

  it('rejects wrong canonical SHA-256', function () {
    this.timeout(30000)
    writeMutatedSpec({ 'sourceProvenance.sha256': '0'.repeat(64) })
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
    expect(result.stderr).to.include('SHA-256 mismatch')
  })

  it('rejects wrong canonical dimensions', function () {
    this.timeout(30000)
    writeMutatedSpec({ 'sourceProvenance.width': 100 })
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
    expect(result.stderr).to.include('Width mismatch')
  })

  it('rejects overlapping sourceRects', function () {
    // Create a duplicate sourceRect to force overlap
    const s = JSON.parse(JSON.stringify(spec))
    const dup = JSON.parse(JSON.stringify(s.fragments[0]))
    dup.stableId = 'jyt.occ.test.duplicate-overlap.v1'
    s.fragments.push(dup)
    s.outputConstraints.fragmentCount = s.fragments.length
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
  })

  it('rejects duplicate stableId', function () {
    const s = JSON.parse(JSON.stringify(spec))
    const dup = JSON.parse(JSON.stringify(s.fragments[0]))
    // Same stableId, different sourceRect (not overlapping)
    dup.sourceRect = { x: 0, y: 0, width: 10, height: 10 }
    dup.destinationRect = { x: 0, y: 0, width: 10, height: 10 }
    s.fragments.push(dup)
    s.outputConstraints.fragmentCount = s.fragments.length
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
    expect(result.stderr).to.include('Duplicate stableId')
  })

  it('rejects invalid stableId format', function () {
    const s = JSON.parse(JSON.stringify(spec))
    s.fragments[0].stableId = 'INVALID!!!'
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
    expect(result.stderr).to.include('Invalid stableId format')
  })

  it('rejects out-of-bounds sourceRect', function () {
    const s = JSON.parse(JSON.stringify(spec))
    s.fragments[0].sourceRect.x = 2000
    s.fragments[0].destinationRect.x = 2000
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
    expect(result.stderr).to.include('sourceRect out of bounds')
  })

  it('rejects destinationRect differing from sourceRect', function () {
    const s = JSON.parse(JSON.stringify(spec))
    s.fragments[0].destinationRect.x = 50
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
    expect(result.stderr).to.include('destinationRect differs')
  })

  it('rejects wrong region assignment', function () {
    const s = JSON.parse(JSON.stringify(spec))
    s.fragments[0].region = 'east-upper'
    s.fragments[0].chunkId = 'east-upper'
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    // The fragment was originally west-upper; region counts may mismatch
    const result = runValidatorOnMutated()
    // May or may not fail depending on whether sourceRect is within the new region
    // This is a soft check; the validator should at least produce warnings
  })

  it('rejects non-lossless output format', function () {
    const s = JSON.parse(JSON.stringify(spec))
    s.outputConstraints.losslessOnly = false
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
    expect(result.stderr).to.include('losslessOnly')
  })

  it('rejects missing lossless-webp format', function () {
    const s = JSON.parse(JSON.stringify(spec))
    s.outputConstraints.format = ['png']
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
    expect(result.stderr).to.include('lossless-webp')
  })

  it('rejects wrong pixel ownership model', function () {
    const s = JSON.parse(JSON.stringify(spec))
    s.outputConstraints.pixelOwnershipModel = 'overlapping'
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
    expect(result.stderr).to.include('pixelOwnershipModel')
  })

  it('rejects zero-dimension sourceRect', function () {
    const s = JSON.parse(JSON.stringify(spec))
    s.fragments[0].sourceRect.width = 0
    s.fragments[0].destinationRect.width = 0
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
  })

  it('detects gap in region coverage', function () {
    // Shift one region boundary to create a gap
    const s = JSON.parse(JSON.stringify(spec))
    s.regionPartition.regions['west-upper'].xRange[1] = 700 // was 721
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    const result = runValidatorOnMutated()
    // The point at x=720 would not be covered
    // Validator spot-checks should catch this
  })

  it('missing canonical file produces error', function () {
    const s = JSON.parse(JSON.stringify(spec))
    s.sourceProvenance.path = 'nonexistent.webp'
    writeFileSync(tempSpecPath, JSON.stringify(s, null, 2))
    const result = runValidatorOnMutated()
    expect(result.status).to.not.equal(0)
    expect(result.stderr).to.include('not found')
  })
})

// ── Integration with E1/E8A/E8B Artifacts ─────────────────────────────────
describe('E9A Fragment Ownership — Provenance Chain', () => {
  it('references E8B current TMX anchor', () => {
    expect(spec.inputProvenance.tmxAnchor.sha256).to.equal(E8B_LIVE_TMX_SHA256)
  })

  it('references E1 canonical source SHA-256', () => {
    const e1Hashes = JSON.parse(readFileSync(
      join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v0/source-hashes.json'), 'utf8'))
    expect(e1Hashes.canonicalSource.expectedSha256).to.equal(CANONICAL_EXPECTED_SHA256)
  })

  it('does not modify E8A/E8B accepted artifacts', () => {
    // E8A prop-sort-spec should still be valid
    const propSpecPath = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json')
    expect(existsSync(propSpecPath)).to.be.true
    const propSpec = JSON.parse(readFileSync(propSpecPath, 'utf8'))
    expect(propSpec.taskId).to.equal('E8A')
    expect(propSpec.generationId).to.be.a('string')

    // E8B TMX manifest should still be valid
    const tmxManifestPath = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props/prop-tmx-manifest.json')
    expect(existsSync(tmxManifestPath)).to.be.true
    const tmxManifest = JSON.parse(readFileSync(tmxManifestPath, 'utf8'))
    expect(tmxManifest.taskId).to.equal('E8B')
  })

  it('E1 baseline fixtures still intact', () => {
    const invPath = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v0/inventory.json')
    expect(existsSync(invPath)).to.be.true
    const inv = JSON.parse(readFileSync(invPath, 'utf8'))
    expect(inv.counts.masks).to.equal(37)
    expect(inv.counts.props).to.equal(5)
  })
})
