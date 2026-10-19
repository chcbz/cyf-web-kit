import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import * as discussionContract from '../src/components/juyiting/discussionPanelContract.js'
import { bountyDeliberationPresentation } from '../src/composables/juyiting/hallMultimediaDeliberationUi.js'
const source = name => readFileSync(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8')
const filename = 'src/components/juyiting/BountyDiscussionPanel.vue'
const descriptor = parse(source('juyiting/BountyDiscussionPanel'), { filename }).descriptor
const script = compileScript(descriptor, { id: 'review-entry', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
  .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, name) => `var ${name} = deps.${name}`)
  .replace('export default', 'return')
describe('submission does not complete the root; explicit review owns completion', () => {
  const installed = []
  before(() => { for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) if (!globalThis[name]) {
    installed.push(name); Object.defineProperty(globalThis, name, { value: window[name], configurable: true })
  } })
  after(() => { for (const name of installed) delete globalThis[name] })
  it('the unique toolbar icon emits only a review-opening event and cannot complete a task', async () => {
    const Gallery = Vue.defineComponent({ emits: ['task-completed'], setup: (_, { emit }) => () => Vue.h('button', { class: 'old-submission', onClick: () => emit('task-completed', { state: 'COMPLETED', stage: 'SUBMITTED' }) }, '提交回执') })
    const Chat = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', {}, [Vue.h('header', { class: 'toolbar' }, slots['matter-actions']?.()), Vue.h('main', { class: 'messages' }, slots['bounty-results']?.())]) })
    const noRender = { render: () => null }
    const Component = new Function('Vue', 'deps', script)(Vue, { ...discussionContract, bountyDeliberationPresentation, ChatPanel: Chat,
      BountyExecutionOutputs: Gallery, TaskSkillCapabilities: noRender, BountyDeliberationStatus: noRender, BountyExecutionTermination: noRender })
    const task = { id: 'task-1', status: 'reviewing', taskVersion: '7' }
    const wrapper = mount(Component, { props: { selectedTask: task, reviewContext: { currentDelivery: { allowedActions: ['VIEW', 'ACCEPT'] } }, mentionLabel: () => '', senderText: () => '' } })
    try {
      await wrapper.get('.old-submission').trigger('click'); expect(wrapper.emitted('task-completed')).to.equal(undefined)
      expect(wrapper.findAll('[aria-label="查看并验收"]')).to.have.length(1)
      expect(wrapper.get('.messages').find('[aria-label="查看并验收"]').exists()).to.equal(false)
      await wrapper.get('[aria-label="查看并验收"]').trigger('click'); expect(wrapper.emitted('review-delivery')).to.deep.equal([[]])
      expect(task.status).to.equal('reviewing'); await wrapper.setProps({ voice: { voiceInteractionLocked: true } })
      expect(wrapper.get('[aria-label="查看并验收"]').attributes('disabled')).to.equal('')
      await wrapper.setProps({ reviewContext: { currentDelivery: { allowedActions: ['VIEW'] } } })
      expect(wrapper.find('[aria-label="查看并验收"]').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })
  it('the actual page guards root refresh by a scoped COMMITTED ACCEPT, not a gallery/submission receipt', () => {
    const page = source('world/JuyiHall')
    expect(page).to.include("receipt.state !== 'COMMITTED'")
    expect(page).to.include("receipt.decision !== 'ACCEPT'")
    expect(page).to.include("receipt.taskState !== 'COMPLETED'")
    expect(page).to.include('receipt.taskId !== reviewTaskId.value')
    expect(page).to.include('if (key === lastReviewCompletion) return')
    const gallery = source('juyiting/BountyExecutionOutputs')
    expect(gallery).not.to.include('finalizationCompleted')
    expect(gallery).not.to.include("emit('task-completed'")
    expect(gallery).not.to.include('finalizeSelected')
    expect(gallery).not.to.include('保存到工作空间')
    expect(gallery).not.to.include('>下载</button>')
  })
  it('compiles every affected view and the shared frozen-batch dialog', () => {
    for (const name of ['juyiting/BountyExecutionOutputs', 'juyiting/BountyDiscussionPanel', 'juyiting/BountyAcceptancePanel', 'juyiting/HallDeliveryReviewDialog', 'world/JuyiHall']) {
      const file = `src/components/${name}.vue`; const { descriptor, errors } = parse(source(name), { filename: file })
      expect(errors, name).to.deep.equal([]); compileScript(descriptor, { id: name })
      expect(compileTemplate({ source: descriptor.template.content, filename: file, id: name }).errors, name).to.deep.equal([])
    }
  })
})
