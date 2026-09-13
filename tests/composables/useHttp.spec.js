import { expect } from 'chai'
import { cleanup } from '../setup.js'
import { createApi, useHttp } from '../../src/composables/useHttp.js'

// Mock the useHttp composable for testing
const mockUseHttp = () => {
  return {
    get: async (_url) => {
      return { data: { message: 'Mock response' } }
    },
    post: async (_url, data) => {
      return { data: { ...data, id: 1 } }
    }
  }
}

function installFakeTimers () {
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance')
  let now = 0
  let nextId = 1
  const timers = new Map()

  global.setTimeout = (callback, delay = 0, ...args) => {
    const id = nextId++
    timers.set(id, { at: now + Math.max(0, Number(delay) || 0), callback, args })
    return id
  }
  global.clearTimeout = id => timers.delete(id)
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: { now: () => now }
  })

  return {
    advanceBy (milliseconds) {
      const target = now + milliseconds
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, left], [, right]) => left.at - right.at)[0]
        if (!due) break
        const [id, timer] = due
        timers.delete(id)
        now = timer.at
        timer.callback(...timer.args)
      }
      now = target
    },
    restore () {
      global.setTimeout = originalSetTimeout
      global.clearTimeout = originalClearTimeout
      if (originalPerformance) Object.defineProperty(globalThis, 'performance', originalPerformance)
      else delete globalThis.performance
    }
  }
}

describe('useHttp', () => {
  afterEach(() => {
    cleanup()
  })

  it('should return a get function', () => {
    const http = mockUseHttp()
    expect(http.get).to.exist
    expect(http.get).to.be.a('function')
  })

  it('should return a post function', () => {
    const http = mockUseHttp()
    expect(http.post).to.exist
    expect(http.post).to.be.a('function')
  })

  it('created APIs expose authenticated execute for lifecycle streams', () => {
    expect(createApi('/agent').execute).to.be.a('function')
  })

  it('get function should return mock data', async () => {
    const http = mockUseHttp()
    const response = await http.get('/test')
    expect(response.data).to.deep.equal({ message: 'Mock response' })
  })

  it('post function should return data with id', async () => {
    const http = mockUseHttp()
    const testData = { name: 'Test' }
    const response = await http.post('/test', testData)
    expect(response.data).to.deep.equal({ name: 'Test', id: 1 })
  })

  it('streams raw chunks, exposes the reader immediately, and honors an external abort signal', async () => {
    const originalFetch = global.fetch
    const chunks = []
    const opened = []
    const controller = new AbortController()
    let receivedSignal
    global.fetch = async (_url, config) => {
      receivedSignal = config.signal
      return new Response(new ReadableStream({
        start (streamController) {
          streamController.enqueue(new TextEncoder().encode('id: 1\ndata: hel'))
          streamController.enqueue(new TextEncoder().encode('lo\n\n'))
          streamController.close()
        }
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    try {
      await useHttp().get('/stream', {}, {
        needAuth: false,
        responseType: 'stream',
        streamChunks: true,
        signal: controller.signal,
        onStreamOpen: handle => opened.push(handle),
        onStream: chunk => chunks.push(chunk)
      })
    } finally {
      global.fetch = originalFetch
    }

    expect(receivedSignal).to.equal(controller.signal)
    expect(receivedSignal.aborted).to.equal(false)
    expect(opened).to.have.length(1)
    expect(opened[0].cancel).to.be.a('function')
    expect(chunks.join('')).to.equal('id: 1\ndata: hello\n\n')
  })

  it('reports a stream read failure once', async () => {
    const originalFetch = global.fetch
    const errors = []
    global.fetch = async () => new Response(new ReadableStream({
      start (controller) {
        controller.error(new Error('stream failed'))
      }
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

    try {
      let failure
      try {
        await useHttp().get('/stream', {}, {
          needAuth: false,
          responseType: 'stream',
          streamChunks: true,
          onError: (_message, error) => errors.push(error)
        })
      } catch (error) {
        failure = error
      }
      expect(failure?.message).to.equal('stream failed')
    } finally {
      global.fetch = originalFetch
    }

    expect(errors).to.have.length(1)
  })

  it('exposes controlled backend error codes to stream lifecycle callers', async () => {
    const originalFetch = global.fetch
    global.fetch = async () => new Response(JSON.stringify({
      status: 503,
      code: 'SCENE_EVENTS_DISABLED',
      msg: 'Scene event stream is disabled'
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })

    try {
      let failure
      try {
        await useHttp().get('/stream', {}, { needAuth: false, responseType: 'stream' })
      } catch (error) {
        failure = error
      }
      expect(failure).to.include({ status: 503, code: 'SCENE_EVENTS_DISABLED' })
    } finally {
      global.fetch = originalFetch
    }
  })

  it('does not impose a default timeout on ordinary JSON requests', async () => {
    const originalFetch = global.fetch
    const originalTimeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
    const observedTimeouts = []
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      writable: true,
      value: milliseconds => {
        observedTimeouts.push(milliseconds)
        return new AbortController().signal
      }
    })
    global.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 })

    try {
      await useHttp().get('/ordinary-json', {}, { needAuth: false })
    } finally {
      global.fetch = originalFetch
      Object.defineProperty(AbortSignal, 'timeout', originalTimeout)
    }

    expect(observedTimeouts).to.deep.equal([])
  })

  it('accepts a JSON response after more than five seconds and reports its latency', async () => {
    const originalFetch = global.fetch
    const timers = installFakeTimers()
    const reports = []
    let receivedSignal
    global.fetch = (_url, config) => {
      receivedSignal = config.signal
      return new Promise(resolve => {
        setTimeout(() => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })), 5001)
      })
    }

    try {
      const pending = useHttp().get('/agent/map', {}, {
        needAuth: false,
        rumSampleRate: 1,
        rumReporter: payload => reports.push(payload)
      })
      await Promise.resolve()
      timers.advanceBy(5001)
      const result = await pending

      expect(result.data).to.deep.equal({ ok: true })
      expect(receivedSignal).to.equal(undefined)
      expect(reports).to.have.length(1)
      expect(reports[0]).to.include({ route: '/agent/map', durationMs: 5001, status: '2xx' })
    } finally {
      timers.restore()
      global.fetch = originalFetch
    }
  })

  it('applies an explicit transport timeout without imposing one on other requests', async () => {
    const originalFetch = global.fetch
    const originalTimeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
    const observedTimeouts = []
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      writable: true,
      value: milliseconds => {
        observedTimeouts.push(milliseconds)
        return new AbortController().signal
      }
    })
    global.fetch = async () => new Response('ok', { status: 200 })

    try {
      await useHttp().get('/events', {}, { needAuth: false, responseType: 'stream', timeout: 60_000 })
      await useHttp().post('/upload', new FormData(), { needAuth: false })
      await useHttp().get('/download', {}, { needAuth: false, responseType: 'text' })
    } finally {
      global.fetch = originalFetch
      Object.defineProperty(AbortSignal, 'timeout', originalTimeout)
    }

    expect(observedTimeouts).to.deep.equal([60000])
  })

  it('allows authentication that takes longer than five seconds before fetching', async () => {
    const originalFetch = global.fetch
    const timers = installFakeTimers()
    let fetchCalls = 0
    global.fetch = async () => {
      fetchCalls += 1
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    try {
      const pending = useHttp().get('/protected', {}, {
        authStore: {
          token: () => new Promise(resolve => setTimeout(() => resolve('token'), 5001))
        }
      })
      await Promise.resolve()
      timers.advanceBy(5001)
      const result = await pending

      expect(result.data).to.deep.equal({ ok: true })
      expect(fetchCalls).to.equal(1)
    } finally {
      timers.restore()
      global.fetch = originalFetch
    }
  })

  it('applies an explicit transport timeout while authentication is pending', async () => {
    const originalFetch = global.fetch
    const originalTimeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
    const timeoutController = new AbortController()
    let fetchCalls = 0
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      writable: true,
      value: () => timeoutController.signal
    })
    global.fetch = async () => {
      fetchCalls += 1
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    try {
      let failure
      try {
        await useHttp().get('/protected', {}, {
          timeout: 20,
          authStore: {
            token: () => new Promise(() => {
              queueMicrotask(() => timeoutController.abort(new DOMException('Request timed out', 'TimeoutError')))
            })
          }
        })
      } catch (error) {
        failure = error
      }
      expect(failure).to.include({ name: 'TimeoutError', requestErrorClass: 'deadline_exceeded' })
      expect(fetchCalls).to.equal(0)
    } finally {
      global.fetch = originalFetch
      Object.defineProperty(AbortSignal, 'timeout', originalTimeout)
    }
  })

  it('classifies caller cancellation separately from an explicit transport timeout', async () => {
    const caller = new AbortController()
    const reason = new DOMException('caller cancelled', 'AbortError')
    caller.abort(reason)
    const http = useHttp()

    try {
      await http.get('/cancelled', {}, { needAuth: false, signal: caller.signal })
      expect.fail('expected caller cancellation')
    } catch (error) {
      expect(error).to.equal(reason)
      expect(error.requestErrorClass).to.equal('cancelled')
      expect(http.error.value).to.equal('请求已取消')
    }
  })

  it('combines caller and timeout signals without starting OAuth for an already-aborted caller', async () => {
    const caller = new AbortController()
    const reason = new DOMException('caller cancelled', 'AbortError')
    caller.abort(reason)
    let tokenCalls = 0
    let failure
    try {
      await useHttp().get('/protected', {}, {
        signal: caller.signal,
        authStore: { token: async () => { tokenCalls += 1; return 'token' } },
        timeout: 20
      })
    } catch (error) {
      failure = error
    }
    expect(failure).to.equal(reason)
    expect(tokenCalls).to.equal(0)
  })

  it('keeps timeout active when the caller signal is present and cleans up after abort', async () => {
    let receivedSignal
    const originalFetch = global.fetch
    global.fetch = (_url, config) => new Promise((_resolve, reject) => {
      receivedSignal = config.signal
      config.signal.addEventListener('abort', () => reject(config.signal.reason), { once: true })
    })
    try {
      let failure
      try {
        await useHttp().get('/slow', {}, { needAuth: false, signal: new AbortController().signal, timeout: 1 })
      } catch (error) {
        failure = error
      }
      expect(receivedSignal.aborted).to.equal(true)
      expect(failure?.name).to.equal('TimeoutError')
    } finally {
      global.fetch = originalFetch
    }
  })
})
