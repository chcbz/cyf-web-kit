import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import * as Vue from 'vue'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'
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
const typedReceipt = (requestId = 'request-typed-1', turnId = 'turn-typed-1') => ({ schemaVersion: 1, intent: 'DISCUSSION', requestId, userMessageId: '100', turnIds: [turnId], state: 'ADMITTED', stateVersion: '0', eventCursor: '1', statusUrl: `/chat/requests/${requestId}`, typedOutcomeUrl: `/chat/conversations/7/requests/${requestId}/typed-outcome`, replay: false, pendingQuestionId: null })
const typedRequest = (requestId = 'request-typed-1', turnId = 'turn-typed-1', { state = 'RUNNING', stateVersion = '0', turnState = 'RECEIVED', turnStateVersion = '0', finalMessageId = null } = {}) => ({ requestId, requestRevision: '1', stateVersion, conversationId: '7', conversationGeneration: '1', userMessageId: '100', state, turns: [{ turnId, requestId, requestRevision: '1', stateVersion: turnStateVersion, conversationId: '7', conversationGeneration: '1', targetAgentId: 'agent-1', state: turnState, lastDeltaSeq: '0', finalMessageId }] })
describe('actual JuyiHall typed natural follow-up routing', () => {
  it('routes the one bounty composer through typed DISCUSSION only when the strict default-off flag is enabled', async () => {
    const enabled = ref(true); const draft = ref('画一只鸟'); const calls = []; const typed = { error: ref(''), submit: async body => { calls.push(['typed', body]); return true } }
    const send = async () => { calls.push(['legacy']); return true }
    const actual = new Function('voiceReplyCorrelation', 'hallVoice', 'playSend', 'typedDeliberationEnabled', 'typedDeliberation', 'draft', 'setDraft', 'showToast', 'sendHallMessage', `return (${handler('handleSendHallMessage')})`)({ close: () => {} }, { cancel: () => {} }, () => {}, enabled, typed, draft, value => calls.push(['draft', value]), () => {}, send)
    expect(await actual()).to.equal(true)
    expect(calls).to.deep.equal([['typed', { content: '画一只鸟', sourceSelectors: [] }], ['draft', '']])
    enabled.value = false
    expect(await actual()).to.equal(true)
    expect(calls.at(-1)).to.deep.equal(['legacy'])
    enabled.value = true
    await actual({ sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: 'file-1', version: '7', purpose: 'REFERENCE', assetId: null, assetRevision: null }] })
    expect(calls.at(-2)).to.deep.equal(['typed', { content: '画一只鸟', sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: 'file-1', version: '7', purpose: 'REFERENCE', assetId: null, assetRevision: null }] }])
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
      .replace('export default', 'return')
    const ChatPanel = { emits: ['send-message'], render () { return Vue.h('button', { class: 'emit-send', onClick: () => this.$emit('send-message', { sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION' }] }) }) } }
    const Panel = new Function('Vue', 'deps', panelCode)(Vue, { ChatPanel, bountyDeliberationPresentation: () => ({}) })
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
    const calls = []; const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task-1', mode: 'bounty', targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
    const selectedTask = ref({ id: 'task-1' }); const selectedAgent = ref({ agentId: 'agent-1', name: '吴用' })
    const requestView = typedRequest()
    const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
      chatApi: { list: async (_path, _body, options) => { calls.push('LIST'); options.onSuccess({ data: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task-1' }] }) },
        getById: async (_path, id, options) => { calls.push(`CONTENT:${id}`); options.onSuccess({ data: [{ id: 'message-user-1', senderType: 'user', content: '请画一只鸟' }] }) },
        get: async path => { calls.push(`GET:${path}`); return { data: { data: requestView } } },
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
  it('adopts an already COMPLETED request and FINAL_PERSISTED turn for the same immutable receipt without another POST', async () => {
    const calls = []; const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task-1', mode: 'bounty', targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
    const requestView = typedRequest('request-typed-final', 'turn-typed-final', { state: 'COMPLETED', stateVersion: '1', turnState: 'FINAL_PERSISTED', turnStateVersion: '3', finalMessageId: '101' })
    const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
      chatApi: { list: async (_path, _body, options) => options.onSuccess({ data: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task-1' }] }),
        getById: async (_path, id, options) => { calls.push(`CONTENT:${id}`); options.onSuccess({ data: [] }) }, get: async path => { calls.push(`GET:${path}`); return { data: { data: requestView } } }, create: async () => { calls.push('POST'); throw new Error('must not post') } },
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
    const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task-1', mode: 'bounty', targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
    const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
      chatApi: { list: async (_path, _body, options) => options.onSuccess({ data: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task-1' }] }),
        getById: async (_path, id, options) => { calls.push(`CONTENT:${id}`); options.onSuccess({ data: [] }) }, get: async path => { calls.push(`GET:${path}`); return { data: { data: requestView } } }, create: async () => { calls.push('POST'); throw new Error('must not post') } },
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
    const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task-1', mode: 'bounty', targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
    const selectedTask = ref({ id: 'task-1' }); const selectedAgent = ref({ agentId: 'agent-1', name: '吴用' })
    const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
      chatApi: { list: async (_path, _body, options) => options.onSuccess({ data: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task-1' }] }),
        getById: async (_path, _id, options) => { contentReads++; options.onSuccess({ data: [] }) },
        get: () => new Promise(resolve => { resolveRequest = resolve }), create: async () => { posts++; throw new Error('unexpected') } },
      globalStore: { getJiacn: 'owner', user: {} }, log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}), portraitShortName: agent => agent?.name || '', selectedAgent, selectedTask, showToast: () => {} })
    try {
      expect(await conversation.loadHallMessages()).to.equal(true)
      const pending = conversation.adoptTypedDiscussionReceipt({ receipt: typedReceipt('request-typed-late', 'turn-typed-late'), context: { conversationId: '7', taskId: 'task-1', targetAgentId: 'agent-1', assignmentRevision: '4', conversationGeneration: '1' }, isCurrent: () => true })
      selectedAgent.value = { agentId: 'agent-2', name: '公孙胜' }
      resolveRequest({ data: { data: typedRequest('request-typed-late', 'turn-typed-late') } })
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
      const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task-1', mode: 'bounty', targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
      const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
        chatApi: { list: async (_path, _body, options) => options.onSuccess({ data: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task-1' }] }),
          getById: async (_path, _id, options) => { contentReads++; options.onSuccess({ data: [] }) }, get: async () => ({ data: { data: requestView } }), create: async () => { posts++; throw new Error('unexpected') } },
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
      const chatContext = ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task-1', mode: 'bounty', targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', taskId: 'task-1' })
      const conversation = useHallConversation({ apiStore: { authorizationGeneration: 1, token: async () => null }, chatContext, chatMode: ref('bounty'),
        chatApi: { list: async (_path, _body, options) => options.onSuccess({ data: [{ id: '7', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task-1' }] }),
          getById: async (_path, _id, options) => { contentReads++; options.onSuccess({ data: [] }) }, get: async () => ({ data: { data: requestView } }), create: async () => { posts++; throw new Error('unexpected') } },
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
