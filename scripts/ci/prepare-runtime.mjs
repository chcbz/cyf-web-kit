import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'

export const PINS = Object.freeze({
  node: {
    urls: ['https://nodejs.org/dist/v20.20.2/node-v20.20.2-linux-x64.tar.xz'],
    sha256: 'df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d',
  },
  chrome: {
    urls: [
      'https://storage.googleapis.com/chrome-for-testing-public/133.0.6943.141/linux64/chrome-headless-shell-linux64.zip',
      'https://registry.npmmirror.com/-/binary/chrome-for-testing/133.0.6943.141/linux64/chrome-headless-shell-linux64.zip',
    ],
    sha256: 'cec67d7e4baf84814a8602ea59aa07a669f31d95e63e935b5e7b39e5986895a2',
  },
  webp: {
    urls: ['https://mirrors.aliyun.com/alinux/3/updates/x86_64/Packages/libwebp-1.2.0-8.0.1.al8.x86_64.rpm'],
    sha256: '69e9610d0fe32f85653fbcdfa560a877a26544cdf8475fe4746d4a5cf6753145',
  },
})
export const WEBP_LIBRARY_SHA256 = 'cddced092a8452bb7df72743d7810d736b4043cf9b00f41a4fdf72e120f438a0'

export async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

// Cache only archives. Rehash on every use; never execute a cached extracted binary.
export async function downloadVerified(pin, destination, fetcher = fetch) {
  if (existsSync(destination)) {
    if (await hashFile(destination) !== pin.sha256) throw new Error(`cached SHA-256 mismatch: ${destination}`)
    return destination
  }
  await mkdir(dirname(destination), { recursive: true })
  const partial = `${destination}.${process.pid}.partial`
  const errors = []
  for (const url of pin.urls) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(240000) })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const hash = createHash('sha256')
      const digestStream = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk) } })
      await pipeline(Readable.fromWeb(response.body), digestStream, createWriteStream(partial, { flags: 'wx', mode: 0o600 }))
      const actual = hash.digest('hex')
      if (actual !== pin.sha256) {
        const error = new Error(`SHA-256 mismatch for ${url}: ${actual} != ${pin.sha256}`)
        error.integrityFailure = true
        throw error
      }
      await rename(partial, destination)
      return destination
    } catch (error) {
      await rm(partial, { force: true })
      // Mirror fallback is for availability only; an integrity failure stops here.
      if (error.integrityFailure) throw error
      errors.push(`${url}: ${error.message}`)
    }
  }
  throw new Error(`pinned download failed: ${errors.join('; ')}`)
}

export function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 300000, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (exit=${result.status}, signal=${result.signal})`)
  return typeof result.stdout === 'string' ? result.stdout.trim() : result.stdout
}

function installDependencies() {
  // Alinux3 Flow workers are root amd64 containers. RPM dependencies are verified
  // by the configured distribution's signing keys, never by unsigned downloads.
  if (process.getuid?.() !== 0) throw new Error('CI runtime preparation requires root for signed OS dependencies')
  const manager = ['/usr/bin/dnf', '/usr/bin/yum'].find(existsSync)
  if (!manager) throw new Error('CI runtime preparation requires the Alinux3 dnf/yum worker')
  runChecked(manager, ['-y', '--setopt=gpgcheck=1', 'install',
    'gcc', 'python3', 'git', 'tar', 'xz', 'rpm', 'rpm-build', 'cpio', 'ca-certificates',
    'nss', 'nspr', 'atk', 'at-spi2-atk', 'at-spi2-core', 'cups-libs', 'libdrm', 'libX11',
    'libXcomposite', 'libXdamage', 'libXext', 'libXfixes', 'libXrandr',
    'libxcb', 'libxkbcommon', 'mesa-libgbm', 'pango', 'cairo', 'alsa-lib',
    'fontconfig', 'liberation-fonts', 'gtk3', 'libcurl', 'dbus-libs', 'expat',
    'glib2', 'systemd-libs', 'vulkan-loader', 'wget', 'xdg-utils',
  ], { timeout: 600000 })
  runChecked('gcc', ['--version'])
  runChecked('python3', ['-c', 'import ctypes, hashlib, lzma, zipfile; print("Python runtime dependencies ready")'])
}

export function chromeWrapperSource(binary) {
  const quoted = `'${binary.replaceAll("'", "'\\''")}'`
  // exec is essential: E14 hashes /proc/<launcher-pid>/exe, which must be Chrome.
  return `#!/bin/sh\nexec ${quoted} --no-sandbox "$@"\n`
}

export async function extractApprovedWebp(rpm, destination, execute = runChecked) {
  const payload = execute('rpm2cpio', [rpm], { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 })
  const members = execute('cpio', ['--list', '--quiet'], { input: payload, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] })
    .split('\n').filter(name => name.replace(/^\.\//, '') === 'usr/lib64/libwebp.so.7.1.1')
  if (members.length !== 1) throw new Error('exact approved WebP member missing or duplicate')
  const library = execute('cpio', ['--extract', '--to-stdout', '--quiet', members[0]], {
    input: payload, stdio: ['pipe', 'pipe', 'inherit'], maxBuffer: 16 * 1024 * 1024,
  })
  if (createHash('sha256').update(library).digest('hex') !== WEBP_LIBRARY_SHA256) throw new Error('extracted WebP SHA-256 mismatch')
  await writeFile(destination, library)
}

export async function prepareRuntime({ repo, env, log = console.log }) {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('Pinned Chrome133/WebP1.2 CI gates require a Linux x64 worker')
  }
  installDependencies()
  const cache = join(homedir(), '.cache', 'cyf-test-runtime')
  await mkdir(cache, { recursive: true })
  const work = await mkdtemp(join(cache, 'run-'))
  const archives = {}
  for (const [name, pin] of Object.entries(PINS)) {
    log(`[cyf-ci] preparing ${name}: SHA256 ${pin.sha256}`)
    archives[name] = await downloadVerified(pin, join(cache, `${name}-${pin.sha256}`))
  }
  runChecked('tar', ['-xJf', archives.node, '-C', work])
  // zipfile does not retain executable bits; restore only the known entry point.
  runChecked('python3', ['-m', 'zipfile', '-e', archives.chrome, work])
  const binary = join(work, 'chrome-headless-shell-linux64', 'chrome-headless-shell')
  await chmod(binary, 0o755)
  const webp = join(work, 'libwebp.so.7.1.1')
  // rpmfile 2.2.1 requires Python >=3.10; use Alinux's signed native tools so
  // its system Python 3.6 can still run the existing renderer unchanged.
  await extractApprovedWebp(archives.webp, webp)
  if (await hashFile(webp) !== WEBP_LIBRARY_SHA256) throw new Error('extracted WebP SHA-256 mismatch')
  const node = join(work, 'node-v20.20.2-linux-x64', 'bin', 'node')
  const childEnv = { ...env, PATH: `${dirname(node)}:${env.PATH || '/usr/bin:/bin'}`, E13_WEBP_LIBRARY: webp }
  const version = runChecked(node, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: childEnv })
  if (version !== 'v20.20.2') throw new Error(`unexpected pinned Node version: ${version}`)
  const wrapper = join(work, 'chromium-headless-ci')
  await writeFile(wrapper, chromeWrapperSource(binary), { mode: 0o755 })
  const chromeVersion = runChecked(wrapper, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: childEnv })
  if (!/\b133\.0\.6943\.141\b/.test(chromeVersion)) throw new Error(`unexpected pinned Chrome version: ${chromeVersion}`)
  Object.assign(childEnv, { CHROME_PATH: wrapper, CHROMIUM_HEADLESS: wrapper, E14_REQUIRE_REPORT: '1', MOCHAWESOME_CONSOLEREPORTER: 'dot' })
  // Validate the approved library's ABI/version using the production decoder.
  runChecked('python3', ['-c', 'from offline_pixel_renderer.png_io import webp_decoder_provenance; print(webp_decoder_provenance())'], {
    cwd: repo, env: { ...childEnv, PYTHONPATH: join(repo, 'scripts/juyiting/e13') },
  })
  const shallow = runChecked('git', ['rev-parse', '--is-shallow-repository'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  if (shallow === 'true') runChecked('git', ['fetch', '--unshallow', '--tags', 'origin'], { cwd: repo })
  const remaining = runChecked('git', ['rev-parse', '--is-shallow-repository'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  if (remaining !== 'false') throw new Error('historical fixture tests require complete git history')
  const browser = { executablePath: binary, executableSha256: await hashFile(binary), launcherSha256: await hashFile(wrapper) }
  log(`[cyf-ci] ready: Node ${version}, ${chromeVersion}, Chrome SHA256 ${browser.executableSha256}`)
  return { node, env: childEnv, work, browser }
}
