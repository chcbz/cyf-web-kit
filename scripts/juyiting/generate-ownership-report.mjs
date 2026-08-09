#!/usr/bin/env node
/**
 * E9A Fragment Ownership Report Generator
 *
 * Produces a machine-readable ownership report proving that every expected
 * non-transparent canonical pixel has exactly one owner.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

const CHROMIUM = process.env.CHROMIUM_HEADLESS || '/usr/local/bin/chromium-headless-smoke'
const SPEC_PATH = 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json'
const REPORT_PATH = 'tests/fixtures/juyiting/occlusion-v2-fragments/ownership-report.json'

function main() {
  const spec = JSON.parse(readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf8'))
  const canonicalPath = join(REPO_ROOT, spec.sourceProvenance.path)
  const webpBytes = readFileSync(canonicalPath)

  // Decode and validate ownership per-pixel
  const fragmentsJson = JSON.stringify(spec.fragments.map(f => ({
    id: f.stableId,
    region: f.region,
    rx: f.sourceRect.x, ry: f.sourceRect.y,
    rw: f.sourceRect.width, rh: f.sourceRect.height
  })))

  const htmlPath = join(tmpdir(), 'e9a-ownership-report.html')
  const html = `<!doctype html><meta charset="utf-8"><body id="out">waiting<script>
(async () => {
  const fragments = ${fragmentsJson};
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const w = c.width, h = c.height;

      const owner = new Int32Array(w * h);

      // First pass: assign owners
      for (let fi = 0; fi < fragments.length; fi++) {
        const f = fragments[fi];
        for (let py = f.ry; py < f.ry + f.rh; py++) {
          for (let px = f.rx; px < f.rx + f.rw; px++) {
            const idx = py * w + px;
            if (owner[idx] !== 0) {
              // Overlap detected - already reported by validator
            }
            owner[idx] = fi + 1;
          }
        }
      }

      // Second pass: categorize every pixel
      const stats = {
        totalPixels: w * h,
        opaqueOwned: 0,
        opaqueUnowned: 0,
        transparentOwned: 0,
        transparentUnowned: 0,
        overlapPixels: 0
      }

      const perRegion = {}
      for (const f of fragments) {
        if (!perRegion[f.region]) perRegion[f.region] = { opaqueCovered: 0, totalCovered: 0 }
      }

      const unownedSamples = []
      const overlapSamples = []

      const ownerCount = new Int32Array(w * h) // track multiple owners
      // Rebuild with overlap detection
      const ownerArr = new Array(w * h).fill(null)
      for (let fi = 0; fi < fragments.length; fi++) {
        const f = fragments[fi];
        for (let py = f.ry; py < f.ry + f.rh; py++) {
          for (let px = f.rx; px < f.rx + f.rw; px++) {
            const idx = py * w + px;
            if (ownerArr[idx] === null) {
              ownerArr[idx] = fi
            } else if (ownerArr[idx] !== fi) {
              ownerArr[idx] = -1 // conflict
              if (overlapSamples.length < 20) overlapSamples.push({x: px, y: py})
            }
          }
        }
      }

      for (let y = 0; y < h; y++) {
        for (let q = 0; q < w; q++) {
          const idx = y * w + q
          const alpha = d[idx * 4 + 3]
          const ow = ownerArr[idx]

          if (alpha > 0) {
            if (ow === null) {
              stats.opaqueUnowned++
              if (unownedSamples.length < 20) unownedSamples.push({x: q, y})
            } else if (ow === -1) {
              stats.overlapPixels++
            } else {
              stats.opaqueOwned++
              perRegion[fragments[ow].region].opaqueCovered++
            }
          } else {
            if (ow !== null && ow !== -1) {
              stats.transparentOwned++
            } else {
              stats.transparentUnowned++
            }
          }

          if (ow !== null && ow !== -1) {
            perRegion[fragments[ow].region].totalCovered++
          }
        }
      }

      const allOwned = stats.opaqueUnowned === 0 && stats.overlapPixels === 0
      document.body.textContent = JSON.stringify({
        passed: allOwned,
        stats,
        perRegion,
        unownedSamples: unownedSamples.slice(0, 10),
        overlapSamples: overlapSamples.slice(0, 10),
        fragmentSummary: fragments.map((f, i) => ({
          stableId: f.id,
          region: f.region,
          sourceRect: {x: f.rx, y: f.ry, w: f.rw, h: f.rh}
        }))
      });
    } catch(e) {
      document.body.textContent = 'ERROR:' + e.message;
    }
  };
  img.onerror = () => { document.body.textContent = 'ERROR:load'; };
  img.src = 'data:image/webp;base64,${webpBytes.toString('base64')}';
})();
</script>`

  writeFileSync(htmlPath, html)
  try {
    const result = execFileSync(CHROMIUM, [
      '--disable-gpu', '--allow-file-access-from-files',
      '--virtual-time-budget=10000', '--dump-dom',
      `file://${htmlPath}`
    ], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 100 * 1024 * 1024 })

    const match = result.match(/<body id="out">([\s\S]*?)<\/body>/)
    if (!match) throw new Error('No result body')
    const text = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    if (text.startsWith('ERROR:')) throw new Error(text)
    const data = JSON.parse(text)

    // Build report
    const report = {
      $schema: 'jyt.occlusion.ownership-report.v1',
      taskId: 'E9A',
      generationId: spec.generationId,
      timestamp: new Date().toISOString(),
      source: {
        assetRef: spec.sourceProvenance.assetRef,
        sha256: spec.sourceProvenance.sha256,
        width: spec.sourceProvenance.width,
        height: spec.sourceProvenance.height
      },
      ownershipResult: {
        passed: data.passed,
        totalOpaquePixels: data.stats.opaqueOwned + data.stats.opaqueUnowned + data.stats.overlapPixels,
        opaqueOwned: data.stats.opaqueOwned,
        opaqueUnowned: data.stats.opaqueUnowned,
        overlapPixels: data.stats.overlapPixels,
        transparentOwnedBySourceRect: data.stats.transparentOwned,
        transparentUnowned: data.stats.transparentUnowned
      },
      perRegion: data.perRegion,
      fragmentCount: spec.fragments.length,
      regionFragmentCounts: spec.outputConstraints.regionFragmentCounts,
      unownedSamples: data.unownedSamples,
      overlapSamples: data.overlapSamples,
      policy: {
        ownershipModel: 'sourceRect-exclusive-partition',
        includePolicy: 'all-non-transparent-pixels-must-be-owned-by-exactly-one-fragment',
        excludePolicy: 'transparent-pixels-with-alpha-zero-are-not-owned',
        note: 'Transparent pixels within fragment sourceRects are included in atlas images but do not contribute to visual output. The ownership validation only checks non-transparent (alpha>0) pixels.'
      }
    }

    const outPath = join(REPO_ROOT, REPORT_PATH)
    writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
    console.error(`Ownership report written to ${REPORT_PATH}`)
    console.error(`Passed: ${data.passed}`)
    console.error(`Opaque owned: ${data.stats.opaqueOwned}, unowned: ${data.stats.opaqueUnowned}, overlap: ${data.stats.overlapPixels}`)

    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } finally {
    try { unlinkSync(htmlPath) } catch {}
  }
}

main()
