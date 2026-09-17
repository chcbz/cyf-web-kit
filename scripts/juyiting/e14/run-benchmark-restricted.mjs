import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const ROOT = process.cwd()
const DIST = resolve(ROOT, 'dist/e14-benchmark')
const REPORT = resolve(ROOT, 'tests/fixtures/juyiting/occlusion-e14/benchmark-report.json')
const SHIM_SOURCE = resolve(ROOT, 'scripts/juyiting/e14/shutdown-eperm-compat.c')
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/chromium-headless-smoke'
const COMMAND_TIMEOUT_MS = 45_000

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production', ...(options.env || {}) },
    })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} exited ${code}`)))
  })
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function collectProvenance() {
  const inputs = [
    'scripts/juyiting/e14/benchmark-entry.ts',
    'scripts/juyiting/e14/run-benchmark-restricted.mjs',
    'scripts/juyiting/e14/shutdown-eperm-compat.c',
    'scripts/juyiting/e14/vite.config.mjs',
    'tests/juyiting-occlusion-e14.test.js',
  ]
  const occlusionDir = resolve(ROOT, 'src/game/occlusion')
  for (const entry of await readdir(occlusionDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) inputs.push(`src/game/occlusion/${entry.name}`)
  }
  inputs.sort()
  return {
    generatedAt: new Date().toISOString(),
    inputs: Object.fromEntries(await Promise.all(inputs.map(async path => [path, await sha256(resolve(ROOT, path))]))),
  }
}

async function inventoryBuildArtifacts(dir) {
  const resources = []
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else resources.push({ path: relative(dir, path), bytes: (await stat(path)).size })
    }
  }
  await walk(dir)
  return {
    requestCount: resources.length,
    transferredBytes: resources.reduce((sum, item) => sum + item.bytes, 0),
    resources,
    source: 'production-build-artifact-inventory',
  }
}

class PipeCdpSession {
  constructor(chrome) {
    this.chrome = chrome
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.buffer = Buffer.alloc(0)
    chrome.stdio[4].on('data', chunk => this.onData(chunk))
    chrome.once('error', error => this.fail(error))
    chrome.once('exit', (code, signal) => this.fail(new Error(`Chromium exited (code=${code}, signal=${signal})`)))
    chrome.stdio[3].on('error', error => this.fail(error))
    chrome.stdio[4].on('error', error => this.fail(error))
    chrome.stdio[4].once('end', () => this.fail(new Error('Chromium CDP pipe ended')))
  }

  fail(error) {
    this.failure ||= error
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(this.failure)
    }
    this.pending.clear()
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    let separator
    while ((separator = this.buffer.indexOf(0)) >= 0) {
      const raw = this.buffer.subarray(0, separator).toString()
      this.buffer = this.buffer.subarray(separator + 1)
      if (!raw) continue
      const message = JSON.parse(raw)
      if (message.id && this.pending.has(message.id)) {
        const { resolve: resolvePending, reject, timer } = this.pending.get(message.id)
        this.pending.delete(message.id)
        clearTimeout(timer)
        if (message.error) reject(new Error(message.error.message))
        else resolvePending(message.result || {})
      } else if (message.method) {
        this.events.push(message)
      }
    }
  }

  send(method, params = {}, sessionId) {
    if (this.failure) return Promise.reject(this.failure)
    const id = this.nextId++
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`))
      }, COMMAND_TIMEOUT_MS)
      this.pending.set(id, { resolve: resolvePromise, reject, timer })
      this.chrome.stdio[3].write(`${JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      })}\0`)
    })
  }

  close() {
    this.fail(new Error('CDP pipe closed'))
    this.chrome.stdio[3].end()
  }
}

function collectNetworkEvidence(events) {
  const requests = new Map()
  for (const event of events) {
    const requestId = event.params?.requestId
    if (!requestId) continue
    if (event.method === 'Network.requestWillBeSent') {
      requests.set(requestId, {
        requestId,
        url: event.params.request?.url ?? null,
        method: event.params.request?.method ?? null,
        type: event.params.type ?? null,
        status: null,
        mimeType: null,
        encodedDataLength: 0,
        finished: false,
      })
    } else if (event.method === 'Network.responseReceived') {
      const request = requests.get(requestId)
      if (request) {
        request.status = event.params.response?.status ?? null
        request.mimeType = event.params.response?.mimeType ?? null
      }
    } else if (event.method === 'Network.loadingFinished') {
      const request = requests.get(requestId)
      if (request) {
        request.encodedDataLength = event.params.encodedDataLength ?? 0
        request.finished = true
      }
    }
  }
  const resources = [...requests.values()].filter(request => request.url?.startsWith('file:'))
  return {
    requestCount: resources.length,
    transferredBytes: resources.reduce((sum, resource) => sum + resource.encodedDataLength, 0),
    resources,
    source: 'chromium-cdp-network-events',
  }
}

async function terminateChrome(chrome) {
  if (chrome.exitCode !== null || chrome.signalCode !== null) return
  chrome.kill('SIGKILL')
  await Promise.race([
    new Promise(resolvePromise => chrome.once('exit', resolvePromise)),
    delay(1000),
  ])
}

async function launchChrome(shimLibrary, profileDir) {
  const launchArguments = [
    '--headless=new',
    '--enable-automation',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-breakpad',
    '--enable-precise-memory-info',
    '--no-first-run',
    '--no-default-browser-check',
    // A private profile prevents connecting to another task's running browser.
    `--user-data-dir=${profileDir}`,
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--allow-file-access-from-files',
    '--remote-debugging-pipe',
    '--window-size=1664,928',
    'about:blank',
  ]
  const chrome = spawn(CHROME, launchArguments, {
    cwd: ROOT,
    env: { ...process.env, LD_PRELOAD: [shimLibrary, process.env.LD_PRELOAD].filter(Boolean).join(' ') },
    stdio: ['ignore', 'ignore', 'inherit', 'pipe', 'pipe'],
  })
  const cdp = new PipeCdpSession(chrome)
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    await cdp.send('Performance.enable', {}, sessionId)
    await cdp.send('Network.enable', {}, sessionId)
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId)
    // Full Chromium includes browser chrome in window-size; pin the measured page viewport.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1664, height: 928, deviceScaleFactor: 1, mobile: false }, sessionId)
    return { chrome, cdp, sessionId, launchArguments }
  } catch (error) {
    cdp.close()
    await terminateChrome(chrome)
    throw error
  }
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
  return result.result?.value
}

async function waitForExpression(cdp, sessionId, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    lastValue = await evaluate(cdp, sessionId, expression)
    if (lastValue) return lastValue
    await delay(500)
  }
  throw new Error(`Timed out waiting for ${expression}; last value=${JSON.stringify(lastValue)}`)
}

async function stopChrome(chrome, cdp) {
  try { await cdp.send('Browser.close') } catch { /* force-kill below */ }
  await Promise.race([
    new Promise(resolvePromise => chrome.once('exit', resolvePromise)),
    delay(3000),
  ])
  if (chrome.exitCode === null && chrome.signalCode === null) await terminateChrome(chrome)
  cdp.close()
}

// Fail closed: a failed or interrupted run must never leave an older PASS report usable.
await rm(REPORT, { force: true })
// This ESM config needs no bundling; keep borrowed node_modules read-only (.vite-temp).
await run(process.execPath, ['./node_modules/vite/bin/vite.js', 'build', '--configLoader', 'native', '--config', 'scripts/juyiting/e14/vite.config.mjs'])
const runDir = await mkdtemp(resolve(tmpdir(), 'cyf-e14-'))
const shimLibrary = resolve(runDir, 'shutdown-eperm-compat.so')

const pageUrl = pathToFileURL(resolve(DIST, 'index.html')).href
const artifactInventory = await inventoryBuildArtifacts(DIST)
let chrome
let cdp
let sessionId
let launchArguments
try {
  await run('gcc', ['-shared', '-fPIC', '-O2', '-o', shimLibrary, SHIM_SOURCE, '-ldl'])
  ;({ chrome, cdp, sessionId, launchArguments } = await launchChrome(shimLibrary, resolve(runDir, 'profile')))
  await cdp.send('Page.navigate', { url: pageUrl }, sessionId)
  await waitForExpression(cdp, sessionId, `globalThis.__E14_STATUS__ === 'running' || globalThis.__E14_STATUS__ === 'failed'`, 20_000)
  await waitForExpression(cdp, sessionId, `globalThis.__E14_STATUS__ === 'complete' || globalThis.__E14_STATUS__ === 'failed'`, 85_000)
  const error = await evaluate(cdp, sessionId, 'globalThis.__E14_ERROR__ || null')
  if (error) throw new Error(error)
  const report = await evaluate(cdp, sessionId, 'globalThis.__E14_RESULT__')
  const runtimeViewport = await evaluate(cdp, sessionId, `({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  })`)
  const browserVersion = await cdp.send('Browser.getVersion')
  const executablePath = await readlink(`/proc/${chrome.pid}/exe`)
  // Chromium may rewrite /proc cmdline to a single process title; CDP retains argv boundaries.
  const processCommandLine = (await readFile(`/proc/${chrome.pid}/cmdline`, 'utf8')).split('\0').filter(Boolean)
  const { arguments: executableArguments } = await cdp.send('Browser.getBrowserCommandLine')
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo')
  if (!processInfo.some(process => process.type === 'browser' && process.id === chrome.pid) ||
      !processInfo.some(process => process.type === 'renderer' && process.id !== chrome.pid)) {
    throw new Error('Expected an owned Chromium browser with a separate renderer process')
  }
  const perf = await cdp.send('Performance.getMetrics', {}, sessionId)
  const heap = await cdp.send('Runtime.getHeapUsage', {}, sessionId)
  const metrics = Object.fromEntries((perf.metrics || []).map(({ name, value }) => [name, value]))
  report.environment.executionEngine = 'chromium-cdp-pipe-restricted-host'
  report.environment.chromiumGateEligible = true
  report.environment.transport = 'file-url+cdp-pipe'
  report.environment.processModel = 'multi-process'
  report.environment.runtimeViewport = runtimeViewport
  report.environment.seccompCompatibility = 'tracked AF_UNIX socketpair shutdown(2) EPERM-only fallback'
  report.provenance = await collectProvenance()
  report.browser = {
    product: browserVersion.product,
    protocolVersion: browserVersion.protocolVersion,
    jsVersion: browserVersion.jsVersion,
    userAgent: browserVersion.userAgent,
    launcherPath: CHROME,
    launcherSha256: await sha256(CHROME),
    executablePath,
    executableSha256: await sha256(executablePath),
    processId: chrome.pid,
    processInfo,
    launchArguments,
    executableArguments,
    executableArgumentsSource: 'Browser.getBrowserCommandLine',
    processCommandLine,
  }
  report.network = collectNetworkEvidence(cdp.events)
  report.artifactInventory = artifactInventory
  report.cdp = {
    jsHeapUsedBytes: heap.usedSize,
    jsHeapTotalBytes: heap.totalSize,
    taskDurationSeconds: metrics.TaskDuration ?? null,
    scriptDurationSeconds: metrics.ScriptDuration ?? null,
    layoutCount: metrics.LayoutCount ?? null,
    recalcStyleCount: metrics.RecalcStyleCount ?? null,
    nodes: metrics.Nodes ?? null,
    documents: metrics.Documents ?? null,
  }
  report.gates = {
    p95AtMost2Ms: report.timing.total.p95 <= 2,
    p99AtMost4Ms: report.timing.total.p99 <= 4,
    noFullGridScan: report.complexity.spatialGridDelta.scanCount === 0,
    sparseMembershipChecks: report.complexity.membershipChecksPerFrameMean < report.complexity.theoreticalAgentsTimesAllZonesPerFrame * 0.5,
    noSustainedGcThrash: report.memory.browserHeapGrowthBytes === null || report.memory.browserHeapGrowthBytes < 64 * 1024 * 1024,
  }
  report.pass = Object.values(report.gates).every(Boolean)
  await mkdir(resolve(REPORT, '..'), { recursive: true })
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`)
  // Emit the complete fresh evidence before browser shutdown or later test failures.
  console.log(`CYF_E14_REPORT_BASE64=${Buffer.from(JSON.stringify(report)).toString('base64')}`)
  console.log(JSON.stringify({ report: REPORT, pass: report.pass, timing: report.timing, gates: report.gates, environment: report.environment }, null, 2))
  if (!report.pass) process.exitCode = 1
} finally {
  if (chrome && cdp) await stopChrome(chrome, cdp)
  await rm(runDir, { recursive: true, force: true })
}
