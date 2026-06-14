import WebSocket from 'ws'

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const backend = process.env.JIA_BACKEND_URL || 'https://localhost:10018'
const wsBackend = backend.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
const apiKey = process.env.JIA_AGENT_API_KEY || 'my-secret-api-key-123'
const agentId = process.env.JIA_AGENT_SMOKE_AGENT_ID || `public-beta-smoke-${Date.now()}`
const timeoutMs = Number(process.env.JIA_AGENT_SMOKE_TIMEOUT_MS || 15000)

let cookie = ''

function withTimeout(promise, label) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    })
  ])
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

async function request(path, options = {}) {
  const response = await fetch(`${backend}${path}`, {
    ...options,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {})
    }
  })
  rememberCookie(response)
  return response
}

async function login() {
  await request('/login/index.html')
  const body = new URLSearchParams({
    loginType: 'password',
    username: process.env.JIA_LOGIN_USER || 'chcbz',
    password: process.env.JIA_LOGIN_PASSWORD || '123',
    redirect_uri: ''
  })
  const response = await request('/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (![200, 302, 303].includes(response.status)) {
    throw new Error(`login failed with HTTP ${response.status}`)
  }
}

function openAgentSocket() {
  const url = `${wsBackend}/ws/agent/channel?api_key=${encodeURIComponent(apiKey)}`
  const ws = new WebSocket(url, { rejectUnauthorized: false })
  const messages = []
  const waiters = []

  ws.on('message', data => {
    const text = data.toString()
    messages.push(text)
    for (const waiter of [...waiters]) {
      if (waiter.predicate(text)) {
        waiter.resolve(text)
        waiters.splice(waiters.indexOf(waiter), 1)
      }
    }
  })
  ws.on('unexpected-response', (_, response) => {
    const detail = response.statusCode === 401
      ? 'invalid or expired JIA_AGENT_API_KEY; check oauth_api_key.status=1 and expire_time'
      : `HTTP ${response.statusCode}`
    ws.emit('error', new Error(`websocket handshake rejected: ${detail}`))
  })

  ws.waitFor = predicate => {
    const matched = messages.find(predicate)
    if (matched) {
      return Promise.resolve(matched)
    }
    return new Promise(resolve => waiters.push({ predicate, resolve }))
  }
  ws.messages = messages
  return ws
}

async function main() {
  await login()

  const ws = openAgentSocket()
  try {
    await withTimeout(new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    }), 'websocket open')

    await withTimeout(ws.waitFor(text => text.includes('"type":"connected"')), 'connected event')
    ws.send(JSON.stringify({
      type: 'agent.register',
      requestId: `reg-${agentId}`,
      agentId,
      name: '公测在线派发验证 Agent',
      abilities: ['public-beta-smoke', 'task_briefing']
    }))
    await withTimeout(ws.waitFor(text => text.includes('"type":"agent_registered"') && text.includes(agentId)), 'agent register')

    const intentId = `intent-${Date.now()}`
    const directMessagePromise = ws.waitFor(text => text.includes('"type":"agent_direct_message"') && text.includes(intentId))
    const dispatchResponse = await request(`/juyiting/actions/${intentId}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actorAgentId: agentId,
        actionType: 'task_briefing',
        conversationId: `public-beta-smoke-${Date.now()}`,
        taskId: `task-${Date.now()}`,
        targetAgentIds: [agentId],
        instruction: '请确认你已收到聚义厅公测在线派发验证。',
        reason: 'public beta online agent smoke',
        autonomyLevel: 'assist',
        requiresApproval: false
      })
    })
    if (!dispatchResponse.ok) {
      throw new Error(`dispatch failed with HTTP ${dispatchResponse.status}`)
    }
    const dispatchBody = await dispatchResponse.text()
    if (!dispatchBody.includes('"status":"dispatched"')) {
      throw new Error(`dispatch response did not report dispatched: ${dispatchBody}`)
    }

    const directMessage = await withTimeout(directMessagePromise, 'agent direct message')
    if (!directMessage.includes('"actionType":"task_briefing"')) {
      throw new Error(`direct message missing task_briefing action: ${directMessage}`)
    }

    console.log(`聚义厅在线 Agent 派发 smoke 验证通过: ${agentId}`)
  } finally {
    ws.close()
  }
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
