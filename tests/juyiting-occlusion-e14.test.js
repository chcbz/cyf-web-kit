import { expect } from 'chai'
import { existsSync, readFileSync } from 'node:fs'

const reportPath = 'tests/fixtures/juyiting/occlusion-e14/benchmark-report.json'
const strict = process.env.E14_REQUIRE_REPORT === '1'
const hasReport = existsSync(reportPath)

if (strict && !hasReport) {
  throw new Error(`E14 formal Chromium report is missing: ${reportPath}. Run npm run benchmark:juyiting-occlusion-e14 first.`)
}

const suite = hasReport ? describe : describe.skip
const report = hasReport ? JSON.parse(readFileSync(reportPath, 'utf8')) : null

suite('Juyiting occlusion E14 fixed Chromium benchmark', () => {
  it('uses the fixed production benchmark dimensions', () => {
    expect(report.buildMode).to.equal('production')
    expect(report.fixture).to.deep.include({ mapWidth: 1664, mapHeight: 928, agents: 108, fragments: 50, zones: 37, cellSize: 256 })
    expect(report.timing.warmupMs).to.equal(10000)
    expect(report.timing.sampleMs).to.equal(60000)
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
    expect(report.network.requestCount).to.be.greaterThan(0)
    expect(report.network.transferredBytes).to.be.greaterThan(0)
    expect(report.cdp.jsHeapUsedBytes).to.be.a('number')
    expect(report.rendering.drawCallsBaseline).to.equal(0)
    expect(report.rendering.drawCallsSample).to.equal(0)
    expect(report.rendering.textureMemoryBytes).to.equal(null)
    expect(report.rendering.textureMemoryStatus).to.match(/unavailable/)
    expect(report.memory.heapDropsOver1Mb).to.be.a('number')
  })

  it('passes every declared machine gate', () => {
    expect(report.pass).to.equal(true)
    expect(Object.values(report.gates).every(Boolean)).to.equal(true)
  })
})
