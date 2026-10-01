import { expect } from 'chai'
import { after, before } from 'mocha'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
import { followupProviderAcknowledgement } from '../src/composables/juyiting/useHallBountyFollowup.js'

const filename = new URL('../src/components/juyiting/BountyFollowupConsentPanel.vue', import.meta.url).pathname
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'followup-consent-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{\s*followupProviderAcknowledgement\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { followupProviderAcknowledgement } = deps')
  .replace('export default', 'return')

describe('F1 explicit provider acknowledgement panel', () => {
  const previous = new Map()
  before(() => { for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) { if (globalThis[name]) continue; previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true }) } })
  after(() => { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] } })
  it('does not infer consent and emits only after an explicit checkbox acknowledgement', async () => {
    const Component = new Function('Vue', 'deps', script)(Vue, { followupProviderAcknowledgement })
    const preview = { operation: 'EDIT_IMAGE', modelId: 'model_fixture', custody: 'OPERATOR_TEMPLATE', operatorPolicyRevision: 'policy-r1' }
    const wrapper = mount(Component, { props: { enabled: true, state: { status: 'PREVIEWED', preview, record: { finalKey: 'final-key-0001' } } } })
    expect(wrapper.find('button').attributes('disabled')).to.not.equal(undefined)
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('button')[0].trigger('click')
    expect(wrapper.emitted('confirm')).to.deep.equal([[followupProviderAcknowledgement]])
    wrapper.unmount()
  })
})
