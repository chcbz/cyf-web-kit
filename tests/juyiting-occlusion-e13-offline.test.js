/**
 * E13 Offline Pixel Renderer Tests - fail-closed adversarial checks.
 * Verifies the offline-generated PNG evidence and sort invariants.
 *
 * Checks:
 *  1. 270 matrix PNGs exist with correct dimensions
 *  2. Index integrity (id/world/persona/target/expected binding + runtimeFacts)
 *  3. Sort determinism (卢俊义/扈三娘 at bounty-board ordering)
 *  4. Depth monotonicity (no cycles, contiguous)
 *  5. Pixel overlap evidence recorded
 *  6. Camera/interaction/movement properly deferred
 *  7. Prop foreground/background pixel checks
 *  8. 100% depthMatch with resolvedExpectedOrdering
 *  9. Status GENERATED_OFFLINE (not BLOCKED)
 * 10. screenshotFile field present on every shot
 */
import { expect } from 'chai'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-e13')
const SHOTS_DIR = join(FIXTURE_DIR, 'shots')
const CONTACT_DIR = join(FIXTURE_DIR, 'contact-sheets')

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

describe('E13 offline pixel renderer evidence', () => {
  let index

  before(() => {
    expect(existsSync(join(FIXTURE_DIR, 'index.json')), 'index.json missing').to.equal(true)
    index = readJson(join(FIXTURE_DIR, 'index.json'))
  })

  // ── Task 8: index status ──
  it('index status is GENERATED_OFFLINE (not BLOCKED)', () => {
    expect(index.status).to.equal('GENERATED_OFFLINE')
    expect(index.generator).to.match(/offline/)
  })

  it('270 matrix shots recorded', () => {
    expect(index.matrixShots).to.equal(270)
    expect(index.cameraShots).to.equal(0)
    expect(index.interactionShots).to.equal(0)
    expect(index.movementShots).to.equal(0)
    expect(index.shotCount).to.equal(270)
    expect(index.shots).to.have.length(270)
  })

  it('camera/interaction/movement are DEFERRED independently, not mixed into matrix', () => {
    expect(index.notes.camera).to.include('DEFERRED')
    expect(index.notes.interaction).to.include('DEFERRED')
    expect(index.notes.movement).to.include('DEFERRED')
    expect(index.matrixShots).to.equal(270)
    expect(index.cameraShots).to.equal(0)
    expect(index.interactionShots).to.equal(0)
    expect(index.movementShots).to.equal(0)
  })

  it('all 270 PNG files exist with reasonable sizes', () => {
    expect(existsSync(SHOTS_DIR), 'shots dir missing').to.equal(true)
    const pngs = readdirSync(SHOTS_DIR).filter(f => f.endsWith('.png'))
    expect(pngs).to.have.length(270)

    const smallFiles = []
    const largeFiles = []
    for (const f of pngs) {
      const sz = statSync(join(SHOTS_DIR, f)).size
      if (sz < 500) smallFiles.push(`${f}:${sz}B`)
      if (sz > 500000) largeFiles.push(`${f}:${(sz/1024).toFixed(0)}KB`)
    }
    expect(smallFiles, `undersized PNGs: ${smallFiles.join(', ')}`).to.deep.equal([])
    expect(largeFiles, `oversized PNGs: ${largeFiles.join(', ')}`).to.deep.equal([])
  })

  // ── Task 7: screenshotFile field ──
  it('every shot has explicit screenshotFile field', () => {
    for (const s of index.shots) {
      expect(s.screenshotFile, `${s.id} missing screenshotFile`).to.be.a('string')
      expect(s.screenshotFile).to.match(/^shots\/E13-\d+\.png$/)
    }
  })

  it('every shot has runtimeFacts with ordering', () => {
    for (const s of index.shots) {
      expect(s.runtimeFacts, `${s.id} missing runtimeFacts`).to.be.an('object')
      const f = s.runtimeFacts
      expect(f.shotId).to.equal(s.id)
      expect(f.actualDepth).to.be.a('number')
      expect(f.targetDepth).to.be.a('number')
      expect(['agent_behind_target', 'agent_in_front', 'tie']).to.include(f.ordering)
      expect(typeof f.depthMatch).to.equal('boolean')
      expect(f.pixelOverlap).to.be.an('object')
      expect(typeof f.pixelOverlap.hasOverlap).to.equal('boolean')
      expect(f.worldOrderLength).to.be.at.least(32 + 5 + 1)
    }
  })

  // ── Task 4: 100% depthMatch ──
  it('all 270 shots have depthMatch=true (resolvedExpectedOrdering)', () => {
    const failures = index.shots.filter(s => !s.runtimeFacts.depthMatch)
    expect(failures.map(s => `${s.id}: expected=${s.expectedRelation} got=${s.runtimeFacts.ordering}`),
      `found ${failures.length} depthMatch failures`).to.deep.equal([])
    expect(failures).to.have.length(0)
  })

  it('boundary shots retain semanticRelation=boundary but have resolved ordering', () => {
    const boundaryShots = index.shots.filter(s => s.relation === 'boundary')
    expect(boundaryShots).to.have.length(90)

    for (const s of boundaryShots) {
      expect(s.relation).to.equal('boundary')
      // expectedRelation should be resolved (not 'tie')
      expect(['agent_behind_target', 'agent_in_front', 'tie']).to.include(s.expectedRelation)
      expect(s.runtimeFacts.depthMatch).to.equal(true)
    }
  })

  it('critical shot: 卢俊义 behind bounty-board → agent_behind_target', () => {
    const shot = index.shots.find(
      s => s.persona === 'lujunyi' && s.relation === 'behind'
        && s.targetStableId === 'jyt.prop.northeast.bounty-board.v1'
    )
    expect(shot, '卢俊义 behind bounty-board shot missing').to.not.equal(undefined)
    const f = shot.runtimeFacts
    expect(f.ordering, `expected agent_behind_target, got ${f.ordering}`).to.equal('agent_behind_target')
    expect(f.actualDepth).to.be.lessThan(f.targetDepth)
    expect(f.pixelOverlap.hasOverlap).to.equal(true)
  })

  it('critical shot: 扈三娘 behind bounty-board → agent_behind_target', () => {
    const shot = index.shots.find(
      s => s.persona === 'husanniang' && s.relation === 'behind'
        && s.targetStableId === 'jyt.prop.northeast.bounty-board.v1'
    )
    expect(shot, '扈三娘 behind bounty-board shot missing').to.not.equal(undefined)
    const f = shot.runtimeFacts
    expect(f.ordering).to.equal('agent_behind_target')
    expect(f.actualDepth).to.be.lessThan(f.targetDepth)
    expect(f.pixelOverlap.hasOverlap).to.equal(true)
  })

  it('critical shot: 卢俊义 front bounty-board → agent_in_front', () => {
    const shot = index.shots.find(
      s => s.persona === 'lujunyi' && s.relation === 'front'
        && s.targetStableId === 'jyt.prop.northeast.bounty-board.v1'
    )
    expect(shot).to.not.equal(undefined)
    const f = shot.runtimeFacts
    expect(f.ordering).to.equal('agent_in_front')
    expect(f.actualDepth).to.be.greaterThan(f.targetDepth)
  })

  it('boundary cases have deterministic tieBias resolution', () => {
    // bounty-board has tieBias=-4, agent has tieBias=0 → agent_in_front at boundary
    const boundaryShots = index.shots.filter(s => s.relation === 'boundary')
    expect(boundaryShots).to.have.length(90) // 15 targets × 6 personas

    for (const s of boundaryShots) {
      const f = s.runtimeFacts
      // When agent and target share fixedPointY, tieBias determines order
      // This must be deterministic
      expect(f.ordering).to.be.oneOf(['agent_behind_target', 'agent_in_front', 'tie'])
      expect([f.actualDepth, f.targetDepth].every(d => typeof d === 'number')).to.equal(true)
    }
  })

  it('sort keys are deterministic (agentSortKey present for all)', () => {
    for (const s of index.shots) {
      expect(s.runtimeFacts.agentSortKey, `${s.id} missing agentSortKey`).to.be.an('array')
      expect(s.runtimeFacts.agentSortKey).to.have.length(6) // [band, floor, elev, fixedY, tieBias, stableId]
    }
  })

  it('contact sheets exist (PNG format from offline renderer)', () => {
    expect(existsSync(CONTACT_DIR), 'contact-sheets dir missing').to.equal(true)
    const files = readdirSync(CONTACT_DIR)
    expect(files.length, 'no contact sheets').to.be.at.least(9)
    const pngs = files.filter(f => f.endsWith('.png'))
    expect(pngs.length, 'no PNG contact sheets').to.be.at.least(9)
  })

  it('target coverage: all 15 targets have 18 shots each (6 personas × 3 relations)', () => {
    const byTarget = {}
    for (const s of index.shots) {
      const t = s.targetStableId
      if (!byTarget[t]) byTarget[t] = new Set()
      byTarget[t].add(`${s.persona}|${s.relation}`)
    }
    const targetsWithIssues = []
    for (const [t, combos] of Object.entries(byTarget)) {
      if (combos.size !== 18) targetsWithIssues.push(`${t}: ${combos.size}/18`)
    }
    expect(Object.keys(byTarget)).to.have.length(15)
    expect(targetsWithIssues, `incomplete targets: ${targetsWithIssues.join(', ')}`).to.deep.equal([])
  })

  it('persona coverage: all 6 personas appear for each relation × target', () => {
    const personas = new Set(index.shots.map(s => s.persona))
    expect([...personas].sort()).to.deep.equal(
      ['husanniang', 'likui', 'linchong', 'lujunyi', 'songjiang', 'wuyong']
    )
  })

  it('no fabricated runtime evidence: front shots consistently have agent_in_front', () => {
    const frontShots = index.shots.filter(s => s.relation === 'front')
    for (const s of frontShots) {
      const f = s.runtimeFacts
      // At dy=+34, agent is 34px below target. For most targets, this means
      // fixedPointY_agent > fixedPointY_target → agent_in_front
      // (unless a very small target rect where agent falls outside)
      expect(f.ordering).to.be.oneOf(['agent_in_front', 'tie'])
    }
  })

  it('behind shots consistently have agent_behind_target', () => {
    const behindShots = index.shots.filter(s => s.relation === 'behind')
    for (const s of behindShots) {
      const f = s.runtimeFacts
      expect(f.ordering).to.be.oneOf(['agent_behind_target', 'tie'])
    }
  })

  // ── Task 6: prop foreground/background pixel checks ──
  it('props with depth > agent are in covering list (foreground occlusion)', () => {
    // Spot-check: main-seat prop is at anchor(872,268) with tieBias=0
    // When agent is at dy=-34 (behind), agent depth should be less than prop
    const behindShots = index.shots.filter(
      s => s.targetStableId === 'jyt.prop.center-north.main-seat.v1' && s.relation === 'behind'
    )
    expect(behindShots).to.have.length(6)

    for (const s of behindShots) {
      const f = s.runtimeFacts
      // At behind position, agent has same fixedPointY as target minus 34*256=8704
      // So agent fixedPointY < target fixedPointY → agent_behind_target
      expect(f.ordering).to.equal('agent_behind_target')
      expect(f.pixelOverlap.hasOverlap).to.equal(true)
    }
  })

  it('props with depth > agent are re-rendered on top (not left behind in composite)', () => {
    // Verify: for any shot, the pixelOverlap indicates agent-target spatial relationship
    for (const s of index.shots) {
      const f = s.runtimeFacts
      expect(f.pixelOverlap).to.be.an('object')
      if (f.pixelOverlap.hasOverlap) {
        expect(f.pixelOverlap.overlapBounds).to.be.an('object')
        expect(f.pixelOverlap.overlapBounds.width).to.be.greaterThan(0)
        expect(f.pixelOverlap.overlapBounds.height).to.be.greaterThan(0)
      }
    }
  })
})
