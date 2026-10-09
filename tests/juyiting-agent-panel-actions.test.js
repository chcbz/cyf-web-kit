import { readFileSync } from 'node:fs'
import { expect } from 'chai'
import { parse, compileScript } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/juyiting/AgentPanel.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const body = compileScript(descriptor, { id: 'agent-actions-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, imports) =>
    `const { ${imports.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace('export default', 'return')
const AgentPanel = new Function('Vue', body)(Vue)
const agent = { agentId: 'agent-actions-fixture', name: '公孙胜', abilities: [] }
const props = {
  selectedAgent: agent, hasPendingTask: true,
  canStartConversation: () => true, canPointAndDeliberate: () => true,
  abilityText: () => '', portraitName: () => '公孙胜', portraitStyle: () => ({}),
  statusClass: () => '', statusText: () => '候命'
}

describe('AgentPanel prototype actions', () => {
  it('groups secondary then primary actions and preserves emitted agent identity', async () => {
    const wrapper = mount(AgentPanel, { props })
    try {
      const buttons = wrapper.findAll('.agent-detail-actions button')
      expect(buttons.map(button => button.text())).to.deep.equal(['与这位好汉密议', '点将并议事'])
      await buttons[0].trigger('click')
      await buttons[1].trigger('click')
      expect(wrapper.emitted('start-conversation')[0]).to.deep.equal([agent])
      expect(wrapper.emitted('point-and-deliberate')[0]).to.deep.equal([agent])
    } finally { wrapper.unmount() }
  })

  it('preserves pending, eligibility, busy and conversation visibility guards', async () => {
    const wrapper = mount(AgentPanel, { props })
    try {
      await wrapper.setProps({ canPointAndDeliberate: () => false })
      expect(wrapper.get('.point-and-deliberate').element.disabled).to.equal(true)
      await wrapper.get('.point-and-deliberate').trigger('click')
      expect(wrapper.emitted('point-and-deliberate')).to.equal(undefined)
      await wrapper.setProps({ canPointAndDeliberate: () => true, pointAndStartBusy: true })
      expect(wrapper.get('.point-and-deliberate').text()).to.equal('正在点将…')
      expect(wrapper.get('.point-and-deliberate').element.disabled).to.equal(true)
      await wrapper.setProps({ hasPendingTask: false, canStartConversation: () => false })
      expect(wrapper.findAll('.agent-detail-actions button')).to.have.length(0)
      await wrapper.setProps({ selectedAgent: null })
      expect(wrapper.find('.agent-detail-actions').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })

  it('defines scoped prototype colors, spacing, wrapping and disabled/focus states', () => {
    expect(descriptor.styles[0].scoped).to.equal(true)
    const css = descriptor.styles[0].content
    const rule = selector => css.slice(css.indexOf(selector)).split('}')[0]
    expect(rule('.agent-detail-actions {')).to.include('gap: 8px').and.include('flex-wrap: wrap')
    expect(rule('.agent-detail-actions button {')).to.include('border: 1px solid #d6b98c').and.include('background: #fffaf0').and.include('border-radius: 7px').and.include('padding: 7px 11px')
    expect(rule('.agent-detail-actions .point-and-deliberate {')).to.include('background: #a44330').and.include('color: #fff9ed')
    expect(rule('.agent-detail-actions button:disabled {')).to.include('opacity: 0.5')
    expect(rule('.agent-detail-actions button:focus-visible {')).to.include('outline: 2px solid')
  })
})
