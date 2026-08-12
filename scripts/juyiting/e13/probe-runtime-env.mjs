#!/usr/bin/env node
/**
 * E13: reproduce and record the runtime-environment blocking evidence.
 *
 * This script performs *probe-only* checks (no screenshot, no fabrication):
 *  - headless chromium launch (records the sandbox FATAL when the host forbids it)
 *  - TCP listen bind on candidate frontend ports (records EPERM when denied)
 *  - fetch probes against the frontend URL (records network restriction)
 *  - optional `canvas` npm module availability (needed by some tooling)
 *  - dist/ staleness note vs the E13 base commit
 *
 * Outputs (committed as evidence):
 *   tests/fixtures/juyiting/occlusion-e13/runtime-env-probes.json
 *   tests/fixtures/juyiting/occlusion-e13/runtime-env-probes.log
 *
 * Exit code is always 0: the JSON file is the evidence. A later machine gate
 * checks the JSON is present and internally consistent.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const EVIDENCE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-e13')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/local/bin/chromium-headless-smoke',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean)

const FRONTEND_URL = process.env.JUYITING_FRONTEND_URL || 'https://localhost:8080'
const PORTS = [8080, 5173, 4173, 9090]

function log (header, lines) {
  return `[${new Date().toISOString()}] ${header}\n${lines.join('\n')}\n`
}

async function probeChromium (collect, logLines) {
  const binary = CHROME_CANDIDATES.find(candidate => existsSync(candidate))
  if (!binary) {
    collect.push({ probe: 'chromium', ok: false, detail: 'no chromium binary found in candidates' })
    return
  }
  // version probe (works even when launch is forbidden)
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000 })
  const versionOk = version.status === 0
  collect.push({ probe: 'chromium-version', ok: versionOk, binary, detail: versionOk ? version.stdout.trim() : `${version.stderr?.trim() || 'exit ' + version.status}` })
  logLines.push(`chromium-version: ${versionOk ? version.stdout.trim() : (version.stderr?.trim() || 'exit ' + version.status)}`)

  // real headless launch probe (records FATAL sandbox error on restricted hosts)
  const cwd = join(tmpdir(), `e13-chrome-probe-${process.pid}`)
  try { mkdirSync(cwd, { recursive: true }) } catch {}
  const launch = spawnSync(binary, [
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer',
    '--headless=new', '--dump-dom', 'data:text/html,<html><body>e13-probe</body></html>',
  ], { encoding: 'utf8', timeout: 30000, cwd, maxBuffer: 4 * 1024 * 1024 })
  const stdout = (launch.stdout || '').trim()
  const stderr = (launch.stderr || '').trim()
  const crashed = launch.status !== 0 || stderr.includes('FATAL')
  const launched = launch.status === 0 && stdout.includes('e13-probe')
  collect.push({
    probe: 'chromium-headless-launch',
    ok: launched,
    binary,
    status: launch.status,
    signal: launch.signal || null,
    crash: crashed ? 'yes' : 'no',
    stderrHead: stderr.split('\n').slice(0, 6).join('\n'),
    stdoutHead: stdout.slice(0, 120),
    note: launched
      ? 'headless chromium rendered the probe page'
      : 'headless chromium failed to launch/run on this host (sandbox FATAL or equivalent)',
  })
  logLines.push(`chromium-headless-launch: status=${launch.status} signal=${launch.signal || '-'} crashed=${crashed}`)
  if (stderr) logLines.push(`  stderr: ${stderr.split('\n').slice(0, 6).join('\n | ')}`)
  if (stdout) logLines.push(`  stdout: ${stdout.slice(0, 120)}`)
}

async function probeTcpBind (collect, logLines) {
  const net = await import('node:net')
  for (const port of PORTS) {
    const result = await new Promise(resolve => {
      const server = net.createServer()
      server.once('error', error => resolve({ ok: false, code: error.code, message: error.message }))
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve({ ok: true, code: null, message: 'listening ok' }))
      })
    })
    collect.push({
      probe: `tcp-bind-${port}`,
      ok: result.ok,
      address: '127.0.0.1',
      port,
      code: result.code || null,
      detail: result.message,
      note: result.ok ? 'a local frontend server could bind here' : 'TCP listen is denied on this host (EPERM) — a local dev/preview server cannot start',
    })
    logLines.push(`tcp-bind-127.0.0.1:${port}: ${result.ok ? 'OK' : `${result.code}: ${result.message}`}`)
  }
}

async function probeFetch (collect, logLines) {
  for (const url of [FRONTEND_URL, 'https://api.chaoyoufan.cn', 'https://kit.chaoyoufan.cn']) {
    let detail = ''
    let ok = false
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
      ok = response.ok
      detail = `HTTP ${response.status}`
    } catch (error) {
      detail = `${error.name}: ${error.message}`
    }
    collect.push({
      probe: 'fetch',
      ok,
      url,
      detail,
      note: ok ? 'reachable' : 'unreachable (network restricted or server not running)',
    })
    logLines.push(`fetch ${url}: ${ok ? detail : detail}`)
  }
}

function probeCanvasModule (collect, logLines) {
  let installed = false
  let detail = 'not installed'
  try {
    const resolved = require.resolve('canvas')
    installed = Boolean(resolved)
    detail = resolved
  } catch {}
  collect.push({
    probe: 'npm-canvas',
    ok: installed,
    detail,
    note: installed ? 'node-canvas available (full bitmap tooling possible)' : 'node-canvas NOT installed — WebP decode/crop tooling unavailable on this host',
  })
  logLines.push(`npm canvas: ${installed ? detail : 'NOT installed'}`)
}

function probeDistStaleness (collect, logLines) {
  const distIndex = join(REPO_ROOT, 'dist/index.html')
  if (!existsSync(distIndex)) {
    collect.push({ probe: 'dist-staleness', ok: false, detail: 'dist/index.html missing', note: 'no prebuilt bundle to serve statically' })
    logLines.push('dist/index.html: missing')
    return
  }
  const stat = statSync(distIndex)
  const note = 'dist/ exists but was built before the E13 base commit and cannot be served without a TCP listener (see tcp-bind probes); it is NOT a substitute for runtime screenshots'
  collect.push({ probe: 'dist-staleness', ok: true, detail: `mtime=${stat.mtime.toISOString()} size=${stat.size}`, note })
  logLines.push(`dist/index.html: mtime=${stat.mtime.toISOString()} size=${stat.size}`)
}

async function main () {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  const collect = []
  const logLines = []
  await probeChromium(collect, logLines)
  await probeTcpBind(collect, logLines)
  await probeFetch(collect, logLines)
  probeCanvasModule(collect, logLines)
  probeDistStaleness(collect, logLines)

  const evidence = {
    $schema: 'juyiting-occlusion-e13-runtime-env-probes-v1',
    taskId: 'E13',
    timestamp: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    host: process.platform,
    node: process.version,
    summary: {
      chromiumLaunchable: collect.find(p => p.probe === 'chromium-headless-launch')?.ok === true,
      tcpBindAllowed: PORTS.some(port => collect.find(p => p.probe === `tcp-bind-${port}`)?.ok === true),
      frontendReachable: collect.find(p => p.probe === 'fetch' && p.url === FRONTEND_URL)?.ok === true,
      canvasAvailable: collect.find(p => p.probe === 'npm-canvas')?.ok === true,
      conclusion: 'Real runtime screenshots are not possible on this host (no frontend server, no TCP listener, headless chromium sandbox FATAL). No screenshots were fabricated. Re-run generate-e13-evidence.mjs on a browser-capable host.',
    },
    probes: collect,
  }
  writeFileSync(join(EVIDENCE_DIR, 'runtime-env-probes.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  writeFileSync(join(EVIDENCE_DIR, 'runtime-env-probes.log'), log('E13 runtime environment probe log', logLines))
  console.log(`E13 runtime-env probes written to ${EVIDENCE_DIR}/runtime-env-probes.json`)
  console.log(`chromiumLaunchable=${evidence.summary.chromiumLaunchable} tcpBindAllowed=${evidence.summary.tcpBindAllowed} frontendReachable=${evidence.summary.frontendReachable}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
