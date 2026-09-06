import { expect } from 'chai'
import { ref } from 'vue'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'
import { stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'
import { createHallVoiceReplyCorrelation } from '../src/composables/juyiting/hallVoiceReplyCorrelation.js'
import {
  appendHallEventMessage,
  appendStreamPayload,
  normalizeHallMessage
} from '../src/composables/juyiting/hallConversationMessages.js'

describe('useHallConversation scoped message loading', () => {
  it('does not fetch or schedule SSE recovery when token acquisition returns null', async () => {
    const originalFetch = global.fetch
    const originalSetTimeout = window.setTimeout
    let fetchCount = 0
    let reconnectTimerCount = 0
    let tokenCount = 0
    global.fetch = async () => {
      fetchCount += 1
      throw new Error('fetch must not run without a token')
    }
    window.setTimeout = () => {
      reconnectTimerCount += 1
      return 1
    }

    try {
      const chatContext = ref({
        conversationScopeType: 'public',
        conversationScopeKey: 'public',
        mode: 'public',
        participantAgentIds: [],
        targetAgentIds: []
      })
      const conversation = useHallConversation({
        apiStore: {
          token: async () => {
            tokenCount += 1
            return null
          }
        },
        chatApi: {
          list: async (_path, _payload, options) => options.onSuccess({ data: [{ id: '1001' }] }),
          getById: async (_path, _id, options) => options.onSuccess({ data: [] })
        },
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

      await conversation.loadHallMessages()
      await Promise.resolve()
      await Promise.resolve()

      expect(tokenCount).to.equal(1)
      expect(fetchCount).to.equal(0)
      expect(reconnectTimerCount).to.equal(0)
      expect(conversation.eventStreamRecovering.value).to.equal(false)
    } finally {
      global.fetch = originalFetch
      window.setTimeout = originalSetTimeout
    }
  })

  it('does not reconnect or replay when the protected SSE endpoint returns 401', async () => {
    const originalFetch = global.fetch
    const originalSetTimeout = window.setTimeout
    let fetchCount = 0
    let cleanCount = 0
    let authorizationCount = 0
    let reconnectTimerCount = 0
    global.fetch = async () => {
      fetchCount += 1
      return new Response('', { status: 401 })
    }
    window.setTimeout = () => {
      reconnectTimerCount += 1
      return 1
    }

    try {
      const conversation = useHallConversation({
        apiStore: {
          token: async () => 'expired-token',
          cleanToken: () => { cleanCount += 1 },
          beginAuthorization: async () => { authorizationCount += 1 }
        },
        chatApi: {
          list: async (_path, _payload, options) => options.onSuccess({ data: [{ id: '1001' }] }),
          getById: async (_path, _id, options) => options.onSuccess({ data: [] })
        },
        chatContext: ref({
          conversationScopeType: 'public',
          conversationScopeKey: 'public',
          mode: 'public',
          participantAgentIds: [],
          targetAgentIds: []
        }),
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

      await conversation.loadHallMessages()
      await Promise.resolve()
      await Promise.resolve()

      expect(fetchCount).to.equal(1)
      expect(cleanCount).to.equal(1)
      expect(authorizationCount).to.equal(1)
      expect(reconnectTimerCount).to.equal(0)
      expect(conversation.eventStreamRecovering.value).to.equal(false)
    } finally {
      global.fetch = originalFetch
      window.setTimeout = originalSetTimeout
    }
  })

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
      id: '12',
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

  it('fails closed for numeric and unsafe Long wire IDs without coercion', () => {
    expect(normalizeHallMessage({ id: 12, senderType: 'agent', content: 'numeric' })).to.equal(null)
    expect(normalizeHallMessage({ id: 9223372036854775807, senderType: 'agent', content: 'unsafe' })).to.equal(null)
    expect(normalizeHallMessage({ id: '9223372036854775807', senderType: 'agent', content: 'exact' })?.localId).to.equal('9223372036854775807')

    const externalState = { conversationId: '1001', messages: [], isAwaitingReply: true, isStreaming: true }
    const numericMessage = appendHallEventMessage(externalState, {
      type: 'agent_message', conversationId: '1001', messageId: 9223372036854775807, senderType: 'agent', content: 'unsafe'
    })
    expect(numericMessage.type).to.equal('invalid_message_id')
    expect(externalState.messages).to.deep.equal([])

    const streamState = { conversationId: '', messages: [], isAwaitingReply: true, isStreaming: true }
    expect(appendStreamPayload(streamState, '{"conversationId":9223372036854775807}').type).to.equal('invalid_conversation')
    expect(appendStreamPayload(streamState, '{"type":"agent_message","messageId":9223372036854775807,"senderType":"agent","content":"unsafe"}').type).to.equal('invalid_message_id')
    expect(streamState.conversationId).to.equal('')
    expect(streamState.messages).to.deep.equal([])
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
    const externalFinal = appendHallEventMessage(state, {
      type: 'agent_message',
      conversationId: '1001',
      messageId: '99',
      agentId: 'wuyong',
      senderType: 'agent',
      senderName: '吴用',
      content: '先查日志',
      timestamp: 12
    })
    appendHallEventMessage(state, {
      type: 'agent_message',
      conversationId: '1001',
      messageId: '99',
      agentId: 'wuyong',
      senderType: 'agent',
      senderName: '吴用',
      content: '重复事件',
      timestamp: 13
    })

    expect(externalFinal.type).to.equal('final')
    expect(state.messages).to.have.length(1)
    expect(state.messages[0]).to.deep.include({
      localId: '99',
      sender: 'AGENT',
      senderName: '吴用',
      agentId: 'wuyong',
      content: '先查日志',
      streaming: false,
      statusText: '回话已毕'
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
      content: '目标好汉暂未候令，传令未达。',
      statusText: '未递到'
    })
    expect(state.messages[1]).to.deep.include({
      sender: 'ASSISTANT',
      content: '收到，马上处理'
    })
  })
})


describe('useHallConversation finalized reply routing', () => {
  const flushMicrotasks = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }

  const runBuiltInFinalScenario = async ({ existingConversationId = '', duplicatePath = null }) => {
    const originalSetTimeout = window.setTimeout
    const originalClearTimeout = window.clearTimeout
    const originalFetch = global.fetch
    const timers = []
    let sseController = null
    let contentCalls = 0
    window.setTimeout = (callback, delay) => {
      const timer = { callback, delay, cleared: false }
      timers.push(timer)
      return timer
    }
    window.clearTimeout = timer => { if (timer) timer.cleared = true }
    if (duplicatePath === 'live_sse') {
      global.fetch = async () => new Response(new ReadableStream({
        start (controller) { sseController = controller }
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }

    const finalConversationId = existingConversationId || 'conversation-new-9223372036854775807'
    const finalMessageId = `reply-${duplicatePath || 'stream'}-9223372036854775807`
    const finalText = `完整回话-${duplicatePath || 'stream'}`
    const callbacks = []
    const spokenReplies = []
    const spokenMessageIds = new Set()
    let tracker
    let conversation

    try {
      conversation = useHallConversation({
        apiStore: { token: async () => duplicatePath === 'live_sse' ? 'token' : null },
        chatApi: {
          list: async (_path, _payload, options) => options.onSuccess({ data: [{ id: existingConversationId }] }),
          create: async (_path, _payload, options) => {
            const finalEvent = JSON.stringify({
              type: 'agent_message',
              conversationId: finalConversationId,
              messageId: finalMessageId,
              agentId: 'wuyong',
              senderType: 'agent',
              senderName: '吴用',
              content: finalText,
              timestamp: 1788000000000
            })
            const runPollDuplicate = async () => {
              const syncTimer = timers.find(timer => timer.delay === 1500 && !timer.cleared)
              expect(syncTimer, 'new-conversation sync timer').to.exist
              syncTimer.callback()
              await flushMicrotasks()
            }

            if (duplicatePath === 'live_sse') {
              sseController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
                type: 'agent_message',
                conversationId: finalConversationId,
                messageId: finalMessageId,
                agentId: 'wuyong',
                senderType: 'agent',
                senderName: '吴用',
                content: '实时副本残片',
                timestamp: 1787999999999
              })}\n`))
              sseController.close()
              await flushMicrotasks()
              expect(callbacks, 'live SSE duplicate must remain pending during the built-in turn').to.have.length(0)
              options.onStream(finalEvent)
              options.onStream(JSON.stringify({ conversationId: finalConversationId }))
            } else if (duplicatePath === 'poll_before_stream_end') {
              options.onStream(JSON.stringify({ conversationId: finalConversationId }))
              await runPollDuplicate()
              expect(callbacks, 'poll duplicate must remain pending during the built-in turn').to.have.length(0)
              options.onStream(finalEvent)
            } else {
              options.onStream(finalEvent)
              options.onStream(finalEvent)
              options.onStream(JSON.stringify({ conversationId: finalConversationId }))
            }
            expect(callbacks, 'built-in final must remain pending until stream end').to.have.length(0)
            options.onStreamEnd()
            options.onStreamEnd()
            if (duplicatePath === 'poll_after_stream_end') await runPollDuplicate()
          },
          getById: async (_path, id, options) => {
            expect(id).to.equal(finalConversationId)
            contentCalls += 1
            const isInitialSseLoad = duplicatePath === 'live_sse' && contentCalls === 1
            await options.onSuccess({ data: isInitialSseLoad ? [] : [{
              id: finalMessageId,
              senderType: 'agent',
              senderName: '吴用',
              content: '轮询副本残片',
              createTime: 1787999999999,
              metadata: JSON.stringify({ agentId: 'wuyong' })
            }] })
          }
        },
        chatContext: ref({
          conversationScopeType: 'public',
          conversationScopeKey: 'public',
          mode: 'public',
          participantAgentIds: [],
          targetAgentIds: [],
          targetAgentId: '',
          selectedTaskId: null,
          taskId: null
        }),
        chatMode: ref('public'),
        globalStore: { getJiacn: 'hero', user: {} },
        log: { warn: () => {}, error: () => {} },
        openPanel: () => {},
        outgoingMetadata: ref({}),
        portraitShortName: agent => agent?.name || '',
        selectedAgent: ref(null),
        selectedTask: ref(null),
        showToast: () => {},
        onFinalReply: payload => {
          callbacks.push(payload)
          tracker.observe(payload)
        }
      })
      if (duplicatePath === 'live_sse') {
        await conversation.loadHallMessages()
        await flushMicrotasks()
        expect(sseController, 'existing-conversation live SSE controller').to.exist
      } else {
        conversation.conversationId.value = existingConversationId
      }
      conversation.messages.value = [{ localId: 'baseline-old-reply', sender: 'AGENT', content: '旧回话', streaming: false }]
      tracker = createHallVoiceReplyCorrelation({
        spokenMessageIds,
        onReply: (message, _turn, payload) => spokenReplies.push({ source: payload.source, text: message.content })
      })
      const turnId = `turn-${duplicatePath || 'existing'}`
      expect(tracker.start({
        turnId,
        baselineSequence: conversation.replyEventSequence.value,
        messages: conversation.messages.value,
        conversationIdBeforeSend: existingConversationId
      })).to.equal(turnId)

      conversation.setDraft('请报完整回话')
      const accepted = await conversation.sendHallMessage({
        onConversationResolved: id => tracker.resolveConversation(id)
      })
      await flushMicrotasks()

      expect(accepted).to.equal(true)
      expect(conversation.conversationId.value).to.equal(finalConversationId)
      expect(conversation.replyEventSequence.value).to.equal(1)
      expect(callbacks).to.have.length(1)
      expect(callbacks[0]).to.deep.include({
        conversationId: finalConversationId,
        messageId: finalMessageId,
        sequence: 1,
        source: 'stream_end'
      })
      expect(spokenReplies).to.deep.equal([{ source: 'stream_end', text: finalText }])
      expect(spokenMessageIds.has(finalMessageId)).to.equal(true)
      expect(spokenMessageIds.has('baseline-old-reply')).to.equal(false)
    } finally {
      conversation?.disposeHallConversation()
      window.setTimeout = originalSetTimeout
      window.clearTimeout = originalClearTimeout
      global.fetch = originalFetch
    }
  }

  it('defers a built-in final for an existing conversation until stream end and commits once', async () => {
    await runBuiltInFinalScenario({ existingConversationId: 'conversation-existing-9223372036854775807' })
  })

  it('makes stream end win over an existing-conversation live SSE duplicate', async () => {
    await runBuiltInFinalScenario({ existingConversationId: 'conversation-existing-sse-9223372036854775807', duplicatePath: 'live_sse' })
  })

  it('makes stream end win over a new-conversation poll duplicate before end', async () => {
    await runBuiltInFinalScenario({ duplicatePath: 'poll_before_stream_end' })
  })

  it('deduplicates a new-conversation poll replay after stream end', async () => {
    await runBuiltInFinalScenario({ duplicatePath: 'poll_after_stream_end' })
  })
})

describe('Hall conversation identity lifecycle', () => {
  it('clears 1.5s and 5s sync timers and prevents their callbacks from loading after disposal', async () => {
    const timers = []
    const cleared = []
    const originalSetTimeout = window.setTimeout
    const originalClearTimeout = window.clearTimeout
    window.setTimeout = (callback, delay) => {
      const timer = { callback, delay }
      timers.push(timer)
      return timer
    }
    window.clearTimeout = timer => cleared.push(timer)
    try {
      const chatContext = ref({ conversationScopeType: 'public', conversationScopeKey: 'public', targetAgentIds: [] })
      let contentCalls = 0
      const conversation = useHallConversation({
        apiStore: { token: async () => null },
        chatApi: {
          create: async (_path, _payload, options) => {
            options.onStream('{"conversationId":"1001"}')
            options.onStreamEnd()
          },
          getById: async () => { contentCalls += 1 }
        },
        chatContext, chatMode: ref('public'), globalStore: { getJiacn: 'hero', user: {} },
        log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}),
        portraitShortName: agent => agent?.name || '', selectedAgent: ref(null), selectedTask: ref(null), showToast: () => {}
      })
      conversation.setDraft('hello')
      await conversation.sendHallMessage()
      expect(timers.map(timer => timer.delay)).to.include.members([1500, 5000])
      conversation.disposeHallConversation()
      conversation.disposeHallConversation()
      expect(cleared).to.include.members(timers)
      timers.forEach(timer => timer.callback())
      expect(contentCalls).to.equal(0)
    } finally {
      window.setTimeout = originalSetTimeout
      window.clearTimeout = originalClearTimeout
    }
  })

  it('aborts deferred list and content requests on disposal and ignores their late success callbacks', async () => {
    let listOptions
    let contentOptions
    let resolveContent
    const conversation = useHallConversation({
      apiStore: { token: async () => 'token' },
      chatApi: {
        list: async (_path, _payload, options) => {
          listOptions = options
          await options.onSuccess({ data: [{ id: '1001' }] })
        },
        getById: async (_path, _id, options) => {
          contentOptions = options
          await new Promise(resolve => { resolveContent = resolve })
          options.onSuccess({ data: [{ id: '9', senderType: 'agent', content: 'late reply' }] })
        }
      },
      chatContext: ref({ conversationScopeType: 'public', conversationScopeKey: 'public', targetAgentIds: [] }),
      chatMode: ref('public'), globalStore: { getJiacn: 'hero', user: {} },
      log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}),
      portraitShortName: agent => agent?.name || '', selectedAgent: ref(null), selectedTask: ref(null), showToast: () => {}
    })

    const loading = conversation.loadHallMessages()
    await Promise.resolve()
    await Promise.resolve()
    expect(listOptions.signal.aborted).to.equal(false)
    expect(contentOptions.signal.aborted).to.equal(false)

    conversation.disposeHallConversation()
    expect(listOptions.signal.aborted).to.equal(true)
    expect(contentOptions.signal.aborted).to.equal(true)
    resolveContent()
    await loading

    expect(conversation.conversationId.value).to.equal('')
    expect(conversation.messages.value).to.deep.equal([])
  })

  it('cancels an opened deferred reply stream on identity clear and filters all late callbacks', async () => {
    let streamOptions
    let resolveStream
    let cancelReason
    let errorWrites = 0
    const conversation = useHallConversation({
      apiStore: { token: async () => 'token' },
      chatApi: {
        create: async (_path, _payload, options) => {
          streamOptions = options
          options.onStreamOpen({ cancel: reason => { cancelReason = reason } })
          await new Promise(resolve => { resolveStream = resolve })
        }
      },
      chatContext: ref({ conversationScopeType: 'public', conversationScopeKey: 'public', participantAgentIds: [], targetAgentIds: [] }),
      chatMode: ref('public'), globalStore: { getJiacn: 'hero', user: {} },
      log: { warn: () => {}, error: () => { errorWrites += 1 } }, openPanel: () => {}, outgoingMetadata: ref({ stale: true }),
      portraitShortName: agent => agent?.name || '', selectedAgent: ref(null), selectedTask: ref(null), showToast: () => {}
    })

    conversation.setDraft('hello')
    const sending = conversation.sendHallMessage()
    await Promise.resolve()
    expect(streamOptions.signal.aborted).to.equal(false)

    stopIdentityBoundWork()
    expect(streamOptions.signal.aborted).to.equal(true)
    expect(cancelReason?.name).to.equal('AbortError')
    streamOptions.onStream('{"v":"late"}')
    streamOptions.onStreamEnd()
    streamOptions.onError('cancelled', streamOptions.signal.reason)
    resolveStream()
    await sending

    expect(conversation.messages.value).to.deep.equal([])
    expect(conversation.isStreaming.value).to.equal(false)
    expect(conversation.isAwaitingReply.value).to.equal(false)
    expect(errorWrites).to.equal(0)
    conversation.disposeHallConversation()
  })

  it('resets an active reply when starting a new conversation and allows another send', async () => {
    const requests = []
    let firstCancelReason
    const conversation = useHallConversation({
      apiStore: { token: async () => 'token' },
      chatApi: {
        create: async (_path, payload, options) => {
          requests.push({ payload, options })
          options.onStreamOpen({
            cancel: reason => {
              if (requests.length === 1) firstCancelReason = reason
            }
          })
          if (requests.length === 1) {
            await new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
            })
            return
          }
          options.onStreamEnd()
        }
      },
      chatContext: ref({ conversationScopeType: 'public', conversationScopeKey: 'public', participantAgentIds: [], targetAgentIds: [] }),
      chatMode: ref('public'), globalStore: { getJiacn: 'hero', user: {} },
      log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata: ref({}),
      portraitShortName: agent => agent?.name || '', selectedAgent: ref(null), selectedTask: ref(null), showToast: () => {}
    })

    conversation.setDraft('first')
    const firstSend = conversation.sendHallMessage()
    await Promise.resolve()
    expect(conversation.isStreaming.value).to.equal(true)

    const firstSignal = requests[0].options.signal
    conversation.newHallConversation()
    expect(firstSignal.aborted).to.equal(true)
    expect(firstCancelReason?.name).to.equal('AbortError')
    expect(conversation.isStreaming.value).to.equal(false)
    expect(conversation.isAwaitingReply.value).to.equal(false)
    expect(conversation.messages.value).to.deep.equal([])

    conversation.setDraft('second')
    const secondSend = conversation.sendHallMessage()
    await Promise.all([firstSend, secondSend])

    expect(requests).to.have.length(2)
    expect(requests[1].payload.content).to.equal('second')
    expect(requests[1].options.signal.aborted).to.equal(false)
    expect(conversation.isStreaming.value).to.equal(false)
    conversation.disposeHallConversation()
  })

})
