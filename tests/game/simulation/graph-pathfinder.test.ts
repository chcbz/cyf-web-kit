import assert from 'node:assert/strict'
import { describe, it } from 'mocha'

import type { MapRuntimeData } from '../../../src/game/map/movementSchema.js'
import {
  createGraphPathfinder, findGraphPath,
} from '../../../src/game/simulation/graphPathfinder.js'

type Graph = Pick<MapRuntimeData, 'nodes' | 'edges' | 'obstacles'>

function weightedGraph(): Graph {
  return {
    nodes: [
      { stableId: 'a', point: { x: 0, y: 0 }, kind: 'junction', channelWidth: 48 },
      { stableId: 'b', point: { x: 50, y: 0 }, kind: 'normal', channelWidth: 48 },
      { stableId: 'c', point: { x: 0, y: 40 }, kind: 'normal', channelWidth: 48 },
      { stableId: 'd', point: { x: 100, y: 0 }, kind: 'doorway', channelWidth: 48 },
    ],
    edges: [
      edge('ab', 'a', 'b', [{ x: 0, y: 0 }, { x: 50, y: 0 }], 2),
      edge('bd', 'b', 'd', [{ x: 50, y: 0 }, { x: 100, y: 0 }], 2),
      edge('ac', 'a', 'c', [{ x: 0, y: 0 }, { x: 0, y: 40 }]),
      edge('cd', 'c', 'd', [{ x: 0, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 0 }], 0.5),
    ],
    obstacles: [],
  }
}

describe('graph pathfinder', () => {
  it('selects the lowest polyline distance times multiplier path and keeps exact endpoints', () => {
    const result = findGraphPath(
      weightedGraph(), { x: -10, y: 0 }, { x: 110, y: 0 }, { colliderWidth: 36 },
    )

    assert.equal(result.status, 'found')
    if (result.status !== 'found') return
    assert.deepEqual(result.nodeIds, ['a', 'c', 'd'])
    assert.equal(result.cost, 110)
    assert.deepEqual(result.points, [
      { x: -10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 40 },
      { x: 100, y: 40 }, { x: 100, y: 0 }, { x: 110, y: 0 },
    ])
  })

  it('rejects channels narrower than the collider with a specific blocked reason', () => {
    const graph = weightedGraph()
    graph.nodes = graph.nodes.map(node => node.stableId === 'c'
      ? { ...node, channelWidth: 20 }
      : node)
    graph.edges = graph.edges.filter(edge => edge.stableId === 'ac' || edge.stableId === 'cd')

    assert.deepEqual(
      findGraphPath(graph, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 36 }),
      { status: 'blocked', reason: 'channel-too-narrow' },
    )
  })

  it('supports bidirectional traversal and exposes a replaceable PathFinder interface', () => {
    const graph: Graph = {
      nodes: [
        { stableId: 'a', point: { x: 0, y: 0 }, kind: 'normal', channelWidth: 48 },
        { stableId: 'b', point: { x: 100, y: 0 }, kind: 'normal', channelWidth: 48 },
      ],
      edges: [edge('ab', 'a', 'b', [{ x: 0, y: 0 }, { x: 60, y: 20 }, { x: 100, y: 0 }], 1, true)],
      obstacles: [],
    }

    const result = createGraphPathfinder(graph).find(
      { x: 110, y: 0 }, { x: -10, y: 0 }, { colliderWidth: 36 },
    )

    assert.equal(result.status, 'found')
    if (result.status !== 'found') return
    assert.deepEqual(result.nodeIds, ['b', 'a'])
    assert.deepEqual(result.points, [
      { x: 110, y: 0 }, { x: 100, y: 0 }, { x: 60, y: 20 },
      { x: 0, y: 0 }, { x: -10, y: 0 },
    ])
  })

  it('excludes obstacle-crossing edges and uses the clear route', () => {
    const graph = weightedGraph()
    graph.edges = graph.edges.map(candidate => ({ ...candidate, costMultiplier: 1 }))
    graph.obstacles = [{ points: [
      { x: 40, y: -10 }, { x: 60, y: -10 }, { x: 60, y: 10 }, { x: 40, y: 10 },
    ] }]

    const result = findGraphPath(graph, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 36 })

    assert.equal(result.status, 'found')
    if (result.status !== 'found') return
    assert.deepEqual(result.nodeIds, ['a', 'c', 'd'])
  })

  it('uses stable node IDs to break equal-cost ties regardless of source ordering', () => {
    const graph = weightedGraph()
    graph.edges = graph.edges.map(candidate => ({
      ...candidate,
      costMultiplier: candidate.stableId === 'cd' ? 60 / 140 : 1,
    })).reverse()
    graph.nodes.reverse()

    const result = findGraphPath(graph, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 36 })

    assert.equal(result.status, 'found')
    if (result.status !== 'found') return
    assert.deepEqual(result.nodeIds, ['a', 'b', 'd'])
  })

  it('routes both projections through their shared nearest graph node', () => {
    const graph: Graph = {
      nodes: [
        { stableId: 'anchor', point: { x: 50, y: 20 }, kind: 'normal', channelWidth: 48 },
      ],
      edges: [],
      obstacles: [],
    }

    const result = findGraphPath(graph, { x: 40, y: 0 }, { x: 60, y: 0 }, { colliderWidth: 36 })

    assert.equal(result.status, 'found')
    if (result.status !== 'found') return
    assert.deepEqual(result.points, [{ x: 40, y: 0 }, { x: 50, y: 20 }, { x: 60, y: 0 }])
    assert.deepEqual(result.nodeIds, ['anchor'])
    assert.equal(result.cost, 0)
  })

  it('distinguishes invisible projections from disconnected reachable nodes', () => {
    const graph: Graph = {
      nodes: [
        { stableId: 'a', point: { x: 0, y: 0 }, kind: 'normal', channelWidth: 48 },
        { stableId: 'b', point: { x: 100, y: 0 }, kind: 'normal', channelWidth: 48 },
      ],
      edges: [],
      obstacles: [],
    }
    assert.deepEqual(
      findGraphPath(graph, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 36 }),
      { status: 'blocked', reason: 'disconnected' },
    )

    graph.obstacles = [{ points: [
      { x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 },
    ] }]
    assert.deepEqual(
      findGraphPath(graph, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 36 }),
      { status: 'blocked', reason: 'no-nearest-node' },
    )
  })
})

function edge(
  stableId: string,
  from: string,
  to: string,
  points: Array<{ x: number, y: number }>,
  costMultiplier = 1,
  bidirectional = false,
): Graph['edges'][number] {
  return { stableId, from, to, points, costMultiplier, bidirectional }
}
