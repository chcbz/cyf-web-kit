import { canonicalWireString } from './hallConversationMessages.js'

const nextLine = buffer => {
  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index]
    if (char === '\n') return { line: buffer.slice(0, index), rest: buffer.slice(index + 1) }
    if (char === '\r') {
      if (index + 1 === buffer.length) return null
      return { line: buffer.slice(0, index), rest: buffer.slice(index + (buffer[index + 1] === '\n' ? 2 : 1)) }
    }
  }
  return null
}

const emptyFrame = () => ({ hasId: false, id: '', data: [] })
const canonicalField = (event, key, options) => {
  if (!Object.hasOwn(event, key)) return { present: false, value: '' }
  return { present: true, value: canonicalWireString(event[key], options) }
}

export const createHallSseParser = ({ conversationId, onEvent, onCursor, onInvalid }) => {
  let buffer = ''
  let failed = false
  let frame = emptyFrame()
  const invalid = reason => {
    failed = true
    onInvalid?.(reason)
    frame = emptyFrame()
    return false
  }
  const dispatch = () => {
    if (!frame.data.length) {
      frame = emptyFrame()
      return true
    }
    const id = frame.hasId ? canonicalWireString(frame.id) : ''
    if (frame.hasId && !id) return invalid('invalid_event_id')
    let event
    try {
      event = JSON.parse(frame.data.join('\n'))
    } catch {
      return invalid('invalid_json')
    }
    if (!event || Array.isArray(event) || typeof event !== 'object') return invalid('invalid_event')
    if (event.type !== 'stream_ready') {
      if (!Object.hasOwn(event, 'conversationId')) event.conversationId = conversationId
      else if (event.conversationId !== conversationId) return invalid('conversation_conflict')
    }

    const sequence = canonicalField(event, 'eventSequence')
    if (sequence.present && !sequence.value) return invalid('invalid_event_sequence')
    if (id && sequence.value && id !== sequence.value) return invalid('event_sequence_conflict')
    for (const [key, allowZero] of [
      ['eventVersion', false], ['requestRevision', false], ['stateVersion', true], ['deltaSeq', false],
      ['lastDeltaSeq', true], ['messageId', false], ['occurredAt', false], ['finalSeq', true],
      ['expectedDeltaSeq', false], ['receivedDeltaSeq', false]
    ]) {
      const field = canonicalField(event, key, { allowZero })
      if (field.present && !field.value) return invalid(`invalid_${key}`)
    }

    const cursor = canonicalField(event, 'cursor', { allowZero: true })
    const nextCursor = canonicalField(event, 'nextCursor', { allowZero: true })
    if (cursor.present && !cursor.value) return invalid('invalid_cursor')
    if (nextCursor.present && !nextCursor.value) return invalid('invalid_cursor')
    if (cursor.value && nextCursor.value && cursor.value !== nextCursor.value) return invalid('cursor_conflict')
    const readyCursor = nextCursor.value || cursor.value
    if (readyCursor && ((id && id !== readyCursor) || (sequence.value && sequence.value !== readyCursor))) {
      return invalid('cursor_conflict')
    }
    const candidate = sequence.value || id || readyCursor
    if (onEvent?.(event) === false) return invalid('event_rejected')
    if (candidate) onCursor?.(candidate)
    frame = emptyFrame()
    return true
  }
  const consume = line => {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return true
    if (line.startsWith('id:')) {
      frame.hasId = true
      frame.id = line.slice(3).replace(/^ /, '')
      return true
    }
    if (line.startsWith('data:')) {
      frame.data.push(line.slice(5).replace(/^ /, ''))
      return true
    }
    return true
  }
  return {
    push (chunk) {
      if (failed) return
      buffer += String(chunk || '')
      let parsed
      while ((parsed = nextLine(buffer))) {
        buffer = parsed.rest
        consume(parsed.line)
      }
    },
    finish () {
      if (failed) return
      if (buffer.endsWith('\r')) {
        consume(buffer.slice(0, -1))
        buffer = ''
      } else if (buffer) {
        consume(buffer)
        buffer = ''
      }
      if (frame.data.length) dispatch()
    }
  }
}
