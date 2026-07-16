import assert from 'node:assert/strict'
import { describe, it } from 'mocha'

import {
  createMovementCommandQueue,
  type MovementCommand,
} from '../../../src/game/simulation/movementCommandQueue.js'

const command = (overrides: Partial<MovementCommand> = {}): MovementCommand => ({
  commandId: 'songjiang:1',
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

describe('movement command queue', () => {
  it('rejects duplicate command IDs and non-increasing state versions per agent', () => {
    const queue = createMovementCommandQueue()
    assert.equal(queue.push(command()).accepted, true)
    assert.deepEqual(queue.push(command()), { accepted: false, reason: 'duplicate-command-id' })
    assert.deepEqual(queue.push(command({ commandId: 'songjiang:same' })), {
      accepted: false, reason: 'stale-state-version',
    })
    assert.deepEqual(queue.push(command({ commandId: 'songjiang:older', stateVersion: 0 })), {
      accepted: false, reason: 'stale-state-version',
    })
  })

  it('replaces an older pending command when a newer agent state arrives', () => {
    const queue = createMovementCommandQueue()
    queue.push(command())

    const result = queue.push(command({
      commandId: 'songjiang:2', stateVersion: 2, targetRegionId: 'bounty-board',
    }))

    assert.deepEqual(result, { accepted: true, replacedCommandId: 'songjiang:1' })
    assert.equal(queue.size, 1)
    assert.equal(queue.peek()?.commandId, 'songjiang:2')
  })

  it('orders higher priority first with deterministic state, time, and ID tie breaking', () => {
    const queue = createMovementCommandQueue()
    queue.push(command({ commandId: 'agent-b:3', agentId: 'agent-b', personaCode: 'wuyong', priority: 5, stateVersion: 3 }))
    queue.push(command({ commandId: 'agent-c:2', agentId: 'agent-c', personaCode: 'linchong', priority: 20, stateVersion: 2 }))
    queue.push(command({ commandId: 'agent-a:4', agentId: 'agent-a', personaCode: 'songjiang', priority: 20, stateVersion: 4 }))
    queue.push(command({
      commandId: 'agent-d:a', agentId: 'agent-d', personaCode: 'luzhishen', priority: 20, stateVersion: 4,
      startedAt: '2026-07-17T07:59:00.000Z',
    }))
    queue.push(command({
      commandId: 'agent-e:b', agentId: 'agent-e', personaCode: 'wusong', priority: 20, stateVersion: 4,
      startedAt: '2026-07-17T07:59:00.000Z',
    }))

    assert.deepEqual(queue.snapshot().map(item => item.commandId), [
      'agent-d:a', 'agent-e:b', 'agent-a:4', 'agent-c:2', 'agent-b:3',
    ])
  })

  it('retains duplicate and state-version watermarks after dequeue', () => {
    const queue = createMovementCommandQueue()
    queue.push(command())
    assert.equal(queue.shift()?.commandId, 'songjiang:1')
    assert.equal(queue.size, 0)
    assert.deepEqual(queue.push(command()), { accepted: false, reason: 'duplicate-command-id' })
    assert.deepEqual(queue.push(command({ commandId: 'songjiang:stale' })), {
      accepted: false, reason: 'stale-state-version',
    })
  })

  it('publishes defensive command copies', () => {
    const queue = createMovementCommandQueue()
    const source = command()
    queue.push(source)
    source.targetRegionId = 'mutated-source'
    const first = queue.peek()!
    first.targetRegionId = 'mutated-publication'

    assert.equal(queue.peek()?.targetRegionId, 'council-table')
    assert.equal(queue.shift()?.targetRegionId, 'council-table')
  })
})
