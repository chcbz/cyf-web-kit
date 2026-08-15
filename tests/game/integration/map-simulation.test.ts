import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'

import { validateMapRuntime } from '../../../src/game/map/mapValidation.js'
import { parseMovementTmx } from '../../../src/game/map/tmxMovementParser.js'
import { PERSONA_SPRITE_MANIFEST } from '../../../src/game/sprites/personaSpriteManifest.js'
import { adaptBackendState } from '../../../src/game/simulation/backendSceneStateAdapter.js'
import { createMovementEngine } from '../../../src/game/simulation/movementEngine.js'

const hallXml = readFileSync('public/juyiting/hall.tmx', 'utf8')

describe('map simulation', () => {
  it('runs a real TMX semantic state through adaptation, simulation, and native sprite snapshots', () => {
    const runtime = parseMovementTmx(hallXml)
    assert.equal(validateMapRuntime(runtime).valid, true)
    const engine = createMovementEngine(runtime, PERSONA_SPRITE_MANIFEST, { now: () => 2_000 })
    const adapted = adaptBackendState({
      agentId: 'agent-songjiang',
      personaCode: 'songjiang',
      behavior: 'moving_to_discussion',
      targetRegionId: 'council-table',
      stateVersion: 16,
      startedAt: 1_000,
      expectedArrivalAt: 20_000,
      phase: 'moving'
    }, runtime, 2_000)

    assert.ok(adapted.command)
    assert.equal(engine.enqueue(adapted.command).accepted, true)
    engine.update(1_000)

    const snapshot = engine.snapshots()[0]
    assert.equal(snapshot?.personaCode, 'songjiang')
    assert.equal(snapshot?.animation, 'walk')
    assert.equal(snapshot?.phase, 'moving')
    assert.equal(snapshot?.targetRegionId, 'council-table')
    assert.equal(Number.isFinite(snapshot?.x), true)
    assert.equal(Number.isFinite(snapshot?.y), true)
    assert.deepEqual(
      Object.keys(adapted.command).filter(key => ['x', 'y', 'path', 'coordinates', 'frame'].includes(key)),
      [],
    )
  })

  it('completes two full patrol loops for all six personas without hard reversals', function () {
    this.timeout(15_000)
    const runtime = parseMovementTmx(hallXml)
    let currentTime = 0
    const engine = createMovementEngine(runtime, PERSONA_SPRITE_MANIFEST, {
      now: () => currentTime,
    })
    const assignments = runtime.patrolRoutes.map(route => ({
      agentId: `agent-${route.personaCode}`,
      personaCode: route.personaCode,
      routeId: route.routeId,
    }))
    const observations = new Map(assignments.map(assignment => [assignment.agentId, {
      arrivalCount: 0,
      regions: [] as string[],
      previousPoint: undefined as { x: number, y: number } | undefined,
      previousVector: undefined as { x: number, y: number } | undefined,
      maxTurnDegrees: 0,
    }]))
    engine.setLocalPatrols(assignments)

    for (let step = 0; step < 6_000; step += 1) {
      currentTime += 100
      engine.update(100)
      for (const event of engine.drainPhaseEvents()) {
        assert.notEqual(event.phase, 'blocked', `${event.agentId} blocked at ${event.regionId}`)
        if (event.phase !== 'arrived') continue
        const observation = observations.get(event.agentId)
        assert.ok(observation)
        observation.arrivalCount += 1
        observation.regions.push(event.regionId)
      }
      for (const snapshot of engine.snapshots()) {
        const observation = observations.get(snapshot.agentId)
        assert.ok(observation)
        if (observation.previousPoint) {
          const vector = {
            x: snapshot.x - observation.previousPoint.x,
            y: snapshot.y - observation.previousPoint.y,
          }
          if (Math.hypot(vector.x, vector.y) > 0.1) {
            if (observation.previousVector && observation.arrivalCount > 0) {
              observation.maxTurnDegrees = Math.max(
                observation.maxTurnDegrees,
                directionChangeDegrees(observation.previousVector, vector),
              )
            }
            observation.previousVector = vector
          }
        }
        observation.previousPoint = { x: snapshot.x, y: snapshot.y }
      }
      if ([...observations.values()].every(observation => observation.arrivalCount >= 9)) break
    }

    const routesByPersona = new Map(runtime.patrolRoutes.map(route => [route.personaCode, route]))
    for (const assignment of assignments) {
      const route = routesByPersona.get(assignment.personaCode)
      const observation = observations.get(assignment.agentId)
      assert.ok(route)
      assert.ok(observation)
      assert.ok(observation.arrivalCount >= 9, `${assignment.personaCode} did not finish two loops`)
      assert.deepEqual(observation.regions.slice(0, 8), [...route.regionIds, ...route.regionIds])
      assert.ok(
        observation.maxTurnDegrees <= 120 + 1e-6,
        `${assignment.personaCode} hard-reversed by ${observation.maxTurnDegrees.toFixed(3)} degrees`,
      )
    }
    assert.deepEqual(engine.metrics(), { queuedCommandCount: 0, replanningCount: 0 })
  })

})

function directionChangeDegrees(
  incoming: { x: number, y: number },
  outgoing: { x: number, y: number },
): number {
  const cosine = (incoming.x * outgoing.x + incoming.y * outgoing.y)
    / (Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y))
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI
}
