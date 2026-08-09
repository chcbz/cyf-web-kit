import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const CHROMIUM = process.env.CHROMIUM_HEADLESS || '/usr/local/bin/chromium-headless-smoke'
export const CANONICAL_PATH = 'public/juyiting/images/liangshan-hall-mid-occluders-v3.webp'
export const SPEC_PATH = 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json'
export const REPORT_PATH = 'tests/fixtures/juyiting/occlusion-v2-fragments/ownership-report.json'
export const CONTACT_SHEET_PATH = 'tests/fixtures/juyiting/occlusion-v2-fragments/contact-sheet.svg'
export const CANONICAL_EXPECTED_SHA256 = '3e4f3f90b4d84411a844978237a7d3530bd481c37a62bcd73b9d694a7d2dd432'
export const E8B_TMX_SHA256 = '291a38cc66ebd60c8577500a5afc18ce5398570fe4c35ca66d9eebe818826a97'
export const E9A_REJECTED_COMMIT = '672f522005b425bb4713d1865616e1a5424a194f'
export const BASE_COMMIT = 'a700d1c57a15026a362db535f97fb6baff47e9f7'
export const BASE_COMMIT_EPOCH = 1786267688
export const ALPHA_THRESHOLD = 1
export const COMPONENT_CONNECTIVITY = 8
export const STABLE_ID_RE = /^[a-z0-9][a-z0-9._-]{2,95}$/

export const REGION_ORDER = [
  'west-upper',
  'center',
  'east-upper',
  'west-lower',
  'entrance',
  'east-lower',
]

export const REGION_DEFS = {
  'west-upper': { xMin: 0, xMax: 721, yMin: 0, yMax: 580 },
  'west-lower': { xMin: 0, xMax: 721, yMin: 580, yMax: 928 },
  center: { xMin: 721, xMax: 1130, yMin: 0, yMax: 580 },
  entrance: { xMin: 721, xMax: 1130, yMin: 580, yMax: 928 },
  'east-upper': { xMin: 1130, xMax: 1664, yMin: 0, yMax: 580 },
  'east-lower': { xMin: 1130, xMax: 1664, yMin: 580, yMax: 928 },
}

// The catalog is keyed by canonical component geometry, not decode order. The
// canonical hash is immutable, so a geometry mismatch fails closed instead of
// silently renaming an owner. A multi-component entry requires an explicit,
// machine-readable componentGroupPolicy tying every island to one observable
// object; arbitrary disconnected merges are forbidden.
export const SEMANTIC_OWNER_CATALOG = [
  owner('jyt.occ.west-upper.lantern-01.v2', 'west-upper', 'lantern',
    'Tall illuminated wall lantern at the northwest upper wall.', ['461,165,45,75,2475']),
  owner('jyt.occ.center.wall-sconce-01.v2', 'center', 'wall-sconce',
    'Small north-center wall sconce; this object is not a pillar.', ['1112,230,18,54,504']),
  owner('jyt.occ.west-upper.wall-sconce-01.v2', 'west-upper', 'wall-sconce',
    'Small narrow wall sconce east of the northwest lantern.', ['617,238,13,34,216']),
  owner('jyt.occ.east-upper.scroll-table-front-01.v2', 'east-upper', 'scroll-table-front',
    'Near-side front edge of the northeast table surface carrying scrolls.', ['1384,255,95,29,2117']),
  owner('jyt.occ.west-upper.lantern-table-frame-01.v2', 'west-upper', 'lantern-table-frame',
    'Tabletop frame and near edge of the northwest table beneath the lantern.', ['215,277,139,74,2706']),
  owner('jyt.occ.east-upper.pillar-01.v2', 'east-upper', 'pillar',
    'Tall carved northeast inner pillar.', ['1158,305,46,159,4701']),
  owner('jyt.occ.west-upper.pillar-01.v2', 'west-upper', 'pillar',
    'Tall carved northwest inner pillar, including its one-pixel diagonal alpha fringe.', ['543,306,56,163,4981']),
  owner('jyt.occ.east-upper.wall-panel-upper-01.v2', 'east-upper', 'wall-panel',
    'Upper northeast wall panel and its connected top rail.', ['1197,342,467,117,30996']),
  owner('jyt.occ.west-upper.wall-panel-assembly-01.v2', 'west-upper', 'wall-panel-assembly',
    'Connected northwest/west wall panel with attached posts and braces; one owner crosses y=580.', ['0,348,546,368,82119']),
  owner('jyt.occ.west-upper.diagonal-brace-01.v2', 'west-upper', 'diagonal-brace',
    'Narrow diagonal brace immediately east of the northwest inner pillar.', ['600,432,16,57,449']),
  owner('jyt.occ.east-upper.diagonal-brace-01.v2', 'east-upper', 'diagonal-brace',
    'Narrow diagonal brace at the west edge of the northeast wall.', ['1130,435,19,51,500']),
  owner('jyt.occ.west-upper.wall-sconce-02.v2', 'west-upper', 'wall-sconce',
    'Lit wall sconce attached to the west wall panel near y=528.', ['492,471,45,114,2496']),
  owner('jyt.occ.east-upper.wall-panel-lower-01.v2', 'east-upper', 'wall-panel',
    'Lower horizontal northeast wall panel and shelf rail.', ['1256,477,408,71,27065']),
  owner('jyt.occ.east-upper.pillar-02.v2', 'east-upper', 'pillar',
    'Carved east pillar spanning the y=580 region guide without being clipped.', ['1202,478,50,225,5188']),
  owner('jyt.occ.east-lower.diagonal-brace-01.v2', 'east-lower', 'diagonal-brace',
    'Large southeast-facing diagonal brace spanning the y=580 region guide.', ['1308,560,203,208,12954']),
  owner('jyt.occ.west-lower.wall-panel-assembly-01.v2', 'west-lower', 'wall-panel-assembly',
    'Main southwest wall-panel assembly with connected corner cap and lower rail.', ['17,573,402,339,31548']),
  owner('jyt.occ.west-lower.wall-lantern-01.v2', 'west-lower', 'wall-lantern',
    'Independent illuminated angled wall lantern at the far west edge.', ['11,706,48,35,850']),
  owner('jyt.occ.west-lower.floor-lantern-01.v2', 'west-lower', 'floor-lantern',
    'Independent low box lantern at the southwest floor line.', ['357,876,48,52,1348']),
  groupedOwner('jyt.occ.east-lower.worktable-01.v2', 'east-lower', 'worktable',
    'East worktable with scrolls and vessels on its top, near edge, and separated lower-right leg/cap.',
    ['1499,574,120,100,5297', '1592,674,21,27,274'],
    {
      observableObject: 'east worktable',
      approvalBasis: 'GPT V2 reviewed the two alpha islands at (1499,574,120×100) and (1592,674,21×27) as visible parts of the same worktable.',
      approvedParts: [
        { componentKey: '1499,574,120,100,5297', role: 'tabletop-scrolls-vessels-near-edge-and-main-legs' },
        { componentKey: '1592,674,21,27,274', role: 'separated-lower-right-leg-cap' },
      ],
    }),
  owner('jyt.occ.west-lower.long-table-frame-01.v2', 'west-lower', 'long-table-frame',
    'Southwest long-table near frame, corner, and visible table legs.', ['117,601,122,118,2900']),
  owner('jyt.occ.west-lower.diagonal-brace-02.v2', 'west-lower', 'diagonal-brace',
    'Narrow diagonal brace beside the lower west railing.', ['474,641,43,118,2160']),
  owner('jyt.occ.entrance.lantern-post-01.v2', 'entrance', 'lantern-post',
    'Right entrance lantern post.', ['1052,674,41,104,3038']),
  owner('jyt.occ.west-lower.railing-01.v2', 'west-lower', 'railing',
    'Lower west horizontal railing with illuminated end post.', ['506,675,174,103,5013']),
  owner('jyt.occ.west-lower.wall-bracket-01.v2', 'west-lower', 'wall-bracket',
    'Small carved wall bracket at the east end of the lower west railing.', ['686,675,35,39,938']),
  owner('jyt.occ.entrance.lantern-post-02.v2', 'entrance', 'lantern-post',
    'Left entrance lantern post.', ['1004,678,31,77,1317']),
  owner('jyt.occ.east-lower.diagonal-brace-02.v2', 'east-lower', 'diagonal-brace',
    'Small triangular diagonal brace under the east wall panel.', ['1351,691,24,50,494']),
  owner('jyt.occ.east-lower.railing-post-01.v2', 'east-lower', 'railing-post',
    'Narrow vertical end post below the east pillar.', ['1242,707,10,68,355']),
  owner('jyt.occ.entrance.hanging-banner-01.v2', 'entrance', 'hanging-banner',
    'Left red hanging entrance banner.', ['767,722,48,72,2313']),
  owner('jyt.occ.entrance.hanging-banner-02.v2', 'entrance', 'hanging-banner',
    'Right red hanging entrance banner.', ['931,733,40,63,1867']),
  owner('jyt.occ.east-lower.fabric-rack-01.v2', 'east-lower', 'fabric-rack',
    'Independent southeast rack segment supporting draped fabric or a banner.', ['1598,748,66,82,2227']),
  owner('jyt.occ.west-lower.railing-02.v2', 'west-lower', 'railing',
    'Low southwest horizontal railing panel.', ['66,787,178,37,4549']),
  owner('jyt.occ.east-lower.lantern-01.v2', 'east-lower', 'lantern',
    'Low southeast standing lantern.', ['1314,839,47,86,2328']),
]

function owner(stableId, homeRegion, semanticType, observableDescription, componentKeys) {
  return {
    stableId,
    homeRegion,
    semanticType,
    observableDescription,
    componentKeys,
    componentGroupPolicy: {
      mode: 'single-component',
      observableObject: semanticType,
      approvedParts: [{ componentKey: componentKeys[0], role: 'complete-observable-object' }],
    },
  }
}

function groupedOwner(stableId, homeRegion, semanticType, observableDescription, componentKeys, componentGroupPolicy) {
  return {
    stableId,
    homeRegion,
    semanticType,
    observableDescription,
    componentKeys,
    componentGroupPolicy: {
      mode: 'approved-same-observable-object-parts',
      ...componentGroupPolicy,
    },
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function componentGeometryKey(component) {
  const { x, y, width, height } = component.bounds
  return `${x},${y},${width},${height},${component.pixelCount}`
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function computeGenerationId(spec) {
  const clone = structuredClone(spec)
  delete clone.generationId
  if (clone.generation) delete clone.generation.generationId
  return sha256(stableStringify(clone))
}

export function decodeCanonicalOwnership(webpBytes, { chromium = CHROMIUM, alphaThreshold = ALPHA_THRESHOLD } = {}) {
  const sourceSha256 = sha256(webpBytes)
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const htmlPath = join(tmpdir(), `e9a-rle-decode-${nonce}.html`)
  const html = `<!doctype html><meta charset="utf-8"><body id="out">waiting<script>
(() => {
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(img, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const width = canvas.width, height = canvas.height;
      const visited = new Uint8Array(width * height);
      const components = [];
      let totalOpaquePixels = 0;
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (rgba[(y * width + x) * 4 + 3] >= ${alphaThreshold}) {
          totalOpaquePixels++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
      const neighbors = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const start = y * width + x;
        if (visited[start] || rgba[start * 4 + 3] < ${alphaThreshold}) continue;
        visited[start] = 1;
        const stack = [start];
        const pixels = [];
        let cMinX = x, cMinY = y, cMaxX = x, cMaxY = y;
        while (stack.length) {
          const index = stack.pop();
          pixels.push(index);
          const px = index % width, py = Math.floor(index / width);
          if (px < cMinX) cMinX = px; if (px > cMaxX) cMaxX = px;
          if (py < cMinY) cMinY = py; if (py > cMaxY) cMaxY = py;
          for (const [dx, dy] of neighbors) {
            const nx = px + dx, ny = py + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            if (visited[ni] || rgba[ni * 4 + 3] < ${alphaThreshold}) continue;
            visited[ni] = 1; stack.push(ni);
          }
        }
        pixels.sort((a, b) => a - b);
        const runs = [];
        let runY = -1, runStart = -1, runEnd = -1;
        for (const index of pixels) {
          const px = index % width, py = Math.floor(index / width);
          if (py === runY && px === runEnd) { runEnd++; continue; }
          if (runY >= 0) runs.push([runY, runStart, runEnd]);
          runY = py; runStart = px; runEnd = px + 1;
        }
        if (runY >= 0) runs.push([runY, runStart, runEnd]);
        components.push({
          bounds: { x: cMinX, y: cMinY, width: cMaxX - cMinX + 1, height: cMaxY - cMinY + 1 },
          pixelCount: pixels.length,
          runs,
        });
      }
      document.body.textContent = JSON.stringify({
        width, height, totalOpaquePixels,
        globalAlphaBounds: { minX, minY, maxX: maxX + 1, maxY: maxY + 1 },
        components,
      });
    } catch (error) { document.body.textContent = 'ERROR:' + error.message; }
  };
  img.onerror = () => { document.body.textContent = 'ERROR:image-load'; };
  img.src = 'data:image/webp;base64,${webpBytes.toString('base64')}';
})();
</script>`
  writeFileSync(htmlPath, html)
  try {
    const result = execFileSync(chromium, [
      '--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=10000', '--dump-dom', `file://${htmlPath}`,
    ], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 100 * 1024 * 1024 })
    const match = result.match(/<body id="out">([\s\S]*?)<\/body>/)
    if (!match) throw new Error('Chromium output missing decoded ownership body')
    const text = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    if (text.startsWith('ERROR:')) throw new Error(text)
    const decoded = JSON.parse(text)
    decoded.sourceSha256 = sourceSha256
    for (const component of decoded.components) {
      component.geometryKey = componentGeometryKey(component)
      component.identitySha256 = sha256(stableStringify({ bounds: component.bounds, pixelCount: component.pixelCount, runs: component.runs }))
      component.componentId = `cc8-${component.identitySha256.slice(0, 20)}`
    }
    decoded.components.sort((a, b) => a.geometryKey.localeCompare(b.geometryKey))
    return decoded
  } finally {
    try { unlinkSync(htmlPath) } catch {}
  }
}

function unionRect(components, padding, width, height) {
  const minX = Math.max(0, Math.min(...components.map(component => component.bounds.x)) - padding)
  const minY = Math.max(0, Math.min(...components.map(component => component.bounds.y)) - padding)
  const maxX = Math.min(width, Math.max(...components.map(component => component.bounds.x + component.bounds.width)) + padding)
  const maxY = Math.min(height, Math.max(...components.map(component => component.bounds.y + component.bounds.height)) + padding)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function mergeRuns(components) {
  return components.flatMap(component => component.runs).sort(compareRuns)
}

export function compareRuns(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

export function runPixelCount(runs) {
  return runs.reduce((sum, run) => sum + run[2] - run[1], 0)
}

export function buildSpec(decoded) {
  if (decoded.sourceSha256 !== CANONICAL_EXPECTED_SHA256) {
    throw new Error(`Canonical source hash mismatch: expected ${CANONICAL_EXPECTED_SHA256}, got ${decoded.sourceSha256}`)
  }
  if (decoded.width !== 1664 || decoded.height !== 928) {
    throw new Error(`Canonical dimensions mismatch: expected 1664x928, got ${decoded.width}x${decoded.height}`)
  }

  const byGeometry = new Map(decoded.components.map(component => [component.geometryKey, component]))
  const catalogKeys = new Set(SEMANTIC_OWNER_CATALOG.flatMap(entry => entry.componentKeys))
  const decodedKeys = new Set(decoded.components.map(component => component.geometryKey))
  const unknown = [...decodedKeys].filter(key => !catalogKeys.has(key))
  const missing = [...catalogKeys].filter(key => !decodedKeys.has(key))
  if (unknown.length || missing.length) {
    throw new Error(`Semantic catalog mismatch: unknown=${JSON.stringify(unknown)} missing=${JSON.stringify(missing)}`)
  }

  const paddingPixels = 1
  const fragments = SEMANTIC_OWNER_CATALOG.map(entry => {
    const components = entry.componentKeys.map(key => byGeometry.get(key))
    const sourceRect = unionRect(components, paddingPixels, decoded.width, decoded.height)
    const ownershipRuns = mergeRuns(components)
    const canonicalComponentIds = components.map(component => component.componentId).sort()
    const canonicalComponents = components.map(component => ({
      componentId: component.componentId,
      identitySha256: component.identitySha256,
      geometryKey: component.geometryKey,
      bounds: { ...component.bounds },
      opaquePixelCount: component.pixelCount,
    })).sort((left, right) => left.geometryKey.localeCompare(right.geometryKey))
    return {
      stableId: entry.stableId,
      region: entry.homeRegion,
      homeRegion: entry.homeRegion,
      chunkId: entry.homeRegion,
      semanticType: entry.semanticType,
      observableDescription: entry.observableDescription,
      sourceRect,
      destinationRect: { ...sourceRect },
      destinationMapping: {
        mode: 'source-coordinate-identity',
        scaleNumerator: 1,
        scaleDenominator: 1,
        sampling: 'none',
      },
      pixelOwnershipRule: {
        model: 'alpha-rle-v1',
        runEncoding: '[y,xStartInclusive,xEndExclusive]',
        coordinateSpace: 'canonical-source-pixels',
        threshold: ALPHA_THRESHOLD,
        e9bAction: 'copy RGBA only for ownershipRuns; clear every other sourceRect pixel to transparent',
      },
      ownershipRuns,
      ownedOpaquePixelCount: runPixelCount(ownershipRuns),
      semanticOwnership: {
        componentConnectivity: COMPONENT_CONNECTIVITY,
        componentGroupPolicy: structuredClone(entry.componentGroupPolicy),
        canonicalComponentIds,
        canonicalComponents,
      },
      outputFileHint: `public/juyiting/images/occluders/${entry.homeRegion}-v2.webp`,
      outputEncoding: {
        allowed: ['lossless-webp', 'png'],
        losslessRequired: true,
        alphaRequired: true,
        colorTransform: 'forbidden',
      },
    }
  }).sort((a, b) => Buffer.from(a.stableId).compare(Buffer.from(b.stableId)))

  const regionFragmentCounts = Object.fromEntries(REGION_ORDER.map(region => [
    region,
    fragments.filter(fragment => fragment.homeRegion === region).length,
  ]))

  const spec = {
    $schema: 'jyt.occlusion.fragment-ownership-spec.v2',
    schemaVersion: 2,
    taskId: 'E9A',
    baseCommit: BASE_COMMIT,
    supersedesRejectedCommit: E9A_REJECTED_COMMIT,
    sceneId: 'juyiting-main',
    sourceProvenance: {
      assetRef: 'jyt.occlusion-source.hall-v3',
      path: CANONICAL_PATH,
      sha256: CANONICAL_EXPECTED_SHA256,
      width: decoded.width,
      height: decoded.height,
      alphaThreshold: ALPHA_THRESHOLD,
      totalOpaquePixels: decoded.totalOpaquePixels,
      globalAlphaBounds: decoded.globalAlphaBounds,
      canonicalComponentConnectivity: COMPONENT_CONNECTIVITY,
      canonicalComponentCount: decoded.components.length,
    },
    inputProvenance: {
      tmxAnchor: {
        taskId: 'E8B',
        path: 'public/juyiting/hall.tmx',
        sha256: E8B_TMX_SHA256,
      },
      immutableAcceptedArtifacts: ['E1', 'E8A', 'E8B'],
    },
    regionPartition: {
      semantics: 'atlas-home-region-only-not-a-pixel-clip-boundary',
      description: 'Six non-overlapping half-open map/chunk regions cover [0,1664)×[0,928). A fragment has one homeRegion/chunkId, but sourceRect and ownershipRuns may cross region guides. Region guides MUST NOT clip alpha-connected ownership.',
      regions: Object.fromEntries(REGION_ORDER.map(name => {
        const def = REGION_DEFS[name]
        return [name, {
          xRange: [def.xMin, def.xMax],
          yRange: [def.yMin, def.yMax],
          width: def.xMax - def.xMin,
          height: def.yMax - def.yMin,
          chunkId: name,
        }]
      })),
    },
    visualStructureExplanation: {
      'west-upper': 'Northwest lanterns, railing, carved pillar, wall panel and braces. The large west wall-panel owner crosses y=580 intact.',
      'west-lower': 'Southwest wall-panel assembly, two independent illuminated lanterns, long-table frame, lower railings and one narrow brace. Every owner is one 8-connected component.',
      center: 'Sparse north-center area containing one visible wall sconce at (1112,230,18×54); it is explicitly not a pillar.',
      entrance: 'South-center entrance lantern posts and two hanging red banners.',
      'east-upper': 'Northeast scroll-table front, upper/lower wall panels, carved pillars and narrow brace. The pillar at (1202,478,50×225) crosses y=580 intact.',
      'east-lower': 'Southeast diagonal work support, worktable, fabric rack, railing post and low lantern. The diagonal support and worktable spanning y=580 remain single semantic owners.',
    },
    outputConstraints: {
      formats: ['lossless-webp', 'png'],
      losslessOnly: true,
      alphaRequired: true,
      paddingPixels,
      paddingPolicy: 'sourceRect may overlap and include transparent or non-owner pixels; E9B clears every pixel not listed in ownershipRuns',
      reconstructionRequirement: 'copy owned canonical RGBA at identical destination coordinates; no scaling, resampling, color conversion, or duplicate composition',
      pixelOwnershipModel: 'alpha-rle-v1',
      includePolicy: 'every canonical pixel with alpha >= 1 is listed in exactly one ownershipRuns entry',
      excludePolicy: 'ownershipRuns must never contain canonical pixels with alpha < 1',
      opaqueNeighborPolicy: 'different owners must never meet across a 4-neighbor opaque edge',
      opaqueCutEdgeExceptions: [],
      semanticPurityPolicy: 'one canonical 8-connected component per owner unless semanticOwnership.componentGroupPolicy.mode is approved-same-observable-object-parts and its approvedParts exactly list every reviewed component identity for one observable object',
      sourceRectOverlapPolicy: 'allowed-because-runs-are-authoritative',
      fragmentCount: fragments.length,
      regionFragmentCounts,
    },
    downstreamRequirements: {
      E9B: {
        taskId: 'E9B',
        mechanicalOnly: true,
        rgbaExactReconstructionRequired: true,
        zoomSeamEvidence: {
          requiredZooms: ['0.75', '1', '1.25', '1.5', '2'],
          requiredFocus: ['y=580 west wall crossing', 'y=580 east pillar crossing', 'y=580 east diagonal crossing', 'y=580 east worktable crossing'],
        },
      },
      E10A: {
        taskId: 'E10A',
        dependency: '37 legacy masks must be mapped to these accepted fragment stableIds before TMX/runtime migration',
        expectedLegacyMaskCount: 37,
      },
    },
    fragments,
    generation: {
      generatedBy: 'scripts/juyiting/generate-fragment-ownership-spec.mjs',
      sourceEpoch: BASE_COMMIT_EPOCH,
      deterministicInputs: {
        canonicalSha256: CANONICAL_EXPECTED_SHA256,
        e8bTmxSha256: E8B_TMX_SHA256,
        alphaThreshold: ALPHA_THRESHOLD,
        componentConnectivity: COMPONENT_CONNECTIVITY,
        semanticCatalogStableIds: SEMANTIC_OWNER_CATALOG.map(entry => entry.stableId).sort(),
      },
      stableIdBasis: 'explicit-semantic-catalog-keyed-by-canonical-component-geometry-not-declaration-order',
    },
  }
  spec.generationId = computeGenerationId(spec)
  spec.generation.generationId = spec.generationId
  return spec
}

export function createAlphaMap(decoded) {
  const alpha = new Uint8Array(decoded.width * decoded.height)
  for (const component of decoded.components) {
    for (const [y, xStart, xEnd] of component.runs) {
      for (let x = xStart; x < xEnd; x++) alpha[y * decoded.width + x] = 1
    }
  }
  return alpha
}

export function analyzeOwnership(spec, decoded) {
  const width = decoded.width, height = decoded.height
  const alpha = createAlphaMap(decoded)
  const owner = new Int32Array(width * height)
  owner.fill(-1)
  const overlapSamples = []
  const transparentOwnedSamples = []
  const unownedSamples = []
  let overlapPixels = 0
  let transparentOwned = 0

  for (let fragmentIndex = 0; fragmentIndex < spec.fragments.length; fragmentIndex++) {
    const fragment = spec.fragments[fragmentIndex]
    for (const run of fragment.ownershipRuns ?? []) {
      const [y, xStart, xEnd] = run
      if (!Number.isInteger(y) || !Number.isInteger(xStart) || !Number.isInteger(xEnd)) continue
      if (y < 0 || y >= height || xStart < 0 || xEnd > width || xStart >= xEnd) continue
      for (let x = xStart; x < xEnd; x++) {
        const index = y * width + x
        if (!alpha[index]) {
          transparentOwned++
          if (transparentOwnedSamples.length < 20) transparentOwnedSamples.push({ x, y, owner: fragment.stableId })
        }
        if (owner[index] !== -1 && owner[index] !== fragmentIndex) {
          overlapPixels++
          if (overlapSamples.length < 20) overlapSamples.push({
            x, y,
            owner1: spec.fragments[owner[index]]?.stableId ?? '<invalid>',
            owner2: fragment.stableId,
          })
        } else {
          owner[index] = fragmentIndex
        }
      }
    }
  }

  let opaqueOwned = 0
  let opaqueUnowned = 0
  const perRegion = Object.fromEntries(REGION_ORDER.map(region => [region, { opaqueOwned: 0, fragmentCount: 0 }]))
  for (const fragment of spec.fragments) {
    if (perRegion[fragment.homeRegion]) perRegion[fragment.homeRegion].fragmentCount++
  }
  for (let index = 0; index < alpha.length; index++) {
    if (!alpha[index]) continue
    if (owner[index] === -1) {
      opaqueUnowned++
      if (unownedSamples.length < 20) unownedSamples.push({ x: index % width, y: Math.floor(index / width) })
    } else {
      opaqueOwned++
      const region = spec.fragments[owner[index]]?.homeRegion
      if (perRegion[region]) perRegion[region].opaqueOwned++
    }
  }

  let opaqueCutEdgeCount = 0
  const opaqueCutEdgeSamples = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      if (!alpha[index]) continue
      for (const [nx, ny] of [[x + 1, y], [x, y + 1]]) {
        if (nx >= width || ny >= height) continue
        const neighborIndex = ny * width + nx
        if (!alpha[neighborIndex]) continue
        const leftOwner = owner[index]
        const rightOwner = owner[neighborIndex]
        if (leftOwner >= 0 && rightOwner >= 0 && leftOwner !== rightOwner) {
          opaqueCutEdgeCount++
          if (opaqueCutEdgeSamples.length < 20) opaqueCutEdgeSamples.push({
            a: { x, y, owner: spec.fragments[leftOwner].stableId },
            b: { x: nx, y: ny, owner: spec.fragments[rightOwner].stableId },
          })
        }
      }
    }
  }

  return {
    passed: opaqueUnowned === 0 && overlapPixels === 0 && transparentOwned === 0 && opaqueCutEdgeCount === 0,
    totalOpaquePixels: decoded.totalOpaquePixels,
    opaqueOwned,
    opaqueUnowned,
    overlapPixels,
    transparentOwned,
    opaqueCutEdgeCount,
    perRegion,
    unownedSamples,
    overlapSamples,
    transparentOwnedSamples,
    opaqueCutEdgeSamples,
    ownerMap: owner,
    alphaMap: alpha,
  }
}

export function buildOwnershipReport(spec, decoded, analysis = analyzeOwnership(spec, decoded)) {
  return {
    $schema: 'jyt.occlusion.ownership-report.v2',
    schemaVersion: 2,
    taskId: 'E9A',
    generationId: spec.generationId,
    generatedFromSourceEpoch: BASE_COMMIT_EPOCH,
    source: {
      assetRef: spec.sourceProvenance.assetRef,
      sha256: spec.sourceProvenance.sha256,
      width: spec.sourceProvenance.width,
      height: spec.sourceProvenance.height,
      alphaThreshold: spec.sourceProvenance.alphaThreshold,
      canonicalComponentConnectivity: spec.sourceProvenance.canonicalComponentConnectivity,
      canonicalComponentCount: spec.sourceProvenance.canonicalComponentCount,
    },
    ownershipResult: {
      passed: analysis.passed,
      totalOpaquePixels: analysis.totalOpaquePixels,
      opaqueOwned: analysis.opaqueOwned,
      opaqueUnowned: analysis.opaqueUnowned,
      overlapPixels: analysis.overlapPixels,
      transparentOwned: analysis.transparentOwned,
      opaqueCutEdgeCount: analysis.opaqueCutEdgeCount,
    },
    semanticResult: {
      fragmentCount: spec.fragments.length,
      singleComponentOwners: spec.fragments.filter(fragment => fragment.semanticOwnership.componentGroupPolicy.mode === 'single-component').length,
      approvedSameObservableObjectGroupOwners: spec.fragments.filter(fragment => fragment.semanticOwnership.componentGroupPolicy.mode === 'approved-same-observable-object-parts').length,
      genericSemanticLabels: spec.fragments.filter(fragment => ['structure', 'detail', 'element'].includes(fragment.semanticType)).map(fragment => fragment.stableId),
    },
    regionFragmentCounts: spec.outputConstraints.regionFragmentCounts,
    perRegion: analysis.perRegion,
    samples: {
      unowned: analysis.unownedSamples,
      overlap: analysis.overlapSamples,
      transparentOwned: analysis.transparentOwnedSamples,
      opaqueCutEdges: analysis.opaqueCutEdgeSamples,
    },
    policy: {
      ownershipModel: spec.outputConstraints.pixelOwnershipModel,
      includePolicy: spec.outputConstraints.includePolicy,
      excludePolicy: spec.outputConstraints.excludePolicy,
      opaqueNeighborPolicy: spec.outputConstraints.opaqueNeighborPolicy,
      opaqueCutEdgeExceptions: spec.outputConstraints.opaqueCutEdgeExceptions,
      note: 'sourceRects may overlap and contain transparent/non-owner pixels; only sorted ownershipRuns confer ownership.',
    },
  }
}

export function pointRegion(x, y) {
  for (const name of REGION_ORDER) {
    const def = REGION_DEFS[name]
    if (x >= def.xMin && x < def.xMax && y >= def.yMin && y < def.yMax) return name
  }
  return null
}
