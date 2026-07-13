import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'

const FRONTEND_URL = process.env.JUYITING_FRONTEND_URL || 'https://localhost:8080'
const BACKEND_URL = process.env.JUYITING_BACKEND_URL || 'https://localhost:10018'
const OAUTH_CLIENT_ID = process.env.JUYITING_OAUTH_CLIENT_ID || 'jiafewnnv58ec2379c'
const LOGIN_USERNAME = process.env.JUYITING_USERNAME || 'chcbz'
const LOGIN_PASSWORD = process.env.JUYITING_PASSWORD || '123'
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/local/bin/chromium-headless-smoke',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean)
const SCENE_HOTSPOTS = {
  chat: 'main-seat',
  tasks: 'bounty-board',
  library: 'library-shelf'
}

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
  const response = await fetch(url, options)
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
    redirect: 'manual'
  })
  jar.store(response)
  return response
}

const getToken = async () => {
  const jar = new CookieJar()
  const codeVerifier = base64Url(randomBytes(48))
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest())
  const redirectUri = `${FRONTEND_URL}/oauth2/callback`
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
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result || {})
      } else if (message.method) {
        this.events.push(message)
      }
    })
  }

  send (method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`))
      }, 15000)
    })
  }

  close () {
    this.ws.close()
  }
}

const waitForExpression = async (cdp, expression, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
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

const clickSceneHotspot = async (cdp, hotspotId) => {
  const objectName = SCENE_HOTSPOTS[hotspotId]
  if (!objectName) throw new Error(`Unknown scene hotspot: ${hotspotId}`)
  const point = await evaluate(cdp, `(async () => {
    const canvas = document.querySelector('.melon-layer canvas');
    const layer = canvas?.closest('.melon-layer');
    const rect = layer?.getBoundingClientRect();
    if (!canvas || !rect?.width || !rect?.height || !canvas.width || !canvas.height) return null;
    const response = await fetch('/juyiting/hall.tmx');
    if (!response.ok) return null;
    const documentNode = new DOMParser().parseFromString(await response.text(), 'text/xml');
    const map = documentNode.querySelector('map');
    const object = [...documentNode.querySelectorAll('objectgroup[name="hotspots"] > object')]
      .find(item => item.getAttribute('name') === ${JSON.stringify(objectName)});
    const polygon = object?.querySelector('polygon');
    if (!map || !object || !polygon) return null;
    const mapWidth = Number(map.getAttribute('width')) * Number(map.getAttribute('tilewidth'));
    const mapHeight = Number(map.getAttribute('height')) * Number(map.getAttribute('tileheight'));
    const originX = Number(object.getAttribute('x')) || 0;
    const originY = Number(object.getAttribute('y')) || 0;
    const points = (polygon.getAttribute('points') || '').split(/\\s+/).filter(Boolean).map(value => {
      const [x, y] = value.split(',').map(Number);
      return { x: originX + x, y: originY + y };
    });
    if (!mapWidth || !mapHeight || points.length < 3) return null;
    const bounds = points.reduce((result, item) => ({
      minX: Math.min(result.minX, item.x),
      minY: Math.min(result.minY, item.y),
      maxX: Math.max(result.maxX, item.x),
      maxY: Math.max(result.maxY, item.y)
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const contains = (candidate) => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        if (((a.y > candidate.y) !== (b.y > candidate.y)) &&
            (candidate.x < (b.x - a.x) * (candidate.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
      }
      return inside;
    };
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    let mapPoint = contains(center) ? center : null;
    const stepX = Math.max(1, (bounds.maxX - bounds.minX) / 20);
    const stepY = Math.max(1, (bounds.maxY - bounds.minY) / 20);
    for (let y = bounds.minY + stepY / 2; !mapPoint && y < bounds.maxY; y += stepY) {
      for (let x = bounds.minX + stepX / 2; x < bounds.maxX; x += stepX) {
        const candidate = { x, y };
        if (contains(candidate)) {
          mapPoint = candidate;
          break;
        }
      }
    }
    if (!mapPoint) return null;
    const scale = Math.max(rect.width / canvas.width, rect.height / canvas.height);
    const offsetX = (rect.width - canvas.width * scale) / 2;
    const offsetY = (rect.height - canvas.height * scale) / 2;
    return {
      x: rect.left + offsetX + canvas.width * (mapPoint.x / mapWidth) * scale,
      y: rect.top + offsetY + canvas.height * (mapPoint.y / mapHeight) * scale
    };
  })()`)
  if (!point) throw new Error(`Scene hotspot ${hotspotId} has no clickable canvas point`)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1
  })
}

const closePanel = `
(() => {
  const close = document.querySelector('.panel-close');
  if (!close) return true;
  close.click();
  return true;
})()
`

const run = async () => {
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
    '--window-size=1440,900',
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

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('api_token', ${JSON.stringify(JSON.stringify({
      data: token,
      expTime: Date.now() + 24 * 60 * 60 * 1000
    }))})`
    })

    await cdp.send('Page.navigate', { url: `${FRONTEND_URL}/juyiting?transition=none` })
    await waitForExpression(cdp, 'Boolean(document.querySelector(".juyi-page"))')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("聚义厅")')
    await waitForExpression(cdp, 'Boolean(document.querySelector(".hall-board.is-melon-ready .melon-layer canvas"))')

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

    await clickSceneHotspot(cdp, 'library')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("藏书查卷")')
    await evaluate(cdp, closePanel)
    await waitForExpression(cdp, '!document.querySelector(".panel-overlay")')

    await clickSceneHotspot(cdp, 'tasks')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("张榜")')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("入档")')
    await evaluate(cdp, closePanel)
    await waitForExpression(cdp, '!document.querySelector(".panel-overlay")')

    await clickSceneHotspot(cdp, 'chat')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("厅前公议")')
    if (!await evaluate(cdp, `(() => {
      const textarea = document.querySelector('.composer-textarea');
      if (!textarea) return false;
      textarea.focus();
      textarea.value = '@';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)) throw new Error('议事输入框不可用')
    try {
      await waitForExpression(cdp, '(document.body.innerText || "").includes("@宋江")')
    } catch (error) {
      const diagnostic = await evaluate(cdp, `({
        textareaValue: document.querySelector('.composer-textarea')?.value,
        hasMentionMenu: Boolean(document.querySelector('.composer-mention-menu')),
        mentionText: document.querySelector('.composer-mention-menu')?.innerText || '',
        panelText: document.querySelector('.floating-panel')?.innerText?.slice(0, 3000) || ''
      })`)
      throw new Error(`${error.message}. Mention diagnostic: ${JSON.stringify(diagnostic)}`)
    }

    const finalState = await evaluate(cdp, `(() => {
      const text = document.body.innerText || '';
      return {
        url: location.href,
        containsSongjiangCommand: text.includes('宋江号令'),
        containsCoordination: text.includes('协同会办'),
        containsSongjiangMention: text.includes('@宋江'),
        text: text.slice(0, 2000)
      };
    })()`)
    if (finalState.containsSongjiangCommand || finalState.containsCoordination) {
      throw new Error(`Low-value actions are visible: ${JSON.stringify(finalState)}`)
    }
    if (!finalState.containsSongjiangMention) {
      throw new Error(`Chat mention list does not include map agent 宋江: ${JSON.stringify(finalState)}`)
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

run().catch(error => {
  console.error(error)
  process.exit(1)
})
