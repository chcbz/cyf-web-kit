import { expect } from 'chai'
import { describe, it } from 'mocha'
import { ref } from 'vue'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'
import { stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'

const scope = (type, key, extras = {}) => ({
  conversationScopeType: type, conversationScopeKey: key, mode: type,
  targetAgentIds: [], participantAgentIds: [], selectedTaskId: null, selectedAgentId: null,
  ...extras
})

describe('JYT-UX-W04 discussion source continuity', () => {
  it('sends explicit ordinary-private null task metadata rather than the browsed task or agent', async () => {
    const payloads = []
    const conversation = useHallConversation({
      apiStore: { token: async () => '' },
      chatApi: { create: async (_path, payload, options) => {
        payloads.push(payload)
        options.onStreamEnd()
      } },
      chatContext: ref(scope('private', 'agent:agent-a', {
        targetAgentId: 'agent-a', targetAgentIds: ['agent-a'],
        participantAgentIds: ['agent-a'], selectedAgentId: 'agent-a', taskId: null
      })),
      chatMode: ref('private'), globalStore: { user: {} },
      log: { warn: () => {}, error: () => {} }, openPanel: () => {},
      outgoingMetadata: ref({}), portraitShortName: () => '',
      selectedAgent: ref({ agentId: 'browsed-agent-b' }),
      selectedTask: ref({ id: 'browsed-task-b' }), showToast: () => {}
    })
    try {
      conversation.setDraft('只向甲询问，不关联正在浏览的事项')
      expect(await conversation.sendHallMessage()).to.equal(true)
      expect(payloads).to.have.length(1)
      expect(payloads[0]).to.include({ taskId: null, targetAgentId: 'agent-a', conversationScopeKey: 'agent:agent-a' })
      expect(payloads[0].metadata).to.include({ selectedTaskId: null, selectedAgentId: 'agent-a' })
    } finally {
      conversation.disposeHallConversation()
    }
  })

  it('keeps text and citation metadata isolated in memory for ordinary/private-task/public scopes', () => {
    const chatContext = ref(scope('private', 'agent:agent-a'))
    const outgoingMetadata = ref({})
    const calls = []
    const conversation = useHallConversation({
      apiStore: {}, chatApi: { create: (...args) => calls.push(args) }, chatContext,
      chatMode: ref('private'), globalStore: { user: {} }, log: { warn: () => {} },
      openPanel: () => {}, outgoingMetadata, portraitShortName: agent => agent?.name || '',
      selectedAgent: ref(null), selectedTask: ref(null), showToast: () => {}
    })
    try {
      conversation.setDraft('普通密议未发送内容')
      outgoingMetadata.value = { libraryCitationId: 'private-citation' }
      chatContext.value = scope('private', 'task:task-a:agent:agent-a', { taskId: 'task-a' })
      expect(conversation.draft.value).to.equal('')
      expect(outgoingMetadata.value).to.deep.equal({})
      conversation.setDraft('仅事项甲的内容')
      outgoingMetadata.value = { libraryCitationId: 'task-citation' }
      chatContext.value = scope('public', 'public')
      expect(conversation.draft.value).to.equal('')
      expect(outgoingMetadata.value).to.deep.equal({})
      conversation.setDraft('公议未发送内容')
      chatContext.value = scope('private', 'agent:agent-a')
      expect(conversation.draft.value).to.equal('普通密议未发送内容')
      expect(outgoingMetadata.value).to.deep.equal({ libraryCitationId: 'private-citation' })
      chatContext.value = scope('private', 'task:task-a:agent:agent-a', { taskId: 'task-a' })
      expect(conversation.draft.value).to.equal('仅事项甲的内容')
      expect(outgoingMetadata.value).to.deep.equal({ libraryCitationId: 'task-citation' })
      stopIdentityBoundWork()
      expect(conversation.draft.value).to.equal('')
      expect(outgoingMetadata.value).to.deep.equal({})
      chatContext.value = scope('private', 'agent:agent-a')
      expect(conversation.draft.value).to.equal('')
      expect(calls).to.have.length(0)
    } finally {
      conversation.disposeHallConversation()
    }
  })
})
