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
})
