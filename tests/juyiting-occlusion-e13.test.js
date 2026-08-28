/**
 * E13 evidence integrity tests — verifies the committed world-model.json,
 * shot-plan.json, and the offline pixel renderer evidence.
 *
 * The full 289-shot plan (270 matrix + 10 camera + 7 interaction + 2 movement)
 * remains the canonical definition. The offline pixel renderer generates the
 * 270 matrix shots remain independent from the 19 real Chromium shots.
 * Both evidence sets are release-bound; release_guard remains a separate E18 gate.
 *
 * Verifies (no browser needed):
 *  - world-model.json / shot-plan.json integrity (counts, provenance)
 *  - index.json binds 270 matrix shots with runtime facts
 *  - GENERATED_OFFLINE status (not BLOCKED)
 *  - 270 PNG contact sheets exist
 *  - the machine gate (validate-e13-evidence.mjs) passes end-to-end
 */
import { expect } from 'chai'
import { spawnSyncCaptured } from '../scripts/juyiting/lib/spawn-capture.mjs'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  loadSourceFacts,
  validateTargetsAgainstTmx,
  validateShotPlan,
  REGIONS,
  PERSONAS,
  RELATIONS,
} from '../scripts/juyiting/e13/lib/world-model.mjs'

const REPO_ROOT = process.cwd()
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-e13')
const CONTACT_DIR = join(FIXTURE_DIR, 'contact-sheets')
const SHOTS_DIR = join(FIXTURE_DIR, 'shots')
const GATE_SCRIPT = join(REPO_ROOT, 'scripts/juyiting/e13/validate-e13-evidence.mjs')
const LIVE_DIR = join(FIXTURE_DIR, 'live')

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

describe('E13 evidence integrity (phase-1 + offline)', () => {
  let worldModel
  let shotPlan
  let index
  let matrixShots

  before(() => {
    expect(existsSync(join(FIXTURE_DIR, 'world-model.json'))).to.equal(true)
    expect(existsSync(join(FIXTURE_DIR, 'shot-plan.json'))).to.equal(true)
    worldModel = readJson(join(FIXTURE_DIR, 'world-model.json'))
    shotPlan = readJson(join(FIXTURE_DIR, 'shot-plan.json'))
    index = readJson(join(FIXTURE_DIR, 'index.json'))
    matrixShots = shotPlan.shots.filter(shot => shot.kind === 'matrix')
  })

  it('world model has the six personas, 九宫 cells, relations and 15 targets', () => {
    expect(worldModel.personas.map(p => p.personaCode).sort()).to.deep.equal(
      ['husanniang', 'likui', 'linchong', 'lujunyi', 'songjiang', 'wuyong'].sort(),
    )
    expect(worldModel.regions).to.have.length(9)
    expect(Object.keys(worldModel.relations)).to.deep.equal(['behind', 'boundary', 'front'])
    expect(worldModel.targets).to.have.length(15)
    expect(new Set(worldModel.targets.map(t => t.stableId)).size).to.equal(15)
  })

  it('shot plan has exactly 289 shots (270 matrix + 10 camera + 7 interaction + 2 movement)', () => {
    expect(shotPlan.shotCount).to.equal(289)
    expect(shotPlan.shots).to.have.length(289)
    const byKind = { matrix: 0, camera: 0, interaction: 0, movement: 0 }
    for (const shot of shotPlan.shots) byKind[shot.kind] += 1
    expect(byKind).to.deep.equal({ matrix: 270, camera: 10, interaction: 7, movement: 2 })
    const ids = shotPlan.shots.map(s => s.id)
    expect(new Set(ids).size).to.equal(289)
    expect(ids[0]).to.equal('E13-001')
    expect(ids[288]).to.equal('E13-289')
  })

  it('matrix covers every 九宫 cell × persona × relation and is anchored to the live TMX', () => {
    const facts = loadSourceFacts()
    expect(validateTargetsAgainstTmx(facts, worldModel.targets)).to.deep.equal([])
    expect(validateShotPlan(shotPlan.shots, facts)).to.deep.equal([])
    const keys = new Set(matrixShots.map(s => `${s.cell}|${s.persona}|${s.relation}`))
    for (const region of REGIONS) {
      for (const persona of PERSONAS) {
        for (const relation of Object.keys(RELATIONS)) {
          expect(keys.has(`${region.id}|${persona.personaCode}|${relation}`),
            `missing ${region.id}/${persona.personaCode}/${relation}`).to.equal(true)
        }
      }
    }
  })

  it('marks visual matrix probes as synthetic while retaining production navigation diagnostics', () => {
    expect(matrixShots.every(shot => shot.probeMobility === 'synthetic-visual-only')).to.equal(true)
    matrixShots.forEach(shot => {
      expect(shot.navValidation.reachability, shot.id).to.include({ source: 'production-graph-pathfinder', colliderWidth: 42 })
      expect(['found', 'blocked'], shot.id).to.include(shot.navValidation.reachability.status)
      if (shot.navValidation.reachability.status === 'blocked') expect(shot.navValidation.reachability.reason, shot.id).to.be.a('string').and.not.empty
    })
    const custom = matrixShots.filter(shot => shot.probeKind === 'target-specific')
    expect(custom).to.have.length(162)
    expect(matrixShots.filter(shot => shot.visualExerciseContract === 'depth-order-only')).to.have.length(108)
    expect(new Set(custom.map(shot => shot.targetStableId))).to.deep.equal(new Set([
      'jyt.occ.west-upper.lantern-01.v2',
      'jyt.prop.center-north.main-seat.v1',
      'jyt.prop.northeast.bounty-board.v1',
      'jyt.occ.east-upper.pillar-01.v2',
      'jyt.prop.southeast.library-shelf.v1',
      'jyt.occ.east-upper.scroll-table-front-01.v2',
      'jyt.occ.east-upper.pillar-02.v2',
      'jyt.occ.entrance.lantern-post-01.v2',
      'jyt.occ.east-lower.worktable-01.v2',
    ]))
  })

  it('keeps real movement probes on an explicit production-only contract', () => {
    const movement = shotPlan.shots.filter(shot => shot.kind === 'movement')
    expect(movement).to.have.length(2)
    expect(movement.map(shot => ({ mobility: shot.probeMobility, ...shot.movementContract }))).to.deep.equal([
      { mobility: 'production-movement', actorPersonaCode: 'lujunyi', startRegionId: 'council-table', targetRegionId: 'bounty-board' },
      { mobility: 'production-movement', actorPersonaCode: 'likui', startRegionId: 'right-guard', targetRegionId: 'gate' },
    ])
  })

  it('drives live movement capture and validation from movementContract rather than shot-id hardcoding', () => {
    const generator = readFileSync(join(REPO_ROOT, 'scripts/juyiting/e13/generate-e13-evidence.mjs'), 'utf8')
    const validator = readFileSync(join(REPO_ROOT, 'scripts/juyiting/e13/validate-e13-live-evidence.mjs'), 'utf8')
    expect(generator).to.include('shot.movementContract?.actorPersonaCode')
    expect(generator).to.include('const { actorPersonaCode: actor, startRegionId, targetRegionId } = movementContract')
    expect(validator).to.include('const contract = planShot?.movementContract')
    expect(validator).to.not.include('const MOVEMENT_ACTOR')
    expect(validator).to.not.include("id === 'E13-288' ? 'bounty-board' : 'gate'")
  })

  it('fails closed when matrix or movement mobility contracts are relabeled', function () {
    this.timeout(15000)
    const facts = loadSourceFacts()
    const matrixRelabel = structuredClone(shotPlan.shots)
    const blockedMatrix = matrixRelabel.find(shot => shot.kind === 'matrix' && shot.navValidation.reachability.status === 'blocked')
    blockedMatrix.probeMobility = 'production-reachable'
    expect(validateShotPlan(matrixRelabel, facts).some(error => error.includes('matrix probe must use synthetic-visual-only mobility'))).to.equal(true)

    const movementRelabel = structuredClone(shotPlan.shots)
    movementRelabel.find(shot => shot.kind === 'movement').probeMobility = 'synthetic-visual-only'
    expect(validateShotPlan(movementRelabel, facts).some(error => error.includes('movement probe must use production-movement mobility'))).to.equal(true)
  })

  it('binds all E13 source hashes to the current production inputs', () => {
    const facts = loadSourceFacts()
    expect(worldModel.provenance.tmxSha256).to.equal(facts.tmxSha256)
    expect(worldModel.provenance.fragmentSpecSha256).to.equal(facts.specSha256)
    expect(worldModel.provenance.hallMapSnapshotSha256).to.equal(facts.snapshotSha256)
  })

  it('index binds the authoritative 270 matrix shots exactly', () => {
    expect(index.status).to.equal('GENERATED_OFFLINE')
    expect(index.matrixPass).to.equal(true)
    expect(index.releasePass).to.equal(false)
    expect(index.shots).to.have.length(270)
    const fields = ['id','kind','cell','probeCell','targetStableId','targetKind','focus','persona','personaName','relation','world','expectedRelation','expectedDepth','viewport','camera','evidenceContext','contextCompanionStableId','visualOmissions','probeKind','probeMobility','visualExerciseContract','visualOverlay','maxAgentOcclusionRatio','navValidation','probeRationale']
    matrixShots.forEach((plan, i) => fields.forEach(field => expect(index.shots[i][field], `${plan.id}:${field}`).to.deep.equal(plan[field])))
  })

  it('all matrix shots have 100% resolved depth matches and alpha facts', () => {
    for (const shot of index.shots) {
      expect(shot.screenshotFile).to.match(/^shots\/E13-\d{3}\.png$/)
      expect(shot.runtimeFacts.ordering).to.equal(shot.resolvedExpectedOrdering)
      expect(shot.runtimeFacts.depthMatch).to.equal(true)
      expect(shot.runtimeFacts.pixelOverlap.method).to.equal('source-alpha-intersection-plus-final-composite-difference')
    }
  })

  it('keeps browser-only scopes separate in the offline index and release-binds 19 real Chromium shots', () => {
    expect(index.cameraShots).to.equal(0)
    expect(index.interactionShots).to.equal(0)
    expect(index.movementShots).to.equal(0)
    for (const key of ['camera', 'interaction', 'movement']) expect(index.notes[key]).to.include('DEFERRED')
    const live = readJson(join(LIVE_DIR, 'index.json'))
    const validation = readJson(join(LIVE_DIR, 'validation.json'))
    const visual = readJson(join(LIVE_DIR, 'visual-review.json'))
    expect(live).to.include({ status: 'MERGED', shotCount: 19, cameraShots: 10, interactionShots: 7, movementShots: 2 })
    expect(validation).to.include({ pass: true, shotCount: 19, cameraShots: 10, interactionShots: 7, movementShots: 2 })
    expect(validation.passedChecks).to.equal(validation.totalChecks)
    expect(visual).to.include({ pass: true, verdict: 'PASS', highestSeverity: 'S0' })
    expect(visual.scope).to.include({ liveShotsReviewed: 19, movementFramesReviewed: 6 })
  })

  it('commits 270 shot PNGs and 15 contact sheets', () => {
    expect(readdirSync(SHOTS_DIR).filter(f => f.endsWith('.png'))).to.have.length(270)
    expect(readdirSync(CONTACT_DIR).filter(f => f.endsWith('.png'))).to.have.length(15)
  })

  it('machine gate passes matrix and live Chromium evidence but keeps E18 release_guard pending', function () {
    // The independent 270-shot pixel recompute has measured around 38 seconds.
    // Keep this exception local: 120 seconds covers normal host variance, while
    // the matching subprocess deadline still kills a genuine stalled validator.
    this.timeout(120000)
    const result = spawnSyncCaptured(process.execPath, ['--import', 'tsx', GATE_SCRIPT, '--reviewed-evidence-dir', FIXTURE_DIR], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 })
    expect(result.status, result.stderr).to.equal(0)
    const gate = readJson(join(FIXTURE_DIR, 'machines-gate.json'))
    expect(gate.matrixPass).to.equal(true)
    expect(gate.totalChecks).to.equal(gate.passedChecks)
    expect(gate.livePass).to.equal(true)
    expect(gate.evidencePass).to.equal(true)
    expect(gate.releasePass).to.equal(false)
    expect(gate.pass).to.equal(false)
    expect(gate.checks.find(check => check.check.includes('GPT V5 rejection'))?.ok).to.equal(true)
    expect(gate.checks.find(check => check.check.includes('GPT V6 full visual audit'))?.ok).to.equal(true)
    expect(gate.checks.find(check => check.check.includes('37/37 mask'))?.ok).to.equal(true)
    expect(gate.releaseBlockers).to.not.include('GPT V5 visual review REJECT/P1; rebuilt evidence requires V6 PASS')
    expect(gate.releaseBlockers).to.deep.equal(['independent release_guard pending'])
  })
})

describe('E13 mask→structure mapping verifier — independent derived-field checks (P2-A)', () => {
  const MAPPING_DIR = join(FIXTURE_DIR, 'mask-structure-mapping')
  const MAPPING_PATH = join(MAPPING_DIR, 'mask-structure-mapping.json')
  const VERIFIER_SCRIPT = join(REPO_ROOT, 'scripts/juyiting/e13/verify-mask-structure-mapping.mjs')

  // Every derived field the mapping carries must be independently recomputed by
  // the verifier; tampering any of them must flip the verifier to non-zero failure.
  const MUTATIONS = [
    {
      name: 'maskBoundary.aabb',
      check: 'every derived maskBoundary/ownerBoundary/ownerOverlapEvidence fact re-derives from source data',
      label: '48:mask-aabb',
      mutate: (e) => { e.maskBoundary.aabb.minX += 1 },
    },
    {
      name: 'maskBoundary.centroid',
      check: 'every derived maskBoundary/ownerBoundary/ownerOverlapEvidence fact re-derives from source data',
      label: '48:centroid',
      mutate: (e) => { e.maskBoundary.centroid.x += 1 },
    },
    {
      name: 'ownerOverlapEvidence.ownedPixelsInLegacyPolygon',
      check: 'every derived maskBoundary/ownerBoundary/ownerOverlapEvidence fact re-derives from source data',
      label: '48:ownedPixels',
      mutate: (e) => { e.ownerOverlapEvidence.ownedPixelsInLegacyPolygon += 1 },
    },
    {
      name: 'ownerOverlapEvidence.targetOwnedOpaquePixelCount',
      check: 'every derived maskBoundary/ownerBoundary/ownerOverlapEvidence fact re-derives from source data',
      label: '48:targetOwned',
      mutate: (e) => { e.ownerOverlapEvidence.targetOwnedOpaquePixelCount += 1 },
    },
    {
      name: 'ownerOverlapEvidence.actualOwnerCount',
      check: 'every derived maskBoundary/ownerBoundary/ownerOverlapEvidence fact re-derives from source data',
      label: '48:ownerCount',
      mutate: (e) => { e.ownerOverlapEvidence.actualOwnerCount += 1 },
    },
    {
      name: 'ownerOverlapEvidence.polygonToOwnerPixelDistance',
      check: 'every derived maskBoundary/ownerBoundary/ownerOverlapEvidence fact re-derives from source data',
      label: '48:distance',
      mutate: (e) => { e.ownerOverlapEvidence.polygonToOwnerPixelDistance = 5 },
    },
  ]

  let runVerify
  let sources

  before(async () => {
    const mod = await import('../scripts/juyiting/e13/verify-mask-structure-mapping.mjs')
    runVerify = mod.runVerify
    sources = {
      svg: readFileSync(join(MAPPING_DIR, 'mask-structure-mapping.svg'), 'utf8'),
      ledger: readJson(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json')),
      manifest: readJson(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-masks/mask-tmx-manifest.json')),
      fragSpec: readJson(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json')),
      tmxBytes: readFileSync(join(REPO_ROOT, 'public/juyiting/hall.tmx')),
    }
  })

  const committedMapping = () => readJson(MAPPING_PATH)
  const verifyWith = (mapping) => runVerify({ mapping, ...sources })
  const tamperCopy = (mutate) => {
    const mapping = structuredClone(committedMapping())
    mutate(mapping.entries.find((e) => e.tmxId === 48))
    return mapping
  }

  it('committed manifest passes every independent derived-field check', () => {
    const report = verifyWith(committedMapping())
    expect(report.pass).to.equal(true)
    expect(report.totalChecks).to.equal(16)
    for (const mutation of MUTATIONS) {
      expect(report.failures.some((f) => f.check === mutation.check), mutation.check).to.equal(false)
    }
  })

  for (const mutation of MUTATIONS) {
    it(`rejects tampered ${mutation.name} (runVerify pass=false)`, () => {
      const report = verifyWith(tamperCopy(mutation.mutate))
      expect(report.pass).to.equal(false)
      const failing = report.failures.find((f) => f.check === mutation.check)
      expect(failing, `missing failing check '${mutation.check}'`).to.exist
      expect(failing.detail).to.include(mutation.label)
    })

    it(`CLI exits non-zero when ${mutation.name} is tampered`, function () {
      this.timeout(120000)
      const dir = mkdtempSync(join(tmpdir(), 'cyf-e13-mask-map-verify-'))
      try {
        copyFileSync(MAPPING_PATH, join(dir, 'mask-structure-mapping.json'))
        copyFileSync(join(MAPPING_DIR, 'mask-structure-mapping.svg'), join(dir, 'mask-structure-mapping.svg'))
        const mapping = readJson(join(dir, 'mask-structure-mapping.json'))
        mutation.mutate(mapping.entries.find((e) => e.tmxId === 48))
        writeFileSync(join(dir, 'mask-structure-mapping.json'), `${JSON.stringify(mapping, null, 2)}\n`)
        const result = spawnSyncCaptured(process.execPath, [VERIFIER_SCRIPT], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          timeout: 120000,
          env: { ...process.env, E13_MASK_STRUCTURE_MAPPING_DIR: dir },
        })
        expect(result.status, `${mutation.name} stderr: ${result.stderr}`).to.not.equal(0)
        const report = readJson(join(dir, 'mask-structure-mapping.verify.json'))
        expect(report.pass, mutation.name).to.equal(false)
        const failing = report.failures.find((f) => f.check === mutation.check)
        expect(failing, mutation.name).to.exist
        expect(failing.detail).to.include(mutation.label)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
