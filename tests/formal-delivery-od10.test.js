import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { nextTick, ref } from 'vue'
import { useFormalDeliveries } from '../src/composables/useFormalDeliveries.js'

const tick = async () => { await Promise.resolve(); await nextTick(); await Promise.resolve() }
const artifact = overrides => ({ artifactId: 'artifact-1', artifactVersion: 1, contentHash: 'a'.repeat(64), purpose: '交付报告', ...overrides })
const delivery = overrides => ({
  taskId: 'task-1', workItemId: 'work-1', deliveryId: 'delivery-1', revision: 2, deliveryVersion: 0, state: 'submitted', runId: 'run-1', producerAgentId: 'agent-1',
  summary: '正式交付摘要', manifestArtifactId: 'manifest-1', manifestArtifactVersion: 1, submittedAt: 1, taskVersion: 3, workItemVersion: 4,
  items: [artifact()], ...overrides
})

describe('OD10 formal delivery UI boundary', () => {
  it('reads the owner-only formal delivery list without query parameters and preserves frozen artifacts', async () => {
    const calls = []
    const deliveries = useFormalDeliveries({
      taskId: ref('task-1'), identityFingerprint: ref('owner:client:1'),
      adapter: { async list (request) { calls.push(request); return [delivery({ taskVersion: 0, workItemVersion: 0 })] }, async decide () {} }
    })
    await tick()
    expect(calls).to.have.length(1)
    expect(calls[0]).to.include({ taskId: 'task-1' })
    expect(calls[0]).not.to.have.property('params')
    expect(deliveries.items.value[0]).to.deep.include({ deliveryId: 'delivery-1', revision: 2, taskVersion: 0, workItemVersion: 0 })
    expect(deliveries.items.value[0].items).to.deep.equal([artifact()])
    deliveries.dispose()
  })

  it('keeps artifact revisions positive while accepting zero entity versions', async () => {
    const calls = []
    const deliveries = useFormalDeliveries({
      taskId: ref('task-1'), identityFingerprint: ref('owner:client:1'), idempotencyKeyFactory: () => 'formal-version-key-0001',
      adapter: { async list () { return [delivery()] }, async decide (request) { calls.push(request) } }
    })
    try {
      await tick()
      for (const artifactVersion of [0, -1, 1.5, '1', NaN, 2147483648]) {
        expect(await deliveries.decide({ delivery: delivery({ items: [artifact({ artifactVersion })] }), decision: 'accepted' })).to.equal(null)
      }
      expect(calls).to.have.length(0)
      for (const artifactVersion of [1, 2147483647]) {
        await deliveries.decide({ delivery: delivery({ taskVersion: 0, workItemVersion: 0, items: [artifact({ artifactVersion })] }), decision: 'accepted' })
      }
      expect(calls).to.have.length(2)
      calls.forEach(request => expect(request.expectedTaskVersion).to.equal(0))
    } finally {
      deliveries.dispose()
    }
  })

  for (const outcome of ['success', 'unknown failure']) {
    it(`ignores a stale decision ${outcome} after identity changes`, async () => {
      const identity = ref('owner-a:client:1')
      let settle
      let oldSignal
      let calls = 0
      const pending = new Promise((resolve, reject) => { settle = outcome === 'success' ? resolve : () => reject(new TypeError('response lost')) })
      const deliveries = useFormalDeliveries({
        taskId: ref('task-1'), identityFingerprint: identity, idempotencyKeyFactory: () => 'formal-identity-key-0001',
        adapter: {
          async list () { return [delivery({ summary: identity.value })] },
          async decide ({ signal }) { calls += 1; oldSignal = signal; return pending }
        }
      })
      try {
        await tick()
        const deciding = deliveries.decide({ delivery: deliveries.items.value[0], decision: 'accepted' })
        identity.value = 'owner-b:client:1'
        await tick()
        expect(oldSignal.aborted).to.equal(true)
        expect(deliveries.items.value[0].summary).to.equal('owner-b:client:1')
        settle()
        expect(await deciding).to.equal(null)
        expect(deliveries.state.value).to.equal('ready')
        expect(deliveries.items.value[0].summary).to.equal('owner-b:client:1')
        expect(deliveries.refreshRequired.value).to.equal(false)
        expect(calls).to.equal(1)
      } finally {
        deliveries.dispose()
      }
    })
  }

  it('does not send an accepted-note forbidden by the API and then refreshes authoritative state', async () => {
    const calls = []
    let listCount = 0
    const deliveries = useFormalDeliveries({
      taskId: ref('task-1'), identityFingerprint: ref('owner:client:1'), idempotencyKeyFactory: () => 'formal-test-key-0001',
      adapter: {
        async list () { listCount += 1; return [delivery({ state: listCount === 1 ? 'submitted' : 'accepted', deliveryVersion: listCount === 1 ? 0 : 1, reviewedAt: listCount === 1 ? null : 2, reviewReason: null })] },
        async decide (request) { calls.push(request) }
      }
    })
    await tick()
    await deliveries.decide({ delivery: deliveries.items.value[0], decision: 'accepted', reviewReason: '符合榜文要求。' })
    expect(calls).to.deep.equal([{
      taskId: 'task-1', deliveryId: 'delivery-1', expectedTaskVersion: 3, expectedDeliveryVersion: 2,
      decision: 'accepted', reviewReason: '', idempotencyKey: 'formal-test-key-0001', signal: calls[0].signal
    }])
    expect(listCount).to.equal(2)
    expect(deliveries.items.value[0].state).to.equal('accepted')
    deliveries.dispose()
  })

  it('requires refresh after a 409 conflict or an unknown result and does not retry the decision', async () => {
    let decisionCalls = 0
    const conflict = useFormalDeliveries({
      taskId: ref('task-1'), identityFingerprint: ref('owner:client:1'), idempotencyKeyFactory: () => 'formal-test-key-0002',
      adapter: { async list () { return [delivery()] }, async decide () { decisionCalls += 1; throw Object.assign(new Error('conflict'), { status: 409 }) } }
    })
    await tick()
    await conflict.decide({ delivery: conflict.items.value[0], decision: 'changes_requested', reviewReason: '请补充交付报告。' })
    expect(decisionCalls).to.equal(1)
    expect(conflict.state.value).to.equal('conflict')
    expect(conflict.refreshRequired.value).to.equal(true)
    expect(conflict.message.value).to.include('刷新')
    await conflict.decide({ delivery: conflict.items.value[0], decision: 'accepted' })
    expect(decisionCalls).to.equal(1)
    conflict.dispose()

    let unknownCalls = 0
    const unknown = useFormalDeliveries({
      taskId: ref('task-1'), identityFingerprint: ref('owner:client:1'), idempotencyKeyFactory: () => 'formal-test-key-0003',
      adapter: { async list () { return [delivery()] }, async decide () { unknownCalls += 1; throw new TypeError('network unavailable') } }
    })
    await tick()
    await unknown.decide({ delivery: unknown.items.value[0], decision: 'accepted' })
    expect(unknown.state.value).to.equal('unknown')
    expect(unknown.refreshRequired.value).to.equal(true)
    expect(unknown.message.value).to.include('刷新')
    await unknown.decide({ delivery: unknown.items.value[0], decision: 'accepted' })
    expect(unknownCalls).to.equal(1)
    unknown.dispose()
  })

  it('creates one explicit rework only from the changed-requested exact output version', async () => {
    const calls = []
    const changed = delivery({ state: 'changes_requested', deliveryVersion: 4, reviewedAt: 2, reviewReason: '请补充总结页。' })
    const source = {
      outputId: 'output-1', formalDeliveryId: 'delivery-1', formalDecisionVersion: 4,
      formalDeliveryState: 'changes_requested', mimeType: 'application/pdf', fileRef: { fileId: 'file-1', fileVersion: '2' }
    }
    const deliveries = useFormalDeliveries({
      taskId: ref('task-1'), identityFingerprint: ref('owner:client:1'), idempotencyKeyFactory: () => 'formal-rework-key-0001',
      adapter: {
        async list () { return [changed] },
        async decide () {},
        async createRework (request) { calls.push(request); return { executionId: 'execution-2', taskId: 'task-1', runId: 'run-2', conversationId: 'conversation-1', targetAgentId: 'agent-1', state: 'QUEUED' } }
      }
    })
    try {
      await tick()
      const result = await deliveries.createRework({ delivery: deliveries.items.value[0], source, conversationId: 'conversation-1', targetAgentId: 'agent-1', instruction: '补充总结页。', outputContentMimeType: 'application/pdf' })
      expect(result).to.include({ executionId: 'execution-2', state: 'QUEUED' })
      expect(calls).to.have.length(1)
      expect(calls[0]).to.include({ taskId: 'task-1', conversationId: 'conversation-1', targetAgentId: 'agent-1', outputContentMimeType: 'application/pdf', idempotencyKey: 'formal-rework-key-0001' })
      expect(calls[0].source).to.equal(source)
      expect(await deliveries.createRework({ delivery: deliveries.items.value[0], source: { ...source, formalDecisionVersion: 3 }, conversationId: 'conversation-1', targetAgentId: 'agent-1', instruction: '篡改版本。', outputContentMimeType: 'application/pdf' })).to.equal(null)
      expect(calls).to.have.length(1)
    } finally { deliveries.dispose() }
  })

  it('keeps the formal-delivery component credential-free after task detail moves to the Babao entry', () => {
    const bounty = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    const panel = readFileSync(new URL('../src/components/deliveries/FormalDeliveryList.vue', import.meta.url), 'utf8')
    const composable = readFileSync(new URL('../src/composables/useFormalDeliveries.js', import.meta.url), 'utf8')
    expect(bounty).to.not.include('<OutputList')
    expect(bounty).to.not.include('<FormalDeliveryList')
    expect(bounty).to.include("$emit('open-workspace')")
    expect(composable).to.include('/formal-deliveries')
    expect(composable).to.include('/decision')
    expect(composable).to.include('/rework-executions')
    expect(composable).to.not.include('leaseToken')
    expect(panel).to.not.include('leaseToken')
    expect(panel).to.not.include('Authorization')
    expect(panel).to.include("delivery.state === 'submitted'")
    expect(panel).to.include("delivery.state === 'changes_requested'")
    expect(panel).to.include('固定 artifact 列表')
    expect(panel).to.include('验收意见')
  })
})
