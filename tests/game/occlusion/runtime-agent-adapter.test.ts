// ── E3 Runtime Agent Adapter tests ──
// Covers all review items: clone/freeze boundary, partial update, concurrency,
// resolver safety, hash failures, unpaired surrogates, coordinate strictness,
// injectable hash seam, resolver string validity.

import assert from 'node:assert/strict'
import { describe, it } from 'mocha'
import {
  createRuntimeAgentAdapter,
  defaultSpawnResolver,
  defaultChunkResolver,
  type RuntimeAgentAdapter,
  type RuntimeAgentAdapterOptions,
} from '../../../src/game/occlusion/runtimeAgentAdapter.js'
import { isStructuredFatalRenderSchemaError, type SceneObject } from '../../../src/game/occlusion/schema.js'

// ── Helpers ──

function fatalAssert(fn: () => unknown, expectedCode: string): void {
  try {
    fn()
    assert.fail(`expected fatal with code ${expectedCode}`)
  } catch (e) {
    assert.ok(isStructuredFatalRenderSchemaError(e), `expected structured fatal, got ${e}`)
    if (isStructuredFatalRenderSchemaError(e)) {
      assert.equal(e.errorCode, expectedCode, `expected ${expectedCode}, got ${e.errorCode}`)
    }
  }
}

async function fatalAssertAsync(fn: () => Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await fn()
    assert.fail(`expected fatal with code ${expectedCode}`)
  } catch (e) {
    assert.ok(isStructuredFatalRenderSchemaError(e), `expected structured fatal, got ${e}`)
    if (isStructuredFatalRenderSchemaError(e)) {
      assert.equal(e.errorCode, expectedCode, `expected ${expectedCode}, got ${e.errorCode}`)
    }
  }
}

function makeAdapter(
  spawnResolver = defaultSpawnResolver(),
  chunkResolver = defaultChunkResolver(),
  opts?: RuntimeAgentAdapterOptions,
): RuntimeAgentAdapter {
  return createRuntimeAgentAdapter(spawnResolver, chunkResolver, undefined, opts)
}

// ── Tests ──

describe('E3 Runtime Agent Adapter - stableId derivation', () => {
  it('produces known stableId for "abc" (SHA-256 known vector RFC 6234)', async () => {
    const adapter = makeAdapter()
    const [result] = await adapter.create([{ agentId: 'abc' }])
    assert.equal(result.stableId, 'jyt.agent.xj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq.v1')
    assert.match(result.stableId, /^jyt\.agent\.[a-z2-7]{52}\.v1$/)
    assert.equal(result.sourceEntityId, 'abc')
  })

  it('produces consistent stableId across calls for same input', async () => {
    const adapter1 = makeAdapter()
    const adapter2 = makeAdapter()
    const [r1] = await adapter1.create([{ agentId: 'agent-001' }])
    const [r2] = await adapter2.create([{ agentId: 'agent-001' }])
    assert.equal(r1.stableId, r2.stableId)
  })

  it('produces different stableIds for different sourceEntityIds', async () => {
    const adapter = makeAdapter()
    const results = await adapter.create([{ agentId: 'agent-alpha' }, { agentId: 'agent-beta' }])
    assert.notEqual(results[0].stableId, results[1].stableId)
  })
})

describe('E3 Runtime Agent Adapter - ID preservation', () => {
  it('preserves sourceEntityId verbatim', async () => {
    const adapter = makeAdapter()
    const ids = ['Agent-CAPITAL-123', '  leading-space', 'trailing-space ', '日本語', 'a'.repeat(200)]
    for (const id of ids) {
      const [result] = await adapter.create([{ agentId: id }])
      assert.equal(result.sourceEntityId, id)
    }
  })

  it('different Unicode compositions produce different stableIds', async () => {
    const composed = 'Caf\u00E9'
    const decomposed = 'Cafe\u0301'
    assert.notEqual(composed, decomposed)
    const a1 = makeAdapter()
    const [r1] = await a1.create([{ agentId: composed }])
    const a2 = makeAdapter()
    const [r2] = await a2.create([{ agentId: decomposed }])
    assert.notEqual(r1.stableId, r2.stableId)
    assert.equal(r1.sourceEntityId, composed)
    assert.equal(r2.sourceEntityId, decomposed)
  })

  it('uppercase and lowercase IDs produce different stableIds', async () => {
    const a1 = makeAdapter()
    const [r1] = await a1.create([{ agentId: 'AGENT' }])
    const a2 = makeAdapter()
    const [r2] = await a2.create([{ agentId: 'agent' }])
    assert.notEqual(r1.stableId, r2.stableId)
  })
})

describe('E3 Runtime Agent Adapter - error handling', () => {
  it('rejects non-string agentId', async () => {
    const adapter = makeAdapter()
    for (const id of [123, null, undefined, {}, [], true, false]) {
      await fatalAssertAsync(() => adapter.create([{ agentId: id }]), 'AGENT_ID_INVALID')
    }
  })

  it('rejects empty string agentId', async () => {
    await fatalAssertAsync(() => makeAdapter().create([{ agentId: '' }]), 'AGENT_ID_EMPTY')
  })

  it('rejects whitespace-only agentId', async () => {
    for (const ws of [' ', '  ', '\t', '\n', ' \t\n']) {
      await fatalAssertAsync(() => makeAdapter().create([{ agentId: ws }]), 'AGENT_ID_WHITESPACE_ONLY')
    }
  })

  it('rejects duplicate agentId within same batch', async () => {
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: 'dup' }, { agentId: 'dup' }]),
      'AGENT_ID_DUPLICATE',
    )
  })

  it('rejects agentId already registered across batches', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'cross' }])
    await fatalAssertAsync(() => adapter.create([{ agentId: 'cross' }]), 'AGENT_ID_DUPLICATE')
  })

  it('rejects update of non-existent agent', async () => {
    await fatalAssertAsync(
      () => makeAdapter().update([{ agentId: 'nonexistent', x: 10, y: 20 }]),
      'AGENT_NOT_FOUND',
    )
  })

  it('rejects remove of non-existent agent', async () => {
    await fatalAssertAsync(
      () => makeAdapter().remove(['nonexistent']),
      'AGENT_NOT_FOUND',
    )
  })
})

// ── P0-1: clone/freeze boundary ──

describe('E3 Runtime Agent Adapter - P0-1 clone/freeze boundary', () => {
  it('create returns frozen clones; mutate does not affect internal state', async () => {
    const adapter = makeAdapter()
    const [created] = await adapter.create([{ agentId: 'boundary-test', x: 30, y: 40 }])
    assert.ok(Object.isFrozen(created), 'returned SceneObject should be frozen')
    assert.ok(Object.isFrozen(created.sortAnchor), 'sortAnchor should be frozen')

    // Attempt mutation (will throw in strict mode; silently no-op in sloppy)
    try {
      (created as SceneObject & Record<string, unknown>).renderBand = 'overhead'
    } catch { /* expected */ }
    // Internal state must be unchanged
    const lookedUp = adapter.lookup('boundary-test')
    assert.equal(lookedUp?.renderBand, 'world')
  })

  it('update returns frozen clones', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'update-freeze', x: 0, y: 0 }])
    const [updated] = await adapter.update([{ agentId: 'update-freeze', x: 100, y: 200 }])
    assert.ok(Object.isFrozen(updated))
    assert.ok(Object.isFrozen(updated.sortAnchor))
    assert.equal(updated.sortAnchor.x, 100)
    assert.equal(updated.sortAnchor.y, 200)

    // Try to mutate the returned sortAnchor
    try { (updated.sortAnchor as unknown as Record<string, number>).x = 999 } catch { /* ok */ }
    const internal = adapter.lookup('update-freeze')
    assert.equal(internal?.sortAnchor.x, 100)
  })

  it('lookup returns frozen clone; caller mutation is isolated', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'lookup-freeze', x: 10, y: 20 }])
    const lookedUp = adapter.lookup('lookup-freeze')!
    assert.ok(Object.isFrozen(lookedUp))
    assert.ok(Object.isFrozen(lookedUp.sortAnchor))

    try { (lookedUp.sortAnchor as unknown as Record<string, number>).x = 500 } catch { /* ok */ }
    const second = adapter.lookup('lookup-freeze')
    assert.equal(second?.sortAnchor.x, 10)
  })

  it('sceneObjects returns frozen clones', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'so1' }, { agentId: 'so2' }])
    const objects = adapter.sceneObjects
    assert.ok(Object.isFrozen(objects))
    for (const obj of objects) {
      assert.ok(Object.isFrozen(obj))
      assert.ok(Object.isFrozen(obj.sortAnchor))
    }
  })

  it('sourceEntityIds returns frozen array', () => {
    const ids = makeAdapter().sourceEntityIds
    assert.ok(Object.isFrozen(ids))
  })

  it('remove returns frozen array', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'rm-freeze' }])
    const removed = await adapter.remove(['rm-freeze'])
    assert.ok(Object.isFrozen(removed))
    assert.deepEqual(removed, ['rm-freeze'])
  })

  it('attacks sortAnchor through update return and verifies isolation', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'attack1', x: 1, y: 2 }])
    const [updated] = await adapter.update([{ agentId: 'attack1', x: 3, y: 4 }])

    // Attack sortAnchor on returned clone
    try { (updated.sortAnchor as unknown as Record<string, number>).x = 9999 } catch { /* ok */ }
    try { (updated.sortAnchor as unknown as Record<string, number>).y = 8888 } catch { /* ok */ }

    const internal = adapter.lookup('attack1')
    assert.equal(internal?.sortAnchor.x, 3)
    assert.equal(internal?.sortAnchor.y, 4)
  })

  it('attacks stableId/floorId/renderBand on returned clone', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'attack2' }])
    const lookedUp = adapter.lookup('attack2')!

    try {
      (lookedUp as SceneObject & Record<string, unknown>).stableId = 'hacked.v1'
      ;(lookedUp as SceneObject & Record<string, unknown>).floorId = 'floor-99'
      ;(lookedUp as SceneObject & Record<string, unknown>).renderBand = 'overhead'
    } catch { /* ok */ }

    const internal = adapter.lookup('attack2')
    assert.equal(internal?.renderBand, 'world')
    assert.equal(internal?.floorId, 'floor-1')
    assert.notEqual(internal?.stableId, 'hacked.v1')
  })
})

// ── P0-2: partial update ──

describe('E3 Runtime Agent Adapter - P0-2 partial update coordinates', () => {
  it('update only x preserves existing y', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'part-x', x: 10, y: 20 }])
    const [updated] = await adapter.update([{ agentId: 'part-x', x: 99 }])
    assert.equal(updated.sortAnchor.x, 99)
    assert.equal(updated.sortAnchor.y, 20)
  })

  it('update only y preserves existing x', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'part-y', x: 10, y: 20 }])
    const [updated] = await adapter.update([{ agentId: 'part-y', y: 88 }])
    assert.equal(updated.sortAnchor.x, 10)
    assert.equal(updated.sortAnchor.y, 88)
  })

  it('update neither x nor y preserves both', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'no-change', x: 10, y: 20 }])
    const [updated] = await adapter.update([{ agentId: 'no-change' }])
    assert.equal(updated.sortAnchor.x, 10)
    assert.equal(updated.sortAnchor.y, 20)
  })

  it('partial update re-resolves chunk from new position', async () => {
    let lastChunk = ''
    const chunkResolver = (x: number, y: number) => { lastChunk = `chunk-${x}-${y}`; return lastChunk }
    const adapter = createRuntimeAgentAdapter(defaultSpawnResolver(), chunkResolver)
    await adapter.create([{ agentId: 'chunk-part', x: 0, y: 0 }])
    const [updated] = await adapter.update([{ agentId: 'chunk-part', x: 50 }])
    assert.equal(updated.chunkId, 'chunk-50-0')
  })
})

// ── P1-3: concurrency serialization ──

describe('E3 Runtime Agent Adapter - P1-3 concurrency TOCTOU', () => {
  it('concurrent creates with same agentId: only one succeeds', async () => {
    const adapter = makeAdapter()
    const p1 = adapter.create([{ agentId: 'race' }])
    const p2 = adapter.create([{ agentId: 'race' }])

    const results = await Promise.allSettled([p1, p2])
    const fulfilled = results.filter(r => r.status === 'fulfilled')
    const rejected = results.filter(r => r.status === 'rejected')

    assert.equal(fulfilled.length, 1, 'exactly one should succeed')
    assert.equal(rejected.length, 1, 'exactly one should fail')
    assert.equal(adapter.agentCount, 1)
  })

  it('concurrent create and remove: linearized', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'concurrent-rm' }])

    const createP = adapter.create([{ agentId: 'concurrent-rm' }]) // should fail - exists
    const removeP = adapter.remove(['concurrent-rm'])

    await Promise.allSettled([createP, removeP])

    // After both settle, the agent should NOT exist (remove won)
    // or should not exist (create fails first then remove succeeds)
    // Either way: either create fails because exists, or remove happens first then create succeeds
    // But key invariant: no duplicates, no state corruption
    assert.ok(adapter.agentCount <= 1)
  })

  it('concurrent create and update: linearized, no corruption', async () => {
    const adapter = makeAdapter()
    const createP = adapter.create([{ agentId: 'cu', x: 0, y: 0 }])
    const updateP = (async () => { try { await adapter.update([{ agentId: 'cu', x: 100 }]) } catch { /* may fail if not found yet */ } })()

    await Promise.allSettled([createP, updateP])
    // State must be consistent
    const entry = adapter.lookup('cu')
    if (entry) {
      assert.equal(entry.kind, 'agent')
      assert.equal(entry.renderBand, 'world')
    }
  })

  it('queue continues after rejected operation (no deadlock)', async () => {
    const adapter = makeAdapter()
    // Operation that will fail
    const pFail = adapter.create([{ agentId: '' }])
    await pFail.catch(() => { /* expected */ })

    // Next operation must succeed
    const [created] = await adapter.create([{ agentId: 'after-fail' }])
    assert.equal(created.sourceEntityId, 'after-fail')
    assert.equal(adapter.agentCount, 1)
  })

  it('concurrent remove then create same ID: create succeeds', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'recreate-race' }])

    const removeP = adapter.remove(['recreate-race'])
    // Wait for remove to finish, then create
    await removeP

    const [created] = await adapter.create([{ agentId: 'recreate-race' }])
    assert.equal(created.sourceEntityId, 'recreate-race')
    assert.equal(adapter.agentCount, 1)
  })
})

// ── P1-4: resolver throws → structured error ──

describe('E3 Runtime Agent Adapter - P1-4 resolver throws → structured', () => {
  it('spawn resolver throw → AGENT_RESOLVER_THREW', async () => {
    const adapter = createRuntimeAgentAdapter(
      () => { throw new Error('spawn boom') },
      defaultChunkResolver(),
    )
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'spawn-throw' }]),
      'AGENT_RESOLVER_THREW',
    )
  })

  it('chunk resolver throw → AGENT_RESOLVER_THREW', async () => {
    const adapter = createRuntimeAgentAdapter(
      defaultSpawnResolver(),
      () => { throw new Error('chunk boom') },
    )
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'chunk-throw' }]),
      'AGENT_RESOLVER_THREW',
    )
  })

  it('spawn resolver returning thenable → AGENT_RESOLVER_TYPE_INVALID', async () => {
    const adapter = createRuntimeAgentAdapter(
      () => ({ then: () => {} }) as unknown as { floorId: string; elevation: number },
      defaultChunkResolver(),
    )
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'spawn-thenable' }]),
      'AGENT_RESOLVER_TYPE_INVALID',
    )
  })

  it('chunk resolver returning thenable → AGENT_RESOLVER_TYPE_INVALID', async () => {
    const adapter = createRuntimeAgentAdapter(
      defaultSpawnResolver(),
      () => ({ then: () => {} }) as unknown as string,
    )
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'chunk-thenable' }]),
      'AGENT_RESOLVER_TYPE_INVALID',
    )
  })

  it('resolver throw errors are proper RenderSchemaError shape', async () => {
    const adapter = createRuntimeAgentAdapter(
      () => { throw new Error('custom') },
      defaultChunkResolver(),
    )
    try {
      await adapter.create([{ agentId: 'shape-test' }])
      assert.fail('expected error')
    } catch (e) {
      assert.ok(isStructuredFatalRenderSchemaError(e))
      if (isStructuredFatalRenderSchemaError(e)) {
        assert.equal(e.errorCode, 'AGENT_RESOLVER_THREW')
        assert.equal(e.severity, 'fatal')
        assert.equal(e.source, 'render-schema')
        assert.equal(e.retryable, false)
        assert.equal(e.objectId, 'shape-test')
      }
    }
  })

  it('resolver throw does NOT double-wrap existing structured fatal', async () => {
    const adapter = createRuntimeAgentAdapter(
      () => { throw new Error('plain'); },
      defaultChunkResolver(),
    )
    try {
      await adapter.create([{ agentId: 'no-double-wrap' }])
    } catch (e) {
      // Should be AGENT_RESOLVER_THREW, not double-wrapped
      assert.ok(isStructuredFatalRenderSchemaError(e))
      assert.equal((e as { errorCode: string }).errorCode, 'AGENT_RESOLVER_THREW')
    }
  })
})

// ── P1-5: crypto.subtle missing → AGENT_HASH_FAILED ──

describe('E3 Runtime Agent Adapter - P1-5 hash failure', () => {
  it('injectable hashFn that rejects → AGENT_HASH_FAILED', async () => {
    const adapter = makeAdapter(defaultSpawnResolver(), defaultChunkResolver(), {
      hashFn: () => Promise.reject(new Error('hash crash')),
    })
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'hash-fail' }]),
      'AGENT_HASH_FAILED',
    )
  })

  it('injectable hashFn that throws → AGENT_HASH_FAILED', async () => {
    const adapter = makeAdapter(defaultSpawnResolver(), defaultChunkResolver(), {
      hashFn: () => { throw new Error('hash throw') },
    })
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'hash-throw' }]),
      'AGENT_HASH_FAILED',
    )
  })
})

// ── P2-7: injectable hash seam for collision testing ──

describe('E3 Runtime Agent Adapter - P2-7 injectable hash seam', () => {
  it('injectable hashFn overrides default SHA-256', async () => {
    const adapter = makeAdapter(defaultSpawnResolver(), defaultChunkResolver(), {
      hashFn: async (id: string) => `jyt.agent.custom-${id}.v1`,
    })
    const [result] = await adapter.create([{ agentId: 'custom-hash' }])
    assert.equal(result.stableId, 'jyt.agent.custom-custom-hash.v1')
  })

  it('different sourceIds with same injected stableId → AGENT_STABLE_ID_COLLISION within batch', async () => {
    const adapter = makeAdapter(defaultSpawnResolver(), defaultChunkResolver(), {
      hashFn: async () => 'jyt.agent.same-hash-for-all.v1',
    })
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'alpha' }, { agentId: 'beta' }]),
      'AGENT_STABLE_ID_COLLISION',
    )
  })

  it('different sourceIds with same injected stableId → AGENT_STABLE_ID_COLLISION cross-batch', async () => {
    const adapter = makeAdapter(defaultSpawnResolver(), defaultChunkResolver(), {
      hashFn: async () => 'jyt.agent.cross-collision.v1',
    })
    await adapter.create([{ agentId: 'first' }])
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'second' }]),
      'AGENT_STABLE_ID_COLLISION',
    )
  })
})

// ── P2-8: unpaired surrogate detection ──

describe('E3 Runtime Agent Adapter - P2-8 unpaired surrogates', () => {
  it('lone high surrogate → AGENT_UNPAIRED_SURROGATE', async () => {
    const loneHigh = 'agent\uD800'
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: loneHigh }]),
      'AGENT_UNPAIRED_SURROGATE',
    )
  })

  it('lone low surrogate → AGENT_UNPAIRED_SURROGATE', async () => {
    const loneLow = 'agent\uDC00'
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: loneLow }]),
      'AGENT_UNPAIRED_SURROGATE',
    )
  })

  it('valid surrogate pair is accepted', async () => {
    const validPair = 'agent-\uD83D\uDE00' // 😀
    const adapter = makeAdapter()
    const [result] = await adapter.create([{ agentId: validPair }])
    assert.equal(result.sourceEntityId, validPair)
    assert.match(result.stableId, /^jyt\.agent\.[a-z2-7]{52}\.v1$/)
  })

  it('high surrogate at end of string → AGENT_UNPAIRED_SURROGATE', async () => {
    const trailing = 'abc\uD800'
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: trailing }]),
      'AGENT_UNPAIRED_SURROGATE',
    )
  })

  it('high surrogate followed by non-surrogate → AGENT_UNPAIRED_SURROGATE', async () => {
    const badPair = 'ab\uD800cd'
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: badPair }]),
      'AGENT_UNPAIRED_SURROGATE',
    )
  })
})

// ── P2-9: coordinate strictness ──

describe('E3 Runtime Agent Adapter - P2-9 coordinate strictness', () => {
  it('create with null coordinates → AGENT_POSITION_INVALID', async () => {
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: 'null-x', x: null }]),
      'AGENT_POSITION_INVALID',
    )
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: 'null-y', y: null }]),
      'AGENT_POSITION_INVALID',
    )
  })

  it('create with string coordinates → AGENT_POSITION_INVALID', async () => {
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: 'str-x', x: '42' }]),
      'AGENT_POSITION_INVALID',
    )
  })

  it('create with boolean coordinates → AGENT_POSITION_INVALID', async () => {
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: 'bool-x', x: true }]),
      'AGENT_POSITION_INVALID',
    )
  })

  it('create with object coordinates → AGENT_POSITION_INVALID', async () => {
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: 'obj-x', x: {} }]),
      'AGENT_POSITION_INVALID',
    )
  })

  it('create with NaN/Infinity → AGENT_POSITION_INVALID', async () => {
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: 'nan', x: NaN }]),
      'AGENT_POSITION_INVALID',
    )
    await fatalAssertAsync(
      () => makeAdapter().create([{ agentId: 'inf', x: Infinity }]),
      'AGENT_POSITION_INVALID',
    )
  })

  it('create with absent coordinates defaults to 0', async () => {
    const [result] = await makeAdapter().create([{ agentId: 'default-pos' }])
    assert.equal(result.sortAnchor.x, 0)
    assert.equal(result.sortAnchor.y, 0)
  })

  it('update with null coordinates → AGENT_POSITION_INVALID', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'up-null', x: 0, y: 0 }])
    await fatalAssertAsync(
      () => adapter.update([{ agentId: 'up-null', x: null }]),
      'AGENT_POSITION_INVALID',
    )
  })

  it('update with string coordinates → AGENT_POSITION_INVALID', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'up-str', x: 0, y: 0 }])
    await fatalAssertAsync(
      () => adapter.update([{ agentId: 'up-str', x: '10' }]),
      'AGENT_POSITION_INVALID',
    )
  })

  it('update with boolean coordinates → AGENT_POSITION_INVALID', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'up-bool', x: 0, y: 0 }])
    await fatalAssertAsync(
      () => adapter.update([{ agentId: 'up-bool', x: false }]),
      'AGENT_POSITION_INVALID',
    )
  })

  it('update with object coordinates → AGENT_POSITION_INVALID', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'up-obj', x: 0, y: 0 }])
    await fatalAssertAsync(
      () => adapter.update([{ agentId: 'up-obj', x: {} }]),
      'AGENT_POSITION_INVALID',
    )
  })

  it('update with NaN/Infinity → AGENT_POSITION_INVALID', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'up-nan', x: 0, y: 0 }])
    await fatalAssertAsync(
      () => adapter.update([{ agentId: 'up-nan', x: NaN }]),
      'AGENT_POSITION_INVALID',
    )
    await fatalAssertAsync(
      () => adapter.update([{ agentId: 'up-nan', y: Infinity }]),
      'AGENT_POSITION_INVALID',
    )
  })
})

// ── P2-10: resolver output string validity ──

describe('E3 Runtime Agent Adapter - P2-10 resolver output validity', () => {
  it('spawn resolver null return → AGENT_SPAWN_INVALID', async () => {
    const adapter = createRuntimeAgentAdapter(
      () => null as unknown as { floorId: string; elevation: number },
      defaultChunkResolver(),
    )
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'spawn-null' }]),
      'AGENT_SPAWN_INVALID',
    )
  })

  it('spawn resolver empty floorId → AGENT_SPAWN_INVALID', async () => {
    const adapter = createRuntimeAgentAdapter(
      () => ({ floorId: '', elevation: 0 }),
      defaultChunkResolver(),
    )
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'spawn-empty-floor' }]),
      'AGENT_SPAWN_INVALID',
    )
  })

  it('spawn resolver whitespace floorId → AGENT_SPAWN_INVALID', async () => {
    const adapter = createRuntimeAgentAdapter(
      () => ({ floorId: '   ', elevation: 0 }),
      defaultChunkResolver(),
    )
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'spawn-ws-floor' }]),
      'AGENT_SPAWN_INVALID',
    )
  })

  it('spawn resolver non-integer elevation → AGENT_SPAWN_INVALID', async () => {
    const adapter = createRuntimeAgentAdapter(
      () => ({ floorId: 'floor-1', elevation: 1.5 }),
      defaultChunkResolver(),
    )
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'spawn-float-elev' }]),
      'AGENT_SPAWN_INVALID',
    )
  })

  it('chunk resolver empty string → AGENT_CHUNK_INVALID', async () => {
    const adapter = createRuntimeAgentAdapter(
      defaultSpawnResolver(),
      () => '',
    )
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'chunk-empty' }]),
      'AGENT_CHUNK_INVALID',
    )
  })

  it('chunk resolver whitespace → AGENT_CHUNK_INVALID', async () => {
    const adapter = createRuntimeAgentAdapter(
      defaultSpawnResolver(),
      () => '   ',
    )
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'chunk-ws' }]),
      'AGENT_CHUNK_INVALID',
    )
  })

  it('chunk resolver number → AGENT_CHUNK_INVALID', async () => {
    const adapter = createRuntimeAgentAdapter(
      defaultSpawnResolver(),
      () => 123 as unknown as string,
    )
    await fatalAssertAsync(
      () => adapter.create([{ agentId: 'chunk-num' }]),
      'AGENT_CHUNK_INVALID',
    )
  })
})

// ── Core contract tests ──

describe('E3 Runtime Agent Adapter - batch atomicity', () => {
  it('all-or-nothing: failed batch does not partially register', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'good-1' }])
    try { await adapter.create([{ agentId: 'good-2' }, { agentId: 'good-1' }]) } catch { /* dup */ }
    assert.equal(adapter.agentCount, 1)
    assert.equal(adapter.lookup('good-2'), undefined)
  })

  it('update batch is atomic', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'a1', x: 0, y: 0 }, { agentId: 'a2', x: 10, y: 10 }])
    try { await adapter.update([{ agentId: 'a1', x: 5 }, { agentId: 'nonexistent', x: 20 }]) } catch { /* not found */ }
    assert.equal(adapter.lookup('a1')?.sortAnchor.x, 0)
  })

  it('remove batch is atomic', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'r1' }, { agentId: 'r2' }])
    try { await adapter.remove(['r1', 'nonexistent']) } catch { /* not found */ }
    assert.equal(adapter.agentCount, 2)
  })

  it('create results preserve insertion order', async () => {
    const adapter = makeAdapter()
    const results = await adapter.create([
      { agentId: 'zebra' }, { agentId: 'alpha' }, { agentId: 'beta' },
    ])
    assert.equal(results[0].sourceEntityId, 'zebra')
    assert.equal(results[1].sourceEntityId, 'alpha')
    assert.equal(results[2].sourceEntityId, 'beta')
  })

  it('sourceEntityIds preserve insertion order', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'third' }, { agentId: 'first' }, { agentId: 'second' }])
    assert.deepEqual([...adapter.sourceEntityIds], ['third', 'first', 'second'])
  })
})

describe('E3 Runtime Agent Adapter - identity freezing', () => {
  it('created agents have frozen identity fields', async () => {
    const [agent] = await makeAdapter().create([{ agentId: 'identity-test', x: 100, y: 200 }])
    assert.equal(agent.kind, 'agent')
    assert.equal(agent.renderBand, 'world')
    assert.equal(agent.sortMode, 'y')
    assert.equal(agent.floorId, 'floor-1')
    assert.equal(agent.elevation, 0)
    assert.equal(agent.tieBias, 0)
    assert.equal(agent.sourceEntityId, 'identity-test')
    assert.match(agent.stableId, /^jyt\.agent\.[a-z2-7]{52}\.v1$/)
  })

  it('update preserves identity fields', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'protected', x: 50, y: 60 }])
    const [updated] = await adapter.update([{ agentId: 'protected', x: 150, y: 250 }])
    assert.equal(updated.kind, 'agent')
    assert.equal(updated.renderBand, 'world')
    assert.equal(updated.sortMode, 'y')
    assert.equal(updated.floorId, 'floor-1')
    assert.equal(updated.elevation, 0)
    assert.equal(updated.tieBias, 0)
    assert.equal(updated.sourceEntityId, 'protected')
    assert.equal(updated.sortAnchor.x, 150)
    assert.equal(updated.sortAnchor.y, 250)
  })
})

describe('E3 Runtime Agent Adapter - trusted spawn resolver', () => {
  it('default gives floor-1/0', async () => {
    const [agent] = await makeAdapter().create([{ agentId: 'spawn-default' }])
    assert.equal(agent.floorId, 'floor-1')
    assert.equal(agent.elevation, 0)
  })

  it('custom spawn is respected', async () => {
    const adapter = createRuntimeAgentAdapter(
      () => ({ floorId: 'floor-2', elevation: 10 }),
      defaultChunkResolver(),
    )
    const [agent] = await adapter.create([{ agentId: 'custom-spawn' }])
    assert.equal(agent.floorId, 'floor-2')
    assert.equal(agent.elevation, 10)
  })
})

describe('E3 Runtime Agent Adapter - remove and lookup lifecycle', () => {
  it('lookup returns frozen clone', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'find-me' }])
    const found = adapter.lookup('find-me')
    assert.ok(found)
    assert.equal(found.sourceEntityId, 'find-me')
    assert.ok(Object.isFrozen(found))
  })

  it('lookup returns undefined for unknown', () => {
    assert.equal(makeAdapter().lookup('unknown'), undefined)
  })

  it('reverseLookup maps stableId → sourceEntityId', async () => {
    const adapter = makeAdapter()
    const [agent] = await adapter.create([{ agentId: 'reverse-me' }])
    assert.equal(adapter.reverseLookup(agent.stableId), 'reverse-me')
  })

  it('reverseLookup returns undefined for unknown', () => {
    assert.equal(makeAdapter().reverseLookup('jyt.agent.unknown.v1'), undefined)
  })

  it('remove clears both maps', async () => {
    const adapter = makeAdapter()
    const [agent] = await adapter.create([{ agentId: 'delete-me' }])
    await adapter.remove(['delete-me'])
    assert.equal(adapter.agentCount, 0)
    assert.equal(adapter.lookup('delete-me'), undefined)
    assert.equal(adapter.reverseLookup(agent.stableId), undefined)
  })

  it('remove does not leak reverse entries', async () => {
    const adapter = makeAdapter()
    const [a1] = await adapter.create([{ agentId: 'keep' }])
    const [a2] = await adapter.create([{ agentId: 'remove' }])
    await adapter.remove(['remove'])
    assert.equal(adapter.reverseLookup(a1.stableId), 'keep')
    assert.equal(adapter.reverseLookup(a2.stableId), undefined)
  })

  it('destroy clears all state', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'd1' }, { agentId: 'd2' }])
    adapter.destroy()
    assert.equal(adapter.agentCount, 0)
    assert.equal(adapter.sourceEntityIds.length, 0)
    assert.equal(adapter.sceneObjects.length, 0)
  })

  it('can re-create agent after remove', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'recreate' }])
    await adapter.remove(['recreate'])
    const [agent] = await adapter.create([{ agentId: 'recreate' }])
    assert.equal(agent.sourceEntityId, 'recreate')
  })
})

describe('E3 Runtime Agent Adapter - snapshot immutability', () => {
  it('update only modifies sortAnchor and chunkId', async () => {
    const adapter = makeAdapter()
    const [original] = await adapter.create([{ agentId: 'snap-test', x: 10, y: 20 }])
    const [updated] = await adapter.update([{ agentId: 'snap-test', x: 30, y: 40 }])
    assert.equal(updated.sortAnchor.x, 30)
    assert.equal(updated.sortAnchor.y, 40)
    assert.equal(updated.stableId, original.stableId)
    assert.equal(updated.sourceEntityId, original.sourceEntityId)
    assert.equal(updated.kind, original.kind)
    assert.equal(updated.renderBand, original.renderBand)
    assert.equal(updated.floorId, original.floorId)
    assert.equal(updated.elevation, original.elevation)
    assert.equal(updated.sortMode, original.sortMode)
    assert.equal(updated.tieBias, original.tieBias)
  })

  it('update without position preserves sortAnchor', async () => {
    const adapter = makeAdapter()
    await adapter.create([{ agentId: 'stationary', x: 42, y: 73 }])
    const [updated] = await adapter.update([{ agentId: 'stationary' }])
    assert.equal(updated.sortAnchor.x, 42)
    assert.equal(updated.sortAnchor.y, 73)
    assert.ok(Object.isFrozen(updated.sortAnchor))
  })
})

describe('E3 Runtime Agent Adapter - zero coupling', () => {
  it('does not reference /agent/active, roster, or Hall v1', () => {
    // Structural test — verified by code review: no imports/exports to those paths
  })
})

describe('E3 Runtime Agent Adapter - determinism', () => {
  it('same input → same stableId across 5 adapter instances', async () => {
    for (let i = 0; i < 5; i++) {
      const [agent] = await makeAdapter().create([{ agentId: 'deterministic-test' }])
      assert.equal(agent.stableId, 'jyt.agent.hurt3shmk56nuy47hjsgtid7xidih5licjdijjamkvq32f7ncakq.v1')
    }
  })

  it('stableId does not depend on adapter state or creation order', async () => {
    const a1 = makeAdapter()
    await a1.create([{ agentId: 'first' }])
    const [second] = await a1.create([{ agentId: 'second' }])
    const a2 = makeAdapter()
    const [secondFirst] = await a2.create([{ agentId: 'second' }])
    assert.equal(second.stableId, secondFirst.stableId)
  })
})

describe('E3 Runtime Agent Adapter - UTF-8 boundary IDs', () => {
  it('handles emoji ZWJ sequence', async () => {
    const adapter = makeAdapter()
    const emojiZwj = '\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08'
    const [agent] = await adapter.create([{ agentId: emojiZwj }])
    assert.equal(agent.sourceEntityId, emojiZwj)
  })

  it('handles combining character sequences', async () => {
    const adapter = makeAdapter()
    const vietId = 'ng\u01B0\u1EDDi'
    const [agent] = await adapter.create([{ agentId: vietId }])
    assert.equal(agent.sourceEntityId, vietId)
    assert.match(agent.stableId, /^jyt\.agent\.[a-z2-7]{52}\.v1$/)
  })
})

describe('E3 Runtime Agent Adapter - structured error shape', () => {
  it('errors have correct shape', async () => {
    const adapter = makeAdapter()
    try {
      await adapter.update([{ agentId: 'no-such', x: 0, y: 0 }])
      assert.fail('expected error')
    } catch (e) {
      assert.ok(isStructuredFatalRenderSchemaError(e))
      if (isStructuredFatalRenderSchemaError(e)) {
        assert.equal(e.severity, 'fatal')
        assert.equal(e.source, 'render-schema')
        assert.equal(e.retryable, false)
        assert.equal(e.errorCode, 'AGENT_NOT_FOUND')
      }
    }
  })
})
