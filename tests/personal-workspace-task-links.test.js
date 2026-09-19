import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { ref } from 'vue'
import { usePersonalWorkspaceTaskLinks } from '../src/composables/usePersonalWorkspaceTaskLinks.js'

const link = (overrides = {}) => ({
  relationId: 'rel_a', taskId: 'task_a', fileId: 'file_a', version: 2,
  role: 'INPUT', state: 'ACTIVE', relationRevision: 1, createdAt: 1, ...overrides
})
const deferred = () => { let resolve; const promise = new Promise(res => { resolve = res }); return { promise, resolve } }

const etag = value => `"${value.relationId}:${value.relationRevision}"`

describe('personal workspace task link adapter', () => {
  it('lists exact task links, writes explicit pinned versions, and sends a conditional idempotent detach', async () => {
    const calls = []
    const initial = link()
    const detached = link({ state: 'DETACHED', relationRevision: 2 })
    const api = { execute: async options => {
      calls.push(options)
      if (options.method === 'GET') return { data: { items: [initial], nextCursor: null } }
      if (options.method === 'POST') return { data: link({ relationId: 'rel_b', fileId: 'file_b', role: 'REFERENCE' }), headers: { etag: '"rel_b:1"' } }
      return { data: { link: detached, executionSnapshotsPreserved: true }, headers: { etag: etag(detached) } }
    } }
    const adapter = usePersonalWorkspaceTaskLinks({ api, taskId: ref('task_a'), identityEpoch: ref('owner-a') })

    assert.equal(await adapter.load(), true)
    const attached = await adapter.attach({ fileId: 'file_b', version: 3, role: 'REFERENCE' })
    const result = await adapter.detach(initial)

    assert.equal(calls[0].url, '/tasks/task_a/file-links')
    assert.equal(calls[0].method, 'GET')
    assert.deepEqual(calls[1].data, { fileId: 'file_b', version: 3, role: 'REFERENCE' })
    assert.ok(calls[1].headers['Idempotency-Key'])
    assert.equal(attached.relationId, 'rel_b')
    assert.equal(calls[2].url, '/tasks/task_a/file-links/rel_a')
    assert.equal(calls[2].headers['If-Match'], '"rel_a:1"')
    assert.ok(calls[2].headers['Idempotency-Key'])
    assert.equal(result.executionSnapshotsPreserved, true)
    assert.equal(adapter.links.value.find(item => item.relationId === 'rel_a').state, 'DETACHED')
    adapter.dispose()
  })

  it('rejects malformed server data instead of displaying an incomplete association directory', async () => {
    const api = { execute: async () => ({ data: { items: [link({ ownerJiacn: 'forged-owner' })], nextCursor: null } }) }
    const adapter = usePersonalWorkspaceTaskLinks({ api, taskId: ref('task_a'), identityEpoch: ref('owner-a') })

    assert.equal(await adapter.load(), false)
    assert.equal(adapter.listState.value, 'error')
    assert.match(adapter.error.value, /返回格式无效/)
    assert.deepEqual(adapter.links.value, [])
    adapter.dispose()
  })

  it('cancels and drops a late task directory response when the JWT identity changes', async () => {
    const epoch = ref('owner-a')
    const wait = deferred()
    let signal
    const api = { execute: options => { signal = options.signal; return wait.promise } }
    const adapter = usePersonalWorkspaceTaskLinks({ api, taskId: ref('task_a'), identityEpoch: epoch })
    const pending = adapter.load()
    epoch.value = 'owner-b'
    wait.resolve({ data: { items: [link()], nextCursor: null } })

    assert.equal(await pending, false)
    assert.equal(signal.aborted, true)
    assert.deepEqual(adapter.links.value, [])
    assert.equal(adapter.listState.value, 'idle')
    adapter.dispose()
  })

  it('maps conditional and idempotency failures without retrying or accepting an invalid local request', async () => {
    const calls = []
    const api = { execute: async options => {
      calls.push(options)
      if (options.method === 'POST') throw Object.assign(new Error('conflict'), { status: 409, code: 'IDEMPOTENCY_CONFLICT' })
      throw Object.assign(new Error('missing precondition'), { status: 428, code: 'PRECONDITION_REQUIRED' })
    } }
    const adapter = usePersonalWorkspaceTaskLinks({ api, taskId: ref('task_a'), identityEpoch: ref('owner-a') })

    assert.equal(await adapter.attach({ fileId: 'file_a', version: 2, role: 'OUTPUT' }), null)
    assert.equal(calls.length, 0)
    assert.match(adapter.error.value, /输入资料或参考资料/)
    assert.equal(await adapter.attach({ fileId: 'file_a', version: 2, role: 'INPUT' }), null)
    assert.match(adapter.error.value, /已有操作不一致/)
    assert.equal(await adapter.detach(link()), null)
    assert.match(adapter.error.value, /版本前提缺失/)
    assert.equal(calls.length, 2)
    adapter.dispose()
  })
})
