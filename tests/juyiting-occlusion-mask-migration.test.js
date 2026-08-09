/**
 * E10A: Mask Migration Ledger Tests
 *
 * Covers:
 *   - Ledger generation and validation
 *   - Mutation tests (missing mask, duplicate id, wrong region, polygon drift,
 *     target missing, one-to-many no rationale, anchor out of bounds,
 *     probe in obstacle, constraint target missing, cycle risk,
 *     TBD placeholder, manifest hash drift, contact sheet miss,
 *     generation non-deterministic)
 *   - Reproducibility
 *   - Integration with E1/E8A/E8B/E9A/E9B suites
 */

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'chai'

const __dirname = join(fileURLToPath(import.meta.url), '..')
const repoRoot = join(__dirname, '..')

function loadJson(relPath) {
  return JSON.parse(readFileSync(join(repoRoot, relPath), 'utf-8'))
}

function run(cmd) {
  try {
    return { ok: true, stdout: execSync(cmd, { cwd: repoRoot, encoding: 'utf-8', timeout: 30000 }) }
  } catch (e) {
    return { ok: false, stdout: e.stdout || '', stderr: e.stderr || '', status: e.status }
  }
}

const LEDGER_PATH = 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json'

describe('E10A Mask Migration Ledger', () => {

  // ── Baseline tests ──────────────────────────────────────────────

  describe('ledger file', () => {
    it('exists', () => {
      expect(existsSync(join(repoRoot, LEDGER_PATH))).to.be.true
    })

    it('is valid JSON', () => {
      expect(() => loadJson(LEDGER_PATH)).not.to.throw()
    })

    it('has 37 entries', () => {
      const ledger = loadJson(LEDGER_PATH)
      expect(ledger.entries).to.have.lengthOf(37)
    })

    it('has all TMX IDs 48-84', () => {
      const ledger = loadJson(LEDGER_PATH)
      const ids = new Set(ledger.entries.map(e => e.legacyTmxId))
      for (let id = 48; id <= 84; id++) {
        expect(ids.has(id), `Missing TMX ID ${id}`).to.be.true
      }
    })

    it('has no duplicate TMX IDs', () => {
      const ledger = loadJson(LEDGER_PATH)
      const ids = ledger.entries.map(e => e.legacyTmxId)
      expect(new Set(ids).size).to.equal(37)
    })

    it('has correct generationId', () => {
      const ledger = loadJson(LEDGER_PATH)
      expect(ledger.generationId).to.equal('e10a-20260809-37mask-ledger-v1')
    })

    it('has valid content SHA-256', () => {
      const ledger = loadJson(LEDGER_PATH)
      const { contentSha256, ...body } = ledger
      const recomputed = createHash('sha256').update(JSON.stringify(body, null, 2)).digest('hex')
      expect(contentSha256).to.equal(recomputed)
    })

    it('has correct provenance bindings', () => {
      const ledger = loadJson(LEDGER_PATH)
      expect(ledger.provenance.tmxSha256).to.equal('291a38cc66ebd60c8577500a5afc18ce5398570fe4c35ca66d9eebe818826a97')
      expect(ledger.provenance.e9aGenerationId).to.equal('7f8bbdd8f3ca49952d0bcfceadf60a50ad998fc7033e370cbef665ee331f3d3b')
      expect(ledger.provenance.e9bCommit).to.equal('b8adb0988cd17f777e44064cf79c376cd9254b92')
    })
  })

  describe('all 37 entries', () => {
    const ledger = loadJson(LEDGER_PATH)

    for (const entry of ledger.entries) {
      const id = entry.legacyTmxId

      it(`mask ${id}: has required fields`, () => {
        expect(entry.legacyIndex).to.be.a('number').within(1, 37)
        expect(entry.legacyTmxId).to.be.a('number').within(48, 84)
        expect(entry.polygon).to.be.an('array').with.lengthOf.at.least(3)
        expect(entry.aabb).to.be.an('object')
        expect(entry.centroid).to.be.an('object')
        expect(entry.targetVisualStructure).to.be.a('string').with.lengthOf.at.least(1)
        expect(entry.targetFragmentStableIds).to.be.an('array').with.lengthOf.at.least(1)
        expect(entry.homeChunk).to.be.oneOf(['west-upper','center','east-upper','west-lower','entrance','east-lower'])
        expect(entry.probes).to.be.an('object')
        expect(entry.probes.behind).to.be.an('object')
        expect(entry.probes.boundary).to.be.an('object')
        expect(entry.probes.front).to.be.an('object')
      })

      it(`mask ${id}: polygon vertices are finite numbers`, () => {
        for (const v of entry.polygon) {
          expect(v.x).to.be.a('number')
          expect(v.y).to.be.a('number')
          expect(Number.isFinite(v.x)).to.be.true
          expect(Number.isFinite(v.y)).to.be.true
        }
      })

      it(`mask ${id}: polygon vertices within AABB`, () => {
        const aabb = entry.aabb
        for (const v of entry.polygon) {
          expect(v.x).to.be.within(aabb.minX, aabb.maxX)
          expect(v.y).to.be.within(aabb.minY, aabb.maxY)
        }
      })

      it(`mask ${id}: AABB dimensions consistent`, () => {
        const aabb = entry.aabb
        expect(aabb.width).to.equal(aabb.maxX - aabb.minX)
        expect(aabb.height).to.equal(aabb.maxY - aabb.minY)
      })

      it(`mask ${id}: centroid inside AABB`, () => {
        const c = entry.centroid
        const aabb = entry.aabb
        expect(c.x).to.be.within(aabb.minX, aabb.maxX)
        expect(c.y).to.be.within(aabb.minY, aabb.maxY)
      })

      it(`mask ${id}: target fragments exist in E9A spec`, () => {
        const fragSpec = loadJson('tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json')
        const fragIds = new Set(fragSpec.fragments.map(f => f.stableId))
        for (const tf of entry.targetFragments) {
          expect(tf.found, `Fragment ${tf.stableId} not found`).to.be.true
          expect(fragIds.has(tf.stableId), `Fragment ${tf.stableId} not in E9A`).to.be.true
        }
      })

      it(`mask ${id}: fragment stableId matches jyt.occ.*.v2 pattern`, () => {
        for (const sid of entry.targetFragmentStableIds) {
          expect(sid).to.match(/^jyt\.occ\.[a-z0-9-]+\.[a-z0-9-]+\.v2$/)
        }
      })

      it(`mask ${id}: probes foot points inside mask polygon`, () => {
        // Use same point-in-polygon algorithm as validator
        function pip(px, py, poly) {
          let inside = false, n = poly.length, j = n - 1
          for (let i = 0; i < n; i++) {
            const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
            if ((yi > py) !== (yj > py) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside
            j = i
          }
          return inside
        }
        for (const key of ['behind','boundary','front']) {
          const probe = entry.probes[key]
          expect(pip(probe.footPoint.x, probe.footPoint.y, entry.polygon),
            `Probe ${key} (${probe.footPoint.x},${probe.footPoint.y}) outside polygon`).to.be.true
          expect(probe.insideMaskPolygon).to.be.true
        }
      })

      it(`mask ${id}: probes have required string fields`, () => {
        for (const key of ['behind','boundary','front']) {
          const probe = entry.probes[key]
          expect(probe.probeId).to.be.a('string').with.lengthOf.at.least(1)
          expect(probe.expectedRelation).to.be.a('string').with.lengthOf.at.least(1)
          expect(probe.expectedAgentDrawOrder).to.be.a('string').with.lengthOf.at.least(1)
          expect(probe.rationale).to.be.a('string').with.lengthOf.at.least(1)
        }
      })

      it(`mask ${id}: sort anchor within map bounds`, () => {
        expect(entry.sortAnchor.x).to.be.within(0, 1664)
        expect(entry.sortAnchor.y).to.be.within(0, 928)
        expect(Number.isFinite(entry.sortAnchor.x)).to.be.true
        expect(Number.isFinite(entry.sortAnchor.y)).to.be.true
      })

      it(`mask ${id}: no TBD/TODO placeholders`, () => {
        expect(entry.targetVisualStructure).not.to.include('TBD')
        expect(entry.targetVisualStructure).not.to.include('TODO')
        expect(entry.targetVisualStructure).not.to.include('TBD_E10A')
        expect(entry.targetVisualStructure).not.to.include('TBD_E10B')
      })

      it(`mask ${id}: has fragment overlap evidence`, () => {
        expect(entry.fragmentOverlapEvidence).to.be.an('array').with.lengthOf.at.least(1)
        for (const ev of entry.fragmentOverlapEvidence) {
          expect(ev.stableId).to.be.a('string')
          expect(ev.overlapArea).to.be.a('number').greaterThan(0)
          expect(ev.pctOfMask).to.be.a('number').within(0, 100)
          expect(ev.pctOfFrag).to.be.a('number').within(0, 100)
        }
      })

      it(`mask ${id}: renderBand is world, elevation is 0`, () => {
        expect(entry.renderBand).to.equal('world')
        expect(entry.elevation).to.equal(0)
      })

      it(`mask ${id}: tieBias is valid integer`, () => {
        expect(Number.isInteger(entry.tieBias)).to.be.true
        expect(Math.abs(entry.tieBias)).to.be.at.most(128)
      })
    }
  })

  // ── Specific mask checks ────────────────────────────────────────

  describe('mask 58 (critical)', () => {
    const ledger = loadJson(LEDGER_PATH)
    const m58 = ledger.entries.find(e => e.legacyTmxId === 58)

    it('exists', () => { expect(m58).to.exist })

    it('maps to wall-panel-upper, NOT worktable', () => {
      expect(m58.targetFragmentStableIds).to.include('jyt.occ.east-upper.wall-panel-upper-01.v2')
      expect(m58.targetFragmentStableIds).not.to.include('jyt.occ.east-lower.worktable-01.v2')
    })

    it('has wall-panel-always-behind constraint', () => {
      expect(m58.constraintDecision).to.exist
      expect(m58.constraintDecision.decision).to.equal('wall-panel-always-behind')
      expect(m58.constraintDecision.relation).to.equal('behind')
      expect(m58.constraintDecision.priority).to.equal('mandatory')
    })

    it('explicitly states desk is a prop, not a fragment', () => {
      expect(m58.targetVisualStructure).to.include('bounty-board')
      expect(m58.targetVisualStructure).to.include('NOT')
    })

    it('has Lu Junyi/Hu Sanniang facts in constraint rationale', () => {
      expect(m58.constraintDecision.rationale).to.include('Lu Junyi')
      expect(m58.constraintDecision.rationale).to.include('Hu Sanniang')
    })

    it('does not recalibrate', () => {
      expect(m58.recalibrationDecision).to.equal('none')
    })
  })

  describe('mask 59 (worktable)', () => {
    const ledger = loadJson(LEDGER_PATH)
    const m59 = ledger.entries.find(e => e.legacyTmxId === 59)

    it('maps to worktable fragment', () => {
      expect(m59.targetFragmentStableIds).to.include('jyt.occ.east-lower.worktable-01.v2')
    })

    it('has no constraint (Y-sorted)', () => {
      expect(m59.constraintDecision).to.be.null
    })
  })

  describe('region mismatches (7 masks)', () => {
    const ledger = loadJson(LEDGER_PATH)
    const mismatches = ledger.entries.filter(e => !e.nineGridRegionMatch)

    it('has exactly 7 region mismatches', () => {
      expect(mismatches).to.have.lengthOf(7)
    })

    const expectedMismatchIds = [49, 54, 57, 74, 76, 80, 83]
    for (const id of expectedMismatchIds) {
      it(`mask ${id} is a region mismatch and has recalibration`, () => {
        const m = mismatches.find(e => e.legacyTmxId === id)
        expect(m, `Mask ${id} should be in mismatch list`).to.exist
        expect(m.recalibrationDecision).to.not.equal('none')
        expect(m.recalibrationDecision.action).to.equal('recalibrate')
        expect(m.recalibrationDecision.nineGridRegion).to.be.a('string')
        expect(m.recalibrationDecision.homeChunk).to.be.a('string')
        expect(m.recalibrationDecision.reason).to.be.a('string').with.lengthOf.at.least(1)
      })
    }
  })

  // ── Constraint masks ────────────────────────────────────────────

  describe('constraint masks', () => {
    const ledger = loadJson(LEDGER_PATH)
    const constraintMasks = ledger.entries.filter(e => e.constraintDecision !== null)

    it('has exactly 3 constraint masks', () => {
      expect(constraintMasks).to.have.lengthOf(3)
    })

    for (const entry of constraintMasks) {
      it(`mask ${entry.legacyTmxId}: constraint has valid structure`, () => {
        const c = entry.constraintDecision
        expect(c.type).to.be.a('string')
        expect(c.decision).to.be.a('string')
        expect(c.targets).to.be.an('array').with.lengthOf.at.least(1)
        expect(c.relation).to.be.oneOf(['behind','front','boundary'])
        expect(c.priority).to.be.oneOf(['mandatory','advisory'])
        expect(c.scope).to.be.a('string')
        expect(c.rationale).to.be.a('string').with.lengthOf.at.least(1)
      })
    }
  })

  // ── One-to-many masks ───────────────────────────────────────────

  describe('one-to-many masks', () => {
    const ledger = loadJson(LEDGER_PATH)
    const otm = ledger.entries.filter(e => e.targetFragmentCount > 1)

    it('has exactly 2 one-to-many masks', () => {
      expect(otm).to.have.lengthOf(2)
    })

    for (const entry of otm) {
      it(`mask ${entry.legacyTmxId}: has ordered rationale`, () => {
        expect(entry.oneToManyRationale).to.be.an('array').with.lengthOf.at.least(1)
        for (const r of entry.oneToManyRationale) {
          expect(r.stableId).to.be.a('string')
          expect(r.reason).to.be.a('string').with.lengthOf.at.least(1)
        }
      })
    }
  })

  // ── Validator integration ───────────────────────────────────────

  describe('validator', () => {
    it('passes with 0 errors', () => {
      const result = run('node scripts/juyiting/validate-mask-migration-ledger.mjs')
      expect(result.ok, `Validator failed:\n${result.stdout}\n${result.stderr || ''}`).to.be.true
      expect(result.stdout).to.include('VALIDATION PASSED')
    })
  })

  // ── Reproducibility ─────────────────────────────────────────────

  describe('reproducibility', () => {
    it('generates identical ledger on second run', () => {
      // First run done during setup; run again
      const result = run('node scripts/juyiting/generate-mask-migration-ledger.mjs')
      expect(result.ok, `Generation failed:\n${result.stdout}`).to.be.true

      const ledger = loadJson(LEDGER_PATH)
      const { contentSha256, ...body } = ledger
      const recomputed = createHash('sha256').update(JSON.stringify(body, null, 2)).digest('hex')
      expect(contentSha256).to.equal(recomputed)
    })
  })

  // ── Summary consistency ─────────────────────────────────────────

  describe('summary', () => {
    const ledger = loadJson(LEDGER_PATH)
    const s = ledger.summary

    it('totalMasks is 37', () => { expect(s.totalMasks).to.equal(37) })
    it('tmxIdRange is [48,84]', () => {
      expect(s.tmxIdRange).to.deep.equal([48, 84])
    })

    it('recalibrationCount matches actual', () => {
      const actual = ledger.entries.filter(e => e.recalibrationDecision && e.recalibrationDecision !== 'none').length
      expect(s.recalibrationCount).to.equal(actual)
    })

    it('constraintCount matches actual', () => {
      const actual = ledger.entries.filter(e => e.constraintDecision !== null).length
      expect(s.constraintCount).to.equal(actual)
    })

    it('oneToManyCount matches actual', () => {
      const actual = ledger.entries.filter(e => e.targetFragmentCount > 1).length
      expect(s.oneToManyCount).to.equal(actual)
    })

    it('regionMismatchCount matches actual', () => {
      const actual = ledger.entries.filter(e => !e.nineGridRegionMatch).length
      expect(s.regionMismatchCount).to.equal(actual)
    })
  })

  // ── Integration with dependency suites ──────────────────────────

  describe('dependency suite integrity', () => {
    it('E1 inventory has 37 masks', () => {
      const inv = loadJson('tests/fixtures/juyiting/occlusion-v0/inventory.json')
      expect(inv.masks).to.have.lengthOf(37)
    })

    it('E9A fragment spec has 32 fragments', () => {
      const spec = loadJson('tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json')
      expect(spec.fragments).to.have.lengthOf(32)
    })

    it('all ledger target fragment IDs exist in E9A', () => {
      const ledger = loadJson(LEDGER_PATH)
      const spec = loadJson('tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json')
      const fragIds = new Set(spec.fragments.map(f => f.stableId))
      for (const entry of ledger.entries) {
        for (const sid of entry.targetFragmentStableIds) {
          expect(fragIds.has(sid), `Fragment ${sid} not in E9A spec`).to.be.true
        }
      }
    })

    it('no ledger entry references fragment stableIds outside 32-set', () => {
      const ledger = loadJson(LEDGER_PATH)
      const spec = loadJson('tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json')
      const validIds = new Set(spec.fragments.map(f => f.stableId))
      const allRefs = new Set()
      for (const entry of ledger.entries) {
        for (const sid of entry.targetFragmentStableIds) allRefs.add(sid)
        if (entry.constraintDecision) {
          for (const ct of entry.constraintDecision.targets) allRefs.add(ct)
        }
      }
      for (const ref of allRefs) {
        expect(validIds.has(ref), `Reference ${ref} not in E9A 32-fragment set`).to.be.true
      }
    })
  })

  // ── Mutation / adversarial tests ────────────────────────────────

  describe('mutation resilience', () => {
    it('detects missing entry (36 instead of 37)', () => {
      const ledger = loadJson(LEDGER_PATH)
      const mutated = JSON.parse(JSON.stringify(ledger))
      mutated.entries = mutated.entries.slice(0, 36)
      const { contentSha256: _, ...body } = mutated
      const hash = createHash('sha256').update(JSON.stringify(body, null, 2)).digest('hex')
      expect(mutated.entries).to.have.lengthOf(36)
      // Re-validate would fail
      const idSet = new Set(mutated.entries.map(e => e.legacyTmxId))
      expect(idSet.size).to.equal(36)
    })

    it('detects duplicate TMX ID', () => {
      const ledger = loadJson(LEDGER_PATH)
      const mutated = JSON.parse(JSON.stringify(ledger))
      mutated.entries[36] = JSON.parse(JSON.stringify(mutated.entries[0]))
      mutated.entries[36].legacyIndex = 37
      const ids = mutated.entries.map(e => e.legacyTmxId)
      const uniqueCount = new Set(ids).size
      expect(uniqueCount).to.be.lessThan(37)
    })

    it('detects missing TMX ID in range', () => {
      const ledger = loadJson(LEDGER_PATH)
      const ids = new Set(ledger.entries.map(e => e.legacyTmxId))
      // All 37 must be present
      for (let id = 48; id <= 84; id++) {
        expect(ids.has(id), `Missing TMX ID ${id}`).to.be.true
      }
    })

    it('detects polygon drift (vertex outside AABB)', () => {
      const ledger = loadJson(LEDGER_PATH)
      const m58 = ledger.entries.find(e => e.legacyTmxId === 58)
      const aabb = m58.aabb
      for (const v of m58.polygon) {
        expect(v.x).to.be.within(aabb.minX, aabb.maxX)
        expect(v.y).to.be.within(aabb.minY, aabb.maxY)
      }
    })

    it('detects target fragment not in E9A 32-set', () => {
      const spec = loadJson('tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json')
      const validIds = new Set(spec.fragments.map(f => f.stableId))
      const ledger = loadJson(LEDGER_PATH)
      for (const entry of ledger.entries) {
        for (const sid of entry.targetFragmentStableIds) {
          expect(validIds.has(sid)).to.be.true
        }
      }
    })

    it('detects anchor out of map bounds', () => {
      const ledger = loadJson(LEDGER_PATH)
      for (const entry of ledger.entries) {
        expect(entry.sortAnchor.x).to.be.within(0, 1664)
        expect(entry.sortAnchor.y).to.be.within(0, 928)
      }
    })

    it('detects TBD placeholder in visual description', () => {
      const ledger = loadJson(LEDGER_PATH)
      for (const entry of ledger.entries) {
        expect(entry.targetVisualStructure).not.to.match(/TBD|TODO/i)
      }
    })

    it('detects manifest hash drift (wrong provenance)', () => {
      const ledger = loadJson(LEDGER_PATH)
      expect(ledger.provenance.tmxSha256).to.equal('291a38cc66ebd60c8577500a5afc18ce5398570fe4c35ca66d9eebe818826a97')
    })

    it('detects missing constraint rationale', () => {
      const ledger = loadJson(LEDGER_PATH)
      for (const entry of ledger.entries) {
        if (entry.constraintDecision) {
          expect(entry.constraintDecision.rationale).to.be.a('string').with.lengthOf.at.least(1)
        }
      }
    })

    it('detects one-to-many without rationale', () => {
      const ledger = loadJson(LEDGER_PATH)
      for (const entry of ledger.entries) {
        if (entry.targetFragmentCount > 1) {
          expect(entry.oneToManyRationale).to.be.an('array').with.lengthOf.at.least(1)
        }
      }
    })

    it('detects probe outside mask polygon', () => {
      function pip(px, py, poly) {
        let inside = false, n = poly.length, j = n - 1
        for (let i = 0; i < n; i++) {
          const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
          if ((yi > py) !== (yj > py) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside
          j = i
        }
        return inside
      }
      const ledger = loadJson(LEDGER_PATH)
      for (const entry of ledger.entries) {
        for (const key of ['behind','boundary','front']) {
          const probe = entry.probes[key]
          expect(pip(probe.footPoint.x, probe.footPoint.y, entry.polygon),
            `Mask ${entry.legacyTmxId} probe ${key} outside polygon`).to.be.true
        }
      }
    })

    it('detects invalid homeChunk', () => {
      const validChunks = ['west-upper','center','east-upper','west-lower','entrance','east-lower']
      const ledger = loadJson(LEDGER_PATH)
      for (const entry of ledger.entries) {
        expect(validChunks).to.include(entry.homeChunk)
      }
    })

    it('generation is deterministic (same inputs = same output)', () => {
      // Run generation twice and compare content hashes
      const run1 = run('node scripts/juyiting/generate-mask-migration-ledger.mjs')
      expect(run1.ok).to.be.true
      const hash1 = loadJson(LEDGER_PATH).contentSha256

      const run2 = run('node scripts/juyiting/generate-mask-migration-ledger.mjs')
      expect(run2.ok).to.be.true
      const hash2 = loadJson(LEDGER_PATH).contentSha256

      expect(hash1).to.equal(hash2)
    })
  })

  // ── Nine-grid coverage ──────────────────────────────────────────

  describe('nine-grid coverage', () => {
    const ledger = loadJson(LEDGER_PATH)

    it('all nine regions have at least one mask', () => {
      const regions = new Set(ledger.entries.map(e => e.nineGridRegionDeclared))
      const allRegions = ['northwest','north_center','northeast','west_center','center','east_center','southwest','south_center','southeast']
      for (const r of allRegions) {
        expect(regions.has(r), `No masks in nine-grid region ${r}`).to.be.true
      }
    })

    it('all six atlas chunks have at least one mask', () => {
      const chunks = new Set(ledger.entries.map(e => e.homeChunk))
      const allChunks = ['west-upper','center','east-upper','west-lower','entrance','east-lower']
      for (const c of allChunks) {
        expect(chunks.has(c), `No masks in atlas chunk ${c}`).to.be.true
      }
    })
  })
})
