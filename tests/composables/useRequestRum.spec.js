import { expect } from 'chai'
import { cleanup } from '../setup.js'
import {
  createRequestTimingPayload,
  installRequestRum,
  normalizeRouteTemplate,
  recordRequestTiming,
  resolveRequestId,
  sampleRequestTiming
} from '../../src/composables/useRequestRum.js'

describe('request RUM', () => {
  afterEach(() => cleanup())

  it('emits only route, request ID, timing, and bounded status without URL values', () => {
    const payload = createRequestTimingPayload({
      url: 'https://api.example.test/agent/scenes/12345678/snapshot?token=do-not-record#private',
      requestId: 'request-1234',
      durationMs: 12.7,
      status: 503,
      body: { token: 'do-not-record' },
      headers: { Authorization: 'do-not-record' }
    })

    expect(payload).to.deep.equal({
      route: '/agent/scenes/:id/snapshot',
      requestId: 'request-1234',
      durationMs: 13,
      status: '5xx'
    })
    expect(JSON.stringify(payload)).not.to.include('do-not-record')
    expect(normalizeRouteTemplate('/account/password/reset')).to.equal('/:segment/:redacted/:segment')
    expect(normalizeRouteTemplate('/user/alice')).to.equal('/user/:segment')
  })

  it('uses a low default sample rate and supports explicit deterministic rates', () => {
    expect(sampleRequestTiming(undefined, () => 0.5)).to.equal(false)
    expect(sampleRequestTiming(1, () => 0.999)).to.equal(true)
    expect(sampleRequestTiming(0, () => 0)).to.equal(false)
  })

  it('keeps reporter and collector failures out of the business path', () => {
    expect(() => recordRequestTiming({
      sampled: true,
      url: '/agent/map?Authorization=secret',
      requestId: 'request-1234',
      durationMs: 4,
      status: 200,
      reporter: () => { throw new Error('collector unavailable') }
    })).not.to.throw()
    expect(recordRequestTiming({
      sampled: true,
      endpoint: 'https://collector.example.test/rum',
      url: '/agent/map',
      requestId: 'request-1234',
      durationMs: 4,
      status: 200
    })).to.equal(false)
  })

  it('generates a contract-valid request ID when the supplied ID is invalid', () => {
    const requestId = resolveRequestId('token value must not be used')
    expect(requestId).to.match(/^[A-Za-z0-9._-]{8,128}$/)
  })

  it('uses a mounted same-origin endpoint without exposing collector configuration to reporters', () => {
    const reports = []
    expect(installRequestRum({ endpoint: 'https://collector.example.test/rum' })).to.equal(false)
    expect(recordRequestTiming({
      sampled: true,
      url: '/agent/map',
      requestId: 'request-1234',
      durationMs: 4,
      status: 200,
      reporter: payload => reports.push(payload)
    })).to.equal(true)
    expect(reports).to.deep.equal([{
      route: '/agent/map',
      requestId: 'request-1234',
      durationMs: 4,
      status: '2xx'
    }])
  })

  it('maps transport failures to a fixed low-cardinality status', () => {
    expect(createRequestTimingPayload({
      url: '/agent/map?token=do-not-record',
      requestId: 'backend-503',
      durationMs: 1,
      errorClass: 'network'
    })).to.deep.equal({
      route: '/agent/map',
      requestId: 'backend-503',
      durationMs: 1,
      status: 'network'
    })
  })
})
