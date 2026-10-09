import { expect } from 'chai'
import { after, before } from 'mocha'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
const root = new URL('../src/components/juyiting/', import.meta.url)
const compile = (name, extra = '') => {
  const filename = fileURLToPath(new URL(name, root))
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const script = compileScript(descriptor, { id: 'ordinary-request-ui', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import HallVoiceControls[^\n]+/m, 'var HallVoiceControls = { template: "<span />" }')
    .replace('export default', 'return')
  return new Function('Vue', extra + script)(Vue)
}
describe('ordinary-user discussion controls', () => {
  const previous = new Map()
  before(() => { for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) { if (globalThis[name]) continue; previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true }) } })
  after(() => { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] } })
  it('uses the single send action for a drawing request with no consent checkbox or image-only action', async () => {
    const wrapper = mount(compile('HallChatComposer.vue'), { props: { discussionVariant: 'bounty', draft: '画一只鸟', mentionLabel: a => a.agentId }, global: { stubs: { 'var-icon': true } } })
    try {
      expect(wrapper.find('.composer-execute').exists()).to.equal(false)
      expect(wrapper.find('input[type="checkbox"]').exists()).to.equal(false)
      expect(wrapper.findAll('button[type="submit"]')).to.have.length(1)
      expect(wrapper.find('.composer-send').attributes('aria-label')).to.equal('发送')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.emitted('send-message')).to.have.length(1)
      expect(wrapper.emitted('execute-followup')).to.equal(undefined)
      expect(wrapper.text()).not.to.match(/受控|签发|Provider|原键/)
    } finally { wrapper.unmount() }
  })
  it('does not render the removed consent surface or a confirmation action on stored suggestions', () => {
    expect(existsSync(new URL('BountyFollowupConsentPanel.vue', root))).to.equal(false)
    const discussion = readFileSync(new URL('BountyDiscussionPanel.vue', root), 'utf8')
    expect(discussion).not.to.match(/BountyFollowupConsentPanel|confirm-followup|execute-followup/)
    const wrapper = mount(compile('BountyTypedOutcomeCard.vue'), { props: { projection: { outcome: { kind: 'EXECUTION_PROPOSAL', text: '可以画成蓝色。', proposal: { operation: 'GENERATE_IMAGE' } } } } })
    try { expect(wrapper.findAll('button')).to.have.length(0); expect(wrapper.text()).not.to.match(/Provider|受控|明确同意|确认办理/) } finally { wrapper.unmount() }
  })
})
