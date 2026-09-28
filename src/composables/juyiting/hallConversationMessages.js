import { applyMessagePartEvent, isMessagePartEvent, mergeMessageParts } from './hallMessageParts.js'
import { isOwnMessage, normalizeDisplayName, resolveAccountDisplayName, resolveDisplayName } from '../../utils/displayName.js'

export const parseMessageMetadata = (metadata) => {
  if (!metadata) return {}
  if (typeof metadata === 'object') return metadata
  try {
    return JSON.parse(metadata)
  } catch {
    return {}
  }
}

export const normalizeSenderName = (value) => normalizeDisplayName(value)

export const resolveHallUserSenderName = (user) => resolveAccountDisplayName(user, '你')

const hallMessageSender = (message) => {
  const messageType = String(message?.messageType || '').toLowerCase()
  const senderType = String(message?.senderType || '').toLowerCase()
  if (senderType === 'agent' || messageType === 'agent') return 'AGENT'
  if (messageType === 'user') return 'USER'
  if (messageType === 'assistant') return 'ASSISTANT'
  if (messageType === 'system') return 'SYSTEM'
  if (senderType === 'user') return 'USER'
  if (senderType === 'system') return 'SYSTEM'
  if (senderType === 'assistant') return 'ASSISTANT'
  return String(message?.messageType || message?.senderType || 'SYSTEM').toUpperCase()
}

const fallbackSenderName = (sender, value) => {
  const fallback = sender === 'USER' ? '用户' : (sender === 'AGENT' ? '好汉' : '传令牌')
  return resolveDisplayName(value, fallback)
}

export const normalizeHallMessage = (item, identity) => {
  const metadata = parseMessageMetadata(item.metadata)
  const localId = typeof item?.id === 'string' && item.id
    ? item.id
    : (typeof metadata.messageId === 'string' && metadata.messageId ? metadata.messageId : '')
  if (!localId) return null
  const sender = hallMessageSender(item)
  const isSelf = sender === 'USER' && isOwnMessage({ ...item, isSelf: false }, identity)
  return {
    localId,
    sender,
    senderName: isSelf ? '你' : fallbackSenderName(sender, normalizeSenderName(item.senderName) || normalizeSenderName(metadata.senderName)),
    agentId: metadata.agentId,
    jiacn: item.jiacn,
    ownerJiacn: item.ownerJiacn,
    isSelf,
    content: item.content || '',
    parts: mergeMessageParts([], Array.isArray(item.parts) ? item.parts : []),
    timestamp: item.createTime || metadata.timestamp || Date.now(),
    streaming: false,
    statusText: ''
  }
}

const JAVA_LONG_MAX = '9223372036854775807'

export const canonicalWireString = (value, { allowZero = false } = {}) => {
  if (typeof value !== 'string') return ''
  if (!(allowZero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(value)) return ''
  if (value.length > JAVA_LONG_MAX.length || (value.length === JAVA_LONG_MAX.length && value > JAVA_LONG_MAX)) return ''
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
  const current = state.turnStates.get(turnId) || { lastDeltaSeq: '0', waitingFinal: false, terminal: false }
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

export const appendHallEventMessage = (state, event, identity) => {
  if (!event || typeof event.conversationId !== 'string' || typeof state.conversationId !== 'string' || event.conversationId !== state.conversationId) {
    return { type: 'ignored' }
  }
  if (isMessagePartEvent(event)) return applyMessagePartEvent(state, event)
  const sender = event.type?.startsWith('agent_message') ? 'AGENT' : hallMessageSender(event)
  const isSelf = sender === 'USER' && isOwnMessage({ ...event, isSelf: false }, identity)
  const senderName = isSelf ? '你' : fallbackSenderName(sender, event.senderName)
  if (event.type === 'agent_message_delta') {
    const turnId = exactTurnId(event)
    const deltaSeq = exactDeltaSeq(event)
    // V2 deltas are valid only with canonical turnId + sequence. Legacy agents may omit both.
    if ((turnId || event.deltaSeq !== undefined) && (!turnId || !deltaSeq)) return { type: 'invalid_delta' }
    const tracker = turnState(state, turnId)
    if (tracker?.terminal) return { type: 'late_delta', turnId }
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

  if (event.type === 'resync_required') {
    const turnId = exactTurnId(event)
    if (!turnId) return { type: 'invalid_delta' }
    clearUntrustedTurnDelta(state, turnId)
    return { type: 'resync_required', turnId }
  }

  const isAgentFinal = event.senderType === 'agent' && event.type === 'agent_message'
  if (isAgentFinal && (typeof event.messageId !== 'string' || !event.messageId)) {
    return { type: 'invalid_message_id' }
  }
  const localId = typeof event.messageId === 'string' && event.messageId
    ? event.messageId
    : `event-${event.agentId || 'message'}-${event.timestamp || Date.now()}`
  const streamingMessage = event.senderType === 'agent' ? currentStreamingAgentMessage(state.messages, event) : null
  const existing = state.messages.find(message => message.localId === localId)
  const finalTurnId = exactTurnId(event)
  if (finalTurnId) {
    const tracker = turnState(state, finalTurnId)
    if (tracker) { tracker.waitingFinal = false; tracker.terminal = true }
  }
  if (existing && event.senderType === 'agent') {
    if (!streamingMessage || streamingMessage === existing) {
      if (!existing.streaming) return { type: 'duplicate' }
    } else {
      state.messages.splice(state.messages.indexOf(streamingMessage), 1)
    }
    existing.content = event.content || existing.content
    existing.parts = mergeMessageParts(existing.parts, Array.isArray(event.parts) ? event.parts : [])
    existing.timestamp = event.timestamp || existing.timestamp
    existing.senderName = senderName || existing.senderName
    existing.agentId = event.agentId || existing.agentId
    existing.turnId = finalTurnId || existing.turnId
    existing.streaming = false
    existing.statusText = '回话已毕'
    if (!state.manageTurnBusy) { state.isAwaitingReply = false; state.isStreaming = false }
    return { type: 'final', message: existing, shouldStopPolling: true, toastName: senderName }
  }
  if (streamingMessage && event.senderType === 'agent') {
    streamingMessage.localId = localId
    streamingMessage.content = event.content || streamingMessage.content
    streamingMessage.parts = mergeMessageParts(streamingMessage.parts, Array.isArray(event.parts) ? event.parts : [])
    streamingMessage.timestamp = event.timestamp || streamingMessage.timestamp
    streamingMessage.senderName = senderName || streamingMessage.senderName
    streamingMessage.agentId = event.agentId || streamingMessage.agentId
    streamingMessage.turnId = finalTurnId || streamingMessage.turnId
    streamingMessage.streaming = false
    streamingMessage.statusText = '回话已毕'
    if (!state.manageTurnBusy) { state.isAwaitingReply = false; state.isStreaming = false }
    return { type: 'final', message: streamingMessage, shouldStopPolling: true, toastName: senderName }
  }

  const message = {
    localId,
    sender,
    senderName,
    agentId: event.agentId,
    jiacn: event.jiacn,
    ownerJiacn: event.ownerJiacn,
    isSelf,
    turnId: finalTurnId,
    content: event.content || '',
    parts: mergeMessageParts([], Array.isArray(event.parts) ? event.parts : []),
    timestamp: event.timestamp || Date.now(),
    streaming: false,
    statusText: event.type === 'agent_message' ? '回话已毕' : ''
  }
  state.messages.push(message)
  if (!state.manageTurnBusy) { state.isAwaitingReply = false; state.isStreaming = false }
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
  const senderName = fallbackSenderName('AGENT', event.senderName)
  const finalTurnId = exactTurnId(event)
  if (finalTurnId) { const tracker = turnState(state, finalTurnId); if (tracker) { tracker.waitingFinal = false; tracker.terminal = true } }
  const existing = state.messages.find(message => message.localId === event.messageId)
  // SSE can start the visible reply with a delta before this request stream delivers
  // its authoritative final. Promote that placeholder instead of adding a second row.
  const streamingMessage = currentStreamingAgentMessage(state.messages, event)
  const message = existing || streamingMessage || {
    localId: event.messageId,
    sender: 'AGENT',
    senderName,
    agentId: event.agentId,
    jiacn: event.jiacn,
    ownerJiacn: event.ownerJiacn,
    turnId: finalTurnId,
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
  message.parts = mergeMessageParts(message.parts, Array.isArray(event.parts) ? event.parts : [])
  message.timestamp = event.timestamp || message.timestamp
  message.streaming = false
  message.statusText = '回话已毕'
  if (!existing && !streamingMessage) state.messages.push(message)
  if (!state.manageTurnBusy) state.isAwaitingReply = false
  return {
    type: 'stream_final',
    message,
    conversationId: hasConversationId ? event.conversationId : null,
    toastName: senderName
  }
}

export const appendStreamPayload = (state, eventData, identity) => {
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
    if (data.type === 'agent_message_delta') return appendHallEventMessage(state, data, identity)
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
