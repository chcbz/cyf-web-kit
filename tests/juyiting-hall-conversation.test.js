import { expect } from 'chai'
import { ref } from 'vue'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'
import {
  appendHallEventMessage,
  appendStreamPayload,
  normalizeHallMessage
} from '../src/composables/juyiting/hallConversationMessages.js'

describe('useHallConversation scoped message loading', () => {
  it('clears stale messages when the current bounty scope has no conversation yet', async () => {
    const chatContext = ref({
      conversationScopeType: 'bounty',
      conversationScopeKey: 'task:task-2',
      mode: 'bounty',
      participantAgentIds: ['wuyong'],
      selectedTaskId: 'task-2',
      targetAgentIds: ['wuyong'],
      taskId: 'task-2',
      targetAgentId: 'wuyong'
    })
    const listPayloads = []
    const conversation = useHallConversation({
      apiStore: { token: async () => '' },
      chatApi: {
        list: async (_path, payload, options) => {
          listPayloads.push(payload)
          await options.onSuccess({ data: [] })
        },
        getById: async () => {
          throw new Error('content should not load without a scoped conversation')
        }
      },
      chatContext,
      chatMode: ref('bounty'),
      globalStore: { getJiacn: 'jia-user', user: {} },
      log: { warn: () => {}, error: () => {} },
      openPanel: () => {},
      outgoingMetadata: ref({}),
      portraitShortName: agent => agent?.name || agent?.agentId || '',
      selectedAgent: ref(null),
      selectedTask: ref({ id: 'task-2', title: 'Task 2' }),
      showToast: () => {}
    })

    conversation.conversationId.value = 'public-conversation'
    conversation.messages.value = [
      { localId: 'public-1', sender: 'USER', content: 'stale public message' }
    ]

    await conversation.loadHallMessages()

    expect(listPayloads[0].search).to.include({
      conversationType: 'juyiting',
      conversationScopeType: 'bounty',
      conversationScopeKey: 'task:task-2'
    })
    expect(conversation.conversationId.value).to.equal('')
    expect(conversation.messages.value).to.deep.equal([])
  })

  it('clears only the draft while keeping scoped target agents intact', () => {
    const chatContext = ref({
      conversationScopeType: 'bounty',
      conversationScopeKey: 'task:task-2',
      mode: 'bounty',
      participantAgentIds: ['wuyong'],
      selectedTaskId: 'task-2',
      targetAgentIds: ['wuyong'],
      taskId: 'task-2',
      targetAgentId: 'wuyong'
    })
    const conversation = useHallConversation({
      apiStore: { token: async () => '' },
      chatApi: {},
      chatContext,
      chatMode: ref('bounty'),
      globalStore: { getJiacn: 'jia-user', user: {} },
      log: { warn: () => {}, error: () => {} },
      openPanel: () => {},
      outgoingMetadata: ref({}),
      portraitShortName: agent => agent?.name || agent?.agentId || '',
      selectedAgent: ref(null),
      selectedTask: ref({ id: 'task-2', title: 'Task 2' }),
      showToast: () => {}
    })

    conversation.setDraft('  @Wu Yong inspect logs  ')
    conversation.clearDraft()

    expect(conversation.draft.value).to.equal('')
    expect(chatContext.value.targetAgentIds).to.deep.equal(['wuyong'])
  })

  it('replaces an active @ trigger when inserting an agent mention', () => {
    const chatContext = ref({
      conversationScopeType: 'public',
      conversationScopeKey: 'public',
      mode: 'public',
      participantAgentIds: [],
      selectedTaskId: undefined,
      targetAgentIds: ['songjiang'],
      taskId: undefined,
      targetAgentId: 'songjiang'
    })
    const conversation = useHallConversation({
      apiStore: { token: async () => '' },
      chatApi: {},
      chatContext,
      chatMode: ref('public'),
      globalStore: { getJiacn: 'jia-user', user: {} },
      log: { warn: () => {}, error: () => {} },
      openPanel: () => {},
      outgoingMetadata: ref({}),
      portraitShortName: agent => agent?.name || agent?.agentId || '',
      selectedAgent: ref(null),
      selectedTask: ref(null),
      showToast: () => {}
    })

    conversation.setDraft('@')
    conversation.mentionAgent({ agentId: 'songjiang', name: '宋江' })

    expect(conversation.draft.value).to.equal('@宋江 ')
  })

  it('trims sent hall messages while preserving scoped payload fields', async () => {
    const chatContext = ref({
      conversationScopeType: 'private',
      conversationScopeKey: 'task:task-2:agent:wuyong',
      mode: 'private',
      participantAgentIds: ['wuyong'],
      selectedTaskId: 'task-2',
      targetAgentIds: ['wuyong'],
      taskId: 'task-2',
      targetAgentId: 'wuyong'
    })
    const payloads = []
    const conversation = useHallConversation({
      apiStore: { token: async () => '' },
      chatApi: {
        create: async (_path, payload, options) => {
          payloads.push(payload)
          options.onStream('{"conversationId":"1003"}')
          options.onStreamEnd()
        }
      },
      chatContext,
      chatMode: ref('private'),
      globalStore: { getJiacn: 'jia-user', user: { name: 'Tester' } },
      log: { warn: () => {}, error: () => {} },
      openPanel: () => {},
      outgoingMetadata: ref({}),
      portraitShortName: agent => agent?.name || agent?.agentId || '',
      selectedAgent: ref({ agentId: 'wuyong', name: 'Wu Yong' }),
      selectedTask: ref({ id: 'task-2', title: 'Task 2' }),
      showToast: () => {}
    })

    conversation.setDraft('  discuss this task  ')
    await conversation.sendHallMessage()

    expect(payloads[0]).to.deep.include({
      content: 'discuss this task',
      conversationType: 'juyiting',
      conversationScopeType: 'private',
      conversationScopeKey: 'task:task-2:agent:wuyong',
      targetAgentId: 'wuyong',
      taskId: 'task-2'
    })
    expect(payloads[0].targetAgentIds).to.deep.equal(['wuyong'])
    expect(payloads[0].metadata.mentionAgentIds).to.deep.equal(['wuyong'])
    expect(conversation.messages.value[0].content).to.equal('discuss this task')
  })

  it('normalizes persisted agent messages with metadata', () => {
    const message = normalizeHallMessage({
      id: 12,
      senderType: 'agent',
      senderName: '',
      content: '已完成',
      createTime: 1782000000000,
      metadata: JSON.stringify({
        agentId: 'wuyong',
        senderName: '吴用'
      })
    })

    expect(message).to.deep.include({
      localId: '12',
      sender: 'AGENT',
      senderName: '吴用',
      agentId: 'wuyong',
      content: '已完成',
      timestamp: 1782000000000,
      streaming: false,
      statusText: ''
    })
  })

  it('merges agent delta and final events without duplicate messages', () => {
    const state = {
      conversationId: '1001',
      messages: [],
      isAwaitingReply: true,
      isStreaming: true
    }

    appendHallEventMessage(state, {
      type: 'agent_message_delta',
      conversationId: '1001',
      agentId: 'wuyong',
      senderName: '吴用',
      content: '先查',
      timestamp: 10
    })
    appendHallEventMessage(state, {
      type: 'agent_message_delta',
      conversationId: '1001',
      agentId: 'wuyong',
      content: '日志',
      timestamp: 11
    })
    appendHallEventMessage(state, {
      type: 'agent_message',
      conversationId: '1001',
      messageId: 99,
      agentId: 'wuyong',
      senderType: 'agent',
      senderName: '吴用',
      content: '先查日志',
      timestamp: 12
    })
    appendHallEventMessage(state, {
      type: 'agent_message',
      conversationId: '1001',
      messageId: 99,
      agentId: 'wuyong',
      senderType: 'agent',
      senderName: '吴用',
      content: '重复事件',
      timestamp: 13
    })

    expect(state.messages).to.have.length(1)
    expect(state.messages[0]).to.deep.include({
      localId: '99',
      sender: 'AGENT',
      senderName: '吴用',
      agentId: 'wuyong',
      content: '先查日志',
      streaming: false,
      statusText: '回复完成'
    })
    expect(state.isAwaitingReply).to.equal(false)
    expect(state.isStreaming).to.equal(false)
  })

  it('reduces stream payloads for delivery, conversation id, and assistant text', () => {
    const state = {
      conversationId: '',
      messages: [],
      isAwaitingReply: true,
      isStreaming: true
    }

    const delivery = appendStreamPayload(state, 'data: {"agentDelivery":{"agentId":"linchong","delivered":false},"conversationId":"1002"}')
    const conversation = appendStreamPayload(state, '{"conversationId":"1002"}')
    appendStreamPayload(state, '{"v":"收到"}')
    appendStreamPayload(state, '{"content":"，马上处理"}')

    expect(delivery.type).to.equal('delivery')
    expect(conversation.type).to.equal('conversation')
    expect(conversation.conversationId).to.equal('1002')
    expect(state.conversationId).to.equal('1002')
    expect(state.messages[0]).to.deep.include({
      sender: 'SYSTEM',
      content: '目标好汉暂未在线，投递失败。',
      statusText: '投递失败'
    })
    expect(state.messages[1]).to.deep.include({
      sender: 'ASSISTANT',
      content: '收到，马上处理'
    })
  })
})
