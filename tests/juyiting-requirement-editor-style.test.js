import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'

const source = readFileSync(new URL('../src/components/juyiting/HallRequirementEditor.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
function editor () {
  const state = { snapshot: Vue.ref({ title: '事项标题', description: '需求描述', attachments: [] }), busy: Vue.ref(false), error: Vue.ref(''), pending: Vue.ref(null), blocked: Vue.ref(false), load: async () => true, save: async () => true, check: async () => true }
  const code = compileScript(descriptor, { id: 'requirement-style', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import.*from ['"]@\/composables\/useHttp['"];?$/gm, 'var agentApi = {}')
    .replace(/^import.*from ['"][^'"]*useHallRequirementEdit.js['"];?$/gm, 'var useHallRequirementEdit = () => state; var requirementPickerMaterials = value => value')
    .replace(/^import HallMaterialPicker.*$/gm, "var HallMaterialPicker = { render: () => null }")
    .replace('export default', 'return')
  return { component: new Function('Vue', 'state', code)(Vue, state), state }
}

describe('pending matter editor prototype styling', () => {
  let wrapper
  before(() => {
    window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
    window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  })
  afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.innerHTML = '' })
  after(() => { delete window.HTMLDialogElement.prototype.showModal; delete window.HTMLDialogElement.prototype.close })
  for (const field of ['title', 'description']) it(`teleports styled ${field} editor with icon close and primary save`, async () => {
    const { component } = editor()
    wrapper = mount(component, { props: { task: { id: 'test' }, enabled: true }, attachTo: document.body })
    await wrapper.vm.open(field); await Vue.nextTick()
    const dialog = document.querySelector('.requirement-edit-dialog[open]')
    expect(dialog.parentElement).to.equal(document.body)
    expect(dialog.querySelector('.requirement-edit-close svg')).not.to.equal(null)
    expect(dialog.querySelector('.requirement-edit-close').textContent).to.equal('')
    expect(dialog.querySelector('.requirement-edit-save').textContent).to.equal('保存')
    expect(dialog.querySelector('.requirement-edit-hint').textContent).to.include('内容变化后')
    expect(dialog.querySelector(field === 'title' ? 'input' : 'textarea')).not.to.equal(null)
    dialog.querySelector('.requirement-edit-close').click(); await Vue.nextTick()
    expect(document.querySelector('dialog')).to.equal(null)
  })
  it('keeps saving disabled and pending-result actions within the same theme', async () => {
    const { component, state } = editor()
    wrapper = mount(component, { props: { task: { id: 'test' }, enabled: true }, attachTo: document.body })
    state.pending.value = { operationKey: 'same' }
    await wrapper.vm.open('title'); await Vue.nextTick()
    expect(document.querySelector('dialog footer').textContent).to.include('查询保存结果')
    expect(document.querySelector('.requirement-edit-save').textContent).to.equal('继续原保存')
    state.busy.value = true; await Vue.nextTick()
    expect([...document.querySelectorAll('dialog button')].every(button => button.disabled)).to.equal(true)
  })
  it('compiles local theme and unfilled tools without relying on hall ancestors', () => {
    const css = descriptor.styles[0].content
    expect(compileStyle({ source: css, filename: 'HallRequirementEditor.vue', id: 'data-v-style', scoped: true }).errors).to.deep.equal([])
    for (const token of ['#fffefa', '#e3e5dc', '#923f30', 'calc(100vw - 48px)', 'focus-visible']) expect(css).to.include(token)
    const panel = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    expect(panel).to.match(/\.matter-edit-button,\s*\.matter-edit-button:hover:not\(:disabled\)\s*\{ background: transparent/)
  })
})
