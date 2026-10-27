import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { deliberationStatusText } from '../src/composables/juyiting/hallDeliberationState.js'
import { usePersonalWorkspaceTaskLinks } from '../src/composables/usePersonalWorkspaceTaskLinks.js'
import { usePersonalWorkspaceConversationLinks } from '../src/composables/usePersonalWorkspaceConversationLinks.js'

describe('user-facing copy cleanup', () => {
  it('shows progress without exposing engine, route, profile or sandbox', () => {
    assert.equal(deliberationStatusText({ state: 'QUEUED', route: 'CHAT', engine: 'internal-engine', profile: 'fast', sandbox: 'workspace-write' }, []), '排队中')
    assert.equal(deliberationStatusText({ state: 'CANCELLED', route: 'INSPECT' }, []), '已取消')
  })
  for (const [factory, key] of [[usePersonalWorkspaceTaskLinks, 'taskId'], [usePersonalWorkspaceConversationLinks, 'conversationId']]) {
    it(`${key}: successful same-key recovery is quiet; unknown state still offers recovery without internal ids`, async () => {
      const requests = []
      const links = factory({ [key]: ref('internal-parent'), api: { execute: async options => {
        requests.push(options)
        if (requests.length === 1) throw new TypeError('response lost')
        return { relationId: 'rel', [key]: 'internal-parent', fileId: 'internal-file', version: '1', role: 'REFERENCE', state: 'ACTIVE', relationRevision: '1', createdAt: 1 }
      } } })
      try {
        assert.equal(await links.attach({ fileId: 'internal-file', version: '1', role: 'REFERENCE' }), null)
        assert.equal(links.pendingWrites.value.length, 1)
        assert.equal(links.pendingWrites.value[0].label, '添加资料')
        assert.ok(await links.retryWrite(links.pendingWrites.value[0].target))
        assert.equal(links.writeNotice.value, '')
        assert.equal(links.error.value, '')
        assert.equal(links.pendingWrites.value.length, 0)
        assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key'])
        assert.deepEqual(requests[0].data, requests[1].data)
      } finally { links.dispose() }
    })
  }
  it('removes optional technical disclosures, not failure or payment notices', () => {
    const source = p => readFileSync(new URL(`../src/components/${p}`, import.meta.url), 'utf8').split('<script')[0]
    assert.doesNotMatch(source('deliveries/FormalDeliveryList.vue'), /formal-technical|manifestHash/)
    assert.doesNotMatch(source('juyiting/HallDraftEditor.vue'), /technical-details|成果来自执行/)
    assert.doesNotMatch(source('personal-workspace/TaskMaterialLinks.vue'), /<dt>(执行编号|运行编号)<\/dt>|input manifest/)
    const hosting = source('juyiting/HostingRentPanel.vue')
    assert.match(hosting, /租金已预留，尚未完成安顿/)
    assert.match(hosting, /不要重复付款/)
    assert.match(hosting, /费用另计/)
    assert.match(hosting, /role="alert"/)
  })
})
