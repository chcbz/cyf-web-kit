import { expect } from 'chai'
import { spawnSyncCaptured } from '../scripts/juyiting/lib/spawn-capture.mjs'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

import { atomicWriteBytesBatch } from '../scripts/juyiting/lib/atomic-write-bytes.mjs'
import { linkSync as realLinkSync } from 'node:fs'
import {
  CANONICAL_EXPECTED_SHA256,
  E8B_TMX_SHA256,
  REGION_ORDER,
} from '../scripts/juyiting/lib/fragment-ownership-v2.mjs'
import { E8B_LIVE_TMX_SHA256 } from '../scripts/juyiting/lib/baseline-provenance.mjs'
import {
  E9A_GENERATION_ID,
  ATLAS_OUTPUT_DIR,
  E9B_FIXTURE_DIR,
  CANONICAL_PATH,
  CANONICAL_WIDTH,
  CANONICAL_HEIGHT,
  EXTRUSION_PIXELS,
  PADDING_PIXELS,
  PNG_ENCODE_OPTIONS,
  SEAM_FOCUSES,
  ZOOMS,
  ZOOM_FACTORS,
  atlasFilePath,
  compareGolden,
  computeManifestId,
  cropRgba,
  decodeCanonicalRgba,
  decodePng,
  encodePng,
  scaledCropComparison,
  transparentRgbAnalysis,
} from '../scripts/juyiting/lib/occluder-atlases-v2.mjs'
import { generateOccluderAtlases } from '../scripts/juyiting/generate-occluder-atlases.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const FIXTURE_DIR = 'tests/fixtures/juyiting/occlusion-v2-atlases'
const MANIFEST_PATH = join(FIXTURE_DIR, 'atlas-manifest.json')
const GOLDEN_PATH = join(FIXTURE_DIR, 'rgba-golden-report.json')
const SEAM_REPORT_PATH = join(FIXTURE_DIR, 'seam-evidence-report.json')
const SEAM_DIR = join(FIXTURE_DIR, 'seam-evidence')
const CANONICAL_PATH_FULL = join(REPO_ROOT, CANONICAL_PATH)
const CHROMIUM_ENV = {
  ...process.env,
  CHROMIUM_HEADLESS: process.env.CHROMIUM_HEADLESS || '/usr/local/bin/chromium-headless-smoke',
  CHROMIUM_PROVENANCE: process.env.CHROMIUM_PROVENANCE
    || process.env.CHROMIUM_HEADLESS
    || '/usr/local/bin/chromium-headless-smoke',
}

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST_PATH), 'utf8'))
const goldenReport = JSON.parse(readFileSync(join(REPO_ROOT, GOLDEN_PATH), 'utf8'))
const seamReport = JSON.parse(readFileSync(join(REPO_ROOT, SEAM_REPORT_PATH), 'utf8'))
const spec = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json'), 'utf8'))
const canonicalBytes = readFileSync(CANONICAL_PATH_FULL)

const GENERATOR = 'scripts/juyiting/generate-occluder-atlases.mjs'
const VALIDATOR = 'scripts/juyiting/validate-occluder-atlases.mjs'

function runNode(script, args = [], timeout = 60000) {
  return spawnSyncCaptured(process.execPath, [join(REPO_ROOT, script), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout,
    env: CHROMIUM_ENV,
  })
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function atlasFileSnapshot() {
  const entries = [
    ...REGION_ORDER.map(region => join(ATLAS_OUTPUT_DIR, `${region}-v2.png`)),
    MANIFEST_PATH,
    GOLDEN_PATH,
    SEAM_REPORT_PATH,
    ...SEAM_FOCUSES.map(focus => join(SEAM_DIR, `contact-sheet-${String(focus.index).padStart(2, '0')}-${focus.id}.svg`)),
  ]
  return Object.fromEntries(entries.map(path => [path, sha256Bytes(readFileSync(join(REPO_ROOT, path)))]))
}

function writeTemp(name, content) {
  const path = join(REPO_ROOT, FIXTURE_DIR, name)
  writeFileSync(path, content)
  return path
}

function removeTemp(path) {
  try { if (existsSync(path)) unlinkSync(path) } catch {}
}

describe('E9B Six-Region Occluder Atlases (directed)', () => {
  it('locks the frozen E9A generationId, canonical hash and E8B TMX anchor', () => {
    expect(manifest.e9aGenerationId).to.equal(E9A_GENERATION_ID)
    expect(manifest.generationId).to.equal(E9A_GENERATION_ID)
    expect(manifest.taskId).to.equal('E9B')
    expect(manifest.canonical.path).to.equal(CANONICAL_PATH)
    expect(manifest.canonical.sha256).to.equal(CANONICAL_EXPECTED_SHA256)
    expect(manifest.canonical.width).to.equal(1664)
    expect(manifest.canonical.height).to.equal(928)
    expect(manifest.canonical.totalOpaquePixels).to.equal(248283)
    expect(manifest.e8bTmx.taskId).to.equal('E8B')
    expect(manifest.e8bTmx.sha256).to.equal(E8B_TMX_SHA256)
    expect(manifest.e8bTmx.sha256).to.equal(E8B_LIVE_TMX_SHA256)
    expect(sha256Bytes(canonicalBytes)).to.equal(CANONICAL_EXPECTED_SHA256)
  })

  it('records deterministic generator/tool versions and a lossless format choice', () => {
    expect(manifest.generator.script).to.equal(GENERATOR)
    expect(manifest.generator.nodeVersion).to.match(/^v\d+\./)
    expect(manifest.generator.pngjsVersion).to.match(/^\d+\.\d+\.\d+$/)
    expect(manifest.encoding.format).to.equal('png')
    expect(manifest.encoding.lossless).to.equal(true)
    expect(manifest.encoding.colorType).to.equal(6)
    expect(manifest.encoding.bitDepth).to.equal(8)
    expect(manifest.encoding.alpha).to.equal(true)
    expect(manifest.encoding.deflateLevel).to.equal(PNG_ENCODE_OPTIONS.deflateLevel)
    expect(manifest.encoding.filterType).to.equal(PNG_ENCODE_OPTIONS.filterType)
    expect(manifest.encoding.formatChoiceRationale).to.include('lossless')
    expect(manifest.encoding.specAllowedFormats).to.deep.equal(['lossless-webp', 'png'])
    expect(manifest.manifestId).to.match(/^[a-f0-9]{64}$/)
    expect(manifest.manifestId).to.equal(computeManifestId(manifest))
  })

  it('lists exactly six atlases in REGION_ORDER with correct names, dimensions and on-disk SHA-256', () => {
    expect(manifest.atlases.map(atlas => atlas.region)).to.deep.equal(REGION_ORDER)
    for (const atlas of manifest.atlases) {
      expect(atlas.file).to.equal(atlasFilePath(atlas.region))
      const bytes = readFileSync(join(REPO_ROOT, atlas.file))
      expect(sha256Bytes(bytes)).to.equal(atlas.sha256)
      expect(atlas.bytes).to.equal(bytes.length)
      const png = PNG.sync.read(bytes)
      expect(png.width).to.equal(atlas.width)
      expect(png.height).to.equal(atlas.height)
      expect(png.data).to.have.length(atlas.width * atlas.height * 4)
    }
  })

  it('maps all 32 fragments with atlasRect/sourceRect/destinationRect/padding/extrusion/encoding', () => {
    expect(manifest.fragments).to.have.length(32)
    expect(manifest.fragments.map(fragment => fragment.stableId)).to.deep.equal(spec.fragments.map(fragment => fragment.stableId))
    for (let index = 0; index < manifest.fragments.length; index++) {
      const mapping = manifest.fragments[index]
      const fragment = spec.fragments[index]
      expect(mapping.homeRegion).to.equal(fragment.homeRegion)
      expect(mapping.sourceRect).to.deep.equal(fragment.sourceRect)
      expect(mapping.destinationRect).to.deep.equal(fragment.destinationRect)
      expect(mapping.destinationMapping).to.deep.equal(fragment.destinationMapping)
      expect(mapping.paddingPixels).to.equal(PADDING_PIXELS)
      expect(mapping.extrusionPixels).to.equal(EXTRUSION_PIXELS)
      expect(mapping.encoding).to.equal('png')
      expect(mapping.ownedOpaquePixelCount).to.equal(fragment.ownedOpaquePixelCount)
      const atlas = manifest.atlases.find(entry => entry.region === mapping.homeRegion)
      expect(mapping.atlasFile).to.equal(atlas.file)
      const rect = mapping.atlasRect
      expect(rect.width).to.equal(mapping.pixelBounds.width + 2 * EXTRUSION_PIXELS)
      expect(rect.height).to.equal(mapping.pixelBounds.height + 2 * EXTRUSION_PIXELS)
      expect(rect.x).to.be.at.least(0)
      expect(rect.y).to.be.at.least(0)
      expect(rect.x + rect.width).to.be.at.most(atlas.width)
      expect(rect.y + rect.height).to.be.at.most(atlas.height)
    }
  })

  it('records deterministic packing order and non-overlapping placements per atlas', () => {
    for (const region of REGION_ORDER) {
      const atlas = manifest.atlases.find(entry => entry.region === region)
      const expectedOrder = manifest.fragments.filter(fragment => fragment.homeRegion === region).map(fragment => fragment.stableId)
      expect(atlas.packingOrder).to.deep.equal(expectedOrder)
      expect(manifest.packingOrder[region]).to.deep.equal(expectedOrder)
      const rects = manifest.fragments.filter(fragment => fragment.homeRegion === region).map(fragment => fragment.atlasRect)
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const left = rects[i], right = rects[j]
        const overlaps = left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y
        expect(overlaps, `${region} packing overlap between ${i} and ${j}`).to.equal(false)
      }
    }
    expect(manifest.packing.algorithm).to.equal('deterministic-shelf')
    expect(manifest.packing.orderBasis).to.include('spec stableId order')
    expect(manifest.packing.atlasWidthBasis).to.include('chunk width')
  })

  it('has a pixel-exact RGBA golden report with zero missing/overlap/channel mismatch', () => {
    expect(goldenReport.taskId).to.equal('E9B')
    expect(goldenReport.e9aGenerationId).to.equal(E9A_GENERATION_ID)
    expect(goldenReport.manifestId).to.equal(manifest.manifestId)
    expect(goldenReport.golden.passed).to.equal(true)
    expect(goldenReport.golden.missingPixels).to.equal(0)
    expect(goldenReport.golden.overlapPixels).to.equal(0)
    expect(goldenReport.golden.channelMismatchPixels).to.equal(0)
    expect(goldenReport.golden.channelMismatchByChannel).to.deep.equal({ r: 0, g: 0, b: 0, a: 0 })
    expect(goldenReport.golden.comparedPixels).to.equal(CANONICAL_WIDTH * CANONICAL_HEIGHT)
    expect(goldenReport.metrics.atlasCount).to.equal(6)
    expect(goldenReport.metrics.fragmentCount).to.equal(32)
    expect(goldenReport.metrics.packingEfficiency).to.be.above(0)
    expect(goldenReport.metrics.networkBytes).to.equal(manifest.atlases.reduce((sum, atlas) => sum + atlas.bytes, 0))
  })

  it('enforces the transparent-RGB policy: canonical has zero alpha=0 pixels with non-zero RGB', function () {
    this.timeout(60000)
    const decoded = decodeCanonicalRgba(canonicalBytes)
    const analysis = transparentRgbAnalysis(decoded.rgba, { width: decoded.width, height: decoded.height })
    expect(analysis.alpha0NonZeroRgb).to.equal(0)
    expect(goldenReport.transparentRgbPolicy.canonicalAlpha0NonZeroRgb).to.equal(0)
    expect(goldenReport.transparentRgbPolicy.reconstructedAlpha0NonZeroRgb).to.equal(0)
    expect(goldenReport.transparentRgbPolicy.policy).to.include('cleared to rgba(0,0,0,0)')
  })

  it('provides zoom seam evidence for all four y=580 focuses at all five zooms, exact', () => {
    expect(seamReport.e9aGenerationId).to.equal(E9A_GENERATION_ID)
    expect(seamReport.manifestId).to.equal(manifest.manifestId)
    expect(seamReport.allExact).to.equal(true)
    expect(seamReport.requiredZooms).to.deep.equal(ZOOMS)
    expect(seamReport.focuses).to.have.length(4)
    for (const focus of seamReport.focuses) {
      expect(Object.keys(focus.zooms).sort()).to.deep.equal([...ZOOMS].sort())
      for (const zoom of ZOOMS) {
        expect(focus.zooms[zoom].exact).to.equal(true)
        expect(focus.zooms[zoom].mismatchPixels).to.equal(0)
        expect(focus.zooms[zoom].maxChannelDelta).to.equal(0)
      }
      const sheet = readFileSync(join(REPO_ROOT, FIXTURE_DIR, focus.contactSheet), 'utf8')
      expect(sheet).to.include(`data-focus-id="${focus.id}"`)
      expect(sheet).to.include(`data-stable-id="${focus.stableId}"`)
      expect(sheet).to.include('data-column="canonical-equivalent-reconstructed"')
      const images = [...sheet.matchAll(/<image data-zoom-index="(\d+)" data-zoom="([\d.]+)" href="data:image\/png;base64,([^"]+)" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)]
      expect(images).to.have.length(5)
      expect(images.map(image => image[2])).to.deep.equal(ZOOMS)
      for (const image of images) {
        const png = PNG.sync.read(Buffer.from(image[3], 'base64'))
        expect(png.width).to.equal(Number(image[6]))
        expect(png.height).to.equal(Number(image[7]))
        expect(png.width).to.equal(Math.round(focus.cropRect.width * ZOOM_FACTORS[image[2]]))
        expect(png.height).to.equal(Math.round(focus.cropRect.height * ZOOM_FACTORS[image[2]]))
      }
    }
  })

  it('contains no extra on-disk assets beyond the six manifest atlases', () => {
    const files = readdirSync(join(REPO_ROOT, ATLAS_OUTPUT_DIR)).sort()
    expect(files).to.deep.equal(REGION_ORDER.map(region => `${region}-v2.png`).sort())
  })

  it('validator accepts the committed manifest', function () {
    this.timeout(60000)
    const result = runNode(VALIDATOR, [])
    expect(result.status, result.stderr).to.equal(0)
    expect(result.stdout).to.include('golden=exact')
  })

  it('validator structural phase accepts the committed manifest', function () {
    this.timeout(30000)
    const result = runNode(VALIDATOR, ['--no-golden'])
    expect(result.status, result.stderr).to.equal(0)
    expect(result.stdout).to.include('golden=skipped')
  })

  it('uses the binary-safe transactional batch installer for every atlas/fixture path', () => {
    const generatorSource = readFileSync(join(REPO_ROOT, GENERATOR), 'utf8')
    expect(generatorSource).to.include('atomicWriteBytesBatch')
    expect(generatorSource).not.to.match(/writeFileSync\(/)
    const libSource = readFileSync(join(REPO_ROOT, 'scripts/juyiting/lib/atomic-write-bytes.mjs'), 'utf8')
    expect(libSource).to.include('export function atomicWriteBytesBatch')
    expect(libSource).to.include('O_NOFOLLOW')
  })
})

describe('E9B Determinism', () => {
  it('regenerates every atlas, manifest and evidence artifact byte-for-byte', function () {
    this.timeout(180000)
    const snapshot = atlasFileSnapshot()
    for (let run = 0; run < 2; run++) {
      const result = runNode(GENERATOR, [], 90000)
      expect(result.status, result.stderr).to.equal(0)
      const after = atlasFileSnapshot()
      for (const [path, hash] of Object.entries(snapshot)) {
        expect(after[path], `run ${run + 1} changed ${path}`).to.equal(hash)
      }
    }
  })
})

describe('E9B Mutation Tests (manifest structural)', () => {
  let tempPath

  beforeEach(() => {
    tempPath = join(REPO_ROOT, FIXTURE_DIR, `mutated-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  })

  afterEach(() => { removeTemp(tempPath) })

  function validateMutation(mutate, args = ['--no-golden']) {
    const mutated = structuredClone(manifest)
    mutate(mutated)
    atomicWriteBytesBatch([{ path: tempPath, bytes: Buffer.from(`${JSON.stringify(mutated, null, 2)}\n`), label: 'E9B mutation manifest' }], 'E9B mutation fixture update')
    return runNode(VALIDATOR, [tempPath.slice(REPO_ROOT.length + 1), ...args], 30000)
  }

  function expectRejected(mutate, message, args = ['--no-golden']) {
    const result = validateMutation(mutate, args)
    expect(result.status, result.stderr).not.to.equal(0)
    expect(result.stderr).to.include(message)
  }

  it('rejects a wrong E9A generationId', () => expectRejected(mutated => {
    mutated.e9aGenerationId = 'f'.repeat(64); mutated.generationId = 'f'.repeat(64)
  }, 'E9A generationId mismatch'))
  it('rejects a wrong canonical hash', () => expectRejected(mutated => { mutated.canonical.sha256 = '0'.repeat(64) }, 'canonical SHA-256 must remain frozen'))
  it('rejects a wrong E8B TMX anchor', () => expectRejected(mutated => { mutated.e8bTmx.sha256 = '0'.repeat(64) }, 'E8B TMX SHA-256 must remain frozen'))
  it('rejects a missing manifestId', () => expectRejected(mutated => { mutated.manifestId = undefined }, 'manifestId must be a sha256 hex string'))
  it('rejects an ownedOpaquePixelCount run drift', () => expectRejected(mutated => { mutated.fragments[0].ownedOpaquePixelCount++ }, 'ownedOpaquePixelCount drift'))
  it('rejects a pixelBounds outside its sourceRect', () => expectRejected(mutated => { mutated.fragments[0].pixelBounds.x = mutated.fragments[0].sourceRect.x - 1 }, 'pixelBounds must lie within sourceRect'))
  it('rejects an atlasRect that is not pixelBounds plus extrusion', () => expectRejected(mutated => { mutated.fragments[0].atlasRect.width += 1 }, 'atlasRect must equal pixelBounds plus extrusion'))
  it('rejects a packing overlap between two placements', () => expectRejected(mutated => {
    // fragments[1] and [2] are both east-lower and start on the same shelf;
    // forcing the second onto the first's x causes a genuine overlap.
    mutated.fragments[2].atlasRect.x = mutated.fragments[1].atlasRect.x
  }, 'packing overlap'))
  it('rejects an out-of-atlas-bounds placement', () => expectRejected(mutated => {
    mutated.fragments[0].atlasRect.x = 100000
  }, 'atlasRect out of atlas bounds'))
  it('rejects an atlas SHA-256 tamper', () => expectRejected(mutated => { mutated.atlases[0].sha256 = '0'.repeat(64) }, 'SHA-256 mismatch (tampered file)'))
  it('rejects a non-lossy manifest encoding', () => expectRejected(mutated => { mutated.encoding.lossless = false }, 'encoding must be lossless'))
  it('rejects a lossy/unsupported manifest format', () => expectRejected(mutated => { mutated.encoding.format = 'jpeg' }, 'encoding format must be lossless png or lossless-webp'))
  it('rejects a lossy/unsupported fragment format', () => expectRejected(mutated => { mutated.fragments[0].encoding = 'jpeg' }, 'encoding must be lossless png or lossless-webp'))
  it('rejects a fragment order permutation', () => expectRejected(mutated => {
    ;[mutated.fragments[0], mutated.fragments[1]] = [mutated.fragments[1], mutated.fragments[0]]
  }, 'fragment order/ids must exactly match'))
  it('rejects a packingOrder permutation', () => expectRejected(mutated => {
    const westUpper = mutated.fragments.filter(fragment => fragment.homeRegion === 'west-upper')
    const westUpperIds = westUpper.map(fragment => fragment.stableId)
    ;[westUpperIds[0], westUpperIds[1]] = [westUpperIds[1], westUpperIds[0]]
    mutated.packingOrder['west-upper'] = westUpperIds
    mutated.atlases.find(atlas => atlas.region === 'west-upper').packingOrder = westUpperIds
  }, 'packingOrder permutation or drift'))
  it('rejects a missing atlas region entry', () => expectRejected(mutated => {
    mutated.atlases = mutated.atlases.slice(0, 5)
  }, 'manifest must list exactly the six regions'))
  it('rejects an extra atlas region entry', () => expectRejected(mutated => {
    mutated.atlases.push(structuredClone(mutated.atlases[0]))
  }, 'manifest must list exactly the six regions'))
  it('rejects a wrong atlas file path', () => expectRejected(mutated => {
    mutated.atlases[0].file = 'public/juyiting/images/occluders/wrong-v2.png'
  }, 'atlas west-upper file must be'))
  it('rejects a destinationRect/sourceRect drift', () => expectRejected(mutated => {
    mutated.fragments[0].destinationRect.x++
  }, 'destinationRect must equal sourceRect'))
  it('rejects an atlas width that is not the home-region chunk width', () => expectRejected(mutated => {
    mutated.atlases[0].width = 700
  }, 'width must equal its home region chunk width'))

  it('rejects a missing on-disk atlas asset and leaves it restored', function () {
    const centerFile = join(REPO_ROOT, atlasFilePath('center'))
    const bytes = readFileSync(centerFile)
    const backup = `${centerFile}.e9b-test-backup`
    writeFileSync(backup, bytes)
    try {
      renameSync(centerFile, `${centerFile}.e9b-test-moved`)
      const result = runNode(VALIDATOR, ['--no-golden'], 30000)
      expect(result.status, result.stderr).not.to.equal(0)
      expect(result.stderr).to.include('atlas file missing')
    } finally {
      renameSync(`${centerFile}.e9b-test-moved`, centerFile)
      expect(sha256Bytes(readFileSync(centerFile))).to.equal(sha256Bytes(bytes))
      removeTemp(backup)
    }
  })
})

describe('E9B Mutation Tests (generator fail-closed)', () => {
  let tempPath

  beforeEach(() => {
    tempPath = join(REPO_ROOT, FIXTURE_DIR, `spec-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  })

  afterEach(() => { removeTemp(tempPath) })

  function expectGeneratorRejected(mutatedSpec, message) {
    const snapshot = atlasFileSnapshot()
    atomicWriteBytesBatch([{ path: tempPath, bytes: Buffer.from(`${JSON.stringify(mutatedSpec, null, 2)}\n`), label: 'E9B mutated spec' }], 'E9B mutated spec update')
    let threw = null
    try {
      generateOccluderAtlases({ specPath: tempPath.slice(REPO_ROOT.length + 1) })
    } catch (error) {
      threw = error.message
    }
    expect(threw, 'generator must fail closed').to.include(message)
    const after = atlasFileSnapshot()
    for (const [path, hash] of Object.entries(snapshot)) {
      expect(after[path], `generator must not install a partial set at ${path}`).to.equal(hash)
    }
  }

  it('fails closed on a wrong E9A generationId before any install', () => {
    const mutated = structuredClone(spec)
    mutated.generationId = 'f'.repeat(64)
    mutated.generation.generationId = mutated.generationId
    expectGeneratorRejected(mutated, 'E9A generationId mismatch')
  })

  it('fails closed on ownership run drift before any install', function () {
    this.timeout(120000)
    const mutated = structuredClone(spec)
    const fragment = mutated.fragments.find(candidate => candidate.ownershipRuns.length > 0)
    fragment.ownershipRuns = fragment.ownershipRuns.slice(0, -1)
    expectGeneratorRejected(mutated, 'golden comparison failed before install')
  })
})

describe('E9B Golden Reconstruction and Zoom Evidence (decoded mismatch)', () => {
  let tempPath

  beforeEach(() => {
    tempPath = join(REPO_ROOT, FIXTURE_DIR, `mismatch-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  })

  afterEach(() => { removeTemp(tempPath) })

  it('validator golden phase rejects a decoded reconstruction mismatch', function () {
    this.timeout(60000)
    const mutated = structuredClone(manifest)
    // Shift fragment 0's pixelBounds and atlasRect by one pixel: structural
    // checks still pass, but reconstruction reads the transparent extrusion
    // border so owned pixels go missing in the golden comparison.
    mutated.fragments[0].pixelBounds.x += 1
    mutated.fragments[0].atlasRect.x += 1
    atomicWriteBytesBatch([{ path: tempPath, bytes: Buffer.from(`${JSON.stringify(mutated, null, 2)}\n`), label: 'E9B mismatch manifest' }], 'E9B mismatch manifest update')
    const result = runNode(VALIDATOR, [tempPath.slice(REPO_ROOT.length + 1)], 60000)
    expect(result.status, result.stderr).not.to.equal(0)
    expect(result.stderr).to.include('golden missing pixels')
  })

  it('validator golden phase rejects zoom seam evidence mismatch', function () {
    this.timeout(60000)
    const mutated = structuredClone(manifest)
    // Truncate the west wall-panel assembly's pixelBounds so rows y>=600
    // (inside the first focus crop y=530..630) are never reconstructed. The
    // atlasRect shrinks consistently, so structural checks pass but every zoom
    // comparison for that focus diverges.
    const index = mutated.fragments.findIndex(fragment => fragment.stableId === 'jyt.occ.west-upper.wall-panel-assembly-01.v2')
    const bounds = mutated.fragments[index].pixelBounds
    const newHeight = 600 - bounds.y
    bounds.height = newHeight
    mutated.fragments[index].atlasRect.height = newHeight + 2 * EXTRUSION_PIXELS
    atomicWriteBytesBatch([{ path: tempPath, bytes: Buffer.from(`${JSON.stringify(mutated, null, 2)}\n`), label: 'E9B zoom mismatch manifest' }], 'E9B zoom mismatch manifest update')
    const result = runNode(VALIDATOR, [tempPath.slice(REPO_ROOT.length + 1)], 60000)
    expect(result.status, result.stderr).not.to.equal(0)
    expect(result.stderr).to.include('zoom seam evidence mismatch')
  })

  it('scaledCropComparison is exact only when inputs are pixel-identical', () => {
    const width = 32
    const height = 24
    const rgba = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      rgba[index] = (x * 7 + y * 3) % 256
      rgba[index + 1] = (x * 11) % 256
      rgba[index + 2] = (y * 13) % 256
      rgba[index + 3] = (x + y) % 8 === 0 ? 0 : 255
    }
    const rect = { x: 0, y: 0, width, height }
    const exact = scaledCropComparison(rgba, Buffer.from(rgba), rect, '2', { width, height })
    expect(exact.exact).to.equal(true)
    expect(exact.mismatchPixels).to.equal(0)
    expect(exact.maxChannelDelta).to.equal(0)
    const corrupted = Buffer.from(rgba)
    corrupted[0] = (corrupted[0] + 1) % 256
    const mismatch = scaledCropComparison(rgba, corrupted, rect, '2', { width, height })
    expect(mismatch.exact).to.equal(false)
    expect(mismatch.mismatchPixels).to.be.above(0)
    expect(mismatch.maxChannelDelta).to.be.above(0)
  })

  it('transparentRgbAnalysis flags non-zero RGB under alpha=0', () => {
    const rgba = Buffer.alloc(4 * 4)
    rgba[3] = 0
    rgba[1] = 5
    const analysis = transparentRgbAnalysis(rgba, { width: 2, height: 2 })
    expect(analysis.alpha0NonZeroRgb).to.equal(1)
    expect(analysis.samples[0]).to.deep.include({ x: 0, y: 0 })
  })

  it('compareGolden detects missing, overlap and channel mismatch on synthetic buffers', () => {
    const width = 4
    const height = 4
    const canonical = Buffer.alloc(width * height * 4)
    canonical[0] = 200; canonical[1] = 100; canonical[2] = 50; canonical[3] = 255
    canonical[4] = 10; canonical[5] = 20; canonical[6] = 30; canonical[7] = 0
    const fakeSpec = { fragments: [{ ownershipRuns: [[0, 0, 1]] }] }
    const missingRecon = Buffer.alloc(width * height * 4)
    let result = compareGolden(canonical, missingRecon, fakeSpec, { width, height })
    expect(result.missingPixels).to.equal(1)
    expect(result.overlapPixels).to.equal(0)
    expect(result.channelMismatchPixels).to.be.above(0)
    const overlapRecon = Buffer.alloc(width * height * 4)
    overlapRecon[0] = 200; overlapRecon[1] = 100; overlapRecon[2] = 50; overlapRecon[3] = 255
    overlapRecon[4] = 200; overlapRecon[5] = 100; overlapRecon[6] = 50; overlapRecon[7] = 255
    result = compareGolden(canonical, overlapRecon, fakeSpec, { width, height })
    expect(result.missingPixels).to.equal(0)
    expect(result.overlapPixels).to.equal(1)
    expect(result.channelMismatchPixels).to.equal(4)
  })

  it('cropRgba fails closed on out-of-bounds crops', () => {
    const rgba = Buffer.alloc(8 * 8 * 4)
    expect(() => cropRgba(rgba, 8, 8, { x: 0, y: 0, width: 9, height: 8 })).to.throw(/crop out of bounds/)
  })
})

describe('E9B Binary Atomic Batch Installer', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e9b-atomic-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const target = name => join(dir, name)

  function leftovers() {
    return readdirSync(dir).filter(file => file.includes('.tmp-') || file.includes('.backup-'))
  }

  it('installs a mixed batch (existing + new + nested) atomically', () => {
    writeFileSync(target('a.png'), Buffer.from('OLD-A'))
    atomicWriteBytesBatch([
      { path: target('a.png'), bytes: Buffer.from('NEW-A'), label: 'a' },
      { path: target('b.png'), bytes: Buffer.from('NEW-B'), label: 'b' },
      { path: join(dir, 'sub', 'c.json'), bytes: Buffer.from('{"c":1}'), label: 'c' },
    ], 'e9b batch')
    expect(readFileSync(target('a.png'), 'utf8')).to.equal('NEW-A')
    expect(readFileSync(target('b.png'), 'utf8')).to.equal('NEW-B')
    expect(readFileSync(join(dir, 'sub', 'c.json'), 'utf8')).to.equal('{"c":1}')
    expect(leftovers()).to.deep.equal([])
  })

  it('rolls back the whole batch when the second asset fails (no half set)', () => {
    writeFileSync(target('x.png'), Buffer.from('ORIG-X'))
    writeFileSync(target('y.png'), Buffer.from('ORIG-Y'))
    writeFileSync(target('z.json'), Buffer.from('ORIG-Z'))
    let linkCalls = 0
    const failingLink = (...args) => {
      linkCalls++
      if (linkCalls === 2) {
        const error = new Error('injected second-asset failure')
        error.code = 'EIO'
        throw error
      }
      return realLinkSync(...args)
    }
    let threw = null
    try {
      atomicWriteBytesBatch([
        { path: target('x.png'), bytes: Buffer.from('NEW-X'), label: 'x' },
        { path: target('y.png'), bytes: Buffer.from('NEW-Y'), label: 'y' },
        { path: target('z.json'), bytes: Buffer.from('NEW-Z'), label: 'z' },
      ], 'e9b rollback batch', { linkSync: failingLink })
    } catch (error) {
      threw = error
    }
    expect(threw).to.be.an.instanceof(Error)
    expect(readFileSync(target('x.png'), 'utf8')).to.equal('ORIG-X')
    expect(readFileSync(target('y.png'), 'utf8')).to.equal('ORIG-Y')
    expect(readFileSync(target('z.json'), 'utf8')).to.equal('ORIG-Z')
    expect(leftovers()).to.deep.equal([])
  })

  it('rolls back when the final manifest-equivalent entry fails', () => {
    writeFileSync(target('m1.png'), Buffer.from('ORIG-M1'))
    writeFileSync(target('m2.png'), Buffer.from('ORIG-M2'))
    let linkCalls = 0
    const failingLink = (...args) => {
      linkCalls++
      if (linkCalls === 3) {
        const error = new Error('injected manifest failure')
        error.code = 'EIO'
        throw error
      }
      return realLinkSync(...args)
    }
    let threw = null
    try {
      atomicWriteBytesBatch([
        { path: target('m1.png'), bytes: Buffer.from('NEW-M1'), label: 'm1' },
        { path: target('m2.png'), bytes: Buffer.from('NEW-M2'), label: 'm2' },
        { path: target('manifest.json'), bytes: Buffer.from('NEW-M'), label: 'manifest' },
      ], 'e9b manifest rollback', { linkSync: failingLink })
    } catch (error) {
      threw = error
    }
    expect(threw).to.be.an.instanceof(Error)
    expect(readFileSync(target('m1.png'), 'utf8')).to.equal('ORIG-M1')
    expect(readFileSync(target('m2.png'), 'utf8')).to.equal('ORIG-M2')
    expect(leftovers()).to.deep.equal([])
  })

  it('cleans staged temporaries when staging fails before any install', () => {
    writeFileSync(target('s1.png'), Buffer.from('ORIG-S1'))
    const failingWrite = () => {
      const error = new Error('injected staging write failure')
      error.code = 'EIO'
      throw error
    }
    let threw = null
    try {
      atomicWriteBytesBatch([
        { path: target('s1.png'), bytes: Buffer.from('NEW-S1'), label: 's1' },
        { path: target('s2.png'), bytes: Buffer.from('NEW-S2'), label: 's2' },
      ], 'e9b staging failure', { writeFileSync: failingWrite })
    } catch (error) {
      threw = error
    }
    expect(threw).to.be.an.instanceof(Error)
    expect(readFileSync(target('s1.png'), 'utf8')).to.equal('ORIG-S1')
    expect(leftovers()).to.deep.equal([])
  })
})

describe('E9B Provenance Chain', () => {
  it('leaves the accepted E9A spec and report untouched', () => {
    expect(spec.$schema).to.equal('jyt.occlusion.fragment-ownership-spec.v2')
    expect(spec.generationId).to.equal(E9A_GENERATION_ID)
    expect(spec.taskId).to.equal('E9A')
    expect(spec.downstreamRequirements.E10A.expectedLegacyMaskCount).to.equal(37)
    const ownershipReport = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-fragments/ownership-report.json'), 'utf8'))
    expect(ownershipReport.generationId).to.equal(E9A_GENERATION_ID)
    expect(ownershipReport.ownershipResult).to.deep.include({
      passed: true, totalOpaquePixels: 248283, opaqueOwned: 248283,
      opaqueUnowned: 0, overlapPixels: 0, transparentOwned: 0, opaqueCutEdgeCount: 0,
    })
  })

  it('leaves E1/E8A/E8B accepted artifacts intact', () => {
    const inventory = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v0/inventory.json'), 'utf8'))
    const hashes = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v0/source-hashes.json'), 'utf8'))
    expect(inventory.counts.masks).to.equal(37)
    expect(hashes.canonicalSource.expectedSha256).to.equal(CANONICAL_EXPECTED_SHA256)
    const propSpec = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json'), 'utf8'))
    const tmxManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props/prop-tmx-manifest.json'), 'utf8'))
    expect(propSpec.taskId).to.equal('E8A')
    expect(tmxManifest.taskId).to.equal('E8B')
    expect(manifest.e8bTmx.sha256).to.equal(E8B_TMX_SHA256)
  })

  it('declares the E10A 37-mask dependency without runtime changes', () => {
    expect(spec.downstreamRequirements.E10A.dependency).to.include('37 legacy masks')
    expect(spec.downstreamRequirements.E9B.zoomSeamEvidence.requiredZooms).to.deep.equal(['0.75', '1', '1.25', '1.5', '2'])
  })
})
