#!/usr/bin/env node
/**
 * E9A Fragment Ownership Spec Generator
 *
 * Decodes the canonical occluder WebP, finds connected components,
 * partitions them into six spatial regions, and emits the machine-readable
 * fragment ownership specification.
 *
 * Usage:
 *   node scripts/juyiting/generate-fragment-ownership-spec.mjs [--update]
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

const CHROMIUM = process.env.CHROMIUM_HEADLESS || '/usr/local/bin/chromium-headless-smoke'
const CANONICAL_PATH = 'public/juyiting/images/liangshan-hall-mid-occluders-v3.webp'
const SPEC_PATH = 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json'

const CANONICAL_EXPECTED_SHA256 = '3e4f3f90b4d84411a844978237a7d3530bd481c37a62bcd73b9d694a7d2dd432'
const E8B_TMX_SHA256 = '291a38cc66ebd60c8577500a5afc18ce5398570fe4c35ca66d9eebe818826a97'

const ALPHA_THRESHOLD = 1
const MIN_COMPONENT_PIXELS = 5

// ── Region Partition ──────────────────────────────────────────────────────
// Six non-overlapping half-open rectangles covering the source [0,1664)×[0,928).
// Boundaries chosen to respect natural column gaps and map semantics.
const REGION_DEFS = {
  'west-upper':  { xMin: 0,    xMax: 721,  yMin: 0,   yMax: 580 },
  'west-lower':  { xMin: 0,    xMax: 721,  yMin: 580, yMax: 928 },
  'center':      { xMin: 721,  xMax: 1130, yMin: 0,   yMax: 580 },
  'entrance':    { xMin: 721,  xMax: 1130, yMin: 580, yMax: 928 },
  'east-upper':  { xMin: 1130, xMax: 1664, yMin: 0,   yMax: 580 },
  'east-lower':  { xMin: 1130, xMax: 1664, yMin: 580, yMax: 928 },
}

// ── Semantic naming heuristics ────────────────────────────────────────────
function classifyComponent(comp) {
  const { width, height, pixelCount } = comp
  const aspectRatio = width / Math.max(height, 1)

  // Tall and thin → pillar/column
  if (height > width * 2 && width < 60 && height > 40) return 'pillar'

  // Very wide and short → beam/lintel
  if (width > height * 3 && height < 50) return 'beam'

  // Large structure (massive pixel count) → wall
  if (pixelCount > 30000) return 'wall'

  // Wide structures (width > 100) → railing/balustrade
  if (width > 100 && height < 150) return 'railing'

  // Medium structures with more height → structure
  if (pixelCount > 1000 && height > 50) return 'structure'

  // Small elements
  if (pixelCount < 500) return 'detail'

  return 'element'
}

function semanticName(region, classification, index, comp) {
  const spatial = comp.centerY < 400 ? 'upper' : comp.centerY < 600 ? 'mid' : 'lower'
  const dir = comp.centerX < 300 ? 'west' : comp.centerX > 1400 ? 'east' : ''
  const prefix = [classification, spatial, dir].filter(Boolean).join('-')
  return `${prefix}-${String(index).padStart(2, '0')}`
}

// ── Decode canonical WebP via Chromium ────────────────────────────────────
function decodeCanonicalRGBA(webpBytes) {
  const sha256 = createHash('sha256').update(webpBytes).digest('hex')
  if (sha256 !== CANONICAL_EXPECTED_SHA256) {
    throw new Error(`Canonical source hash mismatch: expected ${CANONICAL_EXPECTED_SHA256}, got ${sha256}`)
  }

  const htmlPath = join(tmpdir(), 'e9a-gen-decode.html')
  const html = `<!doctype html><meta charset="utf-8"><body id="out">waiting<script>
(async () => {
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

      // Connected components via BFS flood-fill
      const visited = new Uint8Array(w * h);
      const components = [];
      const MIN_PX = ${MIN_COMPONENT_PIXELS};

      for (let y = 0; y < h; y++) {
        for (let q = 0; q < w; q++) {
          const idx = y * w + q;
          if (visited[idx]) continue;
          if (d[idx * 4 + 3] < ${ALPHA_THRESHOLD}) continue;

          const stack = [[q, y]];
          visited[idx] = 1;
          let minX = q, maxX = q, minY = y, maxY = y, count = 0;

          while (stack.length > 0) {
            const [cx, cy] = stack.pop();
            count++;
            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;

            for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
              const ni = ny * w + nx;
              if (visited[ni]) continue;
              if (d[ni * 4 + 3] < ${ALPHA_THRESHOLD}) continue;
              visited[ni] = 1;
              stack.push([nx, ny]);
            }
          }

          if (count >= MIN_PX) {
            components.push({
              minX, minY, maxX: maxX + 1, maxY: maxY + 1,
              width: maxX - minX + 1, height: maxY - minY + 1,
              centerX: Math.round((minX + maxX) / 2),
              centerY: Math.round((minY + maxY) / 2),
              pixelCount: count
            });
          }
        }
      }

      // Total opaque pixel count
      let totalOpaque = 0;
      for (let i = 0; i < w * h; i++) {
        if (d[i * 4 + 3] >= ${ALPHA_THRESHOLD}) totalOpaque++;
      }

      // Global alpha bounds
      let gMinX = w, gMinY = h, gMaxX = -1, gMaxY = -1;
      for (let y = 0; y < h; y++) {
        for (let q = 0; q < w; q++) {
          if (d[(y * w + q) * 4 + 3] >= ${ALPHA_THRESHOLD}) {
            if (q < gMinX) gMinX = q;
            if (q > gMaxX) gMaxX = q;
            if (y < gMinY) gMinY = y;
            if (y > gMaxY) gMaxY = y;
          }
        }
      }

      document.body.textContent = JSON.stringify({
        width: w, height: h, totalOpaque,
        globalAlphaBounds: { minX: gMinX, minY: gMinY, maxX: gMaxX + 1, maxY: gMaxY + 1 },
        components
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
      '--virtual-time-budget=8000', '--dump-dom',
      `file://${htmlPath}`
    ], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 100 * 1024 * 1024 })

    const match = result.match(/<body id="out">([\s\S]*?)<\/body>/)
    if (!match) throw new Error('Chromium output missing result body')
    const text = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    if (text.startsWith('ERROR:')) throw new Error(text)
    return JSON.parse(text)
  } finally {
    try { unlinkSync(htmlPath) } catch {}
  }
}

// ── Assign component to region ────────────────────────────────────────────
function assignRegion(comp) {
  // Assign based on center of mass
  for (const [name, def] of Object.entries(REGION_DEFS)) {
    if (comp.centerX >= def.xMin && comp.centerX < def.xMax &&
        comp.centerY >= def.yMin && comp.centerY < def.yMax) {
      return name
    }
  }
  // Fallback: find closest region
  let best = null, bestDist = Infinity
  for (const [name, def] of Object.entries(REGION_DEFS)) {
    const cx = (def.xMin + def.xMax) / 2
    const cy = (def.yMin + def.yMax) / 2
    const dist = Math.abs(comp.centerX - cx) + Math.abs(comp.centerY - cy)
    if (dist < bestDist) { best = name; bestDist = dist }
  }
  return best
}

// ── Clip component to region boundaries ───────────────────────────────────
function clipToRegion(comp, regionName) {
  const def = REGION_DEFS[regionName]
  const clippedMinX = Math.max(comp.minX, def.xMin)
  const clippedMinY = Math.max(comp.minY, def.yMin)
  const clippedMaxX = Math.min(comp.maxX, def.xMax)
  const clippedMaxY = Math.min(comp.maxY, def.yMax)

  if (clippedMinX >= clippedMaxX || clippedMinY >= clippedMaxY) return null

  return {
    minX: clippedMinX,
    minY: clippedMinY,
    maxX: clippedMaxX,
    maxY: clippedMaxY,
    width: clippedMaxX - clippedMinX,
    height: clippedMaxY - clippedMinY,
  }
}

// ── Count opaque pixels in a rect using the decoded RGBA data ─────────────
// (For the generator we trust the component's pixelCount; validator will verify)


// ── Resolve overlapping sourceRects ───────────────────────────────────────
// Connected components may have overlapping bounding boxes even though
// their actual non-transparent pixels are disjoint (flood-fill guarantee).
// Resolve by: component with smaller minY wins; if same minY, smaller minX wins.
// The losing component's sourceRect is clipped to exclude the overlap area.
function resolveOverlaps(fragments) {
  // Sort by priority: lower minY first, then lower minX
  const sorted = [...fragments].sort((a, b) => {
    if (a.sourceRect.y !== b.sourceRect.y) return a.sourceRect.y - b.sourceRect.y
    return a.sourceRect.x - b.sourceRect.x
  })

  const resolved = []
  const placed = [] // list of placed non-overlapping rects

  for (const frag of sorted) {
    let rects = [{ x: frag.sourceRect.x, y: frag.sourceRect.y, w: frag.sourceRect.width, h: frag.sourceRect.height }]
    
    // Clip against all previously placed rects
    for (const p of placed) {
      const newRects = []
      for (const r of rects) {
        // Check overlap
        if (r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y) {
          // Split r into up to 4 non-overlapping pieces around p
          // Top strip
          if (r.y < p.y) {
            newRects.push({ x: r.x, y: r.y, w: r.w, h: p.y - r.y })
          }
          // Bottom strip
          if (r.y + r.h > p.y + p.h) {
            newRects.push({ x: r.x, y: p.y + p.h, w: r.w, h: r.y + r.h - (p.y + p.h) })
          }
          // Left strip (between top and bottom)
          const midY = Math.max(r.y, p.y)
          const midH = Math.min(r.y + r.h, p.y + p.h) - midY
          if (midH > 0) {
            if (r.x < p.x) {
              newRects.push({ x: r.x, y: midY, w: p.x - r.x, h: midH })
            }
            // Right strip
            if (r.x + r.w > p.x + p.w) {
              newRects.push({ x: p.x + p.w, y: midY, w: r.x + r.w - (p.x + p.w), h: midH })
            }
          }
        } else {
          newRects.push(r)
        }
      }
      rects = newRects
    }

    // Add resolved rects for this fragment
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      if (r.w <= 0 || r.h <= 0) continue
      
      const resolvedFrag = { ...frag }
      resolvedFrag.sourceRect = { x: r.x, y: r.y, width: r.w, height: r.h }
      resolvedFrag.destinationRect = { x: r.x, y: r.y, width: r.w, height: r.h }
      if (rects.length > 1) {
        resolvedFrag.stableId = frag.stableId.replace(/.v1$/, `-p${i}.v1`)
        resolvedFrag.overlapResolved = true
      }
      resolved.push(resolvedFrag)
      placed.push({ x: r.x, y: r.y, w: r.w, h: r.h })
    }
  }

  return resolved
}

// ── Generate stableId ─────────────────────────────────────────────────────
function makeStableId(region, classification, index) {
  // Use deterministic naming: jyt.occ.<region>.<classification>-<index>.v1
  return `jyt.occ.${region}.${classification}-${String(index).padStart(2, '0')}.v1`
}

// ── Generate fragment ownership spec ──────────────────────────────────────
function generateSpec(decoded, baseCommit) {
  const { width, height, totalOpaque, globalAlphaBounds, components } = decoded

  // Sort components spatially
  components.sort((a, b) => a.minY - b.minY || a.minX - b.minX)

  // Assign components to regions and create fragments
  const regionFragments = {}
  const regionCounters = {}
  for (const name of Object.keys(REGION_DEFS)) {
    regionFragments[name] = []
    regionCounters[name] = {}
  }

  for (const comp of components) {
    const region = assignRegion(comp)
    const classification = classifyComponent(comp)

    // Check if component crosses region boundaries
    const def = REGION_DEFS[region]
    const crossesX = comp.minX < def.xMin || comp.maxX > def.xMax
    const crossesY = comp.minY < def.yMin || comp.maxY > def.yMax

    if (crossesX || crossesY) {
      // Component crosses region boundaries → split into multiple fragments
      // Check which regions the component overlaps
      const overlappingRegions = []
      for (const [rname, rdef] of Object.entries(REGION_DEFS)) {
        if (comp.minX < rdef.xMax && comp.maxX > rdef.xMin &&
            comp.minY < rdef.yMax && comp.maxY > rdef.yMin) {
          overlappingRegions.push(rname)
        }
      }

      for (const rname of overlappingRegions) {
        const clipped = clipToRegion(comp, rname)
        if (!clipped) continue

        const clsf = classification // inherit parent classification
        if (!regionCounters[rname][clsf]) regionCounters[rname][clsf] = 0
        const idx = ++regionCounters[rname][clsf]

        const fragment = {
          stableId: makeStableId(rname, clsf, idx),
          region: rname,
          chunkId: rname,
          sourceRect: {
            x: clipped.minX, y: clipped.minY,
            width: clipped.width, height: clipped.height
          },
          destinationRect: {
            x: clipped.minX, y: clipped.minY,
            width: clipped.width, height: clipped.height
          },
          pixelOwnershipRule: 'sourceRect-exclusive',
          semanticClassification: clsf,
          parentComponentIndex: components.indexOf(comp),
          crossRegionSplit: true,
          outputFileHint: `public/juyiting/images/occluders/${rname}-v1.webp`
        }
        regionFragments[rname].push(fragment)
      }
    } else {
      // Component fully within one region
      if (!regionCounters[region][classification]) regionCounters[region][classification] = 0
      const idx = ++regionCounters[region][classification]

      const fragment = {
        stableId: makeStableId(region, classification, idx),
        region,
        chunkId: region,
        sourceRect: {
          x: comp.minX, y: comp.minY,
          width: comp.width, height: comp.height
        },
        destinationRect: {
          x: comp.minX, y: comp.minY,
          width: comp.width, height: comp.height
        },
        pixelOwnershipRule: 'sourceRect-exclusive',
        semanticClassification: classification,
        parentComponentIndex: components.indexOf(comp),
        crossRegionSplit: false,
        outputFileHint: `public/juyiting/images/occluders/${region}-v1.webp`
      }
      regionFragments[region].push(fragment)
    }
  }

  // Flatten fragments
  const allFragments = []
  for (const name of Object.keys(REGION_DEFS)) {
    allFragments.push(...regionFragments[name])
  }


  // Resolve overlapping sourceRects
  const resolvedFragments = resolveOverlaps(allFragments)

  // Expand each sourceRect by 1px on all sides for Chromium decode safety margin
  // (then clamp to source bounds). Chromium canvas decoding may have off-by-one
  // edge artifacts compared to the original WebP.
  const srcW = width
  const srcH = height
  for (const f of resolvedFragments) {
    const pad = 1
    f.sourceRect.x = Math.max(0, f.sourceRect.x - pad)
    f.sourceRect.y = Math.max(0, f.sourceRect.y - pad)
    f.sourceRect.width = Math.min(srcW, f.sourceRect.x + f.sourceRect.width + pad * 2) - f.sourceRect.x
    f.sourceRect.height = Math.min(srcH, f.sourceRect.y + f.sourceRect.height + pad * 2) - f.sourceRect.y
    f.destinationRect.x = f.sourceRect.x
    f.destinationRect.y = f.sourceRect.y
    f.destinationRect.width = f.sourceRect.width
    f.destinationRect.height = f.sourceRect.height
  }

  // Clamp expanded fragments back to their region bounds
  for (const f of resolvedFragments) {
    const rdef = REGION_DEFS[f.region]
    if (rdef) {
      f.sourceRect.x = Math.max(rdef.xMin, f.sourceRect.x)
      f.sourceRect.y = Math.max(rdef.yMin, f.sourceRect.y)
      f.sourceRect.width = Math.min(rdef.xMax, f.sourceRect.x + f.sourceRect.width) - f.sourceRect.x
      f.sourceRect.height = Math.min(rdef.yMax, f.sourceRect.y + f.sourceRect.height) - f.sourceRect.y
      f.destinationRect.x = f.sourceRect.x
      f.destinationRect.y = f.sourceRect.y
      f.destinationRect.width = f.sourceRect.width
      f.destinationRect.height = f.sourceRect.height
    }
  }

  // Re-resolve overlaps after expansion
  const finalFragments = resolveOverlaps(resolvedFragments)

  // Build spec
  const spec = {
    $schema: 'jyt.occlusion.fragment-ownership-spec.v1',
    schemaVersion: 1,
    taskId: 'E9A',
    baseCommit,
    sceneId: 'juyiting-main',
    sourceProvenance: {
      assetRef: 'jyt.occlusion-source.hall-v3',
      path: CANONICAL_PATH,
      sha256: CANONICAL_EXPECTED_SHA256,
      width,
      height,
      alphaThreshold: ALPHA_THRESHOLD,
      totalOpaquePixels: totalOpaque,
      globalAlphaBounds
    },
    inputProvenance: {
      tmxAnchor: {
        taskId: 'E8B',
        path: 'public/juyiting/hall.tmx',
        sha256: E8B_TMX_SHA256
      }
    },
    regionPartition: {
      description: 'Six non-overlapping half-open rectangular regions partitioning the source space [0,1664)×[0,928). Boundaries respect natural column gaps and existing map mask semantics. Half-open: pixel (x,y) belongs to region if xMin ≤ x < xMax and yMin ≤ y < yMax.',
      regions: Object.fromEntries(
        Object.entries(REGION_DEFS).map(([name, def]) => [
          name,
          {
            xRange: [def.xMin, def.xMax],
            yRange: [def.yMin, def.yMax],
            width: def.xMax - def.xMin,
            height: def.yMax - def.yMin,
            chunkId: name
          }
        ])
      )
    },
    visualStructureExplanation: {
      westUpper: 'Upper west side including northwest ceiling beams, pillars, and upper wall structures. x=[0,721), y=[0,580)',
      westLower: 'Lower west side including the main west wall, agent-roster area, and southwest corner structures. x=[0,721), y=[580,928)',
      center: 'Central hall upper area including north-center pillars and the council table ceiling. Mostly open space with sparse occluders. x=[721,1130), y=[0,580)',
      entrance: 'Entrance/gate area in the south-center, including gate pillars and doorway structures. x=[721,1130), y=[580,928)',
      eastUpper: 'Upper east side including northeast pillars, bounty-board area railings, and east upper structures. x=[1130,1664), y=[0,580)',
      eastLower: 'Lower east side including library-shelf area, southeast corner structures, and east lower railings. x=[1130,1664), y=[580,928)'
    },
    outputConstraints: {
      format: ['lossless-webp', 'png'],
      losslessOnly: true,
      paddingPixels: 2,
      paddingPolicy: 'transparent-padding-around-each-fragment-sourceRect',
      reconstructionRequirement: 'all-fragments-placed-at-destinationRects-must-reconstruct-canonical-RGBA-exactly',
      pixelOwnershipModel: 'sourceRect-exclusive-partition',
      includePolicy: 'all-non-transparent-pixels-must-be-owned-by-exactly-one-fragment',
      excludePolicy: 'transparent-pixels-with-alpha-zero-are-not-owned',
      fragmentCount: finalFragments.length,
      regionFragmentCounts: Object.fromEntries(
        Object.entries(regionFragments).map(([k, v]) => [k, v.length])
      )
    },
    fragments: finalFragments,
    generation: {
      generatedBy: 'scripts/juyiting/generate-fragment-ownership-spec.mjs',
      deterministicInputs: [
        CANONICAL_PATH,
        CANONICAL_EXPECTED_SHA256
      ],
      sourceEpoch: baseCommit ? parseInt(
        execFileSync('git', ['show', '-s', '--format=%ct', baseCommit],
          { encoding: 'utf8', cwd: REPO_ROOT }).trim()
      ) : null
    }
  }

  // Add generationId (deterministic hash of the spec without generationId)
  const specWithoutId = { ...spec }
  delete specWithoutId.generation
  spec.generationId = createHash('sha256')
    .update(JSON.stringify(specWithoutId, Object.keys(specWithoutId).sort()))
    .digest('hex')

  spec.generation.generationId = spec.generationId

  return spec
}

// ── Main ──────────────────────────────────────────────────────────────────
function main() {
  const update = process.argv.includes('--update')
  const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'],
    { encoding: 'utf8', cwd: REPO_ROOT }).trim()

  console.error('Decoding canonical WebP...')
  const webpBytes = readFileSync(join(REPO_ROOT, CANONICAL_PATH))
  const decoded = decodeCanonicalRGBA(webpBytes)

  console.error(`Found ${decoded.components.length} connected components`)
  console.error(`Total opaque pixels: ${decoded.totalOpaque}`)

  const spec = generateSpec(decoded, update ? baseCommit : null)

  console.error(`Generated ${spec.fragments.length} fragments across 6 regions`)

  const specJson = JSON.stringify(spec, null, 2) + '\n'

  if (update) {
    mkdirSync(dirname(join(REPO_ROOT, SPEC_PATH)), { recursive: true })
    writeFileSync(join(REPO_ROOT, SPEC_PATH), specJson)
    console.error(`Written to ${SPEC_PATH}`)
  }

  // Always output to stdout for piping
  process.stdout.write(specJson)
}

main()
