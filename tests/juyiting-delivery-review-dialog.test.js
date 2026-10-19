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
      await wrapper.get('.review-preview').trigger('click'); expect(wrapper.emitted('preview')[0][0]).to.deep.equal(batch.items[0])
      await wrapper.get('.review-confirm').trigger('click'); expect(wrapper.emitted('confirm')).to.have.length(1)
      await wrapper.setProps({ pending: true })
      expect(wrapper.findAll('button').every(button => button.element.disabled)).to.equal(true)
      await wrapper.get('dialog').trigger('cancel'); expect(wrapper.emitted('back')).to.equal(undefined)
      await wrapper.setProps({ pending: false }); await wrapper.get('dialog').trigger('cancel')
      expect(wrapper.emitted('back')).to.have.length(1)
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
