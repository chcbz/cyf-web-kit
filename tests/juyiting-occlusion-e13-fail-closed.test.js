import { expect } from 'chai'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSyncCaptured } from '../scripts/juyiting/lib/spawn-capture.mjs'

const ROOT = process.cwd()
const FIXTURE = join(ROOT, 'tests/fixtures/juyiting/occlusion-e13')
const GATE_SCRIPT = join(ROOT, 'scripts/juyiting/e13/validate-e13-evidence.mjs')
const LIVE_PY_CHECK = 'live Python offline validator re-derives all 270 pixel metrics from production assets and committed PNGs (exit 0 required)'
const PNG_SHA_CHECK = '270/270 screenshotFile PNG bytes match committed sha256'

const readJson = p => JSON.parse(readFileSync(p, 'utf8'))
const writeJson = (p, value) => writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`)

function symlinkDir (target, path) { symlinkSync(target, path, 'dir') }

function makeShotsDir (dir, mutateShot) {
  const srcDir = join(FIXTURE, 'shots')
  const dstDir = join(dir, 'shots')
  mkdirSync(dstDir)
  for (const name of readdirSync(srcDir).filter(f => f.endsWith('.png'))) {
    const src = join(srcDir, name)
    const dst = join(dstDir, name)
    if (mutateShot && mutateShot.name === name) {
      const bytes = readFileSync(src)
      const offset = mutateShot.offset ?? 0
      bytes[offset] = bytes[offset] === 0 ? 1 : 0
      writeFileSync(dst, bytes)
    } else {
      symlinkSync(src, dst, 'file')
    }
  }
}

function gateEvidence (mutateIndex, mutatePlan, mutateReport, mutateShot) {
  const dir = mkdtempSync(join(tmpdir(), 'cyf-e13-fail-closed-gate-'))
  for (const name of ['index.json', 'shot-plan.json', 'world-model.json', 'oracle-report.json', 'visual-review-v5.json', 'visual-review-v6.json', 'pixel-recompute-report.json']) {
    copyFileSync(join(FIXTURE, name), join(dir, name))
  }
  if (mutateShot) makeShotsDir(dir, mutateShot)
  else symlinkDir(join(FIXTURE, 'shots'), join(dir, 'shots'))
  symlinkDir(join(FIXTURE, 'contact-sheets'), join(dir, 'contact-sheets'))
  symlinkDir(join(FIXTURE, 'live'), join(dir, 'live'))
  if (mutateIndex) { const index = readJson(join(dir, 'index.json')); mutateIndex(index); writeJson(join(dir, 'index.json'), index) }
  if (mutatePlan) { const plan = readJson(join(dir, 'shot-plan.json')); mutatePlan(plan); writeJson(join(dir, 'shot-plan.json'), plan) }
  if (mutateReport) { const report = readJson(join(dir, 'pixel-recompute-report.json')); mutateReport(report, join(dir, 'index.json')); writeJson(join(dir, 'pixel-recompute-report.json'), report) }
  return dir
}

function pyEvidence (mutateIndex, mutateShot) {
  const dir = mkdtempSync(join(tmpdir(), 'cyf-e13-fail-closed-py-'))
  copyFileSync(join(FIXTURE, 'index.json'), join(dir, 'index.json'))
  if (mutateShot) makeShotsDir(dir, mutateShot)
  else symlinkDir(join(FIXTURE, 'shots'), join(dir, 'shots'))
  symlinkDir(join(FIXTURE, 'contact-sheets'), join(dir, 'contact-sheets'))
  if (mutateIndex) { const index = readJson(join(dir, 'index.json')); mutateIndex(index); writeJson(join(dir, 'index.json'), index) }
  return dir
}

function runGate (dir, shotPlan = join(dir, 'shot-plan.json')) {
  return spawnSyncCaptured(process.execPath, ['--import', 'tsx', GATE_SCRIPT, '--evidence-dir', dir, '--shot-plan', shotPlan], {
    cwd: ROOT, encoding: 'utf8', timeout: 180000,
  })
}

function runPyValidator (dir, options = {}) {
  const args = ['-m', 'offline_pixel_renderer.validate', '--repo-root', ROOT, '--evidence-dir', dir]
  if (options.writeReport) args.push('--write-recompute-report')
  return spawnSyncCaptured('python3', args, {
    cwd: ROOT, encoding: 'utf8', timeout: 240000,
    env: { ...process.env, PYTHONPATH: join(ROOT, 'scripts/juyiting/e13') },
  })
}

const NAV_CHECK = 'every matrix probe navValidation is independently re-derived from the production TMX parser + graph pathfinder'
const PIXEL_CHECK = '270/270 committed pixelOverlap cross-check the independent pixel recompute report'

describe('E13 fail-closed independent recompute (P2-B)', () => {
  it('committed evidence passes the independent nav re-derivation and pixel cross-check gate', function () {
    this.timeout(180000)
    const dir = gateEvidence()
    try {
      const result = runGate(dir)
      expect(result.status, result.stderr).to.equal(0)
      const gate = readJson(join(dir, 'machines-gate.json'))
      expect(gate.checks.find(c => c.check === NAV_CHECK)?.ok).to.equal(true)
      expect(gate.checks.find(c => c.check === PIXEL_CHECK)?.ok).to.equal(true)
      expect(gate.checks.find(c => c.check === LIVE_PY_CHECK)?.ok).to.equal(true)
      expect(gate.evidencePass).to.equal(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects a navValidation.insideNavArea tamper even when index and plan agree', function () {
    this.timeout(180000)
    const mutate = (doc) => {
      const shot = doc.shots.find(s => s.probeKind === 'target-specific')
      shot.navValidation.insideNavArea = !shot.navValidation.insideNavArea
    }
    const dir = gateEvidence(mutate, mutate)
    try {
      const result = runGate(dir)
      expect(result.status, result.stderr).to.not.equal(0)
      const gate = readJson(join(dir, 'machines-gate.json'))
      const failing = gate.failures.find(f => f.check === NAV_CHECK)
      expect(failing, 'missing independent nav re-derivation failure').to.exist
      expect(failing.detail).to.include('E13-')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects a navValidation.reachability.referenceStart tamper even when index and plan agree', function () {
    this.timeout(180000)
    const mutate = (doc) => {
      const shot = doc.shots.find(s => s.probeKind === 'target-specific')
      shot.navValidation.reachability.referenceStart.x += 1
    }
    const dir = gateEvidence(mutate, mutate)
    try {
      const result = runGate(dir)
      expect(result.status, result.stderr).to.not.equal(0)
      const gate = readJson(join(dir, 'machines-gate.json'))
      const failing = gate.failures.find(f => f.check === NAV_CHECK)
      expect(failing, 'missing independent nav re-derivation failure').to.exist
      expect(failing.detail).to.include('E13-')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('Python validator rejects a tampered pixelOverlap.opaqueIntersectionPixels via independent recompute', function () {
    this.timeout(240000)
    const mutate = (index) => { index.shots[0].runtimeFacts.pixelOverlap.opaqueIntersectionPixels += 1 }
    const dir = pyEvidence(mutate)
    try {
      const result = runPyValidator(dir, { writeReport: true })
      expect(result.status, result.stderr).to.not.equal(0)
      const report = readJson(join(dir, 'pixel-recompute-report.json'))
      expect(report.pass).to.equal(false)
      expect(report.drift.some(d => d.includes('opaqueIntersectionPixels'))).to.equal(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('gate rejects a tampered pixelOverlap.visibleOcclusionPixels against the independent recompute report', function () {
    this.timeout(180000)
    const mutate = (index) => { index.shots[0].runtimeFacts.pixelOverlap.visibleOcclusionPixels += 1 }
    const dir = gateEvidence(mutate)
    try {
      const result = runGate(dir)
      expect(result.status, result.stderr).to.not.equal(0)
      const gate = readJson(join(dir, 'machines-gate.json'))
      const failing = gate.failures.find(f => f.check === PIXEL_CHECK)
      expect(failing, 'missing independent pixel cross-check failure').to.exist
      expect(failing.detail).to.include('visibleOcclusionPixels')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects simultaneous index pixelOverlap + pixel-recompute-report tampering via live Python recompute', function () {
    this.timeout(240000)
    const mutateIndex = (index) => { index.shots[0].runtimeFacts.pixelOverlap.opaqueIntersectionPixels += 1 }
    const mutateReport = (report, indexPath) => { report.recomputed['E13-001'].opaqueIntersectionPixels += 1; report.indexSha256 = createHash('sha256').update(readFileSync(indexPath)).digest('hex'); report.pass = true; report.drift = [] }
    const dir = gateEvidence(mutateIndex, null, mutateReport)
    try {
      const result = runGate(dir)
      expect(result.status, result.stderr).to.not.equal(0)
      const gate = readJson(join(dir, 'machines-gate.json'))
      const failing = gate.failures.find(f => f.check === LIVE_PY_CHECK)
      expect(failing, 'missing live Python recompute failure').to.exist
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('Python validator rejects a tampered PNG byte via committed sha256 drift', function () {
    this.timeout(240000)
    const dir = pyEvidence(null, { name: 'E13-001.png', offset: 0 })
    try {
      const result = runPyValidator(dir)
      expect(result.status, result.stderr).to.not.equal(0)
      expect(result.stdout, result.stderr).to.include(PNG_SHA_CHECK)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('gate rejects a tampered PNG byte via live Python recompute', function () {
    this.timeout(240000)
    const dir = gateEvidence(null, null, null, { name: 'E13-001.png', offset: 0 })
    try {
      const result = runGate(dir)
      expect(result.status, result.stderr).to.not.equal(0)
      const gate = readJson(join(dir, 'machines-gate.json'))
      const failing = gate.failures.find(f => f.check === LIVE_PY_CHECK)
      expect(failing, 'missing live Python recompute failure').to.exist
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
