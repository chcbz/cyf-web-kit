import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
const filename = 'HallDeliveryReviewDialog.vue'
const descriptor = parse(readFileSync(new URL('../src/components/juyiting/HallDeliveryReviewDialog.vue', import.meta.url), 'utf8'), { filename }).descriptor
const source = compileScript(descriptor, { id: 'review-dialog-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace('export default', 'return')
const Dialog = new Function('Vue', source)(Vue)
const batch = { summary: '固定成果', items: [
  { artifactId: 'result', artifactVersion: '1', displayRole: 'RESULT', purpose: '正文', unavailableReason: null },
  { artifactId: 'manifest', artifactVersion: '1', displayRole: 'MANIFEST', purpose: 'manifest', unavailableReason: null }
] }
describe('shared delivery review modal interaction', () => {
  let prototype, oldShow, oldClose
  const installed = []
  before(() => {
    for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) if (!globalThis[name]) {
      installed.push(name); Object.defineProperty(globalThis, name, { value: window[name], configurable: true })
    }
    prototype = Object.getPrototypeOf(document.createElement('dialog'))
    oldShow = Object.getOwnPropertyDescriptor(prototype, 'showModal'); oldClose = Object.getOwnPropertyDescriptor(prototype, 'close')
    Object.defineProperty(prototype, 'showModal', { configurable: true, value () { this.open = true } })
    Object.defineProperty(prototype, 'close', { configurable: true, value () { this.open = false; this.dispatchEvent(new window.Event('close')) } })
  })
  after(() => {
    for (const [name, original] of [['showModal', oldShow], ['close', oldClose]]) {
      if (original) Object.defineProperty(prototype, name, original); else delete prototype[name]
    }
    for (const name of installed) delete globalThis[name]
  })
  it('shows only result rows, provides one back control and emits user intent without deciding on mount', async () => {
    const wrapper = mount(Dialog, { props: { open: true, frozenBatch: batch }, attachTo: document.body })
    try {
      await flushPromises()
      expect(wrapper.element.open).to.equal(true); expect(wrapper.findAll('li')).to.have.length(1)
      expect(wrapper.get('header').findAll('button')).to.have.length(1)
      expect(wrapper.emitted('confirm')).to.equal(undefined)
      expect(wrapper.text()).to.include('将确认整个提交批次')
      expect(wrapper.text()).not.to.include('仅验收所选')
      await wrapper.get('.review-preview').trigger('click'); expect(wrapper.emitted('preview')[0][0]).to.deep.equal(batch.items[0])
      await wrapper.get('.review-confirm').trigger('click'); expect(wrapper.emitted('confirm')).to.have.length(1)
      await wrapper.setProps({ pending: true })
      expect(wrapper.findAll('button').every(button => button.element.disabled)).to.equal(true)
      await wrapper.get('dialog').trigger('cancel'); expect(wrapper.emitted('back')).to.equal(undefined)
      await wrapper.setProps({ pending: false }); await wrapper.get('dialog').trigger('cancel')
      expect(wrapper.emitted('back')).to.have.length(1)
    } finally { wrapper.unmount() }
  })
  it('selection mode lists historical versions, starts unselected and emits no writes before confirmation', async () => {
    const choices = [{ key: 'old', title: '第1稿' }, { key: 'new', title: '第2稿' }]
    const wrapper = mount(Dialog, { props: { open: true, selectionMode: true, choices, selectedKeys: [] }, attachTo: document.body })
    try {
      await flushPromises(); expect(wrapper.findAll('input')).to.have.length(2)
      expect(wrapper.get('.review-confirm').element.disabled).to.equal(true)
      await wrapper.findAll('input')[0].setValue(true); expect(wrapper.emitted('toggle')[0]).to.deep.equal(['old'])
      expect(wrapper.emitted('confirm')).to.equal(undefined)
      await wrapper.setProps({ selectedKeys: ['old'] }); expect(wrapper.get('.review-confirm').element.disabled).to.equal(false)
      expect(wrapper.text()).to.include('仅验收所选 1 项成果')
      expect(wrapper.text()).to.include('事项随即完成，不再继续办理')
      expect(wrapper.text()).to.include('也可以选择历史版本')
      expect(wrapper.text()).not.to.include('将确认整个提交批次')
      await wrapper.get('.review-confirm').trigger('click'); expect(wrapper.emitted('confirm')).to.have.length(1)
      await wrapper.setProps({ selectionLocked: true }); expect(wrapper.findAll('input').every(input => input.element.disabled)).to.equal(true)
      expect(wrapper.text()).not.to.include('下载')
    } finally { wrapper.unmount() }
  })
  it('anchors one preview under its exact row, marks the active button and never toggles selection', async () => {
    const choices = [{ key: 'request-1:old', title: 'output_1' }, { key: 'request-2:new', title: 'output_1' }]
    const wrapper = mount(Dialog, { props: { open: true, selectionMode: true, choices, selectedKeys: ['request-1:old'] },
      slots: { 'selection-preview': ({ item }) => Vue.h('p', { class: 'preview-content' }, item.key) }, attachTo: document.body })
    try {
      await flushPromises()
      const rows = wrapper.findAll('li'); const buttons = wrapper.findAll('.review-selection-preview')
      expect(wrapper.find('.review-inline-preview').exists()).to.equal(false)
      await buttons[0].trigger('click')
      expect(rows[0].get('.preview-content').text()).to.equal(choices[0].key)
      expect(rows[0].get('h3').text()).to.include('成果 1 · output_1')
      expect(buttons[0].attributes('aria-expanded')).to.equal('true')
      expect(buttons[0].attributes('aria-controls')).to.equal(rows[0].get('.review-inline-preview').attributes('id'))
      expect(buttons[0].text()).to.equal('收起预览')
      await buttons[1].trigger('click')
      expect(rows[0].find('.review-inline-preview').exists()).to.equal(false)
      expect(rows[1].get('.preview-content').text()).to.equal(choices[1].key)
      expect(rows[1].get('h3').text()).to.include('成果 2')
      expect(wrapper.findAll('.review-inline-preview')).to.have.length(1)
      expect(wrapper.emitted('toggle')).to.equal(undefined)
      expect(wrapper.emitted('confirm')).to.equal(undefined)
      expect(wrapper.findAll('input').map(input => input.element.checked)).to.deep.equal([true, false])
      await buttons[1].trigger('click')
      expect(wrapper.find('.review-inline-preview').exists()).to.equal(false)
      expect(wrapper.emitted('preview-selection').at(-1)).to.deep.equal([null])
    } finally { wrapper.unmount() }
  })
  for (const change of ['closed', 'context', 'removed', 'mode']) it(`clears active preview when ${change}`, async () => {
    const wrapper = mount(Dialog, { props: { open: true, selectionMode: true, choices: [{ key: 'a', title: '旧稿' }] }, attachTo: document.body })
    try {
      await flushPromises(); await wrapper.get('.review-selection-preview').trigger('click')
      if (change === 'closed') await wrapper.setProps({ open: false })
      if (change === 'context') await wrapper.setProps({ context: { taskId: 'new-task' } })
      if (change === 'removed') await wrapper.setProps({ choices: [] })
      if (change === 'mode') await wrapper.setProps({ selectionMode: false })
      await flushPromises()
      expect(wrapper.find('.review-inline-preview').exists()).to.equal(false)
      expect(wrapper.emitted('preview-selection').at(-1)).to.deep.equal([null])
      if (change === 'closed') { await wrapper.setProps({ open: true }); await flushPromises(); expect(wrapper.find('.review-inline-preview').exists()).to.equal(false) }
    } finally { wrapper.unmount() }
  })
  it('traps forward and reverse Tab and restores the opening control when closed', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
    const wrapper = mount(Dialog, { props: { open: true, frozenBatch: batch }, attachTo: document.body })
    try {
      await flushPromises()
      const controls = wrapper.findAll('button')
      for (const control of controls) control.element.getClientRects = () => [{}]
      const first = controls[0]; const last = controls.at(-1)
      expect(document.activeElement).to.equal(first.element)
      await first.trigger('keydown', { key: 'Tab', shiftKey: true }); expect(document.activeElement).to.equal(last.element)
      await last.trigger('keydown', { key: 'Tab' }); expect(document.activeElement).to.equal(first.element)
      await wrapper.setProps({ open: false }); await flushPromises()
      expect(wrapper.element.open).to.equal(false); expect(document.activeElement).to.equal(trigger)
    } finally { wrapper.unmount(); trigger.remove() }
  })
})
