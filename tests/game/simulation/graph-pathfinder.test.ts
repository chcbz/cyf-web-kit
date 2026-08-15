import assert from 'node:assert/strict'
import { describe, it } from 'mocha'

import type { MapRuntimeData } from '../../../src/game/map/movementSchema.js'
import { pointClearance, polylineClearance, requiredChannelWidth, requiredClearance } from '../../../src/game/simulation/clearanceGeometry.js'
import { createGraphPathfinder, findGraphPath, pathHasHardTurn } from '../../../src/game/simulation/graphPathfinder.js'

type Graph = Pick<MapRuntimeData, 'nodes' | 'edges' | 'obstacles'>
const node = (stableId: string, x: number, y: number) => ({ stableId, point: { x, y }, kind: 'normal' as const, channelWidth: 60 })
const edge = (stableId: string, from: string, to: string, points: Array<{ x: number, y: number }>, costMultiplier = 1) => ({ stableId, from, to, points, costMultiplier, bidirectional: true })
const wall = { points: [{ x: 45, y: -30 }, { x: 55, y: -30 }, { x: 55, y: 30 }, { x: 45, y: 30 }] }

describe('graph pathfinder', () => {
  it('uses a safe direct route before graph traversal', () => {
    const graph: Graph = { nodes: [node('a', 0, 20)], edges: [], obstacles: [] }
    assert.deepEqual(findGraphPath(graph, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 42 }), {
      status: 'found', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], nodeIds: [], cost: 100,
    })
  })

  it('uses true point and polyline clearance rather than center-line intersection alone', () => {
    assert.equal(requiredClearance(42), 27)
    assert.equal(requiredChannelWidth(42), 54)
    assert.equal(pointClearance({ x: 20, y: 0 }, [wall]), 25)
    assert.equal(polylineClearance([{ x: 0, y: 31 }, { x: 100, y: 31 }], [wall]), 1)
  })

  it('filters unsafe nodes, edges, and endpoint connectors then string-pulls the safe route', () => {
    const graph: Graph = {
      nodes: [node('unsafe', 20, 20), node('top-a', 20, 60), node('top-b', 80, 60)],
      edges: [
        edge('unsafe-edge', 'unsafe', 'top-b', [{ x: 20, y: 20 }, { x: 80, y: 20 }]),
        edge('safe-edge', 'top-a', 'top-b', [{ x: 20, y: 60 }, { x: 80, y: 60 }]),
      ],
      obstacles: [wall],
    }
    const result = findGraphPath(graph, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 42 })
    assert.equal(result.status, 'found')
    if (result.status !== 'found') return
    assert.deepEqual(result.nodeIds, ['top-a', 'top-b'])
    assert.deepEqual(result.points, [{ x: 0, y: 0 }, { x: 20, y: 60 }, { x: 80, y: 60 }, { x: 100, y: 0 }])
  })

  it('evaluates every projection pair globally, not the first reachable pair', () => {
    const graph: Graph = {
      nodes: [node('start-near', 0, 60), node('start-best', 20, 60), node('end-best', 80, 60), node('end-near', 100, 60)],
      edges: [
        edge('long', 'start-near', 'end-near', [{ x: 0, y: 40 }, { x: 100, y: 40 }], 4),
        edge('best', 'start-best', 'end-best', [{ x: 20, y: 60 }, { x: 80, y: 60 }]),
      ], obstacles: [wall],
    }
    const result = findGraphPath(graph, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 42 })
    assert.equal(result.status, 'found')
    if (result.status !== 'found') return
    assert.deepEqual(result.nodeIds, ['start-best', 'end-best'])
  })

  it('avoids a >120-degree hard return when an ordinary safe candidate exists', () => {
    const graph: Graph = {
      nodes: [node('back-a', -50, 10), node('back-b', 80, 60), node('forward-a', 20, -60), node('forward-b', 80, -60)],
      edges: [
        edge('back', 'back-a', 'back-b', [{ x: -50, y: 10 }, { x: -50, y: 60 }, { x: 80, y: 60 }], 0.1),
        edge('forward', 'forward-a', 'forward-b', [{ x: 20, y: -60 }, { x: 80, y: -60 }], 5),
      ], obstacles: [wall],
    }
    const result = findGraphPath(graph, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 42 })
    assert.equal(result.status, 'found')
    if (result.status !== 'found') return
    assert.deepEqual(result.nodeIds, ['forward-a', 'forward-b'])
  })

  it('treats exactly 120 degrees as allowed and only larger turns as hard returns', () => {
    const turn = (degrees: number) => [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1 + Math.cos(degrees * Math.PI / 180), y: Math.sin(degrees * Math.PI / 180) },
    ]
    assert.equal(pathHasHardTurn(turn(120)), false)
    assert.equal(pathHasHardTurn(turn(120.001)), true)
  })

  it('requires the 6px safety margin on both sides of declared channels', () => {
    const graph: Graph = {
      nodes: [
        { ...node('a', 0, 60), channelWidth: 53 },
        { ...node('b', 100, 60), channelWidth: 53 },
      ],
      edges: [edge('ab', 'a', 'b', [{ x: 0, y: 60 }, { x: 100, y: 60 }])],
      obstacles: [wall],
    }

    assert.deepEqual(
      findGraphPath(graph, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 42 }),
      { status: 'blocked', reason: 'channel-too-narrow' },
    )
  })

  it('keeps bidirectional traversal behind the replaceable PathFinder interface', () => {
    const graph: Graph = {
      nodes: [node('a', 0, 60), node('b', 100, 60)],
      edges: [edge('ab', 'a', 'b', [{ x: 0, y: 60 }, { x: 100, y: 60 }])],
      obstacles: [wall],
    }
    const pathfinder = createGraphPathfinder(graph)
    const result = pathfinder.find(
      { x: 100, y: 0 }, { x: 0, y: 0 }, { colliderWidth: 42 },
    )

    assert.equal(result.status, 'found')
    if (result.status !== 'found') return
    assert.deepEqual(result.nodeIds, ['b', 'a'])
    assert.deepEqual(result.points, [
      { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }, { x: 0, y: 0 },
    ])
  })

  it('preserves blocked reason contracts for clearance, missing projections, and disconnected graphs', () => {
    const narrow: Graph = { nodes: [node('a', 0, 40), node('b', 100, 40)], edges: [edge('ab', 'a', 'b', [{ x: 0, y: 40 }, { x: 100, y: 40 }])], obstacles: [wall] }
    assert.deepEqual(findGraphPath(narrow, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 42 }), { status: 'blocked', reason: 'channel-too-narrow' })

    const missing: Graph = { nodes: [node('a', 0, 0)], edges: [], obstacles: [{ points: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }] }] }
    assert.deepEqual(findGraphPath(missing, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 42 }), { status: 'blocked', reason: 'no-nearest-node' })

    const disconnected: Graph = { nodes: [node('a', 0, 60), node('b', 100, 60)], edges: [], obstacles: [wall] }
    assert.deepEqual(findGraphPath(disconnected, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 42 }), { status: 'blocked', reason: 'disconnected' })
  })
})
