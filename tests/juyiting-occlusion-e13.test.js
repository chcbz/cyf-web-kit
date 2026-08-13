/**
 * E13 evidence integrity tests — verifies the committed world-model.json,
 * shot-plan.json, and the offline pixel renderer evidence.
 *
 * The full 289-shot plan (270 matrix + 10 camera + 7 interaction + 2 movement)
 * remains the canonical definition. The offline pixel renderer generates the
 * 270 matrix shots; camera/interaction/movement are DEFERRED independently
 * and are NOT counted in the occlusion matrix pass.
 *
 * Verifies (no browser needed):
 *  - world-model.json / shot-plan.json integrity (counts, provenance)
 *  - index.json binds 270 matrix shots with runtime facts
 *  - GENERATED_OFFLINE status (not BLOCKED)
 *  - 270 PNG contact sheets exist
 *  - the machine gate (validate-e13-evidence.mjs) passes end-to-end
 */
import { expect } from 'chai'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

  it('uses target-specific navigable probes for the three previously contaminated targets', () => {
    const custom = matrixShots.filter(shot => shot.probeKind === 'target-specific')
    expect(custom).to.have.length(54)
    custom.forEach(shot => expect(shot.navValidation.navigable, shot.id).to.equal(true))
    expect(new Set(custom.map(shot => shot.targetStableId))).to.deep.equal(new Set([
      'jyt.prop.northeast.bounty-board.v1',
      'jyt.occ.east-upper.scroll-table-front-01.v2',
      'jyt.occ.east-lower.worktable-01.v2',
    ]))
  })

  it('preserves the accepted E13 historical TMX anchor while other source hashes remain current', () => {
    const facts = loadSourceFacts()
    expect(worldModel.provenance.tmxSha256).to.equal('4f94e3a52da71369d9c29d96e0ac0ceb2126a1a441b6cd63911701957e1ed49b')
    expect(worldModel.provenance.tmxSha256).to.not.equal(facts.tmxSha256)
    expect(facts.tmxSha256).to.equal('885471a17ac080d4d766f3e86c69836bcac8ba66b9cab125a6ca3ac978d82d9f')
    expect(worldModel.provenance.fragmentSpecSha256).to.equal(facts.specSha256)
    expect(worldModel.provenance.hallMapSnapshotSha256).to.equal(facts.snapshotSha256)
  })

  it('index binds the authoritative 270 matrix shots exactly', () => {
    expect(index.status).to.equal('GENERATED_OFFLINE')
    expect(index.matrixPass).to.equal(true)
    expect(index.releasePass).to.equal(false)
    expect(index.shots).to.have.length(270)
    const fields = ['id','kind','cell','targetStableId','targetKind','focus','persona','personaName','relation','world','expectedRelation','expectedDepth','viewport','camera','evidenceContext','contextCompanionStableId','visualOmissions','probeKind','navValidation','probeRationale']
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

  it('camera/interaction/movement are deferred and block final release', () => {
    expect(index.cameraShots).to.equal(0)
    expect(index.interactionShots).to.equal(0)
    expect(index.movementShots).to.equal(0)
    expect(index.notes.camera).to.include('DEFERRED')
    expect(index.notes.interaction).to.include('DEFERRED')
    expect(index.notes.movement).to.include('DEFERRED')
    expect(index.releasePass).to.equal(false)
  })

  it('commits 270 shot PNGs and 15 contact sheets', () => {
    expect(readdirSync(SHOTS_DIR).filter(f => f.endsWith('.png'))).to.have.length(270)
    expect(readdirSync(CONTACT_DIR).filter(f => f.endsWith('.png'))).to.have.length(15)
  })

  it('machine gate passes the matrix but not final E13 release', () => {
    const result = spawnSync(process.execPath, [GATE_SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120000 })
    expect(result.status, result.stderr).to.equal(0)
    const gate = readJson(join(FIXTURE_DIR, 'machines-gate.json'))
    expect(gate.matrixPass).to.equal(true)
    expect(gate.releasePass).to.equal(false)
    expect(gate.pass).to.equal(false)
    expect(gate.checks.find(check => check.check.includes('incremental GPT V4'))?.ok).to.equal(true)
    expect(gate.releaseBlockers).to.include('technical cross-model review deferred to E17 because DeepSeek provider returned auth_unavailable')
  })
})
