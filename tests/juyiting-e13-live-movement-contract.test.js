import { expect } from 'chai'
import { validateMovement } from '../scripts/juyiting/e13/validate-e13-live-evidence.mjs'
import { setupInterception } from '../scripts/juyiting/e13/generate-e13-evidence.mjs'

const planShot = {
  id: 'E13-289',
  kind: 'movement',
  probeMobility: 'production-movement',
  movementContract: { actorPersonaCode: 'likui', startRegionId: 'right-guard', targetRegionId: 'gate' },
}

const moving = { agentId: 'likui', stateVersion: 2, behavior: 'moving_to_region', phase: 'moving', targetRegionId: 'gate', x: 900, y: 500 }
const arrived = { agentId: 'likui', stateVersion: 2, behavior: 'moving_to_region', phase: 'arrived', regionId: 'gate', x: 1000, y: 600 }

function facts (overrides = {}) {
  const probe = {
    actor: 'likui', startRegionId: 'right-guard', targetRegionId: 'gate', arrivalSteps: 8,
    before: { ...arrived, regionId: 'right-guard', x: 800, y: 400 },
    mid: { ...moving },
    after: { ...arrived },
    visuals: {
      before: { x: 800, y: 400 }, mid: { x: 900, y: 500 }, after: { x: 1000, y: 600 },
    },
  }
  return {
    movementSnapshot: { ...arrived }, movementProbe: probe,
    agentVisuals: [{ id: 'likui', x: 1000, y: 600 }],
    ...overrides,
  }
}

describe('E13 live movement before/mid/arrival contract', () => {
  it('accepts a real actor contract with distinct start, moving, and arrived positions', () => {
    expect(validateMovement('E13-289', {}, facts(), planShot)).to.deep.equal([])
  })

  it('rejects an already-arrived mid frame and a missing bounded arrival proof', () => {
    const value = facts()
    value.movementProbe.mid = { ...arrived, x: 900, y: 500 }
    value.movementProbe.arrivalSteps = 61
    const failures = validateMovement('E13-289', {}, value, planShot)
    expect(failures.join(' | ')).to.include('mid must be moving toward gate')
    expect(failures.join(' | ')).to.include('arrivalSteps must be 1..60')
  })

  it('rejects a repeated rendered actor position between capture stages', () => {
    const value = facts()
    value.movementProbe.after = { ...arrived, x: 900, y: 500 }
    value.movementProbe.visuals.after = { x: 900, y: 500 }
    const failures = validateMovement('E13-289', {}, value, planShot)
    expect(failures.join(' | ')).to.include('mid-to-after displacement')
  })
})

describe('E13 live capture backend isolation', () => {
  function fakeCdp () {
    const handlers = new Map()
    const sends = []
    return {
      handlers, sends,
      throwHandlerErrors: () => {},
      on: (method, handler) => handlers.set(method, handler),
      send: async (method, params) => { sends.push({ method, params }); return method === 'Runtime.evaluate' ? { result: { value: true } } : {} },
    }
  }

  const origin = new URL(process.env.JUYITING_FRONTEND_URL || 'https://localhost:8080').origin
  const preflight = method => ({ Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'authorization,x-e13' })
  const request = (url, method = 'GET', headers = {}) => ({ requestId: `${method}:${url}`, request: { url, method, headers } })

  it('fulfills exact GET/POST fixtures and their method-specific CORS preflights', async () => {
    const cdp = fakeCdp()
    const interception = await setupInterception(cdp)
    const paused = cdp.handlers.get('Fetch.requestPaused')
    for (const [method, path] of [['GET', '/agent/map'], ['GET', '/agent/personas/catalog'], ['GET', '/agent/scenes/juyiting-main/snapshot'], ['GET', '/agent/scenes/juyiting-main/events'], ['POST', '/agent/roster'], ['POST', '/agent/tasks/search'], ['POST', '/agent/tasks/status-counts'], ['POST', '/agent/scenes/juyiting-main/phases'], ['GET', '/archive/v1/catalog'], ['POST', '/chat/conversation/list']]) {
      const url = `https://api.invalid${path}`
      await paused(request(url, method))
      expect(cdp.sends.at(-1).params.responseCode).to.equal(200)
      await paused(request(url, 'OPTIONS', preflight(method)))
      const response = cdp.sends.at(-1).params
      expect(response.responseCode).to.equal(204)
      expect(response.responseHeaders).to.deep.include({ name: 'Access-Control-Allow-Origin', value: origin })
      expect(response.responseHeaders).to.deep.include({ name: 'Access-Control-Allow-Methods', value: `${method}, OPTIONS` })
      expect(response.responseHeaders).to.deep.include({ name: 'Access-Control-Allow-Headers', value: 'authorization,x-e13' })
    }
    await interception.assertClean()
    expect(cdp.sends.some(item => item.method === 'Fetch.continueRequest')).to.equal(false)
  })

  for (const [label, event] of [
    ['DELETE at a known fixture path', request('https://api.invalid/agent/tasks/search', 'DELETE')],
    ['same-origin /api/private.json', request(`${origin}/api/private.json`)],
    ['an unknown POST preflight', request('https://api.invalid/agent/unknown', 'OPTIONS', preflight('POST'))],
    ['a known path with an unapproved preflight method', request('https://api.invalid/agent/tasks/search', 'OPTIONS', preflight('DELETE'))],
    ['a missing requested preflight method', request('https://api.invalid/agent/map', 'OPTIONS', { Origin: origin })],
    ['a wrong preflight origin', request('https://api.invalid/agent/map', 'OPTIONS', { ...preflight('GET'), Origin: 'https://foreign.invalid' })],
    ['an arbitrary same-origin JSON file', request(`${origin}/private.json`)],
    ['a backend segment under a static prefix', request(`${origin}/static/api/private.json`)],
  ]) {
    it(`rejects ${label} without forwarding`, async () => {
      const cdp = fakeCdp()
      const interception = await setupInterception(cdp)
      await cdp.handlers.get('Fetch.requestPaused')(event)
      expect(cdp.sends.at(-1).params.responseCode).to.equal(403)
      expect(interception.blockedRequests).to.have.length(1)
      expect(cdp.sends.some(item => item.method === 'Fetch.continueRequest')).to.equal(false)
      let error
      try { await interception.assertClean() } catch (caught) { error = caught }
      expect(error?.message).to.include('unexpected backend traffic was blocked')
    })
  }

  it('continues only same-origin positive frontend paths', async () => {
    const cdp = fakeCdp()
    const interception = await setupInterception(cdp)
    for (const path of ['/juyiting/', '/static/page.js', '/assets/page.css', '/juyiting/hall.tmx', '/juyiting/images/base.webp']) {
      await cdp.handlers.get('Fetch.requestPaused')(request(origin + path))
      expect(cdp.sends.at(-1).method).to.equal('Fetch.continueRequest')
    }
    await interception.assertClean()
  })

  it('awaits delayed handlers and rejects late blocked requests after ready at final capture closure', async () => {
    const cdp = fakeCdp()
    const interception = await setupInterception(cdp)
    await interception.assertClean() // readiness already passed
    const originalSend = cdp.send
    let release
    cdp.send = (method, params) => params?.responseCode === 403
      ? new Promise(resolve => { release = resolve }) : originalSend(method, params)
    const late = cdp.handlers.get('Fetch.requestPaused')(request('https://api.invalid/agent/write', 'POST'))
    let done = false, error
    const finishing = interception.finish().catch(caught => { error = caught }).finally(() => { done = true })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(done).to.equal(false)
    release({})
    await Promise.all([late, finishing])
    expect(error?.message).to.include('unexpected backend traffic was blocked')
    expect(cdp.sends).to.deep.include({ method: 'Page.navigate', params: { url: 'about:blank' } })
  })

  it('does not swallow handler transport errors', async () => {
    const cdp = fakeCdp()
    const interception = await setupInterception(cdp)
    const originalSend = cdp.send
    cdp.send = (method, params) => method === 'Fetch.fulfillRequest' ? Promise.reject(new Error('transport failed')) : originalSend(method, params)
    await cdp.handlers.get('Fetch.requestPaused')(request('https://api.invalid/agent/map'))
    let error
    try { await interception.finish() } catch (caught) { error = caught }
    expect(error?.message).to.include('interception handler failed: transport failed')
  })
})
