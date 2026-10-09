import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { ref } from 'vue'
import { usePersonalWorkspace, PERSONAL_WORKSPACE_MIME_TYPES } from '../src/composables/usePersonalWorkspace.js'

const formats = [
  ['sound.mp3', 'audio/mpeg'], ['sound.ogg', 'audio/ogg'], ['sound.oga', 'audio/ogg'],
  ['sound.wav', 'audio/wav'], ['sound.m4a', 'audio/mp4'], ['sound.mp4', 'audio/mp4'],
  ['sound.webm', 'audio/webm'], ['bird.webp', 'image/webp'], ['bird.gif', 'image/gif']
]
const detail = (filename, mime, fileId = 'file-a') => {
  const version = { fileId, version: 1, originalFilename: filename, contentMimeType: mime, byteLength: 5 }
  return { file: { fileId, displayName: filename, state: 'ACTIVE', metadataRevision: 1, latestVersion: 1 }, latestVersion: version, versions: [version] }
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

describe('workspace general multimedia compatibility (no Provider)', () => {
  for (const [filename, mime] of formats) {
    it(`uploads, reads and previews the server-supported ${filename} without image coercion`, async () => {
      const calls = []; const revoked = []; const created = []
      const value = detail(filename, mime)
      const workspace = usePersonalWorkspace({ identityEpoch: ref('owner-a'), urlApi: {
        createObjectURL: blob => { created.push(blob); return 'blob:owned-preview' }, revokeObjectURL: url => revoked.push(url)
      }, api: { execute: async options => {
        calls.push(options)
        if (options.method === 'POST') return { operation: { operationId: 'op-a' }, file: value.file, version: value.latestVersion }
        if (options.url.endsWith('/preview')) return { state: 'READY', parts: [{ partId: 'content', contentMimeType: mime }], partial: false }
        if (options.url.includes('/preview/parts/')) return new Blob(['bytes'], { type: mime })
        return value
      } } })
      try {
        assert.ok(PERSONAL_WORKSPACE_MIME_TYPES.includes(mime))
        const candidate = new Blob(['bytes'], { type: mime }); Object.defineProperty(candidate, 'name', { value: filename })
        assert.ok(await workspace.upload(candidate))
        assert.equal(calls[0].data.get('file').type, mime)
        const preview = await workspace.previewVersion(1)
        assert.equal(preview.kind, mime.startsWith('audio/') ? 'audio' : 'image')
        assert.equal(preview.url, 'blob:owned-preview')
        assert.equal(created[0].type, mime)
        workspace.revokePreview()
        assert.deepEqual(revoked, ['blob:owned-preview'])
      } finally { workspace.dispose() }
    })
  }

  it('forwards the AUDIO directory filter and rejects active content and wrong declared preview MIME', async () => {
    const calls = []; const created = []
    const workspace = usePersonalWorkspace({ urlApi: { createObjectURL: value => { created.push(value); return 'blob:unsafe' } }, api: { execute: async options => {
      calls.push(options)
      if (options.url === '/personal-workspace/files') return { items: [], nextCursor: null }
      if (options.url.endsWith('/preview')) return { state: 'READY', parts: [{ partId: 'content', contentMimeType: 'audio/mpeg' }], partial: false }
      if (options.url.includes('/parts/')) return new Blob(['<script>bad()</script>'], { type: 'text/html' })
      return detail('sound.mp3', 'audio/mpeg')
    } } })
    try {
      assert.equal(await workspace.refresh({ mediaFamily: 'AUDIO' }), true)
      assert.equal(calls[0].params.mediaFamily, 'AUDIO')
      await workspace.select('file-a')
      assert.equal(await workspace.previewVersion(1), null)
      assert.match(workspace.error.value, /类型无效/)
      assert.deepEqual(created, [])
      for (const [filename, type] of [['evil.svg', 'image/svg+xml'], ['evil.html', 'text/html'], ['evil.js', 'text/javascript'], ['video.mp4', 'video/mp4'], ['video.webm', 'video/webm'], ['renamed.mp3', 'text/html']]) {
        const file = new Blob(['bad'], { type }); Object.defineProperty(file, 'name', { value: filename })
        assert.equal(await workspace.upload(file), null)
      }
      assert.equal(calls.some(call => call.method === 'POST'), false)
    } finally { workspace.dispose() }
  })

  it('late old-file preview cannot overwrite or revoke a new audio preview', async () => {
    const old = deferred(); const revoked = []
    const workspace = usePersonalWorkspace({ urlApi: { createObjectURL: () => 'blob:current-audio', revokeObjectURL: url => revoked.push(url) }, api: { execute: async options => {
      if (options.url.endsWith('/preview')) {
        if (options.url.includes('file-a/')) return old.promise
        return { state: 'READY', parts: [{ partId: 'content', contentMimeType: 'audio/wav' }], partial: false }
      }
      if (options.url.includes('/parts/')) return new Blob(['bytes'], { type: 'audio/wav' })
      return detail('sound.wav', 'audio/wav', options.url.endsWith('file-b') ? 'file-b' : 'file-a')
    } } })
    try {
      await workspace.select('file-a'); const pending = workspace.previewVersion(1)
      await workspace.select('file-b'); await workspace.previewVersion(1)
      old.resolve({ state: 'UNSUPPORTED', reason: 'stale file' })
      assert.equal(await pending, null)
      assert.equal(workspace.preview.value.kind, 'audio')
      assert.equal(workspace.preview.value.url, 'blob:current-audio')
      assert.deepEqual(revoked, [])
    } finally { workspace.dispose() }
    assert.deepEqual(revoked, ['blob:current-audio'])
  })

  it('late preceding-file detail cannot retarget the current media selection', async () => {
    const old = deferred()
    const workspace = usePersonalWorkspace({ api: { execute: options => options.url.endsWith('file-a') ? old.promise : Promise.resolve(detail('current.wav', 'audio/wav', 'file-b')) } })
    try {
      const preceding = workspace.select('file-a')
      await workspace.select('file-b')
      old.resolve(detail('stale.wav', 'audio/wav', 'file-a'))
      assert.equal(await preceding, null)
      assert.equal(workspace.detail.value.file.fileId, 'file-b')
    } finally { workspace.dispose() }
  })

  it('identity switch discards in-flight audio bytes without creating an object URL', async () => {
    const epoch = ref('owner-a'); const pendingBytes = deferred(); const created = []
    const workspace = usePersonalWorkspace({ identityEpoch: epoch, urlApi: { createObjectURL: blob => { created.push(blob); return 'blob:stale' } }, api: { execute: async options => {
      if (options.url.endsWith('/preview')) return { state: 'READY', parts: [{ partId: 'content', contentMimeType: 'audio/mpeg' }], partial: false }
      if (options.url.includes('/parts/')) return pendingBytes.promise
      return detail('sound.mp3', 'audio/mpeg')
    } } })
    try {
      await workspace.select('file-a'); const preview = workspace.previewVersion(1)
      await new Promise(resolve => setTimeout(resolve, 0))
      epoch.value = 'owner-b'; pendingBytes.resolve(new Blob(['old owner bytes'], { type: 'audio/mpeg' }))
      assert.equal(await preview, null)
      assert.deepEqual(created, []); assert.equal(workspace.preview.value.kind, 'none')
    } finally { workspace.dispose() }
  })
})
