import { expect } from 'chai'
import { after, before, describe, it } from 'mocha'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { deliveryTypeText } from '../src/utils/executionFormats.js'

let Vue
let mount
let Editor
let state

const load = () => {
  const filename = new URL('../src/components/juyiting/HallDraftEditor.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const code = compileScript(descriptor, { id: 'draft-editor-prototype', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, names) => `var { ${names.split(',').map(part => { const [name, alias] = part.trim().split(/\s+as\s+/); return alias ? `${name}: ${alias}` : name }).join(', ')} } = Vue`)
    .replace(/^import\s+\{[^}]+\}\s+from\s+['"]@\/composables\/usePersonalWorkspace['"];?\s*$/gm, 'var { savePersonalWorkspaceBlob, usePersonalWorkspace } = deps')
    .replace(/^import\s+\{\s*useHallDrafts\s*\}\s+from\s+['"]@\/composables\/juyiting\/useHallDrafts['"];?\s*$/gm, 'var { useHallDrafts } = deps')
    .replace(/^import\s+HallPrivateMark\s+from\s+['"]\.\/HallPrivateMark\.vue['"];?\s*$/gm, "var HallPrivateMark = { name: 'HallPrivateMark', template: '<i />' }")
    .replace(/^import\s+\{\s*deliveryTypeText\s*\}\s+from\s+['"]@\/utils\/executionFormats['"];?\s*$/gm, 'var { deliveryTypeText } = deps')
    .replace('export default', 'return')
  return new Function('Vue', 'deps', code)(Vue, { ...deps(), deliveryTypeText })
}
const deps = () => {
  const draft = Vue.ref(null); const receipt = Vue.ref(null); const caseView = Vue.ref(null); const executionResults = Vue.ref(null)
  const saves = []; const previews = []
  const detail = Vue.ref(null)
  state = { draft, receipt, caseView, executionResults, saves, previews, detail }
  const workspace = {
    loading: Vue.ref(false), error: Vue.ref(''), listState: Vue.ref('ready'), items: Vue.ref([{ fileId: 'file-a', displayName: '资料A.pdf', latestVersion: 2 }]), detail, preview: Vue.ref({ kind: 'none', message: '' }),
    refresh: async () => true, revokePreview: () => {}, dispose: () => {}, download: async () => null,
    select: async fileId => { detail.value = { file: { fileId, displayName: fileId === 'result-a' ? '成果.pdf' : '资料A.pdf', state: 'ACTIVE' }, latestVersion: { version: 2 }, versions: [{ version: 1, originalFilename: '旧版.pdf' }, { version: 2, originalFilename: '新版.pdf' }] }; return detail.value },
    previewVersion: async version => { previews.push(version); workspace.preview.value = version === 1 ? { kind: 'text', text: 'v1 固定预览' } : { kind: 'parts', selectedIndex: 0, parts: [{ kind: 'text', text: 'v2 第 1 页' }, { kind: 'text', text: 'v2 第 2 页' }] }; return true },
    selectPreviewPart: index => { workspace.preview.value = { ...workspace.preview.value, selectedIndex: index }; return true }
  }
  return {
    usePersonalWorkspace: () => workspace, savePersonalWorkspaceBlob: () => {},
    useHallDrafts: () => ({
      capabilityState: Vue.ref('ready'), capabilityError: Vue.ref(''), allowedMimeTypes: Vue.ref(['application/pdf']), generationEnabled: Vue.ref(true), loadCapabilities: async () => true,
      draft, receipt, caseView, executionView: Vue.ref(null), executionResults, resultsState: Vue.ref('idle'), resultsError: Vue.ref(''),
      state: Vue.ref('idle'), submissionState: Vue.ref('idle'), error: Vue.ref(''), reloadRequired: Vue.ref(false), summaries: Vue.ref([]), nextCursor: Vue.ref(null), submissionRecovery: Vue.ref(null), unresolvedIntent: Vue.ref(null),
      create: async fields => { saves.push(['create', fields]); draft.value = { draftId: 'draft-1', revision: 1, state: 'EDITING', editableFields: fields }; return draft.value },
      save: async fields => { saves.push(['save', fields]); draft.value = { ...draft.value, revision: draft.value.revision + 1, editableFields: fields }; return draft.value },
      submit: async () => null, discard: async () => null, list: async () => true, loadMore: async () => false, load: async () => null, reconcileSubmission: async () => null, loadCase: async () => null, loadExecution: async () => null, loadFormalTask: async () => null,
      loadResults: async executionId => { executionResults.value = { executionId, state: 'OUTPUT_COMMITTED', manifestId: 'm1', allowedActions: ['VIEW'], items: [{ outputId: 'out-1', fileId: 'result-a', fileVersion: 2, mime: 'application/pdf', filename: '成果.pdf', byteLength: 1, sha256: 'a'.repeat(64), availability: 'AVAILABLE' }] }; return executionResults.value }, dispose: () => {}
    })
  }
}
const tick = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick() }
const button = (wrapper, text) => wrapper.findAll('button').find(node => node.text() === text)
const props = { identityScope: 'tenant\u0000client\u0000owner', agents: [{ agentId: 'agent-a', name: '吴用' }] }

before(async () => { for (const key of ['SVGElement', 'Element', 'Node']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: globalThis.window[key] }); Vue = await import('vue'); ({ mount } = await import('@vue/test-utils')); Editor = load() })
after(() => { document.body.innerHTML = '' })

describe('HallDraftEditor prototype flow', () => {
  it('uses only visible step controls and does not retain hidden draft authorization or agent controls', async () => {
    const wrapper = mount(load(), { props })
    try {
      await tick()
      expect(wrapper.find('.legacy-agent-contract').exists()).to.equal(false)
      expect(wrapper.find('.legacy-confirmation-contract').exists()).to.equal(false)
      expect(wrapper.find('input[type="checkbox"]').exists()).to.equal(false)
      expect(wrapper.findAll('select')).to.have.length(1)
      await wrapper.find('input').setValue('事项'); await wrapper.find('textarea').setValue('说明'); await wrapper.find('select').setValue('application/pdf')
      await button(wrapper, '下一步：确认交办').trigger('click'); await tick()
      expect(wrapper.vm.windowTitle).to.equal('确认交办')
      expect(wrapper.findAll('select')).to.have.length(1)
      expect(wrapper.find('.authorization input[type="checkbox"]').exists()).to.equal(true)
      expect(wrapper.text()).to.include('外部 Provider')
      expect(wrapper.text()).to.include('费用未知')
    } finally { wrapper.unmount() }
  })

  it('saves draft edits when leaving picker or confirm, including a changed visible agent', async () => {
    const wrapper = mount(load(), { props })
    try {
      await tick(); await wrapper.find('input').setValue('事项'); await wrapper.find('textarea').setValue('说明'); await wrapper.find('select').setValue('application/pdf')
      await button(wrapper, '添加资料').trigger('click'); await tick()
      expect(wrapper.vm.needsSave).to.equal(true)
      expect(await wrapper.vm.saveBeforeLeave()).to.equal(true)
      expect(state.saves).to.have.length(1)
      expect(wrapper.vm.goBack()).to.equal(true)
      await tick()
      await button(wrapper, '下一步：确认交办').trigger('click'); await tick()
      await wrapper.find('select').setValue('agent-a')
      expect(wrapper.vm.needsSave).to.equal(true)
      expect(wrapper.find('.authorization input').element.disabled).to.equal(true)
      expect(await wrapper.vm.saveBeforeLeave()).to.equal(true)
      expect(state.saves.at(-1)[1].targetAgentId).to.equal('agent-a')
      expect(wrapper.find('.authorization input').element.disabled).to.equal(false)
    } finally { wrapper.unmount() }
  })

  it('keeps TASK_CREATE separate from private agent/format selection and reaches visible confirmation only after save', async () => {
    const wrapper = mount(load(), { props: { ...props, initialKind: 'TASK_CREATE' } })
    try {
      await tick()
      expect(wrapper.findAll('select')).to.have.length(0)
      await wrapper.find('input').setValue('正式任务')
      await wrapper.find('textarea').setValue('正式简述')
      await button(wrapper, '下一步：确认创建').trigger('click'); await tick()
      expect(wrapper.vm.windowTitle).to.equal('确认创建正式任务')
      expect(wrapper.findAll('select')).to.have.length(0)
      expect(wrapper.find('.authorization input').exists()).to.equal(true)
      expect(wrapper.text()).to.include('创建正式任务不会启动执行')
    } finally { wrapper.unmount() }
  })

  it('previews without selecting, then renders fixed result versions and case inputs without false empty claims', async () => {
    const wrapper = mount(load(), { props })
    try {
      await tick(); await button(wrapper, '添加资料').trigger('click'); await tick()
      await button(wrapper, '预览').trigger('click'); await tick()
      expect(wrapper.text()).to.include('v2 第 1 页')
      expect(wrapper.vm.goBack()).to.equal(true); await tick()
      expect(wrapper.text()).to.include('已选 0 份')
      state.receipt.value = { ref: { sourceType: 'PRIVATE_CASE', sourceId: 'case-1' }, execution: { executionId: 'exec-1', targetAgentId: 'agent-a', state: 'OUTPUT_COMMITTED', inputs: [{ fileId: 'file-a', version: 2 }] }, task: null, submittedAt: 1 }
      state.caseView.value = { caseId: 'case-1', title: '事项', revision: 1, sourceRef: {}, allowedActions: ['VIEW'], executions: [{ revisionNo: 1, execution: state.receipt.value.execution }] }
      await tick(); await button(wrapper, '查看成果').trigger('click'); await tick()
      await button(wrapper, '预览').trigger('click'); await tick()
      expect(wrapper.find('[aria-label="成果固定版本预览"]').text()).to.include('v2 第 1 页')
      const resultVersion = wrapper.find('[aria-label="成果固定版本预览"] select')
      expect(resultVersion.findAll('option').map(node => node.text())).to.include.members(['v1 · 旧版.pdf', 'v2 · 新版.pdf'])
      await resultVersion.setValue('1'); await tick()
      expect(wrapper.find('[aria-label="成果固定版本预览"]').text()).to.include('v1 固定预览')
      await button(wrapper, '资料').trigger('click'); await tick()
      expect(wrapper.text()).to.include('资料A.pdf · v2')
    } finally { wrapper.unmount() }
  })
})
