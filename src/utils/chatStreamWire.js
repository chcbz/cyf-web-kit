import { decodeMessage } from './messageEnvelope.js'
import { protocolError } from './apiEnvelope.js'

const messageTypes = new Set([
  'chat.stream.delta', 'chat.stream.title', 'chat.stream.error', 'chat.stream.event',
  'chat.message', 'chat.message.delta'
])

// /chat/stream uses data-only SSE frames (no resumable id/event). Durable recovery
// still goes through the separately scoped conversation event stream and readback.
export function decodeChatStreamFrame (line, requestId) {
  if (typeof line !== 'string' || !line.startsWith('data:')) throw protocolError('CHAT_STREAM_INVALID_FRAME')
  const message = decodeMessage(line.slice(5).replace(/^ /, ''))
  if (Object.hasOwn(message, 'correlationId') || !messageTypes.has(message.messageType) ||
      typeof requestId !== 'string' || message.requestId !== requestId ||
      !message.data || typeof message.data !== 'object' || Array.isArray(message.data)) {
    throw protocolError('CHAT_STREAM_INVALID_MESSAGE')
  }
  const data = { ...message.data }
  const expectedType = Object.hasOwn(data, 'error') ? 'chat.stream.error'
    : Object.hasOwn(data, 'v') ? 'chat.stream.delta'
      : Object.hasOwn(data, 't') ? 'chat.stream.title'
        : data.type === 'agent_message' ? 'chat.message'
          : data.type === 'agent_message_delta' ? 'chat.message.delta' : 'chat.stream.event'
  if (message.messageType !== expectedType ||
      Object.hasOwn(data, 'v') && typeof data.v !== 'string' ||
      Object.hasOwn(data, 't') && typeof data.t !== 'string') throw protocolError('CHAT_STREAM_INVALID_DATA')
  if (Object.hasOwn(data, 'occurredAt')) {
    if (!Number.isSafeInteger(data.occurredAt) || data.occurredAt < 0) throw protocolError('CHAT_STREAM_INVALID_TIME')
    // Existing UI reducers consume a decimal timestamp; never coerce the wire input.
    data.occurredAt = String(data.occurredAt)
  }
  if (message.messageType === 'chat.stream.error') throw protocolError('CHAT_STREAM_FAILED')
  return data
}
