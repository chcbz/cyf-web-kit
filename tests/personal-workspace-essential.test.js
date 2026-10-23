import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { ref } from 'vue'
import { usePersonalWorkspace } from '../src/composables/usePersonalWorkspace.js'
import { usePersonalWorkspaceTaskLinks } from '../src/composables/usePersonalWorkspaceTaskLinks.js'
import { usePersonalWorkspaceConversationLinks } from '../src/composables/usePersonalWorkspaceConversationLinks.js'
import { workspaceByteText, workspaceRevisionTag, validMaterialVersion } from '../src/utils/personalWorkspaceProtocol.js'

const file = (id = 'a', changes = {}) => ({ fileId: id, displayName: `${id}.txt`, state: 'ACTIVE', latestVersion: '1', metadataRevision: '1', ...changes })
const version = (id = 'a', n = '1') => ({ fileId: id, version: n, originalFilename: `${id}-v${n}.txt`, contentMimeType: 'text/plain', byteLength: '5' })
const detail = (id = 'a', changes = {}) => ({ file: file(id), latestVersion: version(id), versions: [version(id)], ...changes })
const page = (items, nextCursor = null) => ({ items, nextCursor, hasMore: nextCursor !== null })
const reply = (options, data, headers = {}) => { options.onSuccess?.(data, { headers }); return data }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const uploadFile = () => { const value = new Blob(['hello'], { type: 'text/plain' }); Object.defineProperty(value, 'name', { value: 'a.txt' }); return value }
const committed = (id = 'a', n = '1') => ({ operation: { operationId: 'op-a', state: 'COMMITTED' }, file: file(id, { latestVersion: n }), version: version(id, n) })

describe('workspace essential repairs', () => {
  it('builds a business precondition from the body, never from a weak or unrelated representation ETag', async () => {
    for (const etag of ['W/"a:1"', '"representation-only"', undefined]) {
      const writes = []
      const workspace = usePersonalWorkspace({ api: { execute: async options => {
        if (options.method === 'GET') return reply(options, detail(), { etag })
        writes.push(options)
        return reply(options, file('a', { metadataRevision: '2', displayName: 'renamed' }), { etag: 'W/"a:2"' })
      } } })
      await workspace.select('a')
      assert.equal((await workspace.rename('renamed')).displayName, 'renamed')
      assert.equal(writes[0].headers['If-Match'], '"a:1"')
      assert.equal(workspace.detail.value.etag, '"a:2"')
      workspace.dispose()
    }
  })
  for (const operation of ['rename', 'restore', 'appendVersion', 'upload']) {
    it(`does not let a late ${operation} select or overwrite another file`, async () => {
      const wait = deferred()
      const calls = []
      const workspace = usePersonalWorkspace({ api: { execute: async options => {
        calls.push(options)
        if (options.method !== 'GET') return wait.promise
        return detail(options.url.endsWith('/b') ? 'b' : 'a')
      } } })
      await workspace.select('a')
      const pending = operation === 'rename' ? workspace.rename('renamed') : operation === 'restore' ? workspace.restore() : workspace[operation](uploadFile())
      await workspace.select('b')
      const state = workspace.actionState.value
      wait.resolve(['upload', 'appendVersion'].includes(operation) ? committed('a', operation === 'appendVersion' ? '2' : '1') : file('a', { metadataRevision: '2' }))
      assert.ok(await pending)
      assert.equal(workspace.detail.value.file.fileId, 'b')
      assert.equal(workspace.detail.value.latestVersion.fileId, 'b')
      assert.equal(workspace.actionState.value, state)
      assert.equal(calls.filter(x => x.method === 'GET').length, 2)
      workspace.dispose()
    })
  }
  it('does not reopen a closed detail or show a late write error on a new view', async () => {
    const read = deferred(), write = deferred()
    let delayed = false
    const workspace = usePersonalWorkspace({ api: { execute: options => options.method !== 'GET' ? write.promise : delayed ? read.promise : Promise.resolve(detail()) } })
    await workspace.select('a')
    const saving = workspace.rename('new')
    workspace.closeDetail()
    write.reject(new Error('old write error'))
    await saving
    assert.equal(workspace.error.value, '')
    delayed = true
    const selecting = workspace.select('a')
    workspace.closeDetail()
    read.resolve(detail())
    assert.equal(await selecting, null)
    assert.equal(workspace.detail.value, null)
    workspace.dispose()
  })
  it('rejects file mismatches in details and write acknowledgements', async () => {
    const workspace = usePersonalWorkspace({ api: { execute: async () => detail('b') } })
    assert.equal(await workspace.select('a'), null)
    workspace.dispose()
    const other = usePersonalWorkspace({ api: { execute: async options => options.method === 'GET' ? detail() : file('b') } })
    await other.select('a')
    assert.equal(await other.rename('new'), null)
    assert.equal(other.detail.value.file.fileId, 'a')
    other.dispose()
  })
  it('allows new filters while a read is pending and drops the old response and finalizer', async () => {
    const first = deferred(), second = deferred()
    let count = 0
    const workspace = usePersonalWorkspace({ api: { execute: () => ++count === 1 ? first.promise : second.promise } })
    const old = workspace.refresh({ q: 'old' })
    const current = workspace.refresh({ q: 'new', state: 'TRASHED' })
    first.resolve(page([file('old')], 'old-cursor'))
    assert.equal(await old, false)
    assert.equal(workspace.loading.value, true)
    second.resolve(page([file('new', { state: 'TRASHED' })]))
    assert.equal(await current, true)
    assert.deepEqual(workspace.items.value.map(x => x.fileId), ['new'])
    assert.equal(workspace.nextCursor.value, null)
    workspace.dispose()
  })
  it('never attaches an old cursor to edited filters', async () => {
    const calls = []
    const workspace = usePersonalWorkspace({ api: { execute: async options => { calls.push(options); return page([file()], calls.length === 1 ? 'old-cursor' : null) } } })
    await workspace.refresh({ q: 'old' })
    await workspace.loadMore({ q: 'new' })
    assert.deepEqual(calls[1].params, { state: 'ACTIVE', q: 'new' })
    workspace.dispose()
  })
  it('keeps confirmed upload success distinct from failed detail reads and retries only GET', async () => {
    const methods = []
    let readable = false
    const workspace = usePersonalWorkspace({ api: { execute: async options => {
      methods.push(options.method)
      if (options.method === 'POST') return committed()
      if (!readable) throw new Error('detail unavailable')
      return detail()
    } } })
    assert.ok(await workspace.upload(uploadFile()))
    assert.equal(workspace.actionState.value, 'ready')
    assert.equal(workspace.detail.value, null)
    assert.match(workspace.writeNotice.value, /已保存.*详情读取失败/)
    assert.equal(workspace.detailRetryFileId.value, 'a')
    readable = true
    assert.ok(await workspace.retryDetail())
    assert.deepEqual(methods, ['POST', 'GET', 'GET'])
    assert.equal(workspace.detailRetryFileId.value, null)
    workspace.dispose()
  })
  it('binds a reactive recycle confirmation to the exact view, not a later file', async () => {
    const calls = []
    const workspace = usePersonalWorkspace({ api: { execute: async options => {
      calls.push(options)
      if (options.url.endsWith('/usage')) return { fileId: 'a', impactRevision: '1', counts: { taskReferences: '0', conversationReferences: '0', activeInputGrants: '0' } }
      if (options.method === 'POST') return file('a', { state: 'TRASHED', metadataRevision: '2' })
      return detail(options.url.endsWith('/b') ? 'b' : 'a')
    } } })
    await workspace.select('a')
    const confirmation = ref(await workspace.usage())
    assert.ok(await workspace.trash(confirmation.value))
    await workspace.select('b')
    assert.equal(await workspace.trash(confirmation.value), null)
    assert.equal(calls.filter(x => x.method === 'POST').length, 1)
    workspace.dispose()
  })
  it('loads versions lazily, traverses the >100 boundary, and uses exact old-version filenames', async () => {
    const calls = []
    const recent = Array.from({ length: 100 }, (_, i) => version('a', String(102 - i)))
    const workspace = usePersonalWorkspace({ api: { execute: async options => {
      calls.push(options)
      if (options.url.endsWith('/content')) return new Blob(['old'], { type: 'text/plain' })
      if (options.url.endsWith('/versions')) return options.params?.cursor ? page([version('a', '2'), version('a', '1')]) : page(recent, 'cursor-a')
      return detail('a', { file: file('a', { latestVersion: '102' }), latestVersion: recent[0], versions: recent })
    } } })
    await workspace.select('a')
    assert.equal(calls.length, 1)
    assert.equal(workspace.hasMoreVersions.value, true)
    await workspace.loadMoreVersions()
    await workspace.loadMoreVersions()
    assert.equal(workspace.versionItems.value.length, 102)
    assert.equal(workspace.hasMoreVersions.value, false)
    const result = await workspace.download('1')
    assert.equal(result.filename, 'a-v1.txt')
    assert.ok(calls.at(-1).url.endsWith('/versions/1/content'))
    workspace.dispose()
  })
  it('drops history pages after another selection', async () => {
    const wait = deferred()
    const workspace = usePersonalWorkspace({ api: { execute: async options => options.url.endsWith('/versions') ? wait.promise : detail(options.url.endsWith('/b') ? 'b' : 'a') } })
    await workspace.select('a')
    const loading = workspace.loadVersions()
    await workspace.select('b')
    wait.resolve(page([version()]))
    assert.equal(await loading, false)
    assert.equal(workspace.versionItems.value[0].fileId, 'b')
    assert.equal(workspace.versionsState.value, 'idle')
    workspace.dispose()
  })
  it('clears an old successful preview on invalid selection and defaults downloads to a string version', async () => {
    const calls = []
    const workspace = usePersonalWorkspace({ api: { execute: async options => { calls.push(options); return options.responseType === 'blob' ? new Blob(['hello']) : detail() } } })
    await workspace.select('a')
    assert.ok(await workspace.download())
    assert.ok(calls.at(-1).url.endsWith('/versions/1/content'))
    workspace.preview.value = { kind: 'text', text: 'stale' }
    assert.equal(await workspace.previewVersion(1), null)
    assert.equal(workspace.preview.value.kind, 'error')
    workspace.dispose()
  })
  it('preserves int64 byte sizes and int32 string versions without coercion', () => {
    assert.equal(workspaceByteText('0'), '0 B')
    assert.equal(workspaceByteText('1024'), '1.0 KiB')
    assert.equal(workspaceByteText('9223372036854775807'), '7.9 EiB')
    assert.equal(workspaceByteText(5), '5 B')
    assert.equal(workspaceByteText('01'), '大小未知')
    assert.equal(validMaterialVersion('2147483647'), true)
    assert.equal(validMaterialVersion('2147483648'), false)
    assert.equal(validMaterialVersion(1), false)
    assert.equal(workspaceRevisionTag('a', '9007199254740993'), '"a:9007199254740993"')
    assert.throws(() => workspaceRevisionTag('a"', '1'))
  })
  for (const kind of ['task', 'conversation']) {
    for (const etag of ['weak', 'absent', 'strong']) {
      it(`accepts exact ${kind} attach/detach business receipts with ${etag} transport ETag`, async () => {
        const key = kind === 'task' ? 'taskId' : 'conversationId'
        const link = { relationId: 'rel', [key]: 'parent', fileId: 'a', version: '1', role: 'INPUT', state: 'ACTIVE', relationRevision: '1', createdAt: 1 }
        const calls = []
        const factory = kind === 'task' ? usePersonalWorkspaceTaskLinks : usePersonalWorkspaceConversationLinks
        const adapter = factory({ [key]: ref('parent'), api: { execute: async options => {
          calls.push(options)
          const data = options.method === 'POST' ? link : { link: { ...link, state: 'DETACHED', relationRevision: '2' }, executionSnapshotsPreserved: true }
          const tag = `"rel:${options.method === 'POST' ? '1' : '2'}"`
          return reply(options, data, etag === 'absent' ? {} : { etag: etag === 'weak' ? `W/${tag}` : tag })
        } } })
        assert.ok(await adapter.attach({ fileId: 'a', version: '1', role: 'INPUT' }))
        assert.ok(await adapter.detach(link))
        assert.equal(calls.length, 2)
        assert.equal(calls[1].headers['If-Match'], '"rel:1"')
        adapter.dispose()
      })
    }
  }
})
