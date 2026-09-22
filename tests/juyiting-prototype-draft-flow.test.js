import { expect } from 'chai'
import { after, before, describe, it } from 'mocha'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { deliveryTypeText } from '../src/utils/executionFormats.js'

let Vue
let mount
let HallDraftEditor
let model

const load = () => {
  const filename = new URL('../src/components/juyiting/HallDraftEditor.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const script = compileScript(descriptor, { id: 'prototype-draft-flow', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, bindings) => `var { ${bindings.split(',').map(binding => { const [name, alias] = binding.trim().split(/\s+as\s+/); return alias ? `${name}: ${alias}` : name }).join(', ')} } = Vue`)
    .replace(/^import\s+\{[^}]+\}\s+from\s+['"]@\/composables\/usePersonalWorkspace['"];?\s*$/gm, 'var { savePersonalWorkspaceBlob, usePersonalWorkspace } = deps')
    .replace(/^import\s+\{\s*useHallDrafts\s*\}\s+from\s+['"]@\/composables\/juyiting\/useHallDrafts['"];?\s*$/gm, 'var { useHallDrafts } = deps')
    .replace(/^import\s+HallPrivateMark\s+from\s+['"]\.\/HallPrivateMark\.vue['"];?\s*$/gm, "var HallPrivateMark = { name: 'HallPrivateMark', template: '<i />' }")
    .replace(/^import\s+\{\s*deliveryTypeText\s*\}\s+from\s+['"]@\/utils\/executionFormats['"];?\s*$/gm, 'var { deliveryTypeText } = deps')
    .replace('export default', 'return')
  return new Function('Vue', 'deps', script)(Vue, { ...deps(), deliveryTypeText })
}

const deps = () => {
  const draft = Vue.ref(null)
  const state = Vue.ref('idle')
  const error = Vue.ref('')
  const receipt = Vue.ref(null)
  const workspaceItems = Vue.ref([{ fileId: 'brief', displayName: '会议简报.pdf', latestVersion: 3 }])
  const submissions = []
  model = { draft, error, receipt, submissions }
  return {
    useHallDrafts: () => ({
      capabilityState: Vue.ref('ready'), capabilityError: Vue.ref(''), allowedMimeTypes: Vue.ref(['application/pdf']), generationEnabled: Vue.ref(true), loadCapabilities: async () => true,
      draft, state, error, reloadRequired: Vue.ref(false), summaries: Vue.ref([]), nextCursor: Vue.ref(null), receipt,
      submissionState: Vue.ref('idle'), caseView: Vue.ref(null), executionView: Vue.ref(null), submissionRecovery: Vue.ref(null), unresolvedIntent: Vue.ref(null), executionResults: Vue.ref(null), resultsState: Vue.ref('idle'), resultsError: Vue.ref(''),
      create: async fields => { draft.value = { draftId: 'draft-1', revision: 1, state: 'EDITING', editableFields: fields }; return draft.value },
      save: async fields => { draft.value = { ...draft.value, revision: draft.value.revision + 1, editableFields: fields }; return draft.value },
      discard: async () => null, list: async () => true, loadMore: async () => false, load: async () => null,
      submit: async payload => { submissions.push(payload); error.value = '服务端暂未确认；请核对原请求。'; return null }, reconcileSubmission: async () => null,
      loadCase: async () => null, loadExecution: async () => null, loadResults: async () => null, loadFormalTask: async () => null, dispose: () => {}
    }),
    usePersonalWorkspace: () => ({
      loading: Vue.ref(false), error: Vue.ref(''), items: workspaceItems, listState: Vue.ref('ready'), detail: Vue.ref(null), preview: Vue.ref({ kind: 'text', text: '固定版本预览' }),
      refresh: async () => true, select: async fileId => ({ file: { fileId } }), previewVersion: async () => true, download: async () => null, dispose: () => {}
    }),
    savePersonalWorkspaceBlob: () => {}
  }
}

const button = (wrapper, text) => wrapper.findAll('button').find(item => item.text() === text)
const tick = async () => { await Vue.nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick() }

before(async () => {
  for (const key of ['SVGElement', 'Element', 'Node']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: globalThis.window[key] })
  Vue = await import('vue')
  ;({ mount } = await import('@vue/test-utils'))
  HallDraftEditor = load()
})
after(() => { document.body.innerHTML = '' })

describe('prototype-conformance draft flow', () => {
  it('keeps picker changes temporary, preserves them through preview, and returns to a separate confirmation', async () => {
    const wrapper = mount(HallDraftEditor, { props: { identityScope: 'tenant\u0000client\u0000owner', agents: [{ agentId: 'wuyong', name: '吴用' }] } })
    try {
      await tick()
      await wrapper.find('input').setValue('整理会议纪要')
      await wrapper.find('textarea').setValue('列出结论和待办。')
      await wrapper.find('select[aria-label="期望格式"]').setValue('application/pdf')
      await button(wrapper, '添加资料').trigger('click')
      await tick()
      await wrapper.find('input[type="checkbox"]').setValue(true)
      await button(wrapper, '取消').trigger('click')
      await tick()
      expect(wrapper.text()).to.include('未引用资料')
      await button(wrapper, '添加资料').trigger('click')
      await tick()
      await wrapper.find('input[type="checkbox"]').setValue(true)
      await button(wrapper, '预览').trigger('click')
      await tick()
      expect(wrapper.vm.windowTitle).to.equal('会议简报.pdf')
      expect(wrapper.vm.navigationDepth).to.equal(3)
      expect(wrapper.vm.canGoBack).to.equal(true)
      expect(wrapper.vm.goBack()).to.equal(true)
      await tick()
      expect(wrapper.text()).to.include('已选 1 份')
      await button(wrapper, '使用所选资料').trigger('click')
      await tick()
      expect(wrapper.text()).to.include('会议简报.pdf · v3')
      await button(wrapper, '下一步：确认交办').trigger('click')
      await tick()
      expect(wrapper.vm.windowTitle).to.equal('确认交办')
      expect(wrapper.vm.navigationDepth).to.equal(1)
      expect(wrapper.text()).to.include('执行好汉')
      expect(wrapper.text()).to.include('私人交办，仅当前身份范围可见')
      expect(wrapper.vm.goBack()).to.equal(true)
      await tick()
      expect(wrapper.find('input').element.value).to.equal('整理会议纪要')
      expect(wrapper.text()).to.include('会议简报.pdf · v3')
    } finally { wrapper.unmount() }
  })

  it('does not claim a receipt when confirm fails and does not submit until explicit authorization', async () => {
    const wrapper = mount(HallDraftEditor, { props: { identityScope: 'tenant\u0000client\u0000owner', agents: [{ agentId: 'wuyong', name: '吴用' }] } })
    try {
      await tick()
      await wrapper.find('input').setValue('一页简报')
      await wrapper.find('textarea').setValue('按固定格式整理。')
      await wrapper.find('select[aria-label="期望格式"]').setValue('application/pdf')
      await button(wrapper, '下一步：确认交办').trigger('click')
      await tick()
      expect(model.submissions).to.have.length(0)
      const authorization = wrapper.find('.authorization input[type="checkbox"]')
      expect(authorization.exists()).to.equal(true)
      expect(authorization.element.disabled).to.equal(true)
      await wrapper.find('select[aria-label="执行好汉"]').setValue('wuyong')
      expect(button(wrapper, '保存更改')).to.not.equal(undefined)
      await button(wrapper, '保存更改').trigger('click')
      await tick()
      expect(authorization.element.disabled).to.equal(false)
      await authorization.setValue(true)
      await button(wrapper, '确认授权并交办').trigger('click')
      await tick()
      expect(model.submissions).to.deep.equal([{ authorizationAcknowledgement: true }])
      expect(wrapper.vm.windowTitle).to.equal('确认交办')
      expect(wrapper.text()).to.include('服务端暂未确认')
      expect(wrapper.text()).not.to.include('已受理，执行编号')
    } finally { wrapper.unmount() }
  })
})
