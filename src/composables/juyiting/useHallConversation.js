import { computed, ref } from 'vue'
import {
  appendHallEventMessage as reduceHallEventMessage,
  appendStreamPayload,
  hasResolvedAgentReply,
  normalizeHallMessage
} from './hallConversationMessages.js'
import { fetchHallConversationEvents } from '../../utils/authenticatedSse.js'

const runtimeEnv = import.meta.env ?? {}

export const useHallConversation = ({
  apiStore,
  chatContext,
  chatMode,
  chatApi,
  globalStore,
  log,
  openPanel,
  outgoingMetadata,
  portraitShortName,
  selectedAgent,
  selectedTask,
  showToast
}) => {
  const messages = ref([])
  const conversationId = ref('')
  const draft = ref('')
  const isStreaming = ref(false)
  const isAwaitingReply = ref(false)
  const eventStreamRecovering = ref(false)

  let hallEventController = null
  let hallEventConversationId = ''
  let hallEventReconnectTimer = null
  let hallReplyTimers = []
  let hallReplyPollTimer = null

  const pendingAgentName = computed(() => {
    if (!selectedAgent.value) return ''
    return portraitShortName(selectedAgent.value) || selectedAgent.value.name || selectedAgent.value.agentId || ''
  })

  const currentChatContext = computed(() => chatContext?.value || {
    conversationScopeType: 'public',
    conversationScopeKey: 'public',
    mode: 'public',
    participantAgentIds: [],
    selectedTaskId: selectedTask.value?.id,
    targetAgentIds: selectedAgent.value?.agentId ? [selectedAgent.value.agentId] : [],
    taskId: selectedTask.value?.id,
    targetAgentId: selectedAgent.value?.agentId || ''
  })

  const chatConnectionStatus = computed(() => {
    if (eventStreamRecovering.value) return '正在续上传令'
    if (isStreaming.value) return '传令中'
    if (isAwaitingReply.value) return pendingAgentName.value ? `${pendingAgentName.value} 回话中` : '等待回报'
    return '传令畅通'
  })

  const senderText = (message) => {
    if (message.senderName) return message.senderName
    if (message.sender === 'USER') return '你'
    if (message.sender === 'SYSTEM') return '传令牌'
    return '聚义厅'
  }

  const stopHallReplyStreaming = () => {
    hallReplyTimers.forEach(timer => window.clearTimeout(timer))
    hallReplyTimers = []
  }

  const stopHallReplyPolling = () => {
    if (hallReplyPollTimer) {
      window.clearInterval(hallReplyPollTimer)
      hallReplyPollTimer = null
    }
  }

  const setDraft = (value = '') => {
    draft.value = String(value || '')
  }

  const clearDraft = () => {
    setDraft('')
  }

  const appendHallEventMessage = (event) => {
    const state = {
      conversationId: conversationId.value,
      messages: messages.value,
      isAwaitingReply: isAwaitingReply.value,
      isStreaming: isStreaming.value
    }
    const result = reduceHallEventMessage(state, event)
    conversationId.value = state.conversationId
    messages.value = state.messages
    isAwaitingReply.value = state.isAwaitingReply
    isStreaming.value = state.isStreaming
    if (result.shouldStopPolling) {
      stopHallReplyPolling()
    }
    if (result.toastName) showToast(`${result.toastName} 已回话`)
  }

  const apiStreamUrl = (path, params = {}) => {
    const baseURL = runtimeEnv.VITE_API_BASE_URL || ''
    const requestPath = baseURL
      ? `${baseURL}${path.startsWith('/') ? path : `/${path}`}`
      : path
    const searchParams = new URLSearchParams(params).toString()
    return searchParams ? `${requestPath}?${searchParams}` : requestPath
  }

  const startHallEventStream = async () => {
    const id = conversationId.value?.toString()
    if (!id || hallEventConversationId === id) return
    stopHallEventStream()
    hallEventConversationId = id
    hallEventController = new AbortController()

    try {
      const response = await fetchHallConversationEvents({
        apiStore,
        url: apiStreamUrl('/chat/conversation/events', { id }),
        signal: hallEventController.signal
      })
      if (!response) {
        hallEventController = null
        return
      }
      if (!response.ok || !response.body) {
        throw new Error(`Hall event stream failed: ${response.status}`)
      }
      eventStreamRecovering.value = false

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let eventEndIndex
        while ((eventEndIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, eventEndIndex).trim()
          buffer = buffer.substring(eventEndIndex + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload) continue
          appendHallEventMessage(JSON.parse(payload))
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        log.warn('聚义厅实时消息连接中断', error)
        eventStreamRecovering.value = true
        hallEventReconnectTimer = window.setTimeout(() => {
          hallEventConversationId = ''
          startHallEventStream()
        }, 2500)
      }
    }
  }

  const stopHallEventStream = () => {
    if (hallEventReconnectTimer) window.clearTimeout(hallEventReconnectTimer)
    hallEventReconnectTimer = null
    if (hallEventController) hallEventController.abort()
    hallEventController = null
    hallEventConversationId = ''
    eventStreamRecovering.value = false
  }

  const loadHallConversationContent = async (id = conversationId.value) => {
    if (!id) return
    await chatApi.getById('/conversation/content', id, {
      autoLoading: false,
      onSuccess: (contentResult) => {
        messages.value = (contentResult?.data || []).map(normalizeHallMessage)
        if (hasResolvedAgentReply(messages.value)) {
          isAwaitingReply.value = false
          isStreaming.value = false
          stopHallReplyPolling()
        }
        startHallEventStream()
      }
    })
  }

  const loadHallMessages = async () => {
    stopHallEventStream()
    stopHallReplyStreaming()
    stopHallReplyPolling()
    conversationId.value = ''
    messages.value = []
    isAwaitingReply.value = false
    isStreaming.value = false
    try {
      await chatApi.list('/conversation/list', {
        pageNum: 1,
        pageSize: 1,
        orderBy: 'update_time desc',
        search: {
          jiacn: globalStore.getJiacn,
          conversationType: 'juyiting',
          conversationScopeType: chatContext.value.conversationScopeType,
          conversationScopeKey: chatContext.value.conversationScopeKey
        }
      }, {
        autoLoading: false,
        onSuccess: async (result) => {
          const hallConversation = result?.data?.[0]
          if (!hallConversation) return
          conversationId.value = hallConversation.id?.toString() || ''
          await loadHallConversationContent(conversationId.value)
        }
      })
    } catch (error) {
      log.warn('加载聚义厅会话失败', error)
    }
  }

  const startHallReplyPolling = (id = conversationId.value) => {
    if (!id) return
    stopHallReplyPolling()
    hallReplyPollTimer = window.setInterval(() => {
      if (!isAwaitingReply.value || conversationId.value?.toString() !== id.toString()) {
        stopHallReplyPolling()
        return
      }
      loadHallConversationContent(id)
    }, 2000)
  }

  const scheduleHallConversationSync = (id) => {
    if (!id) return
    window.setTimeout(() => {
      if (conversationId.value?.toString() === id.toString()) {
        loadHallConversationContent(id)
      }
    }, 1500)
    window.setTimeout(() => {
      if (conversationId.value?.toString() === id.toString()) {
        loadHallConversationContent(id)
      }
    }, 5000)
  }

  const newHallConversation = () => {
    stopHallEventStream()
    stopHallReplyStreaming()
    stopHallReplyPolling()
    conversationId.value = ''
    messages.value = []
    isAwaitingReply.value = false
    showToast('已另起厅前话头')
  }

  const processStream = (eventData) => {
    const state = {
      conversationId: conversationId.value,
      messages: messages.value,
      isAwaitingReply: isAwaitingReply.value,
      isStreaming: isStreaming.value
    }
    const result = appendStreamPayload(state, eventData)
    conversationId.value = state.conversationId
    messages.value = state.messages
    isAwaitingReply.value = state.isAwaitingReply
    isStreaming.value = state.isStreaming
    if (result.shouldStopPolling) {
      stopHallReplyPolling()
    }
    if (result.toastName) showToast(`${result.toastName} 已回话`)
    if (result.shouldReconnect) {
      startHallEventStream()
      scheduleHallConversationSync(result.conversationId)
    }
  }

  const sendHallMessage = async () => {
    const content = String(draft.value || '').trim()
    if (!content || isStreaming.value) return
    clearDraft()
    stopHallReplyStreaming()
    messages.value.push({
      localId: `user-${Date.now()}`,
      sender: 'USER',
      content,
      timestamp: Date.now(),
      streaming: false
    })
    isStreaming.value = true
    isAwaitingReply.value = true
    stopHallReplyPolling()

    try {
      await chatApi.create('/stream', {
        content,
        conversationId: conversationId.value,
        conversationType: 'juyiting',
        conversationScopeType: chatContext.value.conversationScopeType,
        conversationScopeKey: chatContext.value.conversationScopeKey,
        targetAgentIds: chatContext.value.targetAgentIds,
        targetAgentId: chatContext.value.targetAgentId,
        taskId: chatContext.value.taskId,
        forceNewConversation: !conversationId.value,
        senderType: 'user',
        senderName: globalStore.user?.name || globalStore.user?.nickname || '寨中来客',
        metadata: {
          scene: 'juyiting',
          mode: currentChatContext.value.mode,
          scopeKey: currentChatContext.value.conversationScopeKey,
          selectedAgentId: selectedAgent.value?.agentId,
          mentionAgentIds: currentChatContext.value.targetAgentIds,
          participantAgentIds: currentChatContext.value.participantAgentIds,
          targetAgentIds: currentChatContext.value.targetAgentIds,
          selectedTaskId: selectedTask.value?.id,
          ...(outgoingMetadata?.value || {})
        }
      }, {
        responseType: 'stream',
        autoLoading: false,
        timeout: 1800000,
        onStream: processStream,
        onStreamEnd: () => {
          isStreaming.value = false
          if (isAwaitingReply.value && conversationId.value) {
            startHallReplyPolling(conversationId.value)
          }
        },
        onError: (message) => {
          throw new Error(message)
        }
      })
      if (outgoingMetadata) {
        outgoingMetadata.value = {}
      }
    } catch (error) {
      log.error('聚义厅消息发送失败', error)
      isStreaming.value = false
      isAwaitingReply.value = false
      stopHallReplyPolling()
      messages.value.push({
        localId: `system-${Date.now()}`,
        sender: 'SYSTEM',
        content: '传令未达，请稍后再试',
        timestamp: Date.now(),
        streaming: false
      })
    }
  }

  const insertAgentMention = (agent, suffix = '') => {
    const mention = `@${portraitShortName(agent)}`
    const current = draft.value.trim()
    const replacement = suffix ? `${mention} ${suffix}` : `${mention} `
    if (!current) {
      draft.value = replacement
      return
    }
    if (current.includes(mention)) {
      draft.value = suffix && current === mention ? `${mention} ${suffix}` : draft.value
      return
    }
    if (/(^|\s)@\S*$/.test(current)) {
      draft.value = current.replace(/(^|\s)@\S*$/, (_, prefix) => `${prefix}${replacement}`)
      return
    }
    draft.value = `${current} ${mention}${suffix ? ` ${suffix}` : ' '}`
  }

  const mentionAgent = (agent) => {
    selectedAgent.value = agent
    insertAgentMention(agent)
  }

  const startAgentConversation = (agent) => {
    if (!agent) return
    if (chatMode) chatMode.value = 'private'
    selectedAgent.value = agent
    insertAgentMention(agent, '请报眼下动静、可领何榜、还需哪路照应。')
    openPanel('chat')
    showToast(`正与 ${portraitShortName(agent)} 密议`)
  }

  return {
    chatConnectionStatus,
    conversationId,
    clearDraft,
    draft,
    eventStreamRecovering,
    insertAgentMention,
    isAwaitingReply,
    isStreaming,
    loadHallMessages,
    mentionAgent,
    messages,
    newHallConversation,
    pendingAgentName,
    sendHallMessage,
    senderText,
    setDraft,
    startAgentConversation,
    stopHallEventStream,
    stopHallReplyPolling,
    stopHallReplyStreaming
  }
}
