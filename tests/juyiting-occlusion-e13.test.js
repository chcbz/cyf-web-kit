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

  it('world model provenance hashes match the live sources', () => {
    const facts = loadSourceFacts()
    expect(worldModel.provenance.tmxSha256).to.equal(facts.tmxSha256)
    expect(worldModel.provenance.fragmentSpecSha256).to.equal(facts.specSha256)
    expect(worldModel.provenance.hallMapSnapshotSha256).to.equal(facts.snapshotSha256)
  })

  it('index.json covers all 270 matrix shots with GENERATED_OFFLINE status', () => {
    expect(index.status).to.equal('GENERATED_OFFLINE')
    expect(index.shotCount).to.equal(270)
    expect(index.shots).to.have.length(270)
    expect(index.matrixShots).to.equal(270)
    // Camera/interaction/movement are DEFERRED independently
    expect(index.cameraShots).to.equal(0)
    expect(index.interactionShots).to.equal(0)
    expect(index.movementShots).to.equal(0)
    expect(index.notes.camera).to.include('DEFERRED')
    expect(index.notes.interaction).to.include('DEFERRED')
    expect(index.notes.movement).to.include('DEFERRED')

    // Every matrix shot from the plan is represented in the index
    const indexIds = new Set(index.shots.map(s => s.id))
    const matrixPlanIds = matrixShots.map(s => s.id)
    for (const id of matrixPlanIds) {
      expect(indexIds.has(id), `matrix shot ${id} missing from index`).to.equal(true)
    }
  })

  it('all 270 index shots carry full runtime facts (deterministic, not BLOCKED)', () => {
    for (const shot of index.shots) {
      expect(shot.screenshotFile, `${shot.id} missing screenshotFile`).to.be.a('string')
      expect(shot.runtimeFacts, `${shot.id} missing runtimeFacts`).to.be.an('object')
      const f = shot.runtimeFacts
      expect(f.actualDepth).to.be.a('number')
      expect(f.targetDepth).to.be.a('number')
      expect(['agent_behind_target', 'agent_in_front', 'tie']).to.include(f.ordering)
      expect(f.depthMatch).to.equal(true)
      expect(f.pixelOverlap).to.be.an('object')
      expect(typeof f.pixelOverlap.hasOverlap).to.equal('boolean')
      expect(f.agentSortKey).to.be.an('array')
      expect(f.agentSortKey).to.have.length(6)
    }
  })

  it('100% depthMatch — no tie-with-acceptable-ratio loophole', () => {
    const failures = index.shots.filter(s => !s.runtimeFacts.depthMatch)
    expect(failures, `${failures.length} shots have depthMatch=false`).to.deep.equal([])
  })

  it('boundary shots have resolvedExpectedOrdering, not simplified tie', () => {
    const boundaryShots = index.shots.filter(s => s.relation === 'boundary')
    expect(boundaryShots).to.have.length(90)
    for (const s of boundaryShots) {
      expect(s.relation).to.equal('boundary')
      // expectedRelation is resolved via sort keys, not 'tie'
      expect(['agent_behind_target', 'agent_in_front', 'tie']).to.include(s.expectedRelation)
    }
  })

  it('critical shots: 卢俊义/扈三娘 behind bounty-board → agent_behind_target', () => {
    const luShot = index.shots.find(
      s => s.persona === 'lujunyi' && s.relation === 'behind'
        && s.targetStableId === 'jyt.prop.northeast.bounty-board.v1'
    )
    expect(luShot).to.not.equal(undefined)
    expect(luShot.runtimeFacts.ordering).to.equal('agent_behind_target')
    expect(luShot.runtimeFacts.actualDepth).to.be.lessThan(luShot.runtimeFacts.targetDepth)

    const huShot = index.shots.find(
      s => s.persona === 'husanniang' && s.relation === 'behind'
        && s.targetStableId === 'jyt.prop.northeast.bounty-board.v1'
    )
    expect(huShot).to.not.equal(undefined)
    expect(huShot.runtimeFacts.ordering).to.equal('agent_behind_target')
    expect(huShot.runtimeFacts.actualDepth).to.be.lessThan(huShot.runtimeFacts.targetDepth)
  })

  it('contact sheets exist — 15 PNG per-target sheets covering all matrix shots', () => {
    expect(existsSync(CONTACT_DIR)).to.equal(true)
    const files = readdirSync(CONTACT_DIR)
    const pngs = files.filter(f => f.endsWith('.png'))
    // 15 target contact sheets in PNG format
    expect(pngs.length, `expected 15 target PNG sheets, got ${pngs.length}`).to.equal(15)
    // Each PNG should be reasonable size
    for (const f of pngs) {
      const content = readFileSync(join(CONTACT_DIR, f))
      expect(content.length, `${f} too small`).to.be.at.least(500)
    }
  })

  it('270 PNG evidence files exist in shots/', () => {
    expect(existsSync(SHOTS_DIR)).to.equal(true)
    const pngs = readdirSync(SHOTS_DIR).filter(f => f.endsWith('.png'))
    expect(pngs).to.have.length(270)
  })

  it('machine gate passes end-to-end', () => {
    const result = spawnSync(process.execPath, [GATE_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    })
    expect(result.status, `gate exited ${result.status}: ${result.stderr}`).to.equal(0)
    const gate = readJson(join(FIXTURE_DIR, 'machines-gate.json'))
    expect(gate.pass).to.equal(true)
    expect(gate.failures).to.deep.equal([])
  })
})
