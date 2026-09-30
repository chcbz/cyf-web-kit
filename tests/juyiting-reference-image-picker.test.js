import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import {
  HALL_REFERENCE_MAX_ITEMS,
  JAVA_INT_MAX,
  normalizeHallReferenceVersion,
  toHallDraftReference,
  useHallReferenceImageSelection
} from '../src/composables/juyiting/hallReferenceImageSelection.js'

const fileView = (fileId, overrides = {}) => ({
  fileId,
  displayName: `${fileId}.png`,
  mediaFamily: 'IMAGE',
  state: 'ACTIVE',
  metadataRevision: 1,
  latestVersion: 1,
  ...overrides
})
const versionView = (fileId, version, contentMimeType = 'image/png', overrides = {}) => ({
  fileId,
  version,
  originalFilename: `${fileId}-v${version}.${contentMimeType === 'image/jpeg' ? 'jpg' : 'png'}`,
  contentMimeType,
  byteLength: 8,
  ...overrides
})
const detailView = (fileId, versions = [versionView(fileId, 1)], overrides = {}) => {
  const latestVersion = Math.max(...versions.map(item => Number(item.version)))
  return {
    file: fileView(fileId, { latestVersion, ...(overrides.file || {}) }),
    latestVersion: versions.find(item => Number(item.version) === Number(overrides.latestVersion ?? latestVersion)) || versions[0],
    versions,
    relations: [],
    derivation: [],
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !['file', 'latestVersion'].includes(key)))
  }
}
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = async () => {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
}

function createFixture ({ details = new Map(), detailHandler, partHandler, listItems } = {}) {
  const calls = []
  const created = []
  const revoked = []
  let urlSequence = 0
  const api = {
    execute: async options => {
      calls.push(options)
      assert.equal(options.needAuth, true)
      assert.equal(options.method, 'GET')
      assert.match(options.url, /^\/personal-workspace\/files(?:\/|$)/)
      if (options.url === '/personal-workspace/files') {
        return { data: { items: listItems || [...details.keys()].map(fileId => details.get(fileId).file), nextCursor: null } }
      }
      const detailMatch = /^\/personal-workspace\/files\/([^/]+)$/.exec(options.url)
      if (detailMatch) {
        const fileId = decodeURIComponent(detailMatch[1])
        if (detailHandler) return detailHandler(fileId, options)
        return { data: details.get(fileId), headers: { etag: `"${fileId}:1"` } }
      }
      const partMatch = /^\/personal-workspace\/files\/([^/]+)\/versions\/(\d+)\/preview\/parts\/content$/.exec(options.url)
      if (partMatch) {
        if (partHandler) return partHandler(decodeURIComponent(partMatch[1]), Number(partMatch[2]), options)
        return { data: new Blob(['image'], { type: details.get(decodeURIComponent(partMatch[1])).versions.find(item => Number(item.version) === Number(partMatch[2])).contentMimeType }) }
      }
      const previewMatch = /^\/personal-workspace\/files\/([^/]+)\/versions\/(\d+)\/preview$/.exec(options.url)
      if (previewMatch) {
        const fileId = decodeURIComponent(previewMatch[1])
        const version = Number(previewMatch[2])
        const mime = details.get(fileId).versions.find(item => Number(item.version) === version).contentMimeType
        return { data: { state: 'READY', parts: [{ partId: 'content', contentMimeType: mime }], partial: false } }
      }
      throw new Error(`Unexpected request: ${options.url}`)
    }
  }
  const urlApi = {
    createObjectURL: blob => {
      const url = `blob:hall-reference-${++urlSequence}`
      created.push({ url, type: blob.type })
      return url
    },
    revokeObjectURL: url => revoked.push(url)
  }
  return { api, urlApi, calls, created, revoked, details }
}

async function addExact (selection, fileId, version) {
  assert.ok(await selection.openFile(fileId))
  return selection.addReference(fileId, version)
}

describe('hall requirement-draft reference image selection', () => {
  it('keeps empty selection valid and accepts only positive Java-int REFERENCE shapes', () => {
    const fixture = createFixture()
    const selection = useHallReferenceImageSelection({ api: fixture.api, identityEpoch: ref('owner-a'), urlApi: fixture.urlApi })

    assert.deepEqual(selection.draftReferences.value, [])
    assert.deepEqual(toHallDraftReference({ fileId: 'file-1', version: 1, purpose: 'REFERENCE' }), { fileId: 'file-1', version: 1, purpose: 'REFERENCE' })
    assert.equal(toHallDraftReference({ fileId: 'file-1', version: 1, purpose: 'INPUT' }), null)
    assert.equal(normalizeHallReferenceVersion(0), null)
    assert.equal(normalizeHallReferenceVersion(JAVA_INT_MAX + 1), null)
    assert.equal(normalizeHallReferenceVersion(1.5), null)
    assert.equal(normalizeHallReferenceVersion('1'), null)
    assert.equal(fixture.calls.length, 0)
    selection.dispose()
  })

  it('selects authorized JPEG/PNG exact versions and retains an old version when latest changes', async () => {
    const details = new Map([
      ['jpeg-file', detailView('jpeg-file', [versionView('jpeg-file', 3, 'image/png'), versionView('jpeg-file', 2, 'image/jpeg')], { file: { displayName: '参考照片.jpg' } })],
      ['png-file', detailView('png-file', [versionView('png-file', 1, 'image/png')], { file: { displayName: '构图.png' } })]
    ])
    const fixture = createFixture({ details })
    const selection = useHallReferenceImageSelection({ api: fixture.api, identityEpoch: ref('owner-a'), urlApi: fixture.urlApi })

    assert.deepEqual(await addExact(selection, 'jpeg-file', 2), { fileId: 'jpeg-file', version: 2, purpose: 'REFERENCE' })
    details.set('jpeg-file', detailView('jpeg-file', [versionView('jpeg-file', 4, 'image/png'), versionView('jpeg-file', 3, 'image/png'), versionView('jpeg-file', 2, 'image/jpeg')], { file: { displayName: '参考照片.jpg' } }))
    await selection.openFile('jpeg-file')
    assert.deepEqual(selection.draftReferences.value, [{ fileId: 'jpeg-file', version: 2, purpose: 'REFERENCE' }])

    assert.deepEqual(await addExact(selection, 'png-file', 1), { fileId: 'png-file', version: 1, purpose: 'REFERENCE' })
    assert.deepEqual(selection.draftReferences.value, [
      { fileId: 'jpeg-file', version: 2, purpose: 'REFERENCE' },
      { fileId: 'png-file', version: 1, purpose: 'REFERENCE' }
    ])
    assert.ok(fixture.calls.some(call => call.url === '/personal-workspace/files/jpeg-file/versions/2/preview'))
    assert.ok(fixture.calls.some(call => call.url === '/personal-workspace/files/png-file/versions/1/preview/parts/content'))
    assert.deepEqual(fixture.created.map(item => item.type), ['image/jpeg', 'image/png'])
    assert.ok(fixture.calls.every(call => call.method === 'GET'))
    selection.dispose()
  })

  it('rejects wrong-file details, identity-stale details, trashed files, unsupported MIME and ambiguous versions', async () => {
    const wrong = createFixture({ details: new Map([['file-a', detailView('file-b')]]) })
    const wrongSelection = useHallReferenceImageSelection({ api: wrong.api, identityEpoch: ref('owner-a'), urlApi: wrong.urlApi })
    assert.equal(await wrongSelection.openFile('file-a'), null)
    assert.match(wrongSelection.error.value, /当前可读|归属/)
    wrongSelection.dispose()

    const pendingDetail = deferred()
    const epoch = ref('owner-a')
    const staleFixture = createFixture({
      details: new Map([['file-a', detailView('file-a')]]),
      detailHandler: () => pendingDetail.promise
    })
    const staleSelection = useHallReferenceImageSelection({ api: staleFixture.api, identityEpoch: epoch, urlApi: staleFixture.urlApi })
    const pendingOpen = staleSelection.openFile('file-a')
    epoch.value = 'owner-b'
    pendingDetail.resolve({ data: detailView('file-a'), headers: { etag: '"file-a:1"' } })
    assert.equal(await pendingOpen, null)
    assert.equal(staleSelection.currentDetail.value, null)
    assert.deepEqual(staleSelection.draftReferences.value, [])
    staleSelection.dispose()

    const badDetails = new Map([
      ['trashed', detailView('trashed', [versionView('trashed', 1)], { file: { state: 'TRASHED' } })],
      ['text-version', detailView('text-version', [versionView('text-version', 1, 'text/plain')])],
      ['ambiguous', detailView('ambiguous', [versionView('ambiguous', 1), versionView('ambiguous', 1)])]
    ])
    const bad = createFixture({ details: badDetails })
    const selection = useHallReferenceImageSelection({ api: bad.api, identityEpoch: ref('owner-a'), urlApi: bad.urlApi })
    assert.equal(await selection.openFile('trashed'), null)
    assert.ok(await selection.openFile('text-version'))
    assert.equal(await selection.addReference('text-version', 1), null)
    assert.match(selection.error.value, /JPEG|PNG/)
    assert.equal(await selection.openFile('ambiguous'), null)
    assert.match(selection.error.value, /歧义/)
    assert.equal(bad.created.length, 0)
    selection.dispose()
  })

  it('fences a late preview on identity change and revokes the URL created by the stale workspace session', async () => {
    const epoch = ref('owner-a')
    const details = new Map([['file-a', detailView('file-a')]])
    const fixture = createFixture({ details })
    fixture.urlApi.createObjectURL = blob => {
      const url = 'blob:stale-preview'
      fixture.created.push({ url, type: blob.type })
      queueMicrotask(() => { epoch.value = 'owner-b' })
      return url
    }
    const selection = useHallReferenceImageSelection({ api: fixture.api, identityEpoch: epoch, urlApi: fixture.urlApi })
    assert.ok(await selection.openFile('file-a'))
    assert.equal(await selection.addReference('file-a', 1), null)
    await flush()

    assert.deepEqual(selection.draftReferences.value, [])
    assert.deepEqual(fixture.revoked, ['blob:stale-preview'])
    assert.equal(selection.currentDetail.value, null)
    selection.dispose()
  })

  it('enforces 32 unique exact references and rejects a duplicate without another preview', async () => {
    const details = new Map(Array.from({ length: HALL_REFERENCE_MAX_ITEMS + 1 }, (_, index) => {
      const fileId = `file-${index + 1}`
      return [fileId, detailView(fileId)]
    }))
    const fixture = createFixture({ details })
    const selection = useHallReferenceImageSelection({ api: fixture.api, identityEpoch: ref('owner-a'), urlApi: fixture.urlApi })
    for (let index = 1; index <= HALL_REFERENCE_MAX_ITEMS; index += 1) {
      assert.ok(await addExact(selection, `file-${index}`, 1))
    }
    assert.equal(selection.draftReferences.value.length, HALL_REFERENCE_MAX_ITEMS)

    await selection.openFile('file-1')
    const callsBeforeDuplicate = fixture.calls.length
    assert.equal(await selection.addReference('file-1', 1), null)
    assert.equal(fixture.calls.length, callsBeforeDuplicate)
    assert.match(selection.error.value, /重复|已选择/)

    await selection.openFile(`file-${HALL_REFERENCE_MAX_ITEMS + 1}`)
    assert.equal(await selection.addReference(`file-${HALL_REFERENCE_MAX_ITEMS + 1}`, 1), null)
    assert.match(selection.error.value, /32/)
    selection.dispose()
  })

  it('fences an old replacement when a new identity replacement wins without reading later old files', async () => {
    const pendingOldDetail = deferred()
    const epoch = ref('owner-a')
    const details = new Map([
      ['old-1', detailView('old-1')],
      ['old-2', detailView('old-2')],
      ['new-file', detailView('new-file')]
    ])
    const fixture = createFixture({
      details,
      detailHandler: fileId => fileId === 'old-1'
        ? pendingOldDetail.promise
        : { data: details.get(fileId), headers: { etag: `"${fileId}:1"` } }
    })
    const selection = useHallReferenceImageSelection({ api: fixture.api, identityEpoch: epoch, urlApi: fixture.urlApi })
    const oldReplacement = selection.replaceReferences([
      { fileId: 'old-1', version: 1, purpose: 'REFERENCE' },
      { fileId: 'old-2', version: 1, purpose: 'REFERENCE' }
    ])
    await Promise.resolve()
    assert.ok(fixture.calls.some(call => call.url === '/personal-workspace/files/old-1'))

    epoch.value = 'owner-b'
    const newReference = { fileId: 'new-file', version: 1, purpose: 'REFERENCE' }
    assert.deepEqual(await selection.replaceReferences([newReference]), [newReference])
    const newPreviewUrl = selection.selected.value[0].previewUrl
    assert.ok(newPreviewUrl)

    pendingOldDetail.resolve({ data: details.get('old-1'), headers: { etag: '"old-1:1"' } })
    assert.equal(await oldReplacement, null)
    await flush()

    assert.deepEqual(selection.draftReferences.value, [newReference])
    assert.equal(selection.selected.value[0].previewUrl, newPreviewUrl)
    assert.ok(!fixture.revoked.includes(newPreviewUrl))
    assert.ok(!fixture.calls.some(call => call.url === '/personal-workspace/files/old-2'))
    selection.dispose()
  })

  it('revokes owned Blob URLs on remove, close, model replacement and component unmount', async () => {
    const details = new Map([
      ['file-a', detailView('file-a')],
      ['file-b', detailView('file-b')]
    ])
    const fixture = createFixture({ details })
    const epoch = ref('owner-a')
    const selection = useHallReferenceImageSelection({ api: fixture.api, identityEpoch: epoch, urlApi: fixture.urlApi })

    await addExact(selection, 'file-a', 1)
    const removedUrl = selection.selected.value[0].previewUrl
    assert.equal(selection.removeReference('file-a', 1), true)
    assert.ok(fixture.revoked.includes(removedUrl))

    await addExact(selection, 'file-a', 1)
    const closedUrl = selection.selected.value[0].previewUrl
    selection.close()
    assert.ok(fixture.revoked.includes(closedUrl))

    await selection.replaceReferences([{ fileId: 'file-b', version: 1, purpose: 'REFERENCE' }])
    const replacedUrl = selection.selected.value[0].previewUrl
    await selection.replaceReferences([])
    assert.ok(fixture.revoked.includes(replacedUrl))
    selection.dispose()

    let exposed
    const Harness = defineComponent({
      setup (_, { expose }) {
        exposed = useHallReferenceImageSelection({ api: fixture.api, identityEpoch: epoch, urlApi: fixture.urlApi })
        expose({ selection: exposed })
        return () => h('div')
      }
    })
    const priorSvgElement = globalThis.SVGElement
    const priorElement = globalThis.Element
    globalThis.SVGElement = window.SVGElement
    globalThis.Element = window.Element
    try {
      const wrapper = mount(Harness)
      await addExact(exposed, 'file-a', 1)
      const unmountedUrl = exposed.selected.value[0].previewUrl
      wrapper.unmount()
      assert.ok(fixture.revoked.includes(unmountedUrl))
      assert.deepEqual(exposed.draftReferences.value, [])
    } finally {
      if (priorSvgElement === undefined) delete globalThis.SVGElement
      else globalThis.SVGElement = priorSvgElement
      if (priorElement === undefined) delete globalThis.Element
      else globalThis.Element = priorElement
    }
  })

  it('mounts the actual picker and fences stale model completion across an identity/model replacement', async () => {
    const Vue = await import('vue')
    const staleModels = new Map([
      ['old-file', deferred()],
      ['restore-file', deferred()]
    ])
    const replacements = []
    const reference = fileId => ({ fileId, version: 1, purpose: 'REFERENCE' })
    const selectionModule = {
      HALL_REFERENCE_MAX_ITEMS,
      useHallReferenceImageSelection: ({ identityEpoch }) => {
        const items = Vue.ref([])
        const listState = Vue.ref('idle')
        const currentDetail = Vue.ref(null)
        const selected = Vue.ref([])
        const draftReferences = Vue.ref([])
        const state = Vue.ref('ready')
        const error = Vue.ref('')
        Vue.watch(identityEpoch, () => {
          currentDetail.value = null
          selected.value = []
          draftReferences.value = []
        }, { flush: 'sync' })
        return {
          items,
          listState,
          currentDetail,
          selected,
          draftReferences,
          state,
          error,
          refresh: async () => true,
          openFile: async () => null,
          addReference: async () => null,
          replaceReferences: async references => {
            const copy = references.map(item => ({ ...item }))
            replacements.push(copy)
            const pending = staleModels.get(copy[0]?.fileId)
            if (pending) return pending.promise
            selected.value = copy.map(item => ({
              ...item,
              displayName: item.fileId,
              contentMimeType: 'image/png',
              previewUrl: `blob:${item.fileId}`
            }))
            draftReferences.value = copy
            return copy
          },
          removeReference: () => false,
          close: () => {}
        }
      }
    }
    const filename = new URL('../src/components/juyiting/HallReferenceImagePicker.vue', import.meta.url).pathname
    const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
    assert.deepEqual(errors, [])
    const imports = new Proxy({
      vue: Vue,
      '../../composables/juyiting/hallReferenceImageSelection.js': selectionModule
    }, { get: (target, name) => target[name] })
    const code = compileScript(descriptor, { id: 'mounted-hall-reference-picker', inlineTemplate: true }).content
      .replace(/^import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, names, path) =>
        `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
      .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
      .replace('export default', 'return')
    const Picker = new Function('imports', code)(imports)
    const domDescriptors = {}
    for (const key of ['SVGElement', 'Element', 'Node']) {
      domDescriptors[key] = Object.getOwnPropertyDescriptor(globalThis, key)
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] })
    }
    let wrapper
    try {
      wrapper = mount(Picker, {
        props: { modelValue: [reference('old-file')], identityScope: 'owner-a', identityEpoch: 1 }
      })
      await flush()
      assert.deepEqual(replacements, [[reference('old-file')]])

      await wrapper.setProps({
        modelValue: [reference('new-file')],
        identityScope: 'owner-b',
        identityEpoch: 2
      })
      await flush()
      assert.deepEqual(replacements, [[reference('old-file')], [reference('new-file')]])
      const beforeStaleCompletion = [...(wrapper.emitted('update:modelValue') || [])]
      assert.deepEqual(beforeStaleCompletion.at(-1), [[reference('new-file')]])

      staleModels.get('old-file').resolve(null)
      await flush()
      assert.deepEqual(wrapper.emitted('update:modelValue') || [], beforeStaleCompletion)
      assert.deepEqual((wrapper.emitted('update:modelValue') || []).at(-1), [[reference('new-file')]])

      wrapper.unmount()
      wrapper = mount(Picker, {
        props: { modelValue: [reference('restore-file')], identityScope: 'owner-b', identityEpoch: 2 }
      })
      await flush()
      const replacementOffset = replacements.length
      assert.deepEqual(replacements.at(-1), [reference('restore-file')])

      await wrapper.setProps({ modelValue: [] })
      await flush()
      assert.deepEqual(replacements.slice(replacementOffset), [[]])
      const beforeOldRestore = [...(wrapper.emitted('update:modelValue') || [])]
      assert.deepEqual(beforeOldRestore.at(-1), [[]])

      staleModels.get('restore-file').resolve([reference('restore-file')])
      await flush()
      assert.deepEqual(wrapper.emitted('update:modelValue') || [], beforeOldRestore)
      assert.deepEqual((wrapper.emitted('update:modelValue') || []).at(-1), [[]])
    } finally {
      wrapper?.unmount()
      for (const [key, property] of Object.entries(domDescriptors)) {
        if (property) Object.defineProperty(globalThis, key, property)
        else delete globalThis[key]
      }
    }
  })

  it('compiles the frozen parent API and template without adding raw media or write endpoints', () => {
    const filename = new URL('../src/components/juyiting/HallReferenceImagePicker.vue', import.meta.url).pathname
    const source = readFileSync(filename, 'utf8')
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: 'hall-reference-image-picker' })
    const template = compileTemplate({
      source: descriptor.template.content,
      filename,
      id: 'hall-reference-image-picker',
      compilerOptions: { bindingMetadata: script.bindings }
    })
    assert.deepEqual(template.errors, [])
    assert.match(source, /modelValue: \{ type: Array, default: \(\) => \[\] \}/)
    assert.match(source, /identityScope: \{ type: String/)
    assert.match(source, /identityEpoch: \{ type: Number/)
    assert.match(source, /disabled: \{ type: Boolean/)
    assert.match(source, /'update:modelValue'/)
    assert.doesNotMatch(source, /\/tasks\//)
    assert.doesNotMatch(source, /file:\/\/|https?:\/\//)
  })
})
