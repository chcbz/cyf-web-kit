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


describe('workspace retry error lifecycle', () => {
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
  const make = () => {
    const wait = deferred(), epoch = ref('owner-a'), calls = []
    let attempts = 0
    const workspace = usePersonalWorkspace({ identityEpoch: epoch, api: { execute: async options => {
      if (options.url.endsWith('/usage')) return usage
      if (options.method === 'GET') {
        const id = options.url.endsWith('/b') ? 'b' : 'f'
        return { ...detail, file: { ...file, fileId: id }, latestVersion: { ...detail.latestVersion, fileId: id } }
      }
      calls.push(options)
      if (++attempts === 1) throw new TypeError('first response lost')
      return wait.promise
    } } })
    return { workspace, calls, wait, epoch }
  }
  for (const operation of ['rename', 'trash', 'restore']) {
    it(`${operation}: clears the old error on same-key retry and leaves success without a stale alert`, async () => {
      const { workspace: w, calls, wait } = make()
      try {
        await w.select('f')
        const input = operation === 'rename' ? 'renamed' : operation === 'trash' ? await w.usage() : undefined
        assert.equal(await w[operation](input), null)
        assert.match(w.error.value, /first response lost/)
        const pending = w.retryWrite('f'); await Promise.resolve()
        assert.equal(w.error.value, '')
        wait.resolve({ ...file, metadataRevision: '2' }); assert.ok(await pending)
        assert.equal(w.error.value, ''); assert.match(w.writeNotice.value, /已提交/)
        assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key'])
        assert.equal(calls[0].headers['If-Match'], calls[1].headers['If-Match'])
        assert.deepEqual(calls[0].data, calls[1].data)
      } finally { w.dispose() }
    })
  }
  it('preserves an unrelated validation error that occurs while the retry is in flight', async () => {
    const { workspace: w, wait } = make()
    try {
      await w.select('f'); await w.rename('renamed')
      const pending = w.retryWrite('f'); await Promise.resolve()
      await w.rename(''); const laterError = w.error.value
      wait.resolve({ ...file, metadataRevision: '2' }); await pending
      assert.ok(laterError); assert.equal(w.error.value, laterError)
    } finally { w.dispose() }
  })
  it('does not clear errors of another selected file when retrying an old target', async () => {
    const { workspace: w, wait } = make()
    try {
      await w.select('f'); await w.rename('renamed'); await w.select('b'); await w.rename('')
      const error = w.error.value, pending = w.retryWrite('f'); await Promise.resolve()
      assert.equal(w.error.value, error)
      wait.resolve({ ...file, metadataRevision: '2' }); await pending
      assert.equal(w.error.value, error); assert.equal(w.detail.value.file.fileId, 'b')
    } finally { w.dispose() }
  })
  it('does not clear a current error for a nonexistent retry', async () => {
    const { workspace: w } = make()
    try { await w.select('f'); await w.rename(''); const error = w.error.value
      assert.equal(await w.retryWrite('missing'), null); assert.equal(w.error.value, error)
    } finally { w.dispose() }
  })
  it('keeps a repeated transport failure visible and pending', async () => {
    let count = 0
    const w = usePersonalWorkspace({ api: { execute: async o => {
      if (o.method === 'GET') return detail
      throw new TypeError(`failure ${++count}`)
    } } })
    try { await w.select('f'); await w.rename('renamed'); await w.retryWrite('f')
      assert.match(w.error.value, /failure 2/); assert.equal(w.pendingWrites.value[0].state, 'UNKNOWN')
    } finally { w.dispose() }
  })
  it('ignores a late retry success after identity change and preserves the new identity error', async () => {
    const { workspace: w, wait, epoch } = make()
    try {
      await w.select('f'); await w.rename('renamed'); const pending = w.retryWrite('f'); await Promise.resolve()
      epoch.value = 'owner-b'; await w.rename(''); const error = w.error.value
      wait.resolve({ ...file, metadataRevision: '2' }); await pending
      assert.equal(w.error.value, error); assert.equal(w.detail.value, null); assert.deepEqual(w.pendingWrites.value, [])
    } finally { w.dispose() }
  })
})
