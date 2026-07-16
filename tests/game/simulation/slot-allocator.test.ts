import assert from 'node:assert/strict'
import { describe, it } from 'mocha'

import type { Slot } from '../../../src/game/map/movementSchema.js'
import {
  createSlotAllocator,
  type MovementSlotOwner,
} from '../../../src/game/simulation/slotAllocator.js'
import type { MovementCommand } from '../../../src/game/simulation/movementCommandQueue.js'

const slots: Slot[] = [
  {
    stableId: 'slot-council-b', slotId: 'council-b', regionId: 'council-table',
    point: { x: 200, y: 100 }, kind: 'parking',
  },
  {
    stableId: 'home-songjiang', slotId: 'home-songjiang', regionId: 'main-seat',
    personaCode: 'songjiang', point: { x: 50, y: 50 }, kind: 'home',
  },
  {
    stableId: 'slot-council-a', slotId: 'council-a', regionId: 'council-table',
    point: { x: 180, y: 100 }, kind: 'parking',
  },
  {
    stableId: 'queue-council', slotId: 'council-queue', regionId: 'council-table',
    point: { x: 160, y: 100 }, kind: 'queue',
  },
]

const command = (overrides: Partial<MovementCommand> = {}): MovementCommand => ({
  commandId: 'command-1',
  agentId: 'agent-songjiang',
  personaCode: 'songjiang',
  source: 'backend',
  type: 'MOVE_TO_REGION',
  targetRegionId: 'council-table',
  priority: 10,
  stateVersion: 1,
  startedAt: '2026-07-17T08:00:00.000Z',
  ...overrides,
})

describe('slot allocator', () => {
  it('resolves persona homes and deterministically reserves parking slots', () => {
    const allocator = createSlotAllocator(slots)

    assert.equal(allocator.homeFor('songjiang')?.regionId, 'main-seat')
    assert.equal(allocator.homeFor('unknown'), null)
    assert.equal(allocator.reserve('council-table', command())?.slotId, 'council-a')
    assert.equal(allocator.reserve('council-table', command({
      commandId: 'command-2', agentId: 'agent-wuyong', personaCode: 'wuyong', stateVersion: 2,
    }))?.slotId, 'council-b')
  })

  it('tracks ownership, prevents foreign release, and exposes immutable owner copies', () => {
    const allocator = createSlotAllocator(slots)
    const reserved = allocator.reserve('council-table', command())
    assert.ok(reserved)

    const owner = allocator.occupant(reserved.slotId)
    assert.deepEqual(owner, { agentId: 'agent-songjiang', commandId: 'command-1' })
    ;(owner as MovementSlotOwner).agentId = 'mutated'
    assert.equal(allocator.occupant(reserved.slotId)?.agentId, 'agent-songjiang')
    assert.equal(allocator.release(reserved.slotId, 'agent-wuyong'), false)
    assert.equal(allocator.occupant(reserved.slotId)?.agentId, 'agent-songjiang')
    assert.equal(allocator.release(reserved.slotId, 'agent-songjiang'), true)
    assert.equal(allocator.occupant(reserved.slotId), null)
  })

  it('uses the persona home for return commands and moves one agent ownership atomically', () => {
    const allocator = createSlotAllocator(slots)
    const parking = allocator.reserve('council-table', command())
    assert.equal(parking?.kind, 'parking')

    const home = allocator.reserve('main-seat', command({
      commandId: 'command-home', type: 'RETURN_HOME', targetRegionId: 'main-seat', stateVersion: 2,
    }))

    assert.equal(home?.slotId, 'home-songjiang')
    assert.equal(allocator.occupant(parking!.slotId), null)
    assert.equal(allocator.occupant(home!.slotId)?.commandId, 'command-home')
  })

  it('returns null without substituting queue, occupied, foreign-home, or unknown slots', () => {
    const allocator = createSlotAllocator(slots)
    allocator.reserve('council-table', command())
    allocator.reserve('council-table', command({
      commandId: 'command-2', agentId: 'agent-wuyong', personaCode: 'wuyong', stateVersion: 2,
    }))

    assert.equal(allocator.reserve('council-table', command({
      commandId: 'command-3', agentId: 'agent-linchong', personaCode: 'linchong', stateVersion: 3,
    })), null)
    assert.equal(allocator.reserve('missing-region', command()), null)
    assert.equal(allocator.reserve('main-seat', command({
      commandId: 'foreign-home', agentId: 'agent-wuyong', personaCode: 'wuyong',
      type: 'RETURN_HOME', targetRegionId: 'main-seat', stateVersion: 4,
    })), null)
  })

  it('uses locale-independent code-unit slot ordering', () => {
    const allocator = createSlotAllocator([
      {
        stableId: 'a-slot', slotId: 'a-slot', regionId: 'council-table',
        point: { x: 20, y: 0 }, kind: 'parking',
      },
      {
        stableId: 'Z-slot', slotId: 'Z-slot', regionId: 'council-table',
        point: { x: 10, y: 0 }, kind: 'parking',
      },
    ])

    assert.equal(allocator.reserve('council-table', command())?.slotId, 'Z-slot')
  })
})
