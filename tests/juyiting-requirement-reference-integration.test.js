import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { before, after, afterEach, describe, it } from 'mocha'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
import { usePersonalWorkspace } from '../src/composables/usePersonalWorkspace.js'
import * as silver from '../src/utils/silverAmount.js'
import { useHallRequirementCreate } from '../src/composables/juyiting/useHallRequirementCreate.js'

const scope = '0\u0000client-a\u0000owner-a'
const mimeTypes = ['image/png', 'application/pdf', 'audio/mpeg', 'text/plain']
const files = mimeTypes.map((mime, index) => ({ fileId: `pwf_material_${index}`, displayName: `资料${index}`, state: 'ACTIVE', latestVersion: 3, metadataRevision: 1 }))
const attachments = files.map(file => ({ fileId: file.fileId, version: 3 }))
const detailFor = index => {
  const file = files[index], contentMimeType = mimeTypes[index]
  const versions = [2, 3].map(version => ({ fileId: file.fileId, version, originalFilename: `material-${index}-v${version}`, contentMimeType, byteLength: 5 }))
  return { file, latestVersion: versions[1], versions, relations: [], derivation: [] }
}
const props = { identityScope: scope, authorizationGeneration: 1, abilityText: () => '', canAssign: () => false,
  formatTime: () => '', portraitName: () => '', portraitStyle: () => ({}), taskAgentMatchScore: () => 0,
  taskStateClass: () => '', taskStatusCount: () => 0, taskStatusText: () => '' }
const wrappers = [], disposers = [], descriptors = {}
const flush = async () => {
  for (let step = 0; step < 20; step += 1) { await Promise.resolve(); await Vue.nextTick() }
}
function compileComponent (relativePath, imports) {
  const filename = fileURLToPath(new URL(relativePath, import.meta.url))
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
function fixture (panelProps = {}) {
  const calls = [], created = [], revoked = [], rows = new Map(), adopted = []
  const api = { execute: async request => {
    calls.push(request)
    assert.equal(request.method, 'GET')
    assert.equal(request.needAuth, true)
    if (request.url === '/personal-workspace/files') return { data: { items: files, nextCursor: null } }
    for (let index = 0; index < files.length; index++) {
      const file = files[index], mime = mimeTypes[index]
      if (request.url === `/personal-workspace/files/${file.fileId}`) return { data: detailFor(index), headers: { etag: '"materials:1"' } }
      if (request.url === `/personal-workspace/files/${file.fileId}/versions/3/preview`) return { data: { state: 'READY', parts: [{ partId: 'content', contentMimeType: mime === 'application/pdf' ? 'text/plain' : mime }], partial: false } }
      if (request.url === `/personal-workspace/files/${file.fileId}/versions/3/preview/parts/content`) return { data: new Blob(['media'], { type: mime === 'application/pdf' ? 'text/plain' : mime }) }
    }
    throw new Error(`unexpected workspace request ${request.url}`)
  } }
  const urlApi = { createObjectURL: blob => { const url = `blob:exact-${blob.type}`; created.push(url); return url }, revokeObjectURL: url => revoked.push(url) }
  const agentApi = { create: async (path, body, options) => {
    calls.push({ method: 'POST', path, body, options })
    assert.equal(path, '/tasks/creation-operations/v2')
    return { data: { schemaVersion: 2, operationId: 'atco2_exact', taskId: 'task-bird', requirementRevision: 1,
      state: 'COMMITTED', attachments: body.attachments, task: { id: 'task-bird' } } }
  } }
  const storage = { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) }
  const create = useHallRequirementCreate({ schemaVersion: 2, agentApi, actorScopeKey: Vue.ref(scope), identityEpoch: Vue.ref(1), storage,
    createIdempotencyKey: () => 'bird-original-key', onCommitted: (value, fence) => { if (!fence.isCurrent()) return false; adopted.push(value); return true } })
  disposers.push(() => create.dispose())
  const Picker = compileComponent('../src/components/juyiting/HallMaterialPicker.vue', {
    vue: Vue, '@/composables/usePersonalWorkspace': { usePersonalWorkspace: options => usePersonalWorkspace({ ...options, api, urlApi }), savePersonalWorkspaceBlob: () => {} }
  })
  const stub = Vue.defineComponent({ render: () => Vue.h('span') })
  const TaskMaterialLinks = Vue.defineComponent({ name: 'TaskMaterialLinks', render: () => Vue.h('section', { class: 'formal-material-controls' }) })
  const Panel = compileComponent('../src/components/juyiting/BountyPanel.vue', new Proxy({
    vue: Vue, '@/utils/silverAmount': silver, './HallMaterialPicker.vue': Picker, '@/components/personal-workspace/TaskMaterialLinks.vue': TaskMaterialLinks
  }, { get: (target, name) => target[name] ?? stub }))
  const wrapper = mount(Panel, { global: { stubs: { teleport: true } }, props: { ...props, ...panelProps, onCreateTask: async (body, acknowledge) => acknowledge(await create.create(body)) } })
  wrappers.push(wrapper)
  return { wrapper, calls, created, revoked, rows, adopted, Picker }
}
async function openDraft (wrapper) {
  await button(wrapper, '提出需求').trigger('click')
  await wrapper.find('[name="taskTitle"]').setValue(' 画一只鸟🦜 ')
  await wrapper.find('[name="taskDescription"]').setValue('照片风格\n完整原文')
}

describe('real Bounty + shared neutral picker + v2 atomic creation integration', () => {
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
  it('fixes the current versions of four media types without a version chooser, then creates atomically', async () => {
    const f = fixture()
    await openDraft(f.wrapper)
    await button(f.wrapper, '添加资料（可选）').trigger('click'); await flush()
    for (let index = 0; index < files.length; index++) {
      await f.wrapper.findAll('.quick-material-files button')[index].trigger('click'); await flush()
      assert.equal(f.wrapper.find('.quick-material-fields select').exists(), false)
      assert.match(f.wrapper.get('.quick-material-version').text(), /已固定 v3/)
      await f.wrapper.findAll('.quick-material-fields button').find(item => item.text() === '预览').trigger('click'); await flush()
      if (index === 0) assert.equal(f.wrapper.get('.quick-material-preview img').attributes('src'), 'blob:exact-image/png')
      if (index === 2) assert.equal(f.wrapper.get('.quick-material-preview audio').attributes('src'), 'blob:exact-audio/mpeg')
      await button(f.wrapper, '添加').trigger('click')
    }
    await f.wrapper.get('.quick-material-confirm').trigger('click'); await flush()
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0)
    assert.equal(f.wrapper.findAll('.quick-material-summary li').length, 4)
    await f.wrapper.find('form').trigger('submit'); await flush()
    const posts = f.calls.filter(call => call.method === 'POST')
    assert.equal(posts.length, 1)
    assert.deepEqual(posts[0].body, { title: ' 画一只鸟🦜 ', description: '照片风格\n完整原文', requiredAbilities: [], reward: null, attachments })
    assert.equal(posts[0].options.headers['Idempotency-Key'], 'bird-original-key')
    assert.equal(f.adopted[0].task.id, 'task-bird')
    assert.equal(f.rows.size, 0)
    assert.equal(f.wrapper.find('form').exists(), false)
    assert.deepEqual(f.revoked, f.created)
  })
  it('keeps standalone formal controls, while embedded matters route only through discussion', async () => {
    const f = fixture({ tasks: [{ id: 'task-route', title: '核对入口', status: 'running', assignedAgentId: 'agent-a' }] })
    await f.wrapper.get('.task-card').trigger('click'); await flush()
    assert.equal(f.wrapper.find('.formal-material-controls').exists(), true)
    assert.equal(f.wrapper.find('.workspace-shortcut').exists(), true)
    await f.wrapper.setProps({ embeddedHall: true }); await flush()
    assert.equal(f.wrapper.find('.formal-material-controls').exists(), false)
    assert.equal(f.wrapper.find('.workspace-shortcut').exists(), false)
    assert.match(f.wrapper.get('.deliberation-execution-route').text(), /保存可选/)
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 0)
  })
  it('submits no-material requirement without reading workspace or creating grants/executions', async () => {
    const f = fixture()
    await openDraft(f.wrapper)
    await f.wrapper.find('form').trigger('submit'); await flush()
    assert.equal(f.calls.length, 1)
    assert.deepEqual(f.calls[0].body.attachments, [])
    assert.equal(f.calls[0].path, '/tasks/creation-operations/v2')
    assert.equal(f.created.length, 0)
    assert.equal(f.adopted.length, 1)
  })
})
