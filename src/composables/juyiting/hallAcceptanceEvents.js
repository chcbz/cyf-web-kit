import { createHallSseParser } from './hallConversationSse.js'

// These durable events can change the existing request/output catalogue. Preview
// text is intentionally absent: accepting a delta must never cause a REST read.
const projectionEvents = new Set([
  'agent_message', 'part.processing', 'part.ready', 'part.failed', 'typed_question_answered',
  'interaction.state_changed',
  'delivery_submission_completed', 'execution_abandoned', 'execution_terminal',
  'action_started', 'action_failed', 'target_capability_unavailable', 'cancel_requested',
  'resync_required'
])
export const isAcceptanceProjectionEvent = event => projectionEvents.has(event?.type)

// One already-authenticated connection, not another transport/retry framework.
// The owner supplies authentication, cursor/reconnect and visibility lifecycle.
// Replay precedes ready on the existing API: read the current projection once at
// ready, rather than issuing a catalogue request for every historical message.
export async function readHallAcceptanceEvents ({ response, conversationId, signal, onRefresh, onCursor }) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
  if (!response?.ok || !response.body) {
    const error = new Error(`Acceptance event stream failed: ${response?.status || 0}`)
    error.status = response?.status || 0
    throw error
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let ready = false
  let invalid = null
  let cancelPromise = null
  const cancel = () => {
    // The primary read/abort error remains authoritative; cancellation is cleanup.
    if (!cancelPromise) cancelPromise = reader.cancel().catch(() => {})
    return cancelPromise
  }
  const current = () => !signal?.aborted && !invalid
  const parser = createHallSseParser({
    conversationId, requestId: response.headers.get('X-Request-Id'),
    onEvent: event => {
      if (!current()) return false
      if (event.type === 'stream_ready') {
        ready = true
        onRefresh(event)
      } else if (ready && isAcceptanceProjectionEvent(event)) onRefresh(event)
      return true
    },
    onCursor: cursor => { if (current()) onCursor?.(cursor) },
    onInvalid: reason => { invalid = new Error(`Invalid acceptance event: ${reason}`); void cancel() }
  })
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (current()) {
      const { done, value } = await reader.read()
      if (!current()) break
      if (done) { parser.push(decoder.decode()); parser.finish(); break }
      parser.push(decoder.decode(value, { stream: true }))
    }
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
    if (invalid) throw invalid
    // EOF is not task completion; the owner must reconnect, never mark it done.
    throw new Error('Acceptance event stream ended')
  } finally {
    signal?.removeEventListener('abort', cancel)
    await cancel()
    reader.releaseLock()
  }
}
