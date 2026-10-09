import * as discussionContract from '../src/components/juyiting/discussionPanelContract.js'
import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { bountyDeliberationPresentation } from '../src/composables/juyiting/hallMultimediaDeliberationUi.js'

const source = name => readFileSync(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8')
const filename = new URL('../src/components/juyiting/BountyDiscussionPanel.vue', import.meta.url).pathname
const { descriptor } = parse(source('juyiting/BountyDiscussionPanel'), { filename })
const script = compileScript(descriptor, { id: 'bounty-completed-task-refresh', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm,
    (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+(ChatPanel|BountyDeliberationStatus|BountyExecutionTermination|BountyExecutionOutputs|BountyFollowupConsentPanel)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, name) => `var { ${name} } = deps`)
  .replace(/^import\s+\{\s*bountyDeliberationPresentation\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { bountyDeliberationPresentation } = deps')
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/discussionPanelContract\.js['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
  .replace('export default', 'return')

describe('validated finalization completion refresh boundary', () => {
  const installed = []
  before(() => { for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) if (!globalThis[name]) {
    installed.push(name); Object.defineProperty(globalThis, name, { value: window[name], configurable: true })
  } })
  after(() => { for (const name of installed) delete globalThis[name] })
  it('forwards the exact scoped completion to the page without mutating the selected task', async () => {
    const receipt = Object.freeze({ taskId: 'task-1', conversationId: 'conversation-1', operationId: 'finalization-1',
      deliveryId: 'delivery-1', taskVersion: '12' })
    const Gallery = Vue.defineComponent({ emits: ['task-completed'], setup: (_, { emit }) => () =>
      Vue.h('button', { class: 'validated-gallery-completion', onClick: () => emit('task-completed', receipt) }, '完成回执') })
    const ChatPanel = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', {}, slots['bounty-results']?.()) })
    const Component = new Function('Vue', 'deps', script)(Vue, { ...discussionContract, ChatPanel,
      BountyExecutionTermination: { render: () => null }, BountyDeliberationStatus: { render: () => null }, BountyExecutionOutputs: Gallery, BountyFollowupConsentPanel: { render: () => null }, bountyDeliberationPresentation })
    const task = { id: 'task-1', title: '画鸟', status: 'running', version: '9' }
    const wrapper = mount(Component, { props: { selectedTask: task, conversationId: 'conversation-1', identityScope: 'owner-a',
      deliberationV2Enabled: true, mentionLabel: () => '', senderText: () => '' },
      global: { stubs: { 'var-icon': true } } })
    try {
      await wrapper.find('.validated-gallery-completion').trigger('click')
      expect(wrapper.emitted('task-completed')).to.deep.equal([[receipt]])
      expect(wrapper.emitted('task-completed')[0][0]).to.equal(receipt)
      expect(task.status).to.equal('running'); expect(task.version).to.equal('9')
    } finally { wrapper.unmount() }
  })
  it('wires the actual bounty page to refresh server tasks, not to a local completion mutation', () => {
    const page = source('world/JuyiHall')
    const start = page.indexOf('<BountyDiscussionPanel'); const end = page.indexOf('/>', start)
    expect(start).to.be.greaterThan(-1)
    expect(page.slice(start, end)).to.include('@task-completed="loadTasks"')
    expect(source('juyiting/BountyDiscussionPanel')).to.include('@task-completed="$emit(\'task-completed\', $event)"')
  })
  it('compiles the affected templates and scripts', () => {
    for (const name of ['juyiting/BountyExecutionOutputs', 'juyiting/BountyDiscussionPanel', 'world/JuyiHall']) {
      const file = `src/components/${name}.vue`; const { descriptor, errors } = parse(source(name), { filename: file })
      expect(errors, name).to.deep.equal([]); compileScript(descriptor, { id: name })
      expect(compileTemplate({ source: descriptor.template.content, filename: file, id: name }).errors, name).to.deep.equal([])
    }
  })
})
