import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'
const source = readFileSync(new URL('../src/components/juyiting/AgentPanel.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'roster-cta', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace('export default', 'return')
const AgentPanel = new Function('Vue', script)(Vue)
const agent = { agentId: 'explicit-agent', name: '好汉' }
const props = { selectedAgent: agent, canStartConversation: () => true, abilityText: () => '', portraitName: () => '', portraitStyle: () => ({}), statusClass: () => '', statusText: () => '' }
describe('Juyi Hall pending requirement roster action', () => {
  it('shows only private chat when no requirement awaits assignment', async () => {
    const wrapper = mount(AgentPanel, { props })
    try {
      expect(wrapper.find('.point-and-deliberate').exists()).to.equal(false)
      await wrapper.findAll('button').find(button => button.text() === '与这位好汉密议').trigger('click')
      expect(wrapper.emitted('start-conversation')).to.deep.equal([[agent]])
      expect(wrapper.emitted('point-and-deliberate')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })
  it('sends the explicit selected agent and fences unavailable/busy targets', async () => {
    const wrapper = mount(AgentPanel, { props: { ...props, hasPendingTask: true, canPointAndDeliberate: () => true } })
    try {
      await wrapper.get('.point-and-deliberate').trigger('click')
      expect(wrapper.emitted('point-and-deliberate')).to.deep.equal([[agent]])
      await wrapper.setProps({ pointAndStartBusy: true })
      await wrapper.get('.point-and-deliberate').trigger('click')
      expect(wrapper.emitted('point-and-deliberate')).to.have.length(1)
      await wrapper.setProps({ pointAndStartBusy: false, canPointAndDeliberate: () => false })
      expect(wrapper.get('.point-and-deliberate').attributes('disabled')).to.equal('')
    } finally { wrapper.unmount() }
  })
  it('reuses the canonical parent task and existing point-and-start without creating a second lane', () => {
    const page = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const body = page.slice(page.indexOf('const pendingPointAndDeliberateTask ='), page.indexOf('const assignTask ='))
    const selectedTask = Vue.ref({ id: 'task', status: 'open', taskVersion: 3, requirementRevision: 2 })
    const calls = []
    const api = new Function('computed', 'selectedTask', 'canAssign', 'assignTask', `${body}; return { pendingPointAndDeliberateTask, handlePointAndDeliberateAgent }`)(Vue.computed, selectedTask, () => true, (...args) => { calls.push(args); return true })
    expect(api.handlePointAndDeliberateAgent(agent)).to.equal(true)
    expect(calls[0][0]).to.equal(selectedTask.value)
    expect(calls[0][1]).to.equal(agent)
    for (const changes of [{ status: 'completed' }, { assignedAgentId: 'old' }, { funding: { mode: 'FUNDED_SINGLE_AGENT' } }]) {
      selectedTask.value = { id: 'task', status: 'open', ...changes }
      expect(api.pendingPointAndDeliberateTask.value).to.equal(null)
      expect(api.handlePointAndDeliberateAgent(agent)).to.equal(false)
    }
    expect(calls).to.have.length(1)
  })
})
