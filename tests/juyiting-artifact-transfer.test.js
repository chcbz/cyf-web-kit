import { expect } from 'chai'
import { ref } from 'vue'
import { createApi } from '../src/composables/useHttp.js'
import { MAX_DOWNLOAD_BYTES, MAX_UPLOAD_BYTES, useHallArtifactTransfer } from '../src/composables/juyiting/useHallArtifactTransfer.js'

const subject = ref({ taskId: 'task-1', actorAgentId: 'agent-1' })
const workspace = ref({ recentArtifacts: [{ artifactId: 'artifact-1', artifactVersion: '2', title: '已有成果' }] })
const identity = ref(1)
const file = (content = Uint8Array.from([0, 255, 1, 2]), type = 'application/zip') => ({
  name: 'artifact.zip', type, size: content.byteLength, arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)
})
const transfer = (options = {}) => useHallArtifactTransfer({ subject, workspace, identityEpoch: identity, ...options })
const authApi = () => {
  const api = createApi('/agent')
  return { execute: options => api.execute({ ...options, authStore: { authorizationGeneration: 1, token: async () => 'artifact-token' } }) }
}
const publishReply = body => ({ artifactId: body.artifactId, artifactVersion: body.artifactVersion, contentHash: 'a'.repeat(64), contentByteLength: 4, contentMimeType: body.contentMimeType, createdAt: 1 })

describe('F02 Juyi Hall artifact transfer', () => {
  it('uses the actual createApi/useHttp boundary for strict JSON upload and exact binary download', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    const clicks = []
    const urls = []
    const bytes = Uint8Array.from([0, 255, 1, 2])
    try {
      globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), options })
        if (options.method === 'POST') {
          const body = JSON.parse(options.body)
          return new Response(JSON.stringify(publishReply(body)), { status: 201, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(new ReadableStream({ start (controller) { controller.enqueue(bytes); controller.close() } }), {
          status: 200, headers: { 'Content-Type': 'application/zip', 'Content-Length': String(bytes.byteLength), 'Content-Disposition': 'attachment' }
        })
      }
      const t = transfer({ api: authApi(), documentRef: { createElement: () => ({ click () { clicks.push(true) } }) }, urlApi: { createObjectURL: blob => { urls.push(blob); return 'blob:f02' }, revokeObjectURL () {} } })
      expect(t.setFile(file())).to.equal(true)
      t.draft.value = { ...t.draft.value, artifactId: 'artifact-1', artifactType: 'evidence', title: '精确字节', expectedPreviousVersion: 2, artifactVersion: 3 }
      const receipt = await t.publish()
      expect(receipt).to.include({ artifactId: 'artifact-1', artifactVersion: 3, contentByteLength: 4, contentMimeType: 'application/zip' })
      expect(requests[0].url).to.equal('/agent/tasks/task-1/artifacts?actorAgentId=agent-1')
      expect(requests[0].options.headers.Authorization).to.equal('Bearer artifact-token')
      expect(JSON.parse(requests[0].options.body)).to.deep.equal({ artifactId: 'artifact-1', workItemId: null, artifactType: 'evidence', title: '精确字节', contentBytes: 'AP8BAg==', contentMimeType: 'application/zip', artifactVersion: 3, expectedPreviousVersion: 2, visibility: 'task_members', metadata: {} })
      t.selectDownload({ artifactId: 'artifact-1', artifactVersion: '3' })
      const download = await t.downloadExact()
      expect(requests[1].url).to.equal('/agent/tasks/task-1/artifacts/artifact-1/versions/3/content?actorAgentId=agent-1')
      expect(requests[1].options.headers.Authorization).to.equal('Bearer artifact-token')
      expect(Array.from(new Uint8Array(await download.blob.arrayBuffer()))).to.deep.equal(Array.from(bytes))
      expect(clicks).to.have.length(1); expect(urls).to.have.length(1)
      t.dispose()
    } finally { globalThis.fetch = originalFetch }
  })

  it('bounds file type, size, and monotonic exact integer versions before transport', async () => {
    const calls = []
    const t = transfer({ api: { execute: async options => { calls.push(options); return {} } } })
    expect(t.setFile({ ...file(), size: MAX_UPLOAD_BYTES + 1 })).to.equal(false)
    expect(t.setFile(file(Uint8Array.of(1), 'application/octet-stream'))).to.equal(false)
    expect(t.setFile(file())).to.equal(true)
    t.draft.value = { ...t.draft.value, artifactId: 'artifact-1', title: 'x', artifactVersion: 4, expectedPreviousVersion: 2 }
    await t.publish()
    expect(t.message.value).to.include('前一版本加一')
    expect(calls).to.deep.equal([])
  })

  it('requires explicit refresh on 409 and clears stale local selection on terminal access errors', async () => {
    let calls = 0
    const t = transfer({ api: { execute: async () => { calls += 1; throw Object.assign(new Error('changed'), { status: 409 }) } } })
    expect(t.setFile(file())).to.equal(true)
    t.draft.value = { ...t.draft.value, artifactId: 'artifact-1', title: 'x', artifactVersion: 3, expectedPreviousVersion: 2 }
    await t.publish()
    expect(t.state.value).to.equal('conflict'); expect(t.conflict.value).to.equal(true); expect(calls).to.equal(1)
    t.download.value = { artifactId: 'artifact-1', artifactVersion: '2' }
    t.receipt.value = { artifactId: 'artifact-1' }
    const denied = transfer({ api: { execute: async () => { throw Object.assign(new Error('denied'), { status: 403 }) } } })
    denied.download.value = { artifactId: 'artifact-1', artifactVersion: '2' }
    denied.receipt.value = { artifactId: 'artifact-1' }
    await denied.downloadExact()
    expect(denied.download.value).to.deep.equal({ artifactId: '', artifactVersion: '' })
    expect(denied.receipt.value).to.equal(null)
  })

  it('fences and aborts a late operation on identity change, supports explicit cancel, and revokes object URLs', async () => {
    let signal
    let resolve
    const pending = new Promise(done => { resolve = done })
    const revoked = []
    const t = transfer({ api: { execute: options => { signal = options.signal; return pending } }, urlApi: { createObjectURL: () => 'blob:held', revokeObjectURL: url => revoked.push(url) } })
    expect(t.setFile(file())).to.equal(true)
    t.draft.value = { ...t.draft.value, artifactId: 'artifact-1', title: 'x', artifactVersion: 3, expectedPreviousVersion: 2 }
    const operation = t.publish()
    await new Promise(resolveTick => setTimeout(resolveTick, 0))
    identity.value = 2
    expect(signal.aborted).to.equal(true)
    resolve({ data: publishReply({ artifactId: 'artifact-1', artifactVersion: 3, contentMimeType: 'application/zip' }) })
    expect(await operation).to.equal(null)
    expect(t.receipt.value).to.equal(null)
    let cancelResolve
    const pendingCancel = new Promise(done => { cancelResolve = done })
    const cancellable = transfer({ api: { execute: () => pendingCancel } })
    expect(cancellable.setFile(file())).to.equal(true)
    cancellable.draft.value = { ...cancellable.draft.value, artifactId: 'artifact-1', title: 'x', artifactVersion: 3, expectedPreviousVersion: 2 }
    const cancelledOperation = cancellable.publish()
    await new Promise(resolveTick => setTimeout(resolveTick, 0))
    expect(cancellable.cancel()).to.equal(true)
    cancelResolve({ data: publishReply({ artifactId: 'artifact-1', artifactVersion: 3, contentMimeType: 'application/zip' }) })
    expect(await cancelledOperation).to.equal(null)
    expect(cancellable.state.value).to.equal('cancelled')
    t.revokeObjectUrls(); expect(revoked).to.deep.equal([])
    t.dispose(); cancellable.dispose()
  })

  it('reports disabled storage and ambiguous network outcomes without claiming a save', async () => {
    const unavailable = transfer({ api: { execute: async () => { throw Object.assign(new Error('off'), { status: 503 }) } } })
    expect(unavailable.setFile(file())).to.equal(true)
    unavailable.draft.value = { ...unavailable.draft.value, artifactId: 'artifact-1', title: 'x', artifactVersion: 3, expectedPreviousVersion: 2 }
    await unavailable.publish()
    expect(unavailable.state.value).to.equal('unavailable')
    expect(unavailable.receipt.value).to.equal(null)
    const ambiguous = transfer({ api: { execute: async () => { throw new TypeError('network') } } })
    expect(ambiguous.setFile(file())).to.equal(true)
    ambiguous.draft.value = { ...ambiguous.draft.value, artifactId: 'artifact-1', title: 'x', artifactVersion: 3, expectedPreviousVersion: 2 }
    await ambiguous.publish()
    expect(ambiguous.state.value).to.equal('unknown')
    expect(ambiguous.message.value).to.include('尚不能确认已保存')
  })

  it('does not leak credentials to an external origin and caps an oversized stream before file creation', async () => {
    const calls = []
    const huge = new Uint8Array(MAX_DOWNLOAD_BYTES + 1)
    const t = transfer({ api: { execute: async options => {
      calls.push(options)
      options.onStreamOpen({ reader: { read: async () => ({ done: false, value: huge }), cancel: async () => {} } }, { headers: new Headers({ 'content-length': String(huge.byteLength), 'content-type': 'application/zip' }) })
      throw Object.assign(new Error('download content too large'), { code: 'ARTIFACT_DOWNLOAD_TOO_LARGE' })
    } } })
    t.download.value = { artifactId: 'artifact-1', artifactVersion: '2' }
    await t.downloadExact()
    expect(calls[0].url).to.equal('/tasks/task-1/artifacts/artifact-1/versions/2/content')
    expect(calls[0].url).not.to.match(/^https?:/)
    expect(t.state.value).to.equal('error')
  })
})

describe('F02 getter and pre-dispatch fencing', () => {
  it('normalizes getter inputs and prevents a deferred file read from dispatching after identity change or cancel', async () => {
    subject.value = { taskId: 'task-1', actorAgentId: 'agent-1' }; identity.value = 1
    let resolveBytes; const deferredBytes = new Promise(resolve => { resolveBytes = resolve })
    const calls = []
    const t = useHallArtifactTransfer({ subject: () => subject.value, workspace: () => workspace.value, identityEpoch: () => identity.value,
      api: { execute: async options => { calls.push(options); return { data: publishReply(options.data) } } } })
    expect(t.operable.value).to.equal(true)
    expect(t.setFile({ ...file(), arrayBuffer: () => deferredBytes })).to.equal(true)
    t.draft.value = { ...t.draft.value, artifactId: 'artifact-1', title: 'deferred', artifactVersion: 3, expectedPreviousVersion: 2 }
    const first = t.publish()
    expect(t.state.value).to.equal('publishing')
    expect(await t.publish()).to.equal(null)
    t.download.value = { artifactId: 'artifact-1', artifactVersion: '2' }
    expect(await t.downloadExact()).to.equal(null)
    identity.value = 2
    resolveBytes(Uint8Array.of(1, 2, 3, 4).buffer)
    expect(await first).to.equal(null)
    expect(calls).to.deep.equal([])

    identity.value = 3
    let resolveCancelled; const cancelledBytes = new Promise(resolve => { resolveCancelled = resolve })
    expect(t.setFile({ ...file(), arrayBuffer: () => cancelledBytes })).to.equal(true)
    t.draft.value = { ...t.draft.value, artifactId: 'artifact-1', title: 'cancelled', artifactVersion: 3, expectedPreviousVersion: 2 }
    const cancelled = t.publish()
    expect(t.cancel()).to.equal(true)
    resolveCancelled(Uint8Array.of(1, 2, 3, 4).buffer)
    expect(await cancelled).to.equal(null)
    expect(calls).to.deep.equal([])
  })
})

describe('F02 ArtifactTransferPanel binding', () => {
  it('mounts the actual component and composable: getter props enable the DOM and submit one explicit upload', async () => {
    const { readFileSync } = await import('node:fs')
    const { compileScript, parse } = await import('@vue/compiler-sfc')
    const Vue = await import('vue')
    const { mount } = await import('@vue/test-utils')
    const source = readFileSync(new URL('../src/components/juyiting/ArtifactTransferPanel.vue', import.meta.url), 'utf8')
    const { descriptor } = parse(source, { filename: 'ArtifactTransferPanel.vue' })
    const body = compileScript(descriptor, { id: 'f02-artifact-transfer-test', inlineTemplate: true }).content
      .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, imports) => `var { ${imports.replace(/\s+as\s+/g, ': ')} } = Vue`)
      .replace(/^import\s+\{\s*useHallArtifactTransfer\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { useHallArtifactTransfer } = mocks')
      .replace('export default', 'return')
    const ArtifactTransferPanel = new Function('Vue', 'mocks', body)(Vue, { useHallArtifactTransfer })
    const globals = Object.fromEntries(['SVGElement', 'Element', 'Node'].map(key => [key, Object.getOwnPropertyDescriptor(global, key)]))
    for (const key of Object.keys(globals)) global[key] = global.window?.[key]
    const calls = []
    const api = { execute: async options => { calls.push(options); return { data: publishReply(options.data) } } }
    const wrapper = mount(ArtifactTransferPanel, { props: { api, subject: { taskId: 'task-1', actorAgentId: 'agent-1' }, workspace: { recentArtifacts: [] }, identityEpoch: 9 } })
    try {
      const inputs = wrapper.findAll('input')
      await inputs[0].setValue('artifact-1'); await inputs[1].setValue('evidence'); await inputs[2].setValue('DOM upload')
      await inputs[4].setValue('2'); await inputs[5].setValue('3')
      const fileInput = inputs[6]
      Object.defineProperty(fileInput.element, 'files', { configurable: true, value: [file()] })
      await fileInput.trigger('change')
      const submit = wrapper.find('.artifact-upload-form button[type="submit"]')
      expect(submit.attributes('disabled')).to.equal(undefined)
      await wrapper.find('.artifact-upload-form').trigger('submit')
      expect(calls).to.have.length(1)
      expect(calls[0]).to.include({ method: 'POST', url: '/tasks/task-1/artifacts' })
      expect(calls[0].params).to.deep.equal({ actorAgentId: 'agent-1' })
      expect(wrapper.text()).to.include('服务已确认保存')
    } finally {
      wrapper.unmount()
      for (const [key, descriptor] of Object.entries(globals)) {
        if (descriptor) Object.defineProperty(global, key, descriptor)
        else delete global[key]
      }
    }
  })
})
