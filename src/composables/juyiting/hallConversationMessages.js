export const parseMessageMetadata = (metadata) => {
  if (!metadata) return {}
  if (typeof metadata === 'object') return metadata
  try {
    return JSON.parse(metadata)
  } catch {
    return {}
  }
}

export const normalizeHallMessage = (item, index = 0) => {
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

export const currentStreamingAgentMessage = (messages, event) => {
  return messages.find(message =>
    message.sender === 'AGENT' &&
    message.streaming &&
    (!event.agentId || message.agentId === event.agentId)
  ) || null
}

export const hasResolvedAgentReply = (messages = []) => {
  let latestUserTimestamp = 0
  for (const message of messages) {
    if (message.sender === 'USER') {
      latestUserTimestamp = Math.max(latestUserTimestamp, Number(message.timestamp) || 0)
    }
  }
  return messages.some(message =>
    message.sender === 'AGENT' &&
    !message.streaming &&
    (Number(message.timestamp) || 0) >= latestUserTimestamp
  )
}

export const appendHallEventMessage = (state, event) => {
  if (!event || typeof event.conversationId !== 'string' || typeof state.conversationId !== 'string' || event.conversationId !== state.conversationId) {
    return { type: 'ignored' }
  }
  if (event.type === 'agent_message_delta') {
    let pendingMessage = currentStreamingAgentMessage(state.messages, event)
    if (!pendingMessage) {
      pendingMessage = {
        localId: `delta-${event.agentId || 'agent'}-${event.timestamp || Date.now()}`,
        sender: 'AGENT',
        senderName: event.senderName,
        agentId: event.agentId,
        content: '',
        timestamp: event.timestamp || Date.now(),
        streaming: true,
        statusText: '正在回话'
      }
      state.messages.push(pendingMessage)
    }
    pendingMessage.content += event.content || ''
    pendingMessage.timestamp = event.timestamp || pendingMessage.timestamp
    pendingMessage.senderName = event.senderName || pendingMessage.senderName
    pendingMessage.streaming = true
    pendingMessage.statusText = '正在回话'
    state.isAwaitingReply = false
    return { type: 'delta', message: pendingMessage }
  }

  const localId = `${event.messageId || `${event.agentId}-${event.timestamp || Date.now()}`}`
  const streamingMessage = event.senderType === 'agent' ? currentStreamingAgentMessage(state.messages, event) : null
  if (streamingMessage && event.senderType === 'agent') {
    streamingMessage.localId = localId
    streamingMessage.content = event.content || streamingMessage.content
    streamingMessage.timestamp = event.timestamp || streamingMessage.timestamp
    streamingMessage.senderName = event.senderName || streamingMessage.senderName
    streamingMessage.agentId = event.agentId || streamingMessage.agentId
    streamingMessage.streaming = false
    streamingMessage.statusText = '回话已毕'
    state.isAwaitingReply = false
    state.isStreaming = false
    return { type: 'final', message: streamingMessage, shouldStopPolling: true, toastName: event.senderName }
  }
  if (state.messages.some(message => message.localId === localId)) {
    return { type: 'duplicate' }
  }

  const message = {
    localId,
    sender: event.senderType === 'agent' ? 'AGENT' : (event.messageType || 'ASSISTANT'),
    senderName: event.senderName,
    agentId: event.agentId,
    content: event.content || '',
    timestamp: event.timestamp || Date.now(),
    streaming: false,
    statusText: event.type === 'agent_message' ? '回话已毕' : ''
  }
  state.messages.push(message)
  state.isAwaitingReply = false
  state.isStreaming = false
  if (event.senderType === 'agent' && event.type === 'agent_message') {
    return { type: 'final', message, shouldStopPolling: true, toastName: event.senderName }
  }
  return { type: 'message', message, shouldStopPolling: true, toastName: event.senderName }
}

export const appendStreamPayload = (state, eventData) => {
  let payload = eventData.startsWith('data:') ? eventData.slice(5).trim() : eventData.trim()
  if (!payload || payload === '[DONE]' || payload === '[EOM]') return { type: 'empty' }

  try {
    const data = JSON.parse(payload)
    if (data.agentDelivery) {
      const agentId = data.agentDelivery.agentId || 'agent'
      const delivered = data.agentDelivery.delivered === true
      const message = {
        localId: `delivery-${agentId}-${Date.now()}`,
        sender: 'SYSTEM',
        content: delivered ? '传令已递到目标好汉处。' : '目标好汉暂未候令，传令未达。',
        timestamp: Date.now(),
        streaming: false,
        statusText: delivered ? '已递到' : '未递到'
      }
      state.messages.push(message)
      return { type: 'delivery', message }
    }
    if (data.type === 'agent_message_delta' || data.type === 'agent_message') {
      return appendHallEventMessage(state, data)
    }
    if (Object.prototype.hasOwnProperty.call(data, 'conversationId')) {
      if (typeof data.conversationId !== 'string' || !data.conversationId || typeof state.conversationId !== 'string') {
        return { type: 'invalid_conversation' }
      }
      const conversationId = data.conversationId
      const previousConversationId = state.conversationId
      const shouldReconnect = conversationId !== previousConversationId
      state.conversationId = conversationId
      return { type: 'conversation', conversationId, shouldReconnect }
    }
    payload = data.v || data.content || ''
  } catch {
    // plain text stream
  }

  if (!payload) return { type: 'empty' }
  const last = state.messages[state.messages.length - 1]
  if (last?.sender === 'ASSISTANT') {
    last.content += payload
    return { type: 'assistant', message: last }
  }
  const message = {
    localId: `assistant-${Date.now()}`,
    sender: 'ASSISTANT',
    content: payload,
    timestamp: Date.now(),
    streaming: false,
    statusText: ''
  }
  state.messages.push(message)
  return { type: 'assistant', message }
}
