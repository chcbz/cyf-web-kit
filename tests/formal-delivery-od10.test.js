import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { nextTick, ref } from 'vue'
import { useFormalDeliveries } from '../src/composables/useFormalDeliveries.js'

const tick = async () => { await Promise.resolve(); await nextTick(); await Promise.resolve() }
const artifact = overrides => ({ artifactId: 'artifact-1', artifactVersion: 1, contentHash: 'a'.repeat(64), purpose: '交付报告', ...overrides })
const delivery = overrides => ({
  taskId: 'task-1', workItemId: 'work-1', deliveryId: 'delivery-1', revision: 2, state: 'submitted', runId: 'run-1', producerAgentId: 'agent-1',
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

  it('does not send an accepted-note forbidden by the API and then refreshes authoritative state', async () => {
    const calls = []
    let listCount = 0
    const deliveries = useFormalDeliveries({
      taskId: ref('task-1'), identityFingerprint: ref('owner:client:1'), idempotencyKeyFactory: () => 'formal-test-key-0001',
      adapter: {
        async list () { listCount += 1; return [delivery({ state: listCount === 1 ? 'submitted' : 'accepted', reviewedAt: 2, reviewReason: '符合榜文要求。' })] },
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
    await conflict.decide({ delivery: conflict.items.value[0], decision: 'changes_requested' })
    expect(decisionCalls).to.equal(1)
    expect(conflict.state.value).to.equal('conflict')
    expect(conflict.refreshRequired.value).to.equal(true)
    expect(conflict.message.value).to.include('刷新')
    conflict.dispose()

    const unknown = useFormalDeliveries({
      taskId: ref('task-1'), identityFingerprint: ref('owner:client:1'), idempotencyKeyFactory: () => 'formal-test-key-0003',
      adapter: { async list () { return [delivery()] }, async decide () { throw new TypeError('network unavailable') } }
    })
    await tick()
    await unknown.decide({ delivery: unknown.items.value[0], decision: 'accepted' })
    expect(unknown.state.value).to.equal('unknown')
    expect(unknown.refreshRequired.value).to.equal(true)
    expect(unknown.message.value).to.include('刷新')
    unknown.dispose()
  })

  it('keeps formal delivery separate from the existing shared-output list and never renders credentials', () => {
    const bounty = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    const panel = readFileSync(new URL('../src/components/deliveries/FormalDeliveryList.vue', import.meta.url), 'utf8')
    const composable = readFileSync(new URL('../src/composables/useFormalDeliveries.js', import.meta.url), 'utf8')
    expect(bounty).to.include('<OutputList')
    expect(bounty).to.include('<FormalDeliveryList')
    expect(composable).to.include('/formal-deliveries')
    expect(composable).to.include('/decision')
    expect(composable).to.not.include('leaseToken')
    expect(panel).to.not.include('leaseToken')
    expect(panel).to.not.include('Authorization')
    expect(panel).to.include("delivery.state === 'submitted'")
    expect(panel).to.include('固定 artifact 列表')
    expect(panel).to.include('验收意见')
  })
})
