/**
 * A19 local Chromium regression.  It drives the real Vite-served Vue routes
 * against an in-process mock HTTP service; it never starts an Agent Provider
 * and is intentionally not a real-service E2E result.
 */
import http from 'node:http'
import https from 'node:https'
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { launchChrome, evaluate, stopChrome, waitForExpression } from '../scripts/juyiting/e13/lib/cdp-harness.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const evidenceDir = resolve(process.env.JUYITING_A19_EVIDENCE_DIR || `/var/tmp/cyf-a19-browser-smoke-${process.pid}`)
const vitePort = Number(process.env.JUYITING_A19_VITE_PORT || 18480)
const apiPort = Number(process.env.JUYITING_A19_API_PORT || 18481)
const debugPort = Number(process.env.JUYITING_A19_CDP_PORT || 19481)
const appOrigin = `https://127.0.0.1:${vitePort}`
const apiOrigin = `http://127.0.0.1:${apiPort}`
const requests = []
const unexpectedRequests = []
const preflightRequests = []
const checks = []
const cleanupEvidence = []
const check = (name, condition, detail = null) => {
  if (!condition) throw new Error(`check failed: ${name}${detail ? ` (${detail})` : ''}`)
  checks.push({ name, passed: true })
}
let vite = null
let apiServer = null
let chrome = null
let cdp = null
let profile = null

const file = { fileId: 'file-report', displayName: '项目资料', state: 'ACTIVE', latestVersion: 2, metadataRevision: 1, originKind: 'USER_UPLOAD', mediaFamily: 'DOCUMENT', createdAt: 1_700_000_000_000 }
const versions = [
  { fileId: file.fileId, version: 1, originalFilename: '项目资料-v1.docx', contentMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', byteLength: 12, createdAt: 1_700_000_000_000 },
  { fileId: file.fileId, version: 2, originalFilename: '项目资料-v2.docx', contentMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', byteLength: 13, createdAt: 1_700_000_010_000 }
]
const agent = { agentId: 'agent-alpha', name: 'Alpha', status: 'online', canOperate: true, boundToMe: true, abilities: ['document'] }
const task = { id: 'task-a19', title: '制作项目汇报', description: '根据固定版本资料制作汇报。', status: 'open', requiredAbilities: ['document'], collaborationMode: 'single', riskLevel: 'low', maxAgents: 1, assignees: [agent], assignedAgentIds: [agent.agentId] }
const links = []

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': appOrigin, 'access-control-allow-headers': 'Authorization, Content-Type, Idempotency-Key, X-Request-Id', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': 'ETag', ...headers })
  res.end(JSON.stringify(body))
}
const readBody = req => new Promise(resolve => { let text = ''; req.on('data', chunk => { text += chunk }); req.on('end', () => resolve(text)) })
const execution = () => ({ executionId: 'execution-a19', taskId: 'pwe-task-a19', runId: 'run-a19', state: 'QUEUED', targetAgentId: agent.agentId, grantRevision: 1, outputContentMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', inputs: [{ fileId: file.fileId, version: '1', inputRef: 'input-a19' }] })

const startMockApi = () => new Promise((resolveStart, reject) => {
  apiServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', apiOrigin)
    if (req.method === 'OPTIONS') { preflightRequests.push({ path: url.pathname, origin: req.headers.origin || '' }); return json(res, 204, {}) }
    const body = await readBody(req)
    let payload = null
    try { payload = body ? JSON.parse(body) : null } catch { payload = body }
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), payload, authorization: req.headers.authorization || '' })
    if (req.headers.authorization !== 'Bearer a19-local-smoke-token') return json(res, 401, { message: 'mock token required' })
    const path = url.pathname
    if (req.method === 'GET' && path === '/agent/personal-workspace/files') return json(res, 200, { items: [file], nextCursor: null })
    if (req.method === 'GET' && path === `/agent/personal-workspace/files/${file.fileId}`) return json(res, 200, { file, latestVersion: versions[1], versions })
    if (req.method === 'GET' && path === '/agent/personal-workspace/executions/capabilities') return json(res, 200, { allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], inputMimeTypes: [versions[0].contentMimeType], generationEnabled: false })
    if (req.method === 'POST' && path === '/agent/roster') return json(res, 200, { data: [agent] })
    if (req.method === 'POST' && path === '/agent/personal-workspace/executions') return json(res, 200, execution())
    if (req.method === 'GET' && path === '/agent/personal-workspace/executions/execution-a19') return json(res, 200, execution())
    if (req.method === 'POST' && path === '/agent/personal-workspace/executions/execution-a19/revoke-inputs') return json(res, 200, { ...execution(), state: 'INPUTS_REVOKED' })
    if (req.method === 'GET' && path === '/agent/map') return json(res, 200, { data: [{ ...agent, x: 8, y: 8 }] })
    if (req.method === 'GET' && path === '/agent/personas/catalog') return json(res, 200, { data: [] })
    if (req.method === 'POST' && path === '/agent/tasks/search') return json(res, 200, { data: [task] })
    if (req.method === 'POST' && path === '/agent/tasks/status-counts') return json(res, 200, { data: { open: 1, total: 1 } })
    if (req.method === 'POST' && path === `/agent/tasks/${task.id}/recommend`) return json(res, 200, { data: [] })
    if (req.method === 'GET' && path === `/agent/tasks/${task.id}/file-links`) return json(res, 200, { items: links, nextCursor: null })
    if (req.method === 'POST' && path === `/agent/tasks/${task.id}/file-links`) {
      const link = { relationId: `rel-${links.length + 1}`, taskId: task.id, fileId: payload.fileId, version: payload.version, role: payload.role, state: 'ACTIVE', relationRevision: 1, createdAt: 1_700_000_020_000 }
      links.push(link); return json(res, 200, link, { etag: `\"${link.relationId}:${link.relationRevision}\"` })
    }
    if (req.method === 'GET' && path === '/agent/scenes/juyiting-main/snapshot') return json(res, 200, { version: '0', agents: [] })
    if (req.method === 'GET' && path === '/agent/scenes/juyiting-main/events') return json(res, 200, { events: [] })
    unexpectedRequests.push({ method: req.method, path, query: Object.fromEntries(url.searchParams), payload })
    return json(res, 404, { message: `No explicit A19 mock for ${req.method} ${path}` })
  })
  apiServer.once('error', reject)
  apiServer.listen(apiPort, '127.0.0.1', () => resolveStart())
})
const stop = async () => {
  if (cdp) { cdp.close(); cdp = null; cleanupEvidence.push({ resource: 'cdp', status: 'closed' }) }
  if (chrome) { await stopChrome(chrome, profile); chrome = null; profile = null; cleanupEvidence.push({ resource: 'chromium', status: 'stopped-and-profile-removed' }) }
  if (vite && !vite.killed) { vite.kill('SIGTERM'); await Promise.race([new Promise(resolve => vite.once('exit', resolve)), delay(3000)]); vite = null; cleanupEvidence.push({ resource: 'vite', status: 'stopped' }) }
  if (apiServer) { await new Promise(resolve => apiServer.close(resolve)); apiServer = null; cleanupEvidence.push({ resource: 'mock-api', status: 'closed' }) }
}
const waitForVite = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = await new Promise(resolveReady => {
      const request = https.get(`${appOrigin}/`, { rejectUnauthorized: false }, response => { response.resume(); resolveReady(response.statusCode === 200) })
      request.once('error', () => resolveReady(false))
      request.setTimeout(250, () => { request.destroy(); resolveReady(false) })
    })
    if (ready) return
    await delay(100)
  }
  throw new Error('Vite dev server did not become reachable')
}
const setViewport = async (width, height) => cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 700 })
const clickText = async text => evaluate(cdp, `(() => { const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('button not found: ${text}'); button.click(); return true })()`)
const clickSelector = async selector => evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('selector not found: ${selector}'); el.click(); return true })()`)
const setControl = async (selector, value) => evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('control not found: ${selector}'); const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value })()`)
const visibleText = text => `document.body.innerText.includes(${JSON.stringify(text)})`
const tokenBootstrap = `localStorage.setItem('api_token', JSON.stringify({data:'a19-local-smoke-token', expTime: Date.now() + 3600000}))`
const noHorizontalOverflow = async label => {
  const dimensions = await evaluate(cdp, '({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })')
  check(`${label}: no horizontal overflow`, dimensions.scrollWidth <= dimensions.width, JSON.stringify(dimensions))
}

async function run () {
  await rm(evidenceDir, { recursive: true, force: true }); await mkdir(evidenceDir, { recursive: true })
  await startMockApi()
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, env: { ...process.env, VITE_API_BASE_URL: apiOrigin, VITE_JUYITING_TASK_WORKSPACE_ENABLED: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let viteLog = ''; vite.stdout.on('data', chunk => { viteLog += chunk }); vite.stderr.on('data', chunk => { viteLog += chunk })
  await waitForVite().catch(error => { throw new Error(`${error.message}: ${viteLog}`) })
  ;({ chrome, cdp, userDataDir: profile } = await launchChrome({ windowSize: '1440,900', debugPort }))

  // Desktop: exact v1, an explicit Agent and a single confirmation invoke only the mock API.
  await setViewport(1440, 900)
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: tokenBootstrap })
  await cdp.send('Page.navigate', { url: `${appOrigin}/workspace` })
  await waitForExpression(cdp, visibleText('我的工作空间'), 30_000)
  await waitForExpression(cdp, visibleText(file.displayName), 30_000)
  await clickSelector('.file-row')
  await waitForExpression(cdp, visibleText('交给 Agent 执行'), 20_000)
  await setControl('section[aria-labelledby="workspace-execution-title"] select', agent.agentId)
  await evaluate(cdp, `document.querySelector('.version-row button').click()`)
  await waitForExpression(cdp, visibleText('当前版本：项目资料 · v1'), 10_000)
  await clickText('加入执行资料')
  await setControl('section[aria-labelledby="workspace-execution-title"] textarea', '根据 v1 制作 PPT')
  await clickText('创建私人执行')
  await waitForExpression(cdp, visibleText('execution-a19'), 20_000)
  const create = requests.find(request => request.method === 'POST' && request.path === '/agent/personal-workspace/executions')
  check('workspace execution preserves explicit v1', JSON.stringify(create?.payload?.inputs) === JSON.stringify([{ fileId: file.fileId, version: '1' }]))
  check('workspace execution transmits explicit Agent', create?.payload?.targetAgentId === agent.agentId)
  check('workspace execution preserves instruction', create?.payload?.instruction === '根据 v1 制作 PPT')
  await clickText('撤销尚未开始的输入授权')
  await waitForExpression(cdp, visibleText('输入授权已撤销'), 20_000)
  const revoke = requests.find(request => request.method === 'POST' && request.path === '/agent/personal-workspace/executions/execution-a19/revoke-inputs')
  check('revoke preserves grant revision', revoke?.payload?.expectedGrantRevision === 1)
  await noHorizontalOverflow('desktop workspace')

  // Narrow-screen: the same actual workspace surface remains usable with no horizontal overflow.
  await setViewport(390, 844)
  await waitForExpression(cdp, visibleText('执行编号'), 10_000)
  await noHorizontalOverflow('narrow workspace')
  await evaluate(cdp, `(() => { const app = document.querySelector('#app')?.__vue_app__; const pinia = app && [...Object.getOwnPropertySymbols(app._context.provides)].map(key => app._context.provides[key]).find(value => value?._s?.get?.('api')); const api = pinia?._s?.get('api'); if (!api) throw new Error('active API store unavailable'); api.clearIdentity(); return localStorage.getItem('api_token') })()` )
  await waitForExpression(cdp, `!document.body.innerText.includes('execution-a19') && !document.body.innerText.includes('项目资料')`, 20_000)

  // Landscape Hall entry: map and roster remain independently requested, and task material uses the fixed version picker.
  await setViewport(844, 390)
  await cdp.send('Page.navigate', { url: `${appOrigin}/juyiting` })
  await waitForExpression(cdp, visibleText('聚义厅'), 30_000)
  await waitForExpression(cdp, `document.querySelectorAll('[data-portrait-action="tasks"]').length > 0`, 30_000)
  await evaluate(cdp, `document.querySelector('[data-portrait-action="tasks"]').click()`)
  await waitForExpression(cdp, visibleText('制作项目汇报'), 20_000)
  await clickSelector('.task-card')
  await waitForExpression(cdp, visibleText('从工作空间添加资料'), 20_000)
  await waitForExpression(cdp, `document.querySelector('.workspace-file-list button') != null`, 20_000)
  await clickSelector('.workspace-file-list button')
  await waitForExpression(cdp, `document.querySelector('.task-material-links select') != null`, 20_000)
  await evaluate(cdp, `(() => { const selects = document.querySelectorAll('.task-material-links select'); const version = selects[0]; version.value = '1'; version.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await clickText('关联此精确版本')
  await waitForExpression(cdp, `document.querySelectorAll('.task-link-row').length === 1`, 20_000)
  check('Hall requests map data', requests.some(request => request.path === '/agent/map'))
  check('Hall requests roster data', requests.some(request => request.path === '/agent/roster'))
  const attach = requests.find(request => request.method === 'POST' && request.path === `/agent/tasks/${task.id}/file-links`)
  check('task material preserves fixed v1 INPUT link', JSON.stringify(attach?.payload) === JSON.stringify({ fileId: file.fileId, version: 1, role: 'INPUT' }))
  check('task material does not create another execution', requests.filter(request => request.path === '/agent/personal-workspace/executions').length === 1)
  await noHorizontalOverflow('landscape Hall task material picker')

  // Layout viewport diagnostic only: this is not visualViewport-only virtual-keyboard evidence.
  await setViewport(390, 300)
  await waitForExpression(cdp, `document.querySelector('.task-material-links')?.getBoundingClientRect().width > 0`, 10_000)
  await noHorizontalOverflow('keyboard-height Hall')

  check('no unexpected mock routes', unexpectedRequests.length === 0, JSON.stringify(unexpectedRequests))
  await stop()
  const report = {
    kind: 'mock-service-browser-regression-not-real-service-e2e',
    viewports: ['1440x900', '390x844', '844x390', '390x300-layout-viewport-only'],
    checks,
    assertionCount: checks.length,
    requests: requests.map(({ method, path, payload }) => ({ method, path, payload })),
    unexpectedRequests,
    preflightRequests,
    cleanup: cleanupEvidence,
    coverageLimits: ['390x300 changes the layout viewport only; it is not visualViewport-only keyboard evidence.', 'identity cleanup invokes the Pinia API store directly; it is not a user-visible logout-button flow.', 'mock service only; no Provider and no real-service E2E.']
  }
  await writeFile(resolve(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ status: 'PASS', assertionCount: report.assertionCount, evidenceDir, unexpectedRequests: report.unexpectedRequests.length, cleanup: report.cleanup, mockServiceOnly: true }))
}

run().catch(async error => { try { await mkdir(evidenceDir, { recursive: true }); const dom = cdp ? await evaluate(cdp, '({text: document.body.innerText, url: location.href})').catch(() => null) : null; await writeFile(resolve(evidenceDir, 'failure.json'), `${JSON.stringify({error: error.stack || String(error), requests, unexpectedRequests, checks, dom}, null, 2)}\n`) } catch {} console.error(error.stack || error); process.exitCode = 1 }).finally(stop)
