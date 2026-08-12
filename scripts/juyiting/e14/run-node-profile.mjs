import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { JSDOM } from 'jsdom'

const ROOT = process.cwd()
const DIST = resolve(ROOT, 'dist/e14-benchmark')
const REPORT = resolve(ROOT, 'tests/fixtures/juyiting/occlusion-e14/node-profile-report.json')

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)))
  })
}

async function inventoryBuild(dir) {
  const resources = []
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else resources.push({ path: relative(dir, path), bytes: (await stat(path)).size })
    }
  }
  await walk(dir)
  return { requestCount: resources.length, transferredBytes: resources.reduce((sum, item) => sum + item.bytes, 0), resources, source: 'production-build-artifact-inventory' }
}

await run(process.execPath, ['./node_modules/vite/bin/vite.js', 'build', '--config', 'scripts/juyiting/e14/vite.config.mjs'])
const html = await readFile(resolve(DIST, 'index.html'), 'utf8')
const scriptPath = html.match(/<script[^>]+src="([^"]+)"/)?.[1]
if (!scriptPath) throw new Error('E14 production bundle script was not found')
const dom = new JSDOM('<!doctype html><main id="status"></main>', { url: 'https://e14.local/' })
globalThis.document = dom.window.document
globalThis.window = dom.window
globalThis.navigator = dom.window.navigator
globalThis.MutationObserver = dom.window.MutationObserver
globalThis.Node = dom.window.Node
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16)
globalThis.cancelAnimationFrame = clearTimeout
const beforeHeap = process.memoryUsage()
await import(`${pathToFileURL(resolve(DIST, scriptPath.replace(/^\.\//, ''))).href}?run=${Date.now()}`)
const deadline = Date.now() + 90_000
while (globalThis.__E14_STATUS__ !== 'complete' && globalThis.__E14_STATUS__ !== 'failed' && Date.now() < deadline) await delay(250)
if (globalThis.__E14_STATUS__ !== 'complete') throw new Error(globalThis.__E14_ERROR__ || `E14 node profile timed out: ${globalThis.__E14_STATUS__}`)
const report = structuredClone(globalThis.__E14_RESULT__)
report.environment.executionEngine = 'node-v8-jsdom-fallback'
report.environment.chromiumGateEligible = false
report.network = await inventoryBuild(DIST)
report.node = { beforeHeap, afterHeap: process.memoryUsage(), versions: process.versions }
report.provisionalGates = {
  p95AtMost2Ms: report.timing.total.p95 <= 2,
  p99AtMost4Ms: report.timing.total.p99 <= 4,
  noFullGridScan: report.complexity.spatialGridDelta.scanCount === 0,
  sparseMembershipChecks: report.complexity.membershipChecksPerFrameMean < report.complexity.theoreticalAgentsTimesAllZonesPerFrame * 0.5,
}
report.provisionalPass = Object.values(report.provisionalGates).every(Boolean)
report.pass = false
report.passReason = 'Node/V8 profile is diagnostic only; fixed E14 requires Chromium.'
await mkdir(resolve(REPORT, '..'), { recursive: true })
await writeFile(REPORT, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ report: REPORT, provisionalPass: report.provisionalPass, timing: report.timing, provisionalGates: report.provisionalGates }, null, 2))
if (!report.provisionalPass) process.exitCode = 1
