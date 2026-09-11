const JAVA_LONG_MAX = '9223372036854775807'

export const exactHallConversationId = value => {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value) &&
    (value.length < JAVA_LONG_MAX.length || (value.length === JAVA_LONG_MAX.length && value <= JAVA_LONG_MAX))) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  return ''
}

export const normalizeHallConversationHistory = (conversation, scope) => {
  const id = exactHallConversationId(conversation?.id)
  if (!id || !scope || conversation?.conversationType !== 'juyiting' ||
    conversation?.conversationScopeType !== scope.type || conversation?.conversationScopeKey !== scope.key) return null

  return Object.freeze({
    id,
    title: typeof conversation.title === 'string' && conversation.title.trim() ? conversation.title.trim() : '未题话头',
    updateTime: conversation.updateTime ?? conversation.createTime ?? null
  })
}
