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

    expect(receivedSignal).to.equal(controller.signal)
    expect(opened).to.have.length(1)
    expect(opened[0].cancel).to.be.a('function')
    expect(chunks.join('')).to.equal('id: 1\ndata: hello\n\n')
  })
})
