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
      phase: 'arrived', regionId: 'council-table', occurredAt: '1970-01-01T00:00:01.234Z', source: 'backend',
    }])
    engine.update(30_000)
    assert.deepEqual(engine.drainPhaseEvents(), [])
  })

  it('blocks unknown regions immediately without inventing a target or repeated events', () => {
    const engine = createMovementEngine(runtime(), manifest(), { now: () => 2_000 })

    engine.enqueue(command({ commandId: 'missing', targetRegionId: 'missing-region' }))

    assert.deepEqual(engine.snapshots()[0], {
      agentId: 'agent-songjiang', personaCode: 'songjiang', x: 0, y: 0,
      facing: 'down', animation: 'idle', behavior: 'moving_to_region', phase: 'blocked',
      regionId: 'main-seat', targetRegionId: 'missing-region', stateVersion: 1,
    })
    assert.deepEqual(engine.drainPhaseEvents(), [{
      reportId: 'missing:blocked', agentId: 'agent-songjiang', stateVersion: 1,
      phase: 'blocked', regionId: 'missing-region', occurredAt: '1970-01-01T00:00:02.000Z', source: 'backend',
    }])
    engine.update(30_000)
    assert.deepEqual(engine.drainPhaseEvents(), [])
  })

  it('blocks a known target when the navigation graph has no path', () => {
    const disconnected = runtime()
    disconnected.edges = []
    disconnected.obstacles = [{ points: [{ x: 40, y: -30 }, { x: 60, y: -30 }, { x: 60, y: 30 }, { x: 40, y: 30 }] }]
    const engine = createMovementEngine(disconnected, manifest(), { now: () => 2_500 })

    engine.enqueue(command({ commandId: 'no-path' }))

    assert.equal(engine.snapshots()[0]?.phase, 'blocked')
    assert.deepEqual(engine.drainPhaseEvents(), [{
      reportId: 'no-path:blocked', agentId: 'agent-songjiang', stateVersion: 1,
      phase: 'blocked', regionId: 'council-table', occurredAt: '1970-01-01T00:00:02.500Z', source: 'backend',
    }])
  })

  it('scores every available parking slot before atomically reserving the best reachable one', () => {
    const map = runtime()
    map.slots = [
      map.slots[0],
      { stableId: 'parking-blocked', slotId: 'parking-blocked', regionId: 'council-table', point: { x: 100, y: 0 }, kind: 'parking' },
      { stableId: 'parking-safe', slotId: 'parking-safe', regionId: 'council-table', point: { x: 100, y: 60 }, kind: 'parking' },
    ]
    map.nodes = [
      { stableId: 'node-home', point: { x: 0, y: 0 }, kind: 'normal', channelWidth: 60 },
      { stableId: 'node-safe', point: { x: 100, y: 60 }, kind: 'normal', channelWidth: 60 },
    ]
    map.edges = [{ stableId: 'safe-edge', from: 'node-home', to: 'node-safe', bidirectional: true, costMultiplier: 1, points: [{ x: 0, y: 0 }, { x: 0, y: 60 }, { x: 100, y: 60 }] }]
    map.obstacles = [{ points: [{ x: 40, y: -30 }, { x: 60, y: -30 }, { x: 60, y: 30 }, { x: 40, y: 30 }] }]
    const engine = createMovementEngine(map, manifest())

    engine.enqueue(command())
    engine.update(10_000)

    assert.equal(engine.snapshots()[0]?.regionId, 'council-table')
    assert.equal(engine.snapshots()[0]?.y, 60)
  })

  it('selects the downward sprite direction for a vertical route', () => {
    const engine = createMovementEngine(runtime(), manifest())

    engine.enqueue(command({ targetRegionId: 'bounty-board' }))

    assert.equal(engine.snapshots()[0]?.facing, 'down')
  })

  it('replaces active movement from the current point and does not complete the old command', () => {
    const engine = createMovementEngine(runtime(), manifest(), { now: () => 3_000 })
    engine.enqueue(command())
    engine.update(500)

    const replacement = engine.enqueue(command({
      commandId: 'move-2', targetRegionId: 'bounty-board', stateVersion: 2,
    }))

    assert.equal(replacement.accepted, true)
    assert.deepEqual(engine.metrics(), { queuedCommandCount: 0, replanningCount: 1 })
    assert.equal(Object.isFrozen(engine.metrics()), true)
    assert.equal(engine.snapshots()[0]?.stateVersion, 2)
    assert.equal(engine.snapshots()[0]?.phase, 'moving')
    engine.update(10_000)
    assert.equal(engine.snapshots()[0]?.regionId, 'bounty-board')
    assert.deepEqual(engine.drainPhaseEvents().map(event => [event.reportId, event.phase]), [
      ['move-2:arrived', 'arrived'],
    ])
  })

  it('recovers backend movement at the time-derived cumulative path position', () => {
    const recoveredRuntime = runtime()
    recoveredRuntime.edges[0]!.points = [
      { x: 0, y: 0 }, { x: 0, y: 60 }, { x: 100, y: 60 }, { x: 100, y: 0 },
    ]
    recoveredRuntime.obstacles = [{ points: [{ x: 40, y: -30 }, { x: 60, y: -30 }, { x: 60, y: 30 }, { x: 40, y: 30 }] }]
    const engine = createMovementEngine(recoveredRuntime, manifest(), { now: () => 5_000 })

    engine.enqueue(command({
      startedAt: '1970-01-01T00:00:00.000Z',
      expectedArrivalAt: '1970-01-01T00:00:10.000Z',
    }))

    assert.deepEqual(engine.snapshots()[0], {
      agentId: 'agent-songjiang', personaCode: 'songjiang', x: 50, y: 60,
      facing: 'right', animation: 'walk', behavior: 'moving_to_region', phase: 'moving',
      regionId: 'main-seat', targetRegionId: 'council-table', stateVersion: 1,
    })
    assert.deepEqual(engine.drainPhaseEvents(), [])
  })

  it('settles a committed arrival before replacing it with a newer command', () => {
    const engine = createMovementEngine(runtime(), manifest(), {
      now: () => 4_000,
      arrivalThreshold: 6,
    })
    engine.enqueue(command())
    engine.update(1_900)

    const replacement = engine.enqueue(command({
      commandId: 'move-2', targetRegionId: 'bounty-board', stateVersion: 2,
    }))

    assert.deepEqual(replacement, { accepted: true, replacedCommandId: 'move-1' })
    assert.deepEqual(engine.drainPhaseEvents(), [{
      reportId: 'move-1:arrived', agentId: 'agent-songjiang', stateVersion: 1,
      phase: 'arrived', regionId: 'council-table', occurredAt: '1970-01-01T00:00:04.000Z', source: 'backend',
    }])
    assert.deepEqual(engine.snapshots()[0], {
      agentId: 'agent-songjiang', personaCode: 'songjiang', x: 100, y: 0,
      facing: 'downLeft', animation: 'walk', behavior: 'moving_to_region', phase: 'moving',
      regionId: 'council-table', targetRegionId: 'bounty-board', stateVersion: 2,
    })
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
    assert.throws(() => createMovementEngine(runtime(), manifest(), { arrivalThreshold: -1 }), /threshold/i)
  })

  it('cancels active movement without emitting a stale phase event', () => {
    const engine = createMovementEngine(runtime(), manifest())
    engine.enqueue(command())
    engine.update(500)

    assert.equal(engine.cancel('agent-songjiang', 2), true)
    const cancelled = engine.snapshots()[0]
    assert.equal(cancelled?.animation, 'idle')
    assert.equal(cancelled?.phase, 'idle')
    assert.equal(cancelled?.stateVersion, 2)
    assert.equal(cancelled?.targetRegionId, undefined)

    engine.update(30_000)
    assert.deepEqual(engine.drainPhaseEvents(), [])
    assert.deepEqual(engine.enqueue(command({ commandId: 'stale-after-cancel', stateVersion: 2 })), {
      accepted: false,
      reason: 'stale-state-version',
    })
    assert.equal(engine.cancel('missing-agent', 2), false)
  })

  it('drops an undrained stale phase when an authoritative cancellation arrives', () => {
    const engine = createMovementEngine(runtime(), manifest())
    engine.enqueue(command())
    engine.update(2_000)

    assert.equal(engine.cancel('agent-songjiang', 2), true)
    assert.deepEqual(engine.drainPhaseEvents(), [])
  })

  it('removes the stale local runtime when a featured placeholder is replaced by the real agent ID', () => {
    const engine = createMovementEngine(runtime(), manifest(), { now: () => 1_000 })

    // 初始画面使用预置人物 ID；/agent/map 返回后，同一人物会改用真实运行时 ID。
    engine.setLocalPatrols([{ agentId: 'lujunyi', personaCode: 'songjiang', routeId: 'songjiang-loop' }])
    engine.update(1)
    assert.deepEqual(engine.snapshots().map(snapshot => snapshot.agentId), ['lujunyi'])

    engine.setLocalPatrols([{
      agentId: 'jyt-jiafewnnv58ec2379c-lujunyi',
      personaCode: 'songjiang',
      routeId: 'songjiang-loop',
    }])
    engine.update(1)

    assert.deepEqual(engine.snapshots().map(snapshot => snapshot.agentId), [
      'jyt-jiafewnnv58ec2379c-lujunyi',
    ])
  })

  it('runs TMX local patrol until a backend state takes priority, then resumes after cancellation', () => {
    const engine = createMovementEngine(runtime(), manifest(), { now: () => 1_000 })
    engine.setLocalPatrols([{ agentId: 'agent-songjiang', personaCode: 'songjiang', routeId: 'songjiang-loop' }])

    engine.update(1)
    assert.equal(engine.snapshots()[0]?.targetRegionId, 'council-table')

    assert.equal(engine.enqueue(command({ targetRegionId: 'bounty-board', stateVersion: 1 })).accepted, true)
    assert.equal(engine.snapshots()[0]?.targetRegionId, 'bounty-board')

    assert.equal(engine.cancel('agent-songjiang', 1), true)
    engine.update(1)
    assert.equal(engine.snapshots()[0]?.targetRegionId, 'bounty-board')
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
    patrolRoutes: [{
      stableId: 'patrol-songjiang', routeId: 'songjiang-loop', personaCode: 'songjiang',
      regionIds: ['council-table', 'bounty-board'], loop: true, dwellMs: 0, priority: 1,
    }],
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
  const animations = (
    frames: number[], frameMs: number,
  ): PersonaSpriteManifest['personas'][string]['animations']['idle'] => ({
    down: { frames, frameMs },
    downRight: { frames, frameMs },
    right: { frames, frameMs },
    upRight: { frames, frameMs },
    up: { frames, frameMs },
    upLeft: { frames, frameMs },
    left: { frames, frameMs },
    downLeft: { frames, frameMs },
  })
  return {
    version: 'manifest-v1',
    personas: {
      songjiang: {
        personaCode: 'songjiang', required: true, src: '/songjiang.png',
        image: { width: 1024, height: 1024 },
        frame: { width: 128, height: 128, columns: 8, rows: 8 },
        anchor: { x: 0.5, y: 0.86 }, collider: { width: 36, height: 20, offsetX: 0, offsetY: -10 },
        scale: 0.52, baseSpeed: 50,
        animations: {
          idle: animations([0], 180), walk: animations([32], 90),
        },
      },
    },
  }
}
