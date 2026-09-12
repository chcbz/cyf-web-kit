import { expect } from 'chai'
import { cleanup } from '../setup.js'
import {
  createRequestTimingPayload,
  normalizeRouteTemplate,
  recordRequestTiming,
  resolveRequestId,
  sampleRequestTiming
} from '../../src/composables/useRequestRum.js'
import { useHttp } from '../../src/composables/useHttp.js'

describe('request RUM', () => {
  afterEach(() => cleanup())

  it('normalizes only the allowed timing payload fields and redacts URL values', () => {
    const payload = createRequestTimingPayload({
      url: 'https://api.example.test/agent/scenes/12345678/snapshot?token=do-not-record#private',
      requestId: 'request-1234',
      durationMs: 12.7,
      errorClass: 'network',
      body: { token: 'do-not-record' }
    })

    expect(payload).to.deep.equal({
      route: '/agent/scenes/:id/snapshot',
      requestId: 'request-1234',
      durationMs: 13,
      errorClass: 'network'
    })
    expect(JSON.stringify(payload)).not.to.include('do-not-record')
    expect(normalizeRouteTemplate('/account/password/reset')).to.equal('/account/:redacted/reset')
  })

  it('uses a low default sample rate and supports explicit deterministic rates', () => {
    expect(sampleRequestTiming(undefined, () => 0.5)).to.equal(false)
    expect(sampleRequestTiming(1, () => 0.999)).to.equal(true)
    expect(sampleRequestTiming(0, () => 0)).to.equal(false)
  })

  it('keeps reporter and transport failures out of the business path', () => {
    expect(() => recordRequestTiming({
      sampled: true,
      url: '/agent/map?Authorization=secret',
      requestId: 'request-1234',
      durationMs: 4,
      errorClass: 'success',
      reporter: () => { throw new Error('collector unavailable') }
    })).not.to.throw()
    expect(recordRequestTiming({
      sampled: true,
      endpoint: 'https://collector.example.test/rum',
      url: '/agent/map',
      requestId: 'request-1234',
      durationMs: 4,
      errorClass: 'success'
    })).to.equal(false)
  })

  it('generates a contract-valid request ID when the supplied ID is invalid', () => {
    const requestId = resolveRequestId('token value must not be used')
    expect(requestId).to.match(/^[A-Za-z0-9._-]{8,128}$/)
  })

  it('associates a JSON request with the response request ID without exposing query or body', async () => {
    const originalFetch = global.fetch
    const reports = []
    let receivedHeaders
    global.fetch = async (_url, config) => {
      receivedHeaders = config.headers
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'X-Request-Id': 'backend-1234' }
      })
    }

    try {
      await useHttp().post('/agent/scenes/12345678/snapshot?token=do-not-record', {
        authorization: 'do-not-record',
        cookie: 'do-not-record'
      }, {
        needAuth: false,
        rumSampleRate: 1,
        rumReporter: payload => reports.push(payload)
      })
    } finally {
      global.fetch = originalFetch
    }

    expect(receivedHeaders['X-Request-Id']).to.match(/^[A-Za-z0-9._-]{8,128}$/)
    expect(reports).to.deep.equal([{
      route: '/agent/scenes/:id/snapshot',
      requestId: 'backend-1234',
      durationMs: reports[0].durationMs,
      errorClass: 'success'
    }])
    expect(JSON.stringify(reports)).not.to.include('do-not-record')
  })

  it('reports the bounded HTTP error class while preserving the original failure', async () => {
    const originalFetch = global.fetch
    const reports = []
    global.fetch = async () => new Response(JSON.stringify({ msg: 'failure' }), {
      status: 503,
      headers: { 'X-Request-Id': 'backend-503' }
    })

    try {
      await useHttp().get('/agent/map?token=do-not-record', {}, {
        needAuth: false,
        rumSampleRate: 1,
        rumReporter: payload => reports.push(payload)
      })
      expect.fail('expected an HTTP error')
    } catch (error) {
      expect(error.status).to.equal(503)
    } finally {
      global.fetch = originalFetch
    }

    expect(reports).to.have.length(1)
    expect(reports[0]).to.include({
      route: '/agent/map',
      requestId: 'backend-503',
      errorClass: 'http_5xx'
    })
  })
})
