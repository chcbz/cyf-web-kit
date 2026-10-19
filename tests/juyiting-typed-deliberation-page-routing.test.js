import * as discussionContract from '../src/components/juyiting/discussionPanelContract.js'
import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import * as Vue from 'vue'
import { ref } from 'vue'
import { useHallBountyRequestCatalog } from '../src/composables/juyiting/useHallBountyRequestCatalog.js'
import { useHallBountyAssignmentContext } from '../src/composables/juyiting/useHallBountyAssignmentContext.js'
import { mount } from '@vue/test-utils'
import { useHallConversation as actualHallConversation } from '../src/composables/juyiting/useHallConversation.js'
import { currentChatStreamMock } from './fixtures/current-chat-stream-mock.js'
const useHallConversation = options => actualHallConversation({ ...options, chatApi: currentChatStreamMock(options.chatApi) })
import { compileScript } from '@vue/compiler-sfc'
const require = createRequire(import.meta.url)
const { parse } = require('@vue/compiler-sfc')
const babel = require('@babel/parser')
const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const script = parse(source, { filename: 'JuyiHall.vue' }).descriptor.scriptSetup.content
const program = babel.parse(script, { sourceType: 'module' }).program
const declarations = program.body.flatMap(node => node.declarations || [])
const handler = name => { const node = declarations.find(item => item.id?.name === name); if (!node) throw new Error(`missing ${name}`); return script.slice(node.init.start, node.init.end) }
const option = (callee, name) => {
  let call = declarations.find(item => item.init?.callee?.name === callee)?.init
  if (!call) call = program.body.find(node => node.type === 'ExpressionStatement' && node.expression?.type === 'AssignmentExpression' && node.expression.right?.callee?.name === callee)?.expression.right
  const property = call?.arguments?.[0]?.properties?.find(item => item.key?.name === name)
  if (!property) throw new Error(`missing ${callee}.${name}`)
  return script.slice(property.value.start, property.value.end)
}
const typedReceipt = (requestId = 'request-typed-1', turnId = 'turn-typed-1') => ({ schemaVersion: 3, intent: 'DISCUSSION', requestId, userMessageId: '100', turnIds: [turnId], state: 'ADMITTED', stateVersion: '0', eventCursor: '1', statusUrl: `/chat/requests/${requestId}`, typedOutcomeUrl: `/chat/conversations/7/requests/${requestId}/typed-outcome`, replay: false, pendingQuestionId: null })
const typedRequest = (requestId = 'request-typed-1', turnId = 'turn-typed-1', { state = 'RUNNING', stateVersion = '0', turnState = 'RECEIVED', turnStateVersion = '0', finalMessageId = null } = {}) => ({ requestId, requestRevision: '1', stateVersion, conversationId: '7', conversationGeneration: '1', userMessageId: '100', state, turns: [{ turnId, requestId, requestRevision: '1', stateVersion: turnStateVersion, conversationId: '7', conversationGeneration: '1', targetAgentId: 'agent-1', state: turnState, lastDeltaSeq: '0', finalMessageId }] })
describe('actual JuyiHall typed natural follow-up routing', () => {
  it('routes the one bounty composer through typed DISCUSSION only when the strict default-off flag is enabled', async () => {
    const enabled = ref(true); const draft = ref('画一只鸟'); const calls = []; const typed = { error: ref(''), submit: async body => { calls.push(['typed', body]); return true } }
    const send = async () => { calls.push(['legacy']); return true }
    const actual = new Function('voiceReplyCorrelation', 'hallVoice', 'playSend', 'typedDeliberationEnabled', 'typedDeliberation', 'draft', 'setDraft', 'showToast', 'sendHallMessage', 'typedAssignmentRevision', 'bountyAssignmentContext', `return (${handler('handleSendHallMessage')})`)({ close: () => {} }, { cancel: () => {} }, () => {}, enabled, typed, draft, value => calls.push(['draft', value]), () => {}, send, () => '4', { loading: ref(false), error: ref('') })
    expect(await actual()).to.equal(true)
    expect(calls).to.deep.equal([['typed', { content: '画一只鸟', sourceSelectors: [], materialScope: 'TASK_DEFAULT' }], ['draft', '']])
    enabled.value = false
    expect(await actual()).to.equal(true)
    expect(calls.at(-1)).to.deep.equal(['legacy'])
    enabled.value = true
    await actual({ sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: 'file-1', version: '7', purpose: 'REFERENCE', assetId: null, assetRevision: null }] })
    expect(calls.at(-2)).to.deep.equal(['typed', { content: '画一只鸟', sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: 'file-1', version: '7', purpose: 'REFERENCE', assetId: null, assetRevision: null }], materialScope: 'TASK_DEFAULT' }])
  })
  it('read-only resolves the server binding without an original browser intent and fences identity changes before sending', async () => {
    for (const switchIdentity of [false, true]) {
      const calls = []; const identity = ref('owner-a'); const draft = ref('追加文字')
      const task = ref({ id: '423' }); let revision = ''
      const actual = new Function('voiceReplyCorrelation', 'hallVoice', 'playSend', 'typedDeliberationEnabled',
        'typedDeliberation', 'draft', 'setDraft', 'showToast', 'sendHallMessage', 'typedAssignmentRevision',
        'conversationTask', 'hallIdentityScope', 'apiStore', 'conversationId', 'bountyInteractionTargetId',
        'chatContext', 'bountyAssignmentContext', `return (${handler('handleSendHallMessage')})`)(
        { close() {} }, { cancel() {} }, () => {}, ref(true),
        { error: ref(''), submit: async () => { calls.push('POST'); return true } }, draft,
        () => {}, () => {}, () => { throw new Error('legacy lane forbidden') }, () => revision,
        task, identity, { authorizationGeneration: 1 }, ref('7'), () => 'agent-a', ref({}),
        { error: ref(''), refresh: async () => { calls.push('GET-context'); revision = '1'; if (switchIdentity) identity.value = 'owner-b'; return true } })
      expect(await actual()).to.equal(!switchIdentity)
      expect(calls).to.deep.equal(switchIdentity ? ['GET-context'] : ['GET-context', 'POST'])
    }
  })
  it('does not send or clear the draft when authoritative assignment recovery fails', async () => {
    const calls = []; const draft = ref('识别这张图片')
    const actual = new Function('voiceReplyCorrelation', 'hallVoice', 'playSend', 'typedDeliberationEnabled',
      'typedDeliberation', 'draft', 'setDraft', 'showToast', 'sendHallMessage', 'typedAssignmentRevision',
      'conversationTask', 'hallIdentityScope', 'apiStore', 'conversationId', 'bountyInteractionTargetId',
      'chatContext', 'bountyAssignmentContext', `return (${handler('handleSendHallMessage')})`)(
      { close() {} }, { cancel() {} }, () => {}, ref(true),
      { error: ref(''), submit: async () => calls.push('POST') }, draft,
      () => calls.push('clear'), text => calls.push(text), () => calls.push('legacy'), () => '',
      ref({ id: '450' }), ref('owner'), { authorizationGeneration: 1 }, ref('7'), () => 'wuyong', ref({}),
      { error: ref('指派核对失败'), refresh: async () => false })
    expect(await actual()).to.equal(false); expect(calls).to.deep.equal(['指派核对失败'])
    expect(draft.value).to.equal('识别这张图片')
  })
  it('does not expose a proposal-confirmation or image-preview branch on normal requests', () => {
    expect(() => option('useHallTypedDeliberation', 'onProposal')).to.throw('missing useHallTypedDeliberation.onProposal')
    expect(source).not.to.include('prepareFollowupGenerate')
    expect(source).not.to.include('prepareFollowupEdit')
    expect(source).not.to.include('@typed-confirm-proposal')
  })

  it('evaluates the actual page template expressions to values and forwards selector payload through the mounted bounty panel', async () => {
    const tag = source.match(/<BountyDiscussionPanel\b[\s\S]*?>/)[0]
    const attrs = [...tag.matchAll(/:(typed-[a-z-]+)="([^"]+)"/g)].map(match => `:${match[1]}="${match[2]}"`).join(' ')
    const { compile } = require('@vue/compiler-dom')
    const render = new Function('Vue', compile(`<BountyDiscussionPanel ${attrs} />`, { mode: 'function' }).code)(Vue)
    const vnode = render(Vue.proxyRefs({ typedDeliberation: { cards: ref([{ requestId: 'request-1' }]), selectedPending: ref(null), recoveryAvailable: ref(true), inspectionStatus: ref('') }, typedDeliberationEnabled: ref(true) }), [])
    expect(vnode.props['typed-outcomes']).to.deep.equal([{ requestId: 'request-1' }]); expect(vnode.props['typed-pending-question']).to.equal(null); expect(vnode.props['typed-recovery-available']).to.equal(true)
    const panelFile = fileURLToPath(new URL('../src/components/juyiting/BountyDiscussionPanel.vue', import.meta.url))
    const panelDescriptor = parse(readFileSync(panelFile, 'utf8'), { filename: panelFile }).descriptor
    const panelCode = compileScript(panelDescriptor, { id: 'typed-panel-forward', inlineTemplate: true }).content
      .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
      .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, name) => name === 'ChatPanel' ? 'var ChatPanel = deps.ChatPanel' : `var ${name} = { template: '<span />' }`)
      .replace(/^import\s+\{\s*bountyDeliberationPresentation\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { bountyDeliberationPresentation } = deps')
      .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/discussionPanelContract\.js['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
      .replace('export default', 'return')
    const ChatPanel = { emits: ['send-message'], render () { return Vue.h('button', { class: 'emit-send', onClick: () => this.$emit('send-message', { sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION' }] }) }) } }
    const Panel = new Function('Vue', 'deps', panelCode)(Vue, { ...discussionContract, ChatPanel, bountyDeliberationPresentation: () => ({}) })
    const previous = new Map()
    for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) { if (globalThis[name]) continue; previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true }) }
    const wrapper = mount(Panel, { props: { mentionLabel: () => '', senderText: () => '', typedEnabled: true } })
    try {
      await wrapper.find('.emit-send').trigger('click')
      expect(wrapper.emitted('send-message')).to.deep.equal([[{ sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION' }] }]])
    } finally {
      wrapper.unmount()
      for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }
    }
  })

  it('adopts an actual RUNNING request and RECEIVED turn after its immutable ADMITTED receipt without another POST', async () => {
    const calls = []; const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1', mode: 'bounty', participantAgentIds: ['agent-1'], targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
    const selectedTask = ref({ id: 'task-1' }); const selectedAgent = ref({ agentId: 'agent-1', name: '吴用' })
    const requestView = typedRequest()
    const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
      chatApi: { list: async (_path, _body, options) => { calls.push('LIST'); options.onSuccess({ items: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1' }], nextCursor: null, hasMore: false }) },
        getById: async (_path, id, options) => { calls.push(`CONTENT:${id}`); options.onSuccess(([{ id: 'message-user-1', senderType: 'user', content: '请画一只鸟' }])) },
        get: async path => { calls.push(`GET:${path}`); return ((requestView)) },
        create: async () => { calls.push('POST'); throw new Error('must not post') } },
      globalStore: { getJiacn: 'owner', user: {} }, log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}), portraitShortName: agent => agent?.name || '', selectedAgent, selectedTask, showToast: () => {} })
    try {
      expect(await conversation.loadHallMessages()).to.equal(true)
      const pageAccepted = new Function('adoptTypedDiscussionReceipt', 'bountyRequestCatalog', 'showToast', `return (${option('useHallTypedDeliberation', 'onAccepted')})`)(conversation.adoptTypedDiscussionReceipt, { hint: () => calls.push('HINT') }, text => calls.push(`TOAST:${text}`))
      expect(await pageAccepted({ receipt: typedReceipt(), context: { conversationId: '7', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4', conversationGeneration: '1' }, isCurrent: () => true })).to.equal(true)
      expect(conversation.activeRequest.value).to.include({ requestId: 'request-typed-1', state: 'RUNNING', stateVersion: '0' })
      expect(conversation.activeTurns.value[0]).to.include({ turnId: 'turn-typed-1', state: 'RECEIVED', stateVersion: '0' })
      expect(conversation.messages.value.map(message => message.localId)).to.deep.equal(['message-user-1'])
      expect(calls.filter(call => call === 'POST')).to.deep.equal([])
      expect(calls.filter(call => call === 'GET:/requests/request-typed-1')).to.have.length(1)
      expect(calls.filter(call => call === 'CONTENT:7')).to.have.length(2)
      expect(calls).to.include('HINT')
    } finally { conversation.disposeHallConversation() }
  })
  it('adopts the active discussion transcript with no selected agent and a different browsed task', async () => {
    const calls = []; const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1', mode: 'bounty', participantAgentIds: ['agent-1'], targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
    const selectedTask = ref({ id: 'other-browsed-task' }); const selectedAgent = ref(null)
    const requestView = typedRequest()
    const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
      chatApi: { list: async (_path, _body, options) => { calls.push('LIST'); options.onSuccess({ items: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1' }], nextCursor: null, hasMore: false }) },
        getById: async (_path, id, options) => { calls.push(`CONTENT:${id}`); options.onSuccess(([{ id: 'message-user-1', senderType: 'user', content: '请画一只鸟' }])) },
        get: async path => { calls.push(`GET:${path}`); return ((requestView)) },
        create: async () => { calls.push('POST'); throw new Error('must not post') } },
      globalStore: { getJiacn: 'owner', user: {} }, log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}), portraitShortName: agent => agent?.name || '', selectedAgent, selectedTask, showToast: () => {} })
    try {
      expect(await conversation.loadHallMessages()).to.equal(true)
      const pageAccepted = new Function('adoptTypedDiscussionReceipt', 'bountyRequestCatalog', 'showToast', `return (${option('useHallTypedDeliberation', 'onAccepted')})`)(conversation.adoptTypedDiscussionReceipt, { hint: () => calls.push('HINT') }, text => calls.push(`TOAST:${text}`))
      expect(await pageAccepted({ receipt: typedReceipt(), context: { conversationId: '7', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4', conversationGeneration: '1' }, isCurrent: () => true })).to.equal(true)
      expect(conversation.activeRequest.value).to.include({ requestId: 'request-typed-1', state: 'RUNNING', stateVersion: '0' })
      expect(conversation.activeTurns.value[0]).to.include({ turnId: 'turn-typed-1', state: 'RECEIVED', stateVersion: '0' })
      expect(conversation.messages.value.map(message => message.localId)).to.deep.equal(['message-user-1'])
      expect(calls.filter(call => call === 'POST')).to.deep.equal([])
      expect(calls.filter(call => call === 'GET:/requests/request-typed-1')).to.have.length(1)
      expect(calls.filter(call => call === 'CONTENT:7')).to.have.length(2)
      expect(calls).to.include('HINT')
    } finally { conversation.disposeHallConversation() }
  })
  it('keeps the actual page follow-up fence current while adopting the first same-generation request', async () => {
    const calls = []; const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1', mode: 'bounty', participantAgentIds: ['agent-1'], targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
    const selectedTask = ref({ id: 'task-1' }); const selectedAgent = ref({ agentId: 'agent-1', name: '吴用' })
    const requestView = typedRequest()
    const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
      chatApi: { list: async (_path, _body, options) => { calls.push('LIST'); options.onSuccess({ items: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1' }], nextCursor: null, hasMore: false }) },
        getById: async (_path, id, options) => { calls.push(`CONTENT:${id}`); options.onSuccess(([{ id: 'message-user-1', senderType: 'user', content: '请画一只鸟' }])) },
        get: async path => { calls.push(`GET:${path}`); return ((requestView)) },
        create: async () => { calls.push('POST'); throw new Error('must not post') } },
      globalStore: { getJiacn: 'owner', user: {} }, log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}), portraitShortName: agent => agent?.name || '', selectedAgent, selectedTask, showToast: () => {} })
    let stopFence
    try {
      expect(await conversation.loadHallMessages()).to.equal(true)
      const apiStore = Vue.reactive({ authorizationGeneration: 1 })
      const hallIdentityScope = ref('owner'); const chatMode = ref('bounty')
      const followupContextGeneration = ref(0); const conversationTask = ref({ id: 'task-1', taskVersion: '1' })
      const recoveries = []; const typedDeliberation = { invalidate() { recoveries.push('INVALIDATE') }, recover: async () => { recoveries.push('RECOVER'); return true } }
      const env = { computed: Vue.computed, watch: Vue.watch, conversationTask, apiStore, hallIdentityScope,
        conversationId: conversation.conversationId, activeRequest: conversation.activeRequest,
        bountyInteractionTargetId: () => 'agent-1', chatContext, chatMode, followupContextGeneration,
        typedDeliberation, typedDeliberationEnabled: ref(true), typedLong: value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? value : null }
      const evaluate = text => new Function(...Object.keys(env), `return (${text})`)(...Object.values(env))
      const binding = { schemaVersion: 1, conversationId: '7', conversationGeneration: '1', taskId: 'task-1', targetAgentId: 'agent-1', taskVersion: '1', assignmentRevision: '4', baselineGrantVersion: '1', requirementRevision: '1' }
      env.bountyAssignmentContext = useHallBountyAssignmentContext({ chatApi: { get: async () => binding }, identityScope: hallIdentityScope,
        authorizationGeneration: () => apiStore.authorizationGeneration, getContext: evaluate(option('useHallBountyAssignmentContext', 'getContext')), enabled: () => true })
      expect(await env.bountyAssignmentContext.refresh()).to.equal(true)
      env.typedAssignmentRevision = evaluate(handler('typedAssignmentRevision'))
      env.typedConversationGeneration = evaluate(handler('typedConversationGeneration'))
      env.bountyRequestCatalog = useHallBountyRequestCatalog({ chatApi: { get: async () => ({ schemaVersion: 1,
        scope: { conversationId: '7', conversationGeneration: '1', taskId: 'task-1' }, after: '0', through: '0', nextAfter: null, hasMore: false, entries: [] }) },
        identityScope: hallIdentityScope, authorizationGeneration: () => apiStore.authorizationGeneration,
        getContext: evaluate(option('useHallBountyRequestCatalog', 'getContext')),
        getContextGeneration: () => followupContextGeneration.value, enabled: () => true })
      env.invalidateFollowupContext = evaluate(handler('invalidateFollowupContext'))
      env.followupTaskFence = evaluate(handler('followupTaskFence'))
      env.refreshFollowupContext = evaluate(handler('refreshFollowupContext'))
      env.resetFollowupContext = evaluate(handler('resetFollowupContext'))
      const watchers = program.body.filter(node => node.type === 'ExpressionStatement' && node.expression?.callee?.name === 'watch' &&
        script.slice(node.expression.start, node.expression.end).includes('resetFollowupContext'))
      const stops = watchers.map(node => evaluate(script.slice(node.expression.start, node.expression.end)))
      stopFence = () => { stops.forEach(stop => stop()); env.bountyAssignmentContext.dispose(); env.bountyRequestCatalog.dispose() }
      const originalGeneration = followupContextGeneration.value
      const pageAccepted = new Function('adoptTypedDiscussionReceipt', 'bountyRequestCatalog', 'showToast', `return (${option('useHallTypedDeliberation', 'onAccepted')})`)(conversation.adoptTypedDiscussionReceipt, { hint: () => calls.push('HINT') }, text => calls.push(`TOAST:${text}`))
      expect(await pageAccepted({ receipt: typedReceipt(), context: { conversationId: '7', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4', conversationGeneration: '1' }, isCurrent: () => followupContextGeneration.value === originalGeneration })).to.equal(true)
      expect(conversation.activeRequest.value).to.include({ requestId: 'request-typed-1', state: 'RUNNING', stateVersion: '0' })
      expect(conversation.activeTurns.value[0]).to.include({ turnId: 'turn-typed-1', state: 'RECEIVED', stateVersion: '0' })
      expect(conversation.messages.value.map(message => message.localId)).to.deep.equal(['message-user-1'])
      expect(calls.filter(call => call === 'POST')).to.deep.equal([])
      expect(calls.filter(call => call === 'GET:/requests/request-typed-1')).to.have.length(1)
      expect(calls.filter(call => call === 'CONTENT:7')).to.have.length(2)
      expect(env.bountyAssignmentContext.projection.value).to.deep.equal(binding)
      expect(recoveries).to.deep.equal([])
      expect(calls).to.include('HINT')
      // Refreshing the same verified binding must not briefly remove context or
      // abort the real request directory/typed consumer capture.
      const assignment = evaluate(handler('typedAssignmentRevision'))
      const generation = evaluate(handler('typedConversationGeneration'))
      const sameRefresh = env.bountyAssignmentContext.refresh()
      expect(assignment()).to.equal('4'); expect(generation()).to.equal('1')
      expect(await sameRefresh).to.equal(true)
      expect(recoveries).to.deep.equal([])
      expect(await env.bountyRequestCatalog.refresh()).to.equal(true)
      // Browsing another task is not a discussion switch.
      selectedTask.value = { id: 'other-task', taskVersion: '99' }
      expect(followupContextGeneration.value).to.equal(originalGeneration)
      conversationTask.value = { id: 'task-1', taskVersion: '2' }
      expect(followupContextGeneration.value).to.equal(originalGeneration + 1)
      expect(recoveries[0]).to.equal('INVALIDATE')
      expect(env.bountyAssignmentContext.projection.value).to.equal(null)
    } finally { stopFence?.(); conversation.disposeHallConversation() }
  })
  it('adopts an already COMPLETED request and FINAL_PERSISTED turn for the same immutable receipt without another POST', async () => {
    const calls = []; const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1', mode: 'bounty', participantAgentIds: ['agent-1'], targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
    const requestView = typedRequest('request-typed-final', 'turn-typed-final', { state: 'COMPLETED', stateVersion: '1', turnState: 'FINAL_PERSISTED', turnStateVersion: '3', finalMessageId: '101' })
    const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
      chatApi: { list: async (_path, _body, options) => options.onSuccess({ items: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1' }], nextCursor: null, hasMore: false }),
        getById: async (_path, id, options) => { calls.push(`CONTENT:${id}`); options.onSuccess(([])) }, get: async path => { calls.push(`GET:${path}`); return ((requestView)) }, create: async () => { calls.push('POST'); throw new Error('must not post') } },
      globalStore: { getJiacn: 'owner', user: {} }, log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}), portraitShortName: agent => agent?.name || '', selectedAgent: ref({ agentId: 'agent-1', name: '吴用' }), selectedTask: ref({ id: 'task-1' }), showToast: () => {} })
    try {
      expect(await conversation.loadHallMessages()).to.equal(true)
      expect(await conversation.adoptTypedDiscussionReceipt({ receipt: typedReceipt('request-typed-final', 'turn-typed-final'), context: { conversationId: '7', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4', conversationGeneration: '1' } })).to.equal(true)
      expect(conversation.activeRequest.value).to.include({ requestId: 'request-typed-final', state: 'COMPLETED', stateVersion: '1' })
      expect(conversation.activeTurns.value[0]).to.include({ turnId: 'turn-typed-final', state: 'FINAL_PERSISTED', stateVersion: '3', finalMessageId: '101' })
      expect(calls.filter(call => call === 'GET:/requests/request-typed-final')).to.have.length(1)
      expect(calls.filter(call => call === 'POST')).to.deep.equal([])
    } finally { conversation.disposeHallConversation() }
  })
  it('rejects a late lower-version typed readback without downgrading the newer terminal request or reading content again', async () => {
    const calls = []; let requestView = typedRequest('request-typed-progress', 'turn-typed-progress', { state: 'COMPLETED', stateVersion: '2', turnState: 'FINAL_PERSISTED', turnStateVersion: '4', finalMessageId: '101' })
    const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1', mode: 'bounty', participantAgentIds: ['agent-1'], targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
    const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
      chatApi: { list: async (_path, _body, options) => options.onSuccess({ items: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1' }], nextCursor: null, hasMore: false }),
        getById: async (_path, id, options) => { calls.push(`CONTENT:${id}`); options.onSuccess(([])) }, get: async path => { calls.push(`GET:${path}`); return ((requestView)) }, create: async () => { calls.push('POST'); throw new Error('must not post') } },
      globalStore: { getJiacn: 'owner', user: {} }, log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}), portraitShortName: agent => agent?.name || '', selectedAgent: ref({ agentId: 'agent-1', name: '吴用' }), selectedTask: ref({ id: 'task-1' }), showToast: () => {} })
    const receipt = typedReceipt('request-typed-progress', 'turn-typed-progress')
    const context = { conversationId: '7', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4', conversationGeneration: '1' }
    try {
      expect(await conversation.loadHallMessages()).to.equal(true)
      expect(await conversation.adoptTypedDiscussionReceipt({ receipt, context })).to.equal(true)
      const contentReadsAfterTerminal = calls.filter(call => call === 'CONTENT:7').length
      requestView = typedRequest('request-typed-progress', 'turn-typed-progress', { state: 'RUNNING', stateVersion: '1', turnState: 'RECEIVED', turnStateVersion: '1' })
      expect(await conversation.adoptTypedDiscussionReceipt({ receipt, context })).to.equal(false)
      expect(conversation.activeRequest.value).to.include({ requestId: 'request-typed-progress', state: 'COMPLETED', stateVersion: '2' })
      expect(conversation.activeTurns.value[0]).to.include({ turnId: 'turn-typed-progress', state: 'FINAL_PERSISTED', stateVersion: '4', finalMessageId: '101' })
      expect(calls.filter(call => call === 'CONTENT:7')).to.have.length(contentReadsAfterTerminal)
      expect(calls.filter(call => call === 'POST')).to.deep.equal([])
    } finally { conversation.disposeHallConversation() }
  })
  it('fences a late authoritative typed receipt read after target drift without content adoption or POST', async () => {
    let resolveRequest; let contentReads = 0; let posts = 0
    const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1', mode: 'bounty', participantAgentIds: ['agent-1'], targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
    const selectedTask = ref({ id: 'task-1' }); const selectedAgent = ref({ agentId: 'agent-1', name: '吴用' })
    const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
      chatApi: { list: async (_path, _body, options) => options.onSuccess({ items: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1' }], nextCursor: null, hasMore: false }),
        getById: async (_path, _id, options) => { contentReads++; options.onSuccess(([])) },
        get: () => new Promise(resolve => { resolveRequest = resolve }), create: async () => { posts++; throw new Error('unexpected') } },
      globalStore: { getJiacn: 'owner', user: {} }, log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}), portraitShortName: agent => agent?.name || '', selectedAgent, selectedTask, showToast: () => {} })
    try {
      expect(await conversation.loadHallMessages()).to.equal(true)
      const pending = conversation.adoptTypedDiscussionReceipt({ receipt: typedReceipt('request-typed-late', 'turn-typed-late'), context: { conversationId: '7', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4', conversationGeneration: '1' }, isCurrent: () => true })
      chatContext.value = { ...chatContext.value, targetAgentIds: ['agent-2'], participantAgentIds: ['agent-2'], targetAgentId: 'agent-2' }
      resolveRequest(((typedRequest('request-typed-late', 'turn-typed-late'))))
      expect(await pending).to.equal(false)
      expect(conversation.activeRequest.value).to.equal(null)
      expect(contentReads).to.equal(1); expect(posts).to.equal(0)
    } finally { conversation.disposeHallConversation() }
  })
  it('rejects every mismatched typed receipt readback before state or transcript adoption', async () => {
    const mutations = [
      view => { view.userMessageId = '999' },
      view => { view.turns[0].turnId = 'foreign-turn' },
      view => { view.conversationGeneration = '2'; view.turns[0].conversationGeneration = '2' },
      view => { view.turns[0].targetAgentId = 'agent-foreign' },
      view => { view.turns[0].conversationId = '77' },
      view => { delete view.requestRevision }
    ]
    for (const mutate of mutations) {
      let contentReads = 0; let posts = 0; const requestView = typedRequest(); mutate(requestView)
      const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1', mode: 'bounty', participantAgentIds: ['agent-1'], targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
      const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
        chatApi: { list: async (_path, _body, options) => options.onSuccess({ items: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1' }], nextCursor: null, hasMore: false }),
          getById: async (_path, _id, options) => { contentReads++; options.onSuccess(([])) }, get: async () => (((requestView))), create: async () => { posts++; throw new Error('unexpected') } },
        globalStore: { getJiacn: 'owner', user: {} }, log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}), portraitShortName: agent => agent?.name || '', selectedAgent: ref({ agentId: 'agent-1', name: '吴用' }), selectedTask: ref({ id: 'task-1' }), showToast: () => {} })
      try {
        expect(await conversation.loadHallMessages()).to.equal(true)
        contentReads = 0
        expect(await conversation.adoptTypedDiscussionReceipt({ receipt: typedReceipt(), context: { conversationId: '7', conversationGeneration: '1', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4' } })).to.equal(false)
        expect(conversation.activeRequest.value).to.equal(null); expect(contentReads).to.equal(0); expect(posts).to.equal(0)
      } finally { conversation.disposeHallConversation() }
    }
  })
  it('rejects an admission-domain request, non-one status revision, and nonzero receipt version before state or content adoption', async () => {
    const scenarios = [
      { name: 'ADMITTED request state', mutateRequest: view => { view.state = 'ADMITTED' } },
      { name: 'non-one request revision', mutateRequest: view => { view.requestRevision = '2'; view.turns[0].requestRevision = '2' } },
      { name: 'nonzero receipt state version', mutateReceipt: value => { value.stateVersion = '1' } }
    ]
    for (const scenario of scenarios) {
      let contentReads = 0; let posts = 0; const requestView = typedRequest(); const receipt = typedReceipt()
      scenario.mutateRequest?.(requestView); scenario.mutateReceipt?.(receipt)
      const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1', mode: 'bounty', participantAgentIds: ['agent-1'], targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
      const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
        chatApi: { list: async (_path, _body, options) => options.onSuccess({ items: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1' }], nextCursor: null, hasMore: false }),
          getById: async (_path, _id, options) => { contentReads++; options.onSuccess(([])) }, get: async () => (((requestView))), create: async () => { posts++; throw new Error('unexpected') } },
        globalStore: { getJiacn: 'owner', user: {} }, log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}), portraitShortName: agent => agent?.name || '', selectedAgent: ref({ agentId: 'agent-1', name: '吴用' }), selectedTask: ref({ id: 'task-1' }), showToast: () => {} })
      try {
        expect(await conversation.loadHallMessages(), scenario.name).to.equal(true)
        contentReads = 0
        expect(await conversation.adoptTypedDiscussionReceipt({ receipt, context: { conversationId: '7', conversationGeneration: '1', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4' } }), scenario.name).to.equal(false)
        expect(conversation.activeRequest.value, scenario.name).to.equal(null); expect(contentReads, scenario.name).to.equal(0); expect(posts, scenario.name).to.equal(0)
      } finally { conversation.disposeHallConversation() }
    }
  })
  it('binds a real durable final event only to authoritative typed GET readback', async () => {
    const calls = []
    const callback = new Function('typedDeliberation', `return (${option('useHallConversation', 'onTypedOutcome')})`)({ readOne: value => calls.push(value) })
    callback({ requestId: 'request-1' }); callback({})
    expect(calls).to.deep.equal(['request-1'])
  })
})
