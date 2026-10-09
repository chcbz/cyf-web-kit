import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as discussionContract from '../src/components/juyiting/discussionPanelContract.js'
import { bountyDeliberationPresentation } from '../src/composables/juyiting/hallMultimediaDeliberationUi.js'

const ChatProbe = Vue.defineComponent({
  name: 'ChatProbe',
  props: [...Object.keys(discussionContract.discussionPanelProps), 'identityScope', 'typedOutcomes', 'typedPendingQuestion', 'typedEnabled'],
  emits: [...discussionContract.discussionPanelEmits, 'typed-reply'],
  setup: (_props, { slots }) => () => Vue.h('div', {}, slots['bounty-results']?.())
})
const loadPanel = name => {
  const filename = new URL(`../src/components/juyiting/${name}.vue`, import.meta.url).pathname
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: name, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, name) => `var ${name} = deps.${name}`)
    .replace('export default', 'return')
  return new Function('Vue', 'deps', script)(Vue, {
    ...discussionContract, bountyDeliberationPresentation, ChatPanel: ChatProbe,
    BountyDeliberationStatus: { render: () => null },
    BountyExecutionTermination: { render: () => null }, BountyExecutionOutputs: { render: () => null }
  })
}
const functions = { mentionLabel: agent => agent.name, senderText: message => message.sender }

describe('discussion panel shared bindings', () => {
  const installed = []
  before(() => {
    for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) if (!globalThis[name]) {
      installed.push(name); Object.defineProperty(globalThis, name, { value: window[name], configurable: true })
    }
  })
  after(() => { for (const name of installed) delete globalThis[name] })

  for (const [name, variant] of [['PublicDiscussionPanel', 'public'], ['PrivateDiscussionPanel', 'private'], ['BountyDiscussionPanel', 'bounty']]) {
    it(`${variant}: preserves defaults, reactive inputs and exact single event forwarding`, async () => {
      const wrapper = mount(loadPanel(name), { props: functions })
      try {
        const chat = wrapper.findComponent(ChatProbe)
        expect(chat.props('draft')).to.equal('')
        expect(chat.props('conversationBusy')).to.equal(false)
        expect(chat.props('targetText')).to.equal(variant === 'public' ? '众好汉' : '')
        expect(chat.props('scopeHint')).to.equal(variant === 'public' ? 'public' : '')
        expect(chat.props('voice')).to.equal(null)
        expect(chat.props('agents')).to.deep.equal([])
        expect(chat.attributes('discussion-variant')).to.equal(variant)
        const values = {
          agents: [{ agentId: 'a', name: '吴用' }], connectionStatus: '同步中',
          conversationHistory: [{ id: '101' }], conversationHistoryDeletingId: '102', conversationHistoryError: 'history error',
          conversationHistoryHasMore: true, conversationHistoryLoading: true, conversationLoadError: 'load error',
          conversationBusy: true, deliberationStatus: '等待回话', durableCancelTarget: { turnId: 'turn-a' },
          conversationId: '101', identityEpoch: 9, draft: '保持原草稿', eventStreamRecovering: true,
          isAwaitingReply: true, isStreaming: true, messages: [{ content: '一条消息' }], pendingAgentName: '吴用',
          selectedAgent: { agentId: 'a' }, selectedTask: { id: 'task-1', title: '核对榜文' },
          scopeHint: 'task:task-1', targetText: '吴用', voice: { state: 'review' }, ...functions
        }
        await wrapper.setProps(values)
        for (const [key, value] of Object.entries(values)) expect(chat.props(key), key).to.deep.equal(value)
        if (variant === 'private') expect(chat.attributes('subtitle')).to.equal('吴用 / 核对榜文')
        if (variant === 'bounty') expect(chat.attributes('subtitle')).to.equal('核对榜文 / 1 位领令好汉')
        for (const event of ['cancel-deliberation', 'clear-target', 'delete-conversation', 'mention-agent', 'select-conversation', 'voice-apply']) {
          const payload = { exact: event }
          chat.vm.$emit(event, payload)
          expect(wrapper.emitted(event)).to.deep.equal([[payload]])
          expect(wrapper.emitted(event)[0][0]).to.equal(payload)
        }
        for (const event of ['load-history', 'load-more-history', 'load-messages', 'new-conversation', 'open-workspace', 'retry-conversation']) {
          chat.vm.$emit(event)
          expect(wrapper.emitted(event)).to.deep.equal([[]])
        }
        chat.vm.$emit('update:draft', '编辑后')
        expect(wrapper.emitted('update:draft')).to.deep.equal([['编辑后']])
        expect(wrapper.props('draft')).to.equal('保持原草稿')
        const send = { sourceSelectors: [{ id: 'source-1' }] }
        chat.vm.$emit('send-message', send)
        expect(wrapper.emitted('send-message')).to.deep.equal(variant === 'bounty' ? [[send]] : [[]])
        await wrapper.setProps({ draft: '编辑后', conversationBusy: false, identityEpoch: 10, voice: null })
        expect(chat.props('draft')).to.equal('编辑后')
        expect(chat.props('conversationBusy')).to.equal(false)
        expect(chat.props('identityEpoch')).to.equal(10)
        expect(chat.props('voice')).to.equal(null)
      } finally { wrapper.unmount() }
    })
  }

  it('keeps bounty-only state local while forwarding typed chat inputs and recovery actions', async () => {
    const wrapper = mount(loadPanel('BountyDiscussionPanel'), { props: {
      ...functions, activeRequest: { requestId: 'request-1', state: 'RUNNING' }, activeTurns: [], requestCatalog: [],
      capabilityState: { v2: true }, deliberationV2Enabled: false, typedRecoveryAvailable: true,
      typedInspectionStatus: '读取资料中', typedEnabled: true, identityScope: 'tenant/client/owner',
      typedOutcomes: [{ requestId: 'request-1' }], typedPendingQuestion: { questionId: 'question-1' }
    } })
    try {
      const chat = wrapper.findComponent(ChatProbe)
      expect(chat.props('typedEnabled')).to.equal(true)
      expect(chat.props('typedOutcomes')).to.deep.equal([{ requestId: 'request-1' }])
      expect(chat.props('typedPendingQuestion')).to.deep.equal({ questionId: 'question-1' })
      expect(chat.props('identityScope')).to.equal('tenant/client/owner')
      for (const key of ['activeRequest', 'activeTurns', 'requestCatalog', 'capabilityState', 'deliberationV2Enabled', 'typedRecoveryAvailable', 'typedInspectionStatus']) {
        expect(chat.vm.$attrs).not.to.have.property(key)
      }
      expect(wrapper.find('[role="status"]').text()).to.equal('读取资料中')
      await wrapper.find('.typed-recovery').trigger('click')
      expect(wrapper.emitted('typed-resume')).to.deep.equal([[]])
      const reply = { questionId: 'question-1', answer: '确认' }
      chat.vm.$emit('typed-reply', reply)
      expect(wrapper.emitted('typed-reply')).to.deep.equal([[reply]])
    } finally { wrapper.unmount() }
  })
})
