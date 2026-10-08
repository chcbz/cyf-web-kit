import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const workerSource = () => readFileSync(process.env.CYF_PWA_WORKER_SOURCE || 'public/sw.js', 'utf8')
const response = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } })
const createWorker = ({ network = async () => response('new release'), failPut = false } = {}) => {
  const listeners = new Map()
  const stored = new Map()
  const calls = []
  const puts = []
  const key = request => typeof request === 'string' ? new URL(request, 'https://juyiting.test').href : request.url
  const cache = {
    match: async request => stored.get(key(request))?.clone(),
    put: async (request, value) => {
      if (failPut) throw new Error('cache storage unavailable')
      puts.push(key(request))
      stored.set(key(request), value.clone())
    }
  }
  vm.runInNewContext(workerSource(), {
    self: { location: new URL('https://juyiting.test'), addEventListener: (name, fn) => listeners.set(name, fn) },
    caches: { open: async () => cache, match: cache.match },
    fetch: request => { calls.push(request); return network(request) },
    URL, Request, Promise
  })
  const dispatch = (path, options = {}) => {
    const request = new Request(new URL(path, 'https://juyiting.test'), options)
    if (options.navigation) Object.defineProperty(request, 'mode', { value: 'navigate' })
    const lifetime = []
    let result
    listeners.get('fetch')({ request, respondWith: promise => { result = promise }, waitUntil: promise => lifetime.push(promise) })
    return { result, lifetime }
  }
  return { calls, puts, dispatch, cache, seed: (path, body) => stored.set(key(path), response(body)) }
}

describe('PWA same-origin shell release freshness', () => {
  it('fetches a new index under an unchanged worker and cache version', async () => {
    let release = 'release two'
    const w = createWorker({ network: async () => response(release) })
    w.seed('/index.html', 'release one')
    const first = w.dispatch('/index.html')
    expect(await (await first.result).text()).to.equal('release two')
    await Promise.all(first.lifetime)
    release = 'release three'
    expect(await (await w.dispatch('/index.html').result).text()).to.equal('release three')
    expect(w.calls.map(request => request.cache)).to.deep.equal(['no-cache', 'no-cache'])
  })

  it('revalidates real navigation requests and retains credentials and headers', async () => {
    const w = createWorker()
    const operation = w.dispatch('/juyiting', { navigation: true, credentials: 'same-origin', headers: { 'X-Test': 'retained' } })
    expect(await (await operation.result).text()).to.equal('new release')
    await Promise.all(operation.lifetime)
    expect(w.calls[0].cache).to.equal('no-cache')
    expect(w.calls[0].credentials).to.equal('same-origin')
    expect(w.calls[0].headers.get('X-Test')).to.equal('retained')
    expect(await (await w.cache.match('/index.html')).text()).to.equal('new release')
  })

  it('does not fall back merely because the network response is still pending', async () => {
    let resolve
    const w = createWorker({ network: () => new Promise(done => { resolve = done }) })
    w.seed('/index.html', 'old release')
    const operation = w.dispatch('/index.html')
    let settled = false
    operation.result.then(() => { settled = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).to.equal(false)
    resolve(response('eventual current release'))
    expect(await (await operation.result).text()).to.equal('eventual current release')
  })

  it('honors no-store without reading or replacing an older cached index', async () => {
    const w = createWorker()
    w.seed('/index.html', 'old release')
    const operation = w.dispatch('/index.html', { cache: 'no-store' })
    expect(await (await operation.result).text()).to.equal('new release')
    await Promise.all(operation.lifetime)
    expect(w.calls[0].cache).to.equal('no-store')
    expect(w.puts).to.deep.equal([])
    expect(await (await w.cache.match('/index.html')).text()).to.equal('old release')
  })

  it('keeps explicit no-store network failure observable instead of serving stale success', async () => {
    const unavailable = new Error('network unavailable')
    const w = createWorker({ network: () => Promise.reject(unavailable) })
    w.seed('/index.html', 'old release')
    let caught
    try { await w.dispatch('/index.html', { cache: 'no-store' }).result } catch (error) { caught = error }
    expect(caught).to.equal(unavailable)
  })

  it('keeps an offline shell fallback for actual network errors', async () => {
    const w = createWorker({ network: () => Promise.reject(new Error('offline')) })
    w.seed('/index.html', 'last confirmed release')
    expect(await (await w.dispatch('/juyiting', { navigation: true }).result).text()).to.equal('last confirmed release')
  })

  it('does not cache HTTP failures or hide them behind a successful cached page', async () => {
    const w = createWorker({ network: async () => response('service unavailable', 503) })
    w.seed('/index.html', 'last confirmed release')
    const operation = w.dispatch('/juyiting', { navigation: true })
    expect((await operation.result).status).to.equal(503)
    await Promise.all(operation.lifetime)
    expect(w.puts).to.deep.equal([])
    expect(await (await w.cache.match('/index.html')).text()).to.equal('last confirmed release')
  })

  it('does not turn a redirected login response into the app-shell cache', async () => {
    const value = response('login')
    Object.defineProperty(value, 'redirected', { value: true })
    const w = createWorker({ network: async () => value })
    w.seed('/index.html', 'last confirmed release')
    const operation = w.dispatch('/juyiting', { navigation: true })
    expect(await (await operation.result).text()).to.equal('login')
    await Promise.all(operation.lifetime)
    expect(w.puts).to.deep.equal([])
  })

  it('returns valid online content even if CacheStorage writes fail', async () => {
    const w = createWorker({ failPut: true })
    const operation = w.dispatch('/index.html')
    expect(await (await operation.result).text()).to.equal('new release')
    await Promise.all(operation.lifetime)
  })

  it('retains cache-first hashed assets but bypasses cache for explicit no-store or reload', async () => {
    const w = createWorker()
    w.seed('/static/current-hash.js', 'immutable asset')
    expect(await (await w.dispatch('/static/current-hash.js').result).text()).to.equal('immutable asset')
    expect(w.calls).to.have.length(0)
    for (const cache of ['no-store', 'reload']) {
      expect(await (await w.dispatch('/static/current-hash.js', { cache }).result).text()).to.equal('new release')
      expect(w.calls.at(-1).cache).to.equal(cache)
    }
  })

  it('does not intercept cross-origin, API, websocket or non-GET requests', () => {
    const w = createWorker()
    for (const [path, options] of [['https://api.juyiting.test/chat', {}], ['/api/chat', {}], ['/ws/events', {}], ['/index.html', { method: 'POST' }]]) {
      expect(w.dispatch(path, options).result).to.equal(undefined)
    }
    expect(w.calls).to.have.length(0)
  })
})
