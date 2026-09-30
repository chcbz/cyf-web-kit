import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { before, after, afterEach, describe, it } from 'mocha'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as selectionModule from '../src/composables/juyiting/hallReferenceImageSelection.js'
import * as silver from '../src/utils/silverAmount.js'
import { useHallRequirementCreate } from '../src/composables/juyiting/useHallRequirementCreate.js'

const scope = '0\u0000client-a\u0000owner-a'
const exactReference = { fileId: 'pwf_bird_reference', version: 2, purpose: 'REFERENCE' }
const versions = [2, 3].map(version => ({ fileId: exactReference.fileId, version,
  originalFilename: `bird-v${version}.png`, contentMimeType: 'image/png', byteLength: 5 }))
const file = { fileId: exactReference.fileId, displayName: '鸟参考图', state: 'ACTIVE', mediaFamily: 'IMAGE', latestVersion: 3, metadataRevision: 1 }
const detail = { file, latestVersion: versions[1], versions, relations: [], derivation: [] }
const props = { identityScope: scope, authorizationGeneration: 1, abilityText: () => '', canAssign: () => false,
  formatTime: () => '', portraitName: () => '', portraitStyle: () => ({}), taskAgentMatchScore: () => 0,
  taskStateClass: () => '', taskStatusCount: () => 0, taskStatusText: () => '' }
const wrappers = [], disposers = [], descriptors = {}
const flush = async () => {
  for (let step = 0; step < 20; step += 1) { await Promise.resolve(); await Vue.nextTick() }
}
function compileComponent (relativePath, imports) {
  const filename = new URL(relativePath, import.meta.url).pathname
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const code = compileScript(descriptor, { id: relativePath, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, names, path) =>
      `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)(imports)
}
const button = (wrapper, label) => {
  const found = wrapper.findAll('button').find(item => item.text() === label)
  assert.ok(found, `missing ${label}`)
  return found
}
function fixture () {
  const calls = [], created = [], revoked = [], rows = new Map(), adopted = []
  const api = { execute: async request => {
    calls.push(request)
    assert.equal(request.method, 'GET')
    assert.equal(request.needAuth, true)
    if (request.url === '/personal-workspace/files') return { data: { items: [file], nextCursor: null } }
    if (request.url === `/personal-workspace/files/${file.fileId}`) return { data: detail, headers: { etag: '"reference:1"' } }
    if (request.url === `/personal-workspace/files/${file.fileId}/versions/2/preview`) return { data: { state: 'READY', parts: [{ partId: 'content', contentMimeType: 'image/png' }], partial: false } }
    if (request.url === `/personal-workspace/files/${file.fileId}/versions/2/preview/parts/content`) return { data: new Blob(['image'], { type: 'image/png' }) }
    throw new Error(`unexpected workspace request ${request.url}`)
  } }
  const urlApi = { createObjectURL: blob => { assert.equal(blob.type, 'image/png'); created.push('blob:exact-reference'); return created[0] },
    revokeObjectURL: url => revoked.push(url) }
  const agentApi = { create: async (path, body, options) => {
    calls.push({ method: 'POST', path, body, options })
    assert.equal(path, '/tasks/creation-operations')
    return { data: { schemaVersion: 1, operationId: 'atco_exact', taskId: 'task-bird', requirementRevision: 1,
      state: 'COMMITTED', inputRefs: body.inputRefs, task: { id: 'task-bird' } } }
  } }
  const storage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) }
  const create = useHallRequirementCreate({ agentApi, actorScopeKey: Vue.ref(scope), identityEpoch: Vue.ref(1), storage,
    createIdempotencyKey: () => 'bird-original-key', onCommitted: (value, fence) => { if (!fence.isCurrent()) return false; adopted.push(value); return true } })
  disposers.push(() => create.dispose())
  const Picker = compileComponent('../src/components/juyiting/HallReferenceImagePicker.vue', {
    vue: Vue, '../../composables/juyiting/hallReferenceImageSelection.js': { ...selectionModule,
      useHallReferenceImageSelection: options => selectionModule.useHallReferenceImageSelection({ ...options, api, urlApi }) }
  })
  const stub = Vue.defineComponent({ render: () => Vue.h('span') })
  const Panel = compileComponent('../src/components/juyiting/BountyPanel.vue', new Proxy({
    vue: Vue, '@/utils/silverAmount': silver, './HallReferenceImagePicker.vue': Picker
  }, { get: (target, name) => target[name] ?? stub }))
  const wrapper = mount(Panel, { props: { ...props, onCreateTask: async (body, acknowledge) => acknowledge(await create.create(body)) } })
  wrappers.push(wrapper)
  return { wrapper, calls, created, revoked, rows, adopted }
}
async function openDraft (wrapper) {
  await button(wrapper, '张榜').trigger('click')
  await wrapper.find('[name="taskTitle"]').setValue(' 画一只鸟🦜 ')
  await wrapper.find('[name="taskDescription"]').setValue('照片风格\n完整原文')
}

describe('real Bounty + real reference picker + exact create integration', () => {
  before(() => {
    for (const key of ['SVGElement', 'Element', 'Node']) {
      descriptors[key] = Object.getOwnPropertyDescriptor(globalThis, key)
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] })
    }
  })
  afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); for (const dispose of disposers.splice(0)) dispose() })
  after(() => {
    for (const key of Object.keys(descriptors)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key])
      else delete globalThis[key]
    }
  })
  it('reads an authorized old version then submits exactly one atomic creation from the real form', async () => {
    const f = fixture()
    await openDraft(f.wrapper)
    await button(f.wrapper, '从个人工作空间选择').trigger('click'); await flush()
    await f.wrapper.find('.reference-workspace-list button').trigger('click'); await flush()
    const oldVersion = f.wrapper.findAll('.reference-version-list button').find(item => item.text().startsWith('v2'))
    assert.ok(oldVersion)
    await oldVersion.trigger('click'); await flush()
    assert.equal(f.wrapper.find('.reference-card img').attributes('src'), 'blob:exact-reference')
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0)
    await f.wrapper.find('form').trigger('submit'); await flush()
    const posts = f.calls.filter(call => call.method === 'POST')
    assert.equal(posts.length, 1)
    assert.deepEqual(posts[0].body, { title: ' 画一只鸟🦜 ', description: '照片风格\n完整原文', requiredAbilities: [], reward: null, inputRefs: [exactReference] })
    assert.equal(posts[0].options.headers['Idempotency-Key'], 'bird-original-key')
    assert.equal(f.adopted[0].task.id, 'task-bird')
    assert.equal(f.rows.size, 0)
    assert.equal(f.wrapper.find('form').exists(), false)
    assert.deepEqual(f.revoked, ['blob:exact-reference'])
  })
  it('submits no-reference requirement without reading workspace or creating grants/executions', async () => {
    const f = fixture()
    await openDraft(f.wrapper)
    await f.wrapper.find('form').trigger('submit'); await flush()
    assert.equal(f.calls.length, 1)
    assert.deepEqual(f.calls[0].body.inputRefs, [])
    assert.equal(f.calls[0].path, '/tasks/creation-operations')
    assert.equal(f.created.length, 0)
    assert.equal(f.adopted.length, 1)
  })
})
