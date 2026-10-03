import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { ref } from 'vue'
import { useHallBountyFollowup } from '../src/composables/juyiting/useHallBountyFollowup.js'
import { useHallChatContext, bountyInteractionTargetId } from '../src/composables/juyiting/useHallChatContext.js'

const require = createRequire(import.meta.url)
const { parse } = require('@vue/compiler-sfc')
const babel = require('@babel/parser')
const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const script = parse(source, { filename: 'JuyiHall.vue' }).descriptor.scriptSetup.content
const declarations = babel.parse(script, { sourceType: 'module' }).program.body.flatMap(node => node.declarations || [])
const handler = name => {
  const node = declarations.find(item => item.id?.name === name)
  if (!node) throw new Error(`missing ${name}`)
  return script.slice(node.init.start, node.init.end)
}
describe('ordinary JuyiHall request routing', () => {
  it('sends drawing, editing and other requests through the same discussion handler', async () => {
    const draft = ref(''); const calls = []
    const send = new Function('voiceReplyCorrelation', 'hallVoice', 'playSend', 'typedDeliberationEnabled', 'typedDeliberation', 'draft', 'setDraft', 'showToast', 'sendHallMessage', `return (${handler('handleSendHallMessage')})`)(
      { close: () => {} }, { cancel: () => {} }, () => {}, ref(true),
      { submit: async payload => { calls.push(payload); return true }, error: ref('') }, draft, value => { draft.value = value }, () => {}, () => { throw new Error('unexpected legacy send') })
    const source = { kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: 'f', version: '1', purpose: 'INPUT', assetId: null, assetRevision: null }
    for (const content of ['画一只鸟', '把上一张改成蓝色', '整理这份文档']) {
      draft.value = content
      expect(await send({ sourceSelectors: [source], inspection: true })).to.equal(true)
      expect(calls.at(-1)).to.deep.equal({ content, sourceSelectors: [source] })
      expect(draft.value).to.equal('')
    }
    expect(calls).to.have.length(3)
  })
  it('has no separate image generation, preview-consent or proposal-confirmation handler', () => {
    for (const name of ['useHallBountyFollowup', 'handleFollowupGenerate', 'handleFollowupEdit', 'handleTypedProposal', 'confirmFollowup']) expect(source).not.to.include(name)
  })
})

describe('real bounty entry binds per-Agent interactions independently of private selection', () => {
  const contextHarness = () => {
    const agents = ref([{ agentId: 'agent-417', boundToMe: true, canOperate: true },
      { agentId: 'agent-other', boundToMe: true, canOperate: true }])
    const selectedAgent = ref({ agentId: 'agent-other' }); const selectedTask = ref(null)
    const hall = useHallChatContext({ agents, selectedAgent, selectedTask, portraitShortName: a => a.agentId })
    hall.enterBountyDiscussion({ id: '417', assignedAgentIds: ['agent-417'] })
    return { hall, agents, selectedAgent, selectedTask }
  }
  const actualContext = hall => new Function('conversationId', 'conversationTask', 'conversationAgent',
    'chatContext', 'bountyInteractionTargetId', 'typedAssignmentRevision', 'typedConversationGeneration', `return (${handler('typedDeliberationContext')})`)(
    ref('1760458004760'), hall.conversationTask, hall.conversationAgent, hall.chatContext, bountyInteractionTargetId, () => '1', () => '1')

  it('uses the exact task participant after enterBountyDiscussion with intentionally null private Agent', () => {
    const { hall, selectedAgent } = contextHarness()
    expect(hall.conversationAgent.value).to.equal(null)
    expect(selectedAgent.value).to.equal(null)
    expect(actualContext(hall)()).to.deep.equal({ conversationId: '1760458004760', taskId: '417', targetAgentId: 'agent-417', assignmentRevision: '1', conversationGeneration: '1' })
    selectedAgent.value = { agentId: 'agent-other' }
    expect(actualContext(hall)().targetAgentId).to.equal('agent-417')
  })

  it('the real follow-up composable reaches a bound preview from actual bounty entry without consent or execution', async () => {
    const { hall } = contextHarness(); const calls = []; const stored = new Map()
    const getContext = actualContext(hall)
    const followup = useHallBountyFollowup({ actorScopeKey: ref('0\u0000client\u00005'), authorizationGeneration: () => 0,
      getContext, getContextGeneration: () => 0, enabled: () => true,
      storage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) },
      keys: { createFinalKey: () => 'mmd-final-new-417', createIssueKey: () => 'mmd-issue-new-417' },
      chatApi: {
        get: async path => { calls.push(['GET', path]); return { schemaVersion: 1, ...getContext(), conversationGeneration: '1',
          taskVersion: '0', assignmentRevision: '1', baselineGrantVersion: '1', requirementRevision: '1' } },
        create: async path => { calls.push(['POST', path]); return { schemaVersion: 3, requestId: 'new-request', stepId: 'new-step',
          executionIntentId: 'new-intent', ownerPayloadSha256: 'a'.repeat(64), instructionSha256: 'b'.repeat(64), sourceSnapshotSha256: 'c'.repeat(64),
          conversationGeneration: '1', taskVersion: '0', assignmentRevision: '1', grantVersion: '1', requirementRevision: '1',
          targetAgentId: 'agent-417', operation: 'GENERATE_IMAGE', sources: [], providerBinding: { bindingId: 'fixture-binding', bindingEpoch: '1' },
          modelId: 'fixture-model', custody: 'OPERATOR_TEMPLATE', operatorPolicyRevision: 'fixture-policy',
          pricingMode: 'UNPRICED_EXTERNAL_ACCOUNT', maxOutboundRequestAttempts: 1 } }
      } })
    try {
      expect(await followup.prepareGenerate({ content: '画一只鸟' })).to.equal(true)
      expect(followup.state.value.status).to.equal('PREVIEWED')
      expect(calls).to.deep.equal([['GET', '/conversations/1760458004760/interactions/context'],
        ['POST', '/conversations/1760458004760/interactions/preview']])
    } finally { followup.dispose() }
  })

  it('never selects the first of multiple targets; an explicit allowed mention selects exactly one', () => {
    const { hall } = contextHarness()
    hall.enterBountyDiscussion({ id: '418', assignedAgentIds: ['agent-417', 'agent-other'] })
    expect(actualContext(hall)().targetAgentId).to.equal('')
    hall.setMentionAgent({ agentId: 'agent-other' })
    expect(actualContext(hall)().targetAgentId).to.equal('agent-other')
  })

  it('drops a revoked or unbound roster target instead of falling back to browser selection', () => {
    const { hall, agents, selectedAgent } = contextHarness()
    selectedAgent.value = { agentId: 'agent-other' }
    agents.value[0].canOperate = false
    expect(actualContext(hall)().targetAgentId).to.equal('')
    agents.value[0].canOperate = true
    expect(actualContext(hall)().targetAgentId).to.equal('agent-417')
    agents.value[0].boundToMe = false
    expect(actualContext(hall)().targetAgentId).to.equal('')
  })

  it('rejects foreign participant, wrong task scope, private and public contexts', () => {
    const { hall } = contextHarness(); const c = hall.chatContext.value
    for (const broken of [{ ...c, targetAgentIds: ['foreign'] }, { ...c, conversationScopeKey: 'task:other' },
      { ...c, mode: 'private' }, { ...c, conversationScopeType: 'public' }, { ...c, targetAgentIds: [] }]) {
      expect(bountyInteractionTargetId(broken)).to.equal('')
    }
  })
})
