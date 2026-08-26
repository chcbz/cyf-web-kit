import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  applyLocalTlsPolicy,
  cleanupFailure,
  completeTrackedCleanup,
  createSafetyContext,
  credentialValuesFromEnv,
  fetchApprovedOrigin,
  PREFLIGHT_CLEANUP_ERROR_CODE,
  sanitizeError,
  stopProcessTree
} from './juyiting-preflight-safety.mjs'

const ALLOWED_ASSET_SCRIPTS = new Set(['validate:juyiting-map', 'validate:juyiting-sprites'])

const parseOperationTimeout = (env) => {
  const value = Number(env.JUYITING_PREFLIGHT_TIMEOUT_MS || 12_000)
  if (!Number.isInteger(value) || value <= 0 || value > 60_000) {
    throw new Error('JUYITING_PREFLIGHT_TIMEOUT_MS must be an integer from 1 through 60000')
  }
  return value
}

const execFileWithGuard = ({ file, args, cwd, execFileImpl, guard, label, stopProcessTreeImpl }) => {
  let child
  let untrack = () => {}
  let stopPromise
  const stopTrackedChild = () => {
    if (!stopPromise) stopPromise = stopProcessTreeImpl({ child, label: `npm ${label}` })
    return stopPromise
  }

  const completion = new Promise((resolvePromise, rejectPromise) => {
    guard.beforeBoundary(label)
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true
      queueMicrotask(async () => {
        try {
          await completeTrackedCleanup(stopTrackedChild, untrack)
          if (error) rejectPromise(error)
          else resolvePromise()
        } catch (cleanupError) {
          rejectPromise(cleanupFailure(
            error ? [error, cleanupError] : [cleanupError],
            `${label} failed and cleanup was incomplete`
          ))
        }
      })
    }

    try {
      child = execFileImpl(file, args, {
        cwd,
        detached: process.platform !== 'win32'
      }, finish)
      child?.once?.('error', finish)
      untrack = guard.trackCleanup(stopTrackedChild)
    } catch (error) {
      finish(error)
    }
  })
  return guard.runPromise(completion, label)
}

export async function runNpmScript (script, options = {}) {
  if (!ALLOWED_ASSET_SCRIPTS.has(script)) throw new Error(`Unsupported preflight npm script: ${script}`)
  const { guard } = options
  if (!guard) throw new Error('Preflight safety guard is required before npm child spawn')
  const cwd = options.cwd || process.cwd()
  const execFileImpl = options.execFileImpl || execFile
  const stopProcessTreeImpl = options.stopProcessTreeImpl || stopProcessTree
  const npmExecPath = options.npmExecPath === undefined ? process.env.npm_execpath : options.npmExecPath
  const label = `npm ${script} child spawn`

  if (npmExecPath) {
    await execFileWithGuard({
      file: process.execPath,
      args: [npmExecPath, 'run', script],
      cwd,
      execFileImpl,
      guard,
      label,
      stopProcessTreeImpl
    })
    return
  }
  if (process.platform === 'win32') {
    const commandShell = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe'
    await execFileWithGuard({
      file: commandShell,
      args: ['/d', '/s', '/c', `npm run ${script}`],
      cwd,
      execFileImpl,
      guard,
      label,
      stopProcessTreeImpl
    })
    return
  }
  await execFileWithGuard({
    file: 'npm', args: ['run', script], cwd, execFileImpl, guard, label, stopProcessTreeImpl
  })
}

const rememberCookie = (state, response) => {
  const setCookie = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : response.headers.get('set-cookie')?.split(/,(?=[^;]+?=)/g) || []
  const next = setCookie.map(item => item.split(';')[0]).filter(Boolean)
  if (next.length) state.cookie = next.join('; ')
}

const createRequest = ({ config, guard, fetchImpl, state, timeoutMs }) => async (path, options = {}, label = 'credentialed API request') => {
  guard.beforeBoundary(label)
  const url = new URL(path, config.targets.backend)
  const response = await fetchApprovedOrigin({
    guard,
    fetchImpl,
    url,
    options: {
      ...options,
      headers: {
        ...(state.cookie ? { Cookie: state.cookie } : {}),
        ...(options.headers || {})
      }
    },
    label,
    timeoutMs,
    expectedOrigin: config.targetOrigins.backend,
    rejectRedirectStatus: false
  })
  rememberCookie(state, response)
  return response
}

const expectText = async (response, pattern, label) => {
  const text = await response.text()
  if (!pattern.test(text)) throw new Error(`${label} response did not match the required shape`)
}

export const checkFrontendRoute = async ({ config, guard, fetchImpl, timeoutMs }) => {
  const response = await fetchApprovedOrigin({
    guard,
    fetchImpl,
    url: new URL('/juyiting', config.targets.frontend),
    options: { method: 'HEAD' },
    label: 'frontend route request',
    timeoutMs,
    expectedOrigin: config.targetOrigins.frontend
  })
  if (![200, 304].includes(response.status)) {
    throw new Error(`frontend route returned HTTP ${response.status}`)
  }
}

const login = async ({ request, credentials, guard }) => {
  guard.beforeBoundary('credentialed login page request')
  await request('/login/index.html', {}, 'credentialed login page request')
  guard.beforeBoundary('credentialed login submission')
  const response = await request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      loginType: 'password',
      username: credentials.username,
      password: credentials.password,
      redirect_uri: ''
    })
  }, 'credentialed login submission')
  if (![200, 302, 303].includes(response.status)) {
    throw new Error(`login failed with HTTP ${response.status}`)
  }
}

const checkAgentWebSocket = async ({ config, guard, timeoutMs, WebSocketCtor }) => {
  guard.beforeBoundary('credentialed agent WebSocket handshake')
  const Socket = WebSocketCtor || (
    await guard.runPromise(import('ws'), 'agent WebSocket module load')
  ).default
  guard.beforeBoundary('credentialed agent WebSocket handshake')
  const wsProtocol = config.targets.backend.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = new URL('/ws/agent/channel', config.targets.backend)
  wsUrl.protocol = wsProtocol
  wsUrl.searchParams.set('api_key', config.credentials.apiKey)
  wsUrl.searchParams.set('agent_id', config.credentials.agentId)
  const ws = new Socket(wsUrl, { rejectUnauthorized: !config.allowInsecureTls })
  const untrack = guard.trackCleanup(() => ws.close())
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      const boundedTimeout = Math.max(1, Math.min(timeoutMs, guard.remainingMs()))
      const timer = setTimeout(() => {
        ws.close()
        rejectPromise(new Error(`agent websocket connected event timed out after ${boundedTimeout}ms`))
      }, boundedTimeout)
      const finish = callback => (...values) => {
        clearTimeout(timer)
        guard.signal.removeEventListener('abort', onAbort)
        callback(...values)
      }
      const onAbort = finish(() => rejectPromise(new Error('agent websocket stopped by termination/deadline')))
      guard.signal.addEventListener('abort', onAbort, { once: true })
      ws.once('message', finish(data => {
        const text = data.toString()
        if (text.includes('"type":"connected"')) resolvePromise()
        else rejectPromise(new Error('unexpected websocket event type'))
      }))
      ws.once('unexpected-response', finish((_, response) => {
        const hint = response.statusCode === 401
          ? 'invalid explicit agent API credential or disabled credential'
          : `HTTP ${response.statusCode}`
        rejectPromise(new Error(`websocket handshake rejected: ${hint}`))
      }))
      ws.once('error', finish(rejectPromise))
    })
  } finally {
    untrack()
    ws.close()
  }
}

const record = async ({ checks, name, fn, guard, secrets }) => {
  const startedAt = Date.now()
  try {
    await fn()
    checks.push({ name, status: 'ok', durationMs: Date.now() - startedAt })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      message: sanitizeError(error, secrets)
    })
    if (error?.code === 'PREFLIGHT_TERMINATED' ||
        error?.code === PREFLIGHT_CLEANUP_ERROR_CODE ||
        guard.terminated) throw error
  }
}

export async function runPreflight (options = {}) {
  const env = options.env || process.env
  const timeoutMs = parseOperationTimeout(env)
  const context = await createSafetyContext({
    mode: 'preflight',
    env,
    readFileImpl: options.readFileImpl,
    signalTarget: options.signalTarget,
    now: options.now,
    setTimeoutImpl: options.setTimeoutImpl,
    clearTimeoutImpl: options.clearTimeoutImpl
  })
  const { config, guard } = context
  const restoreTls = applyLocalTlsPolicy(context)
  const checks = []
  const state = { cookie: '' }
  const secrets = Object.values(config.credentials)
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const request = createRequest({ config, guard, fetchImpl, state, timeoutMs })
  const npmScriptImpl = options.runNpmScriptImpl || runNpmScript
  let uiSmokeImpl = options.uiSmokeImpl

  const runRecord = (name, fn) => record({ checks, name, fn, guard, secrets })
  try {
    await runRecord('validate Juyiting map assets', async () => {
      await npmScriptImpl('validate:juyiting-map', {
        guard,
        execFileImpl: options.execFileImpl,
        npmExecPath: options.npmExecPath
      })
    })

    await runRecord('validate Juyiting sprite assets', async () => {
      await npmScriptImpl('validate:juyiting-sprites', {
        guard,
        execFileImpl: options.execFileImpl,
        npmExecPath: options.npmExecPath
      })
    })

    await runRecord('backend login works', () => login({ request, credentials: config.credentials, guard }))

    await runRecord('agent map contains Songjiang', async () => {
      guard.beforeBoundary('credentialed agent map API request')
      const response = await request('/agent/map', {}, 'credentialed agent map API request')
      if (!response.ok) throw new Error(`agent map failed with HTTP ${response.status}`)
      await expectText(response, /宋江|songjiang|builtin-songjiang/, 'agent map')
    })

    await runRecord('bounty status counts available', async () => {
      guard.beforeBoundary('credentialed task status API request')
      const response = await request('/agent/tasks/status-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }, 'credentialed task status API request')
      if (!response.ok) throw new Error(`status counts failed with HTTP ${response.status}`)
      await expectText(response, /"total"|total/, 'task status counts')
    })

    await runRecord('bounty task search available', async () => {
      guard.beforeBoundary('credentialed task search API request')
      const response = await request('/agent/tasks/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"pageSize":5}'
      }, 'credentialed task search API request')
      if (!response.ok) throw new Error(`task search failed with HTTP ${response.status}`)
      await expectText(response, /data|rows|list/, 'task search')
    })

    await runRecord('library search available', async () => {
      guard.beforeBoundary('credentialed library search API request')
      const response = await request('/chat/library/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"keyword":"聚义厅","topK":5}'
      }, 'credentialed library search API request')
      if (!response.ok) throw new Error(`library search failed with HTTP ${response.status}`)
      await expectText(response, /"code"\s*:\s*"E0"|status|data/, 'library search')
    })

    await runRecord('frontend juyiting route available', () => checkFrontendRoute({
      config,
      guard,
      fetchImpl,
      timeoutMs
    }))

    await runRecord('simulation vertical slice browser smoke', async () => {
      guard.beforeBoundary('credentialed OAuth browser smoke')
      if (!uiSmokeImpl) {
        uiSmokeImpl = (
          await guard.runPromise(
            import('./juyiting-public-beta-ui-smoke.mjs'),
            'UI smoke module load'
          )
        ).runUiSmoke
      }
      await uiSmokeImpl({
        safetyContext: context,
        fetchImpl,
        spawnImpl: options.spawnImpl,
        WebSocketCtor: options.CdpWebSocketCtor
      })
    })

    await runRecord('agent websocket accepts public beta api key', async () => {
      await checkAgentWebSocket({
        config,
        guard,
        timeoutMs,
        WebSocketCtor: options.AgentWebSocketCtor
      })
    })

    const failed = checks.filter(check => check.status !== 'ok')
    console.log(JSON.stringify({ targets: config.targetOrigins, checks }, null, 2))
    if (failed.length) {
      throw new Error(`聚义厅公测 preflight 失败: ${failed.map(check => check.name).join(', ')}`)
    }
    console.log('聚义厅公测 preflight 验证通过')
    return { targets: config.targetOrigins, checks }
  } finally {
    restoreTls()
    await guard.dispose()
  }
}

const isMainModule = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false

if (isMainModule) {
  runPreflight().catch(error => {
    console.error(sanitizeError(error, credentialValuesFromEnv(process.env)))
    process.exitCode = 1
  })
}
