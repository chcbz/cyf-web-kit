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

    expect(receivedSignal).to.not.equal(controller.signal)
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
