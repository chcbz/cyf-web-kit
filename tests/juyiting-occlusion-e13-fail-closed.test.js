import { expect } from 'chai'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSyncCaptured } from '../scripts/juyiting/lib/spawn-capture.mjs'
import { validateReviewedEvidenceBindings } from '../scripts/juyiting/e13/lib/review-bindings.mjs'

const ROOT = process.cwd()
const FIXTURE = join(ROOT, 'tests/fixtures/juyiting/occlusion-e13')
const GATE_SCRIPT = join(ROOT, 'scripts/juyiting/e13/validate-e13-evidence.mjs')
const LIVE_GATE_SCRIPT = join(ROOT, 'scripts/juyiting/e13/validate-e13-live-evidence.mjs')
const GENERATOR_SCRIPT = join(ROOT, 'scripts/juyiting/e13/generate-e13-offline-evidence.mjs')
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
  cpSync(join(FIXTURE, 'mask-structure-mapping'), join(dir, 'mask-structure-mapping'), { recursive: true })
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
  return spawnSyncCaptured(process.execPath, ['--import', 'tsx', GATE_SCRIPT, '--evidence-dir', dir, '--shot-plan', shotPlan, '--reviewed-evidence-dir', dir], {
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


function reviewedBindingFixture () {
  const dir = mkdtempSync(join(tmpdir(), 'cyf-e13-reviewed-bindings-'))
  for (const name of ['index.json', 'shot-plan.json', 'visual-review-v6.json']) copyFileSync(join(FIXTURE, name), join(dir, name))
  cpSync(join(FIXTURE, 'contact-sheets'), join(dir, 'contact-sheets'), { recursive: true })
  cpSync(join(FIXTURE, 'mask-structure-mapping'), join(dir, 'mask-structure-mapping'), { recursive: true })
  return dir
}

function failedReviewChecks (dir) {
  return validateReviewedEvidenceBindings({ repo: ROOT, evidenceDir: dir, reviewedEvidenceDir: dir }).filter(result => !result.ok)
}

function hardlinkTreeFiles (src, dst) {
  mkdirSync(dst, { recursive: true })
  for (const name of readdirSync(src)) linkSync(join(src, name), join(dst, name))
}

function liveEvidenceFixture (mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'cyf-e13-live-paths-'))
  copyFileSync(join(FIXTURE, 'live/index.json'), join(dir, 'index.json'))
  hardlinkTreeFiles(join(FIXTURE, 'live/shots'), join(dir, 'shots'))
  hardlinkTreeFiles(join(FIXTURE, 'live/movement-sequences'), join(dir, 'movement-sequences'))
  hardlinkTreeFiles(join(FIXTURE, 'live/contact-sheets'), join(dir, 'contact-sheets'))
  const index = readJson(join(dir, 'index.json'))
  mutate?.(dir, index)
  writeJson(join(dir, 'index.json'), index)
  return dir
}

function runLiveGate (dir) {
  return spawnSyncCaptured(process.execPath, [LIVE_GATE_SCRIPT, '--live-dir', dir], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000,
  })
}

describe('E13 V6 reviewed-artifact bindings fail closed (P2-1)', () => {
  it('accepts the committed exact 15-sheet/hash/dimension and mapping bindings', () => {
    const dir = reviewedBindingFixture()
    try { expect(failedReviewChecks(dir)).to.deep.equal([]) } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  for (const mutation of [
    {
      name: 'a contact sheet replaced by non-PNG bytes',
      mutate: dir => writeFileSync(join(dir, 'contact-sheets', readdirSync(join(dir, 'contact-sheets')).sort()[0]), 'NOT-A-PNG'),
      expected: 'PNG signature',
    },
    {
      name: 'an extra stale contact sheet',
      mutate: dir => copyFileSync(join(dir, 'contact-sheets', readdirSync(join(dir, 'contact-sheets')).sort()[0]), join(dir, 'contact-sheets', 'stale-old-sheet.png')),
      expected: 'exactly matches',
    },
    {
      name: 'a missing contact sheet',
      mutate: dir => unlinkSync(join(dir, 'contact-sheets', readdirSync(join(dir, 'contact-sheets')).sort()[0])),
      expected: 'exactly matches',
    },
    {
      name: 'a valid old/other sheet substituted under the planned filename',
      mutate: dir => {
        const [first, second] = readdirSync(join(dir, 'contact-sheets')).sort()
        copyFileSync(join(dir, 'contact-sheets', second), join(dir, 'contact-sheets', first))
      },
      expected: 'SHA-256',
    },
    {
      name: 'shot-plan/index and mapping JSON/SVG drift after visual review',
      mutate: dir => {
        const plan = readJson(join(dir, 'shot-plan.json')); plan.reviewerMutation = true; writeJson(join(dir, 'shot-plan.json'), plan)
        const index = readJson(join(dir, 'index.json')); index.reviewerMutation = true; writeJson(join(dir, 'index.json'), index)
        const mapping = readJson(join(dir, 'mask-structure-mapping/mask-structure-mapping.json')); mapping.reviewerMutation = true; writeJson(join(dir, 'mask-structure-mapping/mask-structure-mapping.json'), mapping)
        writeFileSync(join(dir, 'mask-structure-mapping/mask-structure-mapping.svg'), `${readFileSync(join(dir, 'mask-structure-mapping/mask-structure-mapping.svg'), 'utf8')}<!-- drift -->\n`)
      },
      expected: 'actual current TMX',
    },
  ]) {
    it(`rejects ${mutation.name}`, () => {
      const dir = reviewedBindingFixture()
      try {
        mutation.mutate(dir)
        const failures = failedReviewChecks(dir)
        expect(failures.length).to.be.greaterThan(0)
        expect(failures.map(failure => failure.check).join(' | ')).to.include(mutation.expected)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })
  }

  it('Python review-binding mode rejects the reviewer NOT-A-PNG reproduction', function () {
    this.timeout(30000)
    const dir = reviewedBindingFixture()
    try {
      writeFileSync(join(dir, 'contact-sheets', readdirSync(join(dir, 'contact-sheets')).sort()[0]), 'NOT-A-PNG')
      const result = spawnSyncCaptured('python3', ['-m', 'offline_pixel_renderer.validate', '--repo-root', ROOT, '--evidence-dir', dir, '--review-bindings-only', '--reviewed-evidence-dir', dir], {
        cwd: ROOT, encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONPATH: join(ROOT, 'scripts/juyiting/e13') },
      })
      expect(result.status).to.not.equal(0)
      expect(result.stdout).to.include('Python V6 contact sheets are PNG 755x398')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('E13 live shot canonical paths and unique hashes fail closed (P2-3)', () => {
  it('rejects a record that points at another shot', () => {
    const dir = liveEvidenceFixture((_dir, index) => {
      const first = index.shots[0]; const second = index.shots[1]
      first.file = second.file; first.sha256 = second.sha256
    })
    try { expect(runLiveGate(dir).status).to.not.equal(0) } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects an absolute record.file path', () => {
    const dir = liveEvidenceFixture((_liveDir, index) => {
      index.shots[0].file = resolve(FIXTURE, 'live/shots/E13-271.png')
    })
    try { expect(runLiveGate(dir).status).to.not.equal(0) } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects ../ path traversal even when the escaped file hash is supplied', () => {
    const dir = liveEvidenceFixture((liveDir, index) => {
      const escaped = join(liveDir, '..', `escaped-${process.pid}.png`)
      copyFileSync(join(FIXTURE, 'live/shots/E13-271.png'), escaped)
      index.shots[0].file = `../${escaped.split('/').at(-1)}`
    })
    try { expect(runLiveGate(dir).status).to.not.equal(0) } finally {
      const escaped = join(dir, '..', `escaped-${process.pid}.png`)
      rmSync(escaped, { force: true }); rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a canonical-name symlink that escapes the live evidence root', () => {
    const dir = liveEvidenceFixture((liveDir) => {
      const file = join(liveDir, 'shots/E13-271.png')
      unlinkSync(file)
      symlinkSync(resolve(FIXTURE, 'live/shots/E13-271.png'), file, 'file')
    })
    try { expect(runLiveGate(dir).status).to.not.equal(0) } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects duplicate bytes/hashes assigned to two planned shot names', () => {
    const dir = liveEvidenceFixture((liveDir, index) => {
      const first = index.shots[0]; const second = index.shots[1]
      unlinkSync(join(liveDir, second.file)); copyFileSync(join(liveDir, first.file), join(liveDir, second.file))
      second.sha256 = first.sha256
    })
    try { expect(runLiveGate(dir).status).to.not.equal(0) } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('E13 isolated mechanical rebuild scope (P2-2)', () => {
  it('aggregate reviewed-evidence gate rejects an implicit review source before running expensive validation', () => {
    const result = spawnSyncCaptured(process.execPath, ['--import', 'tsx', GATE_SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 10000 })
    expect(result.status).to.not.equal(0)
    expect(result.stderr).to.include('--reviewed-evidence-dir is required')
  })

  it('starts from a clean /tmp output without borrowing V5/V6/live reviewed artifacts', function () {
    this.timeout(120000)
    const dir = mkdtempSync(join(tmpdir(), 'cyf-e13-clean-rebuild-smoke-'))
    rmSync(dir, { recursive: true, force: true })
    try {
      const result = spawnSyncCaptured(process.execPath, [GENERATOR_SCRIPT, '--output', dir, '--limit', '1'], {
        cwd: ROOT, encoding: 'utf8', timeout: 120000,
      })
      expect(result.status, result.stderr).to.equal(0)
      expect(existsSync(join(dir, 'index.json'))).to.equal(true)
      expect(existsSync(join(dir, 'shots/E13-001.png'))).to.equal(true)
      for (const name of ['visual-review-v5.json', 'visual-review-v6.json', 'live', 'mask-structure-mapping', 'machines-gate.json']) {
        expect(existsSync(join(dir, name)), name).to.equal(false)
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
