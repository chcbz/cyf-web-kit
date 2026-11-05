import { expect } from 'chai'
import { eventMessage } from '../src/utils/messageEnvelope.js'
import { readHallAcceptanceEvents } from '../src/composables/juyiting/hallAcceptanceEvents.js'

const event = (type, sequence, conversationId = '42') => eventMessage('request-test', 'conversation.event', `conversation:${conversationId}:${sequence}`,
  { type, conversationId, eventSequence: String(sequence), occurredAt: 1000 })
const frame = message => `event: ${message.messageType}\nid: ${message.messageId}\ndata: ${JSON.stringify(message)}\n\n`
const ready = () => frame(eventMessage('request-test', 'conversation.stream.ready', 'conversation:42:ready:fixture',
  { type: 'stream_ready', conversationId: '42', cursor: '2', nextCursor: '2' }))
const preview = () => {
  const message = eventMessage('request-test', 'conversation.preview', 'preview:stream-a:1', {
    type: 'agent_message_delta', conversationId: '42', conversationGeneration: '1', turnId: 'turn-a',
    requestId: 'request-a', agentId: 'agent-a', streamOutcomeKind: 'ANSWER', streamId: 'stream-a', deltaSeq: '1', content: '你好', occurredAt: 1000
  })
  return `event: ${message.messageType}\ndata: ${JSON.stringify(message)}\n\n`
}
const fixture = () => {
  let stream; let cancelled = 0
  const body = new ReadableStream({ start: controller => { stream = controller }, cancel: () => { cancelled++ } })
  const response = { ok: true, status: 200, headers: new Headers({ 'X-Request-Id': 'request-test' }), body }
  return { response, push: text => stream.enqueue(new TextEncoder().encode(text)), end: () => stream.close(), cancelled: () => cancelled }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

describe('acceptance event reader (no request polling)', () => {
  it('collapses historical replay to one ready refresh and ignores preview/heartbeat events', async () => {
    const f = fixture(); const controller = new AbortController(); const refresh = []; const cursors = []
    const result = readHallAcceptanceEvents({ response: f.response, conversationId: '42', signal: controller.signal,
      onRefresh: e => refresh.push(e.type), onCursor: c => cursors.push(c) }).catch(e => e)
    f.push(frame(event('agent_message', 1)) + frame(event('execution_terminal', 2)))
    await settle(); expect(refresh).to.deep.equal([])
    f.push(ready() + preview() + ': heartbeat\n\n'); await settle()
    expect(refresh).to.deep.equal(['stream_ready']); expect(cursors).to.deep.equal(['1', '2', '2'])
    f.push(frame(event('agent_message', 3)) + frame(event('execution_terminal', 4)))
    await settle(); expect(refresh).to.deep.equal(['stream_ready', 'agent_message', 'execution_terminal'])
    controller.abort(); expect((await result).name).to.equal('AbortError'); expect(f.cancelled()).to.equal(1)
  })
  it('refreshes on resync and failure, not on unrelated durable events', async () => {
    const f = fixture(); const refresh = []; const controller = new AbortController()
    const result = readHallAcceptanceEvents({ response: f.response, conversationId: '42', signal: controller.signal,
      onRefresh: e => refresh.push(e.type) }).catch(e => e)
    f.push(ready() + frame(event('unrelated.fixture_event', 3)) + frame(event('resync_required', 4)) + frame(event('part.failed', 5)))
    await settle(); expect(refresh).to.deep.equal(['stream_ready', 'resync_required', 'part.failed'])
    controller.abort(); await result
  })
  it('refreshes admitted interactions even before the first reply exists', async () => {
    const f = fixture(); const refresh = []; const controller = new AbortController()
    const result = readHallAcceptanceEvents({ response: f.response, conversationId: '42', signal: controller.signal,
      onRefresh: e => refresh.push(e.type) }).catch(e => e)
    f.push(ready() + frame(event('interaction.state_changed', 3)))
    await settle(); expect(refresh).to.deep.equal(['stream_ready', 'interaction.state_changed'])
    controller.abort(); await result
  })
  it('rejects foreign conversation frames without refreshing or committing their cursor', async () => {
    const f = fixture(); const refresh = []; const cursors = []
    const result = readHallAcceptanceEvents({ response: f.response, conversationId: '42',
      onRefresh: e => refresh.push(e), onCursor: c => cursors.push(c) }).catch(e => e)
    f.push(frame(event('agent_message', 1, '43')))
    expect((await result).message).to.include('conversation_conflict')
    expect(refresh).to.deep.equal([]); expect(cursors).to.deep.equal([]); expect(f.cancelled()).to.equal(1)
  })
  it('cancels blocked reads on context teardown and does not signal completion on EOF', async () => {
    const f = fixture(); const controller = new AbortController(); let refresh = 0
    const result = readHallAcceptanceEvents({ response: f.response, conversationId: '42', signal: controller.signal,
      onRefresh: () => refresh++ }).catch(e => e)
    controller.abort(); expect((await result).name).to.equal('AbortError'); expect(refresh).to.equal(0)
    const ended = fixture(); ended.end()
    const failure = await readHallAcceptanceEvents({ response: ended.response, conversationId: '42', onRefresh: () => refresh++ }).catch(e => e)
    expect(failure.message).to.equal('Acceptance event stream ended'); expect(refresh).to.equal(0)
  })
  it('preserves HTTP failure status for the existing transport owner', async () => {
    const failure = await readHallAcceptanceEvents({ response: { ok: false, status: 403 }, conversationId: '42' }).catch(e => e)
    expect(failure.status).to.equal(403)
  })
})


it('review progress invalidates existing acceptance projections without declaring task completion', async () => {
  const { isAcceptanceProjectionEvent } = await import('../src/composables/juyiting/hallAcceptanceEvents.js')
  expect(isAcceptanceProjectionEvent({ type: 'delivery_review_changed' })).to.equal(true)
  expect(isAcceptanceProjectionEvent({ type: 'agent_message_delta' })).to.equal(false)
})
