import test from 'node:test'
import assert from 'node:assert/strict'
import { eventMessage } from '../src/utils/messageEnvelope.js'
import { decodeChatStreamFrame } from '../src/utils/chatStreamWire.js'
const wire = (data, type = 'chat.stream.event', requestId = 'transport') => `data:${JSON.stringify(eventMessage(requestId, type, 'event-1', data))}`
test('POST stream decodes one envelope and preserves durable request identity and Long versions', () => {
  const result = decodeChatStreamFrame(wire({ requestId: 'durable', eventVersion: '9007199254740993', occurredAt: 1000 }), 'transport')
  assert.deepEqual(result, { requestId: 'durable', eventVersion: '9007199254740993', occurredAt: '1000' })
})
test('content and escaped titles remain exact', () => {
  for (const [key, type] of [['v', 'chat.stream.delta'], ['t', 'chat.stream.title']]) {
    const text = '中文\n"title"\\token'
    assert.equal(decodeChatStreamFrame(wire({ [key]: text }, type), 'transport')[key], text)
  }
})
test('old roots, plain content, wrong association, wrong type, public string times and failure events are rejected', () => {
  for (const line of ['data:{"v":"old"}', 'plain content', '[DONE]', wire({ v: 'x' }, 'chat.stream.delta', 'wrong'),
    wire({ v: 'x' }), wire({ occurredAt: '1000' }), wire({ occurredAt: -1 }), wire({ error: 'internal' }, 'chat.stream.error'),
    wire({ v: 123 }, 'chat.stream.delta')]) assert.throws(() => decodeChatStreamFrame(line, 'transport'), undefined, line)
})

test('actual HTTP helper validates response association before emitting decoded chunks', async () => {
  const { useHttp } = await import('../src/composables/useHttp.js')
  const original = globalThis.fetch
  try {
    let requestId
    const events = []
    globalThis.fetch = async (_url, config) => {
      const request = JSON.parse(config.body)
      assert.deepEqual(request.data, { content: 'hello' })
      const text = wire({ v: 'first' }, 'chat.stream.delta', request.requestId) + '\n\n' +
        wire({ v: '中文' }, 'chat.stream.delta', request.requestId) + '\n\n'
      const bytes = new TextEncoder().encode(text)
      // Force UTF-8 and line boundaries to span network chunks.
      return new Response(new ReadableStream({ start (controller) {
        for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7))
        controller.close()
      } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': request.requestId } })
    }
    await useHttp({ url: '/chat/stream', method: 'POST', needAuth: false, rum: false, responseType: 'stream', data: { content: 'hello' },
      onStreamOpen: (_handle, response) => { requestId = response.headers.get('x-request-id') },
      onStream: line => events.push(decodeChatStreamFrame(line, requestId)) }).execute()
    assert.deepEqual(events, [{ v: 'first' }, { v: '中文' }])
    let opened = false
    globalThis.fetch = async () => new Response(wire({ v: 'bad' }, 'chat.stream.delta'), { headers: { 'x-request-id': 'wrong' } })
    await assert.rejects(useHttp({ url: '/chat/stream', needAuth: false, rum: false, responseType: 'stream',
      onStreamOpen: () => { opened = true } }).execute(), error => error.code === 'PROTOCOL_REQUEST_ID_MISMATCH')
    assert.equal(opened, false)
  } finally { globalThis.fetch = original }
})

test('malformed public stream never invokes the successful stream-end callback', async () => {
  const { useHttp } = await import('../src/composables/useHttp.js')
  const original = globalThis.fetch
  try {
    let requestId; let ended = false
    globalThis.fetch = async (_url, config) => new Response('data:{"v":"legacy"}\n\n', { headers: {
      'content-type': 'text/event-stream', 'x-request-id': config.headers['X-Request-Id']
    } })
    await assert.rejects(useHttp({ url: '/chat/stream', needAuth: false, rum: false, responseType: 'stream',
      onStreamOpen: (_handle, response) => { requestId = response.headers.get('x-request-id') },
      onStream: line => decodeChatStreamFrame(line, requestId), onStreamEnd: () => { ended = true } }).execute())
    assert.equal(ended, false)
  } finally { globalThis.fetch = original }
})

test('stream lifecycle distinguishes a real terminal frame from transport EOF or cancellation', async () => {
  const { createChatStreamDecoder } = await import('../src/utils/chatStreamWire.js')
  const started = wire({ type: 'stream_started', conversationId: '42' }, 'chat.stream.started')
  const completed = wire({ type: 'stream_completed', conversationId: '42' }, 'chat.stream.completed')
  const decoder = createChatStreamDecoder()
  assert.equal(decoder.accept(started, 'transport'), null)
  assert.deepEqual(decoder.accept(wire({ v: 'hello' }, 'chat.stream.delta'), 'transport'), { v: 'hello' })
  assert.equal(decoder.accept(completed, 'transport'), null)
  decoder.finish()
  assert.throws(() => decoder.accept(completed, 'transport'))
  for (const frames of [[], [started], [started, wire({ v: 'partial' }, 'chat.stream.delta')]]) {
    const incomplete = createChatStreamDecoder()
    for (const frame of frames) incomplete.accept(frame, 'transport')
    assert.throws(() => incomplete.finish(), error => error.code === 'CHAT_STREAM_INCOMPLETE')
  }
  assert.throws(() => createChatStreamDecoder().accept(completed, 'transport'))
  const mismatch = createChatStreamDecoder(); mismatch.accept(started, 'transport')
  assert.throws(() => mismatch.accept(wire({ conversationId: '43' }), 'transport'))
})
