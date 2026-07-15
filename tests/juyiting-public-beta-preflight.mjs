import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import WebSocket from 'ws'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const backend = process.env.JIA_BACKEND_URL || process.env.JUYITING_BACKEND_URL || 'https://localhost:10018'
const frontend = process.env.JIA_FRONTEND_URL || process.env.JUYITING_FRONTEND_URL || 'https://localhost:8080'
const apiKey = process.env.JIA_AGENT_API_KEY || 'my-secret-api-key-123'
const agentId = process.env.JIA_AGENT_WS_AGENT_ID || process.env.JIA_AGENT_SMOKE_AGENT_ID || 'jyt-jia_client-wuyong'
const username = process.env.JIA_LOGIN_USER || process.env.JUYITING_USERNAME || 'chcbz'
const password = process.env.JIA_LOGIN_PASSWORD || process.env.JUYITING_PASSWORD || '123'
const timeoutMs = Number(process.env.JUYITING_PREFLIGHT_TIMEOUT_MS || 12000)

let cookie = ''
const checks = []
const execFileAsync = promisify(execFile)

async function runNpmScript(script) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    await execFileAsync(process.execPath, [npmExecPath, 'run', script], { cwd: process.cwd() })
    return
  }
  await execFileAsync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], { cwd: process.cwd() })
}

function rememberCookie(response) {
  const setCookie = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : response.headers.get('set-cookie')?.split(/,(?=[^;]+?=)/g) || []
  const next = setCookie.map(item => item.split(';')[0]).filter(Boolean)
  if (next.length) {
    cookie = next.join('; ')
  }
}

function withTimeout(promise, label) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    })
  ])
}

async function request(path, options = {}) {
  const response = await fetch(`${backend}${path}`, {
    ...options,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {})
    },
    redirect: options.redirect || 'manual'
  })
  rememberCookie(response)
  return response
}

async function record(name, fn) {
  const startedAt = Date.now()
  try {
    await fn()
    checks.push({ name, status: 'ok', durationMs: Date.now() - startedAt })
  } catch (error) {
    checks.push({ name, status: 'failed', durationMs: Date.now() - startedAt, message: error.message })
  }
}

async function expectText(response, pattern, label) {
  const text = await response.text()
  if (!pattern.test(text)) {
    throw new Error(`${label} response did not match ${pattern}: ${text.slice(0, 500)}`)
  }
}

async function login() {
  await request('/login/index.html')
  const response = await request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      loginType: 'password',
      username,
      password,
      redirect_uri: ''
    })
  })
  if (![200, 302, 303].includes(response.status)) {
    throw new Error(`login failed with HTTP ${response.status}`)
  }
}

async function checkAgentWebSocket() {
  const wsBackend = backend.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
  const ws = new WebSocket(`${wsBackend}/ws/agent/channel?api_key=${encodeURIComponent(apiKey)}&agent_id=${encodeURIComponent(agentId)}`, {
    rejectUnauthorized: false
  })
  try {
    await withTimeout(new Promise((resolve, reject) => {
      ws.once('message', data => {
        const text = data.toString()
        if (text.includes('"type":"connected"')) resolve()
        else reject(new Error(`unexpected websocket event: ${text}`))
      })
      ws.once('unexpected-response', (_, response) => {
        const hint = response.statusCode === 401
          ? 'invalid JIA_AGENT_API_KEY or oauth_api_key is disabled/expired'
          : `HTTP ${response.statusCode}`
        reject(new Error(`websocket handshake rejected: ${hint}`))
      })
      ws.once('error', reject)
    }), 'agent websocket connected event')
  } finally {
    ws.close()
  }
}

async function main() {
  await record('release guide contains public beta gates', async () => {
    const guide = await readFile(resolve('docs/juyiting-public-beta-readiness.md'), 'utf8')
    for (const required of ['发布验证命令', '受控公测结论', '在线 Agent 派发 smoke', '本地剩余状态', '开放公测前检查清单']) {
      if (!guide.includes(required)) {
        throw new Error(`release guide missing section: ${required}`)
      }
    }
  })

  await record('release runbook contains operating gates', async () => {
    const runbook = await readFile(resolve('docs/juyiting-public-beta-runbook.md'), 'utf8')
    for (const required of ['发布窗口', '责任人', '发布前门禁', '监控确认', '告警确认', '回滚步骤', '发布后观察']) {
      if (!runbook.includes(required)) {
        throw new Error(`release runbook missing section: ${required}`)
      }
    }
  })

  await record('validate Juyiting map assets', async () => {
    await runNpmScript('validate:juyiting-map')
  })

  await record('validate Juyiting sprite assets', async () => {
    await runNpmScript('validate:juyiting-sprites')
  })

  await record('backend login works', login)

  await record('agent map contains Songjiang', async () => {
    const response = await request('/agent/map')
    if (!response.ok) throw new Error(`agent map failed with HTTP ${response.status}`)
    await expectText(response, /宋江|songjiang|builtin-songjiang/, 'agent map')
  })

  await record('bounty status counts available', async () => {
    const response = await request('/agent/tasks/status-counts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    if (!response.ok) throw new Error(`status counts failed with HTTP ${response.status}`)
    await expectText(response, /"total"|total/, 'task status counts')
  })

  await record('bounty task search available', async () => {
    const response = await request('/agent/tasks/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"pageSize":5}'
    })
    if (!response.ok) throw new Error(`task search failed with HTTP ${response.status}`)
    await expectText(response, /data|rows|list/, 'task search')
  })

  await record('library search available', async () => {
    const response = await request('/chat/library/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"keyword":"聚义厅","topK":5}'
    })
    if (!response.ok) throw new Error(`library search failed with HTTP ${response.status}`)
    await expectText(response, /"code"\s*:\s*"E0"|status|data/, 'library search')
  })

  await record('frontend juyiting route available', async () => {
    const response = await fetch(`${frontend}/juyiting`, { method: 'HEAD' })
    if (![200, 304].includes(response.status)) {
      throw new Error(`frontend route returned HTTP ${response.status}`)
    }
  })

  await record('agent websocket accepts public beta api key', checkAgentWebSocket)

  const failed = checks.filter(check => check.status !== 'ok')
  console.log(JSON.stringify({ backend, frontend, checks }, null, 2))
  if (failed.length) {
    throw new Error(`聚义厅公测 preflight 失败: ${failed.map(check => check.name).join(', ')}`)
  }
  console.log('聚义厅公测 preflight 验证通过')
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
