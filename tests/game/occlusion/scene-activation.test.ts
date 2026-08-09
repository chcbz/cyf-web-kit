import assert from 'node:assert/strict'
import { describe, it } from 'mocha'

import {
  createSceneActivationController,
  isSceneActivationError,
  type ActivationStage,
  type AtomicFrameSwapContext,
  type AtomicSwapContext,
  type FrameProposal,
  type SceneActivationHooks,
  type SceneActivationNode,
  type StagedScene,
} from '../../../src/game/occlusion/sceneActivation.js'
import { renderSchemaError } from '../../../src/game/occlusion/schema.js'

type PipelineStage = 'parsed' | 'canonicalized' | 'validated' | 'assetsReady' | 'instantiated' | 'constraint' | 'commit'
type TestSource = Readonly<{
  sceneId: string
  label: string
  mode: 'v1' | 'v2'
  nodeIds?: readonly string[]
}>
type TestNodeValue = Readonly<{ label: string; stableId: string }>
type PassValue = Readonly<{ source: TestSource }>
type TestAssets = Readonly<{ label: string }>

interface AbortPlan {
  stage: PipelineStage
  controller: AbortController
}

interface Behavior {
  fail: Map<string, PipelineStage>
  abort: Map<string, AbortPlan>
  gates: Map<string, { stage: PipelineStage; entered: Deferred<void>; release: Deferred<void> }>
  mixedMode: Set<string>
  badOwner: Set<string>
  badScene: Set<string>
  duplicateIds: Set<string>
  disposeThrows: Set<string>
  frameThrow: boolean
}

interface Harness {
  behavior: Behavior
  events: string[]
  cleanupCounts: Map<string, number>
  sceneDisposeCounts: Map<string, number>
  visibleScene: string | null
  visibleFrame: readonly string[] | null
  controller: ReturnType<typeof createSceneActivationController<TestSource, PassValue, PassValue, PassValue, TestAssets, TestNodeValue>>
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T | PromiseLike<T>): void
  reject(reason?: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function count(map: Map<string, number>, key: string): number {
  return map.get(key) ?? 0
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, count(map, key) + 1)
}

function makeHarness(): Harness {
  const behavior: Behavior = {
    fail: new Map(),
    abort: new Map(),
    gates: new Map(),
    mixedMode: new Set(),
    badOwner: new Set(),
    badScene: new Set(),
    duplicateIds: new Set(),
    disposeThrows: new Set(),
    frameThrow: false,
  }
  const events: string[] = []
  const cleanupCounts = new Map<string, number>()
  const sceneDisposeCounts = new Map<string, number>()
  const state: { visibleScene: string | null; visibleFrame: readonly string[] | null } = {
    visibleScene: null,
    visibleFrame: null,
  }

  async function enter(stage: PipelineStage, source: TestSource, context: {
    track(label: string, cleanup: () => void): void
  }): Promise<void> {
    events.push(`${source.label}:${stage}`)
    const cleanupKey = `${source.label}:${stage}`
    context.track(cleanupKey, () => {
      increment(cleanupCounts, cleanupKey)
      events.push(`cleanup:${cleanupKey}`)
    })

    const gate = behavior.gates.get(source.label)
    if (gate?.stage === stage) {
      gate.entered.resolve(undefined)
      await gate.release.promise
    }
    const abort = behavior.abort.get(source.label)
    if (abort?.stage === stage) abort.controller.abort(`${source.label}:${stage}`)

    if (behavior.fail.get(source.label) !== stage) return
    if (stage === 'assetsReady') {
      context.track(`${source.label}:asset-a`, () => {
        increment(cleanupCounts, `${source.label}:asset-a`)
        events.push(`cleanup:${source.label}:asset-a`)
      })
      context.track(`${source.label}:asset-b`, () => {
        increment(cleanupCounts, `${source.label}:asset-b`)
        events.push(`cleanup:${source.label}:asset-b`)
      })
    }
    if (stage === 'instantiated') {
      context.track(`${source.label}:half-child`, () => {
        increment(cleanupCounts, `${source.label}:half-child`)
        events.push(`cleanup:${source.label}:half-child`)
      })
    }
    if (stage === 'constraint') {
      throw renderSchemaError(
        'CONSTRAINT_CYCLE_DETECTED',
        source.sceneId,
        '(constraint-graph)',
        'constraint-graph',
        '约束图存在环。',
        `cycle injected for ${source.label}`,
      )
    }
    throw new Error(`${source.label}:${stage}:injected`)
  }

  function sourceOf(value: PassValue): TestSource {
    return value.source
  }

  function makeStaged(source: TestSource, transactionId: string): StagedScene<TestNodeValue> {
    const ids = [...(source.nodeIds ?? [`${source.label}.a`, `${source.label}.b`, `${source.label}.c`])]
    if (behavior.duplicateIds.has(source.label) && ids.length >= 2) ids[1] = ids[0]
    const order = [...ids]
    const depths: Record<string, number> = {}
    order.forEach((id, index) => { depths[id] = 10 + index })
    const children: SceneActivationNode<TestNodeValue>[] = ids.map((stableId, index) => ({
      stableId,
      sceneId: behavior.badScene.has(source.label) && index === 0 ? `${source.sceneId}-other` : source.sceneId,
      mode: behavior.mixedMode.has(source.label) && index === ids.length - 1
        ? (source.mode === 'v1' ? 'v2' : 'v1')
        : source.mode,
      ownerTransactionId: behavior.badOwner.has(source.label) && index === 0
        ? `${transactionId}-other`
        : transactionId,
      value: Object.freeze({ label: source.label, stableId }),
    }))
    return {
      sceneId: source.sceneId,
      mode: source.mode,
      ownerTransactionId: transactionId,
      children,
      order,
      depths,
      dispose: () => {
        increment(sceneDisposeCounts, source.label)
        events.push(`dispose-scene:${source.label}`)
        if (behavior.disposeThrows.has(source.label)) throw new Error(`dispose:${source.label}`)
      },
    }
  }

  const hooks: SceneActivationHooks<TestSource, PassValue, PassValue, PassValue, TestAssets, TestNodeValue> = {
    async parse(source, context) {
      await enter('parsed', source, context)
      return Object.freeze({ source })
    },
    async canonicalize(parsed, context) {
      await enter('canonicalized', sourceOf(parsed), context)
      return parsed
    },
    async validate(canonical, context) {
      await enter('validated', sourceOf(canonical), context)
      return canonical
    },
    async loadAssets(validated, context) {
      const source = sourceOf(validated)
      await enter('assetsReady', source, context)
      return Object.freeze({ label: source.label })
    },
    async instantiate({ validated }, context) {
      const source = sourceOf(validated)
      await enter('instantiated', source, context)
      return makeStaged(source, context.transactionId)
    },
    async validateConstraints(scene, context) {
      const source = scene.children[0]?.value
        ? { sceneId: scene.sceneId, label: scene.children[0].value.label, mode: scene.mode as 'v1' | 'v2' }
        : { sceneId: scene.sceneId, label: 'empty', mode: scene.mode as 'v1' | 'v2' }
      await enter('constraint', source, context)
      return { order: [...scene.order] }
    },
    commit(context: AtomicSwapContext<TestNodeValue>) {
      const label = context.next.children[0]?.value.label ?? 'empty'
      events.push(`${label}:commit`)
      context.swap(
        () => {
          state.visibleScene = label
          state.visibleFrame = [...context.next.order]
          events.push(`visible:${label}`)
        },
        () => {
          state.visibleScene = context.previous?.children[0]?.value.label ?? null
          state.visibleFrame = context.previous ? [...context.previous.order] : null
          events.push(`rollback:${label}`)
        },
      )
      const abort = behavior.abort.get(label)
      if (abort?.stage === 'commit') abort.controller.abort(`${label}:commit`)
      if (behavior.fail.get(label) === 'commit') throw new Error(`${label}:commit:injected`)
    },
    commitFrame(context: AtomicFrameSwapContext<TestNodeValue>) {
      events.push(`frame:commit:${context.transactionId}`)
      context.swap(
        () => {
          state.visibleFrame = [...context.next.order]
          events.push(`frame:visible:${context.next.order.join(',')}`)
        },
        () => {
          state.visibleFrame = [...context.previous.order]
          events.push(`frame:rollback:${context.previous.order.join(',')}`)
        },
      )
      if (behavior.frameThrow) throw new Error('frame commit injected')
    },
  }

  const controller = createSceneActivationController(hooks)
  const harness: Harness = {
    behavior,
    events,
    cleanupCounts,
    sceneDisposeCounts,
    controller,
    get visibleScene() { return state.visibleScene },
    set visibleScene(value: string | null) { state.visibleScene = value },
    get visibleFrame() { return state.visibleFrame },
    set visibleFrame(value: readonly string[] | null) { state.visibleFrame = value },
  }
  return harness
}

function request(label: string, mode: 'v1' | 'v2' = 'v2', signal?: AbortSignal) {
  return {
    sceneId: 'test-scene',
    mode,
    source: { sceneId: 'test-scene', label, mode },
    signal,
  } as const
}

function assertActivationFailure(
  result: Awaited<ReturnType<Harness['controller']['activate']>>,
  stage: ActivationStage,
  code?: string,
): asserts result is Extract<typeof result, { ok: false }> {
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(isSceneActivationError(result.error))
  assert.equal(result.error.stage, stage)
  assert.equal(result.error.sceneId, 'test-scene')
  assert.equal(result.error.transactionId, result.transactionId)
  if (code) assert.equal(result.error.errorCode, code)
}

async function seedActive(harness: Harness, label = 'old', mode: 'v1' | 'v2' = 'v1') {
  const result = await harness.controller.activate(request(label, mode))
  if (!result.ok) throw result.error
  assert.equal(result.ok, true)
  return result.active
}

function frameProposal(
  active: NonNullable<Harness['controller']['active']>,
  order: readonly string[],
  depths: Readonly<Record<string, number>>,
  constraintResult: FrameProposal['constraintResult'] = { order },
): FrameProposal {
  return {
    sceneId: active.sceneId,
    activationTransactionId: active.ownerTransactionId,
    order,
    depths,
    constraintResult,
  }
}

const FAILURE_STAGES: readonly PipelineStage[] = [
  'parsed',
  'canonicalized',
  'validated',
  'assetsReady',
  'instantiated',
  'constraint',
  'commit',
]

describe('E7 scene activation transaction', () => {
  it('runs the frozen pipeline and swaps only after a complete staging scene exists', async () => {
    const h = makeHarness()
    const result = await h.controller.activate(request('next'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(
      h.events.filter(event => event.startsWith('next:') || event === 'visible:next'),
      [
        'next:parsed',
        'next:canonicalized',
        'next:validated',
        'next:assetsReady',
        'next:instantiated',
        'next:constraint',
        'next:commit',
        'visible:next',
      ],
    )
    assert.equal(h.controller.active, result.active)
    assert.equal(h.visibleScene, 'next')
    assert.deepEqual(result.active.order, ['next.a', 'next.b', 'next.c'])
    assert.deepEqual(result.active.depths, { 'next.a': 10, 'next.b': 11, 'next.c': 12 })
    assert.equal(count(h.sceneDisposeCounts, 'next'), 0)
    await h.controller.destroy()
  })

  for (const stage of FAILURE_STAGES) {
    it(`fails closed without active at ${stage}`, async () => {
      const h = makeHarness()
      h.behavior.fail.set('bad', stage)
      const result = await h.controller.activate(request('bad'))
      const expectedCode = stage === 'constraint' ? 'CONSTRAINT_CYCLE_DETECTED' : undefined
      assertActivationFailure(result, stage, expectedCode)
      assert.equal(h.controller.active, null)
      assert.equal(h.visibleScene, null)
      assert.equal(h.controller.snapshot.status, 'error')
      assert.equal(h.controller.snapshot.active, null)
      assert.ok(h.controller.snapshot.error)
      assert.ok(Object.isFrozen(h.controller.snapshot))
      assert.ok(Object.isFrozen(h.controller.snapshot.error!))
      assert.ok(Object.isFrozen(h.controller.snapshot.diagnostics))
      for (const cleanupStage of FAILURE_STAGES) {
        const expected = cleanupStage !== 'commit'
          && FAILURE_STAGES.indexOf(cleanupStage) <= FAILURE_STAGES.indexOf(stage) ? 1 : 0
        assert.equal(count(h.cleanupCounts, `bad:${cleanupStage}`), expected)
      }
      assert.equal(count(h.sceneDisposeCounts, 'bad'), stage === 'constraint' || stage === 'commit' ? 1 : 0)
      await h.controller.destroy()
    })
  }

  for (const stage of FAILURE_STAGES) {
    it(`preserves the exact previous active scene at ${stage} failure`, async () => {
      const h = makeHarness()
      const old = await seedActive(h)
      const oldOrder = old.order
      const oldDepths = old.depths
      const oldVisible = h.visibleScene
      h.behavior.fail.set('bad', stage)

      const result = await h.controller.activate(request('bad', 'v2'))
      assertActivationFailure(result, stage, stage === 'constraint' ? 'CONSTRAINT_CYCLE_DETECTED' : undefined)
      assert.equal(h.controller.active, old)
      assert.equal(h.controller.active?.order, oldOrder)
      assert.equal(h.controller.active?.depths, oldDepths)
      assert.equal(h.visibleScene, oldVisible)
      assert.equal(count(h.sceneDisposeCounts, 'old'), 0)
      assert.equal(h.controller.snapshot.status, 'active')
      assert.equal(h.controller.snapshot.active?.ownerTransactionId, old.ownerTransactionId)
      assert.equal(h.controller.snapshot.error?.transactionId, result.transactionId)
      await h.controller.destroy()
      assert.equal(count(h.sceneDisposeCounts, 'old'), 1)
    })
  }

  it('cleans partially loaded assets in reverse order exactly once', async () => {
    const h = makeHarness()
    h.behavior.fail.set('asset-fail', 'assetsReady')
    const result = await h.controller.activate(request('asset-fail'))
    assertActivationFailure(result, 'assetsReady')
    assert.equal(count(h.cleanupCounts, 'asset-fail:asset-a'), 1)
    assert.equal(count(h.cleanupCounts, 'asset-fail:asset-b'), 1)
    const b = h.events.indexOf('cleanup:asset-fail:asset-b')
    const a = h.events.indexOf('cleanup:asset-fail:asset-a')
    assert.ok(b >= 0 && a > b, 'last acquired asset must be disposed first')
    await h.controller.destroy()
    assert.equal(count(h.cleanupCounts, 'asset-fail:asset-a'), 1)
    assert.equal(count(h.cleanupCounts, 'asset-fail:asset-b'), 1)
  })

  it('cleans half-built instantiate resources exactly once', async () => {
    const h = makeHarness()
    h.behavior.fail.set('half', 'instantiated')
    const result = await h.controller.activate(request('half'))
    assertActivationFailure(result, 'instantiated')
    assert.equal(count(h.cleanupCounts, 'half:half-child'), 1)
    assert.equal(count(h.sceneDisposeCounts, 'half'), 0)
    await h.controller.destroy()
    assert.equal(count(h.cleanupCounts, 'half:half-child'), 1)
  })

  it('rolls back the internal and external swap when commit callback throws', async () => {
    const h = makeHarness()
    const old = await seedActive(h)
    h.behavior.fail.set('next', 'commit')
    const result = await h.controller.activate(request('next', 'v2'))
    assertActivationFailure(result, 'commit', 'ACTIVATION_COMMIT_FAILED')
    assert.equal(h.controller.active, old)
    assert.equal(h.visibleScene, 'old')
    assert.ok(h.events.includes('visible:next'))
    assert.ok(h.events.includes('rollback:next'))
    assert.equal(count(h.sceneDisposeCounts, 'next'), 1)
    assert.equal(count(h.sceneDisposeCounts, 'old'), 0)
    await h.controller.destroy()
    assert.equal(count(h.sceneDisposeCounts, 'next'), 1)
    assert.equal(count(h.sceneDisposeCounts, 'old'), 1)
  })

  it('rejects mixed v1/v2 children before commit', async () => {
    const h = makeHarness()
    h.behavior.mixedMode.add('mixed')
    const result = await h.controller.activate(request('mixed', 'v2'))
    assertActivationFailure(result, 'instantiated', 'ACTIVATION_MODE_MIXED')
    assert.equal(h.controller.active, null)
    assert.equal(h.visibleScene, null)
    assert.equal(count(h.sceneDisposeCounts, 'mixed'), 1)
    await h.controller.destroy()
  })

  it('switches v1 to v2 only as a complete scene and disposes v1 afterward', async () => {
    const h = makeHarness()
    const old = await seedActive(h, 'legacy', 'v1')
    const result = await h.controller.activate(request('modern', 'v2'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(old.mode, 'v1')
    assert.equal(result.active.mode, 'v2')
    assert.ok(result.active.children.every(child => child.mode === 'v2'))
    assert.equal(count(h.sceneDisposeCounts, 'legacy'), 1)
    assert.equal(count(h.sceneDisposeCounts, 'modern'), 0)
    const commitIndex = h.events.indexOf('visible:modern')
    const disposeIndex = h.events.indexOf('dispose-scene:legacy')
    assert.ok(commitIndex >= 0 && disposeIndex > commitIndex)
    await h.controller.destroy()
  })

  it('rejects duplicate IDs and invalid scene/transaction ownership', async () => {
    const cases = [
      ['dup', (h: Harness) => h.behavior.duplicateIds.add('dup'), 'STABLE_ID_DUPLICATE'],
      ['owner', (h: Harness) => h.behavior.badOwner.add('owner'), 'ACTIVATION_OWNERSHIP_INVALID'],
      ['scene', (h: Harness) => h.behavior.badScene.add('scene'), 'ACTIVATION_CHILD_SCENE_MISMATCH'],
    ] as const
    for (const [label, configure, code] of cases) {
      const h = makeHarness()
      configure(h)
      const result = await h.controller.activate(request(label))
      assertActivationFailure(result, 'instantiated', code)
      assert.equal(h.controller.active, null)
      assert.equal(count(h.sceneDisposeCounts, label), 1)
      await h.controller.destroy()
    }
  })

  it('rejects an invalid whole-scene mode before parser output can publish', async () => {
    const h = makeHarness()
    const bad = request('bad-mode') as unknown as Parameters<typeof h.controller.activate>[0]
    ;(bad as { mode: string }).mode = 'v3'
    const result = await h.controller.activate(bad)
    assertActivationFailure(result, 'parsed', 'ACTIVATION_MODE_INVALID')
    assert.equal(h.controller.active, null)
    await h.controller.destroy()
  })

  it('lets fast B supersede slow A and ignores stale A completion', async () => {
    const h = makeHarness()
    const entered = deferred<void>()
    const release = deferred<void>()
    h.behavior.gates.set('slow-a', { stage: 'parsed', entered, release })

    const promiseA = h.controller.activate(request('slow-a'))
    await entered.promise
    const resultB = await h.controller.activate(request('fast-b'))
    assert.equal(resultB.ok, true)
    release.resolve(undefined)
    const resultA = await promiseA

    assertActivationFailure(resultA, 'parsed', 'ACTIVATION_STALE')
    assert.equal(h.controller.active, resultB.ok ? resultB.active : null)
    assert.equal(h.visibleScene, 'fast-b')
    assert.equal(h.controller.snapshot.transaction?.transactionId, resultB.transactionId)
    assert.equal(h.controller.snapshot.error, null)
    assert.equal(count(h.cleanupCounts, 'slow-a:parsed'), 1)
    await h.controller.destroy()
  })

  for (const stage of FAILURE_STAGES) {
    it(`aborts at ${stage}, destroys staging, and preserves the old complete scene`, async () => {
      const h = makeHarness()
      const old = await seedActive(h)
      const abort = new AbortController()
      h.behavior.abort.set('abort-me', { stage, controller: abort })
      const result = await h.controller.activate(request('abort-me', 'v2', abort.signal))
      assertActivationFailure(result, stage, 'ACTIVATION_ABORTED')
      assert.equal(h.controller.active, old)
      assert.equal(h.visibleScene, 'old')
      assert.equal(count(h.sceneDisposeCounts, 'old'), 0)
      assert.equal(count(h.sceneDisposeCounts, 'abort-me'),
        stage === 'instantiated' || stage === 'constraint' || stage === 'commit' ? 1 : 0)
      await h.controller.destroy()
    })
  }

  it('disposes every scene and staging resource exactly once across replace and repeated destroy', async () => {
    const h = makeHarness()
    await seedActive(h, 'one')
    await seedActive(h, 'two')
    assert.equal(count(h.sceneDisposeCounts, 'one'), 1)
    assert.equal(count(h.sceneDisposeCounts, 'two'), 0)
    const destroyA = h.controller.destroy()
    const destroyB = h.controller.destroy()
    assert.equal(destroyA, destroyB)
    await Promise.all([destroyA, destroyB])
    assert.equal(count(h.sceneDisposeCounts, 'one'), 1)
    assert.equal(count(h.sceneDisposeCounts, 'two'), 1)
    for (const stage of ['parsed', 'canonicalized', 'validated', 'assetsReady', 'instantiated', 'constraint']) {
      assert.equal(count(h.cleanupCounts, `one:${stage}`), 1)
      assert.equal(count(h.cleanupCounts, `two:${stage}`), 1)
    }
  })

  it('keeps the new active scene complete when old active disposal fails and records a diagnostic', async () => {
    const h = makeHarness()
    h.behavior.disposeThrows.add('old')
    await seedActive(h)
    const result = await h.controller.activate(request('next', 'v2'))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(h.controller.active, result.active)
    assert.equal(h.visibleScene, 'next')
    assert.deepEqual(result.active.order, ['next.a', 'next.b', 'next.c'])
    assert.equal(count(h.sceneDisposeCounts, 'old'), 1)
    assert.ok(h.controller.snapshot.diagnostics.some(d =>
      d.code === 'ACTIVE_DISPOSE_FAILED' && d.transactionId === 'activation-1'))
    await h.controller.destroy()
  })

  it('destroy cancels an in-flight transaction, cleans late staging ownership, and is idempotent', async () => {
    const h = makeHarness()
    const entered = deferred<void>()
    const release = deferred<void>()
    h.behavior.gates.set('slow', { stage: 'instantiated', entered, release })
    const activation = h.controller.activate(request('slow'))
    await entered.promise
    const destroyA = h.controller.destroy()
    const destroyB = h.controller.destroy()
    assert.equal(destroyA, destroyB)
    release.resolve(undefined)
    const [result] = await Promise.all([activation, destroyA, destroyB])
    assertActivationFailure(result, 'instantiated', 'ACTIVATION_ABORTED')
    assert.equal(h.controller.active, null)
    assert.equal(h.controller.snapshot.status, 'destroyed')
    assert.equal(count(h.cleanupCounts, 'slow:instantiated'), 1)
  })
})

describe('E7 frame transaction', () => {
  async function setupFrameHarness() {
    const h = makeHarness()
    const active = await seedActive(h, 'frame-scene', 'v2')
    return { h, active }
  }

  function assertFrameFailure(
    result: ReturnType<Harness['controller']['commitFrame']>,
    previous: NonNullable<Harness['controller']['active']>,
    code: string,
  ): void {
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.stage, 'frame')
    assert.equal(result.error.errorCode, code)
    assert.equal(result.error.transactionId, result.transactionId)
    assert.ok(isSceneActivationError(result.error))
    assert.equal(result.snapshot.status, 'active')
    assert.equal(result.snapshot.error?.errorCode, code)
    assert.equal(result.snapshot.active?.ownerTransactionId, previous.ownerTransactionId)
  }

  it('rejects partial order and preserves the exact previous frame', async () => {
    const { h, active } = await setupFrameHarness()
    const previousOrder = active.order
    const previousDepths = active.depths
    const result = h.controller.commitFrame(frameProposal(
      active,
      ['frame-scene.a', 'frame-scene.b'],
      { 'frame-scene.a': 20, 'frame-scene.b': 21 },
    ))
    assertFrameFailure(result, active, 'FRAME_NODE_MISSING')
    assert.equal(h.controller.active, active)
    assert.equal(h.controller.active?.order, previousOrder)
    assert.equal(h.controller.active?.depths, previousDepths)
    await h.controller.destroy()
  })

  it('rejects duplicate nodes and preserves the exact previous frame', async () => {
    const { h, active } = await setupFrameHarness()
    const order = ['frame-scene.a', 'frame-scene.a', 'frame-scene.c']
    const result = h.controller.commitFrame(frameProposal(
      active,
      order,
      { 'frame-scene.a': 20, 'frame-scene.b': 21, 'frame-scene.c': 22 },
    ))
    assertFrameFailure(result, active, 'FRAME_ORDER_DUPLICATE')
    assert.equal(h.controller.active, active)
    await h.controller.destroy()
  })

  it('rejects missing depth coverage and preserves the exact previous frame', async () => {
    const { h, active } = await setupFrameHarness()
    const order = [...active.order]
    const result = h.controller.commitFrame(frameProposal(
      active,
      order,
      { 'frame-scene.a': 20, 'frame-scene.b': 21 },
    ))
    assertFrameFailure(result, active, 'FRAME_DEPTH_NODE_MISSING')
    assert.equal(h.controller.active, active)
    await h.controller.destroy()
  })

  it('rejects extra node quantity before any frame swap', async () => {
    const { h, active } = await setupFrameHarness()
    const order = [...active.order, 'frame-scene.extra']
    const result = h.controller.commitFrame(frameProposal(
      active,
      order,
      { ...active.depths, 'frame-scene.extra': 13 },
    ))
    assertFrameFailure(result, active, 'FRAME_NODE_COUNT_MISMATCH')
    assert.equal(h.controller.active, active)
    await h.controller.destroy()
  })

  it('rejects noncontinuous integer depths and preserves the exact previous frame', async () => {
    const { h, active } = await setupFrameHarness()
    const result = h.controller.commitFrame(frameProposal(
      active,
      [...active.order],
      { 'frame-scene.a': 20, 'frame-scene.b': 22, 'frame-scene.c': 23 },
    ))
    assertFrameFailure(result, active, 'FRAME_DEPTH_NONCONTINUOUS')
    assert.equal(h.controller.active, active)
    await h.controller.destroy()
  })

  it('rejects a cycle/failure constraint result and preserves the exact previous frame', async () => {
    const { h, active } = await setupFrameHarness()
    const result = h.controller.commitFrame(frameProposal(
      active,
      [...active.order],
      { 'frame-scene.a': 20, 'frame-scene.b': 21, 'frame-scene.c': 22 },
      { ok: false, code: 'CONSTRAINT_CYCLE_DETECTED', message: 'cycle injected' },
    ))
    assertFrameFailure(result, active, 'CONSTRAINT_CYCLE_DETECTED')
    assert.equal(h.controller.active, active)
    await h.controller.destroy()
  })

  it('rejects a constraint order mismatch and preserves the exact previous frame', async () => {
    const { h, active } = await setupFrameHarness()
    const proposed = [...active.order].reverse()
    const result = h.controller.commitFrame(frameProposal(
      active,
      proposed,
      { 'frame-scene.c': 20, 'frame-scene.b': 21, 'frame-scene.a': 22 },
      { order: active.order },
    ))
    assertFrameFailure(result, active, 'FRAME_CONSTRAINT_ORDER_MISMATCH')
    assert.equal(h.controller.active, active)
    await h.controller.destroy()
  })

  it('rolls back a throwing frame commit callback without disposing active resources', async () => {
    const { h, active } = await setupFrameHarness()
    h.behavior.frameThrow = true
    const nextOrder = [...active.order].reverse()
    const result = h.controller.commitFrame(frameProposal(
      active,
      nextOrder,
      { 'frame-scene.c': 20, 'frame-scene.b': 21, 'frame-scene.a': 22 },
    ))
    assertFrameFailure(result, active, 'FRAME_COMMIT_FAILED')
    assert.equal(h.controller.active, active)
    assert.deepEqual(h.visibleFrame, active.order)
    assert.equal(count(h.sceneDisposeCounts, 'frame-scene'), 0)
    await h.controller.destroy()
  })

  it('commits a complete order/depth frame in one swap without disposing scene ownership', async () => {
    const { h, active } = await setupFrameHarness()
    const nextOrder = [...active.order].reverse()
    const result = h.controller.commitFrame(frameProposal(
      active,
      nextOrder,
      { 'frame-scene.c': 20, 'frame-scene.b': 21, 'frame-scene.a': 22 },
    ))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.notEqual(result.active, active)
    assert.equal(result.active.ownerTransactionId, active.ownerTransactionId)
    assert.equal(result.active.frameVersion, active.frameVersion + 1)
    assert.deepEqual(result.active.order, nextOrder)
    assert.deepEqual(result.active.depths, {
      'frame-scene.c': 20,
      'frame-scene.b': 21,
      'frame-scene.a': 22,
    })
    assert.deepEqual(h.visibleFrame, nextOrder)
    assert.equal(count(h.sceneDisposeCounts, 'frame-scene'), 0)
    assert.ok(Object.isFrozen(h.controller.snapshot))
    assert.ok(Object.isFrozen(h.controller.snapshot.active))
    assert.ok(Object.isFrozen(h.controller.snapshot.active?.children))
    assert.ok(Object.isFrozen(h.controller.snapshot.active?.depths))
    await h.controller.destroy()
    assert.equal(count(h.sceneDisposeCounts, 'frame-scene'), 1)
  })
})
