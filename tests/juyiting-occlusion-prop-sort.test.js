/** E8A directed tests for the GPT V1 visual-gate prop sort contract. */
import { expect } from 'chai'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { compareWorldSortKeys } from '../src/game/occlusion/worldOrder.ts'
import {
  BASE_COMMIT,
  ZERO_GENERATION_ID,
  BOUNTY_ROLES,
  DIRECTIONS,
  worldSortKey,
  intersectsHalfOpen,
  horizontalGap,
  stableJson
} from '../scripts/juyiting/lib/prop-sort-evidence.mjs'
import {
  E1_BASELINE_TMX_SHA256,
  E8B_LIVE_TMX_SHA256,
  readGitBlobAtCommit,
} from '../scripts/juyiting/lib/baseline-provenance.mjs'

const REPO_ROOT = process.cwd()
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props')
const SPEC_PATH = join(FIXTURE_DIR, 'prop-sort-spec.json')
const SVG_PATH = join(FIXTURE_DIR, 'contact-sheet.svg')
const TMX_PATH = join(REPO_ROOT, 'public/juyiting/hall.tmx')
const VERIFIER = join(REPO_ROOT, 'scripts/juyiting/verify-prop-sort-spec.mjs')
const ACCEPTED_COMMIT = 'da3d9600bd322e3a85d93ebfeaf07cd04a76f33d'
const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))

const EXPECTED_ORDER = [
  'jyt.prop.center-north.main-seat.v1',
  'jyt.prop.northeast.bounty-board.v1',
  'jyt.prop.center-north.roster-book.v1',
  'jyt.prop.southeast.library-shelf.v1',
  'jyt.prop.southwest.agent-roster.v1'
]

function resign(value) {
  value.generationId = ZERO_GENERATION_ID
  value.generationId = createHash('sha256').update(stableJson(value)).digest('hex')
  return value
}
function cloneSpec() { return JSON.parse(JSON.stringify(spec)) }
function tempWorkspace(prefix = 'e8a-prop-sort-') { return mkdtempSync(join(tmpdir(), prefix)) }
function runVerifier({ specPath = SPEC_PATH, svgPath = SVG_PATH, tmxPath = null } = {}) {
  const args = [VERIFIER, '--spec', specPath, '--svg', svgPath]
  if (tmxPath) args.push('--tmx', tmxPath)
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  })
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  }
}
function withAcceptedGeneratorOutputs(assertOutputs) {
  const root = tempWorkspace('e8a-repro-accepted-')
  try {
    const cloneDir = join(root, 'clone')
    const gitEnvironment = {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
    }
    execFileSync('git', ['clone', '--shared', '--quiet', REPO_ROOT, cloneDir], {
      timeout: 30000,
      env: gitEnvironment,
    })
    execFileSync('git', ['-C', cloneDir, 'checkout', '--detach', ACCEPTED_COMMIT], {
      timeout: 10000,
      env: gitEnvironment,
    })
    expect(execFileSync('git', ['-C', cloneDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', timeout: 5000, env: gitEnvironment,
    }).trim()).to.equal(ACCEPTED_COMMIT)
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(cloneDir, 'node_modules'))

    const outputs = [1, 2].map(index => ({
      spec: join(root, `spec-${index}.json`),
      svg: join(root, `sheet-${index}.svg`),
    }))
    for (const output of outputs) {
      const result = spawnSync(process.execPath, [
        join(cloneDir, 'scripts/juyiting/generate-prop-sort-spec.mjs'),
        '--spec', output.spec,
        '--svg', output.svg,
      ], {
        cwd: cloneDir,
        encoding: 'utf8',
        timeout: 60000,
        env: gitEnvironment,
      })
      expect(result.status, `${result.stdout}${result.stderr}`).to.equal(0)
    }
    return assertOutputs(outputs)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
function runMutatedSpec(mutate) {
  const dir = tempWorkspace()
  const path = join(dir, 'spec.json')
  const value = cloneSpec()
  mutate(value)
  resign(value)
  writeFileSync(path, `${stableJson(value)}\n`)
  const result = runVerifier({ specPath: path })
  rmSync(dir, { recursive: true, force: true })
  return result
}
function mutateTmx(replacer) {
  const dir = tempWorkspace('e8a-tmx-')
  const path = join(dir, 'hall.tmx')
  const original = readFileSync(TMX_PATH, 'utf8')
  const mutated = replacer(original)
  expect(mutated).to.not.equal(original)
  writeFileSync(path, mutated)
  return { dir, path }
}
function expectRejected(result, marker) {
  expect(result.error, result.output).to.equal(undefined)
  expect(result.signal, result.output).to.equal(null)
  expect(result.status, result.output).to.be.a('number').and.not.equal(0)
  expect(result.output).to.include(marker)
}

function sortProps(props) {
  return [...props].sort((a, b) => compareWorldSortKeys(
    worldSortKey(a.stableId, a.fixedPointY, a.tieBias),
    worldSortKey(b.stableId, b.fixedPointY, b.tieBias)
  ))
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

describe('E8A prop sort spec — GPT V1 visual gate', function () {
  this.timeout(120000)

  describe('frozen five-prop contract', () => {
    it('is complete, unique, schema-valid, and base-bound', () => {
      expect(spec.$schema).to.equal('jyt.occlusion.prop-sort-spec.v1')
      expect(spec.baseCommit).to.equal(BASE_COMMIT)
      expect(spec.propCount).to.equal(5)
      expect(spec.props).to.have.length(5)
      expect(spec.props.map(prop => prop.tmxId).sort((a, b) => a - b)).to.deep.equal([90, 91, 92, 93, 94])
      expect(new Set(spec.props.map(prop => prop.stableId)).size).to.equal(5)
      for (const prop of spec.props) {
        expect(prop.stableId).to.match(/^[a-z0-9][a-z0-9._-]{2,95}$/)
        expect(prop.sceneId).to.equal('juyiting-main')
        expect(prop.floorId).to.equal('floor-1')
        expect(prop.renderBand).to.equal('world')
        expect(prop.sortMode).to.equal('fixed')
        expect(prop.elevation).to.equal(0)
        expect(prop.fixedPointY).to.equal(Math.round(prop.sortAnchor.y * 256))
      }
    })

    it('freezes the REJECT-V1 roster-book correction as the whole lectern/cabinet', () => {
      const prop = spec.props.find(item => item.tmxId === 94)
      expect(prop.sortAnchor).to.deep.equal({ x: 306, y: 384 })
      expect(prop.fixedPointY).to.equal(98304)
      expect(prop.probes.north.agentFootPoint).to.deep.equal({ x: 306, y: 356 })
      expect(prop.probes.south.agentFootPoint).to.deep.equal({ x: 306, y: 412 })
      expect(prop.probes.west.agentFootPoint.y).to.equal(384)
      expect(prop.probes.east.agentFootPoint.y).to.equal(384)
      expect(prop.sortAnchorRationale).to.include('full illuminated lectern/cabinet')
      expect(prop.sortAnchorRationale).to.include('whole-asset floor/front-base boundary')
      expect(prop.sortAnchorEvidence.sampledRows.map(row => row.y)).to.deep.equal([160, 186, 187, 190, 191])
    })

    it('freezes the corrected E5 order and is declaration/insertion-order independent', () => {
      expect(sortProps(spec.props).map(prop => prop.stableId)).to.deep.equal(EXPECTED_ORDER)
      expect(spec.globalConstraints.fivePropSortOrder.order).to.deep.equal(EXPECTED_ORDER)
      for (let seed = 0; seed < 20; seed++) {
        expect(sortProps(shuffle(spec.props, seed)).map(prop => prop.stableId)).to.deep.equal(EXPECTED_ORDER)
      }
    })

    it('binds every prop asset to structured TMX gid/tileset/tile/image provenance', () => {
      for (const prop of spec.props) {
        expect(prop.tmxBinding.tilesetName).to.equal('hall-props')
        expect(prop.tmxBinding.firstgid).to.equal(6033)
        expect(prop.tmxBinding.objectalignment).to.equal('topleft')
        expect(prop.tmxBinding.gid).to.equal(prop.tmxBinding.firstgid + prop.tmxBinding.tileId)
        expect(prop.asset.width).to.equal(prop.tmxRect.width)
        expect(prop.asset.height).to.equal(prop.tmxRect.height)
        const bytes = readFileSync(join(REPO_ROOT, prop.asset.path))
        expect(createHash('sha256').update(bytes).digest('hex')).to.equal(prop.asset.sha256)
        expect(prop.sortAnchorEvidence.sampledRows.length).to.be.at.least(4)
        expect(prop.sortAnchorEvidence.anchorImagePoint.y).to.equal(prop.asset.height)
      }
    })
  })

  describe('alpha-AABB probes and canonical role frames', () => {
    it('freezes real persona manifest assets and decoded idle/down/frame-0 alpha AABBs', () => {
      const roles = spec.visualEvidence.roles
      expect(roles.lujunyi.displayName).to.equal('卢俊义')
      expect(roles.husanniang.displayName).to.equal('扈三娘')
      expect(roles.lujunyi.asset.sha256).to.equal('68ddd7e090437804f52e3c0bbdf0e44ee85f9d91b81dffe00171966a6f33fa65')
      expect(roles.husanniang.asset.sha256).to.equal('51db05d29907b4f6d3271518860ed9cd9c27f0445b6240b68a9957004cab4e99')
      expect(roles.lujunyi.sourceFrameAlphaAabb).to.deep.equal({ minX: 38, minY: 6, maxX: 89, maxY: 122, width: 51, height: 116, opaquePixels: 3677 })
      expect(roles.husanniang.sourceFrameAlphaAabb).to.deep.equal({ minX: 16, minY: 8, maxX: 111, maxY: 120, width: 95, height: 112, opaquePixels: 4857 })
      for (const role of BOUNTY_ROLES) {
        expect(roles[role].animation).to.equal('idle')
        expect(roles[role].direction).to.equal('down')
        expect(roles[role].animationFrameOrdinal).to.equal(0)
        expect(roles[role].sheetFrameIndex).to.equal(0)
      }
    })

    it('has all 20 N/S/W/E prop probes with finite coordinates and measured overlap', () => {
      for (const prop of spec.props) {
        for (const direction of DIRECTIONS) {
          const probe = prop.probes[direction]
          expect(probe.agentFootPoint.x).to.satisfy(Number.isFinite)
          expect(probe.agentFootPoint.y).to.satisfy(Number.isFinite)
          expect(probe.alphaAabbIntersection).to.equal(intersectsHalfOpen(probe.propAlphaAabbWorld, probe.agentAlphaAabbWorld))
          expect(probe.pixelOverlap).to.equal(probe.alphaAabbIntersection)
          if (direction === 'north') expect(probe.expectedRelation).to.equal('agent<prop')
          if (direction === 'south') expect(probe.expectedRelation).to.equal('prop<agent')
        }
      }
    })

    it('derives W/E zero-overlap from alpha AABBs with at least a 4px guard', () => {
      for (const prop of spec.props) {
        for (const direction of ['west', 'east']) {
          const probe = prop.probes[direction]
          expect(probe.expectedRelation).to.equal('non-overlap')
          expect(probe.alphaAabbIntersection).to.be.false
          const gap = horizontalGap(probe.propAlphaAabbWorld, probe.agentAlphaAabbWorld, direction)
          expect(gap).to.be.at.least(4)
          expect(probe.horizontalGuardPixels).to.equal(gap)
        }
      }
    })
  })

  describe('bounty-board 14-cell contract and tie semantics', () => {
    const bounty = spec.props.find(prop => prop.tmxId === 92)
    const matrix = bounty.bountyBoardMatrix

    it('freezes direction and depth points exactly', () => {
      expect(matrix.matrixCells.north.agentFoot).to.deep.equal({ x: 1446, y: 351 })
      expect(matrix.matrixCells.south.agentFoot).to.deep.equal({ x: 1446, y: 420 })
      expect(matrix.behindBoundaryFront.behind.agentFoot).to.deep.equal({ x: 1446, y: 370 })
      expect(matrix.behindBoundaryFront.boundary.agentFoot).to.deep.equal({ x: 1446, y: 379 })
      expect(matrix.behindBoundaryFront.front.agentFoot).to.deep.equal({ x: 1446, y: 420 })
    })

    it('contains the full 8 direction-role and 6 depth-role cells with same-foot role invariance', () => {
      expect(spec.visualEvidence.bountyCells).to.have.length(14)
      for (const direction of DIRECTIONS) {
        const cells = BOUNTY_ROLES.map(role => spec.visualEvidence.bountyCells.find(cell => cell.cellId === `bounty-direction-${direction}-${role}`))
        expect(cells.every(Boolean)).to.be.true
        expect(cells[0].agentFootWorld).to.deep.equal(cells[1].agentFootWorld)
        expect(cells[0].expectedRelation).to.equal(cells[1].expectedRelation)
      }
      for (const position of ['behind', 'boundary', 'front']) {
        const cells = BOUNTY_ROLES.map(role => spec.visualEvidence.bountyCells.find(cell => cell.cellId === `bounty-depth-${position}-${role}`))
        expect(cells.every(Boolean)).to.be.true
        expect(cells[0].agentFootWorld).to.deep.equal(cells[1].agentFootWorld)
        expect(cells[0].expectedRelation).to.equal(cells[1].expectedRelation)
      }
    })

    it('asserts behind agent<prop, boundary/front prop<agent for both roles', () => {
      for (const role of BOUNTY_ROLES) {
        expect(matrix.behindBoundaryFront.behind.expectedByRole[role]).to.equal('agent<prop')
        expect(matrix.behindBoundaryFront.boundary.expectedByRole[role]).to.equal('prop<agent')
        expect(matrix.behindBoundaryFront.front.expectedByRole[role]).to.equal('prop<agent')
      }
    })

    it('proves boundary table(-4)<agent(0) independently of stableId using E5 comparator', () => {
      const table = worldSortKey(bounty.stableId, bounty.fixedPointY, -4)
      for (const stableId of ['jyt.agent.evidence.aaa.v1', 'jyt.agent.evidence.zzz.v1']) {
        const agent = worldSortKey(stableId, bounty.fixedPointY, 0)
        expect(compareWorldSortKeys(table, agent)).to.equal(-1)
      }
    })

    it('keeps drawable, mask geometry, canonical occluder pixels, and hotspot separate', () => {
      expect(matrix.mask58CrossReference.maskId).to.equal(58)
      expect(matrix.mask58CrossReference.action).to.equal('E10A_REQUIRED_REVIEW')
      expect(matrix.mask58CrossReference.distinction).to.include('Drawable')
      expect(matrix.mask58CrossReference.distinction).to.include('hotspot')
    })
  })

  describe('actual visual evidence and deterministic generation', () => {
    it('commits exactly 20+14 complete actual-render evidence cells', () => {
      const visual = spec.visualEvidence
      expect(visual.verdictAddressed).to.equal('REJECT-V1')
      expect(visual.propCellCount).to.equal(20)
      expect(visual.bountyCellCount).to.equal(14)
      expect(visual.totalCellCount).to.equal(34)
      expect(visual.propCells).to.have.length(20)
      expect(visual.bountyCells).to.have.length(14)
      for (const cell of [...visual.propCells, ...visual.bountyCells]) {
        expect(cell.commit).to.equal(BASE_COMMIT)
        expect(cell.tmxSha256).to.equal(spec.tmxSource.sha256)
        expect(cell.cameraZoom).to.equal(1)
        expect(cell.cameraDpr).to.equal(1)
        expect(cell.captureMode).to.equal('clean')
        expect(cell.propSortKey).to.include.all.keys('renderBandOrder', 'floorOrder', 'elevation', 'fixedPointY', 'tieBias', 'stableId')
        expect(cell.agentSortKey).to.include.all.keys('renderBandOrder', 'floorOrder', 'elevation', 'fixedPointY', 'tieBias', 'stableId')
        expect(cell.painterOrder).to.have.length(2)
      }
    })

    it('has a self-contained SVG with 34 clean image areas and matching generationId', () => {
      const svg = readFileSync(SVG_PATH, 'utf8')
      expect(svg.match(/class="evidence-cell"/g)).to.have.length(34)
      expect(svg.match(/class="clean-image-area"/g)).to.have.length(34)
      expect(svg).to.include(`data-generation-id="${spec.generationId}"`)
      expect(svg).to.include('data:image/webp;base64,')
      expect(svg).to.include('data:image/png;base64,')
      for (const match of svg.matchAll(/<svg class="clean-image-area"[\s\S]*?<\/svg>/g)) {
        expect(match[0]).to.not.match(/<text|label|bubble|debug/i)
      }
    })

    it('recomputes the full 64-hex provisional-zero generationId', () => {
      expect(spec.generationId).to.match(/^[0-9a-f]{64}$/)
      const clone = cloneSpec()
      const saved = clone.generationId
      clone.generationId = ZERO_GENERATION_ID
      expect(createHash('sha256').update(stableJson(clone)).digest('hex')).to.equal(saved)
      expect(spec).to.not.have.property('generatedAt')
      expect(spec.generatedBy.command).to.equal('npm run generate:juyiting-prop-sort-spec')
    })

    it('runs the accepted E8A generator twice with byte-identical outputs matching committed evidence', function () {
      this.timeout(120000)
      withAcceptedGeneratorOutputs(outputs => {
        expect(readFileSync(outputs[0].spec).equals(readFileSync(outputs[1].spec))).to.be.true
        expect(readFileSync(outputs[0].svg).equals(readFileSync(outputs[1].svg))).to.be.true
        expect(readFileSync(outputs[0].spec).equals(readFileSync(SPEC_PATH))).to.be.true
        expect(readFileSync(outputs[0].svg).equals(readFileSync(SVG_PATH))).to.be.true
      })
    })

    it('passes the standalone verifier on committed outputs', () => {
      const result = runVerifier()
      expect(result.status, result.output).to.equal(0)
    })
  })

  describe('mutation-based fail-closed verification', () => {
    const cases = [
      ['prop count', s => { s.propCount = 4 }, 'exactly five props required'],
      ['duplicate stableId', s => { s.props[1].stableId = s.props[0].stableId }, 'duplicate stableId'],
      ['roster anchor', s => { s.props.find(p => p.tmxId === 94).sortAnchor.y = 383 }, 'frozen sortAnchor'],
      ['fixed point', s => { s.props[0].fixedPointY++ }, 'fixedPointY mismatch'],
      ['asset hash', s => { s.props[0].asset.sha256 = '0'.repeat(64) }, 'asset sha256 mismatch'],
      ['anchor evidence row', s => { s.props[0].sortAnchorEvidence.sampledRows[0].count++ }, 'sampled alpha row'],
      ['missing west probe', s => { delete s.props[0].probes.west }, 'probe missing'],
      ['W/E footpoint', s => { s.props[0].probes.west.agentFootPoint.x += 10 }, 'frozen footpoint'],
      ['W/E recorded AABB', s => { s.props[0].probes.east.agentAlphaAabbWorld.minX++ }, 'agent alpha AABB'],
      ['role asset hash', s => { s.visualEvidence.roles.lujunyi.asset.sha256 = 'f'.repeat(64) }, 'role asset path/hash mismatch'],
      ['role frame alpha AABB', s => { s.visualEvidence.roles.husanniang.sourceFrameAlphaAabb.minX++ }, 'decoded frame alpha AABB'],
      ['prop cell count', s => { s.visualEvidence.propCells.pop() }, 'prop evidence cell count must be 20'],
      ['bounty cell count', s => { s.visualEvidence.bountyCells.pop() }, 'bounty evidence cell count must be 14'],
      ['evidence metadata', s => { delete s.visualEvidence.propCells[0].cameraZoom }, 'required metadata cameraZoom missing'],
      ['evidence role hash', s => { s.visualEvidence.propCells[0].roleAssetSha256 = '0'.repeat(64) }, 'role/frame asset metadata mismatch'],
      ['evidence AABB', s => { s.visualEvidence.propCells[0].agentAlphaAabbWorld.maxX++ }, 'agent alpha AABB'],
      ['evidence painter order', s => { s.visualEvidence.propCells[0].painterOrder.reverse() }, 'painter order'],
      ['bounty north point', s => { s.props.find(p => p.tmxId === 92).bountyBoardMatrix.matrixCells.north.agentFoot.y = 350 }, 'bounty matrix north foot'],
      ['bounty boundary role expectation', s => { s.props.find(p => p.tmxId === 92).bountyBoardMatrix.behindBoundaryFront.boundary.expectedByRole.husanniang = 'agent<prop' }, 'bounty depth boundary/husanniang expectation'],
      ['bounty role same-foot evidence', s => { s.visualEvidence.bountyCells.find(c => c.cellId === 'bounty-direction-north-husanniang').agentFootWorld.x++ }, 'bounty-direction-north-husanniang: footpoint'],
      ['mask 58 cross-reference', s => { delete s.props.find(p => p.tmxId === 92).bountyBoardMatrix.mask58CrossReference }, 'mask 58 E10A cross-reference missing']
    ]
    for (const [name, mutate, marker] of cases) {
      it(`rejects resigned ${name} mutation for the semantic reason`, () => {
        expectRejected(runMutatedSpec(mutate), marker)
      })
    }

    it('rejects an invalid generationId before semantic trust', () => {
      const dir = tempWorkspace('e8a-generation-id-')
      try {
        const path = join(dir, 'spec.json')
        const value = cloneSpec()
        value.generationId = '0'.repeat(64)
        writeFileSync(path, `${stableJson(value)}\n`)
        expectRejected(runVerifier({ specPath: path }), 'generationId mismatch')
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })

    const tmxCases = [
      ['object name', xml => xml.replace('name="main-seat-rect"', 'name="wrong-main-seat"'), 'TMX object name/type mismatch'],
      ['object rect', xml => xml.replace('x="818" y="175" width="109" height="93"', 'x="819" y="175" width="109" height="93"'), 'TMX rect'],
      ['object gid', xml => xml.replace('gid="6033" x="818"', 'gid="6034" x="818"'), 'gid→tileset→tile→image binding'],
      ['tileset image source', xml => xml.replace('source="images/props/liangshan-hall-prop-main-seat-cropped.png"', 'source="images/props/liangshan-hall-prop-agent-roster-cropped.png"'), 'asset path'],
      ['tileset image dimensions', xml => xml.replace('width="109" height="93"', 'width="110" height="93"'), 'tile image dimensions mismatch'],
      ['map dimensions', xml => xml.replace('width="104" height="58"', 'width="105" height="58"'), 'TMX positive map dimensions']
    ]
    for (const [name, mutate, marker] of tmxCases) {
      it(`rejects injected TMX ${name} mutation structurally`, () => {
        const tmp = mutateTmx(mutate)
        try { expectRejected(runVerifier({ tmxPath: tmp.path }), marker) }
        finally { rmSync(tmp.dir, { recursive: true, force: true }) }
      })
    }

    it('rejects contact-sheet/spec generationId mismatch via an isolated root-attribute mutation', () => {
      const dir = tempWorkspace('e8a-svg-id-')
      try {
        const path = join(dir, 'sheet.svg')
        const original = readFileSync(SVG_PATH, 'utf8')
        const expectedAttribute = `data-generation-id="${spec.generationId}"`
        const mutatedId = spec.generationId === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64)
        expect(original.split(expectedAttribute)).to.have.length(2)
        const mutated = original.replace(expectedAttribute, `data-generation-id="${mutatedId}"`)
        expect(mutated).to.not.equal(original)
        writeFileSync(path, mutated)
        const result = runVerifier({ svgPath: path })
        expectRejected(result, 'contact sheet/spec generationId mismatch')
        expect(readFileSync(path, 'utf8')).to.include(`data-generation-id="${mutatedId}"`)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })

    it('rejects contact-sheet evidence-cell count/ID mutation via injectable SVG', () => {
      const dir = tempWorkspace('e8a-svg-cell-')
      try {
        const path = join(dir, 'sheet.svg')
        const original = readFileSync(SVG_PATH, 'utf8')
        const evidenceCell = '<g class="evidence-cell" data-evidence-cell-id="prop-main-seat-north-lujunyi"'
        expect(original.split(evidenceCell)).to.have.length(2)
        const mutated = original.replace(evidenceCell, '<g class="evidence-cell-mutated" data-evidence-cell-id="prop-main-seat-north-lujunyi"')
        expect(mutated).to.not.equal(original)
        writeFileSync(path, mutated)
        expect(readFileSync(path, 'utf8')).to.include('class="evidence-cell-mutated" data-evidence-cell-id="prop-main-seat-north-lujunyi"')
        expectRejected(runVerifier({ svgPath: path }), 'contact sheet evidence cell groups 33')
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })
  })

  describe('E8B provenance overlay', () => {
    const LIVE_TMX_PATH = join(REPO_ROOT, 'public/juyiting/hall.tmx')

    it('E8A verifier (default, no --tmx) PASSES by reading historical TMX from baseCommit Git blob', () => {
      const result = runVerifier()
      expect(result.status, result.output).to.equal(0)
      expect(result.output).to.include('baseCommit')
      expect(result.output).to.not.include('explicit --tmx')
      expect(result.output).to.include('ALL VERIFICATIONS PASSED')
    })

    it('E8A verifier with --tmx on live migrated TMX FAILS with hash mismatch', () => {
      const result = runVerifier({ tmxPath: LIVE_TMX_PATH })
      expect(result.status, result.output).to.not.equal(0)
      expect(result.output).to.include('explicit --tmx')
      expect(result.output).to.include('TMX sha256 mismatch')
      expect(result.output).to.include(E8B_LIVE_TMX_SHA256)
      expect(result.output).to.include(E1_BASELINE_TMX_SHA256)
      expect(result.output).to.include('VERIFICATION FAILURE')
    })

    it('E8A verifier with --tmx on E1 historical TMX blob PASSES', function () {
      this.timeout(15000)
      const dir = tempWorkspace('e8a-historical-tmx-')
      try {
        const tmxPath = join(dir, 'hall.tmx')
        const tmxBytes = readGitBlobAtCommit(spec.baseCommit, 'public/juyiting/hall.tmx')
        writeFileSync(tmxPath, tmxBytes)
        const sha256 = createHash('sha256').update(tmxBytes).digest('hex')
        expect(sha256).to.equal(spec.tmxSource.sha256)
        expect(sha256).to.equal(E1_BASELINE_TMX_SHA256)

        const result = runVerifier({ tmxPath })
        expect(result.status, result.output).to.equal(0)
        expect(result.output).to.include('explicit --tmx')
        expect(result.output).to.include('ALL VERIFICATIONS PASSED')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

  })

})
