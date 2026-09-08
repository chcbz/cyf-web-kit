#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { copyFile, readFile, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { prepareRuntime } from './ci/prepare-runtime.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MOCHA_ARGS = ['--import', 'tsx', './node_modules/mocha/bin/mocha.js', '--config', '.mocharc.json']
export const REPORT = 'tests/fixtures/juyiting/occlusion-e14/benchmark-report.json'

export function bootstrapEnabled(env) {
  return env.CYF_CI_BOOTSTRAP === '1' || Boolean(env.PIPELINE_ID?.trim()) || /^(1|true|yes)$/i.test(env.CI || '')
}

export function spawnCommand(command, args, { cwd, env }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    const forward = signal => child.kill(signal)
    const interrupt = () => forward('SIGINT')
    const terminate = () => forward('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate) }
    child.once('error', error => { cleanup(); reject(error) })
    child.once('exit', (code, signal) => { cleanup(); resolvePromise(code ?? (signal === 'SIGINT' ? 130 : 143)) })
  })
}

export function assertFreshBenchmark(report, browser) {
  if (report.pass !== true || !report.gates || Object.keys(report.gates).length !== 5 || !Object.values(report.gates).every(value => value === true)) {
    throw new Error('fresh E14 benchmark gates failed')
  }
  const timing = report.timing
  if (timing?.warmupMs !== 10000 || timing?.sampleMs !== 60000 ||
      !Number.isFinite(timing?.total?.p95) || timing.total.p95 > 2 ||
      !Number.isFinite(timing?.total?.p99) || timing.total.p99 > 4) throw new Error('E14 fixed sampling/threshold contract failed')
  if (report.environment?.chromiumGateEligible !== true || report.buildMode !== 'production' ||
      report.browser?.product !== 'HeadlessChrome/133.0.6943.141' ||
      report.browser?.executablePath !== browser.executablePath ||
      report.browser?.executableSha256 !== browser.executableSha256 ||
      report.browser?.launcherSha256 !== browser.launcherSha256) throw new Error('E14 pinned real-browser provenance mismatch')
}

export async function runTests({ args = [], env = process.env, repo = REPO, node = process.execPath,
  prepare = prepareRuntime, execute = spawnCommand, log = console.log } = {}) {
  if (!bootstrapEnabled(env)) return execute(node, [...MOCHA_ARGS, ...args], { cwd: repo, env })
  const runtime = await prepare({ repo, env, log })
  const reportPath = join(repo, REPORT)
  // A prior ARM/historical PASS or FAIL is never a substitute for this CI run.
  if (existsSync(reportPath)) {
    await copyFile(reportPath, join(runtime.work, 'previous-e14-report.json'))
    await unlink(reportPath)
  }
  let benchmarkCode
  try {
    benchmarkCode = await execute(runtime.node, ['scripts/juyiting/e14/run-benchmark-restricted.mjs'], { cwd: repo, env: runtime.env })
  } finally {
    if (existsSync(reportPath)) {
      log(`CYF_E14_REPORT_BASE64=${(await readFile(reportPath)).toString('base64')}`)
    } else log('[cyf-ci] E14 produced no fresh report')
  }
  if (benchmarkCode !== 0) return benchmarkCode
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assertFreshBenchmark(report, runtime.browser)
  log('[cyf-ci] E14 passed; starting full original Mocha configuration')
  const config = JSON.parse(await readFile(join(repo, '.mocharc.json'), 'utf8'))
  const reporterOptions = `${config['reporter-options']},consoleReporter=dot`
  for (const name of ['mochawesome.html', 'mochawesome.json']) {
    const path = join(repo, 'mochawesome-report', name)
    if (existsSync(path)) {
      await copyFile(path, join(runtime.work, `previous-${name}`))
      await unlink(path)
    }
  }
  const code = await execute(runtime.node, [...MOCHA_ARGS, '--reporter-options', reporterOptions, ...args], { cwd: repo, env: runtime.env })
  const missingReports = []
  for (const name of ['mochawesome.html', 'mochawesome.json']) {
    const path = join(repo, 'mochawesome-report', name)
    log(`[cyf-ci] Mocha report ${existsSync(path) ? 'written' : 'missing'}: mochawesome-report/${name}`)
    if (!existsSync(path)) missingReports.push(name)
  }
  if (code === 0 && missingReports.length) throw new Error(`Mocha report artifacts missing: ${missingReports.join(', ')}`)
  return code
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTests({ args: process.argv.slice(2) }).then(code => { process.exitCode = code }).catch(error => {
    console.error(`[cyf-ci] FAIL: ${error.message}`)
    process.exitCode = 1
  })
}
