import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import type { MapRuntimeData } from '../../../src/game/map/movementSchema.js'
import { validateMapRuntime } from '../../../src/game/map/mapValidation.js'

function validMap(): MapRuntimeData {
  return {
    sceneId: 'juyiting-main',
    movementSchemaVersion: '1',
    navGraphVersion: 'juyiting-main-v1',
    spriteManifestVersion: 'sprites-v1',
    width: 1664,
    height: 928,
    regions: [
      {
        stableId: 'region-main-v1', regionId: 'main-seat', label: 'Main seat', capacity: 6,
        protected: true, riskLevel: 'low',
        polygon: { points: [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 180 }, { x: 0, y: 180 }] },
      },
      {
        stableId: 'region-library-v1', regionId: 'library-shelf', label: 'Library', capacity: 4,
        protected: false, riskLevel: 'low',
        polygon: { points: [{ x: 220, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 180 }, { x: 220, y: 180 }] },
      },
    ],
    nodes: [
      { stableId: 'node-main', point: { x: 90, y: 90 }, kind: 'junction', channelWidth: 72 },
      { stableId: 'node-hall', point: { x: 200, y: 90 }, kind: 'normal', channelWidth: 48 },
      { stableId: 'node-library', point: { x: 310, y: 90 }, kind: 'doorway', channelWidth: 48 },
    ],
    edges: [
      {
        stableId: 'edge-main-hall', from: 'node-main', to: 'node-hall', bidirectional: true,
        costMultiplier: 1, points: [{ x: 90, y: 90 }, { x: 200, y: 90 }],
      },
      {
        stableId: 'edge-hall-library', from: 'node-hall', to: 'node-library', bidirectional: true,
        costMultiplier: 1.25, points: [{ x: 200, y: 90 }, { x: 310, y: 90 }],
      },
    ],
    slots: [
      {
        stableId: 'home-songjiang', slotId: 'home-songjiang', regionId: 'main-seat',
        personaCode: 'songjiang', point: { x: 60, y: 90 }, kind: 'home',
      },
      {
        stableId: 'slot-library-parking', slotId: 'library-parking-1', regionId: 'library-shelf',
        point: { x: 340, y: 90 }, kind: 'parking',
      },
    ],
    obstacles: [{ points: [{ x: 500, y: 500 }, { x: 520, y: 500 }, { x: 520, y: 520 }, { x: 500, y: 520 }] }],
  }
}

function errorCodes(map: MapRuntimeData): string[] {
  return validateMapRuntime(map).errors.map(error => error.code)
}

describe('map validation', () => {
  it('accepts a connected Juyiting movement map', () => {
    assert.deepEqual(validateMapRuntime(validMap()), { valid: true, errors: [], warnings: [] })
  })

  it('blocks initialization for unsupported schema or scene, disconnected navigation, and unreachable regions', () => {
    const map = validMap()
    map.movementSchemaVersion = '2'
    map.sceneId = 'another-scene'
    map.edges = [map.edges[0]]
    map.slots = map.slots.filter(slot => slot.regionId !== 'library-shelf')

    const result = validateMapRuntime(map)

    assert.equal(result.valid, false)
    assert.deepEqual(result.errors.map(error => error.code), [
      'CORE_REGION_UNREACHABLE',
      'MOVEMENT_SCHEMA_INVALID',
      'NAV_GRAPH_DISCONNECTED',
      'SCENE_ID_INVALID',
    ])
    assert.match(
      result.errors.find(error => error.code === 'CORE_REGION_UNREACHABLE')?.technicalMessage ?? '',
      /library-shelf/,
    )
    assert.ok(result.errors.every(error => error.severity === 'fatal' && error.source === 'map'))
  })

  it('rejects duplicate identities, invalid references and costs, and an invalid Songjiang home', () => {
    const map = validMap()
    map.regions[1].stableId = map.nodes[0].stableId
    map.regions[1].regionId = map.regions[0].regionId
    map.nodes[1].channelWidth = 0
    map.edges[0].to = 'node-missing'
    map.edges[0].costMultiplier = 0
    map.slots.push({
      ...map.slots[0], stableId: 'home-songjiang-copy', slotId: 'home-songjiang-copy',
    })

    assert.deepEqual(errorCodes(map), [
      'CORE_REGION_UNREACHABLE',
      'EDGE_COST_INVALID',
      'EDGE_ENDPOINT_MISSING',
      'NAV_GRAPH_DISCONNECTED',
      'NODE_CHANNEL_WIDTH_INVALID',
      'REGION_ID_DUPLICATE',
      'SONGJIANG_HOME_INVALID',
      'STABLE_ID_DUPLICATE',
    ])
  })

  it('rejects obstacle-crossing edges, blocked region slots, and collider-incompatible channels', () => {
    const map = validMap()
    map.nodes[1].channelWidth = 20
    map.obstacles = [
      { points: [{ x: 140, y: 70 }, { x: 160, y: 70 }, { x: 160, y: 110 }, { x: 140, y: 110 }] },
      { points: [{ x: 325, y: 75 }, { x: 355, y: 75 }, { x: 355, y: 105 }, { x: 325, y: 105 }] },
    ]

    const result = validateMapRuntime(map)

    assert.deepEqual(result.errors.map(error => error.code), [
      'CHANNEL_WIDTH_INCOMPATIBLE',
      'CORE_REGION_UNREACHABLE',
      'EDGE_INTERSECTS_OBSTACLE',
      'NAV_GRAPH_DISCONNECTED',
    ])
    assert.match(
      result.errors.find(error => error.code === 'CORE_REGION_UNREACHABLE')?.technicalMessage ?? '',
      /library-shelf/,
    )
  })

  it('returns errors deterministically by code then technical message', () => {
    const map = validMap()
    map.edges[0].costMultiplier = 0
    map.edges[1].costMultiplier = -1

    const errors = validateMapRuntime(map).errors

    assert.deepEqual(errors, [...errors].sort((left, right) => (
      left.code.localeCompare(right.code)
      || (left.technicalMessage ?? '').localeCompare(right.technicalMessage ?? '')
    )))
    const costErrors = errors.filter(error => error.code === 'EDGE_COST_INVALID')
    assert.equal(costErrors.length, 2)
    assert.deepEqual(
      costErrors.map(error => error.technicalMessage),
      [...costErrors.map(error => error.technicalMessage)].sort(),
    )
  })

  for (const [label, points] of [
    ['empty', []],
    ['reversed', [{ x: 200, y: 90 }, { x: 90, y: 90 }]],
    ['remote', [{ x: 120, y: 120 }, { x: 180, y: 120 }]],
  ] satisfies Array<[string, MapRuntimeData['edges'][number]['points']]>) {
    it(`rejects ${label} edge runtime geometry`, () => {
      const map = validMap()
      map.edges[0].points = points
      const geometryErrors = validateMapRuntime(map).errors.filter(error => error.code === 'EDGE_GEOMETRY_INVALID')
      assert.equal(geometryErrors.length, 1, label)
      assert.match(geometryErrors[0].technicalMessage ?? '', /edge-main-hall/)
    })
  }

  it('accepts edge endpoints within two world pixels when connector gaps are clear', () => {
    const map = validMap()
    map.edges[1].points = [{ x: 201.5, y: 90 }, { x: 310, y: 90 }]

    assert.deepEqual(validateMapRuntime(map), { valid: true, errors: [], warnings: [] })
  })

  for (const [connector, points, obstacle] of [
    [
      'from-node',
      [{ x: 201.5, y: 90 }, { x: 310, y: 90 }],
      { points: [{ x: 200.25, y: 85 }, { x: 200.75, y: 85 }, { x: 200.75, y: 95 }, { x: 200.25, y: 95 }] },
    ],
    [
      'to-node',
      [{ x: 200, y: 90 }, { x: 308.5, y: 90 }],
      { points: [{ x: 309.25, y: 85 }, { x: 309.75, y: 85 }, { x: 309.75, y: 95 }, { x: 309.25, y: 95 }] },
    ],
  ] satisfies Array<[string, MapRuntimeData['edges'][number]['points'], MapRuntimeData['obstacles'][number]]>) {
    it(`rejects an obstacle in the ${connector} edge connector`, () => {
      const map = validMap()
      map.edges[1].points = points
      map.obstacles = [obstacle]

      const errors = validateMapRuntime(map).errors.filter(error => error.code === 'EDGE_INTERSECTS_OBSTACLE')
      assert.equal(errors.length, 1)
      assert.match(errors[0].technicalMessage ?? '', /edge-hall-library/)
    })
  }

  it('accepts one-way edges when an alternate directed return route completes the round trip', () => {
    const map = validMap()
    map.edges.forEach(edge => { edge.bidirectional = false })
    map.edges.push({
      stableId: 'edge-library-main-return', from: 'node-library', to: 'node-main', bidirectional: false,
      costMultiplier: 1, points: [{ x: 310, y: 90 }, { x: 90, y: 90 }],
    })

    assert.deepEqual(validateMapRuntime(map), { valid: true, errors: [], warnings: [] })
  })

  it('rejects a one-way chain whose core targets cannot return to Songjiang home', () => {
    const map = validMap()
    map.edges.forEach(edge => { edge.bidirectional = false })

    const result = validateMapRuntime(map)

    assert.ok(result.errors.some(error => error.code === 'NAV_GRAPH_DISCONNECTED'))
    assert.match(
      result.errors.find(error => error.code === 'NAV_GRAPH_DISCONNECTED')?.technicalMessage ?? '',
      /cannot return to Songjiang anchor node-main.*node-library/s,
    )
  })

  it('projects a slot to the nearest visible round-trip node instead of a nearer ineligible node', () => {
    const map = validMap()
    map.slots[1].point = { x: 390, y: 175 }
    map.nodes.push({ stableId: 'node-dead-end', point: { x: 390, y: 181 }, kind: 'normal', channelWidth: 48 })
    map.edges.push({
      stableId: 'edge-dead-end-main', from: 'node-dead-end', to: 'node-main', bidirectional: false,
      costMultiplier: 1, points: [{ x: 390, y: 181 }, { x: 90, y: 90 }],
    })

    assert.deepEqual(validateMapRuntime(map), { valid: true, errors: [], warnings: [] })
  })

  it('chooses the nearest viable Songjiang anchor that satisfies the complete round-trip contract', () => {
    const map = validMap()
    map.nodes[0].point = { x: 170, y: 90 }
    map.edges[0].points = [{ x: 170, y: 90 }, { x: 200, y: 90 }]
    map.nodes.push({ stableId: 'node-nearest-dead', point: { x: 60, y: -5 }, kind: 'normal', channelWidth: 48 })

    assert.deepEqual(validateMapRuntime(map), { valid: true, errors: [], warnings: [] })
  })

  it('rejects directed regions that cannot be reached from the Songjiang anchor', () => {
    const map = validMap()
    map.edges = [
      {
        ...map.edges[0], from: 'node-hall', to: 'node-main', bidirectional: false,
        points: [{ x: 200, y: 90 }, { x: 90, y: 90 }],
      },
      {
        ...map.edges[1], from: 'node-library', to: 'node-hall', bidirectional: false,
        points: [{ x: 310, y: 90 }, { x: 200, y: 90 }],
      },
    ]

    const result = validateMapRuntime(map)

    assert.deepEqual(result.errors.map(error => error.code), ['NAV_GRAPH_DISCONNECTED'])
    assert.match(result.errors[0].technicalMessage ?? '', /Songjiang anchor node-main.*node-library/s)
  })

  it('rejects a Songjiang home with a missing region even when another slot is usable', () => {
    const map = validMap()
    map.slots[0].regionId = 'missing-region'
    map.slots.push({
      stableId: 'slot-main-parking', slotId: 'main-parking-1', regionId: 'main-seat',
      point: { x: 70, y: 90 }, kind: 'parking',
    })

    const homeError = validateMapRuntime(map).errors.find(error => error.code === 'SONGJIANG_HOME_INVALID')
    assert.match(homeError?.technicalMessage ?? '', /missing-region/)
  })

  it('rejects a Songjiang home outside its region even when another slot is usable', () => {
    const map = validMap()
    map.slots[0].point = { x: 200, y: 150 }
    map.slots.push({
      stableId: 'slot-main-parking', slotId: 'main-parking-1', regionId: 'main-seat',
      point: { x: 70, y: 90 }, kind: 'parking',
    })

    const homeError = validateMapRuntime(map).errors.find(error => error.code === 'SONGJIANG_HOME_INVALID')
    assert.match(homeError?.technicalMessage ?? '', /outside region main-seat/)
  })

  for (const [position, point] of [
    ['inside', { x: 60, y: 90 }],
    ['on the boundary of', { x: 50, y: 90 }],
  ] as const) {
    it(`rejects a Songjiang home ${position} an obstacle`, () => {
      const map = validMap()
      map.slots[0].point = point
      map.obstacles = [{
        points: [{ x: 50, y: 80 }, { x: 70, y: 80 }, { x: 70, y: 100 }, { x: 50, y: 100 }],
      }]
      map.slots.push({
        stableId: 'slot-main-parking', slotId: 'main-parking-1', regionId: 'main-seat',
        point: { x: 100, y: 120 }, kind: 'parking',
      })

      const homeError = validateMapRuntime(map).errors.find(error => error.code === 'SONGJIANG_HOME_INVALID')
      assert.match(homeError?.technicalMessage ?? '', /obstacle 0/)
    })
  }

  it('rejects a Songjiang home that cannot connect to the graph even when another slot is usable', () => {
    const map = validMap()
    map.obstacles = [{
      points: [{ x: 70, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 180 }, { x: 70, y: 180 }],
    }]
    map.slots.push({
      stableId: 'slot-main-parking', slotId: 'main-parking-1', regionId: 'main-seat',
      point: { x: 100, y: 120 }, kind: 'parking',
    })

    const homeError = validateMapRuntime(map).errors.find(error => error.code === 'SONGJIANG_HOME_INVALID')
    assert.match(homeError?.technicalMessage ?? '', /cannot connect to a usable navigation node/)
  })

  it('accepts a Songjiang home on its region boundary', () => {
    const map = validMap()
    map.slots[0].point = { x: 0, y: 90 }

    assert.deepEqual(validateMapRuntime(map), { valid: true, errors: [], warnings: [] })
  })

  for (const [label, reason, obstacle] of [
    ['too-short', 'at least three finite points', { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }],
    ['non-finite', 'finite points', { points: [{ x: 1, y: 1 }, { x: Number.NaN, y: 2 }, { x: 3, y: 1 }] }],
    ['zero-area', 'non-zero area', { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] }],
  ] satisfies Array<[string, string, MapRuntimeData['obstacles'][number]]>) {
    it(`rejects ${label} obstacle polygons deterministically`, () => {
      const map = validMap()
      map.obstacles = [obstacle]
      const errors = validateMapRuntime(map).errors.filter(error => error.code === 'OBSTACLE_GEOMETRY_INVALID')
      assert.equal(errors.length, 1, reason)
      assert.equal(errors[0].technicalMessage, `Obstacle 0 must contain ${reason}.`)
    })
  }
})
