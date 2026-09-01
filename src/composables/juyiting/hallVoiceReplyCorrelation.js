const exactMessageIds = messages => new Set((Array.isArray(messages) ? messages : [])
  .map(message => message?.localId)
  .filter(id => typeof id === 'string' && id.length > 0))

export const createHallVoiceReplyCorrelation = ({ onReply, spokenMessageIds = new Set() } = {}) => {
  let active = null

  const close = reason => {
    if (active) active.terminal = reason || 'closed'
    active = null
  }

  const start = ({ turnId, baselineSequence, messages, conversationIdBeforeSend }) => {
    if (active || typeof turnId !== 'string' || !Number.isSafeInteger(baselineSequence) || typeof conversationIdBeforeSend !== 'string') return false
    active = {
      turnId,
      sendTimestamp: Date.now(),
      baselineSequence,
      baselineMessageIds: exactMessageIds(messages),
      conversationIdBeforeSend,
      conversationIdAfterSend: conversationIdBeforeSend || null,
      terminal: null
    }
    return true
  }

  const resolveConversation = conversationId => {
    if (!active || typeof conversationId !== 'string' || !conversationId) return false
    if (active.conversationIdAfterSend && active.conversationIdAfterSend !== conversationId) {
      close('conversation_mismatch')
      return false
    }
    active.conversationIdAfterSend = conversationId
    return true
  }

  const observe = payload => {
    if (!active || !payload || !['stream_end', 'agent_event', 'poll_final'].includes(payload.source)) return false
    const messageId = payload.messageId
    const conversationId = payload.conversationId
    if (!Number.isSafeInteger(payload.sequence) || payload.sequence <= active.baselineSequence) return false
    if (typeof messageId !== 'string' || !messageId || active.baselineMessageIds.has(messageId) || spokenMessageIds.has(messageId)) return false
    if (typeof conversationId !== 'string' || !conversationId || !active.conversationIdAfterSend || conversationId !== active.conversationIdAfterSend) return false
    if (!payload.message || typeof payload.message.content !== 'string' || !payload.message.content.trim()) return false
    spokenMessageIds.add(messageId)
    const completed = { ...active, finalMessageId: messageId, terminal: 'reply_finalized' }
    active = null
    onReply?.(payload.message, completed, payload)
    return true
  }

  return {
    close,
    observe,
    resolveConversation,
    start,
    hasActive: () => Boolean(active),
    snapshot: () => active ? { ...active, baselineMessageIds: new Set(active.baselineMessageIds) } : null
  }
}
