/**
 * E13 directed tests: committed visual-review evidence is complete & honest.
 *
 * Verifies (no browser needed):
 *  - world-model.json / shot-plan.json integrity (counts, provenance)
 *  - index.json binds every planned shot to id/world/persona/target/expected relation
 *  - contact sheets exist, are well-formed, and partition the matrix shots by cell
 *  - blocked-status honesty: runtime-blocked.json ⇒ screenshotsGenerated=0, no PNGs
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

describe('E13 visual-review evidence (phase 1)', () => {
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

  it('index.json binds every planned shot and carries world/persona/target/expected for matrix shots', () => {
    expect(index.shotCount).to.equal(289)
    expect(index.shots).to.have.length(289)
    const indexIds = new Set(index.shots.map(s => s.id))
    for (const shot of shotPlan.shots) expect(indexIds.has(shot.id), `missing ${shot.id} in index`).to.equal(true)
    for (const shot of index.shots) {
      if (shot.kind !== 'matrix') continue
      expect(shot.world).to.be.an('object')
      expect(Number.isFinite(shot.world.x)).to.equal(true)
      expect(Number.isFinite(shot.world.y)).to.equal(true)
      expect(shot.persona).to.be.a('string')
      expect(shot.targetStableId).to.be.a('string')
      expect(shot.expectedRelation).to.be.a('string')
    }
  })

  it('blocked status is honest: no fabricated screenshots, runtime facts null', () => {
    const blockedPath = join(FIXTURE_DIR, 'runtime-blocked.json')
    const probesPath = join(FIXTURE_DIR, 'runtime-env-probes.json')
    if (existsSync(blockedPath)) {
      const blocked = readJson(blockedPath)
      expect(blocked.screenshotsGenerated).to.equal(0)
      expect(index.status).to.equal('BLOCKED')
      expect(index.screenshotsGenerated).to.equal(0)
      const pngs = existsSync(SHOTS_DIR) ? readdirSync(SHOTS_DIR).filter(f => f.endsWith('.png')) : []
      expect(pngs).to.deep.equal([])
      for (const shot of index.shots) {
        expect(shot.runtimeFacts).to.equal(null)
        expect(shot.screenshot.exists).to.equal(false)
      }
      expect(existsSync(probesPath)).to.equal(true)
      const probes = readJson(probesPath)
      expect(probes.summary.conclusion).to.be.a('string')
      expect(probes.summary.conclusion.length).to.be.above(0)
    } else {
      expect(index.status).to.equal('GENERATED')
    }
  })

  it('contact sheets exist, are well-formed and partition the matrix shots per cell', () => {
    expect(existsSync(CONTACT_DIR)).to.equal(true)
    const expectedFiles = ['overview.svg', 'focus-targets.svg', ...REGIONS.map(r => `cell-${r.id}.svg`)]
    for (const file of expectedFiles) {
      expect(existsSync(join(CONTACT_DIR, file)), `missing ${file}`).to.equal(true)
    }
    const byCell = new Map()
    for (const shot of matrixShots) {
      if (!byCell.has(shot.cell)) byCell.set(shot.cell, [])
      byCell.get(shot.cell).push(shot.id)
    }
    for (const region of REGIONS) {
      const content = readFileSync(join(CONTACT_DIR, `cell-${region.id}.svg`), 'utf8')
      expect(content.trimStart().startsWith('<?xml')).to.equal(true)
      expect(content.trimEnd().endsWith('</svg>')).to.equal(true)
      const match = /data-shot-ids="([^"]*)"/.exec(content)
      expect(match, `cell-${region.id}.svg missing data-shot-ids`).to.not.equal(null)
      const ids = match[1].split(',')
      const expected = byCell.get(region.id)
      expect(ids.sort()).to.deep.equal([...expected].sort())
    }
  })

  it('machine gate passes end-to-end', () => {
    const result = spawnSync(process.execPath, [GATE_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    })
    expect(result.status, `gate exited ${result.status}: ${result.stdout}${result.stderr}`).to.equal(0)
    const gate = readJson(join(FIXTURE_DIR, 'machines-gate.json'))
    expect(gate.pass).to.equal(true)
    expect(gate.failures).to.deep.equal([])
  })
})
