export const parseMessageMetadata = (metadata) => {
  if (!metadata) return {}
  if (typeof metadata === 'object') return metadata
  try {
    return JSON.parse(metadata)
  } catch {
    return {}
  }
}

export const normalizeSenderName = (value) => {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim()
}

export const resolveHallUserSenderName = (user) => {
  return normalizeSenderName(user?.nickname) || normalizeSenderName(user?.username) || '你'
}

export const normalizeHallMessage = (item) => {
  const metadata = parseMessageMetadata(item.metadata)
  const localId = typeof item?.id === 'string' && item.id
    ? item.id
    : (typeof metadata.messageId === 'string' && metadata.messageId ? metadata.messageId : '')
  if (!localId) return null
  return {
    localId,
    sender: item.senderType === 'agent' ? 'AGENT' : (item.messageType || item.senderType || 'SYSTEM'),
    senderName: normalizeSenderName(item.senderName) || normalizeSenderName(metadata.senderName),
    agentId: metadata.agentId,
    content: item.content || '',
    timestamp: item.createTime || metadata.timestamp || Date.now(),
    streaming: false,
    statusText: ''
  }
}

export const canonicalWireString = (value, { allowZero = false } = {}) => {
  if (typeof value !== 'string') return ''
  if (!(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)) return ''
  return value
}

const exactTurnId = event => typeof event?.turnId === 'string' && event.turnId ? event.turnId : ''
const exactDeltaSeq = event => canonicalWireString(event?.deltaSeq)

export const currentStreamingAgentMessage = (messages, event) => {
  const turnId = exactTurnId(event)
  return messages.find(message =>
    message.sender === 'AGENT' && message.streaming &&
    (turnId ? message.turnId === turnId : (!message.turnId && (!event.agentId || message.agentId === event.agentId)))
  ) || null
}

export const clearUntrustedTurnDelta = (state, turnId) => {
  if (!turnId) return
  state.messages = state.messages.filter(message => !(message.streaming && message.turnId === turnId))
  state.turnStates?.set?.(turnId, { ...(state.turnStates.get(turnId) || {}), waitingFinal: true })
}

const turnState = (state, turnId) => {
  if (!turnId) return null
  if (!state.turnStates) state.turnStates = new Map()
  const current = state.turnStates.get(turnId) || { lastDeltaSeq: '0', waitingFinal: false }
  state.turnStates.set(turnId, current)
  return current
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
  const senderName = normalizeSenderName(event.senderName)
  if (event.type === 'agent_message_delta') {
    const turnId = exactTurnId(event)
    const deltaSeq = exactDeltaSeq(event)
    // V2 deltas are valid only with canonical turnId + sequence. Legacy agents may omit both.
    if ((turnId || event.deltaSeq !== undefined) && (!turnId || !deltaSeq)) return { type: 'invalid_delta' }
    const tracker = turnState(state, turnId)
    if (tracker?.waitingFinal) return { type: 'waiting_final', turnId }
    if (tracker) {
      const last = BigInt(tracker.lastDeltaSeq)
      const next = BigInt(deltaSeq)
      if (next <= last) return { type: 'duplicate_delta', turnId }
      if (next !== last + 1n) {
        clearUntrustedTurnDelta(state, turnId)
        return { type: 'resync_required', turnId }
      }
      tracker.lastDeltaSeq = deltaSeq
    }
    let pendingMessage = currentStreamingAgentMessage(state.messages, event)
    if (!pendingMessage) {
      pendingMessage = {
        localId: `delta-${turnId || event.agentId || 'agent'}-${event.timestamp || Date.now()}`,
        sender: 'AGENT', senderName, agentId: event.agentId, turnId,
        content: '', timestamp: event.timestamp || Date.now(), streaming: true,
        statusText: '正在回话'
      }
      state.messages.push(pendingMessage)
    }
    pendingMessage.content += event.content || ''
    pendingMessage.deltaSeq = deltaSeq || pendingMessage.deltaSeq
    pendingMessage.timestamp = event.timestamp || pendingMessage.timestamp
    pendingMessage.senderName = senderName || pendingMessage.senderName
    pendingMessage.streaming = true
    pendingMessage.statusText = '正在回话'
    state.isAwaitingReply = false
    return { type: 'delta', message: pendingMessage, turnId }
  }

  const isAgentFinal = event.senderType === 'agent' && event.type === 'agent_message'
  if (isAgentFinal && (typeof event.messageId !== 'string' || !event.messageId)) {
    return { type: 'invalid_message_id' }
  }
  const localId = typeof event.messageId === 'string' && event.messageId
    ? event.messageId
    : `event-${event.agentId || 'message'}-${event.timestamp || Date.now()}`
  const streamingMessage = event.senderType === 'agent' ? currentStreamingAgentMessage(state.messages, event) : null
  const finalTurnId = exactTurnId(event)
  if (finalTurnId) {
    const tracker = turnState(state, finalTurnId)
    if (tracker) tracker.waitingFinal = false
  }
  if (streamingMessage && event.senderType === 'agent') {
    streamingMessage.localId = localId
    streamingMessage.content = event.content || streamingMessage.content
    streamingMessage.timestamp = event.timestamp || streamingMessage.timestamp
    streamingMessage.senderName = senderName || streamingMessage.senderName
    streamingMessage.agentId = event.agentId || streamingMessage.agentId
    streamingMessage.turnId = finalTurnId || streamingMessage.turnId
    streamingMessage.streaming = false
    streamingMessage.statusText = '回话已毕'
    state.isAwaitingReply = false
    state.isStreaming = false
    return { type: 'final', message: streamingMessage, shouldStopPolling: true, toastName: senderName }
  }
  if (state.messages.some(message => message.localId === localId)) {
    return { type: 'duplicate' }
  }

  const message = {
    localId,
    sender: event.senderType === 'agent' ? 'AGENT' : (event.messageType || 'ASSISTANT'),
    senderName,
    agentId: event.agentId,
    turnId: finalTurnId,
    content: event.content || '',
    timestamp: event.timestamp || Date.now(),
    streaming: false,
    statusText: event.type === 'agent_message' ? '回话已毕' : ''
  }
  state.messages.push(message)
  state.isAwaitingReply = false
  state.isStreaming = false
  if (event.senderType === 'agent' && event.type === 'agent_message') {
    return { type: 'final', message, shouldStopPolling: true, toastName: senderName }
  }
  return { type: 'message', message, shouldStopPolling: true, toastName: senderName }
}

const appendStreamAgentFinal = (state, event) => {
  if (typeof event.messageId !== 'string' || !event.messageId) return { type: 'invalid_message_id' }
  const hasConversationId = Object.prototype.hasOwnProperty.call(event, 'conversationId')
  if (hasConversationId && (typeof event.conversationId !== 'string' || !event.conversationId)) {
    return { type: 'invalid_conversation' }
  }
  if (hasConversationId && state.conversationId && event.conversationId !== state.conversationId) {
    return { type: 'ignored' }
  }
  const senderName = normalizeSenderName(event.senderName)
  const finalTurnId = exactTurnId(event)
  if (finalTurnId) { const tracker = turnState(state, finalTurnId); if (tracker) tracker.waitingFinal = false }
  const existing = state.messages.find(message => message.localId === event.messageId)
  // SSE can start the visible reply with a delta before this request stream delivers
  // its authoritative final. Promote that placeholder instead of adding a second row.
  const streamingMessage = currentStreamingAgentMessage(state.messages, event)
  const message = existing || streamingMessage || {
    localId: event.messageId,
    sender: 'AGENT',
    senderName,
    agentId: event.agentId, turnId: finalTurnId,
    content: '',
    timestamp: event.timestamp || Date.now(),
    streaming: false,
    statusText: '回话已毕'
  }
  if (existing && streamingMessage && streamingMessage !== existing) {
    state.messages.splice(state.messages.indexOf(streamingMessage), 1)
  }
  message.localId = event.messageId
  message.sender = 'AGENT'
  message.senderName = senderName || message.senderName
  message.agentId = event.agentId || message.agentId
  message.turnId = finalTurnId || message.turnId
  message.content = event.content || message.content
  message.timestamp = event.timestamp || message.timestamp
  message.streaming = false
  message.statusText = '回话已毕'
  if (!existing && !streamingMessage) state.messages.push(message)
  state.isAwaitingReply = false
  return {
    type: 'stream_final',
    message,
    conversationId: hasConversationId ? event.conversationId : null,
    toastName: senderName
  }
}

export const appendStreamPayload = (state, eventData) => {
  let payload = eventData.startsWith('data:') ? eventData.slice(5).trim() : eventData.trim()
  if (!payload || payload === '[DONE]' || payload === '[EOM]') return { type: 'empty' }

  try {
    const data = JSON.parse(payload)
    if (data.agentDelivery) {
      let conversationId = null
      let shouldReconnect = false
      if (Object.prototype.hasOwnProperty.call(data, 'conversationId')) {
        if (typeof data.conversationId !== 'string' || !data.conversationId || typeof state.conversationId !== 'string') {
          return { type: 'invalid_conversation' }
        }
        conversationId = data.conversationId
        shouldReconnect = conversationId !== state.conversationId
        state.conversationId = conversationId
      }
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
      return { type: 'delivery', message, conversationId, shouldReconnect }
    }
    if (data.type === 'agent_message') return appendStreamAgentFinal(state, data)
    if (data.type === 'agent_message_delta') return appendHallEventMessage(state, data)
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
