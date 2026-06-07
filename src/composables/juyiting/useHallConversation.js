import { computed, ref } from 'vue'

export const useHallConversation = ({
  apiStore,
  chatApi,
  globalStore,
  log,
  openPanel,
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

  let hallEventController = null
  let hallEventConversationId = ''
  let hallEventReconnectTimer = null
  let hallReplyTimers = []
  let hallReplyPollTimer = null

  const pendingAgentName = computed(() => {
    if (!selectedAgent.value) return ''
    return portraitShortName(selectedAgent.value) || selectedAgent.value.name || selectedAgent.value.agentId || ''
  })

  const chatConnectionStatus = computed(() => {
    if (isStreaming.value) return '传令中'
    if (isAwaitingReply.value) return pendingAgentName.value ? `${pendingAgentName.value} 回话中` : '等待回报'
    return '实时同步中'
  })

  const senderText = (message) => {
    if (message.senderName) return message.senderName
    if (message.sender === 'USER') return '你'
    if (message.sender === 'SYSTEM') return '系统'
    return '聚义厅'
  }

  const parseMessageMetadata = (metadata) => {
    if (!metadata) return {}
    if (typeof metadata === 'object') return metadata
    try {
      return JSON.parse(metadata)
    } catch {
      return {}
    }
  }

  const normalizeHallMessage = (item, index = 0) => {
    const metadata = parseMessageMetadata(item.metadata)
    return {
      localId: `${item.id || metadata.messageId || index}`,
      sender: item.senderType === 'agent' ? 'AGENT' : (item.messageType || item.senderType || 'SYSTEM'),
      senderName: item.senderName || metadata.senderName,
      agentId: metadata.agentId,
      content: item.content || '',
      timestamp: item.createTime || metadata.timestamp || Date.now(),
      streaming: false,
      statusText: ''
    }
  }

  const currentStreamingAgentMessage = (event) => {
    return messages.value.find(message =>
      message.sender === 'AGENT' &&
      message.streaming &&
      (!event.agentId || message.agentId === event.agentId)
    ) || null
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

  const hasResolvedAgentReply = (list = messages.value) => {
    let latestUserTimestamp = 0
    for (const message of list) {
      if (message.sender === 'USER') {
        latestUserTimestamp = Math.max(latestUserTimestamp, Number(message.timestamp) || 0)
      }
    }
    return list.some(message =>
      message.sender === 'AGENT' &&
      !message.streaming &&
      (Number(message.timestamp) || 0) >= latestUserTimestamp
    )
  }

  const appendHallEventMessage = (event) => {
    if (!event || event.conversationId?.toString() !== conversationId.value?.toString()) return
    if (event.type === 'agent_message_delta') {
      let pendingMessage = currentStreamingAgentMessage(event)
      if (!pendingMessage) {
        pendingMessage = {
          localId: `delta-${event.agentId || 'agent'}-${event.timestamp || Date.now()}`,
          sender: 'AGENT',
          senderName: event.senderName,
          agentId: event.agentId,
          content: '',
          timestamp: event.timestamp || Date.now(),
          streaming: true,
          statusText: '正在回复'
        }
        messages.value.push(pendingMessage)
      }
      pendingMessage.content += event.content || ''
      pendingMessage.timestamp = event.timestamp || pendingMessage.timestamp
      pendingMessage.senderName = event.senderName || pendingMessage.senderName
      pendingMessage.streaming = true
      pendingMessage.statusText = '正在回复'
      isAwaitingReply.value = false
      return
    }

    const localId = `${event.messageId || `${event.agentId}-${event.timestamp || Date.now()}`}`
    const streamingMessage = event.senderType === 'agent' ? currentStreamingAgentMessage(event) : null
    if (streamingMessage && event.senderType === 'agent') {
      streamingMessage.localId = localId
      streamingMessage.content = event.content || streamingMessage.content
      streamingMessage.timestamp = event.timestamp || streamingMessage.timestamp
      streamingMessage.senderName = event.senderName || streamingMessage.senderName
      streamingMessage.agentId = event.agentId || streamingMessage.agentId
      streamingMessage.streaming = false
      streamingMessage.statusText = '回复完成'
      isAwaitingReply.value = false
      isStreaming.value = false
      stopHallReplyPolling()
      if (event.senderName) showToast(`${event.senderName} 已回话`)
      return
    }
    if (messages.value.some(message => message.localId === localId)) return

    messages.value.push({
      localId,
      sender: event.senderType === 'agent' ? 'AGENT' : (event.messageType || 'ASSISTANT'),
      senderName: event.senderName,
      agentId: event.agentId,
      content: event.content || '',
      timestamp: event.timestamp || Date.now(),
      streaming: false,
      statusText: event.type === 'agent_message' ? '回复完成' : ''
    })
    if (event.senderType !== 'agent') {
      isAwaitingReply.value = false
      isStreaming.value = false
      stopHallReplyPolling()
    }
    if (event.senderName) showToast(`${event.senderName} 已回话`)
  }

  const apiStreamUrl = (path, params = {}) => {
    const baseURL = import.meta.env.VITE_API_BASE_URL || ''
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
      const token = await apiStore.token()
      const response = await fetch(apiStreamUrl('/chat/conversation/events', { id }), {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: hallEventController.signal
      })
      if (!response.ok || !response.body) {
        throw new Error(`Hall event stream failed: ${response.status}`)
      }

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
    try {
      await chatApi.list('/conversation/list', {
        pageNum: 1,
        pageSize: 1,
        orderBy: 'update_time desc',
        search: {
          jiacn: globalStore.getJiacn,
          conversationType: 'juyiting'
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
    showToast('已开启新的聚义议事')
  }

  const processStream = (eventData) => {
    let payload = eventData.startsWith('data:') ? eventData.slice(5).trim() : eventData.trim()
    if (!payload || payload === '[DONE]' || payload === '[EOM]') return

    try {
      const data = JSON.parse(payload)
      if (data.agentDelivery) {
        const agentId = data.agentDelivery.agentId || selectedAgent.value?.agentId || 'agent'
        const delivered = data.agentDelivery.delivered === true
        const localId = `delivery-${agentId}-${Date.now()}`
        messages.value.push({
          localId,
          sender: 'SYSTEM',
          content: delivered ? '消息已投递给目标好汉。' : '目标好汉暂未在线，投递失败。',
          timestamp: Date.now(),
          streaming: false,
          statusText: delivered ? '已投递' : '投递失败'
        })
        return
      }
      if (data.type === 'agent_message_delta' || data.type === 'agent_message') {
        appendHallEventMessage(data)
        return
      }
      if (data.conversationId) {
        const nextConversationId = data.conversationId?.toString() || ''
        const shouldReconnect = nextConversationId && nextConversationId !== conversationId.value?.toString()
        conversationId.value = nextConversationId
        if (shouldReconnect) {
          startHallEventStream()
          scheduleHallConversationSync(nextConversationId)
        }
        return
      }
      payload = data.v || data.content || ''
    } catch {
      // plain text stream
    }

    if (!payload) return
    const last = messages.value[messages.value.length - 1]
    if (last?.sender === 'ASSISTANT') {
      last.content += payload
    } else {
      messages.value.push({
        localId: `assistant-${Date.now()}`,
        sender: 'ASSISTANT',
        content: payload,
        timestamp: Date.now(),
        streaming: false,
        statusText: ''
      })
    }
  }

  const sendHallMessage = async () => {
    if (!draft.value || isStreaming.value) return
    const content = draft.value
    draft.value = ''
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
        senderType: 'user',
        senderName: globalStore.user?.name || globalStore.user?.nickname || '用户',
        metadata: {
          scene: 'juyiting',
          selectedAgentId: selectedAgent.value?.agentId,
          mentionAgentIds: selectedAgent.value?.agentId ? [selectedAgent.value.agentId] : [],
          selectedTaskId: selectedTask.value?.id
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
    } catch (error) {
      log.error('聚义厅消息发送失败', error)
      isStreaming.value = false
      isAwaitingReply.value = false
      stopHallReplyPolling()
      messages.value.push({
        localId: `system-${Date.now()}`,
        sender: 'SYSTEM',
        content: '传令失败，请稍后再试',
        timestamp: Date.now(),
        streaming: false
      })
    }
  }

  const insertAgentMention = (agent, suffix = '') => {
    const mention = `@${portraitShortName(agent)}`
    const current = draft.value.trim()
    if (!current) {
      draft.value = suffix ? `${mention} ${suffix}` : `${mention} `
      return
    }
    if (current.includes(mention)) {
      draft.value = suffix && current === mention ? `${mention} ${suffix}` : draft.value
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
    selectedAgent.value = agent
    insertAgentMention(agent, '请汇报当前状态、可承接任务和需要协助的事项。')
    openPanel('chat')
    showToast(`正在与 ${portraitShortName(agent)} 对话`)
  }

  return {
    chatConnectionStatus,
    conversationId,
    draft,
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
    startAgentConversation,
    stopHallEventStream,
    stopHallReplyPolling,
    stopHallReplyStreaming
  }
}
