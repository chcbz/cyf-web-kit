import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const FRONTEND_URL = process.env.JUYITING_FRONTEND_URL || 'https://localhost:8080'
const BACKEND_URL = process.env.JUYITING_BACKEND_URL || 'https://localhost:10018'
const OAUTH_CLIENT_ID = process.env.JUYITING_OAUTH_CLIENT_ID || 'jiafewnnv58ec2379c'
const LOGIN_USERNAME = process.env.JUYITING_USERNAME || 'chcbz'
const LOGIN_PASSWORD = process.env.JUYITING_PASSWORD || '123'
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
    await waitForExpression(cdp, '(document.body.innerText || "").includes("宋江")')

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

    if (!await evaluate(cdp, clickByText('藏经阁'))) throw new Error('藏经阁入口不可点击')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("向量检索")')
    await evaluate(cdp, closePanel)
    await waitForExpression(cdp, '!document.querySelector(".panel-overlay")')

    if (!await evaluate(cdp, clickByText('悬赏榜'))) throw new Error('悬赏榜入口不可点击')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("新建")')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("已归档")')
    await evaluate(cdp, closePanel)
    await waitForExpression(cdp, '!document.querySelector(".panel-overlay")')

    if (!await evaluate(cdp, clickByText('厅内传令'))) throw new Error('厅内传令入口不可点击')
    await waitForExpression(cdp, '(document.body.innerText || "").includes("厅中暂无传令") || (document.body.innerText || "").includes("实时同步中")')

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
