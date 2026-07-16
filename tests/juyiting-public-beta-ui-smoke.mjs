import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const FRONTEND_URL = process.env.JUYITING_FRONTEND_URL || 'https://localhost:8080'
const BACKEND_URL = process.env.JUYITING_BACKEND_URL || 'https://localhost:10018'
const OAUTH_CLIENT_ID = process.env.JUYITING_OAUTH_CLIENT_ID || 'jiafewnnv58ec2379c'
const LOGIN_USERNAME = process.env.JUYITING_USERNAME || 'chcbz'
const LOGIN_PASSWORD = process.env.JUYITING_PASSWORD || '123'
const OAUTH_REDIRECT_URI = process.env.JUYITING_OAUTH_REDIRECT_URI || `${FRONTEND_URL}/oauth2/callback`
const DEBUG_KEY = '__JYTING_SCENE_DEBUG__'
const EXPECTED_MANIFEST_VERSION = 'persona-sheets-v1'
const REQUEST_TIMEOUT_MS = 15_000
const GAME_LOOKUP_SOURCE = `
  let component = document.querySelector('.hall-stage')?.__vueParentComponent;
  while (component && !component.setupState?.juyitingGame) component = component.parent;
  const juyitingGame = component?.setupState?.juyitingGame;
  if (!juyitingGame) throw new Error('Mounted Juyiting game instance is unavailable');
`
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean)

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const absoluteUrl = (location) => {
  if (!location) return ''
  return location.startsWith('http') ? location : `${BACKEND_URL}${location.startsWith('/') ? '' : '/'}${location}`
}

class CookieJar {
  constructor () {
    this.cookies = new Map()
  }

  store (response) {
    const setCookie = response.headers.getSetCookie?.() || []
    for (const cookie of setCookie) {
      const [pair] = cookie.split(';')
      const index = pair.indexOf('=')
      if (index > 0) {
        this.cookies.set(pair.slice(0, index), pair.slice(index + 1))
      }
    }
  }

  header () {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ')
  }
}

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...options
  })
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

const base64Url = (buffer) => buffer
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')

const fetchWithCookies = async (jar, url, options = {}) => {
  const headers = new Headers(options.headers || {})
  const cookie = jar.header()
  if (cookie) headers.set('Cookie', cookie)
  const response = await fetch(url, {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'manual'
  })
  jar.store(response)
  return response
}

const getToken = async () => {
  const jar = new CookieJar()
  const codeVerifier = base64Url(randomBytes(48))
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest())
  const redirectUri = OAUTH_REDIRECT_URI
  const authorizeUrl = `${BACKEND_URL}/oauth2/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: OAUTH_CLIENT_ID,
    scope: 'openid',
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: '/juyiting',
    access_type: 'offline'
  })}`

  await fetchWithCookies(jar, authorizeUrl)
  const loginResponse = await fetchWithCookies(jar, `${BACKEND_URL}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      loginType: 'password',
      username: LOGIN_USERNAME,
      password: LOGIN_PASSWORD,
      redirect_uri: ''
    })
  })

  let nextUrl = absoluteUrl(loginResponse.headers.get('location')) || authorizeUrl
  let code = ''
  for (let i = 0; i < 8 && nextUrl; i++) {
    if (nextUrl.startsWith(redirectUri)) {
      code = new URL(nextUrl).searchParams.get('code') || ''
      break
    }
    const response = await fetchWithCookies(jar, nextUrl)
    nextUrl = absoluteUrl(response.headers.get('location'))
  }
  if (!code) throw new Error('OAuth authorization code was not returned')

  const data = await requestJson(`${BACKEND_URL}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: OAUTH_CLIENT_ID,
      code_verifier: codeVerifier
    })
  })
  if (!data.access_token) throw new Error('OAuth token response did not include access_token')
  return data.access_token
}

const pathExists = async (path) => {
  try {
    const { access } = await import('node:fs/promises')
    await access(path)
    return true
  } catch {
    return false
  }
}

const findChrome = async () => {
  for (const candidate of CHROME_CANDIDATES) {
    if (await pathExists(candidate)) return candidate
  }
  throw new Error('Chrome or Edge executable not found. Set CHROME_PATH to run UI smoke.')
}

const waitForJson = async (url, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      return await requestJson(url)
    } catch (error) {
      lastError = error
      await delay(250)
    }
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

class CdpSession {
  constructor (webSocketUrl) {
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.handlers = new Map()
    this.handlerErrors = []
    this.ws = new WebSocket(webSocketUrl)
  }

  async open () {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id)
        this.pending.delete(message.id)
        clearTimeout(timer)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result || {})
      } else if (message.method) {
        this.events.push(message)
        const handler = this.handlers.get(message.method)
        if (handler) {
          Promise.resolve(handler(message.params || {})).catch(error => {
            this.handlerErrors.push(error)
          })
        }
      }
    })
  }

  on (method, handler) {
    this.handlers.set(method, handler)
  }

  throwHandlerErrors () {
    const error = this.handlerErrors.shift()
    if (error) throw error
  }

  send (method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`))
      }, 15000)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  close () {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('CDP session closed'))
    }
    this.pending.clear()
    this.ws.close()
  }
}

const waitForExpression = async (cdp, expression, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    cdp.throwHandlerErrors()
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    lastValue = result.result?.value
    if (lastValue) return lastValue
    await delay(500)
  }
  throw new Error(`Timed out waiting for expression: ${expression}. Last value: ${JSON.stringify(lastValue)}`)
}

const evaluate = async (cdp, expression) => {
  cdp.throwHandlerErrors()
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
  }
  return result.result?.value
}

const fulfillJson = (cdp, requestId, status, value) => cdp.send('Fetch.fulfillRequest', {
  requestId,
  responseCode: status,
  responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
  body: Buffer.from(JSON.stringify(value)).toString('base64')
})

const fulfillSse = (cdp, requestId, body) => cdp.send('Fetch.fulfillRequest', {
  requestId,
  responseCode: 200,
  responseHeaders: [
    { name: 'Content-Type', value: 'text/event-stream; charset=utf-8' },
    { name: 'Cache-Control', value: 'no-cache' }
  ],
  body: Buffer.from(body).toString('base64')
})

const debugExpression = predicate => `(() => {
  const debug = window[${JSON.stringify(DEBUG_KEY)}];
  return Boolean(debug && (${predicate}));
})()`

const refreshDebugExpression = `(() => {
  ${GAME_LOOKUP_SOURCE}
  return juyitingGame.getSceneDebugSnapshot();
})()`

const readDebug = async cdp => {
  await evaluate(cdp, refreshDebugExpression)
  return evaluate(cdp, `window[${JSON.stringify(DEBUG_KEY)}]`)
}

const sameTransform = (left, right, tolerance = 1e-6) => (
  Math.abs(left.zoom - right.zoom) <= tolerance &&
  Math.abs(left.offsetX - right.offsetX) <= tolerance &&
  Math.abs(left.offsetY - right.offsetY) <= tolerance
)

const centerWorld = camera => ({
  x: (camera.viewport.width / 2 - camera.offsetX) / camera.zoom,
  y: (camera.viewport.height / 2 - camera.offsetY) / camera.zoom
})

const sceneFixtures = () => {
  const startedAt = Date.now() - 30_000
  const expectedArrivalAt = Date.now() + 90_000
  const state = {
    agentId: 'agent-songjiang',
    personaCode: 'songjiang',
    behavior: 'moving_to_discussion',
    originRegionId: 'main-seat',
    targetRegionId: 'council-table',
    relatedType: 'discussion',
    relatedId: 'ui-smoke-discussion',
    phase: 'moving',
    stateVersion: 1,
    startedAt,
    expectedArrivalAt,
    expiresAt: expectedArrivalAt + 300_000
  }
  return {
    snapshot: {
      status: 200,
      code: 'E0',
      msg: 'ok',
      data: {
        sceneId: 'juyiting-main',
        sceneVersion: 128,
        generatedAt: Date.now(),
        agents: [{ agentId: state.agentId, personaCode: state.personaCode, status: 'online' }],
        states: [state]
      }
    },
    event: {
      sceneVersion: 129,
      eventType: 'agent-scene-state-updated',
      state: {
        ...state,
        stateVersion: 2,
        relatedId: 'ui-smoke-discussion-update',
        startedAt: Date.now(),
        expectedArrivalAt: Date.now() + 120_000
      },
      occurredAt: Date.now()
    }
  }
}

const stopChrome = async (chrome, userDataDir) => {
  if (!chrome.killed) chrome.kill()
  await Promise.race([
    new Promise(resolve => chrome.once('exit', resolve)),
    delay(3000)
  ])

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(userDataDir, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 4) {
        console.warn(`warning: could not remove temporary browser profile ${userDataDir}: ${error.message}`)
        return
      }
      await delay(500)
    }
  }
}

const clickByText = (text) => `
(() => {
  const target = [...document.querySelectorAll('button, a, .hall-room')]
    .find(element => (
      (element.innerText || '').includes(${JSON.stringify(text)}) ||
      (element.getAttribute('title') || '').includes(${JSON.stringify(text)}) ||
      (element.getAttribute('aria-label') || '').includes(${JSON.stringify(text)})
    ));
  if (!target) return false;
  target.click();
  return true;
})()
`

const closePanel = `
(() => {
  const close = document.querySelector('.panel-close');
  if (!close) return true;
  close.click();
  return true;
})()
`

export const runUiSmoke = async () => {
  const token = await getToken()
  const chromePath = await findChrome()
  const userDataDir = await mkdtemp(join(tmpdir(), 'juyiting-ui-smoke-'))
  const debugPort = 9333 + Math.floor(Math.random() * 1000)
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--ignore-certificate-errors',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], { stdio: 'ignore' })

  let cdp
  try {
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`)
    const target = await requestJson(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })
    cdp = new CdpSession(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
    await cdp.open()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

    const fixtures = sceneFixtures()
    let pendingSseRequestId = null
    let sseDelivered = false
    let failRequiredSprite = false
    cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
      const url = request?.url || ''
      if (url.includes('/api/agent/scenes/juyiting-main/snapshot')) {
        await fulfillJson(cdp, requestId, 200, fixtures.snapshot)
        return
      }
      if (url.includes('/api/agent/scenes/juyiting-main/events')) {
        if (!sseDelivered && !pendingSseRequestId) {
          pendingSseRequestId = requestId
          return
        }
        await fulfillJson(cdp, requestId, 503, {
          status: 503,
          code: 'SCENE_EVENTS_DISABLED',
          msg: 'Scene event stream is disabled'
        })
        return
      }
      if (url.includes('/juyiting/sprites/persona-sheets-v1/songjiang.png') && failRequiredSprite) {
        await cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 404,
          responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
          body: Buffer.from('required sprite intentionally unavailable').toString('base64')
        })
        return
      }
      await cdp.send('Fetch.continueRequest', { requestId })
    })
    await cdp.send('Fetch.enable', {
      patterns: [
        { urlPattern: '*://*/api/agent/scenes/juyiting-main/snapshot*', requestStage: 'Request' },
        { urlPattern: '*://*/api/agent/scenes/juyiting-main/events*', requestStage: 'Request' },
        { urlPattern: '*://*/juyiting/sprites/persona-sheets-v1/songjiang.png*', requestStage: 'Request' }
      ]
    })

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('api_token', ${JSON.stringify(JSON.stringify({
        data: token,
        expTime: Date.now() + 24 * 60 * 60 * 1000
      }))})`
    })

    await cdp.send('Page.navigate', { url: `${FRONTEND_URL}/juyiting?transition=none` })
    await waitForExpression(cdp, 'Boolean(document.querySelector(".juyi-page"))')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("聚义厅")')
    await waitForExpression(cdp, 'Boolean(document.querySelector(".melon-layer canvas"))')
    await waitForExpression(cdp, debugExpression(`
      debug.ready === true &&
      debug.map?.tmxLoaded === true &&
      debug.map?.movementReady === true &&
      debug.simulation?.ready === true &&
      debug.sprites?.manifestReady === true &&
      debug.backend?.snapshotReady === true &&
      debug.input?.interactionLocked === false
    `))

    const initialDebug = await readDebug(cdp)
    if (initialDebug.sprites.manifestVersion !== EXPECTED_MANIFEST_VERSION ||
      initialDebug.sprites.requiredMissingCount !== 0 ||
      initialDebug.sprites.optionalMissingCount !== 0 ||
      initialDebug.sprites.placeholderCount !== 0) {
      throw new Error(`Unexpected sprite readiness: ${JSON.stringify(initialDebug.sprites)}`)
    }
    const songjiang = initialDebug.agents.find(agent => agent.personaCode === 'songjiang')
    if (!songjiang || !songjiang.spriteLoaded || songjiang.placeholder) {
      throw new Error(`Songjiang simulation snapshot is unavailable: ${JSON.stringify(initialDebug.agents)}`)
    }
    if (String(initialDebug.backend.sceneVersion) !== '128') {
      throw new Error(`Initial scene cursor was not reconstructed: ${JSON.stringify(initialDebug.backend)}`)
    }

    const sceneState = await evaluate(cdp, `(() => {
      const stage = document.querySelector('.hall-stage');
      return {
        hasStage: Boolean(stage),
        hasCanvas: Boolean(document.querySelector('.melon-layer canvas')),
        hasMapWorld: Boolean(document.querySelector('.map-world')),
        hasHallRoom: Boolean(document.querySelector('.hall-room')),
        hasAgentToken: Boolean(document.querySelector('.agent-token'))
      };
    })()`)
    if (!sceneState.hasStage || !sceneState.hasCanvas || sceneState.hasMapWorld || sceneState.hasHallRoom || sceneState.hasAgentToken) {
      throw new Error(`Unexpected Juyiting scene DOM state: ${JSON.stringify(sceneState)}`)
    }

    const sseDeadline = Date.now() + 10_000
    while (!pendingSseRequestId && Date.now() < sseDeadline) {
      cdp.throwHandlerErrors()
      await delay(100)
    }
    if (!pendingSseRequestId) throw new Error('Scene SSE request was not opened')
    const sseRequestId = pendingSseRequestId
    pendingSseRequestId = null
    sseDelivered = true
    await fulfillSse(cdp, sseRequestId,
      `id:129\nevent:agent-scene-state-updated\ndata:${JSON.stringify(fixtures.event)}\n\n`)
    await waitForExpression(cdp, debugExpression('String(debug.backend?.sceneVersion) === \'129\''))

    const beforeWheel = (await readDebug(cdp)).camera
    const canvasCenter = await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const canvas = juyitingGame._hallScene?._canvasElement?.();
      const bounds = canvas.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: canvasCenter.x, y: canvasCenter.y, deltaX: 0, deltaY: -120
    })
    await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const canvas = juyitingGame._hallScene?._canvasElement?.();
      canvas.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaY: -120, deltaMode: 0,
        clientX: ${canvasCenter.x}, clientY: ${canvasCenter.y}
      }));
      return true;
    })()`)
    const wheelDiagnostic = await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      return {
        camera: juyitingGame.getCameraSnapshot?.(),
        input: juyitingGame.getInputSnapshot?.(),
        hasController: Boolean(juyitingGame._hallScene?._inputController),
        canvasConnected: Boolean(juyitingGame._hallScene?._canvasElement?.()?.isConnected)
      };
    })()`)
    if (!wheelDiagnostic.hasController) {
      throw new Error(`Input controller unavailable during wheel smoke: ${JSON.stringify(wheelDiagnostic)}`)
    }
    if (sameTransform(beforeWheel, wheelDiagnostic.camera?.transform || {})) {
      throw new Error(`Wheel input did not change camera transform: ${JSON.stringify(wheelDiagnostic)}`)
    }
    await waitForExpression(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const transform = juyitingGame.getCameraSnapshot?.()?.transform;
      juyitingGame.getSceneDebugSnapshot?.();
      return Boolean(transform && (
        Math.abs(transform.zoom - ${beforeWheel.zoom}) > 1e-6 ||
        Math.abs(transform.offsetX - ${beforeWheel.offsetX}) > 1e-6 ||
        Math.abs(transform.offsetY - ${beforeWheel.offsetY}) > 1e-6
      ));
    })()`)

    const beforeDrag = (await readDebug(cdp)).camera
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: canvasCenter.x, y: canvasCenter.y, button: 'left', buttons: 1, clickCount: 1
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: canvasCenter.x + 40, y: canvasCenter.y + 24, button: 'left', buttons: 1
    })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: canvasCenter.x + 40, y: canvasCenter.y + 24,
      button: 'left', buttons: 0, clickCount: 1
    })
    await waitForExpression(cdp, debugExpression(`
      Math.abs(debug.camera.offsetX - ${beforeDrag.offsetX}) > 1e-6 ||
      Math.abs(debug.camera.offsetY - ${beforeDrag.offsetY}) > 1e-6
    `))

    const beforeOrientation = (await readDebug(cdp)).camera
    const orientationDebug = await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const debug = window[${JSON.stringify(DEBUG_KEY)}];
      juyitingGame.resizeViewport({
        width: debug.camera.viewport.height,
        height: debug.camera.viewport.width,
        kind: 'orientation',
        orientationChanged: true
      });
      return window[${JSON.stringify(DEBUG_KEY)}];
    })()`)
    const focusBefore = centerWorld(beforeOrientation)
    const focusAfter = centerWorld(orientationDebug.camera)
    if (Math.hypot(focusAfter.x - focusBefore.x, focusAfter.y - focusBefore.y) > 2) {
      throw new Error(`Orientation resize lost camera focus: ${JSON.stringify({ focusBefore, focusAfter })}`)
    }

    const initialState = await evaluate(cdp, `(() => {
      const text = document.body.innerText || '';
      return {
        hasMojibake: /�|鑱|钘|鎮|楠|涓|鍘/.test(text),
        text: text.slice(0, 2000)
      };
    })()`)
    if (initialState.hasMojibake) {
      throw new Error(`Page contains mojibake-like text: ${initialState.text}`)
    }

    const beforePanel = (await readDebug(cdp)).camera
    if (!await evaluate(cdp, clickByText('藏经阁'))) throw new Error('藏经阁入口不可点击')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("向量检索")')
    const panelDebug = await readDebug(cdp)
    if (!panelDebug.input.interactionLocked || !sameTransform(beforePanel, panelDebug.camera)) {
      throw new Error(`Panel opening changed the camera transform: ${JSON.stringify({ beforePanel, after: panelDebug.camera })}`)
    }
    await evaluate(cdp, closePanel)
    await waitForExpression(cdp, '!document.querySelector(".panel-overlay")')

    if (!await evaluate(cdp, clickByText('悬赏榜'))) throw new Error('悬赏榜入口不可点击')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("新建")')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("已归档")')
    await evaluate(cdp, closePanel)
    await waitForExpression(cdp, '!document.querySelector(".panel-overlay")')

    if (!await evaluate(cdp, clickByText('全员议事'))) throw new Error('全员议事入口不可点击')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("厅中暂无议事") || (document.body.innerText || "").includes("实时同步中")')

    const finalState = await evaluate(cdp, `(() => {
      const text = document.body.innerText || '';
      return {
        url: location.href,
        containsCoordination: text.includes('协同会办'),
        text: text.slice(0, 2000)
      };
    })()`)
    if (finalState.containsCoordination) {
      throw new Error(`Low-value actions are visible: ${JSON.stringify(finalState)}`)
    }

    await cdp.send('Page.reload', { ignoreCache: true })
    await waitForExpression(cdp, debugExpression(`
      debug.ready === true && debug.map?.movementReady === true && debug.simulation?.ready === true
    `))
    const recovery = await waitForExpression(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const agent = juyitingGame._movementEngine?.snapshots?.()
        .find(candidate => candidate.personaCode === 'songjiang');
      const home = juyitingGame.getMovementRuntime?.()?.slots
        ?.find(slot => slot.kind === 'home' && slot.personaCode === 'songjiang');
      if (!agent || !home) return false;
      const distance = Math.hypot(agent.x - home.point.x, agent.y - home.point.y);
      return distance > 0 ? { distance, phase: agent.phase, stateVersion: agent.stateVersion } : false;
    })()`)
    if (!(recovery.distance > 0)) {
      throw new Error(`Refresh did not reconstruct nonzero movement progress: ${JSON.stringify(recovery)}`)
    }

    failRequiredSprite = true
    pendingSseRequestId = null
    await cdp.send('Page.reload', { ignoreCache: true })
    await waitForExpression(cdp, debugExpression(`
      debug.ready === true &&
      debug.degraded === true &&
      debug.map?.movementReady === true &&
      debug.sprites?.requiredMissingCount === 1
    `))
    const degradedBeforeTransform = (await readDebug(cdp)).camera
    const degradedAfterTransform = await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      juyitingGame.zoomBy(0.2);
      return window[${JSON.stringify(DEBUG_KEY)}].camera;
    })()`)
    if (sameTransform(degradedBeforeTransform, degradedAfterTransform)) {
      throw new Error('Map transform stopped operating after required sprite degradation')
    }

    console.log('聚义厅 UI smoke 验证通过')
    console.log(JSON.stringify({
      frontend: FRONTEND_URL,
      backend: BACKEND_URL,
      finalUrl: finalState.url
    }, null, 2))
  } finally {
    if (cdp) cdp.close()
    await stopChrome(chrome, userDataDir)
  }
}

const isMainModule = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false

if (isMainModule) {
  runUiSmoke().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
