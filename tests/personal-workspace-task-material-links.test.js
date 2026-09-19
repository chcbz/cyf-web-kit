import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it, before, after, afterEach } from 'mocha'
import { compileScript, parse } from '@vue/compiler-sfc'

let Vue
let mount
let TaskMaterialLinks
const wrappers = []
const domDescriptors = {}

const taskLink = (overrides = {}) => ({
  relationId: 'rel_input', taskId: 'task_a', fileId: 'file_a', version: 2,
  role: 'INPUT', state: 'ACTIVE', relationRevision: 1, createdAt: 1, ...overrides
})
const workspaceDetail = () => ({
  file: { fileId: 'file_a', displayName: '项目资料', state: 'ACTIVE', latestVersion: 2 },
  latestVersion: { version: 2 },
  versions: [{ version: 1, originalFilename: 'brief-v1.docx' }, { version: 2, originalFilename: 'brief-v2.docx' }]
})

const installDom = () => {
  for (const key of ['SVGElement', 'Element', 'Node']) {
    domDescriptors[key] = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: globalThis.window?.[key] })
  }
}
const restoreDom = () => {
  for (const key of ['SVGElement', 'Element', 'Node']) {
    if (domDescriptors[key]) Object.defineProperty(globalThis, key, domDescriptors[key])
    else delete globalThis[key]
  }
}

const compile = () => {
  const filename = new URL('../src/components/personal-workspace/TaskMaterialLinks.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const code = compileScript(descriptor, { id: 'w06-task-material-links', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_match, names, path) =>
      `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_match, name, path) =>
      `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return imports => new Function('imports', code)(imports)
}

describe('W06 workspace bounty material links', () => {
  before(async () => {
    installDom()
    Vue = await import('vue')
    ;({ mount } = await import('@vue/test-utils'))
    TaskMaterialLinks = compile()
  })
  afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })
  after(restoreDom)

  it('picks an exact active workspace version and submits only INPUT or REFERENCE through the task link adapter', async () => {
    const detail = Vue.ref(null)
    const attached = []
    const workspace = {
      items: Vue.ref([{ fileId: 'file_a', displayName: '项目资料', latestVersion: 2 }]), nextCursor: Vue.ref(null), listState: Vue.ref('ready'), loading: Vue.ref(false), error: Vue.ref(''), detail,
      refresh: async () => true, loadMore: async () => false,
      select: async () => { detail.value = workspaceDetail(); return detail.value }, dispose: () => {}
    }
    const links = {
      links: Vue.ref([]), nextCursor: Vue.ref(null), listState: Vue.ref('empty'), loading: Vue.ref(false), actionState: Vue.ref('idle'), error: Vue.ref(''),
      load: async () => true, loadMore: async () => false,
      attach: async payload => { attached.push(payload); return taskLink(payload) }, detach: async () => null, dispose: () => {}
    }
    const component = TaskMaterialLinks({
      vue: Vue,
      '@/composables/usePersonalWorkspace': { usePersonalWorkspace: () => workspace },
      '@/composables/usePersonalWorkspaceTaskLinks': { usePersonalWorkspaceTaskLinks: () => links }
    })
    const wrapper = mount(component, { props: { taskId: 'task_a', identityEpoch: 1 } })
    wrappers.push(wrapper)

    await wrapper.get('.workspace-file-list button').trigger('click')
    await wrapper.get('select').setValue('1')
    await wrapper.get('.attach-material').trigger('click')

    assert.deepEqual(attached, [{ fileId: 'file_a', version: 1, role: 'INPUT' }])
    assert.match(wrapper.text(), /不会启动 Agent 执行/)
    assert.match(wrapper.text(), /不提供 execution 或 deliverable 查询/)
  })

  it('renders a server-returned OUTPUT link as an execution-managed reference without inventing formal delivery', () => {
    const workspace = { items: Vue.ref([]), nextCursor: Vue.ref(null), listState: Vue.ref('empty'), loading: Vue.ref(false), error: Vue.ref(''), detail: Vue.ref(null), refresh: async () => true, loadMore: async () => false, select: async () => null, dispose: () => {} }
    const links = { links: Vue.ref([taskLink({ relationId: 'rel_output', role: 'OUTPUT' })]), nextCursor: Vue.ref(null), listState: Vue.ref('ready'), loading: Vue.ref(false), actionState: Vue.ref('idle'), error: Vue.ref(''), load: async () => true, loadMore: async () => false, attach: async () => null, detach: async () => null, dispose: () => {} }
    const component = TaskMaterialLinks({ vue: Vue, '@/composables/usePersonalWorkspace': { usePersonalWorkspace: () => workspace }, '@/composables/usePersonalWorkspaceTaskLinks': { usePersonalWorkspaceTaskLinks: () => links } })
    const wrapper = mount(component, { props: { taskId: 'task_a', identityEpoch: 1 } })
    wrappers.push(wrapper)

    assert.match(wrapper.text(), /成果关联由执行流程管理/)
    assert.match(wrapper.text(), /正式交付状态仍需以正式交付回执确认/)
    assert.equal(wrapper.find('.task-link-row.output button').exists(), false)
  })

  it('clears the local exact-version draft when the authenticated identity changes', async () => {
    const detail = Vue.ref(null)
    const workspace = { items: Vue.ref([{ fileId: 'file_a', displayName: '项目资料', latestVersion: 2 }]), nextCursor: Vue.ref(null), listState: Vue.ref('ready'), loading: Vue.ref(false), error: Vue.ref(''), detail, refresh: async () => true, loadMore: async () => false, select: async () => { detail.value = workspaceDetail(); return detail.value }, dispose: () => {} }
    const links = { links: Vue.ref([]), nextCursor: Vue.ref(null), listState: Vue.ref('empty'), loading: Vue.ref(false), actionState: Vue.ref('idle'), error: Vue.ref(''), load: async () => true, loadMore: async () => false, attach: async () => null, detach: async () => null, dispose: () => {} }
    const component = TaskMaterialLinks({ vue: Vue, '@/composables/usePersonalWorkspace': { usePersonalWorkspace: () => workspace }, '@/composables/usePersonalWorkspaceTaskLinks': { usePersonalWorkspaceTaskLinks: () => links } })
    const wrapper = mount(component, { props: { taskId: 'task_a', identityEpoch: 1 } })
    wrappers.push(wrapper)
    await wrapper.get('.workspace-file-list button').trigger('click')
    assert.equal(wrapper.find('.attach-material').exists(), true)

    await wrapper.setProps({ identityEpoch: 2 })
    assert.equal(wrapper.find('.attach-material').exists(), false)
  })

  it('wires the actual bounty detail to the shared material surface and preserves the existing task discussion event', () => {
    const bounty = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    assert.match(bounty, /TaskMaterialLinks/)
    assert.match(bounty, /:task-id="String\(detailTask\.id\)"/)
    assert.match(bounty, /@click="\$emit\('discuss-task', detailTask\)"/)
    assert.match(bounty, /进入议事/)
  })
})
