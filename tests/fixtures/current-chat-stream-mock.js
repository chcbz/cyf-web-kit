// Maintained business tests use the current transport, independently of production codecs.
// The public envelope decoder has its own malformed/association/EOF regressions.
export function currentChatStreamMock(api) {
  if (!api?.create) return api
  return Object.assign(Object.create(api), { create: (path, body, options = {}) => {
    if (path !== '/stream') return api.create(path, body, options)
    const requestId = 'test-transport'; let sequence = 0; let started = false; let conversationId; let opened = false; let ended = false
    const response = { headers: new Headers({ 'x-request-id': requestId }) }
    const frame = data => {
      const type = data.type === 'stream_started' ? 'chat.stream.started' : data.type === 'stream_completed' ? 'chat.stream.completed'
        : Object.hasOwn(data, 'error') ? 'chat.stream.error' : Object.hasOwn(data, 'v') ? 'chat.stream.delta'
          : Object.hasOwn(data, 't') ? 'chat.stream.title' : data.type === 'agent_message' ? 'chat.message'
            : data.type === 'agent_message_delta' ? 'chat.message.delta' : 'chat.stream.event'
      if (Object.hasOwn(data, 'occurredAt')) data = { ...data, occurredAt: Number(data.occurredAt) }
      return `data:${JSON.stringify({ protocolVersion: 1, requestId, messageType: type, messageId: `test-${++sequence}`, data })}`
    }
    const start = data => {
      if (started) return
      conversationId = data?.conversationId || body?.conversationId || 'test-conversation'
      if (!opened) { options.onStreamOpen?.({ cancel() {} }, response); opened = true }
      options.onStream?.(frame({ type: 'stream_started', conversationId }))
      started = true
    }
    const fixtureOptions = { ...options,
      onStreamOpen: (handle, given = response) => { opened = true; options.onStreamOpen?.(handle, given.headers ? given : response) },
      onStream: raw => {
        let data = raw
        if (typeof raw === 'string') {
          const value = raw.replace(/^data:\s*/, '')
          try { data = JSON.parse(value) } catch { data = { v: value } }
        }
        start(data); options.onStream?.(frame(data))
      },
      onStreamEnd: () => { if (!ended) { start(); options.onStream?.(frame({ type: 'stream_completed', conversationId })); ended = true }; options.onStreamEnd?.() }
    }
    return api.create(path, body, fixtureOptions)
  } })
}

export function conversationFrame(event, sequence, requestId = 'test-events') {
  const data = { ...event, occurredAt: Number(event.occurredAt || 1000) }
  const ready = event.type === 'stream_ready'
  const messageType = ready ? 'conversation.stream.ready' : 'conversation.event'
  const messageId = `conversation:${event.conversationId}:${ready ? 'ready:fixture' : sequence}`
  return `event: ${messageType}\nid: ${messageId}\ndata: ${JSON.stringify({ protocolVersion: 1, requestId, messageType, messageId, data })}\n\n`
}
