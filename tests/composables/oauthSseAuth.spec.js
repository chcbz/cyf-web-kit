import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import {
  fetchChatConversationEvents,
  fetchHallConversationEvents
} from '../../src/utils/authenticatedSse.js'
import { stopIdentityBoundWork } from '../../src/utils/identityLifecycle.js'

async function expectNoUnauthenticatedFetch (openStream) {
  let fetchCount = 0
  const result = await openStream({
    apiStore: { token: async () => null },
    url: 'https://api.example/chat/conversation/events?id=1001',
    signal: new AbortController().signal,
    fetchImpl: async () => {
      fetchCount += 1
      throw new Error('fetch must not run without a token')
    }
  })
  expect(result).to.equal(null)
  expect(fetchCount).to.equal(0)
}

function streamFunctionSource (path, startMarker, endMarker) {
  const source = readFileSync(path, 'utf8')
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  expect(start).to.be.greaterThan(-1)
  expect(end).to.be.greaterThan(start)
  return source.slice(start, end)
}

describe('direct SSE authentication boundary', () => {
  let originalSetTimeout

  beforeEach(() => {
    originalSetTimeout = window.setTimeout
  })

  afterEach(() => {
    window.setTimeout = originalSetTimeout
  })

  it('behaviorally blocks Chat event fetch when token acquisition starts redirect and returns null', async () => {
    await expectNoUnauthenticatedFetch(fetchChatConversationEvents)

    const stream = streamFunctionSource(
      'src/components/chat/Chat.vue',
      'const startConversationEventStream = async () => {',
      '\n// 初始化'
    )
    expect(stream).to.include('await fetchChatConversationEvents({')
    expect(stream).to.match(/!response[\s\S]*?return/)
  })

  it('cleans a rejected token, starts authorization once, returns null, and never replays a 401', async () => {
    let fetchCount = 0
    let cleanCount = 0
    let authorizationCount = 0
    let reconnectTimerCount = 0
    window.setTimeout = () => {
      reconnectTimerCount += 1
      return 1
    }
    const apiStore = {
      token: async () => 'expired-token',
      cleanToken: () => { cleanCount += 1 },
      beginAuthorization: async () => { authorizationCount += 1 }
    }

    const result = await fetchChatConversationEvents({
      apiStore,
      url: 'https://api.example/chat/conversation/events?id=1001',
      signal: new AbortController().signal,
      fetchImpl: async () => {
        fetchCount += 1
        return new Response('', { status: 401 })
      }
    })

    expect(result).to.equal(null)
    expect(fetchCount).to.equal(1)
    expect(cleanCount).to.equal(1)
    expect(authorizationCount).to.equal(1)
    expect(reconnectTimerCount).to.equal(0)
  })

  it('single-flights concurrent Chat and Hall 401 reauthentication without replay or reconnect timers', async () => {
    let fetchCount = 0
    let cleanCount = 0
    let authorizationCount = 0
    let reconnectTimerCount = 0
    window.setTimeout = () => {
      reconnectTimerCount += 1
      return 1
    }
    const apiStore = {
      token: async () => 'expired-token',
      cleanToken: () => { cleanCount += 1 },
      beginAuthorization: async () => { authorizationCount += 1 }
    }
    const options = {
      apiStore,
      url: 'https://api.example/chat/conversation/events?id=1001',
      signal: new AbortController().signal,
      fetchImpl: async () => {
        fetchCount += 1
        return new Response('', { status: 401 })
      }
    }

    const results = await Promise.all([
      fetchChatConversationEvents(options),
      fetchHallConversationEvents(options)
    ])

    expect(results).to.deep.equal([null, null])
    expect(fetchCount).to.equal(2)
    expect(cleanCount).to.equal(2)
    expect(authorizationCount).to.equal(1)
    expect(reconnectTimerCount).to.equal(0)
  })

  it('behaviorally blocks Hall event fetch and returns before its recovery loop', async () => {
    await expectNoUnauthenticatedFetch(fetchHallConversationEvents)

    const stream = streamFunctionSource(
      'src/composables/juyiting/useHallConversation.js',
      'const startHallEventStream = async () => {',
      '\n  const stopHallEventStream = () => {'
    )
    expect(stream).to.include('await fetchHallConversationEvents({')
    expect(stream).to.match(/!response[\s\S]*?return/)
  })

  it('does not acquire a token for an already-aborted caller and releases lifecycle cleanup after the body ends', async () => {
    const caller = new AbortController()
    const reason = new DOMException('cancelled', 'AbortError')
    caller.abort(reason)
    let tokenCalls = 0
    let fetchCalls = 0
    let failure
    try {
      await fetchChatConversationEvents({
        apiStore: { token: async () => { tokenCalls += 1; return 'token' } },
        url: 'https://api.example/events',
        signal: caller.signal,
        fetchImpl: async () => { fetchCalls += 1 }
      })
    } catch (error) {
      failure = error
    }
    expect(failure).to.equal(reason)
    expect(tokenCalls).to.equal(0)
    expect(fetchCalls).to.equal(0)

    let identityAbort
    const response = await fetchChatConversationEvents({
      apiStore: { token: async () => 'token' },
      url: 'https://api.example/events',
      signal: new AbortController().signal,
      fetchImpl: async (_url, options) => {
        identityAbort = options.signal
        return new Response(new ReadableStream({
          start (controller) {
            controller.enqueue(new TextEncoder().encode('data: ok\n\n'))
            controller.close()
          }
        }), { status: 200 })
      }
    })
    await response.text()
    stopIdentityBoundWork()
    expect(identityAbort.aborted).to.equal(false)
  })
})
