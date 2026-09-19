import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { ref } from 'vue'
import { usePersonalWorkspace } from '../src/composables/usePersonalWorkspace.js'

const fileView = (overrides = {}) => ({ fileId: 'pws_file', sourceKind: 'UPLOAD', displayName: 'notes.txt', mediaFamily: 'TEXT', state: 'ACTIVE', metadataRevision: 1, latestVersion: 1, createdAt: 1, capabilities: {}, ...overrides })
const versionView = (overrides = {}) => ({ fileId: 'pws_file', version: 1, originalFilename: 'notes.txt', contentMimeType: 'text/plain', byteLength: 5, sha256: 'a'.repeat(64), createdAt: 1, previewState: 'READY', ...overrides })
const deferred = () => { let resolve; const promise = new Promise(res => { resolve = res }); return { promise, resolve } }
const browserFile = (name, type, body = 'hello') => {
  const blob = new Blob([body], { type })
  Object.defineProperty(blob, 'name', { value: name })
  return blob
}

describe('personal workspace browser adapter', () => {
  it('sends a multipart owner-scoped upload with an idempotency key and then reads its exact detail', async () => {
    const calls = []
    const api = { execute: async options => {
      calls.push(options)
      if (options.method === 'POST') return { data: { operation: { operationId: 'pwo_1', state: 'COMMITTED', fileId: 'pws_file', fileVersion: 1 }, file: fileView(), version: versionView() } }
      return { data: { file: fileView(), latestVersion: versionView(), versions: [versionView()], relations: [], derivation: [] }, headers: { etag: '"pws_file:1"' } }
    } }
    const workspace = usePersonalWorkspace({ api, identityEpoch: ref('owner-a') })
    const result = await workspace.upload(browserFile('notes.txt', 'text/plain'), '项目笔记')

    assert.equal(result.file.fileId, 'pws_file')
    assert.equal(calls[0].url, '/personal-workspace/files')
    assert.equal(calls[0].method, 'POST')
    assert.ok(calls[0].data instanceof FormData)
    assert.ok(typeof calls[0].headers['Idempotency-Key'] === 'string' && calls[0].headers['Idempotency-Key'].length > 0)
    assert.equal(calls[1].url, '/personal-workspace/files/pws_file')
    assert.equal(workspace.detail.value.etag, '"pws_file:1"')
    workspace.dispose()
  })

  it('accepts legacy rows without originKind so a web rollout does not hide pre-migration files', async () => {
    const api = { execute: async () => ({ data: { items: [fileView({ originKind: undefined })], nextCursor: null } }) }
    const workspace = usePersonalWorkspace({ api, identityEpoch: ref('owner-a') })

    assert.equal(await workspace.refresh({ state: 'ACTIVE' }), true)
    assert.equal(workspace.items.value[0].originKind, undefined)
    workspace.dispose()
  })

  it('rejects an untrusted workspace origin enum rather than rendering a fabricated source', async () => {
    const api = { execute: async () => ({ data: { items: [fileView({ originKind: 'OTHER_OWNER' })], nextCursor: null } }) }
    const workspace = usePersonalWorkspace({ api, identityEpoch: ref('owner-a') })

    assert.equal(await workspace.refresh({ state: 'ACTIVE' }), false)
    assert.equal(workspace.listState.value, 'error')
    workspace.dispose()
  })

  it('drops a late list response after the authenticated identity epoch changes', async () => {
    const epoch = ref('owner-a')
    const wait = deferred()
    const workspace = usePersonalWorkspace({ api: { execute: () => wait.promise }, identityEpoch: epoch })
    const pending = workspace.refresh({ state: 'ACTIVE' })
    epoch.value = 'owner-b'
    wait.resolve({ data: { items: [fileView()], nextCursor: null } })
    await pending

    assert.deepEqual(workspace.items.value, [])
    assert.equal(workspace.listState.value, 'idle')
    workspace.dispose()
  })

  it('renders a server-confirmed image preview only when the preview part preserves the image MIME type', async () => {
    const urls = []
    const api = { execute: async options => {
      if (options.url.endsWith('/preview')) return { data: { state: 'READY', parts: [{ partId: 'content', contentMimeType: 'image/png' }], partial: false } }
      if (options.url.endsWith('/preview/parts/content')) return { data: new Blob(['png-bytes'], { type: 'image/png' }) }
      return { data: { file: fileView({ mediaFamily: 'IMAGE', displayName: 'poster.png' }), latestVersion: versionView({ contentMimeType: 'image/png', originalFilename: 'poster.png' }), versions: [versionView({ contentMimeType: 'image/png', originalFilename: 'poster.png' })], relations: [], derivation: [] }, headers: { etag: '"pws_file:1"' } }
    } }
    const workspace = usePersonalWorkspace({ api, identityEpoch: ref('owner-a'), urlApi: { createObjectURL: blob => { urls.push(blob); return 'blob:preview' }, revokeObjectURL: () => {} } })
    await workspace.select('pws_file')
    await workspace.previewVersion(1)

    assert.equal(workspace.preview.value.kind, 'image')
    assert.equal(workspace.preview.value.url, 'blob:preview')
    assert.equal(urls[0].type, 'image/png')
    workspace.dispose()
  })

  it('keeps the old single content text preview for PDF compatibility', async () => {
    const api = { execute: async options => {
      if (options.url.endsWith('/preview')) return { data: { state: 'READY', parts: [{ partId: 'content', contentMimeType: 'text/plain' }], partial: true, reason: '文本已截断' } }
      if (options.url.endsWith('/preview/parts/content')) return { data: new Blob(['第一页标题'], { type: 'text/plain' }) }
      return { data: { file: fileView({ mediaFamily: 'PDF' }), latestVersion: versionView({ contentMimeType: 'application/pdf', originalFilename: 'legacy.pdf' }), versions: [versionView({ contentMimeType: 'application/pdf', originalFilename: 'legacy.pdf' })], relations: [], derivation: [] }, headers: { etag: '"pws_file:1"' } }
    } }
    const workspace = usePersonalWorkspace({ api, identityEpoch: ref('owner-a') })
    await workspace.select('pws_file')
    await workspace.previewVersion(1)

    assert.equal(workspace.preview.value.kind, 'text')
    assert.equal(workspace.preview.value.text, '第一页标题')
    assert.match(workspace.preview.value.message, /截断/)
    workspace.dispose()
  })
})

describe('1.13.1 workspace multi-part previews', () => {
  it('navigates declared PPT page parts', async () => {
    const calls = []
    const api = { execute: async options => {
      calls.push(options.url)
      if (options.url.endsWith('/preview')) return { data: { state: 'READY', parts: [{ partId: 'page-1', contentMimeType: 'image/png' }, { partId: 'page-2', contentMimeType: 'image/png' }], partial: false } }
      if (options.url.endsWith('/preview/parts/page-1') || options.url.endsWith('/preview/parts/page-2')) return { data: new Blob(['png'], { type: 'image/png' }) }
      return { data: { file: fileView({ mediaFamily: 'PRESENTATION' }), latestVersion: versionView({ contentMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', originalFilename: 'deck.pptx' }), versions: [versionView({ contentMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', originalFilename: 'deck.pptx' })], relations: [], derivation: [] }, headers: { etag: '"pws_file:1"' } }
    } }
    const workspace = usePersonalWorkspace({ api, identityEpoch: ref('owner-a'), urlApi: { createObjectURL: (_, index = calls.length) => `blob:page-${index}`, revokeObjectURL: () => {} } })
    await workspace.select('pws_file')
    await workspace.previewVersion(1)
    assert.equal(workspace.preview.value.kind, 'parts')
    assert.equal(workspace.preview.value.parts.length, 2)
    assert.equal(workspace.selectPreviewPart(1), true)
    assert.equal(workspace.preview.value.selectedIndex, 1)
    assert.deepEqual(calls.filter(url => url.includes('/preview/parts/')), [
      '/personal-workspace/files/pws_file/versions/1/preview/parts/page-1',
      '/personal-workspace/files/pws_file/versions/1/preview/parts/page-2'
    ])
    workspace.dispose()
  })

  it('revokes URLs created before a later preview part fails', async () => {
    const revoked = []
    const api = { execute: async options => {
      if (options.url.endsWith('/preview')) return { data: { state: 'READY', parts: [{ partId: 'page-1', contentMimeType: 'image/png' }, { partId: 'page-2', contentMimeType: 'image/png' }], partial: false } }
      if (options.url.endsWith('/preview/parts/page-1')) return { data: new Blob(['png'], { type: 'image/png' }) }
      if (options.url.endsWith('/preview/parts/page-2')) throw new Error('second part failed')
      return { data: { file: fileView({ mediaFamily: 'PRESENTATION' }), latestVersion: versionView({ contentMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', originalFilename: 'deck.pptx' }), versions: [versionView({ contentMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', originalFilename: 'deck.pptx' })], relations: [], derivation: [] }, headers: { etag: '"pws_file:1"' } }
    } }
    const workspace = usePersonalWorkspace({ api, identityEpoch: ref('owner-a'), urlApi: { createObjectURL: () => 'blob:page-1', revokeObjectURL: url => revoked.push(url) } })
    await workspace.select('pws_file')
    assert.equal(await workspace.previewVersion(1), null)
    assert.deepEqual(revoked, ['blob:page-1'])
    assert.equal(workspace.preview.value.kind, 'error')
    workspace.dispose()
  })
})


describe('1.13.1 workspace Excel preview parts', () => {
  it('reads each declared text/plain sheet without falling back to raw XLSX bytes', async () => {
    const calls = []
    const api = { execute: async options => {
      calls.push(options.url)
      if (options.url.endsWith('/preview')) return { data: { state: 'READY', parts: [{ partId: 'sheet-1', contentMimeType: 'text/plain' }, { partId: 'sheet-2', contentMimeType: 'text/plain' }], partial: false } }
      if (options.url.endsWith('/preview/parts/sheet-1')) return { data: new Blob(['汇总'], { type: 'text/plain' }) }
      if (options.url.endsWith('/preview/parts/sheet-2')) return { data: new Blob(['明细'], { type: 'text/plain' }) }
      return { data: { file: fileView({ mediaFamily: 'SPREADSHEET' }), latestVersion: versionView({ contentMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', originalFilename: 'data.xlsx' }), versions: [versionView({ contentMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', originalFilename: 'data.xlsx' })], relations: [], derivation: [] }, headers: { etag: '"pws_file:1"' } }
    } }
    const workspace = usePersonalWorkspace({ api, identityEpoch: ref('owner-a') })
    await workspace.select('pws_file')
    await workspace.previewVersion(1)
    assert.equal(workspace.preview.value.kind, 'parts')
    assert.equal(workspace.preview.value.parts[0].text, '汇总')
    workspace.selectPreviewPart(1)
    assert.equal(workspace.preview.value.parts[workspace.preview.value.selectedIndex].text, '明细')
    assert.equal(calls.some(url => url.endsWith('/content')), false)
    workspace.dispose()
  })
})
