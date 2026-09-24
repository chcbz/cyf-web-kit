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

const formalExecutionStub = () => ({
  readyReason: Vue.ref('正式执行条件尚未满足。'), stateText: Vue.ref('尚未确认本正式任务的执行记录。'), scopeError: Vue.ref(''), activeExecution: Vue.ref(null),
  formalHistory: Vue.ref([]), historyState: Vue.ref('idle'), historyError: Vue.ref(''),
  canRevoke: Vue.ref(false), revoking: Vue.ref(false), revokeOriginal: async () => null,
  execution: { pending: Vue.ref(false) }, refreshReadiness: async () => false,
  recoverOriginalRequest: async () => null, begin: async () => null, loadFormalHistory: async () => [], selectFormalHistory: async () => null, dispose: () => {}
})

const compile = () => {
  const filename = new URL('../src/components/personal-workspace/TaskMaterialLinks.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const code = compileScript(descriptor, { id: 'w06-task-material-links', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_match, names, path) =>
      `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_match, name, path) =>
      `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return imports => new Function('imports', code)({ '@/composables/useFormalTaskExecution': { useFormalTaskExecution: formalExecutionStub }, ...imports })
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
    const wrapper = mount(component, { global: { stubs: { teleport: true } }, props: { taskId: 'task_a', identityEpoch: 1 } })
    wrappers.push(wrapper)

    await wrapper.get('.open-material-picker').trigger('click')
    await wrapper.get('.workspace-file-list button').trigger('click')
    await wrapper.get('select').setValue('1')
    await wrapper.get('.attach-material').trigger('click')

    assert.deepEqual(attached, [{ fileId: 'file_a', version: 1, role: 'INPUT' }])
    assert.match(wrapper.text(), /不会启动 Agent 执行/)
    assert.match(wrapper.text(), /明确开始正式办理/)
  })

  it('renders a server-returned OUTPUT link as an execution-managed reference without inventing formal delivery', () => {
    const workspace = { items: Vue.ref([]), nextCursor: Vue.ref(null), listState: Vue.ref('empty'), loading: Vue.ref(false), error: Vue.ref(''), detail: Vue.ref(null), refresh: async () => true, loadMore: async () => false, select: async () => null, dispose: () => {} }
    const links = { links: Vue.ref([taskLink({ relationId: 'rel_output', role: 'OUTPUT' })]), nextCursor: Vue.ref(null), listState: Vue.ref('ready'), loading: Vue.ref(false), actionState: Vue.ref('idle'), error: Vue.ref(''), load: async () => true, loadMore: async () => false, attach: async () => null, detach: async () => null, dispose: () => {} }
    const component = TaskMaterialLinks({ vue: Vue, '@/composables/usePersonalWorkspace': { usePersonalWorkspace: () => workspace }, '@/composables/usePersonalWorkspaceTaskLinks': { usePersonalWorkspaceTaskLinks: () => links } })
    const wrapper = mount(component, { global: { stubs: { teleport: true } }, props: { taskId: 'task_a', identityEpoch: 1 } })
    wrappers.push(wrapper)

    assert.match(wrapper.text(), /成果关联由执行流程管理/)
    assert.match(wrapper.text(), /正式交付状态仍需以正式交付回执确认/)
    assert.equal(wrapper.find('.task-link-row.output .open-linked-file').exists(), true)
    assert.equal(wrapper.find('.task-link-row.output button:not(.open-linked-file)').exists(), false)
  })

  it('clears the local exact-version draft when the authenticated identity changes', async () => {
    const detail = Vue.ref(null)
    const workspace = { items: Vue.ref([{ fileId: 'file_a', displayName: '项目资料', latestVersion: 2 }]), nextCursor: Vue.ref(null), listState: Vue.ref('ready'), loading: Vue.ref(false), error: Vue.ref(''), detail, refresh: async () => true, loadMore: async () => false, select: async () => { detail.value = workspaceDetail(); return detail.value }, dispose: () => {} }
    const links = { links: Vue.ref([]), nextCursor: Vue.ref(null), listState: Vue.ref('empty'), loading: Vue.ref(false), actionState: Vue.ref('idle'), error: Vue.ref(''), load: async () => true, loadMore: async () => false, attach: async () => null, detach: async () => null, dispose: () => {} }
    const component = TaskMaterialLinks({ vue: Vue, '@/composables/usePersonalWorkspace': { usePersonalWorkspace: () => workspace }, '@/composables/usePersonalWorkspaceTaskLinks': { usePersonalWorkspaceTaskLinks: () => links } })
    const wrapper = mount(component, { global: { stubs: { teleport: true } }, props: { taskId: 'task_a', identityEpoch: 1 } })
    wrappers.push(wrapper)
    await wrapper.get('.open-material-picker').trigger('click')
    await wrapper.get('.workspace-file-list button').trigger('click')
    assert.equal(wrapper.find('.attach-material').exists(), true)

    await wrapper.setProps({ identityEpoch: 2 })
    assert.equal(wrapper.find('.task-material-picker').exists(), false)
    assert.equal(wrapper.find('.attach-material').exists(), false)
  })

  it('requires explicit confirmation to revoke the queued execution and emits the exact receipt', async () => {
    const calls = []
    const receipt = { executionId: 'pwe_exact', state: 'INPUTS_REVOKED' }
    const formal = formalExecutionStub()
    formal.activeExecution.value = { executionId: 'pwe_exact', state: 'QUEUED' }
    formal.canRevoke.value = true
    formal.revokeOriginal = async options => { calls.push(options); return receipt }
    const workspace = { items: Vue.ref([]), nextCursor: Vue.ref(null), listState: Vue.ref('empty'), loading: Vue.ref(false), error: Vue.ref(''), detail: Vue.ref(null), refresh: async () => true, dispose: () => {} }
    const links = { links: Vue.ref([]), nextCursor: Vue.ref(null), listState: Vue.ref('empty'), loading: Vue.ref(false), actionState: Vue.ref('idle'), error: Vue.ref(''), load: async () => true, dispose: () => {} }
    const component = TaskMaterialLinks({ vue: Vue, '@/composables/useFormalTaskExecution': { useFormalTaskExecution: () => formal }, '@/composables/usePersonalWorkspace': { usePersonalWorkspace: () => workspace }, '@/composables/usePersonalWorkspaceTaskLinks': { usePersonalWorkspaceTaskLinks: () => links } })
    const wrapper = mount(component, { global: { stubs: { teleport: true } }, props: { taskId: 'task_a', identityEpoch: 1 } })
    wrappers.push(wrapper)
    const button = wrapper.findAll('button').find(node => node.text() === '撤销本次输入授权')
    assert.equal(button.attributes('disabled'), '')
    await button.trigger('click')
    assert.deepEqual(calls, [])
    await wrapper.get('.formal-confirmation input').setValue(true)
    assert.equal(button.attributes('disabled'), undefined)
    await button.trigger('click')
    assert.deepEqual(calls, [{ confirmed: true }])
    assert.deepEqual(wrapper.emitted('formal-execution-recovered'), [[receipt]])
    assert.equal(button.attributes('disabled'), '')
  })

  it('uses a non-modal full-page material picker whose scroll body and action footer stay separate with long lists', async () => {
    const items = Array.from({ length: 19 }, (_, index) => ({ fileId: `file_${index + 1}`, displayName: `资料 ${index + 1}`, latestVersion: 1 }))
    const detail = Vue.ref(null)
    const workspace = { items: Vue.ref(items), nextCursor: Vue.ref(null), listState: Vue.ref('ready'), loading: Vue.ref(false), error: Vue.ref(''), detail, refresh: async () => true, loadMore: async () => false, select: async fileId => { detail.value = { file: { fileId, displayName: fileId, state: 'ACTIVE', latestVersion: 1 }, latestVersion: { version: 1 }, versions: [{ version: 1, originalFilename: `${fileId}.pdf` }] }; return detail.value }, dispose: () => {} }
    const links = { links: Vue.ref([]), nextCursor: Vue.ref(null), listState: Vue.ref('empty'), loading: Vue.ref(false), actionState: Vue.ref('idle'), error: Vue.ref(''), load: async () => true, loadMore: async () => false, attach: async () => null, detach: async () => null, dispose: () => {} }
    const component = TaskMaterialLinks({ vue: Vue, '@/composables/usePersonalWorkspace': { usePersonalWorkspace: () => workspace }, '@/composables/usePersonalWorkspaceTaskLinks': { usePersonalWorkspaceTaskLinks: () => links } })
    const wrapper = mount(component, { global: { stubs: { teleport: true } }, props: { taskId: 'task_a', identityEpoch: 1, defaultInstruction: '整理正式 PDF' } })
    wrappers.push(wrapper)

    await wrapper.get('.open-material-picker').trigger('click')
    assert.equal(wrapper.get('.task-material-picker').attributes('role'), 'region')
    assert.equal(wrapper.find('.task-material-picker[role="dialog"]').exists(), false)
    assert.equal(wrapper.findAll('.workspace-file-list button').length, 19)
    assert.equal(wrapper.get('.material-picker-body').exists(), true)
    assert.equal(wrapper.get('.material-picker-footer').exists(), true)
    assert.match(wrapper.get('.use-no-material').text(), /不使用资料/)
    const source = readFileSync(new URL('../src/components/personal-workspace/TaskMaterialLinks.vue', import.meta.url), 'utf8')
    assert.match(source, /<Teleport to="body">/)
    assert.match(source, /grid-template-rows:auto minmax\(0,1fr\) auto/)
  })

  it('treats the explicit start button as confirmation without an extra consent checkbox', () => {
    const source = readFileSync(new URL('../src/components/personal-workspace/TaskMaterialLinks.vue', import.meta.url), 'utf8')
    assert.match(source, /confirmed: true/)
    assert.match(source, /确认并开始办理（PDF）/)
    assert.doesNotMatch(source, /v-model="inputsConfirmed"/)
  })

  it('mounts task material controls in the formal bounty detail while preserving the existing discussion event', () => {
    const bounty = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    assert.match(bounty, /TaskMaterialLinks/)
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    assert.match(hall, /:formal-task-execution-context="formalTaskExecutionContext"/)
    assert.match(bounty, /formalTaskExecutionScope\.taskId/)
    assert.match(bounty, /workspace-shortcut/)
    assert.match(bounty, /open-workspace/)
    assert.match(bounty, /@click="\$emit\('discuss-task', detailTask, assignedAgentForTask\(detailTask\)\)"/)
    assert.match(bounty, /进入议事/)
  })
})
