#!/usr/bin/env node
/**
 * E13 · 37 mask→structure mapping evidence generator.
 *
 * Produces a machine-verifiable manifest and a self-contained SVG evidence
 * sheet that bind every legacy TMX occlusion mask (48..84, 37/37, no
 * duplicates) to its E9A target fragment, owner boundary and structure name.
 *
 * Inputs (read-only, reused, never rewritten):
 *   - tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json   (E10A)
 *   - tests/fixtures/juyiting/occlusion-v2-masks/mask-tmx-manifest.json  (E10B)
 *   - tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json (E9A)
 *   - scripts/juyiting/render-mask-contact-sheet.mjs logic (card/crop/owner-path)
 *   - public/juyiting/hall.tmx (hash-locked to the current TMX SHA)
 *
 * Outputs (only within the allowed fixture dir):
 *   - tests/fixtures/juyiting/occlusion-e13/mask-structure-mapping/mask-structure-mapping.json
 *   - tests/fixtures/juyiting/occlusion-e13/mask-structure-mapping/mask-structure-mapping.svg
 *
 * Fails closed on any coverage, duplicate, binding, provenance or SHA drift.
 * Never touches production code, existing E13 scripts, world-model or the
 * offline renderer.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ownerPath, xmlEscape, sha256, stableJson } from '../lib/mask-migration-evidence.mjs'
import { atomicWriteUtf8 } from '../lib/atomic-write.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..', '..')

const CURRENT_TMX_SHA256 = '885471a17ac080d4d766f3e86c69836bcac8ba66b9cab125a6ca3ac978d82d9f'
const OUT_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-e13', 'mask-structure-mapping')
const MANIFEST_PATH = join(OUT_DIR, 'mask-structure-mapping.json')
const SVG_PATH = join(OUT_DIR, 'mask-structure-mapping.svg')

const PATHS = {
  ledger: 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json',
  manifest: 'tests/fixtures/juyiting/occlusion-v2-masks/mask-tmx-manifest.json',
  fragSpec: 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json',
  tmx: 'public/juyiting/hall.tmx',
  canonical: 'public/juyiting/images/liangshan-hall-mid-occluders-v3.webp',
  base: 'public/juyiting/images/liangshan-hall-base-clean-v3.webp',
}

const read = (p) => readFileSync(join(REPO_ROOT, p))
const readJson = (p) => JSON.parse(read(p).toString('utf8'))

function runsAabb(runs) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [y, x0, x1] of runs) {
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (x0 < minX) minX = x0
    if (x1 - 1 > maxX) maxX = x1 - 1
  }
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function polygonAabb(polygon) {
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

function polygonPoints(polygon) { return polygon.map((p) => `${p.x},${p.y}`).join(' ') }

function dataUri(mediaType, bytes) { return `data:${mediaType};base64,${bytes.toString('base64')}` }

function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const word of words) {
    if ((cur + ' ' + word).trim().length > maxChars) {
      if (cur) lines.push(cur)
      cur = word
    } else {
      cur = (cur + ' ' + word).trim()
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** Simplified crop around mask polygon + owner sourceRect (render-mask-contact-sheet logic). */
function cropFor(entry, fragment) {
  const px = entry.maskBoundary.polygon.map((p) => p.x), py = entry.maskBoundary.polygon.map((p) => p.y)
  const mb = entry.maskBoundary.aabb
  let minX = Math.min(mb.minX, fragment.sourceRect.x, ...px)
  let minY = Math.min(mb.minY, fragment.sourceRect.y, ...py)
  let maxX = Math.max(mb.maxX, fragment.sourceRect.x + fragment.sourceRect.width, ...px)
  let maxY = Math.max(mb.maxY, fragment.sourceRect.y + fragment.sourceRect.height, ...py)
  minX = Math.max(0, minX - 40); minY = Math.max(0, minY - 40)
  maxX = Math.min(1664, maxX + 40); maxY = Math.min(928, maxY + 40)
  const aspect = 656 / 250, w = maxX - minX, h = maxY - minY
  if (w / h < aspect) {
    const add = (h * aspect - w) / 2
    minX = Math.max(0, minX - add); maxX = Math.min(1664, maxX + add)
  } else {
    const add = (w / aspect - h) / 2
    minY = Math.max(0, minY - add); maxY = Math.min(928, maxY + add)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function buildMaskStructureMapping({ ledger, manifest, fragSpec, tmxBytes, canonicalBytes, baseBytes }) {
  const tmxSha = sha256(tmxBytes)
  if (tmxSha !== CURRENT_TMX_SHA256) {
    throw new Error(`current TMX SHA drift: expected ${CURRENT_TMX_SHA256}, got ${tmxSha}`)
  }
  if (manifest.provenance?.tmx?.currentSha256 !== CURRENT_TMX_SHA256) {
    throw new Error(`mask-tmx-manifest currentSha256 drift: got ${manifest.provenance.tmx.currentSha256}`)
  }

  const fragByStableId = new Map(fragSpec.fragments.map((f) => [f.stableId, f]))
  const bindingByTmxId = new Map(manifest.maskBindings.map((b) => [b.tmxId, b]))

  const entries = ledger.entries.map((e) => {
    const tmxId = e.legacyTmxId
    const binding = bindingByTmxId.get(tmxId)
    if (!binding) throw new Error(`mask ${tmxId} missing from mask-tmx-manifest maskBindings`)
    const fragment = fragByStableId.get(e.targetFragmentStableId)
    if (!fragment) throw new Error(`mask ${tmxId} target fragment ${e.targetFragmentStableId} missing from fragment-ownership-spec`)
    if (binding.targetFragmentId !== e.targetFragmentStableId) {
      throw new Error(`mask ${tmxId} binding target ${binding.targetFragmentId} !== ledger target ${e.targetFragmentStableId}`)
    }
    if (binding.ledgerOccluderStableId !== e.futureOccluderStableId) {
      throw new Error(`mask ${tmxId} binding occluder ${binding.ledgerOccluderStableId} !== ledger ${e.futureOccluderStableId}`)
    }
    if (JSON.stringify(binding.sortAnchor) !== JSON.stringify(e.sortAnchor)) {
      throw new Error(`mask ${tmxId} sortAnchor drift`)
    }
    const runSum = fragment.ownershipRuns.reduce((s, r) => s + (r[2] - r[1]), 0)
    if (runSum !== fragment.ownedOpaquePixelCount) {
      throw new Error(`mask ${tmxId} fragment ${fragment.stableId} run sum ${runSum} !== declared ${fragment.ownedOpaquePixelCount}`)
    }
    const ownerAabb = runsAabb(fragment.ownershipRuns)
    return {
      tmxId,
      legacyIndex: e.legacyIndex,
      legacyTmxName: e.legacyTmxName,
      maskBindingStableId: binding.stableId,
      ledgerOccluderStableId: binding.ledgerOccluderStableId,
      scope: binding.scope,
      targetFragmentStableId: e.targetFragmentStableId,
      structureName: e.targetVisualStructure,
      semanticType: fragment.semanticType,
      homeChunk: e.homeChunk,
      nineGridRegionDeclared: e.nineGridRegionDeclared,
      nineGridRegionGeometric: e.nineGridRegionGeometric,
      nineGridRegionMatch: e.nineGridRegionMatch,
      maskBoundary: {
        polygon: e.polygon,
        vertexCount: e.polygonVertexCount,
        aabb: e.aabb,
        centroid: e.centroid,
      },
      ownerBoundary: {
        representation: 'alpha-ownership-runs (E9A fragment-ownership-spec)',
        sourceRect: fragment.sourceRect,
        aabb: ownerAabb,
        ownedOpaquePixelCount: fragment.ownedOpaquePixelCount,
        runsSha256: sha256(Buffer.from(stableJson(fragment.ownershipRuns), 'utf8')),
      },
      painterBinding: {
        sortMode: e.sortMode,
        sortAnchor: e.sortAnchor,
        fixedPointY: e.fixedPointY,
        tieBias: e.tieBias,
        renderBand: e.renderBand,
        elevation: e.elevation,
      },
      ownerOverlapEvidence: {
        ownedPixelsInLegacyPolygon: e.ownerOverlapEvidence.ownedPixelsInLegacyPolygon,
        targetOwnedOpaquePixelCount: e.ownerOverlapEvidence.targetOwnedOpaquePixelCount,
        actualOwnerCount: e.ownerOverlapEvidence.actualOwners.length,
        polygonToOwnerPixelDistance: e.ownerOverlapEvidence.distanceEvidence.polygonToOwnerPixelDistance,
      },
      targetFragmentDescription: fragment.observableDescription,
    }
  })

  entries.sort((a, b) => a.tmxId - b.tmxId)
  const tmxIds = entries.map((e) => e.tmxId)
  if (entries.length !== 37) throw new Error(`expected 37 entries, got ${entries.length}`)
  if (new Set(tmxIds).size !== 37) throw new Error('duplicate tmxId in mapping entries')
  const expectedRange = Array.from({ length: 37 }, (_, i) => 48 + i)
  if (JSON.stringify(tmxIds) !== JSON.stringify(expectedRange)) {
    throw new Error(`tmxId coverage drift: got [${tmxIds.join(',')}]`)
  }
  const uniqueTargets = new Set(entries.map((e) => e.targetFragmentStableId)).size

  const visualization = renderMappingSheet({ ledger, manifest, fragSpec, entries, fragByStableId, canonicalBytes, baseBytes })

  const provenance = {
    migrationLedger: {
      path: PATHS.ledger,
      wholeFileSha256: sha256(read(PATHS.ledger)),
      contentSha256: ledger.contentSha256,
      generationId: ledger.generationId,
    },
    maskTmxManifest: {
      path: PATHS.manifest,
      wholeFileSha256: sha256(read(PATHS.manifest)),
      generationId: manifest.generationId,
    },
    fragmentOwnershipSpec: {
      path: PATHS.fragSpec,
      wholeFileSha256: sha256(read(PATHS.fragSpec)),
      generationId: fragSpec.generationId,
    },
    tmx: {
      path: PATHS.tmx,
      baselineSha256: manifest.provenance.tmx.baselineSha256,
      currentSha256: CURRENT_TMX_SHA256,
    },
  }

  const manifestDoc = {
    $schema: 'juyiting.occlusion-e13.mask-structure-mapping.v1',
    schemaVersion: 1,
    taskId: 'E13',
    subtask: 'mask-structure-mapping',
    sceneId: 'juyiting-main',
    maskCount: entries.length,
    tmxIdRange: [tmxIds[0], tmxIds[tmxIds.length - 1]],
    uniqueTargetFragmentCount: uniqueTargets,
    currentTmxSha256: CURRENT_TMX_SHA256,
    currentTmxPath: PATHS.tmx,
    visualization: {
      path: 'tests/fixtures/juyiting/occlusion-e13/mask-structure-mapping/mask-structure-mapping.svg',
      sha256: sha256(Buffer.from(visualization, 'utf8')),
    },
    provenance,
    entries,
    generationId: '',
    contentSha256: '',
  }

  const evidenceInputs = {
    tmx: { path: PATHS.tmx, sha256: tmxSha },
    canonical: { path: PATHS.canonical, sha256: sha256(read(PATHS.canonical)) },
    baseHall: { path: PATHS.base, sha256: sha256(read(PATHS.base)) },
    generator: { path: 'scripts/juyiting/e13/generate-mask-structure-mapping.mjs', sha256: sha256(read('scripts/juyiting/e13/generate-mask-structure-mapping.mjs')) },
    evidenceLibrary: { path: 'scripts/juyiting/lib/mask-migration-evidence.mjs', sha256: sha256(read('scripts/juyiting/lib/mask-migration-evidence.mjs')) },
  }

  const generationBasis = { manifest: { ...manifestDoc, generationId: '', contentSha256: '' }, evidenceInputs }
  manifestDoc.generationId = createHash('sha256').update(stableJson(generationBasis)).digest('hex')
  manifestDoc.contentSha256 = createHash('sha256').update(stableJson({ ...manifestDoc, contentSha256: '' })).digest('hex')

  return { manifest: manifestDoc, svg: visualization, manifestText: stableJson(manifestDoc) + '\n' }
}

export function renderMappingSheet({ ledger, manifest, fragSpec, entries, fragByStableId, canonicalBytes, baseBytes }) {
  const colors = ['#00c2ff', '#ff4d6d', '#6ee7b7', '#f59e0b', '#a78bfa', '#f97316', '#22c55e', '#e879f9', '#38bdf8', '#facc15']
  const ownerStableIds = [...new Set(entries.map((e) => e.targetFragmentStableId))].sort()
  const colorByOwner = new Map(ownerStableIds.map((sid, i) => [sid, colors[i % colors.length]]))
  const baseUri = dataUri('image/webp', baseBytes)
  const canonicalUri = dataUri('image/webp', canonicalBytes)

  const margin = 20, cols = 2, gap = 16, cardW = 680, cardH = 470, headerH = 216
  const rows = Math.ceil(entries.length / cols)
  const width = margin * 2 + cols * cardW + gap
  const height = headerH + rows * (cardH + gap) + 40

  let svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-evidence="mask-structure-mapping" data-task-id="E13" data-mask-count="37" data-tmx-id-range="48-84" data-current-tmx-sha256="${CURRENT_TMX_SHA256}">\n`
  svg += `<defs><style>text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;fill:#17202a}.title{font-size:26px;font-weight:700}.section{font-size:18px;font-weight:700}.label{font-size:12px}.small{font-size:11px}.tiny{font-size:9px}.ok{fill:#157347}.card{fill:#fff;stroke:#9aa6b2}.mask{fill:#ff1744;fill-opacity:.14;stroke:#ff1744;stroke-width:2}</style><image id="hall-base" data-evidence="canonical" href="${baseUri}" width="1664" height="928"/><image id="hall-canonical" data-evidence="canonical" href="${canonicalUri}" width="1664" height="928"/>`
  let ownerIndex = 0
  const clipByOwner = new Map()
  for (const sid of ownerStableIds) {
    const fragment = fragByStableId.get(sid)
    const clip = `owner-clip-${ownerIndex++}`
    clipByOwner.set(sid, clip)
    svg += `<clipPath id="${clip}"><path d="${ownerPath(fragment)}"/></clipPath>`
  }
  svg += '</defs>\n'
  svg += `<rect width="${width}" height="${headerH}" fill="#17202a"/><text x="24" y="42" class="title" fill="#fff">E13 · 37 mask → structure mapping · legacy TMX masks 48–84</text>`
  svg += `<text x="24" y="72" class="label" fill="#d5dce3">Each card: legacy mask polygon (red) → E9A target fragment stableId → structure name → exact owner alpha boundary (colored, dashed sourceRect).</text>`
  svg += `<text x="24" y="96" class="small" fill="#f8c471">current TMX sha256 = ${CURRENT_TMX_SHA256} · path=${xmlEscape(PATHS.tmx)}</text>`
  svg += `<text x="24" y="120" class="small" fill="#ccd1d1">maskCount=37 · tmxIdRange=48-84 · uniqueTargetFragments=${ownerStableIds.length}</text>`
  svg += `<text x="24" y="144" class="small" fill="#ccd1d1">ledger=${xmlEscape(ledger.provenance?.tmxSha256 || '')} · maskTmxManifest.currentSha256=${xmlEscape(manifest.provenance?.tmx?.currentSha256 || '')} · fragmentOwnershipSpec=${xmlEscape(fragSpec.generationId || '')}</text>`
  svg += `<text x="24" y="168" class="tiny" fill="#aab2b8">Sources: migration-ledger.json · mask-tmx-manifest.json · fragment-ownership-spec.json (read-only) · render logic reused from scripts/juyiting/render-mask-contact-sheet.mjs · generated by scripts/juyiting/e13/generate-mask-structure-mapping.mjs</text>`

  const cardsY = headerH
  entries.forEach((e, i) => {
    const fragment = fragByStableId.get(e.targetFragmentStableId)
    const color = colorByOwner.get(e.targetFragmentStableId)
    const clip = clipByOwner.get(e.targetFragmentStableId)
    const c = cropFor(e, fragment)
    const x = margin + (i % cols) * (cardW + gap)
    const y = cardsY + Math.floor(i / cols) * (cardH + gap)
    const imageX = x + 12, imageY = y + 128, imageW = 656, imageH = 250
    const nameLines = wrapText(e.structureName, 92).slice(0, 3)
    const aabb = e.ownerBoundary.aabb
    const desc = String(e.targetFragmentDescription || '').length > 66 ? String(e.targetFragmentDescription || '').slice(0, 66) + '…' : String(e.targetFragmentDescription || '')
    svg += `<g class="mask-structure-card" data-mask-tmx-id="${e.tmxId}" data-target-owner="${xmlEscape(e.targetFragmentStableId)}" data-structure-name="${xmlEscape(e.structureName)}" data-home-chunk="${xmlEscape(e.homeChunk)}" data-owner-aabb="${aabb.minX},${aabb.minY},${aabb.maxX},${aabb.maxY}" data-owner-opaque-pixels="${e.ownerBoundary.ownedOpaquePixelCount}">`
    svg += `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="7" class="card"/>`
    svg += `<text x="${x + 14}" y="${y + 26}" class="section">mask ${e.tmxId} · ${xmlEscape(e.homeChunk)}</text>`
    svg += `<text x="${x + 14}" y="${y + 46}" class="small" fill="#1f618d">target fragment: ${xmlEscape(e.targetFragmentStableId)}</text>`
    svg += `<text x="${x + 14}" y="${y + 64}" class="small" font-weight="700">${nameLines.map((line, li) => `<tspan x="${x + 14}" dy="${li === 0 ? 0 : 13}">${xmlEscape(line)}</tspan>`).join('')}</text>`
    svg += `<text x="${x + 14}" y="${y + 112}" class="tiny">owner boundary: src=(${e.ownerBoundary.sourceRect.x},${e.ownerBoundary.sourceRect.y},${e.ownerBoundary.sourceRect.width}x${e.ownerBoundary.sourceRect.height}) · runsAABB=(${aabb.minX},${aabb.minY})-(${aabb.maxX},${aabb.maxY}) · opaque=${e.ownerBoundary.ownedOpaquePixelCount}px</text>`
    svg += `<svg x="${imageX}" y="${imageY}" width="${imageW}" height="${imageH}" viewBox="${c.x} ${c.y} ${c.width} ${c.height}" preserveAspectRatio="xMidYMid meet">`
    svg += `<use href="#hall-base"/><use href="#hall-canonical" clip-path="url(#${clip})" data-evidence="target-owner"/>`
    svg += `<path d="${ownerPath(fragment)}" fill="${color}" fill-opacity=".30" stroke="${color}" stroke-width="1.5" data-evidence="owner-boundary"/>`
    svg += `<rect x="${e.ownerBoundary.sourceRect.x}" y="${e.ownerBoundary.sourceRect.y}" width="${e.ownerBoundary.sourceRect.width}" height="${e.ownerBoundary.sourceRect.height}" fill="none" stroke="#17202a" stroke-width="1.5" stroke-dasharray="6 3" data-evidence="owner-source-rect"/>`
    svg += `<polygon points="${polygonPoints(e.maskBoundary.polygon)}" class="mask" data-evidence="mask-polygon"/>`
    svg += `<g transform="translate(${e.maskBoundary.centroid.x} ${e.maskBoundary.centroid.y})"><circle r="12" fill="#fff" stroke="#ff1744" stroke-width="3"/><text text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="700">${e.tmxId}</text></g>`
    svg += '</svg>'
    svg += `<rect x="${imageX}" y="${imageY}" width="${imageW}" height="${imageH}" fill="none" stroke="#566573"/>`
    svg += `<text x="${x + 14}" y="${y + 396}" class="tiny">mask polygon v=${e.maskBoundary.vertexCount} · aabb=(${e.maskBoundary.aabb.minX},${e.maskBoundary.aabb.minY})-(${e.maskBoundary.aabb.maxX},${e.maskBoundary.aabb.maxY}) · sortAnchor=(${e.painterBinding.sortAnchor.x},${e.painterBinding.sortAnchor.y}) · fixedY=${e.painterBinding.fixedPointY} · tie=${e.painterBinding.tieBias}</text>`
    svg += `<text x="${x + 14}" y="${y + 410}" class="tiny ok">overlap=${e.ownerOverlapEvidence.ownedPixelsInLegacyPolygon}px in mask polygon · owner opaque=${e.ownerOverlapEvidence.targetOwnedOpaquePixelCount}px · owners=${e.ownerOverlapEvidence.actualOwnerCount} · runsSha=${e.ownerBoundary.runsSha256.slice(0, 16)}…</text>`
    svg += `<text x="${x + 14}" y="${y + 424}" class="tiny">nineGrid declared=${xmlEscape(e.nineGridRegionDeclared)} · geometric=${xmlEscape(e.nineGridRegionGeometric)} · match=${e.nineGridRegionMatch} · ${xmlEscape(desc)}</text>`
    svg += '</g>'
  })

  svg += '</svg>\n'
  return svg.split('\n').map((line) => line.replace(/[ \t]+$/, '')).join('\n')
}

async function cli() {
  const ledger = readJson(PATHS.ledger)
  const manifest = readJson(PATHS.manifest)
  const fragSpec = readJson(PATHS.fragSpec)
  const result = buildMaskStructureMapping({
    ledger,
    manifest,
    fragSpec,
    tmxBytes: read(PATHS.tmx),
    canonicalBytes: read(PATHS.canonical),
    baseBytes: read(PATHS.base),
  })
  atomicWriteUtf8(MANIFEST_PATH, result.manifestText, 'E13 mask→structure mapping manifest')
  atomicWriteUtf8(SVG_PATH, result.svg, 'E13 mask→structure mapping SVG')
  console.log(`Generated 37/37 mask→structure mapping entries (masks 48–84, no duplicates); generationId=${result.manifest.generationId}; uniqueTargetFragments=${result.manifest.uniqueTargetFragmentCount}; TMX=${CURRENT_TMX_SHA256}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) cli()
