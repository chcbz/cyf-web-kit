import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'mocha'

import {
  aggregateSceneDebug,
} from '../../../src/game/debug/sceneDebugAggregator.js'
// @ts-expect-error JuyitingGame is an existing JavaScript runtime module.
import { JuyitingGame } from '../../../src/game/JuyitingGame.js'

const DEBUG_KEY = '__JYTING_SCENE_DEBUG__'

describe('scene debug', () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>)[DEBUG_KEY]
  })

  it('publishes the exact approved shape using semantic allowlists only', () => {
    const debug = aggregateSceneDebug({
      ready: true,
      degraded: false,
      fatalError: null,
      camera: {
        transform: { zoom: 1.25, offsetX: 12, offsetY: -7 },
        viewport: { width: 390, height: 720, token: 'token-secret' },
        presetId: 'main-hall-mobile',
        apiKey: 'api-key-secret',
      },
      input: { interactionLocked: false, activeGesture: 'none', chatContent: 'private-chat' },
      map: {
        tmxLoaded: true,
        movementReady: true,
        sceneId: 'juyiting-main',
        movementSchemaVersion: '1',
        navGraphVersion: 'juyiting-main-v1',
        hotspots: [{ id: 'one' }, { id: 'two' }],
        rawResponse: { credential: 'secret' },
      },
      sprites: {
        manifestReady: true,
        manifestVersion: 'persona-sheets-v1',
        requiredMissingCount: 0,
        optionalMissingCount: 0,
        placeholderCount: 0,
        token: 'sprite-token',
      },
      backend: {
        snapshotReady: true,
        sceneVersion: 128,
        sseConnected: true,
        lastEventAt: '2026-07-17T00:00:00.000Z',
        resyncCount: 0,
        rawModelResponse: 'raw-model-output',
      },
      simulation: {
        ready: true,
        visibleCount: 1,
        movingCount: 1,
        blockedCount: 0,
        queuedCommandCount: 0,
        replanningCount: 0,
        stackTrace: 'private stack trace',
      },
      agents: [{
        agentId: 'agent-songjiang', personaCode: 'songjiang',
        behavior: 'moving_to_discussion', phase: 'moving', regionId: 'main-seat',
        targetRegionId: 'council-table', spriteLoaded: true, placeholder: false,
        x: 480, y: 320, path: [{ x: 1, y: 2 }], chatContent: 'private-chat',
      }],
      warnings: [{
        code: 'SPRITE_LOAD_FAILED', severity: 'degraded', source: 'sprites', retryable: true,
        message: 'token-secret with stack trace',
      }],
    })

    assert.deepEqual(Object.keys(debug), [
      'ready', 'degraded', 'fatalError', 'camera', 'input', 'map', 'sprites',
      'backend', 'simulation', 'agents', 'warnings',
    ])
    assert.deepEqual({ ready: debug.ready, degraded: debug.degraded }, { ready: true, degraded: false })
    assert.equal(debug.map.sceneId, 'juyiting-main')
    assert.equal(debug.map.hotspotCount, 2)
    assert.equal(debug.simulation.visibleCount, 1)
    assert.deepEqual(debug.agents[0], {
      agentId: 'agent-songjiang', personaCode: 'songjiang',
      behavior: 'moving_to_discussion', phase: 'moving', regionId: 'main-seat',
      targetRegionId: 'council-table', spriteLoaded: true, placeholder: false,
    })
    assert.doesNotMatch(
      JSON.stringify(debug),
      /token|apiKey|chatContent|rawResponse|rawModel|credential|stack|private-chat|raw-model-output/i,
    )
  })

  it('defensively clones and deeply freezes every published collection', () => {
    const viewport = { width: 390, height: 720 }
    const agents = [{ agentId: 'agent-songjiang', personaCode: 'songjiang' }]
    const debug = aggregateSceneDebug({ camera: { viewport }, agents })

    viewport.width = 999
    agents[0].agentId = 'mutated'

    assert.equal(debug.camera.viewport.width, 390)
    assert.equal(debug.agents[0]?.agentId, 'agent-songjiang')
    assert.equal(Object.isFrozen(debug), true)
    assert.equal(Object.isFrozen(debug.camera.viewport), true)
    assert.equal(Object.isFrozen(debug.agents), true)
    assert.throws(() => {
      ;(debug.camera.viewport as { width: number }).width = 1
    }, TypeError)
  })

  it('reduces fatal errors and warnings to non-sensitive machine metadata', () => {
    const error = Object.assign(new Error('token-secret private stack trace'), {
      code: 'SIMULATION_INIT_FAILED', source: 'simulation', retryable: true,
      rawResponse: { apiKey: 'secret' },
    })
    const debug = aggregateSceneDebug({
      degraded: true,
      fatalError: error,
      warnings: [{ code: 'BACKEND_DEGRADED', source: 'backend', message: 'private-chat' }],
    })

    assert.deepEqual(debug.fatalError, {
      code: 'SIMULATION_INIT_FAILED', source: 'simulation', retryable: true,
    })
    assert.deepEqual(debug.warnings, [{
      code: 'BACKEND_DEGRADED', severity: 'warning', source: 'backend', retryable: false,
    }])
    assert.doesNotMatch(JSON.stringify(debug), /token|private|stack|message|rawResponse|apiKey/i)
  })

  it('exposes a read-only test global and removes only its own publication on destroy', () => {
    const target = globalThis as unknown as Record<string, unknown>
    const game = new JuyitingGame()
    game._initialized = true
    game._mapData = {
      movementReady: true,
      hotspots: [{ id: 'main-seat' }],
      movement: {
        sceneId: 'juyiting-main', movementSchemaVersion: '1', navGraphVersion: 'graph-v1',
      },
    }
    game._spriteLoadResult = {
      degraded: false,
      requiredMissingCount: 0,
      optionalMissingCount: 0,
      available: new Set(['songjiang']),
      errors: [],
    }
    game._movementEngine = {
      snapshots: () => [{
        agentId: 'agent-songjiang', personaCode: 'songjiang', behavior: 'moving',
        phase: 'moving', regionId: 'main-seat', targetRegionId: 'council-table',
      }],
    }
    game._hallScene = {
      getCameraSnapshot: () => ({
        transform: { zoom: 1.25, offsetX: 0, offsetY: 0 }, presetId: 'main-hall-mobile',
      }),
      inputSnapshot: () => ({ interactionLocked: false, activeGesture: 'none' }),
      _viewportSize: () => ({ width: 390, height: 720 }),
      onDestroyEvent: () => {},
    }

    const publication = game.getSceneDebugSnapshot()

    assert.equal(target[DEBUG_KEY], publication)
    assert.equal(Object.isFrozen(publication), true)
    assert.throws(() => {
      target[DEBUG_KEY] = { compromised: true }
    }, TypeError)

    game.destroy()
    assert.equal(Object.hasOwn(target, DEBUG_KEY), false)
  })
})
