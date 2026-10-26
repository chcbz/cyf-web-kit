import * as discussionTurnHelpers from '../src/composables/juyiting/hallDiscussionTurns.js'
import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'terminal-chat', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
  .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, name) => `var ${name} = deps.${name}`)
  .replace('export default', 'return')
const directory = () => ({
  items: Vue.ref([]), links: Vue.ref([]), pendingWrites: Vue.ref([]), loading: Vue.ref(false), error: Vue.ref(''),
  actionState: Vue.ref('idle'), writeNotice: Vue.ref(''), refresh: async () => true, load: async () => true,
  dispose: () => {}, retryWrite: () => {}
})
const Composer = Vue.defineComponent({
  name: 'ComposerProbe', props: ['draft', 'compact'], emits: ['open-materials'],
  setup: (_props, { slots, emit }) => () => Vue.h('section', { class: 'composer-probe' }, [
    Vue.h('button', { onClick: () => emit('open-materials') }, '资料'), slots.materials?.()
  ])
})
const Picker = Vue.defineComponent({
  name: 'PickerProbe', props: { modelValue: Array, disabled: Boolean, dialogOnly: Boolean, identityScope: String }, emits: ['update:modelValue'],
  setup: (_props, { expose }) => {
    const opened = Vue.ref(false)
    expose({ open: () => { opened.value = true } })
    return () => Vue.h('section', { class: 'picker-probe', 'data-open': opened.value })
  }
})
let taskDirectory
const Card = Vue.defineComponent({ props: ['readOnly', 'projection'], emits: ['reply'], render() { return Vue.h('button', { disabled: this.readOnly, onClick: () => this.$emit('reply', this.projection) }, '回答此问') } })
const Panel = new Function('Vue', 'deps', script)(Vue, {
  ...discussionTurnHelpers,
  usePersonalWorkspace: directory, usePersonalWorkspaceTaskLinks: () => (taskDirectory = directory()), usePersonalWorkspaceConversationLinks: directory,
  marked: Object.assign(value => value, { setOptions: () => {} }), DOMPurify: { sanitize: value => value }, HallChatComposer: Composer, HallMaterialPicker: Picker,
  HallMessageParts: { render: () => null }, BountyTextSelectionArchive: { render: () => null },
  HallConversationHistory: { render: () => null }, BountyTypedOutcomeCard: Card, WorkspaceWriteRecovery: { render: () => null }
})

const cardDescriptor = parse(readFileSync(new URL('../src/components/juyiting/BountyTypedOutcomeCard.vue', import.meta.url), 'utf8')).descriptor
const cardScript = compileScript(cardDescriptor, { id: 'terminal-card', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
  .replace('export default', 'return')
const ActualCard = new Function('Vue', 'deps', cardScript)(Vue, { revisionProgressHint: () => '' })

const historyDescriptor = parse(readFileSync(new URL('../src/components/juyiting/HallConversationHistory.vue', import.meta.url), 'utf8')).descriptor
const historyScript = compileScript(historyDescriptor, { id: 'terminal-history', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace('export default', 'return')
const ActualHistory = new Function('Vue', historyScript)(Vue)

describe('formal discussion terminal resource and toolbar layout', () => {
  it('retains history browsing but fences deletion if completion occurs during confirmation', async () => {
    const Dialog = { props: ['show'], emits: ['confirm'], template: '<button class="confirm-delete-probe" @click="$emit(\'confirm\')">confirm</button>' }
    const wrapper = mount(ActualHistory, { props: { conversations: [{ id: 'c1', title: '历史' }] }, global: { stubs: { 'var-dialog': Dialog, 'var-icon': true } } })
    try {
      await wrapper.get('.history-delete').trigger('click')
      await wrapper.setProps({ readOnly: true })
      expect(wrapper.find('.history-delete').exists()).to.equal(false)
      await wrapper.get('.confirm-delete-probe').trigger('click')
      expect(wrapper.emitted('delete')).to.equal(undefined)
      await wrapper.get('.history-item').trigger('click')
      expect(wrapper.emitted('select')).to.deep.equal([['c1']])
    } finally { wrapper.unmount() }
  })

  it('keeps an open historical question truthful and non-actionable after completion', async () => {
    const projection = { outcome: { kind: 'CLARIFY', text: 'clarify', clarification: { state: 'OPEN', question: '何时？' } } }
    const wrapper = mount(ActualCard, { props: { projection, readOnly: true } })
    try {
      expect(wrapper.find('button').exists()).to.equal(false)
      expect(wrapper.text()).to.include('保留历史问题')
      expect(wrapper.text()).not.to.include('已收到补充')
      await wrapper.setProps({ readOnly: false }); await wrapper.get('button').trigger('click')
      expect(wrapper.emitted('reply')).to.deep.equal([[projection]])
    } finally { wrapper.unmount() }
  })
  it('closes materials and cancels voice on completed/cancelled/archived without erasing the parent draft', async () => {
    for (const status of ['completed', 'cancelled', 'archived']) {
      let cancellations = 0
      const wrapper = mount(Panel, { props: {
        discussionVariant: 'bounty', selectedTask: { id: 'task-a', status: 'running' }, draft: '尚未发送的草稿',
        mentionLabel: () => '吴用', senderText: () => '我', voice: { cancel: () => cancellations++ }
      } })
      try {
        expect(wrapper.findComponent(Composer).props('compact')).to.equal(true)
        await wrapper.get('.composer-probe button').trigger('click')
        expect(wrapper.get('.picker-probe').attributes('data-open')).to.equal('true')
        expect(wrapper.getComponent(Picker).props('dialogOnly')).to.equal(true)
        await wrapper.setProps({ selectedTask: { id: 'task-a', status } })
        expect(wrapper.findComponent(Composer).exists()).to.equal(false)
        expect(wrapper.find('.material-reference-picker').exists()).to.equal(false)
        expect(cancellations).to.equal(1)
        expect(wrapper.props('draft')).to.equal('尚未发送的草稿')
        expect(wrapper.emitted('update:draft')).to.equal(undefined)
        await wrapper.setProps({ selectedTask: { id: 'task-b', status: 'running' } })
        expect(wrapper.findComponent(Composer).exists()).to.equal(true)
        expect(wrapper.find('.material-reference-picker').exists()).to.equal(false)
        expect(cancellations).to.equal(1)
      } finally { wrapper.unmount() }
    }
  })
  it('does not treat unknown/pending or a private discussion as a formal terminal state', async () => {
    const wrapper = mount(Panel, { props: { mentionLabel: () => '', senderText: () => '', discussionVariant: 'bounty' } })
    try {
      for (const status of ['open', 'reviewing', 'blocked', 'unknown']) {
        await wrapper.setProps({ selectedTask: { id: 'task', status } })
        expect(wrapper.findComponent(Composer).exists()).to.equal(true)
      }
      await wrapper.setProps({ matterReadOnly: true })
      expect(wrapper.findComponent(Composer).exists()).to.equal(false)
      await wrapper.setProps({ discussionVariant: 'private', selectedTask: { id: 'task', status: 'completed' } })
      expect(wrapper.findComponent(Composer).exists()).to.equal(true)
      expect(wrapper.findComponent(Composer).props('compact')).to.equal(false)
    } finally { wrapper.unmount() }
  })
  it('hides terminal write controls and does not mistake an old cancelled turn for a completed task', async () => {
    const wrapper = mount(Panel, { props: { discussionVariant: 'bounty', selectedTask: { id: 't', status: 'completed' },
      connectionStatus: '已取消', deliberationStatus: 'CHAT · 已取消', eventStreamRecovering: true,
      mentionLabel: () => '', senderText: () => '', messages: [{ localId: 'm', sender: 'AGENT', content: 'question' }],
      typedOutcomes: [{ key: 'p', outcome: { assistantMessageId: 'm' } }] } })
    try {
      expect(wrapper.get('.context-summary em').text()).to.equal('事项已完成')
      expect(wrapper.find('[aria-label="新对话"]').exists()).to.equal(false)
      expect(wrapper.find('.deliberation-status').exists()).to.equal(false)
      expect(wrapper.findComponent(Card).props('readOnly')).to.equal(true)
      wrapper.findComponent(Card).vm.$emit('reply', {})
      expect(wrapper.emitted('typed-reply')).to.equal(undefined)
      expect(wrapper.find('[aria-label="议事记录"]').exists()).to.equal(true)
      await wrapper.setProps({ selectedTask: { id: 'u', status: 'running' }, eventStreamRecovering: false })
      expect(wrapper.find('[aria-label="新对话"]').exists()).to.equal(true)
      expect(wrapper.findComponent(Card).props('readOnly')).to.equal(false)
    } finally { wrapper.unmount() }
  })
  it('adds fixed reference versions through the shared picker even when task materials are empty', async () => {
    const wrapper = mount(Panel, { props: { discussionVariant: 'bounty', selectedTask: { id: 't', status: 'running' }, mentionLabel: () => '', senderText: () => '' } })
    try {
      const attached = []
      taskDirectory.attach = async input => { attached.push(input); return { ...input, state: 'ACTIVE' } }
      await wrapper.get('.composer-probe button').trigger('click')
      const picker = wrapper.getComponent(Picker)
      picker.vm.$emit('update:modelValue', [{ fileId: 'file', version: '3', displayName: '说明.txt' }])
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(attached).to.deep.equal([{ fileId: 'file', version: '3', role: 'REFERENCE' }])
      expect(picker.props('modelValue')).to.deep.equal([])
      expect(wrapper.emitted('send-message')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })
  it('retains failed selections and stops a pending batch after switching tasks', async () => {
    const wrapper = mount(Panel, { props: { discussionVariant: 'bounty', selectedTask: { id: 't', status: 'running' }, mentionLabel: () => '', senderText: () => '' } })
    try {
      taskDirectory.attach = async () => null
      await wrapper.get('.composer-probe button').trigger('click')
      const selections = [{ fileId: 'f1', version: '1' }, { fileId: 'f2', version: '2' }]
      wrapper.getComponent(Picker).vm.$emit('update:modelValue', selections)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(wrapper.getComponent(Picker).props('modelValue')).to.deep.equal(selections)
      let finish; let calls = 0
      taskDirectory.attach = async input => { calls++; await new Promise(resolve => { finish = resolve }); return { ...input, state: 'ACTIVE' } }
      wrapper.getComponent(Picker).vm.$emit('update:modelValue', selections)
      await wrapper.setProps({ selectedTask: { id: 'other', status: 'running' } })
      finish(); await new Promise(resolve => setTimeout(resolve, 0))
      expect(calls).to.equal(1)
      expect(wrapper.getComponent(Picker).props('modelValue')).to.deep.equal([])
      expect(wrapper.getComponent(Picker).props('identityScope')).to.include('other')
      await wrapper.get('.composer-probe button').trigger('click')
      expect(wrapper.getComponent(Picker).props('modelValue')).to.deep.equal([])
    } finally { wrapper.unmount() }
  })
  it('provides an independent matter action slot outside the message/composer areas', () => {
    const wrapper = mount(Panel, { props: { mentionLabel: () => '', senderText: () => '' }, slots: {
      'matter-actions': '<button class="matter-action" aria-label="查看并验收"><svg width="20" height="20"><path d="M4 12l5 5L20 6" /></svg></button>'
    } })
    try {
      expect(wrapper.find('.toolbar-actions .matter-action').exists()).to.equal(true)
      expect(wrapper.find('.hall-messages .matter-action').exists()).to.equal(false)
      expect(wrapper.find('.composer-probe .matter-action').exists()).to.equal(false)
      expect(descriptor.styles[0].content).to.include('.toolbar-actions :deep(.matter-action)')
    } finally { wrapper.unmount() }
  })
})


describe('discussion single reply rendering', () => {
  it('updates one reply through running, archiving and delivery without duplicate typed or delivery rows', async () => {
    const original = { localId: 'reply-1', sender: 'AGENT', agentId: 'agent-1', content: '为你修改图片', statusText: '回话已毕', parts: [] }
    const projection = { key: 'p1', conversationId: '42', outcome: { kind: 'ACTION_REQUEST', assistantMessageId: 'reply-1', taskId: 'task-1' }, actionProgress: { childRequestId: 'child-1', state: 'RUNNING' } }
    const wrapper = mount(Panel, { props: { discussionVariant: 'bounty', selectedTask: { id: 'task-1' }, conversationId: '42',
      mentionLabel: () => '', senderText: () => '吴用', messages: [original], typedOutcomes: [projection] },
      slots: { 'turn-actions': ({ requestIds }) => Vue.h('span', { class: 'turn-action-probe' }, requestIds.join(',')) },
      global: { stubs: { 'var-icon': true } } })
    try {
      expect(wrapper.findAll('.hall-message')).to.have.length(1)
      expect(wrapper.get('.discussion-turn-progress').text()).to.equal('正在处理')
      expect(wrapper.findComponent(Card).exists()).to.equal(false)
      expect(wrapper.find('.message-status').exists()).to.equal(false)
      expect(wrapper.get('.turn-action-probe').text()).to.equal('child-1')
      await wrapper.setProps({ typedOutcomes: [{ ...projection, actionProgress: { ...projection.actionProgress, state: 'ARCHIVING' } }] })
      expect(wrapper.get('.discussion-turn-progress').text()).to.equal('已生成，登记中')
      const delivery = { localId: 'delivery-1', requestId: 'child-1', sender: 'AGENT', agentId: 'agent-1', content: '已生成成果；可预览或下载。', parts: [{ partId: 'part-1', assetId: 'asset-1', revision: '1', kind: 'image', state: 'ready', mime: 'image/png' }] }
      await wrapper.setProps({ messages: [original, delivery], typedOutcomes: [{ ...projection, actionProgress: { ...projection.actionProgress, state: 'COMPLETED' } }] })
      expect(wrapper.findAll('.hall-message')).to.have.length(1)
      expect(wrapper.get('.discussion-turn-progress').text()).to.equal('本轮完成')
      expect(wrapper.text()).not.to.include('可预览或下载')
      expect(original.parts).to.deep.equal([])
      await wrapper.setProps({ conversationId: '43', messages: [], typedOutcomes: [] })
      expect(wrapper.findAll('.hall-message')).to.have.length(0)
      expect(wrapper.find('.turn-action-probe').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })
})
