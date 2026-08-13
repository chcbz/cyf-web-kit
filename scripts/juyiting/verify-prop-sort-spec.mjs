#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSyncCaptured } from './lib/spawn-capture.mjs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tsImport } from 'tsx/esm/api'
import { alphaScan } from './lib/alpha-scan.mjs'
import { scanWebpFrames } from './lib/webp-frame-scan.mjs'
import { readGitBlobAtCommit } from './lib/baseline-provenance.mjs'
import {
  BASE_COMMIT,
  ZERO_GENERATION_ID,
  MAP_SCENE_ID,
  MAP_FLOOR_ID,
  EVIDENCE_ANIMATION,
  EVIDENCE_DIRECTION,
  EVIDENCE_FRAME_ORDINAL,
  REFERENCE_ROLE,
  BOUNTY_ROLES,
  DIRECTIONS,
  EXPECTED_PROP_DEFS,
  sha256Bytes,
  parseHallTmx,
  resolveHallProps,
  tmxImageSourceToPublicPath,
  propWorldAlphaAabb,
  roleRelativeAlphaAabb,
  translateAabb,
  intersectsHalfOpen,
  horizontalGap,
  westFoot,
  eastFoot,
  worldSortKey,
  relationFromComparison,
  stableJson
} from './lib/prop-sort-evidence.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const argValue = flag => {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : null
}
const SPEC_PATH = argValue('--spec') || join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json')
const SVG_PATH = argValue('--svg') || join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props/contact-sheet.svg')
const TMX_OVERRIDE = argValue('--tmx')

let failures = 0
function fail(message) { failures++; console.error(`FAIL: ${message}`) }
function pass(message) { console.error(`PASS: ${message}`) }
function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
  else pass(label)
}
function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) { fail(`${label} must be finite, got ${value}`); return false }
  return true
}
function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) { console.error(`FATAL: cannot read spec ${path}: ${error.message}`); process.exit(1) }
}

const spec = readJson(SPEC_PATH)

// 1. Frozen top-level contract and deterministic generation identity.
if (spec.$schema !== 'jyt.occlusion.prop-sort-spec.v1') fail('$schema mismatch')
if (spec.specVersion !== 1) fail('specVersion must be 1')
if (spec.taskId !== 'E8A') fail('taskId must be E8A')
if (spec.baseCommit !== BASE_COMMIT) fail(`baseCommit must be ${BASE_COMMIT}`)
if (spec.sceneId !== MAP_SCENE_ID) fail(`sceneId must be ${MAP_SCENE_ID}`)
if (spec.propCount !== 5 || !Array.isArray(spec.props) || spec.props.length !== 5) fail('exactly five props required')
else pass('5/5 props present')

let expectedEpoch = null
try {
  expectedEpoch = Number(execFileSyncCaptured('git', ['show', '-s', '--format=%ct', BASE_COMMIT], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim())
} catch (error) { fail(`base commit timestamp unavailable: ${error.message}`) }
if (!Number.isSafeInteger(spec.sourceEpoch) || spec.sourceEpoch <= 0 || spec.sourceEpoch !== expectedEpoch) fail(`sourceEpoch ${spec.sourceEpoch} != frozen commit timestamp ${expectedEpoch}`)
else pass(`sourceEpoch=${spec.sourceEpoch}`)
if (spec.generatedAt !== undefined) fail('generatedAt must be absent; deterministic sourceEpoch is used')
if (spec.generatedBy?.command !== 'npm run generate:juyiting-prop-sort-spec') fail('generatedBy.command mismatch')
if (spec.generatedBy?.script !== 'scripts/juyiting/generate-prop-sort-spec.mjs') fail('generatedBy.script mismatch')
const expectedTooling = [
  'scripts/juyiting/generate-prop-sort-spec.mjs',
  'scripts/juyiting/lib/prop-sort-evidence.mjs',
  'scripts/juyiting/lib/alpha-scan.mjs',
  'scripts/juyiting/lib/webp-frame-scan.mjs'
].map(path => ({ path, sha256: sha256Bytes(readFileSync(join(REPO_ROOT, path))) }))
same(spec.generatedBy?.tooling, expectedTooling, 'generator/scanner tooling provenance')

if (typeof spec.generationId !== 'string' || !/^[0-9a-f]{64}$/.test(spec.generationId)) fail('generationId must be full 64-hex SHA-256')
else {
  const saved = spec.generationId
  spec.generationId = ZERO_GENERATION_ID
  const recomputed = createHash('sha256').update(stableJson(spec)).digest('hex')
  spec.generationId = saved
  if (saved !== recomputed) fail(`generationId mismatch ${saved} != ${recomputed}`)
  else pass(`generationId=${saved}`)
}

// 2. Structured TMX resolution: map -> object gid -> firstgid/tile -> image source/dims.
// E8B provenance: default (no --tmx) reads the historical TMX from the frozen
// baseCommit verified Git blob. Explicit --tmx reads the file at the given path
// and enforces exact hash match against the spec (live migrated TMX must fail).
let tmxBytes = null
let hall = null
let tmxSourceLabel = null
if (TMX_OVERRIDE) {
  // Explicit TMX path: strict exact-hash check against spec source hash.
  const tmxPath = TMX_OVERRIDE.startsWith('/') ? TMX_OVERRIDE : join(REPO_ROOT, TMX_OVERRIDE)
  tmxSourceLabel = `explicit --tmx ${tmxPath}`
  try {
    tmxBytes = readFileSync(tmxPath)
    const parsed = parseHallTmx(tmxBytes.toString('utf8'))
    hall = resolveHallProps(parsed)
  } catch (error) { fail(`TMX structured parse (${tmxSourceLabel}): ${error.message}`) }
  if (tmxBytes) {
    const hash = sha256Bytes(tmxBytes)
    if (hash !== spec.tmxSource?.sha256) fail(`TMX sha256 mismatch ${hash} != ${spec.tmxSource?.sha256} (${tmxSourceLabel})`)
    else pass(`TMX sha256 (${tmxSourceLabel})`)
  }
} else {
  // Default: read historical TMX from the frozen baseCommit verified Git blob.
  tmxSourceLabel = `baseCommit ${spec.baseCommit} Git blob`
  try {
    const tmxBaseCommitPath = spec.tmxSource?.path || 'public/juyiting/hall.tmx'
    tmxBytes = readGitBlobAtCommit(spec.baseCommit, tmxBaseCommitPath)
    const parsed = parseHallTmx(tmxBytes.toString('utf8'))
    hall = resolveHallProps(parsed)
  } catch (error) { fail(`TMX structured parse (${tmxSourceLabel}): ${error.message}`) }
  if (tmxBytes) {
    const hash = sha256Bytes(tmxBytes)
    if (hash !== spec.tmxSource?.sha256) fail(`TMX sha256 mismatch ${hash} != ${spec.tmxSource?.sha256} (${tmxSourceLabel})`)
    else pass(`TMX sha256 (${tmxSourceLabel})`)
  }
}
if (hall) {
  same(spec.tmxSource && {
    tilewidth: spec.tmxSource.tilewidth,
    tileheight: spec.tmxSource.tileheight,
    width: spec.tmxSource.width,
    height: spec.tmxSource.height,
    coordinateWidth: spec.tmxSource.coordinateWidth,
    coordinateHeight: spec.tmxSource.coordinateHeight
  }, hall.map, 'TMX positive map dimensions')
  same(spec.tmxSource?.hallPropsTileset, hall.tileset, 'hall-props firstgid/name/objectalignment/dimensions')
}

const defById = new Map(EXPECTED_PROP_DEFS.map(def => [def.tmxId, def]))
const seenTmxIds = new Set()
const seenStableIds = new Set()
const propById = new Map()
const scansById = new Map()
const STABLE_ID_RE = /^[a-z0-9][a-z0-9._-]{2,95}$/
for (const prop of spec.props || []) {
  const label = `${prop.semanticName}/${prop.tmxId}`
  const def = defById.get(prop.tmxId)
  if (!def) { fail(`${label}: unexpected TMX id`); continue }
  if (seenTmxIds.has(prop.tmxId)) fail(`${label}: duplicate TMX id`)
  seenTmxIds.add(prop.tmxId)
  if (seenStableIds.has(prop.stableId)) fail(`${label}: duplicate stableId`)
  seenStableIds.add(prop.stableId)
  propById.set(prop.tmxId, prop)

  for (const key of ['semanticName', 'tmxId', 'tmxName', 'stableId', 'chunkId', 'tieBias']) {
    if (prop[key] !== def[key]) fail(`${label}: ${key}=${prop[key]} != ${def[key]}`)
  }
  if (!STABLE_ID_RE.test(prop.stableId || '')) fail(`${label}: stableId schema`)
  if (prop.sceneId !== MAP_SCENE_ID || prop.floorId !== MAP_FLOOR_ID || prop.elevation !== 0 || prop.renderBand !== 'world' || prop.sortMode !== 'fixed') fail(`${label}: frozen scene/sort fields mismatch`)
  if (!Number.isSafeInteger(prop.tieBias) || prop.tieBias < -32 || prop.tieBias > 32) fail(`${label}: tieBias out of range`)
  same(prop.sortAnchor, def.sortAnchor, `${label}: frozen sortAnchor`)
  if (prop.fixedPointY !== Math.round(def.sortAnchor.y * 256)) fail(`${label}: fixedPointY mismatch`)
  if (!finite(prop.sortAnchor?.x, `${label}.sortAnchor.x`) || !finite(prop.sortAnchor?.y, `${label}.sortAnchor.y`)) continue
  const coordinateWidth = spec.tmxSource?.coordinateWidth
  const coordinateHeight = spec.tmxSource?.coordinateHeight
  if (prop.sortAnchor.x < 0 || prop.sortAnchor.x > coordinateWidth || prop.sortAnchor.y < 0 || prop.sortAnchor.y > coordinateHeight) fail(`${label}: sortAnchor out of map bounds`)

  const object = hall?.objects.get(prop.tmxId)
  if (!object) { fail(`${label}: TMX object missing`); continue }
  if (object.name !== prop.tmxName || object.type !== 'prop') fail(`${label}: TMX object name/type mismatch`)
  const expectedRect = { x: object.x, y: object.y, width: object.width, height: object.height, minX: object.x, minY: object.y, maxX: object.x + object.width, maxY: object.y + object.height }
  same(prop.tmxRect, expectedRect, `${label}: TMX rect`)
  const expectedBinding = {
    gid: object.gid,
    tilesetName: hall.tileset.name,
    firstgid: hall.tileset.firstgid,
    tileId: object.tile.tileId,
    objectalignment: hall.tileset.objectalignment,
    imageSource: object.tile.imageSource
  }
  same(prop.tmxBinding, expectedBinding, `${label}: gid→tileset→tile→image binding`)
  const expectedAssetPath = tmxImageSourceToPublicPath(object.tile.imageSource)
  if (prop.asset?.path !== expectedAssetPath) fail(`${label}: asset path ${prop.asset?.path} != ${expectedAssetPath}`)
  try {
    const scan = alphaScan(join(REPO_ROOT, expectedAssetPath))
    scansById.set(prop.tmxId, scan)
    if (scan.sha256 !== prop.asset?.sha256) fail(`${label}: asset sha256 mismatch`)
    if (scan.width !== prop.asset?.width || scan.height !== prop.asset?.height) fail(`${label}: PNG dimensions mismatch`)
    if (scan.width !== object.tile.imageWidth || scan.height !== object.tile.imageHeight) fail(`${label}: tile image dimensions mismatch`)
    same(prop.propAlphaAabbSource, scan.alphaAabb, `${label}: source alpha AABB`)
    same(prop.propAlphaAabbWorld, propWorldAlphaAabb(expectedRect, scan.alphaAabb), `${label}: world alpha AABB`)
    if (!prop.sortAnchorEvidence?.interpretation || prop.sortAnchorEvidence.interpretation.length < 100) fail(`${label}: anchor interpretation missing`)
    if (prop.sortAnchorEvidence?.anchorImagePoint?.y !== scan.height) fail(`${label}: anchor must be the evidenced floor/front-base boundary after final alpha row`)
    for (const row of prop.sortAnchorEvidence?.sampledRows || []) {
      if (!Number.isSafeInteger(row.y) || !scan.rows[row.y] || JSON.stringify(row) !== JSON.stringify(scan.rows[row.y])) fail(`${label}: sampled alpha row ${row.y} mismatch`)
    }
    if (!Array.isArray(prop.sortAnchorEvidence?.sampledRows) || prop.sortAnchorEvidence.sampledRows.length < 4) fail(`${label}: insufficient reproducible alpha/contact rows`)
  } catch (error) { fail(`${label}: asset scan ${error.message}`) }
}
if ([...defById.keys()].some(id => !seenTmxIds.has(id))) fail('TMX id set must be exactly 90-94')

const roster = propById.get(94)
if (roster) {
  same(roster.sortAnchor, { x: 306, y: 384 }, 'roster-book V1 anchor')
  if (roster.fixedPointY !== 98304) fail('roster-book fixedPointY must be 98304')
  if (!/full illuminated lectern\/cabinet|full illuminated lectern\/cabinet structure/.test(roster.sortAnchorRationale || '')) fail('roster-book rationale must identify whole illuminated lectern/cabinet')
  same(roster.probes?.north?.agentFootPoint, { x: 306, y: 356 }, 'roster-book north probe')
  same(roster.probes?.south?.agentFootPoint, { x: 306, y: 412 }, 'roster-book south probe')
  if (roster.probes?.west?.agentFootPoint?.y !== 384 || roster.probes?.east?.agentFootPoint?.y !== 384) fail('roster-book W/E Y must be 384')
}

// 3. Canonical role manifest, role assets, decoded frame alpha AABBs.
const manifestRel = 'src/game/sprites/personaSpriteManifest.ts'
const resolverRel = 'src/composables/juyiting/useWaterMarginRoles.js'
const manifestPath = join(REPO_ROOT, manifestRel)
const resolverPath = join(REPO_ROOT, resolverRel)
const { PERSONA_SPRITE_MANIFEST } = await tsImport(manifestPath, import.meta.url)
const { compareWorldSortKeys, worldSortKeyToString } = await tsImport(join(REPO_ROOT, 'src/game/occlusion/worldOrder.ts'), import.meta.url)
const historicalManifestBytes = readGitBlobAtCommit(spec.baseCommit, manifestRel)
const historicalResolverBytes = readGitBlobAtCommit(spec.baseCommit, resolverRel)
if (spec.visualEvidence?.personaManifest?.path !== manifestRel || spec.visualEvidence.personaManifest.sha256 !== sha256Bytes(historicalManifestBytes)) fail('persona manifest provenance mismatch')
if (spec.visualEvidence?.roleResolver?.path !== resolverRel || spec.visualEvidence.roleResolver.sha256 !== sha256Bytes(historicalResolverBytes)) fail('role resolver provenance mismatch')
const roleRequests = []
for (const role of BOUNTY_ROLES) {
  const definition = PERSONA_SPRITE_MANIFEST.personas[role]
  if (!definition || definition.personaCode !== role) { fail(`canonical manifest role ${role} missing`); continue }
  const frameIndex = definition.animations?.[EVIDENCE_ANIMATION]?.[EVIDENCE_DIRECTION]?.frames?.[EVIDENCE_FRAME_ORDINAL]
  if (!Number.isSafeInteger(frameIndex)) { fail(`${role}: frozen idle/down frame missing`); continue }
  roleRequests.push({
    key: role,
    path: join(REPO_ROOT, `public${definition.src}`),
    frame: {
      x: (frameIndex % definition.frame.columns) * definition.frame.width,
      y: Math.floor(frameIndex / definition.frame.columns) * definition.frame.height,
      width: definition.frame.width,
      height: definition.frame.height
    }
  })
}
let frameScans = new Map()
try { frameScans = new Map(scanWebpFrames(roleRequests).map(scan => [scan.key, scan])) }
catch (error) { fail(`role frame alpha scan: ${error.message}`) }
for (const role of BOUNTY_ROLES) {
  const definition = PERSONA_SPRITE_MANIFEST.personas[role]
  const recorded = spec.visualEvidence?.roles?.[role]
  const scan = frameScans.get(role)
  if (!recorded || !scan) { fail(`${role}: visual role evidence missing`); continue }
  const frameIndex = definition.animations[EVIDENCE_ANIMATION][EVIDENCE_DIRECTION].frames[EVIDENCE_FRAME_ORDINAL]
  if (recorded.personaCode !== role || recorded.manifestVersion !== PERSONA_SPRITE_MANIFEST.version) fail(`${role}: manifest identity mismatch`)
  if (recorded.asset?.path !== `public${definition.src}` || recorded.asset.sha256 !== scan.assetSha256) fail(`${role}: role asset path/hash mismatch`)
  if (recorded.asset.imageWidth !== definition.image.width || recorded.asset.imageHeight !== definition.image.height) fail(`${role}: role sheet dimensions mismatch`)
  if (recorded.animation !== EVIDENCE_ANIMATION || recorded.direction !== EVIDENCE_DIRECTION || recorded.animationFrameOrdinal !== EVIDENCE_FRAME_ORDINAL || recorded.sheetFrameIndex !== frameIndex) fail(`${role}: frozen frame metadata mismatch`)
  same(recorded.sourceFrameRect, scan.frame, `${role}: source frame rect`)
  same(recorded.sourceFrameAlphaAabb, scan.alphaAabb, `${role}: decoded frame alpha AABB`)
  same(recorded.anchor, definition.anchor, `${role}: runtime anchor`)
  if (recorded.scale !== definition.scale) fail(`${role}: runtime scale mismatch`)
  same(recorded.relativeWorldAlphaAabb, roleRelativeAlphaAabb(definition, scan.alphaAabb), `${role}: relative rendered alpha AABB`)
}

// 4. Prop probes use exact frozen frame AABB; x=0 remains valid; W/E are alpha-AABB zero-overlap with >=4px guard.
function roleRelative(role) { return spec.visualEvidence.roles[role].relativeWorldAlphaAabb }
function expectedPropPoints(prop) {
  const roleAabbs = prop.tmxId === 92 ? BOUNTY_ROLES.map(roleRelative) : [roleRelative(REFERENCE_ROLE)]
  return prop.tmxId === 94
    ? { north: { x: 306, y: 356 }, south: { x: 306, y: 412 }, west: { x: westFoot(prop.propAlphaAabbWorld, roleAabbs), y: 384 }, east: { x: eastFoot(prop.propAlphaAabbWorld, roleAabbs), y: 384 } }
    : { north: { x: prop.sortAnchor.x, y: prop.sortAnchor.y - 28 }, south: { x: prop.sortAnchor.x, y: prop.sortAnchor.y + 28 }, west: { x: westFoot(prop.propAlphaAabbWorld, roleAabbs), y: prop.sortAnchor.y }, east: { x: eastFoot(prop.propAlphaAabbWorld, roleAabbs), y: prop.sortAnchor.y } }
}
for (const prop of spec.props || []) {
  const points = expectedPropPoints(prop)
  for (const direction of DIRECTIONS) {
    const probe = prop.probes?.[direction]
    const label = `${prop.semanticName}/${direction}`
    if (!probe) { fail(`${label}: probe missing`); continue }
    if (!finite(probe.agentFootPoint?.x, `${label}.x`) || !finite(probe.agentFootPoint?.y, `${label}.y`)) continue
    same(probe.agentFootPoint, points[direction], `${label}: frozen footpoint`)
    const expectedRelation = direction === 'north' ? 'agent<prop' : direction === 'south' ? 'prop<agent' : 'non-overlap'
    if (probe.expectedRelation !== expectedRelation) fail(`${label}: expectedRelation ${probe.expectedRelation} != ${expectedRelation}`)
    const agentAabb = translateAabb(roleRelative(REFERENCE_ROLE), probe.agentFootPoint)
    same(probe.agentAlphaAabbWorld, agentAabb, `${label}: agent alpha AABB`)
    same(probe.propAlphaAabbWorld, prop.propAlphaAabbWorld, `${label}: prop alpha AABB`)
    const intersects = intersectsHalfOpen(prop.propAlphaAabbWorld, agentAabb)
    if (probe.alphaAabbIntersection !== intersects || probe.pixelOverlap !== intersects) fail(`${label}: alpha intersection/pixelOverlap mismatch`)
    if (direction === 'west' || direction === 'east') {
      const gap = horizontalGap(prop.propAlphaAabbWorld, agentAabb, direction)
      if (intersects) fail(`${label}: W/E half-open alpha AABBs intersect`)
      if (!(gap >= 4)) fail(`${label}: horizontal guard ${gap} < 4`)
      if (probe.horizontalGuardPixels !== gap) fail(`${label}: recorded guard ${probe.horizontalGuardPixels} != ${gap}`)
    } else {
      const pKey = worldSortKey(prop.stableId, prop.fixedPointY, prop.tieBias)
      const aKey = worldSortKey(spec.visualEvidence.roles[REFERENCE_ROLE].evidenceStableId, Math.round(probe.agentFootPoint.y * 256), 0)
      if (relationFromComparison(compareWorldSortKeys(aKey, pKey)) !== expectedRelation) fail(`${label}: WorldSortKey relation mismatch`)
    }
  }
}

// 5. Full 20 + 14 evidence cells, exact metadata, AABBs, painter order and matrix expectations.
const visual = spec.visualEvidence
if (visual?.verdictAddressed !== 'REJECT-V1' || !Array.isArray(visual.rejectionRationale) || visual.rejectionRationale.length < 3) fail('REJECT-V1 rationale missing')
if (visual?.cameraZoom !== 1 || visual.cameraDpr !== 1 || visual.captureMode !== 'clean' || visual.referenceRole !== REFERENCE_ROLE) fail('visual capture metadata mismatch')
if (visual?.propCellCount !== 20 || !Array.isArray(visual.propCells) || visual.propCells.length !== 20) fail('prop evidence cell count must be 20')
if (visual?.bountyCellCount !== 14 || !Array.isArray(visual.bountyCells) || visual.bountyCells.length !== 14) fail('bounty evidence cell count must be 14')
if (visual?.totalCellCount !== 34) fail('total evidence cell count must be 34')
const allCells = [...(visual?.propCells || []), ...(visual?.bountyCells || [])]
if (new Set(allCells.map(cell => cell.cellId)).size !== 34) fail('evidence cell IDs must be 34 unique values')

function validateCell(cell, prop, role, expectedRelation, expectedFoot, label) {
  if (!cell) { fail(`${label}: evidence cell missing`); return }
  const required = ['cellId', 'set', 'captureMode', 'commit', 'tmxSha256', 'cameraZoom', 'cameraDpr', 'propStableId', 'tmxId', 'role', 'roleAssetPath', 'roleAssetSha256', 'animation', 'direction', 'animationFrameOrdinal', 'sheetFrameIndex', 'probeName', 'agentFootWorld', 'expectedRelation', 'sortRelation', 'propSortKey', 'agentSortKey', 'painterOrder', 'propAlphaAabbWorld', 'agentAlphaAabbWorld', 'alphaAabbIntersection', 'pixelOverlap']
  for (const field of required) if (cell[field] === undefined || cell[field] === null) fail(`${label}: required metadata ${field} missing`)
  if (cell.commit !== BASE_COMMIT || cell.tmxSha256 !== spec.tmxSource.sha256 || cell.cameraZoom !== 1 || cell.cameraDpr !== 1 || cell.captureMode !== 'clean') fail(`${label}: commit/TMX/camera/mode metadata mismatch`)
  if (cell.role !== role || cell.roleAssetPath !== visual.roles[role].asset.path || cell.roleAssetSha256 !== visual.roles[role].asset.sha256) fail(`${label}: role/frame asset metadata mismatch`)
  if (cell.animation !== EVIDENCE_ANIMATION || cell.direction !== EVIDENCE_DIRECTION || cell.animationFrameOrdinal !== 0 || cell.sheetFrameIndex !== 0) fail(`${label}: animation/direction/frame mismatch`)
  same(cell.agentFootWorld, expectedFoot, `${label}: footpoint`)
  if (cell.expectedRelation !== expectedRelation) fail(`${label}: expected relation ${cell.expectedRelation} != ${expectedRelation}`)
  const propKey = worldSortKey(prop.stableId, prop.fixedPointY, prop.tieBias)
  const agentKey = worldSortKey(visual.roles[role].evidenceStableId, Math.round(expectedFoot.y * 256), 0)
  same(cell.propSortKey, propKey, `${label}: prop sort key`)
  same(cell.agentSortKey, agentKey, `${label}: agent sort key`)
  if (cell.propSortKeyString !== worldSortKeyToString(propKey) || cell.agentSortKeyString !== worldSortKeyToString(agentKey)) fail(`${label}: sort key string mismatch`)
  const compare = compareWorldSortKeys(agentKey, propKey)
  const sortRelation = relationFromComparison(compare)
  if (cell.sortRelation !== sortRelation) fail(`${label}: sort relation mismatch`)
  const painter = compare < 0 ? [visual.roles[role].evidenceStableId, prop.stableId] : [prop.stableId, visual.roles[role].evidenceStableId]
  same(cell.painterOrder, painter, `${label}: painter order`)
  const agentAabb = translateAabb(visual.roles[role].relativeWorldAlphaAabb, expectedFoot)
  same(cell.propAlphaAabbWorld, prop.propAlphaAabbWorld, `${label}: prop alpha AABB`)
  same(cell.agentAlphaAabbWorld, agentAabb, `${label}: agent alpha AABB`)
  const intersects = intersectsHalfOpen(prop.propAlphaAabbWorld, agentAabb)
  if (cell.alphaAabbIntersection !== intersects || cell.pixelOverlap !== intersects) fail(`${label}: alpha intersection mismatch`)
  if (cell.probeName === 'west' || cell.probeName === 'east') {
    const gap = horizontalGap(prop.propAlphaAabbWorld, agentAabb, cell.probeName)
    if (intersects || !(gap >= 4)) fail(`${label}: W/E zero-overlap guard failed (${gap})`)
    if (cell.horizontalGuardPixels !== gap) fail(`${label}: horizontal guard mismatch`)
  }
}

for (const prop of spec.props || []) {
  for (const direction of DIRECTIONS) {
    const expectedId = `prop-${prop.semanticName}-${direction}-${REFERENCE_ROLE}`
    const cell = visual.propCells.find(item => item.cellId === expectedId)
    validateCell(cell, prop, REFERENCE_ROLE, prop.probes[direction].expectedRelation, prop.probes[direction].agentFootPoint, expectedId)
  }
}

const bounty = propById.get(92)
const matrix = bounty?.bountyBoardMatrix
const expectedDirectionPoints = {
  north: { x: 1446, y: 351 }, south: { x: 1446, y: 420 },
  west: { x: westFoot(bounty.propAlphaAabbWorld, BOUNTY_ROLES.map(roleRelative)), y: 379 },
  east: { x: eastFoot(bounty.propAlphaAabbWorld, BOUNTY_ROLES.map(roleRelative)), y: 379 }
}
const expectedDepthPoints = { behind: { x: 1446, y: 370 }, boundary: { x: 1446, y: 379 }, front: { x: 1446, y: 420 } }
const expectedRelations = { north: 'agent<prop', south: 'prop<agent', west: 'non-overlap', east: 'non-overlap', behind: 'agent<prop', boundary: 'prop<agent', front: 'prop<agent' }
if (!matrix) fail('bountyBoardMatrix missing')
else {
  same(matrix.roles, BOUNTY_ROLES, 'bounty roles')
  same(matrix.frozenFrame, { animation: 'idle', direction: 'down', animationFrameOrdinal: 0, sheetFrameIndex: 0 }, 'bounty frozen frame')
  for (const direction of DIRECTIONS) {
    const contract = matrix.matrixCells?.[direction]
    same(contract?.agentFoot, expectedDirectionPoints[direction], `bounty matrix ${direction} foot`)
    for (const role of BOUNTY_ROLES) {
      if (contract?.expectedByRole?.[role] !== expectedRelations[direction]) fail(`bounty matrix ${direction}/${role} expectation`)
      const id = `bounty-direction-${direction}-${role}`
      if (contract?.evidenceCellIds?.[role] !== id) fail(`bounty matrix ${direction}/${role} evidence ID`)
      validateCell(visual.bountyCells.find(cell => cell.cellId === id), bounty, role, expectedRelations[direction], expectedDirectionPoints[direction], id)
    }
  }
  for (const position of ['behind', 'boundary', 'front']) {
    const contract = matrix.behindBoundaryFront?.[position]
    same(contract?.agentFoot, expectedDepthPoints[position], `bounty depth ${position} foot`)
    for (const role of BOUNTY_ROLES) {
      if (contract?.expectedByRole?.[role] !== expectedRelations[position]) fail(`bounty depth ${position}/${role} expectation`)
      const id = `bounty-depth-${position}-${role}`
      if (contract?.evidenceCellIds?.[role] !== id) fail(`bounty depth ${position}/${role} evidence ID`)
      validateCell(visual.bountyCells.find(cell => cell.cellId === id), bounty, role, expectedRelations[position], expectedDepthPoints[position], id)
    }
  }
  if (matrix.mask58CrossReference?.maskId !== 58 || matrix.mask58CrossReference?.action !== 'E10A_REQUIRED_REVIEW') fail('mask 58 E10A cross-reference missing')
  for (const mode of ['cleanMode', 'uiOnMode']) {
    if (!matrix[mode]?.requiredFields?.includes('propSortKey') || !matrix[mode].requiredFields.includes('agentSortKey') || !matrix[mode].requiredFields.includes('agentFootWorld')) fail(`${mode}: complete evidence fields missing`)
  }
}

// Same-foot role invariance and boundary tieBias proof independent of agent stableId.
for (const direction of DIRECTIONS) {
  const cells = BOUNTY_ROLES.map(role => visual.bountyCells.find(cell => cell.cellId === `bounty-direction-${direction}-${role}`))
  if (cells.some(cell => !cell) || JSON.stringify(cells[0].agentFootWorld) !== JSON.stringify(cells[1].agentFootWorld) || cells[0].expectedRelation !== cells[1].expectedRelation) fail(`bounty ${direction}: role invariance`)
}
for (const position of ['behind', 'boundary', 'front']) {
  const cells = BOUNTY_ROLES.map(role => visual.bountyCells.find(cell => cell.cellId === `bounty-depth-${position}-${role}`))
  if (cells.some(cell => !cell) || JSON.stringify(cells[0].agentFootWorld) !== JSON.stringify(cells[1].agentFootWorld) || cells[0].expectedRelation !== cells[1].expectedRelation) fail(`bounty ${position}: role invariance`)
}
if (bounty?.tieBias !== -4) fail('bounty tieBias must be -4')
else {
  for (const stableId of ['jyt.agent.evidence.aaa.v1', 'jyt.agent.evidence.zzz.v1']) {
    const tableKey = worldSortKey(bounty.stableId, bounty.fixedPointY, -4)
    const agentKey = worldSortKey(stableId, bounty.fixedPointY, 0)
    if (compareWorldSortKeys(tableKey, agentKey) >= 0) fail(`boundary tieBias proof failed for ${stableId}`)
  }
  pass('boundary table(-4)<agent(0) independent of stableId')
}

// 6. Five-prop order and shuffle determinism use the actual E5 comparator.
const computedOrder = [...(spec.props || [])]
  .sort((a, b) => compareWorldSortKeys(worldSortKey(a.stableId, a.fixedPointY, a.tieBias), worldSortKey(b.stableId, b.fixedPointY, b.tieBias)))
  .map(prop => prop.stableId)
const frozenOrder = [
  'jyt.prop.center-north.main-seat.v1',
  'jyt.prop.northeast.bounty-board.v1',
  'jyt.prop.center-north.roster-book.v1',
  'jyt.prop.southeast.library-shelf.v1',
  'jyt.prop.southwest.agent-roster.v1'
]
same(computedOrder, frozenOrder, 'five-prop V1 sort order')
same(spec.globalConstraints?.fivePropSortOrder?.order, frozenOrder, 'declared five-prop V1 sort order')
function shuffled(array, seed) {
  const result = [...array]
  let state = seed
  for (let index = result.length - 1; index > 0; index--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    const swap = state % (index + 1)
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}
for (let seed = 0; seed < 10; seed++) {
  const order = shuffled(spec.props, seed)
    .sort((a, b) => compareWorldSortKeys(worldSortKey(a.stableId, a.fixedPointY, a.tieBias), worldSortKey(b.stableId, b.fixedPointY, b.tieBias)))
    .map(prop => prop.stableId)
  if (JSON.stringify(order) !== JSON.stringify(frozenOrder)) fail(`shuffle determinism seed ${seed}`)
}

// 7. Contact sheet is self-contained, generation-bound, and contains exactly the machine-declared 34 clean cells.
try {
  const svg = readFileSync(SVG_PATH, 'utf8')
  const root = svg.match(/<svg[^>]+data-generation-id="([0-9a-f]+)"[^>]+data-base-commit="([^"]+)"[^>]+data-tmx-sha256="([0-9a-f]+)"[^>]+data-prop-cell-count="([^"]+)"[^>]+data-bounty-cell-count="([^"]+)"[^>]+data-evidence-cell-count="([^"]+)"/)
  if (!root) fail('contact sheet root evidence metadata missing')
  else {
    if (root[1] !== spec.generationId) fail('contact sheet/spec generationId mismatch')
    if (root[2] !== BASE_COMMIT || root[3] !== spec.tmxSource.sha256) fail('contact sheet commit/TMX hash mismatch')
    if (root[4] !== '20' || root[5] !== '14' || root[6] !== '34') fail('contact sheet evidence counts mismatch')
  }
  const ids = [...svg.matchAll(/<g class="evidence-cell" data-evidence-cell-id="([^"]+)"/g)].map(match => match[1])
  if (ids.length !== 34 || new Set(ids).size !== 34) fail(`contact sheet evidence cell groups ${ids.length}/unique ${new Set(ids).size} != 34/34`)
  const expectedIds = allCells.map(cell => cell.cellId)
  same(ids, expectedIds, 'contact sheet evidence cell order/IDs')
  const imageAreas = [...svg.matchAll(/<svg class="clean-image-area"[\s\S]*?<\/svg>/g)].map(match => match[0])
  if (imageAreas.length !== 34) fail(`contact sheet clean image areas ${imageAreas.length} != 34`)
  for (const area of imageAreas) if (/<text|label|bubble|debug/i.test(area)) fail('contact sheet image area contains label/bubble/debug content')
  if (!svg.includes('data:image/webp;base64,') || !svg.includes('data:image/png;base64,')) fail('contact sheet must embed scene/role/prop assets as data URIs')
  if (/href="(?:\.\.\/|\/|public\/)/.test(svg)) fail('contact sheet contains filesystem-dependent image href')
  if (/[ \t]+$/m.test(svg)) fail('contact sheet has trailing whitespace')
  else pass('contact sheet 34 clean self-contained cells')
} catch (error) { fail(`contact sheet read: ${error.message}`) }

if (failures === 0) {
  console.error('\nALL VERIFICATIONS PASSED')
  process.exit(0)
}
console.error(`\n${failures} VERIFICATION FAILURE(S)`)
process.exit(1)
