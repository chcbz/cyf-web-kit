import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { launchChrome, evaluate, waitForExpression, stopChrome } from '../e13/lib/cdp-harness.mjs'

const ROOT = process.cwd()
const DIST = resolve(ROOT, 'dist/e14-benchmark')
const REPORT = resolve(ROOT, 'tests/fixtures/juyiting/occlusion-e14/benchmark-report.json')
const PORT = Number(process.env.E14_PORT) || 4179
const DEBUG_PORT = Number(process.env.E14_DEBUG_PORT) || 9344
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' }

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)))
  })
}

function startServer() {
  const network = { requestCount: 0, transferredBytes: 0, resources: [], source: 'chromium-http-responses' }
  const server = createServer(async (req, res) => {
    try {
      const raw = decodeURIComponent((req.url || '/').split('?')[0])
      const relative = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '')
      const file = resolve(DIST, relative)
      if (!(file === DIST || file.startsWith(DIST + sep))) throw new Error('invalid path')
      const body = await readFile(file)
      network.requestCount++
      network.transferredBytes += body.byteLength
      network.resources.push({ path: `/${relative}`, bytes: body.byteLength })
      res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'content-length': body.byteLength })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', () => resolvePromise({ server, network }))
  })
}

async function closeServer(server) {
  await new Promise(resolvePromise => server.close(resolvePromise))
}

await run(process.execPath, ['./node_modules/vite/bin/vite.js', 'build', '--config', 'scripts/juyiting/e14/vite.config.mjs'])
const { server, network } = await startServer()
let chrome
let cdp
let userDataDir
try {
  ;({ chrome, cdp, userDataDir } = await launchChrome({ windowSize: '1664,928', debugPort: DEBUG_PORT }))
  await cdp.send('Performance.enable')
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
  await waitForExpression(cdp, `globalThis.__E14_STATUS__ === 'running' || globalThis.__E14_STATUS__ === 'failed'`, 20_000)
  await waitForExpression(cdp, `globalThis.__E14_STATUS__ === 'complete' || globalThis.__E14_STATUS__ === 'failed'`, 85_000)
  const error = await evaluate(cdp, 'globalThis.__E14_ERROR__ || null')
  if (error) throw new Error(error)
  const report = await evaluate(cdp, 'globalThis.__E14_RESULT__')
  const perf = await cdp.send('Performance.getMetrics')
  const heap = await cdp.send('Runtime.getHeapUsage')
  const metrics = Object.fromEntries((perf.metrics || []).map(({ name, value }) => [name, value]))
  report.network = network
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
  await writeFile(REPORT, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ report: REPORT, pass: report.pass, timing: report.timing, gates: report.gates }, null, 2))
  if (!report.pass) process.exitCode = 1
} finally {
  if (cdp) cdp.close()
  if (chrome) await stopChrome(chrome, userDataDir)
  await closeServer(server)
  await delay(100)
}
