import assert from 'node:assert/strict'
import { describe, it } from 'mocha'

import type { MapRuntimeData } from '../../../src/game/map/movementSchema.js'
import type { PersonaSpriteManifest } from '../../../src/game/sprites/personaSpriteManifest.js'
import {
  createMovementEngine,
  type AgentSnapshot,
} from '../../../src/game/simulation/movementEngine.js'
import type { MovementCommand } from '../../../src/game/simulation/movementCommandQueue.js'

describe('movement engine', () => {
  it('follows the graph with delta time, manifest speed, facing and one arrival event', () => {
    const engine = createMovementEngine(runtime(), manifest(), { now: () => 1_234 })

    assert.equal(engine.enqueue(command()).accepted, true)
    engine.update(1_000)

    assert.deepEqual(engine.snapshots()[0], {
      agentId: 'agent-songjiang', personaCode: 'songjiang', x: 50, y: 0,
      facing: 'right', animation: 'walk', behavior: 'moving_to_region', phase: 'moving',
      regionId: 'main-seat', targetRegionId: 'council-table', stateVersion: 1,
    })
    assert.deepEqual(engine.drainPhaseEvents(), [])

    engine.update(1_000)
    assert.deepEqual(engine.snapshots()[0], {
      agentId: 'agent-songjiang', personaCode: 'songjiang', x: 100, y: 0,
      facing: 'right', animation: 'idle', behavior: 'moving_to_region', phase: 'arrived',
      regionId: 'council-table', stateVersion: 1,
    })
    assert.deepEqual(engine.drainPhaseEvents(), [{
      reportId: 'move-1:arrived', agentId: 'agent-songjiang', stateVersion: 1,
      phase: 'arrived', regionId: 'council-table', occurredAt: '1970-01-01T00:00:01.234Z',
    }])
    engine.update(30_000)
    assert.deepEqual(engine.drainPhaseEvents(), [])
  })

  it('blocks unknown regions immediately without inventing a target or repeated events', () => {
    const engine = createMovementEngine(runtime(), manifest(), { now: () => 2_000 })

    engine.enqueue(command({ commandId: 'missing', targetRegionId: 'missing-region' }))

    assert.deepEqual(engine.snapshots()[0], {
      agentId: 'agent-songjiang', personaCode: 'songjiang', x: 0, y: 0,
      facing: 'right', animation: 'idle', behavior: 'moving_to_region', phase: 'blocked',
      regionId: 'main-seat', targetRegionId: 'missing-region', stateVersion: 1,
    })
    assert.deepEqual(engine.drainPhaseEvents(), [{
      reportId: 'missing:blocked', agentId: 'agent-songjiang', stateVersion: 1,
      phase: 'blocked', regionId: 'missing-region', occurredAt: '1970-01-01T00:00:02.000Z',
    }])
    engine.update(30_000)
    assert.deepEqual(engine.drainPhaseEvents(), [])
  })

  it('blocks a known target when the navigation graph has no path', () => {
    const disconnected = runtime()
    disconnected.edges = []
    const engine = createMovementEngine(disconnected, manifest(), { now: () => 2_500 })

    engine.enqueue(command({ commandId: 'no-path' }))

    assert.equal(engine.snapshots()[0]?.phase, 'blocked')
    assert.deepEqual(engine.drainPhaseEvents(), [{
      reportId: 'no-path:blocked', agentId: 'agent-songjiang', stateVersion: 1,
      phase: 'blocked', regionId: 'council-table', occurredAt: '1970-01-01T00:00:02.500Z',
    }])
  })

  it('replaces active movement from the current point and does not complete the old command', () => {
    const engine = createMovementEngine(runtime(), manifest(), { now: () => 3_000 })
    engine.enqueue(command())
    engine.update(500)

    const replacement = engine.enqueue(command({
      commandId: 'move-2', targetRegionId: 'bounty-board', stateVersion: 2,
    }))

    assert.equal(replacement.accepted, true)
    assert.equal(engine.snapshots()[0]?.stateVersion, 2)
    assert.equal(engine.snapshots()[0]?.phase, 'moving')
    engine.update(10_000)
    assert.equal(engine.snapshots()[0]?.regionId, 'bounty-board')
    assert.deepEqual(engine.drainPhaseEvents().map(event => [event.reportId, event.phase]), [
      ['move-2:arrived', 'arrived'],
    ])
  })

  it('returns to the persona home and faces left while traversing the reverse path', () => {
    const engine = createMovementEngine(runtime(), manifest())
    engine.enqueue(command())
    engine.update(2_000)
    engine.drainPhaseEvents()

    engine.enqueue(command({
      commandId: 'home-2', type: 'RETURN_HOME', targetRegionId: 'main-seat', stateVersion: 2,
    }))
    engine.update(1_000)

    assert.equal(engine.snapshots()[0]?.x, 50)
    assert.equal(engine.snapshots()[0]?.facing, 'left')
    assert.equal(engine.snapshots()[0]?.animation, 'walk')
    engine.update(1_000)
    assert.equal(engine.snapshots()[0]?.regionId, 'main-seat')
    assert.equal(engine.snapshots()[0]?.animation, 'idle')
    assert.equal(engine.drainPhaseEvents()[0]?.regionId, 'main-seat')
  })

  it('publishes immutable snapshots and validates update delta time', () => {
    const engine = createMovementEngine(runtime(), manifest())
    engine.enqueue(command())
    engine.update(100)
    const publication = engine.snapshots()
    publication[0]!.x = 999
    publication.push({} as AgentSnapshot)

    assert.notEqual(engine.snapshots()[0]?.x, 999)
    assert.equal(engine.snapshots().length, 1)
    assert.throws(() => engine.update(-1), /delta/i)
    assert.throws(() => engine.update(Number.NaN), /delta/i)
  })
})

function command(overrides: Partial<MovementCommand> = {}): MovementCommand {
  return {
    commandId: 'move-1', agentId: 'agent-songjiang', personaCode: 'songjiang',
    source: 'backend', type: 'MOVE_TO_REGION', targetRegionId: 'council-table',
    priority: 10, stateVersion: 1, startedAt: '2026-07-17T08:00:00.000Z',
    ...overrides,
  }
}

function runtime(): MapRuntimeData {
  return {
    sceneId: 'juyiting-main', movementSchemaVersion: '1', navGraphVersion: 'graph-v1',
    spriteManifestVersion: 'manifest-v1', width: 400, height: 300, obstacles: [],
    regions: [region('main-seat'), region('council-table'), region('bounty-board')],
    nodes: [
      { stableId: 'home', point: { x: 0, y: 0 }, kind: 'normal', channelWidth: 48 },
      { stableId: 'council', point: { x: 100, y: 0 }, kind: 'normal', channelWidth: 48 },
      { stableId: 'bounty', point: { x: 0, y: 100 }, kind: 'normal', channelWidth: 48 },
    ],
    edges: [
      edge('home-council', 'home', 'council', [{ x: 0, y: 0 }, { x: 100, y: 0 }]),
      edge('home-bounty', 'home', 'bounty', [{ x: 0, y: 0 }, { x: 0, y: 100 }]),
    ],
    slots: [
      { stableId: 'home-songjiang', slotId: 'home-songjiang', regionId: 'main-seat',
        point: { x: 0, y: 0 }, personaCode: 'songjiang', kind: 'home' },
      { stableId: 'parking-council', slotId: 'parking-council', regionId: 'council-table',
        point: { x: 100, y: 0 }, kind: 'parking' },
      { stableId: 'parking-bounty', slotId: 'parking-bounty', regionId: 'bounty-board',
        point: { x: 0, y: 100 }, kind: 'parking' },
    ],
  }
}

function region(regionId: string): MapRuntimeData['regions'][number] {
  return {
    stableId: `region-${regionId}`, regionId, polygon: { points: [] }, label: regionId,
    capacity: 1, protected: false, riskLevel: 'low',
  }
}

function edge(
  stableId: string, from: string, to: string, points: MapRuntimeData['edges'][number]['points'],
): MapRuntimeData['edges'][number] {
  return { stableId, from, to, bidirectional: true, costMultiplier: 1, points }
}

function manifest(): PersonaSpriteManifest {
  return {
    version: 'manifest-v1',
    personas: {
      songjiang: {
        personaCode: 'songjiang', required: true, src: '/songjiang.png',
        image: { width: 1024, height: 256 },
        frame: { width: 128, height: 128, columns: 8, rows: 2 },
        anchor: { x: 0.5, y: 0.86 }, collider: { width: 36, height: 20, offsetX: 0, offsetY: -10 },
        scale: 0.52, baseSpeed: 50,
        animations: {
          idle: { frames: [0], frameMs: 180 }, walk: { frames: [8], frameMs: 90 },
        },
      },
    },
  }
}
