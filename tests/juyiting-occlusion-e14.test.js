import { expect } from 'chai'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

const reportPath = 'tests/fixtures/juyiting/occlusion-e14/benchmark-report.json'
const strict = process.env.E14_REQUIRE_REPORT === '1'
const hasReport = existsSync(reportPath)

if (strict && !hasReport) {
  throw new Error(`E14 formal Chromium report is missing: ${reportPath}. Run npm run benchmark:juyiting-occlusion-e14 first.`)
}

const suite = hasReport ? describe : describe.skip
const report = hasReport ? JSON.parse(readFileSync(reportPath, 'utf8')) : null

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function currentBenchmarkInputs() {
  const inputs = [
    'scripts/juyiting/e14/benchmark-entry.ts',
    'scripts/juyiting/e14/run-benchmark-restricted.mjs',
    'scripts/juyiting/e14/shutdown-eperm-compat.c',
    'scripts/juyiting/e14/vite.config.mjs',
    'tests/juyiting-occlusion-e14.test.js',
    ...readdirSync('src/game/occlusion')
      .filter(name => name.endsWith('.ts'))
      .map(name => `src/game/occlusion/${name}`),
  ].sort()
  return Object.fromEntries(inputs.map(path => [path, sha256(path)]))
}

suite('Juyiting occlusion E14 fixed Chromium benchmark', () => {
  it('uses a gate-eligible real Chromium production run', () => {
    expect(report.buildMode).to.equal('production')
    expect(report.environment.chromiumGateEligible).to.equal(true)
    expect(report.environment.userAgent).to.match(/HeadlessChrome\/\d+/)
    expect(report.environment.executionEngine).to.match(/^chromium-/)
    expect(report.environment.executionEngine).not.to.match(/node|jsdom/i)
  })

  it('is fresh for the current benchmark and occlusion implementation sources', () => {
    expect(report.provenance.generatedAt).to.be.a('string')
    expect(report.provenance.inputs).to.deep.equal(currentBenchmarkInputs())
    expect(report.browser.product).to.match(/^HeadlessChrome\/\d+/)
    expect(report.browser.protocolVersion).to.be.a('string')
    expect(report.browser.jsVersion).to.be.a('string')
    expect(report.browser.launcherSha256).to.match(/^[0-9a-f]{64}$/)
    expect(report.browser.executableSha256).to.match(/^[0-9a-f]{64}$/)
    expect(report.browser.executablePath).to.match(/headless_shell$/)
  })

  it('uses the fixed production benchmark dimensions', () => {
    expect(report.buildMode).to.equal('production')
    expect(report.fixture).to.deep.include({ mapWidth: 1664, mapHeight: 928, agents: 108, fragments: 50, zones: 37, cellSize: 256 })
    expect(report.timing.warmupMs).to.equal(10000)
    expect(report.timing.sampleMs).to.equal(60000)
    expect(report.environment.runtimeViewport).to.deep.equal({
      innerWidth: 1664,
      innerHeight: 928,
      devicePixelRatio: 1,
    })
  })

  it('passes p95 and p99 ordering + spatial-index gates', () => {
    expect(report.timing.total.p95).to.be.at.most(2)
    expect(report.timing.total.p99).to.be.at.most(4)
  })

  it('proves sparse zone discovery and zero full-grid update scans', () => {
    expect(report.complexity.spatialGridDelta.scanCount).to.equal(0)
    expect(report.complexity.membershipChecksPerFrameMean).to.be.below(report.complexity.theoreticalAgentsTimesAllZonesPerFrame * 0.5)
    expect(report.complexity.maxChecksPerAgent).to.be.below(report.fixture.zones)
  })

  it('records network, heap, rendering and long-task baselines without inventing unavailable GPU metrics', () => {
    expect(report.network.source).to.equal('chromium-cdp-network-events')
    expect(report.network.requestCount).to.be.greaterThan(0)
    expect(report.network.transferredBytes).to.be.at.least(0)
    expect(report.network.resources.some(resource => resource.url?.endsWith('/index.html'))).to.equal(true)
    expect(report.network.resources.some(resource => resource.url?.includes('/assets/index-'))).to.equal(true)
    expect(report.artifactInventory.source).to.equal('production-build-artifact-inventory')
    expect(report.artifactInventory.transferredBytes).to.be.greaterThan(0)
    expect(report.cdp.jsHeapUsedBytes).to.be.a('number')
    expect(report.rendering.drawCallsBaseline).to.equal(0)
    expect(report.rendering.drawCallsSample).to.equal(0)
    expect(report.rendering.textureMemoryBytes).to.equal(null)
    expect(report.rendering.textureMemoryStatus).to.match(/unavailable/)
    expect(report.memory.heapDropsOver1Mb).to.be.a('number')
    expect(report.memory.browserHeapSamples.length).to.be.at.least(50)
    expect(report.memory.browserHeapSamples.every(sample => Number.isFinite(sample.usedBytes))).to.equal(true)
    expect(new Set(report.memory.browserHeapSamples.map(sample => sample.usedBytes)).size).to.be.greaterThan(1)
  })

  it('passes every declared machine gate', () => {
    expect(report.pass).to.equal(true)
    expect(Object.values(report.gates).every(Boolean)).to.equal(true)
  })
})
