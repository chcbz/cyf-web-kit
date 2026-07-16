import assert from 'node:assert/strict'

import {
  adaptBackendState,
  normalizedProgress,
  recoverMovementProgress,
  type BackendAgentSceneState,
} from '../../../src/game/simulation/backendSceneStateAdapter.js'
import type { MapRuntimeData } from '../../../src/game/map/movementSchema.js'

describe('backend scene state adapter', () => {
  const start = '2026-07-11T09:59:50+08:00'
  const arrival = '2026-07-11T10:00:10+08:00'
  const now = Date.parse('2026-07-11T10:00:00+08:00')

  it('normalizes recovery time at zero, halfway, target and overdue boundaries', () => {
    assert.equal(normalizedProgress(start, arrival, Date.parse(start) - 1), 0)
    assert.equal(normalizedProgress(start, arrival, now), 0.5)
    assert.equal(normalizedProgress(start, arrival, Date.parse(arrival)), 1)
    assert.equal(normalizedProgress(start, arrival, Date.parse(arrival) + 60_000), 1)
  })

  it('interpolates by cumulative path length rather than point index', () => {
    const state = sceneState()
    const recovery = recoverMovementProgress(state, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 90 },
    ], now)

    assert.equal(recovery.progress, 0.5)
    assert.deepEqual(recovery.point, { x: 10, y: 40 })
    assert.equal(recovery.distance, 50)
    assert.equal(recovery.totalLength, 100)
  })

  it('places overdue recovery at the exact target and handles degenerate paths', () => {
    const state = sceneState()
    assert.deepEqual(recoverMovementProgress(state, [
      { x: 0, y: 0 }, { x: 50, y: 0 },
    ], Date.parse(arrival) + 1).point, { x: 50, y: 0 })
    assert.deepEqual(recoverMovementProgress(state, [{ x: 7, y: 9 }], now).point, { x: 7, y: 9 })
    assert.equal(recoverMovementProgress(state, [], now).point, undefined)
  })

  it('fails timestamp edge cases closed without returning NaN progress', () => {
    assert.equal(normalizedProgress(start, undefined, now), 0)
    assert.equal(normalizedProgress('invalid', arrival, now), 0)
    assert.equal(normalizedProgress(start, 'invalid', now), 0)
    assert.equal(normalizedProgress(start, start, Date.parse(start)), 0)
    assert.equal(normalizedProgress(start, start, Date.parse(start) + 1), 1)
    assert.equal(normalizedProgress(start, arrival, Number.NaN), 0)
  })

  it('maps semantic target movement to a stable backend command', () => {
    const adapted = adaptBackendState(sceneState(), runtime(), now)

    assert.equal(adapted.blockedReason, undefined)
    assert.deepEqual(adapted.command, {
      commandId: 'agent-songjiang:16:target',
      agentId: 'agent-songjiang',
      personaCode: 'songjiang',
      source: 'backend',
      type: 'MOVE_TO_REGION',
      targetRegionId: 'council-table',
      priority: 10,
      stateVersion: 16,
      startedAt: start,
      expectedArrivalAt: arrival,
      expiresAt: '2026-07-11T10:05:00+08:00',
    })
  })

  it('returns expired or completed semantic state to the persona home', () => {
    const expired = adaptBackendState(
      sceneState(), runtime(), Date.parse('2026-07-11T10:05:00+08:00'),
    )
    assert.equal(expired.command?.type, 'RETURN_HOME')
    assert.equal(expired.command?.targetRegionId, 'main-seat')
    assert.equal(expired.command?.commandId, 'agent-songjiang:16:home')

    const completed = adaptBackendState({
      ...sceneState(), behavior: 'completed', expiresAt: undefined,
    }, runtime(), now)
    assert.equal(completed.command?.type, 'RETURN_HOME')
    assert.equal(completed.command?.targetRegionId, 'main-seat')
  })

  it('blocks missing target or home regions without substituting another region', () => {
    const missingTarget = adaptBackendState({
      ...sceneState(), targetRegionId: 'removed-region',
    }, runtime(), now)
    assert.deepEqual(missingTarget, { blockedReason: 'unknown-region' })

    const noHome = runtime()
    noHome.slots = noHome.slots.filter(slot => slot.kind !== 'home')
    const expiredWithoutHome = adaptBackendState(
      sceneState(), noHome, Date.parse('2026-07-11T10:05:00+08:00'),
    )
    assert.deepEqual(expiredWithoutHome, { blockedReason: 'unknown-region' })
  })

  function sceneState(): BackendAgentSceneState {
    return {
      agentId: 'agent-songjiang',
      personaCode: 'songjiang',
      behavior: 'moving_to_discussion',
      targetRegionId: 'council-table',
      stateVersion: 16,
      startedAt: start,
      expectedArrivalAt: arrival,
      expiresAt: '2026-07-11T10:05:00+08:00',
    }
  }

  function runtime(): MapRuntimeData {
    return {
      sceneId: 'juyiting-main',
      movementSchemaVersion: '1',
      navGraphVersion: 'juyiting-main-v1',
      spriteManifestVersion: 'persona-sheets-v1',
      width: 1000,
      height: 600,
      nodes: [],
      edges: [],
      obstacles: [],
      regions: [
        region('main-seat'),
        region('council-table'),
        region('unrelated-region'),
      ],
      slots: [{
        stableId: 'home-songjiang-v1',
        slotId: 'home-songjiang',
        regionId: 'main-seat',
        point: { x: 50, y: 50 },
        kind: 'home',
        personaCode: 'songjiang',
      }],
    }
  }

  function region(regionId: string): MapRuntimeData['regions'][number] {
    return {
      stableId: `region-${regionId}-v1`,
      regionId,
      polygon: { points: [] },
      label: regionId,
      capacity: 1,
      protected: false,
      riskLevel: 'low',
    }
  }
})
