import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { usePersonalWorkspaceWriteIntent } from '../src/composables/usePersonalWorkspaceWriteIntent.js'
import { usePersonalWorkspace } from '../src/composables/usePersonalWorkspace.js'
import { usePersonalWorkspaceTaskLinks } from '../src/composables/usePersonalWorkspaceTaskLinks.js'
import { usePersonalWorkspaceConversationLinks } from '../src/composables/usePersonalWorkspaceConversationLinks.js'
import { ref } from 'vue'

const file = { fileId: 'f', displayName: 'notes', state: 'ACTIVE', metadataRevision: '1', latestVersion: '1' }
const detail = { file, latestVersion: { fileId: 'f', version: '1', originalFilename: 'notes', contentMimeType: 'text/plain', byteLength: '1' }, versions: [] }
const usage = { fileId: 'f', impactRevision: '105', counts: { taskReferences: '101', conversationReferences: '2', activeInputGrants: '9007199254740993' } }

describe('workspace immutable in-page write intent', () => {
  it('joins double clicks and retries the frozen original request with the same key', async () => {
    const writes = usePersonalWorkspaceWriteIntent(), keys = []
    let fail = true
    const input = new Blob(['original'])
    const spec = { target: 'f', input: [input, '1'], label: 'append', execute: async (key, replay) => {
      keys.push([key, replay]); if (fail) throw new TypeError('connection lost'); return 'saved'
    } }
    const a = writes.run(spec), b = writes.run(spec)
    assert.equal(a, b)
    await assert.rejects(a)
    assert.equal(keys.length, 1)
    assert.equal(writes.pending.value[0].state, 'UNKNOWN')
    await assert.rejects(writes.run({ ...spec, input: [new Blob(['changed']), '1'] }), /重试原操作/)
    fail = false
    assert.equal(await writes.retry('f'), 'saved')
    assert.equal(keys[0][0], keys[1][0]); assert.equal(keys[1][1], true)
    assert.deepEqual(writes.pending.value, [])
  })
  it('retains processing and reconciliation, releases only definitive business rejection', async () => {
    for (const [code, status, state] of [['OPERATION_PROCESSING', 503, 'PROCESSING'], ['OPERATION_RECONCILIATION_REQUIRED', 503, 'UNKNOWN'], ['METADATA_CHANGED', 412, null], ['FILE_VERSION_CONFLICT', 409, null], ['GATEWAY_FAILURE', 400, 'UNKNOWN']]) {
      const writes = usePersonalWorkspaceWriteIntent()
      await assert.rejects(writes.run({ target: 'f', input: [], execute: () => { throw Object.assign(new Error(code), { code, status }) } }))
      assert.equal(writes.pending.value[0]?.state || null, state)
    }
  })
  it('does not retry a committed write when its follow-up read fails', async () => {
    const writes = usePersonalWorkspaceWriteIntent(); let calls = 0
    await assert.rejects(writes.run({ target: 'f', input: [], execute: () => { calls++; return 'saved' }, committed: () => { throw new Error('GET failed') } }))
    assert.deepEqual(writes.pending.value, [])
    await writes.retry('f'); assert.equal(calls, 1)
  })
  it('identity cleanup drops queued writes before they can send', async () => {
    const writes = usePersonalWorkspaceWriteIntent(); let calls = 0
    const pending = writes.run({ target: 'f', input: [], execute: () => { calls++ } })
    writes.clear(); assert.equal(await pending, null); assert.equal(calls, 0)
  })
  it('uses the summary snapshot revision, not stale detail, and expires a rejected confirmation', async () => {
    const requests = []
    const workspace = usePersonalWorkspace({ api: { execute: async options => {
      requests.push(options)
      if (options.url.endsWith('/usage')) return usage
      if (options.method === 'GET') return detail
      throw Object.assign(new Error('changed'), { code: 'METADATA_CHANGED', status: 412 })
    } } })
    await workspace.select('f')
    const confirmation = await workspace.usage()
    assert.equal(confirmation.counts.activeInputGrants, '9007199254740993')
    assert.equal(await workspace.trash(confirmation), null)
    assert.equal(requests.at(-1).headers['If-Match'], '"f:105"')
    assert.equal(requests.at(-1).data.impactRevision, '105')
    assert.equal(workspace.confirmationStale.value, true)
    const count = requests.length
    await workspace.trash(confirmation); assert.equal(requests.length, count)
    assert.equal(workspace.pendingWrites.value.length, 0)
    workspace.dispose()
  })
  for (const [name, factory, parentKey] of [['task', usePersonalWorkspaceTaskLinks, 'taskId'], ['conversation', usePersonalWorkspaceConversationLinks, 'conversationId']]) {
    it(`${name}: retries DELETE unchanged and displays current reattached state without repeating deletion`, async () => {
      const parent = ref('parent'), requests = []
      const original = { relationId: 'rel', [parentKey]: 'parent', fileId: 'f', version: '1', role: 'REFERENCE', state: 'ACTIVE', relationRevision: '1', createdAt: 1 }
      const links = factory({ [parentKey]: parent, api: { execute: async options => {
        requests.push(options)
        if (requests.length === 1) throw new TypeError('lost response')
        return { link: { ...original, relationRevision: '3' }, executionSnapshotsPreserved: true }
      } } })
      assert.equal(await links.detach(original), null)
      const target = links.pendingWrites.value[0].target
      parent.value = 'other'; await links.retryWrite(target); assert.equal(requests.length, 1); assert.match(links.error.value, /返回原/)
      parent.value = 'parent'
      const result = await links.retryWrite(target)
      assert.equal(result.link.state, 'ACTIVE'); assert.match(links.writeNotice.value, /重新关联/)
      assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key'])
      assert.equal(requests[1].headers['If-Match'], '"rel:1"')
      assert.equal(links.pendingWrites.value.length, 0)
      links.dispose()
    })
  }
})
