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
})
