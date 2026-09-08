import { expect } from 'chai'
import { before } from 'mocha'
import {
  buildShotPlan,
  loadSourceFacts,
  validateShotPlan
} from '../scripts/juyiting/e13/lib/world-model.mjs'

describe('E13 mobility contracts', () => {
  let facts
  let plan

  before(() => {
    facts = loadSourceFacts()
    plan = buildShotPlan(facts)
  })

  it('keeps synthetic matrix probes diagnostic-only and movement probes production-bound', () => {
    const matrix = plan.filter(shot => shot.kind === 'matrix')
    const movement = plan.filter(shot => shot.kind === 'movement')

    expect(matrix).to.have.length(270)
    expect(matrix.every(shot => shot.probeMobility === 'synthetic-visual-only')).to.equal(true)
    expect(matrix.filter(shot => shot.probeKind === 'target-specific')).to.have.length(162)
    expect(matrix.filter(shot => shot.visualExerciseContract === 'depth-order-only')).to.have.length(108)
    expect(matrix.every(shot => ['found', 'blocked'].includes(shot.navValidation.reachability.status))).to.equal(true)
    expect(movement.map(shot => ({ mobility: shot.probeMobility, ...shot.movementContract }))).to.deep.equal([
      { mobility: 'production-movement', actorPersonaCode: 'lujunyi', startRegionId: 'council-table', targetRegionId: 'bounty-board' },
      { mobility: 'production-movement', actorPersonaCode: 'likui', startRegionId: 'right-guard', targetRegionId: 'gate' }
    ])
    expect(validateShotPlan(plan, facts)).to.deep.equal([])
  })

  it('rejects matrix mobility relabeling', () => {
    const matrixRelabel = structuredClone(plan)
    matrixRelabel.find(shot => shot.kind === 'matrix').probeMobility = 'production-reachable'
    expect(validateShotPlan(matrixRelabel, facts)).to.include('E13-001: matrix probe must use synthetic-visual-only mobility')
  })

  it('rejects movement-contract relabeling', () => {
    const movementMutation = structuredClone(plan)
    movementMutation.find(shot => shot.kind === 'movement').movementContract.targetRegionId = 'gate'
    expect(validateShotPlan(movementMutation, facts)).to.include('E13-288: movementContract drift')
  })

  it('rejects uniform visual-exercise relabeling', () => {
    const visualMutation = structuredClone(plan)
    visualMutation.find(shot => shot.probeKind === 'uniform-anchor-offset').visualExerciseContract = 'target-each-shot'
    expect(validateShotPlan(visualMutation, facts)).to.include('E13-055: uniform probe must use depth-order-only visual exercise')
  })
})
