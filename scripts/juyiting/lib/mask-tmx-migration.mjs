/**
 * E10B: 37-mask TMX/manifest/snapshot/preview mechanical migration.
 *
 * Single source of truth: the accepted E10A migration-ledger.json. This module
 * mechanically derives the E10B binding (TMX mask properties, fragment/occluder
 * manifest, migration snapshot, debug preview) and verifies every artifact
 * against the frozen ledger WITHOUT interpreting visual semantics.
 *
 * Invariants preserved byte-for-byte / semantically:
 *   - mask polygon vertices, sortAnchor, probes, target owner, fragment
 *     ownership, relation and navigation geometry never change;
 *   - constraints stay 0 (none); 111 probes stay traceable;
 *   - no anonymous production occluder (every mask carries a stableId).
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseTmxStructure,
  resolveWorldPolygon,
  polygonAabb,
  sha256Bytes,
} from './tmx-structure.mjs'
import { atomicWriteUtf8Batch } from './atomic-write.mjs'

export const E10A_TMX_SHA256 = '291a38cc66ebd60c8577500a5afc18ce5398570fe4c35ca66d9eebe818826a97'
export const E10A_GENERATION_ID = 'fc855f90cbfc13c5ad8b24659825bc1dccaa03ec17866735fd923452dbdc7611'
export const E10A_LEDGER_CONTENT_SHA256 = '89d96b39e74e63edb620da5d595a0c010546c81d2a9447433c137c7bcb8b2d4f'
export const MASK_ID_MIN = 48
export const MASK_ID_MAX = 84
export const MASK_ID_COUNT = MASK_ID_MAX - MASK_ID_MIN + 1
export const PROBE_NAMES = ['behind', 'boundary', 'front']
export const MASK_TMX_PROPERTY_ORDER = [
  'stableId', 'sceneId', 'floorId', 'chunk-id', 'kind', 'renderBand',
  'elevation', 'sortMode', 'sortAnchorX', 'sortAnchorY', 'tieBias',
  'targetFragmentId', 'migrationTaskId', 'migrationGenerationId', 'probeCount',
]

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function maskIdRange(id) {
  return Number.isInteger(id) && id >= MASK_ID_MIN && id <= MASK_ID_MAX
}

/** Typed mask property values derived verbatim from one E10A ledger entry. */
export function maskPropertyBinding(entry) {
  return {
    stableId: entry.futureOccluderStableId,
    sceneId: entry.sceneId,
    floorId: entry.floorId,
    'chunk-id': entry.chunkId,
    kind: 'occluder',
    renderBand: entry.renderBand,
    elevation: entry.elevation,
    sortMode: entry.sortMode,
    sortAnchorX: entry.sortAnchor.x,
    sortAnchorY: entry.sortAnchor.y,
    tieBias: entry.tieBias,
    targetFragmentId: entry.targetFragmentStableId,
    migrationTaskId: 'E10B',
    migrationGenerationId: E10A_GENERATION_ID,
    probeCount: PROBE_NAMES.length,
  }
}

/** XML-escape a scalar property value. */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Serialize the `<properties>` child block for one mask object (Tiled style). */
export function serializeMaskProperties(binding) {
  const lines = ['   <properties>']
  for (const name of MASK_TMX_PROPERTY_ORDER) {
    const value = binding[name]
    let typeAttribute = ''
    if (name === 'elevation' || name === 'tieBias' || name === 'probeCount') typeAttribute = ' type="int"'
    else if (name === 'sortAnchorX' || name === 'sortAnchorY') typeAttribute = ' type="float"'
    lines.push(`    <property name="${name}"${typeAttribute} value="${escapeXml(value)}"/>`)
  }
  lines.push('   </properties>')
  return lines.join('\n')
}

/**
 * Insert E10B migration `<properties>` into every mask object (ids 48-84).
 * Everything else in the TMX is preserved byte-for-byte. Returns the new XML
 * and a verification record proving the original mask polygons are unchanged.
 */
export function applyMaskPropertiesToTmx(tmxText, ledger) {
  const entriesByTmxId = new Map(ledger.entries.map(entry => [entry.legacyTmxId, entry]))
  const groupStart = tmxText.indexOf('<objectgroup id="13" name="mask">')
  const groupEnd = tmxText.indexOf('</objectgroup>', groupStart)
  if (groupStart < 0 || groupEnd < 0) throw new Error('mask objectgroup not found in TMX')
  const head = tmxText.slice(0, groupStart)
  const tail = tmxText.slice(groupEnd)
  let groupBody = tmxText.slice(groupStart + '<objectgroup id="13" name="mask">'.length, groupEnd)

  const polygonBefore = extractMaskPolygons(groupBody)
  const seen = new Set()
  const transformed = groupBody.replace(/(<object id="(\d+)"[^>]*>)([\s\S]*?)(<\/object>)/g, (whole, openTag, rawId, body, closeTag) => {
    const id = Number(rawId)
    if (!maskIdRange(id)) return whole
    const entry = entriesByTmxId.get(id)
    if (!entry) throw new Error(`mask ${id}: missing E10A ledger entry`)
    if (seen.has(id)) throw new Error(`mask ${id}: duplicate object in TMX`)
    seen.add(id)
    if (/<properties>/.test(body)) return whole // already migrated; verified below
    const binding = maskPropertyBinding(entry)
    return `${openTag}\n${serializeMaskProperties(binding)}${body}${closeTag}`
  })

  for (let id = MASK_ID_MIN; id <= MASK_ID_MAX; id += 1) {
    if (!seen.has(id)) throw new Error(`mask ${id}: missing from TMX mask group`)
  }

  const result = `${head}<objectgroup id="13" name="mask">${transformed}${tail}`
  const polygonAfter = extractMaskPolygonsAfterMigration(result)
  if (stableJson(polygonBefore) !== stableJson(polygonAfter)) {
    throw new Error('mask polygon drift during E10B TMX migration')
  }
  const structure = parseTmxStructure(result)
  for (let id = MASK_ID_MIN; id <= MASK_ID_MAX; id += 1) {
    const object = structure.groups.mask.find(candidate => candidate.id === id)
    if (!object) throw new Error(`mask ${id}: missing after migration`)
    const entry = entriesByTmxId.get(id)
    const binding = maskPropertyBinding(entry)
    for (const name of MASK_TMX_PROPERTY_ORDER) {
      if (String(object.properties[name]) !== String(binding[name])) {
        throw new Error(`mask ${id}: property ${name} drift (${object.properties[name]} != ${binding[name]})`)
      }
    }
  }
  return { tmx: result, polygonBefore, polygonAfter }
}

function extractMaskPolygons(groupBody) {
  const polygons = {}
  for (const match of groupBody.matchAll(/<object id="(\d+)"[^>]*>[\s\S]*?<polygon points="([^"]*)"[^>]*\/>/g)) {
    const id = Number(match[1])
    if (!maskIdRange(id)) continue
    polygons[id] = match[2]
  }
  return polygons
}

function extractMaskPolygonsAfterMigration(tmx) {
  const structure = parseTmxStructure(tmx)
  const polygons = {}
  for (const object of structure.groups.mask) {
    polygons[object.id] = object.polygon.map(point => `${point[0]},${point[1]}`).join(' ')
  }
  return polygons
}

/** Read the accepted E10A ledger and check frozen identity fields. */
export function readLedger(ledgerPath) {
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  if (ledger.$schema !== 'juyiting-occlusion-v2-mask-migration-ledger-v2') {
    throw new Error(`E10A ledger schema mismatch: ${ledger.$schema}`)
  }
  if (ledger.generationId !== E10A_GENERATION_ID) {
    throw new Error(`E10A ledger generationId drift: ${ledger.generationId}`)
  }
  if (ledger.contentSha256 !== E10A_LEDGER_CONTENT_SHA256) {
    throw new Error(`E10A ledger contentSha256 drift: ${ledger.contentSha256}`)
  }
  if (ledger.provenance?.tmxSha256 !== E10A_TMX_SHA256) {
    throw new Error(`E10A ledger tmxSha256 drift: ${ledger.provenance?.tmxSha256}`)
  }
  if (ledger.provenance?.inputHashes?.tmx?.sha256 !== E10A_TMX_SHA256) {
    throw new Error('E10A ledger input TMX hash drift')
  }
  if (ledger.entries.length !== MASK_ID_COUNT) {
    throw new Error(`E10A ledger entry count drift: ${ledger.entries.length}`)
  }
  return ledger
}

/** Deterministic E10B fragment/occluder manifest built from TMX + ledger. */
export function buildMaskTmxManifest(tmxText, ledger, baselineTmxSha256 = E10A_TMX_SHA256) {
  const currentSha = sha256(Buffer.from(tmxText, 'utf8'))
  const structure = parseTmxStructure(tmxText)
  const objectsById = new Map(structure.groups.mask.map(object => [object.id, object]))
  const entries = ledger.entries.map(entry => {
    const object = objectsById.get(entry.legacyTmxId)
    if (!object) throw new Error(`mask ${entry.legacyTmxId}: missing from migrated TMX`)
    const binding = maskPropertyBinding(entry)
    for (const name of MASK_TMX_PROPERTY_ORDER) {
      if (String(object.properties[name]) !== String(binding[name])) {
        throw new Error(`mask ${entry.legacyTmxId}: TMX property ${name} drift (${object.properties[name]} != ${binding[name]})`)
      }
    }
    return {
      tmxId: entry.legacyTmxId,
      legacyIndex: entry.legacyIndex,
      legacyTmxName: entry.legacyTmxName,
      stableId: binding.stableId,
      scope: { sceneId: binding.sceneId, floorId: binding.floorId, chunkId: binding['chunk-id'] },
      kind: binding.kind,
      renderBand: binding.renderBand,
      elevation: binding.elevation,
      sortMode: binding.sortMode,
      sortAnchor: entry.sortAnchor,
      fixedPointY: entry.fixedPointY,
      tieBias: entry.tieBias,
      targetFragmentId: binding.targetFragmentId,
      probes: PROBE_NAMES.map(name => {
        const probe = entry.probes[name]
        return {
          name,
          probeId: probe.probeId,
          footPoint: probe.footPoint,
          fixedPointY: probe.fixedPointY,
          expectedPainterRelation: probe.expectedPainterRelation,
        }
      }),
      recalibrationDecision: entry.recalibrationDecision === 'none' ? 'none' : entry.recalibrationDecision.action,
      constraintDecision: entry.constraintDecision.decision,
    }
  })
  const manifest = {
    $schema: 'jyt.occlusion.mask-tmx-manifest.v1',
    schemaVersion: 1,
    taskId: 'E10B',
    sceneId: ledger.entries[0].sceneId,
    maskCount: entries.length,
    probeCount: entries.length * PROBE_NAMES.length,
    constraintCount: entries.filter(entry => entry.constraintDecision !== 'none').length,
    recalibrationCount: entries.filter(entry => entry.recalibrationDecision !== 'none').length,
    uniqueOccluderStableIds: new Set(entries.map(entry => entry.stableId)).size,
    anonymousOccluderCount: entries.filter(entry => !entry.stableId).length,
    ledgerBinding: {
      taskId: 'E10A',
      path: 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json',
      sha256: sha256(Buffer.from(stableJson(ledger), 'utf8')),
      generationId: ledger.generationId,
      contentSha256: ledger.contentSha256,
    },
    tmxProvenance: {
      baselineAnchor: {
        ownerTask: 'E10A',
        path: 'public/juyiting/hall.tmx',
        sha256: baselineTmxSha256,
        description: 'E10A accepted input TMX (frozen in E10A ledger provenance)',
      },
      currentAnchor: {
        ownerTask: 'E10B',
        path: 'public/juyiting/hall.tmx',
        sha256: currentSha,
        description: 'E10B live production TMX; 37-mask migration from E10A ledger binding',
      },
    },
    entries,
  }
  const content = { ...manifest, generationId: '' }
  manifest.generationId = sha256(Buffer.from(stableJson(content), 'utf8'))
  return manifest
}

/** Deterministic E10B migration snapshot built from the manifest + ledger. */
export function buildMaskMigrationSnapshot(manifest, ledger) {
  const structureByTmxId = new Map()
  const masks = manifest.entries.map(entry => {
    const ledgerEntry = ledger.entries.find(candidate => candidate.legacyTmxId === entry.tmxId)
    structureByTmxId.set(entry.tmxId, ledgerEntry)
    return {
      tmxId: entry.tmxId,
      stableId: entry.stableId,
      scope: entry.scope,
      kind: entry.kind,
      renderBand: entry.renderBand,
      elevation: entry.elevation,
      sortMode: entry.sortMode,
      sortAnchor: entry.sortAnchor,
      fixedPointY: entry.fixedPointY,
      tieBias: entry.tieBias,
      polygon: ledgerEntry.polygon,
      aabb: ledgerEntry.aabb,
      targetFragmentId: entry.targetFragmentId,
      probeIds: entry.probes.map(probe => probe.probeId),
      constraintDecision: entry.constraintDecision,
    }
  })
  const snapshot = {
    $schema: 'jyt.occlusion.mask-migration-snapshot.v1',
    schemaVersion: 1,
    taskId: 'E10B',
    sceneId: manifest.sceneId,
    width: 1664,
    height: 928,
    maskCount: masks.length,
    probeCount: manifest.probeCount,
    constraintCount: manifest.constraintCount,
    generationId: manifest.generationId,
    masks,
  }
  return snapshot
}

/** Deterministic vector debug preview (no external art) of the migration. */
export function buildMaskMigrationDebugSvg(manifest, ledger, generationId = manifest.generationId) {
  const byTmxId = new Map(ledger.entries.map(entry => [entry.legacyTmxId, entry]))
  const chunkRegions = {
    'west-upper': { x: 0, y: 0, w: 721, h: 580 },
    center: { x: 721, y: 0, w: 409, h: 580 },
    'east-upper': { x: 1130, y: 0, w: 534, h: 580 },
    'west-lower': { x: 0, y: 580, w: 721, h: 348 },
    entrance: { x: 721, y: 580, w: 409, h: 348 },
    'east-lower': { x: 1130, y: 580, w: 534, h: 348 },
  }
  const chunkColors = {
    'west-upper': '#3a86ff', center: '#9d4edd', 'east-upper': '#00b4d8',
    'west-lower': '#f4a261', entrance: '#e9c46a', 'east-lower': '#e76f51',
  }
  const probeColors = { behind: '#4cc9f0', boundary: '#ffd166', front: '#06d6a0' }
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1664" height="928" viewBox="0 0 1664 928" data-generation-id="${generationId}" data-task-id="E10B" role="img" aria-labelledby="mm-title mm-desc">`,
    '  <title id="mm-title">Juyiting 37-mask E10B migration debug preview</title>',
    '  <desc id="mm-desc">juyiting-main · E10A ledger binding · constraints 0 · probes 111 · no anonymous occluder</desc>',
    '  <defs>',
    '    <filter id="mm-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#08110d" flood-opacity="0.9"/></filter>',
    '    <style>',
    '      .chunk{fill-opacity:.07;stroke-width:1;vector-effect:non-scaling-stroke}',
    '      .chunk-label{font:700 20px system-ui,sans-serif;fill:#d7e3ef;paint-order:stroke;stroke:#10151c;stroke-width:4;stroke-linejoin:round;filter:url(#mm-shadow)}',
    '      .mask{fill-opacity:.16;stroke-width:1.5;vector-effect:non-scaling-stroke}',
    '      .mask-label{font:600 11px ui-monospace,monospace;fill:#eaf2ff;paint-order:stroke;stroke:#10151c;stroke-width:3;stroke-linejoin:round}',
    '      .probe{stroke-width:2;vector-effect:non-scaling-stroke}',
    '      .anchor{fill:#ffffff;stroke:#10151c;stroke-width:1.5;vector-effect:non-scaling-stroke}',
    '    </style>',
    '  </defs>',
    '  <rect width="1664" height="928" fill="#17251d"/>',
  ]
  for (const [chunk, rect] of Object.entries(chunkRegions)) {
    const color = chunkColors[chunk]
    lines.push(`  <rect class="chunk" x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${color}" stroke="${color}"/>`)
    lines.push(`  <text class="chunk-label" x="${rect.x + rect.w / 2}" y="${rect.y + 26}">${chunk}</text>`)
  }
  const colorById = id => {
    const hue = (id * 47) % 360
    return `hsl(${hue} 70% 62%)`
  }
  for (const entry of manifest.entries) {
    const ledgerEntry = byTmxId.get(entry.tmxId)
    const polygon = ledgerEntry.polygon
    const points = polygon.map(point => `${point.x},${point.y}`).join(' ')
    const centroid = polygon.reduce((acc, point) => ({ x: acc.x + point.x / polygon.length, y: acc.y + point.y / polygon.length }), { x: 0, y: 0 })
    const color = colorById(entry.tmxId)
    lines.push(`  <polygon class="mask" data-mask-tmx-id="${entry.tmxId}" data-stable-id="${escapeXml(entry.stableId)}" fill="${color}" stroke="${color}" points="${points}"/>`)
    lines.push(`  <text class="mask-label" x="${centroid.x.toFixed(1)}" y="${(centroid.y - 2).toFixed(1)}" text-anchor="middle">mask-${entry.tmxId} ${escapeXml(entry.stableId)}</text>`)
    lines.push(`  <text class="mask-label" x="${centroid.x.toFixed(1)}" y="${(centroid.y + 12).toFixed(1)}" text-anchor="middle">→ ${escapeXml(entry.targetFragmentId)}</text>`)
    for (const probe of entry.probes) {
      const ledgerProbe = ledgerEntry.probes[probe.name]
      lines.push(`  <circle class="probe" data-probe-id="${probe.probeId}" cx="${ledgerProbe.footPoint.x}" cy="${ledgerProbe.footPoint.y}" r="3.2" fill="${probeColors[probe.name]}" stroke="${probeColors[probe.name]}"/>`)
    }
    lines.push(`  <circle class="anchor" cx="${entry.sortAnchor.x}" cy="${entry.sortAnchor.y}" r="2.6"/>`)
  }
  lines.push('</svg>', '')
  return lines.join('\n')
}

/** Hard mechanical verification of the migrated TMX against the E10A ledger. */
export function verifyMaskTmxMigration(tmxText, ledger, options = {}) {
  const { manifest } = options
  const errors = []
  const fail = message => errors.push(message)
  const structure = parseTmxStructure(tmxText)
  const masks = structure.groups.mask.slice().sort((a, b) => a.id - b.id)
  if (masks.length !== MASK_ID_COUNT) fail(`expected ${MASK_ID_COUNT} mask objects, got ${masks.length}`)
  for (let id = MASK_ID_MIN; id <= MASK_ID_MAX; id += 1) {
    if (!masks.some(object => object.id === id)) fail(`mask ${id}: missing from TMX`)
  }
  for (const object of masks) {
    const id = object.id
    const entry = ledger.entries.find(candidate => candidate.legacyTmxId === id)
    if (!entry) { fail(`mask ${id}: missing ledger entry`); continue }
    if (object.properties.stableId == null || object.properties.stableId === '') {
      fail(`mask ${id}: anonymous occluder (missing stableId)`)
    }
    const binding = maskPropertyBinding(entry)
    for (const name of MASK_TMX_PROPERTY_ORDER) {
      if (String(object.properties[name]) !== String(binding[name])) {
        fail(`mask ${id}: property ${name} drift (${object.properties[name]} != ${binding[name]})`)
      }
    }
    const world = resolveWorldPolygon(object)
    if (stableJson(world) !== stableJson(entry.polygon)) {
      fail(`mask ${id}: polygon drift from E10A ledger`)
    }
    const aabb = polygonAabb(world)
    if (stableJson(aabb) !== stableJson(entry.aabb)) {
      fail(`mask ${id}: AABB drift from E10A ledger`)
    }
    if (entry.constraintDecision?.decision !== 'none') fail(`mask ${id}: constraints must be none`)
    for (const name of PROBE_NAMES) {
      const probe = entry.probes?.[name]
      if (!probe) { fail(`mask ${id}: missing ${name} probe in ledger`); continue }
      if (!/^mask-\d+-(behind|boundary|front)$/.test(probe.probeId)) fail(`mask ${id}: ${name} probeId malformed`)
    }
  }
  const uniqueStableIds = new Set(masks.map(object => object.properties.stableId).filter(Boolean))
  const ledgerUnique = new Set(ledger.entries.map(entry => entry.futureOccluderStableId))
  if (stableJson([...uniqueStableIds].sort()) !== stableJson([...ledgerUnique].sort())) {
    fail('occluder stableId set drift from E10A ledger')
  }
  const probeTotal = ledger.entries.reduce((sum, entry) => sum + PROBE_NAMES.filter(name => entry.probes?.[name]).length, 0)
  if (probeTotal !== 111) fail(`expected 111 traceable probes, got ${probeTotal}`)
  if (ledger.summary?.constraintCount !== 0) fail('ledger summary constraintCount must be 0')
  if (manifest) {
    if (manifest.maskCount !== MASK_ID_COUNT) fail('manifest maskCount drift')
    if (manifest.probeCount !== 111) fail('manifest probeCount drift')
    if (manifest.constraintCount !== 0) fail('manifest constraintCount must be 0')
    if (manifest.anonymousOccluderCount !== 0) fail('manifest must report zero anonymous occluders')
    if (manifest.tmxProvenance?.baselineAnchor?.sha256 !== E10A_TMX_SHA256) fail('manifest baselineAnchor drift')
    const currentSha = sha256(Buffer.from(tmxText, 'utf8'))
    if (manifest.tmxProvenance?.currentAnchor?.sha256 !== currentSha) fail('manifest currentAnchor drift from live TMX')
  }
  return { ok: errors.length === 0, errors }
}

/** Compare navigation geometry (collision + navObstacles) against E1 fixture. */
export async function verifyNavigationGeometry(tmxText, inventoryPath) {
  const { buildInventory } = await import('../inventory-juyiting-map.mjs')
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
  const live = buildInventory(tmxText, { baselineCommit: inventory.baselineCommit })
  return {
    ok: stableJson(live.collision) === stableJson(inventory.collision)
      && stableJson(live.navObstacles) === stableJson(inventory.navObstacles),
    collisionCount: live.collision.length,
    navObstacleCount: live.navObstacles.length,
    inventoryCollisionCount: inventory.collision.length,
    inventoryNavObstacleCount: inventory.navObstacles.length,
  }
}

export function repoRoot() {
  return resolve(fileURLToPath(new URL('../../..', import.meta.url)))
}

export { atomicWriteUtf8Batch }
