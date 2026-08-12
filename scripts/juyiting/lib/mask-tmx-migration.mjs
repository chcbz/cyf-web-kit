/**
 * E10B: mechanical migration of 37 legacy mask audit bindings and 32 canonical
 * occluder fragments. Frozen sources: accepted E10A ledger, E9A ownership spec,
 * and E9B atlas manifest. No visual semantics are inferred here.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseTmxStructure, resolveWorldPolygon, polygonAabb } from './tmx-structure.mjs'
import { atomicWriteUtf8Batch } from './atomic-write.mjs'

export const E10A_TMX_SHA256 = '291a38cc66ebd60c8577500a5afc18ce5398570fe4c35ca66d9eebe818826a97'
export const E10A_GENERATION_ID = 'fc855f90cbfc13c5ad8b24659825bc1dccaa03ec17866735fd923452dbdc7611'
export const E10A_LEDGER_CONTENT_SHA256 = '89d96b39e74e63edb620da5d595a0c010546c81d2a9447433c137c7bcb8b2d4f'
export const E10A_LEDGER_WHOLE_SHA256 = '700b2ac6d27ceb58ce5fe0dd92b3f0dc7012a6ecafd03f7c23a9d3a3c42704b1'
export const E9A_GENERATION_ID = '7f8bbdd8f3ca49952d0bcfceadf60a50ad998fc7033e370cbef665ee331f3d3b'
export const E9A_SPEC_SHA256 = '1d1c8dbbc9f32c414f2eea76835e0c39b45587708ec67923c52639613da3ffe6'
export const E9B_MANIFEST_ID = 'ebcbae2a7697594238909a17eb7ecb357021f6faa0d2bdd109186202896d2646'
export const E9B_MANIFEST_SHA256 = '69d6db199f182d092702286b32544ea064f4142c4752cdd3acb1bbf2cef6682f'
export const MASK_ID_MIN = 48
export const MASK_ID_MAX = 84
export const MASK_ID_COUNT = 37
export const FRAGMENT_COUNT = 32
export const FRAGMENT_GROUP_ID = 25
export const FRAGMENT_OBJECT_ID_MIN = 207
export const PROBE_NAMES = ['behind', 'boundary', 'front']
export const MASK_TMX_PROPERTY_ORDER = [
  'stableId', 'ledgerOccluderStableId', 'sceneId', 'floorId', 'chunkId', 'kind', 'renderBand',
  'elevation', 'sortMode', 'ledgerSortContract', 'sortAnchorX', 'sortAnchorY',
  'fixedPointY', 'tieBias', 'targetFragmentId', 'migrationTaskId',
  'migrationGenerationId', 'probeCount',
]
export const FRAGMENT_TMX_PROPERTY_ORDER = [
  'stableId', 'sceneId', 'chunkId', 'floorId', 'kind', 'elevation',
  'renderBand', 'sortMode', 'sortAnchorX', 'sortAnchorY', 'fixedPointY',
  'tieBias', 'assetRef', 'sourceRectX', 'sourceRectY', 'sourceRectW',
  'sourceRectH', 'e9aSpecGenerationId', 'e9aSourceRectX', 'e9aSourceRectY',
  'e9aSourceRectW', 'e9aSourceRectH', 'e9bManifestId', 'e9bAtlasRectX',
  'e9bAtlasRectY', 'e9bAtlasRectW', 'e9bAtlasRectH', 'e9bExtrusionPixels',
  'e9bPixelBoundsX', 'e9bPixelBoundsY', 'e9bPixelBoundsW', 'e9bPixelBoundsH',
]

export function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
export function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
export function stableJsonNoNewline(value) { return JSON.stringify(value, null, 2) }
export function maskIdRange(id) { return Number.isInteger(id) && id >= MASK_ID_MIN && id <= MASK_ID_MAX }

export function maskPropertyBinding(entry) {
  return {
    stableId: `jyt.mask-binding.mask-${entry.legacyTmxId}.v1`,
    ledgerOccluderStableId: entry.futureOccluderStableId,
    sceneId: entry.sceneId,
    floorId: entry.floorId,
    chunkId: entry.chunkId,
    kind: 'legacy-mask-binding',
    renderBand: entry.renderBand,
    elevation: entry.elevation,
    sortMode: 'fixed',
    ledgerSortContract: entry.sortMode,
    sortAnchorX: entry.sortAnchor.x,
    sortAnchorY: entry.sortAnchor.y,
    fixedPointY: entry.fixedPointY,
    tieBias: entry.tieBias,
    targetFragmentId: entry.targetFragmentStableId,
    migrationTaskId: 'E10B',
    migrationGenerationId: E10A_GENERATION_ID,
    probeCount: PROBE_NAMES.length,
  }
}

export function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function propertyType(name) {
  if (['elevation', 'fixedPointY', 'tieBias', 'probeCount', 'sourceRectX', 'sourceRectY', 'sourceRectW', 'sourceRectH',
    'e9aSourceRectX', 'e9aSourceRectY', 'e9aSourceRectW', 'e9aSourceRectH', 'e9bAtlasRectX', 'e9bAtlasRectY',
    'e9bAtlasRectW', 'e9bAtlasRectH', 'e9bExtrusionPixels', 'e9bPixelBoundsX', 'e9bPixelBoundsY',
    'e9bPixelBoundsW', 'e9bPixelBoundsH'].includes(name)) return 'int'
  if (['sortAnchorX', 'sortAnchorY'].includes(name)) return 'float'
  return ''
}

function serializeProperties(binding, propertyOrder, indent = '   ') {
  const lines = [`${indent}<properties>`]
  for (const name of propertyOrder) {
    const type = propertyType(name)
    lines.push(`${indent} <property name="${name}"${type ? ` type="${type}"` : ''} value="${escapeXml(binding[name])}"/>`)
  }
  lines.push(`${indent}</properties>`)
  return lines.join('\n')
}

export function serializeMaskProperties(binding) {
  return serializeProperties(binding, MASK_TMX_PROPERTY_ORDER, '   ')
}

export function readLedger(ledgerPath) {
  const bytes = readFileSync(ledgerPath)
  const wholeSha = sha256(bytes)
  if (wholeSha !== E10A_LEDGER_WHOLE_SHA256) throw new Error(`E10A ledger whole-file sha256 drift: ${wholeSha}`)
  const ledger = JSON.parse(bytes)
  if (ledger.$schema !== 'juyiting-occlusion-v2-mask-migration-ledger-v2') throw new Error(`E10A ledger schema mismatch: ${ledger.$schema}`)
  if (ledger.generationId !== E10A_GENERATION_ID) throw new Error(`E10A ledger generationId drift: ${ledger.generationId}`)
  const contentSha = sha256(Buffer.from(stableJsonNoNewline({ ...ledger, contentSha256: '' }), 'utf8'))
  if (contentSha !== ledger.contentSha256 || contentSha !== E10A_LEDGER_CONTENT_SHA256) {
    throw new Error(`E10A ledger independently derived contentSha256 drift: ${contentSha}`)
  }
  if (ledger.provenance?.tmxSha256 !== E10A_TMX_SHA256 || ledger.provenance?.inputHashes?.tmx?.sha256 !== E10A_TMX_SHA256) throw new Error('E10A ledger input TMX provenance drift')
  if (ledger.entries?.length !== MASK_ID_COUNT) throw new Error(`E10A ledger entry count drift: ${ledger.entries?.length}`)
  return ledger
}

export function readFragmentInputs(e9aPath, e9bPath) {
  const e9aBytes = readFileSync(e9aPath)
  const e9bBytes = readFileSync(e9bPath)
  const e9aSha = sha256(e9aBytes)
  const e9bSha = sha256(e9bBytes)
  if (e9aSha !== E9A_SPEC_SHA256) throw new Error(`E9A spec whole-file sha256 drift: ${e9aSha}`)
  if (e9bSha !== E9B_MANIFEST_SHA256) throw new Error(`E9B manifest whole-file sha256 drift: ${e9bSha}`)
  const e9a = JSON.parse(e9aBytes)
  const e9b = JSON.parse(e9bBytes)
  if (e9a.generationId !== E9A_GENERATION_ID || e9b.e9aGenerationId !== E9A_GENERATION_ID) throw new Error('E9A generationId cross-binding drift')
  if (e9b.manifestId !== E9B_MANIFEST_ID) throw new Error(`E9B manifestId drift: ${e9b.manifestId}`)
  if (e9a.fragments?.length !== FRAGMENT_COUNT || e9b.fragments?.length !== FRAGMENT_COUNT) throw new Error('E9A/E9B fragment count drift')
  return { e9a, e9b, e9aSha, e9bSha }
}

function fragmentAnchorsFromLedger(ledger) {
  const anchors = new Map()
  for (const entry of ledger.entries) {
    const value = { sortAnchor: entry.sortAnchor, fixedPointY: entry.fixedPointY, tieBias: entry.tieBias }
    const existing = anchors.get(entry.targetFragmentStableId)
    if (existing && stableJsonNoNewline(existing) !== stableJsonNoNewline(value)) throw new Error(`E10A duplicate target anchor drift: ${entry.targetFragmentStableId}`)
    anchors.set(entry.targetFragmentStableId, value)
  }
  if (anchors.size !== FRAGMENT_COUNT) throw new Error(`E10A target fragment coverage drift: ${anchors.size}/${FRAGMENT_COUNT}`)
  return anchors
}

function tmxAssetRef(atlasFile) {
  const prefix = 'public/juyiting/'
  if (!atlasFile.startsWith(prefix)) throw new Error(`E9B atlasFile outside public/juyiting: ${atlasFile}`)
  return atlasFile.slice(prefix.length)
}

export function buildCanonicalFragments(ledger, e9a, e9b) {
  const e9aById = new Map(e9a.fragments.map(fragment => [fragment.stableId, fragment]))
  const e9bById = new Map(e9b.fragments.map(fragment => [fragment.stableId, fragment]))
  const anchors = fragmentAnchorsFromLedger(ledger)
  const e9aIds = [...e9aById.keys()].sort()
  const e9bIds = [...e9bById.keys()].sort()
  if (stableJsonNoNewline(e9aIds) !== stableJsonNoNewline(e9bIds)) throw new Error('E9A/E9B stableId set drift')
  if (stableJsonNoNewline(e9aIds) !== stableJsonNoNewline([...anchors.keys()].sort())) throw new Error('E10A target set does not cover all E9A fragments')

  return e9aIds.map((stableId, index) => {
    const spec = e9aById.get(stableId)
    const atlas = e9bById.get(stableId)
    const anchor = anchors.get(stableId)
    const extrusion = atlas.extrusionPixels
    const sourceRect = { x: atlas.atlasRect.x + extrusion, y: atlas.atlasRect.y + extrusion, width: atlas.pixelBounds.width, height: atlas.pixelBounds.height }
    const destinationRect = { ...atlas.pixelBounds }
    if (atlas.pixelBounds.width <= 0 || atlas.pixelBounds.height <= 0) throw new Error(`${stableId}: invalid E9B pixelBounds`)
    if (sourceRect.x < atlas.atlasRect.x || sourceRect.y < atlas.atlasRect.y || sourceRect.x + sourceRect.width > atlas.atlasRect.x + atlas.atlasRect.width || sourceRect.y + sourceRect.height > atlas.atlasRect.y + atlas.atlasRect.height) throw new Error(`${stableId}: canonical sourceRect outside E9B atlasRect`)
    if (stableJsonNoNewline(spec.sourceRect) !== stableJsonNoNewline(atlas.sourceRect) || stableJsonNoNewline(spec.destinationRect) !== stableJsonNoNewline(atlas.destinationRect) || spec.chunkId !== atlas.homeRegion || spec.ownedOpaquePixelCount !== atlas.ownedOpaquePixelCount) throw new Error(`${stableId}: E9A/E9B provenance cross-validation drift`)
    const binding = {
      stableId, sceneId: ledger.entries[0].sceneId, chunkId: spec.chunkId, floorId: ledger.entries[0].floorId,
      kind: 'occluder-fragment', elevation: 0, renderBand: 'world', sortMode: 'fixed', sortAnchorX: anchor.sortAnchor.x,
      sortAnchorY: anchor.sortAnchor.y, fixedPointY: anchor.fixedPointY, tieBias: anchor.tieBias, assetRef: tmxAssetRef(atlas.atlasFile),
      sourceRectX: sourceRect.x, sourceRectY: sourceRect.y, sourceRectW: sourceRect.width, sourceRectH: sourceRect.height,
      e9aSpecGenerationId: E9A_GENERATION_ID, e9aSourceRectX: spec.sourceRect.x, e9aSourceRectY: spec.sourceRect.y,
      e9aSourceRectW: spec.sourceRect.width, e9aSourceRectH: spec.sourceRect.height, e9bManifestId: E9B_MANIFEST_ID,
      e9bAtlasRectX: atlas.atlasRect.x, e9bAtlasRectY: atlas.atlasRect.y, e9bAtlasRectW: atlas.atlasRect.width,
      e9bAtlasRectH: atlas.atlasRect.height, e9bExtrusionPixels: extrusion, e9bPixelBoundsX: atlas.pixelBounds.x,
      e9bPixelBoundsY: atlas.pixelBounds.y, e9bPixelBoundsW: atlas.pixelBounds.width, e9bPixelBoundsH: atlas.pixelBounds.height,
    }
    return { tmxId: FRAGMENT_OBJECT_ID_MIN + index, ...binding, sortAnchor: anchor.sortAnchor, sourceRect, destinationRect,
      e9a: { region: spec.region, homeRegion: spec.homeRegion, semanticType: spec.semanticType, sourceRect: spec.sourceRect, destinationRect: spec.destinationRect, ownedOpaquePixelCount: spec.ownedOpaquePixelCount },
      e9b: { atlasFile: atlas.atlasFile, atlasRect: atlas.atlasRect, pixelBounds: atlas.pixelBounds, extrusionPixels: extrusion, ownedOpaquePixelCount: atlas.ownedOpaquePixelCount, packingOrderIndex: atlas.packingOrderIndex } }
  })
}

function serializeFragmentGroup(fragments) {
  const lines = [` <objectgroup id="${FRAGMENT_GROUP_ID}" name="v2-fragments-occluders">`]
  for (const fragment of fragments) {
    const r = fragment.destinationRect
    lines.push(`  <object id="${fragment.tmxId}" name="fragment-${fragment.tmxId}" type="occluder-fragment" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}">`)
    lines.push(serializeProperties(fragment, FRAGMENT_TMX_PROPERTY_ORDER, '   '))
    lines.push('  </object>')
  }
  lines.push(' </objectgroup>')
  return lines.join('\n')
}

function extractMaskPolygons(groupBody) {
  const polygons = {}
  for (const match of groupBody.matchAll(/<object id="(\d+)"[^>]*>[\s\S]*?<polygon points="([^"]*)"[^>]*\/>/g)) { const id = Number(match[1]); if (maskIdRange(id)) polygons[id] = match[2] }
  return polygons
}
function extractMaskPolygonsAfterMigration(tmx) {
  const structure = parseTmxStructure(tmx); const polygons = {}
  for (const object of structure.groups.mask) polygons[object.id] = object.polygon.map(point => `${point[0]},${point[1]}`).join(' ')
  return polygons
}

export function applyMaskPropertiesToTmx(tmxText, ledger, fragments = []) {
  const entriesByTmxId = new Map(ledger.entries.map(entry => [entry.legacyTmxId, entry]))
  const groupStart = tmxText.indexOf('<objectgroup id="13" name="mask">')
  const groupEnd = tmxText.indexOf('</objectgroup>', groupStart)
  if (groupStart < 0 || groupEnd < 0) throw new Error('mask objectgroup not found in TMX')
  const groupOpen = '<objectgroup id="13" name="mask">'
  const polygonBefore = extractMaskPolygons(tmxText.slice(groupStart + groupOpen.length, groupEnd))
  const seen = new Set()
  const transformed = tmxText.slice(groupStart + groupOpen.length, groupEnd).replace(/(<object id="(\d+)"[^>]*>)([\s\S]*?)(<\/object>)/g, (whole, openTag, rawId, body, closeTag) => {
    const id = Number(rawId); if (!maskIdRange(id)) return whole
    const entry = entriesByTmxId.get(id); if (!entry) throw new Error(`mask ${id}: missing E10A ledger entry`)
    seen.add(id)
    const withoutProperties = body.replace(/\n?\s*<properties>[\s\S]*?<\/properties>/, '')
    return `${openTag}\n${serializeMaskProperties(maskPropertyBinding(entry))}${withoutProperties}${closeTag}`
  })
  for (let id = MASK_ID_MIN; id <= MASK_ID_MAX; id += 1) if (!seen.has(id)) throw new Error(`mask ${id}: missing from TMX`)
  let result = `${tmxText.slice(0, groupStart)}${groupOpen}${transformed}${tmxText.slice(groupEnd)}`
  result = result.replace(/\n <objectgroup id="25" name="v2-fragments-occluders">[\s\S]*?\n <\/objectgroup>/, '')
  if (fragments.length > 0) result = result.replace(/\n<\/map>\s*$/, `\n${serializeFragmentGroup(fragments)}\n</map>\n`)
  const nextObjectId = fragments.length > 0 ? FRAGMENT_OBJECT_ID_MIN + fragments.length : FRAGMENT_OBJECT_ID_MIN
  result = result.replace(/nextlayerid="\d+" nextobjectid="\d+"/, `nextlayerid="26" nextobjectid="${nextObjectId}"`)
  if (stableJsonNoNewline(polygonBefore) !== stableJsonNoNewline(extractMaskPolygonsAfterMigration(result))) throw new Error('mask polygon drift during E10B migration')
  return { tmx: result, polygonBefore, polygonAfter: extractMaskPolygonsAfterMigration(result) }
}

function parseCanonicalFragmentObjects(tmxText) {
  const match = tmxText.match(/<objectgroup id="25" name="v2-fragments-occluders">([\s\S]*?)<\/objectgroup>/)
  if (!match) return []
  const wrapper = `<?xml version="1.0"?><map version="1.10" orientation="orthogonal" width="104" height="58" tilewidth="16" tileheight="16" nextobjectid="239"><objectgroup id="13" name="mask">${match[1]}</objectgroup></map>`
  return parseTmxStructure(wrapper).groups.mask
}

export function buildMaskTmxManifest(tmxText, ledger, e9a, e9b) {
  const currentSha = sha256(Buffer.from(tmxText, 'utf8'))
  const structure = parseTmxStructure(tmxText)
  const maskById = new Map(structure.groups.mask.map(object => [object.id, object]))
  const maskBindings = ledger.entries.map(entry => {
    const object = maskById.get(entry.legacyTmxId); const binding = maskPropertyBinding(entry)
    if (!object) throw new Error(`mask ${entry.legacyTmxId}: missing from TMX`)
    for (const name of MASK_TMX_PROPERTY_ORDER) if (String(object.properties[name]) !== String(binding[name])) throw new Error(`mask ${entry.legacyTmxId}: TMX property ${name} drift`)
    return { tmxId: entry.legacyTmxId, legacyIndex: entry.legacyIndex, legacyTmxName: entry.legacyTmxName, stableId: binding.stableId, ledgerOccluderStableId: binding.ledgerOccluderStableId,
      scope: { sceneId: entry.sceneId, floorId: entry.floorId, chunkId: entry.chunkId }, kind: 'legacy-mask-binding', canonicalDrawable: false,
      renderBand: entry.renderBand, elevation: entry.elevation, sortMode: 'fixed', ledgerSortContract: entry.sortMode, sortAnchor: entry.sortAnchor,
      fixedPointY: entry.fixedPointY, tieBias: entry.tieBias, targetFragmentId: entry.targetFragmentStableId,
      probes: PROBE_NAMES.map(name => ({ name, probeId: entry.probes[name].probeId, footPoint: entry.probes[name].footPoint, fixedPointY: entry.probes[name].fixedPointY, expectedPainterRelation: entry.probes[name].expectedPainterRelation })),
      recalibrationDecision: entry.recalibrationDecision === 'none' ? 'none' : entry.recalibrationDecision.action, constraintDecision: entry.constraintDecision.decision }
  })
  const fragments = buildCanonicalFragments(ledger, e9a, e9b)
  const tmxFragments = parseCanonicalFragmentObjects(tmxText)
  if (tmxFragments.length !== FRAGMENT_COUNT) throw new Error(`TMX canonical fragment count drift: ${tmxFragments.length}`)
  const manifest = {
    $schema: 'jyt.occlusion.mask-fragment-tmx-manifest.v2', schemaVersion: 2, taskId: 'E10B', sceneId: ledger.entries[0].sceneId,
    maskBindingCount: maskBindings.length, canonicalFragmentCount: fragments.length, probeCount: 111, constraintCount: 0, recalibrationCount: 7,
    uniqueBindingStableIdCount: new Set(maskBindings.map(entry => entry.stableId)).size, uniqueLedgerOccluderStableIdCount: new Set(maskBindings.map(entry => entry.ledgerOccluderStableId)).size, anonymousBindingCount: maskBindings.filter(entry => !entry.stableId).length,
    authoritativeTargetFragmentCount: fragments.length, anonymousTargetFragmentCount: fragments.filter(entry => !entry.stableId).length,
    provenance: {
      e10aLedger: { path: 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json', wholeFileSha256: E10A_LEDGER_WHOLE_SHA256, generationId: E10A_GENERATION_ID, contentSha256: E10A_LEDGER_CONTENT_SHA256 },
      e9aSpec: { path: 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json', wholeFileSha256: E9A_SPEC_SHA256, generationId: E9A_GENERATION_ID },
      e9bManifest: { path: 'tests/fixtures/juyiting/occlusion-v2-atlases/atlas-manifest.json', wholeFileSha256: E9B_MANIFEST_SHA256, manifestId: E9B_MANIFEST_ID },
      tmx: { baselineSha256: E10A_TMX_SHA256, currentSha256: currentSha, path: 'public/juyiting/hall.tmx' },
    },
    maskBindings,
    canonicalFragments: fragments.map(fragment => ({ tmxId: fragment.tmxId, stableId: fragment.stableId, sceneId: fragment.sceneId,
      chunkId: fragment.chunkId, floorId: fragment.floorId, kind: fragment.kind, elevation: fragment.elevation, renderBand: fragment.renderBand,
      sortMode: fragment.sortMode, sortAnchor: fragment.sortAnchor, fixedPointY: fragment.fixedPointY, tieBias: fragment.tieBias, assetRef: fragment.assetRef,
      sourceRect: fragment.sourceRect, destinationRect: fragment.destinationRect, e9a: fragment.e9a, e9b: fragment.e9b })), generationId: '',
  }
  manifest.generationId = sha256(Buffer.from(stableJson({ ...manifest, generationId: '' }), 'utf8'))
  return manifest
}

export function buildMaskMigrationSnapshot(manifest, ledger) {
  const ledgerById = new Map(ledger.entries.map(entry => [entry.legacyTmxId, entry]))
  return { $schema: 'jyt.occlusion.mask-fragment-migration-snapshot.v2', schemaVersion: 2, taskId: 'E10B', sceneId: manifest.sceneId,
    width: 1664, height: 928, maskBindingCount: manifest.maskBindingCount, canonicalFragmentCount: manifest.canonicalFragmentCount,
    probeCount: manifest.probeCount, constraintCount: manifest.constraintCount, generationId: manifest.generationId,
    maskBindings: manifest.maskBindings.map(binding => ({ ...binding, polygon: ledgerById.get(binding.tmxId).polygon, aabb: ledgerById.get(binding.tmxId).aabb })),
    canonicalFragments: manifest.canonicalFragments }
}

export function buildMaskMigrationDebugSvg(manifest, ledger, generationId = manifest.generationId) {
  const byTmxId = new Map(ledger.entries.map(entry => [entry.legacyTmxId, entry]))
  const lines = [`<svg xmlns="http://www.w3.org/2000/svg" width="1664" height="928" viewBox="0 0 1664 928" data-generation-id="${generationId}" data-task-id="E10B" role="img">`,
    '  <title>Juyiting E10B: 37 legacy mask bindings to 32 canonical fragments</title>',
    '  <desc>37 audit bindings, 32 E9A/E9B canonical drawable fragments, 111 probes, constraints 0</desc>', '  <rect width="1664" height="928" fill="#17251d"/>']
  for (const fragment of manifest.canonicalFragments) { const r = fragment.destinationRect; lines.push(`  <rect data-fragment-id="${escapeXml(fragment.stableId)}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="#73d2de" fill-opacity=".10" stroke="#73d2de"/>`) }
  for (const binding of manifest.maskBindings) {
    const entry = byTmxId.get(binding.tmxId); const points = entry.polygon.map(point => `${point.x},${point.y}`).join(' ')
    lines.push(`  <polygon data-mask-tmx-id="${binding.tmxId}" data-binding-id="${escapeXml(binding.stableId)}" data-target-fragment-id="${escapeXml(binding.targetFragmentId)}" fill="#ff9f1c" fill-opacity=".14" stroke="#ff9f1c" points="${points}"/>`)
    for (const probe of binding.probes) lines.push(`  <circle data-probe-id="${probe.probeId}" cx="${probe.footPoint.x}" cy="${probe.footPoint.y}" r="3" fill="#ffd166"/>`)
  }
  lines.push('</svg>', ''); return lines.join('\n')
}

export function verifyMaskTmxMigration(tmxText, ledger, options = {}) {
  const errors = []; const fail = message => errors.push(message); const structure = parseTmxStructure(tmxText)
  const masks = structure.groups.mask.slice().sort((a, b) => a.id - b.id)
  if (masks.length !== MASK_ID_COUNT) fail(`expected ${MASK_ID_COUNT} mask objects, got ${masks.length}`)
  for (const object of masks) {
    const entry = ledger.entries.find(candidate => candidate.legacyTmxId === object.id); if (!entry) { fail(`mask ${object.id}: missing ledger entry`); continue }
    const binding = maskPropertyBinding(entry); if (!object.properties.stableId) fail(`mask ${object.id}: anonymous binding`)
    for (const name of MASK_TMX_PROPERTY_ORDER) if (String(object.properties[name]) !== String(binding[name])) fail(`mask ${object.id}: property ${name} drift (${object.properties[name]} != ${binding[name]})`)
    if ('chunk-id' in object.properties) fail(`mask ${object.id}: forbidden non-canonical chunk-id property`)
    if (object.properties.kind !== 'legacy-mask-binding') fail(`mask ${object.id}: binding kind must be legacy-mask-binding`)
    if (object.properties.sortMode !== 'fixed' || object.properties.ledgerSortContract !== 'fixed-point-y') fail(`mask ${object.id}: sort contract drift`)
    const world = resolveWorldPolygon(object)
    if (stableJsonNoNewline(world) !== stableJsonNoNewline(entry.polygon)) fail(`mask ${object.id}: polygon drift from E10A ledger`)
    if (stableJsonNoNewline(polygonAabb(world)) !== stableJsonNoNewline(entry.aabb)) fail(`mask ${object.id}: AABB drift from E10A ledger`)
  }
  const fragments = parseCanonicalFragmentObjects(tmxText)
  if (fragments.length !== FRAGMENT_COUNT) fail(`expected ${FRAGMENT_COUNT} canonical fragment objects, got ${fragments.length}`)
  const ids = fragments.map(fragment => fragment.properties.stableId)
  if (new Set(ids).size !== FRAGMENT_COUNT) fail('canonical fragment stableId duplicate/anonymous')
  const expectedFragments = options.e9a && options.e9b ? buildCanonicalFragments(ledger, options.e9a, options.e9b) : null
  const expectedById = expectedFragments ? new Map(expectedFragments.map(fragment => [fragment.tmxId, fragment])) : null
  for (const fragment of fragments) {
    if (fragment.type !== 'occluder-fragment' || fragment.properties.kind !== 'occluder-fragment') fail(`fragment ${fragment.id}: canonical kind/type drift`)
    if (fragment.properties.sortMode !== 'fixed') fail(`fragment ${fragment.id}: canonical sortMode must be fixed`)
    if ('chunk-id' in fragment.properties || fragment.properties.ledgerSortContract === 'fixed-point-y') fail(`fragment ${fragment.id}: forbidden migration-only schema property`)
    const expected = expectedById?.get(fragment.id)
    if (expected) {
      const expectedProps = Object.fromEntries(FRAGMENT_TMX_PROPERTY_ORDER.map(name => [name, expected[name]]))
      for (const [name, value] of Object.entries(expectedProps)) {
        if (String(fragment.properties[name]) !== String(value)) fail(`fragment ${fragment.id}: property ${name} drift (${fragment.properties[name]} != ${value})`)
      }
      if (fragment.x !== expected.destinationRect.x || fragment.y !== expected.destinationRect.y || fragment.width !== expected.destinationRect.width || fragment.height !== expected.destinationRect.height) fail(`fragment ${fragment.id}: destinationRect drift`)
    }
  }
  const probeTotal = ledger.entries.reduce((sum, entry) => sum + PROBE_NAMES.filter(name => entry.probes?.[name]).length, 0)
  if (probeTotal !== 111) fail(`expected 111 traceable probes, got ${probeTotal}`)
  if (ledger.summary?.constraintCount !== 0) fail('ledger summary constraintCount must be 0')
  if (options.manifest) {
    const manifest = options.manifest
    if (manifest.maskBindingCount !== 37 || manifest.uniqueBindingStableIdCount !== 37 || manifest.uniqueLedgerOccluderStableIdCount !== 32 || manifest.canonicalFragmentCount !== 32 || manifest.probeCount !== 111 || manifest.constraintCount !== 0) fail('manifest counts drift')
    if (manifest.anonymousBindingCount !== 0 || manifest.anonymousTargetFragmentCount !== 0) fail('manifest anonymity metric drift')
    if (manifest.provenance?.tmx?.currentSha256 !== sha256(Buffer.from(tmxText, 'utf8'))) fail('manifest current TMX provenance drift')
  }
  return { ok: errors.length === 0, errors, maskBindingCount: masks.length, canonicalFragmentCount: fragments.length }
}

export async function verifyNavigationGeometry(tmxText, inventoryPath) {
  const { buildInventory } = await import('../inventory-juyiting-map.mjs'); const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
  const live = buildInventory(tmxText, { baselineCommit: inventory.baselineCommit })
  return { ok: stableJsonNoNewline(live.collision) === stableJsonNoNewline(inventory.collision) && stableJsonNoNewline(live.navObstacles) === stableJsonNoNewline(inventory.navObstacles), collisionCount: live.collision.length, navObstacleCount: live.navObstacles.length }
}

export function repoRoot() { return resolve(fileURLToPath(new URL('../../..', import.meta.url))) }
export { atomicWriteUtf8Batch }
