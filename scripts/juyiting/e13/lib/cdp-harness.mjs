/**
 * E13 CDP harness — reused verbatim patterns from tests/juyiting-public-beta-ui-smoke.mjs
 * (same CdpSession, waitForExpression, evaluate, fulfillJson/fulfillSse, findChrome,
 * waitForJson, stopChrome). No puppeteer/playwright introduced.
 * Adds: launchChrome (returns chrome+cdp), captureCanvasPng (Page.captureScreenshot
 * clipped to the melon canvas rect), and evaluateJson helpers.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'

const CDP_COMMAND_TIMEOUT_MS = Number(process.env.JUYITING_CDP_COMMAND_TIMEOUT_MS) || 45_000
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/local/bin/chromium-headless-smoke',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean)

export const GAME_LOOKUP_SOURCE = `
  let juyitingGame = window.__JYTING_GAME__;
  if (!juyitingGame) {
    let component = document.querySelector('.hall-stage')?.__vueParentComponent;
    while (component && !component.setupState?.juyitingGame) component = component.parent;
    juyitingGame = component?.setupState?.juyitingGame;
  }
  if (!juyitingGame) throw new Error('Mounted Juyiting game instance is unavailable');
`

export const pathExists = async (path) => {
  try {
    const { access } = await import('node:fs/promises')
    await access(path)
    return true
  } catch { return false }
}

export const findChrome = async () => {
  for (const candidate of CHROME_CANDIDATES) {
    if (await pathExists(candidate)) return candidate
  }
  throw new Error('Chrome or Edge executable not found. Set CHROME_PATH.')
}

export const waitForJson = async (url, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) { lastError = error }
    await delay(250)
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

export class CdpSession {
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
          Promise.resolve(handler(message.params || {})).catch(error => this.handlerErrors.push(error))
        }
      }
    })
  }

  on (method, handler) { this.handlers.set(method, handler) }

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
      }, CDP_COMMAND_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  close () {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('CDP session closed')) }
    this.pending.clear()
    this.ws.close()
  }
}

export const waitForExpression = async (cdp, expression, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    cdp.throwHandlerErrors()
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    lastValue = result.result?.value
    if (lastValue) return lastValue
    await delay(500)
  }
  throw new Error(`Timed out waiting for expression: ${expression}. Last value: ${JSON.stringify(lastValue)}`)
}

export const evaluate = async (cdp, expression) => {
  cdp.throwHandlerErrors()
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) {
    const details = result.exceptionDetails
    const description = details.exception?.description || details.exception?.value || details.text || 'Runtime.evaluate failed'
    const location = Number.isInteger(details.lineNumber)
      ? ` at ${details.url || '<evaluation>'}:${details.lineNumber + 1}:${(details.columnNumber || 0) + 1}`
      : ''
    throw new Error(`${description}${location}`)
  }
  return result.result?.value
}

export const fulfillJson = (cdp, requestId, status, value, origin = '') => cdp.send('Fetch.fulfillRequest', {
  requestId,
  responseCode: status,
  responseHeaders: [
    { name: 'Content-Type', value: 'application/json; charset=utf-8' },
    ...(origin ? [{ name: 'Access-Control-Allow-Origin', value: origin }] : [])
  ],
  body: Buffer.from(JSON.stringify(value)).toString('base64')
})

export const fulfillSse = (cdp, requestId, body, origin = '') => cdp.send('Fetch.fulfillRequest', {
  requestId,
  responseCode: 200,
  responseHeaders: [
    { name: 'Content-Type', value: 'text/event-stream; charset=utf-8' },
    { name: 'Cache-Control', value: 'no-cache' },
    ...(origin ? [{ name: 'Access-Control-Allow-Origin', value: origin }] : [])
  ],
  body: Buffer.from(body).toString('base64')
})

/** Launch headless chrome with a CDP session on a fresh target page. */
export const launchChrome = async ({ windowSize = '1440,900', debugPort = 9333 } = {}) => {
  const chromePath = await findChrome()
  const userDataDir = await mkdtemp(join(tmpdir(), 'juyiting-e13-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--ignore-certificate-errors', `--window-size=${windowSize}`,
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, 'about:blank'
  ], { stdio: 'ignore' })
  let cdp
  try {
    const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`)
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json())
    cdp = new CdpSession(target.webSocketDebuggerUrl || version.webSocketDebuggerUrl)
    await cdp.open()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    return { chrome, cdp, userDataDir }
  } catch (error) {
    if (cdp) cdp.close()
    await stopChrome(chrome, userDataDir)
    throw error
  }
}

export const stopChrome = async (chrome, userDataDir) => {
  if (!chrome.killed) chrome.kill()
  await Promise.race([
    new Promise(resolve => chrome.once('exit', resolve)),
    delay(3000)
  ])
  for (let attempt = 0; attempt < 5; attempt++) {
    try { await rm(userDataDir, { recursive: true, force: true }); return } catch (error) {
      if (attempt === 4) return
      await delay(500)
    }
  }
}

/** Capture the melon canvas as PNG bytes (clipped to the canvas rect). */
export const captureCanvasPng = async (cdp, { clipPadding = 0 } = {}) => {
  const rect = await evaluate(cdp, `(() => {
    const canvas = document.querySelector('.melon-layer canvas');
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const left = Math.max(0, r.left - ${clipPadding});
    const top = Math.max(0, r.top - ${clipPadding});
    const right = Math.min(window.innerWidth, r.right + ${clipPadding});
    const bottom = Math.min(window.innerHeight, r.bottom + ${clipPadding});
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  })()`)
  if (!rect || !rect.width || !rect.height) throw new Error('Melon canvas is unavailable for screenshot')
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
    clip: { ...rect, scale: 1 }
  })
  if (!result?.data) throw new Error('Page.captureScreenshot returned no data')
  return Buffer.from(result.data, 'base64')
}

/** Capture the current browser viewport, including DOM overlays and the melon canvas. */
export const captureViewportPng = async (cdp) => {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
  })
  if (!result?.data) throw new Error('Page.captureScreenshot returned no viewport data')
  return Buffer.from(result.data, 'base64')
}

export const isMainModule = (metaUrl) => process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === metaUrl
  : false
