import { expect } from 'chai'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { bootstrapEnabled, runTests, MOCHA_ARGS, REPORT, assertFreshBenchmark } from '../scripts/ci-test.mjs'
import { downloadVerified, chromeWrapperSource, extractApprovedWebp, PINS, SYSTEM_DEPENDENCIES, systemDependencyInstallPolicy, rpmPackageProbe, installDependencies, CHROME_LAUNCHER_PATH } from '../scripts/ci/prepare-runtime.mjs'

const root = process.cwd()
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const browser = { executablePath: '/ci/chrome-headless-shell', executableSha256: 'a'.repeat(64), launcherSha256: 'b'.repeat(64) }
const validReport = () => ({
  pass: true, gates: { p95AtMost2Ms: true, p99AtMost4Ms: true, noFullGridScan: true, sparseMembershipChecks: true, noSustainedGcThrash: true },
  timing: { warmupMs: 10000, sampleMs: 60000, total: { p95: 1, p99: 2 } },
  buildMode: 'production', environment: { chromiumGateEligible: true },
  browser: { ...browser, product: 'HeadlessChrome/133.0.6943.141' },
})

describe('repository npm test bootstrap', () => {
  let dir
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'cyf-ci-unit-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('installs the real Chrome launcher at the frozen E9B path rather than inventing historical provenance', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'tests/fixtures/juyiting/occlusion-v2-atlases/atlas-manifest.json'), 'utf8'))
    expect(CHROME_LAUNCHER_PATH).to.equal('/usr/local/bin/chromium-headless-smoke')
    expect(CHROME_LAUNCHER_PATH).to.equal(manifest.generator.chromium)
    const source = await readFile(join(root, 'scripts/ci/prepare-runtime.mjs'), 'utf8')
    expect(source).to.include('const wrapper = CHROME_LAUNCHER_PATH')
    expect(source).to.include('await writeFile(wrapper, chromeWrapperSource(binary), { mode: 0o755 })')
    expect(source).to.include("runChecked(wrapper, ['--version']")
    expect(source).to.include('CHROME_PATH: wrapper, CHROMIUM_HEADLESS: wrapper')
    expect(source).not.to.include('CHROMIUM_PROVENANCE:')
  })

  it('retains the signed full allowlist and 20-minute policy, while allowing a fixed missing subset only', () => {
    const policy = systemDependencyInstallPolicy('/root/.cache/cyf-test-runtime')
    expect(policy.cachedir).to.equal('/root/.cache/cyf-test-runtime/dnf')
    expect(policy.timeout).to.equal(20 * 60 * 1000)
    expect(policy.args).to.deep.equal([
      '-y', '--setopt=gpgcheck=1', '--setopt=install_weak_deps=False', '--setopt=cachedir=/root/.cache/cyf-test-runtime/dnf', 'install',
      'gcc', 'python3', 'git', 'tar', 'xz', 'rpm', 'cpio', 'ca-certificates',
      'nss', 'nspr', 'atk', 'at-spi2-atk', 'at-spi2-core', 'cups-libs', 'libdrm', 'libX11',
      'libXcomposite', 'libXdamage', 'libXext', 'libXfixes', 'libXrandr',
      'libxcb', 'libxkbcommon', 'mesa-libgbm', 'pango', 'cairo', 'alsa-lib',
      'fontconfig', 'liberation-fonts', 'gtk3', 'libcurl', 'dbus-libs', 'expat',
      'glib2', 'systemd-libs', 'vulkan-loader', 'wget', 'xdg-utils',
    ])
    expect(systemDependencyInstallPolicy('/cache', ['gcc', 'libX11']).args.slice(5)).to.deep.equal(['gcc', 'libX11'])
    expect(() => systemDependencyInstallPolicy('/cache', ['untrusted-package'])).to.throw('fixed allowlisted packages')
  })

  it('uses only a read-only RPM query and fails closed when the query is indeterminate', () => {
    const calls = []
    expect(rpmPackageProbe('gcc', (...args) => { calls.push(args); return { status: 0 } })).to.equal(true)
    expect(rpmPackageProbe('gcc', () => ({ status: 1 }))).to.equal(false)
    expect(calls).to.deep.equal([['/usr/bin/rpm', ['--quiet', '--query', 'gcc'], { stdio: 'ignore', timeout: 30000 }]])
    expect(() => rpmPackageProbe('gcc', () => ({ status: 2 }))).to.throw('RPM package query failed for gcc')
    expect(() => rpmPackageProbe('gcc', () => ({ error: new Error('rpm unavailable') }))).to.throw('rpm unavailable')
  })

  it('skips DNF/YUM when every allowlisted RPM is installed but retains runtime validations', async () => {
    const calls = []
    await installDependencies(join(dir, 'cache'), (command, args, options) => calls.push({ command, args, options }), {
      uid: 0, manager: null, packageProbe: () => true,
    })
    expect(calls).to.deep.equal([
      { command: '/bin/sh', args: ['-c', 'command -v rpm2cpio && command -v cpio'], options: undefined },
      { command: 'gcc', args: ['--version'], options: undefined },
      { command: 'python3', args: ['-c', 'import ctypes, hashlib, lzma, zipfile; print("Python runtime dependencies ready")'], options: undefined },
    ])
  })

  it('installs only missing allowlisted RPMs, including when none are installed', async () => {
    const cache = join(dir, 'cache with spaces')
    const partialCalls = []
    await installDependencies(cache, (command, args, options) => {
      if (command === '/usr/bin/dnf') expect(existsSync(join(cache, 'dnf'))).to.equal(true)
      partialCalls.push({ command, args, options })
    }, { uid: 0, manager: '/usr/bin/dnf', packageProbe: name => !['gcc', 'libX11'].includes(name) })
    expect(partialCalls[0]).to.deep.equal({
      command: '/usr/bin/dnf', args: systemDependencyInstallPolicy(cache, ['gcc', 'libX11']).args, options: { timeout: 1200000 },
    })
    const noneCalls = []
    await installDependencies(join(dir, 'none'), (command, args, options) => noneCalls.push({ command, args, options }), {
      uid: 0, manager: '/usr/bin/dnf', packageProbe: () => false,
    })
    expect(noneCalls[0].args).to.deep.equal(systemDependencyInstallPolicy(join(dir, 'none'), SYSTEM_DEPENDENCIES).args)
  })

  it('fails closed on RPM query failure and does not attempt installation or runtime validation', async () => {
    const calls = []
    const failure = new Error('rpm database unreadable')
    let error
    try {
      await installDependencies(join(dir, 'cache'), command => calls.push(command), {
        uid: 0, manager: '/usr/bin/dnf', packageProbe: () => { throw failure },
      })
    } catch (caught) { error = caught }
    expect(error).to.equal(failure)
    expect(calls).to.deep.equal([])
  })

  it('stops on signed installation failure before runtime validation', async () => {
    const calls = []
    const failure = new Error('unavailable: /usr/bin/dnf')
    let error
    try {
      await installDependencies(join(dir, 'cache'), command => {
        calls.push(command)
        if (command === '/usr/bin/dnf') throw failure
      }, { uid: 0, manager: '/usr/bin/dnf', packageProbe: () => false })
    } catch (caught) { error = caught }
    expect(error).to.equal(failure)
    expect(calls).to.deep.equal(['/usr/bin/dnf'])
  })

  it('enables only CI/Flow or explicit opt-in, including Node23 Flow without CI', () => {
    for (const env of [{ CI: 'true' }, { CI: '1' }, { PIPELINE_ID: '4403172' }, { CYF_CI_BOOTSTRAP: '1' }]) expect(bootstrapEnabled(env)).to.equal(true)
    for (const env of [{}, { CI: 'false' }, { CI: '0' }, { CYF_CI_BOOTSTRAP: '0' }, { PIPELINE_ID: '' }]) expect(bootstrapEnabled(env)).to.equal(false)
    expect(bootstrapEnabled({ PIPELINE_ID: '4403172', CYF_CI_BOOTSTRAP: '0' })).to.equal(true)
  })

  it('keeps local original Mocha config, all argument boundaries, environment and exit code', async () => {
    const env = { PATH: '/local/bin' }
    const args = ['--grep', 'two words; $(never-run)', '--bail']
    const calls = []
    const code = await runTests({ repo: dir, env, args, node: '/local/node', prepare: () => { throw new Error('local must not prepare') },
      execute: async (...call) => { calls.push(call); return 7 } })
    expect(code).to.equal(7)
    expect(calls).to.deep.equal([['/local/node', [...MOCHA_ARGS, ...args], { cwd: dir, env }]])
  })

  it('verifies downloads and cache bytes; refuses corruption before any consumer runs', async () => {
    const destination = join(dir, 'artifact')
    const pin = { urls: ['https://artifact.invalid/pinned'], sha256: digest('approved') }
    await downloadVerified(pin, destination, async () => new Response('approved'))
    expect(await readFile(destination, 'utf8')).to.equal('approved')
    await downloadVerified(pin, destination, async () => { throw new Error('verified cache needs no fetch') })
    await writeFile(destination, 'corrupted')
    let error
    try { await downloadVerified(pin, destination) } catch (caught) { error = caught }
    expect(error.message).to.include('cached SHA-256 mismatch')
  })

  it('uses same-pin availability fallback but never falls back after a digest mismatch', async () => {
    const pin = { urls: ['https://primary.invalid', 'https://mirror.invalid'], sha256: digest('approved') }
    const calls = []
    await downloadVerified(pin, join(dir, 'good'), async url => { calls.push(url); return new Response(url === pin.urls[0] ? '' : 'approved', { status: url === pin.urls[0] ? 503 : 200 }) })
    expect(calls).to.deep.equal(pin.urls)
    calls.length = 0
    let error
    try { await downloadVerified(pin, join(dir, 'bad'), async url => { calls.push(url); return new Response('wrong') }) } catch (caught) { error = caught }
    expect(error.message).to.include('SHA-256 mismatch')
    expect(calls).to.deep.equal([pin.urls[0]])
    expect(existsSync(join(dir, 'bad'))).to.equal(false)
  })

  it('does not start benchmark or Mocha on preparation/download failure', async () => {
    const calls = []
    let error
    try {
      await runTests({ repo: dir, env: { PIPELINE_ID: '4403172' }, execute: async (...call) => calls.push(call),
        prepare: () => downloadVerified({ urls: ['https://unavailable.invalid'], sha256: '0'.repeat(64) }, join(dir, 'download'), async () => new Response('', { status: 503 })) })
    } catch (caught) { error = caught }
    expect(error.message).to.include('pinned download failed')
    expect(calls).to.deep.equal([])
  })

  it('extracts only the exact RPM member and refuses missing/duplicate members or wrong final library SHA', async () => {
    for (const listing of ['usr/lib64/wrong.so', './usr/lib64/libwebp.so.7.1.1\nusr/lib64/libwebp.so.7.1.1', './usr/lib64/libwebp.so.7.1.1']) {
      const calls = []
      let error
      try {
        await extractApprovedWebp('/verified/archive.rpm', join(dir, 'library.so'), (command, args, options) => {
          calls.push({ command, args, options })
          if (command === 'rpm2cpio') return Buffer.from('cpio-stream')
          if (args[0] === '--list') return listing
          return Buffer.from('unapproved-library')
        })
      } catch (caught) { error = caught }
      expect(error).to.be.instanceOf(Error)
      expect(existsSync(join(dir, 'library.so'))).to.equal(false)
      if (listing === './usr/lib64/libwebp.so.7.1.1') {
        expect(error.message).to.include('extracted WebP SHA-256 mismatch')
        expect(calls[2].args).to.deep.equal(['--extract', '--to-stdout', '--quiet', './usr/lib64/libwebp.so.7.1.1'])
        expect(calls[2].options.input).to.deep.equal(Buffer.from('cpio-stream'))
      } else expect(calls).to.have.length(2)
    }
  })

  async function fixture() {
    await mkdir(join(dir, 'tests/fixtures/juyiting/occlusion-e14'), { recursive: true })
    await writeFile(join(dir, '.mocharc.json'), await readFile(join(root, '.mocharc.json')))
    await mkdir(join(dir, 'runtime'))
    return { node: '/pinned/node20', env: { CI: 'true', E14_REQUIRE_REPORT: '1', MOCHAWESOME_CONSOLEREPORTER: 'dot' }, work: join(dir, 'runtime'), browser }
  }

  it('backs up prior reports and logs full failed E14 evidence before stopping without Mocha', async () => {
    const runtime = await fixture()
    await writeFile(join(dir, REPORT), 'old ARM report')
    const calls = [], logs = []
    const report = validReport(); report.pass = false; report.timing.total.p95 = 4.2
    const code = await runTests({ repo: dir, env: { PIPELINE_ID: '4403172' }, prepare: async () => runtime, log: value => logs.push(value),
      execute: async (command, args, options) => {
        calls.push({ command, args, options })
        expect(existsSync(join(dir, REPORT))).to.equal(false)
        await writeFile(join(dir, REPORT), JSON.stringify(report)); return 1
      } })
    expect(code).to.equal(1)
    expect(calls).to.have.length(1)
    expect(calls[0].args).to.deep.equal(['scripts/juyiting/e14/run-benchmark-restricted.mjs'])
    expect(await readFile(join(runtime.work, 'previous-e14-report.json'), 'utf8')).to.equal('old ARM report')
    const encoded = logs.find(value => value.startsWith('CYF_E14_REPORT_BASE64=')).split('=')[1]
    expect(JSON.parse(Buffer.from(encoded, 'base64'))).to.deep.equal(report)
  })

  it('runs full original Mocha after fresh pinned E14 passes, retaining HTML/JSON and forwarded args', async () => {
    const runtime = await fixture()
    const calls = [], logs = []
    const code = await runTests({ repo: dir, env: { CI: '1' }, args: ['--bail'], prepare: async () => runtime, log: line => logs.push(line),
      execute: async (command, args, options) => {
        calls.push({ command, args, options })
        if (calls.length === 1) await writeFile(join(dir, REPORT), JSON.stringify(validReport()))
        else {
          await mkdir(join(dir, 'mochawesome-report'))
          for (const name of ['mochawesome.html', 'mochawesome.json']) await writeFile(join(dir, 'mochawesome-report', name), 'test output')
        }
        return 0
      } })
    expect(code).to.equal(0)
    expect(calls).to.have.length(2)
    expect(calls[1].command).to.equal(runtime.node)
    expect(calls[1].args.slice(0, MOCHA_ARGS.length)).to.deep.equal(MOCHA_ARGS)
    expect(calls[1].args.at(-1)).to.equal('--bail')
    expect(calls[1].args).to.include('reportDir=mochawesome-report,reportFilename=mochawesome.json,consoleReporter=dot')
    expect(logs).to.include('[cyf-ci] Mocha report written: mochawesome-report/mochawesome.html')
  })

  it('fails closed for missing fresh reports and false success or substituted browser provenance', async () => {
    const runtime = await fixture()
    const calls = []
    let error
    try { await runTests({ repo: dir, env: { CI: 'true' }, prepare: async () => runtime, log: () => {}, execute: async (...call) => { calls.push(call); return 0 } }) } catch (caught) { error = caught }
    expect(error).to.be.instanceOf(Error)
    expect(calls).to.have.length(1)
    for (const mutate of [r => { r.pass = false }, r => { r.timing.total.p95 = 2.01 }, r => { r.timing.total.p99 = 4.01 }, r => { r.timing.sampleMs = 1000 }, r => { r.browser.executableSha256 = '0'.repeat(64) }, r => { r.browser.product = 'HeadlessChrome/139.0.7258.154' }]) {
      const report = validReport(); mutate(report)
      expect(() => assertFreshBenchmark(report, browser)).to.throw()
    }
  })

  it('exec wrapper preserves exact arguments and points /proc at the real executable', async () => {
    const wrapper = join(dir, "wrapper ' spaces")
    // The stand-in consumes --no-sandbox and then execs Node so the parent can
    // verify PID identity as well as the kernel-resolved executable, without Chrome.
    const binary = join(dir, "binary ' spaces")
    const probe = join(dir, 'pid-probe.cjs')
    await writeFile(probe, "console.log(JSON.stringify({pid:process.pid,exe:require('fs').readlinkSync('/proc/self/exe'),args:process.argv.slice(2)}))\n")
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`
    await writeFile(binary, `#!/bin/sh\n[ "$1" = --no-sandbox ] || exit 23\nshift\nexec ${quote(process.execPath)} ${quote(probe)} "$@"\n`, { mode: 0o755 })
    await writeFile(wrapper, chromeWrapperSource(binary), { mode: 0o755 })
    const result = spawnSync(wrapper, ['two words', '$(literal)'], { encoding: 'utf8', timeout: 5000 })
    expect(result.status, result.stderr).to.equal(0)
    const output = JSON.parse(result.stdout)
    expect(output.pid).to.equal(result.pid)
    expect(output.exe).to.equal(process.execPath)
    expect(output.args).to.deep.equal(['two words', '$(literal)'])
    expect(PINS.chrome.urls).to.have.length(2)
  })

  it('installed mochawesome produces the exact Flow HTML and JSON filenames with dot console', async function () {
    this.timeout(15000)
    const file = join(dir, 'tiny.cjs')
    await writeFile(file, "describe('report artifact check', () => { it('tiny pass', () => {}) })\n")
    const config = JSON.parse(await readFile(join(root, '.mocharc.json'), 'utf8'))
    const options = config['reporter-options'].replace('reportDir=mochawesome-report', `reportDir=${dir}/reports`) + ',consoleReporter=dot'
    const configPath = join(dir, '.mocharc.json')
    const tinyConfig = { ...config, spec: [file], 'reporter-options': config['reporter-options'].replace('reportDir=mochawesome-report', `reportDir=${dir}/reports`) }
    delete tinyConfig.require
    await writeFile(configPath, JSON.stringify(tinyConfig))
    const result = spawnSync(process.execPath, [join(root, 'node_modules/mocha/bin/mocha.js'), '--config', configPath, '--reporter-options', options], {
      cwd: root, encoding: 'utf8', timeout: 12000, env: { ...process.env, MOCHAWESOME_CONSOLEREPORTER: 'dot' },
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).to.equal(0)
    expect(result.stdout).not.to.include('report artifact check')
    expect(existsSync(join(dir, 'reports/mochawesome.html'))).to.equal(true)
    const report = JSON.parse(await readFile(join(dir, 'reports/mochawesome.json'), 'utf8'))
    expect(report.stats.tests).to.equal(1)
    expect(report.stats.passes).to.equal(1)
  })
})
