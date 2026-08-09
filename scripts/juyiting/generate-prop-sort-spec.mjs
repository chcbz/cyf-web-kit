#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tsImport } from 'tsx/esm/api'
import { alphaScan } from './lib/alpha-scan.mjs'
import { scanWebpFrames } from './lib/webp-frame-scan.mjs'
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
  xmlEscape,
  stableJson
} from './lib/prop-sort-evidence.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}
const SPEC_OUT = argValue('--spec') || join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json')
const SVG_OUT = argValue('--svg') || join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props/contact-sheet.svg')
const TMX_REL = argValue('--tmx') || 'public/juyiting/hall.tmx'
const TMX_PATH = join(REPO_ROOT, TMX_REL)

function fatal(message) {
  console.error(`FATAL: ${message}`)
  process.exit(1)
}

function sourceEpoch() {
  try {
    const output = execFileSync('git', ['show', '-s', '--format=%ct', BASE_COMMIT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
    const epoch = Number(output)
    if (!Number.isSafeInteger(epoch) || epoch <= 0) throw new Error(`invalid timestamp ${output}`)
    return epoch
  } catch (error) {
    fatal(`cannot resolve sourceEpoch from frozen base ${BASE_COMMIT}: ${error.message}`)
  }
}

const SOURCE_EPOCH = sourceEpoch()
const tmxBytes = readFileSync(TMX_PATH)
const tmxSha256 = sha256Bytes(tmxBytes)
const parsedTmx = parseHallTmx(tmxBytes.toString('utf8'))
let hall
try { hall = resolveHallProps(parsedTmx) } catch (error) { fatal(error.message) }

const manifestRel = 'src/game/sprites/personaSpriteManifest.ts'
const resolverRel = 'src/composables/juyiting/useWaterMarginRoles.js'
const manifestPath = join(REPO_ROOT, manifestRel)
const resolverPath = join(REPO_ROOT, resolverRel)
const { PERSONA_SPRITE_MANIFEST } = await tsImport(manifestPath, import.meta.url)
const { compareWorldSortKeys, worldSortKeyToString } = await tsImport(join(REPO_ROOT, 'src/game/occlusion/worldOrder.ts'), import.meta.url)

const roleDisplayNames = { lujunyi: '卢俊义', husanniang: '扈三娘' }
const roleRequests = BOUNTY_ROLES.map(role => {
  const definition = PERSONA_SPRITE_MANIFEST.personas[role]
  if (!definition || definition.personaCode !== role) fatal(`persona manifest missing canonical role ${role}`)
  const frames = definition.animations?.[EVIDENCE_ANIMATION]?.[EVIDENCE_DIRECTION]?.frames
  const sheetFrameIndex = frames?.[EVIDENCE_FRAME_ORDINAL]
  if (!Number.isSafeInteger(sheetFrameIndex)) fatal(`${role} missing ${EVIDENCE_ANIMATION}/${EVIDENCE_DIRECTION}/frame ${EVIDENCE_FRAME_ORDINAL}`)
  const column = sheetFrameIndex % definition.frame.columns
  const row = Math.floor(sheetFrameIndex / definition.frame.columns)
  return {
    key: role,
    path: join(REPO_ROOT, `public${definition.src}`),
    frame: {
      x: column * definition.frame.width,
      y: row * definition.frame.height,
      width: definition.frame.width,
      height: definition.frame.height
    }
  }
})
const frameScans = new Map(scanWebpFrames(roleRequests).map(scan => [scan.key, scan]))

const roles = {}
const rolePngDataUris = {}
for (const role of BOUNTY_ROLES) {
  const definition = PERSONA_SPRITE_MANIFEST.personas[role]
  const frameScan = frameScans.get(role)
  if (!frameScan) fatal(`frame scan missing ${role}`)
  const sheetFrameIndex = definition.animations[EVIDENCE_ANIMATION][EVIDENCE_DIRECTION].frames[EVIDENCE_FRAME_ORDINAL]
  const assetPath = `public${definition.src}`
  const relativeAlphaAabb = roleRelativeAlphaAabb(definition, frameScan.alphaAabb)
  roles[role] = {
    personaCode: role,
    displayName: roleDisplayNames[role],
    manifestVersion: PERSONA_SPRITE_MANIFEST.version,
    manifestPath: manifestRel,
    resolverPath: resolverRel,
    asset: {
      path: assetPath,
      sha256: frameScan.assetSha256,
      imageWidth: definition.image.width,
      imageHeight: definition.image.height
    },
    animation: EVIDENCE_ANIMATION,
    direction: EVIDENCE_DIRECTION,
    animationFrameOrdinal: EVIDENCE_FRAME_ORDINAL,
    sheetFrameIndex,
    sourceFrameRect: frameScan.frame,
    sourceFrameAlphaAabb: frameScan.alphaAabb,
    anchor: definition.anchor,
    scale: definition.scale,
    renderedFrameSize: {
      width: definition.frame.width * definition.scale,
      height: definition.frame.height * definition.scale
    },
    relativeWorldAlphaAabb: relativeAlphaAabb,
    evidenceStableId: `jyt.agent.evidence.${role}.v1`
  }
  rolePngDataUris[role] = frameScan.pngDataUri
}

const selectedEvidenceRows = {
  'main-seat': [61, 83, 91, 92],
  'agent-roster': [120, 126, 134, 135],
  'bounty-board': [92, 121, 122, 123],
  'library-shelf': [125, 138, 139, 140],
  'roster-book': [160, 186, 187, 190, 191]
}
const semanticEvidence = {
  'main-seat': 'The seat asset remains visually structural through rows 61-91; row 91 spans x=3..108 and row 92 closes at x=3. The frozen boundary Y=268 is the world line immediately after the final alpha row, not an unexamined rectangle default.',
  'agent-roster': 'The full roster stand reaches the floor: rows 126-135 retain two separated foot/base traces spanning x=5..78, including 20 opaque pixels on row 135. The floor-contact boundary is Y=737 immediately after that final row.',
  'bounty-board': 'The drawable is the full table/board prop. Rows 92-121 retain the front table/leg structure; rows 122-123 close the left front foot at x=44..47. The front contact boundary is Y=379, matching the V0 table≈379 constraint.',
  'library-shelf': 'The shelf/base remains present through rows 125-139 and tapers to the terminal base pixel at row 140 x=102. The floor/front-base boundary is Y=719 immediately after the last alpha row.',
  'roster-book': 'REJECT-V1 correction: roster-book denotes the full illuminated lectern/cabinet structure, not a detachable book. Rows 160-186 form a broad 99-112px front base, then rows 187-191 taper to the terminal front corner. The whole-asset floor/front-base boundary is Y=384 immediately after alpha row 191.'
}

const propPngDataUris = {}
const props = []
for (const def of EXPECTED_PROP_DEFS) {
  const object = hall.objects.get(def.tmxId)
  if (!object) fatal(`TMX prop object ${def.tmxId} missing`)
  if (object.name !== def.tmxName) fatal(`TMX object ${def.tmxId} name ${object.name} != ${def.tmxName}`)
  const assetPath = tmxImageSourceToPublicPath(object.tile.imageSource)
  const scan = alphaScan(join(REPO_ROOT, assetPath))
  if (scan.width !== object.width || scan.height !== object.height) fatal(`${def.semanticName} TMX rect differs from PNG dimensions`)
  if (scan.width !== object.tile.imageWidth || scan.height !== object.tile.imageHeight) fatal(`${def.semanticName} tileset image dimensions differ from PNG`)
  const tmxRect = {
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    minX: object.x,
    minY: object.y,
    maxX: object.x + object.width,
    maxY: object.y + object.height
  }
  const anchorImagePoint = { x: def.sortAnchor.x - object.x, y: def.sortAnchor.y - object.y }
  const rows = selectedEvidenceRows[def.semanticName].map(y => scan.rows[y])
  const prop = {
    semanticName: def.semanticName,
    tmxId: def.tmxId,
    tmxName: def.tmxName,
    stableId: def.stableId,
    sceneId: MAP_SCENE_ID,
    chunkId: def.chunkId,
    floorId: MAP_FLOOR_ID,
    elevation: 0,
    renderBand: 'world',
    sortMode: 'fixed',
    tieBias: def.tieBias,
    tmxBinding: {
      gid: object.gid,
      tilesetName: hall.tileset.name,
      firstgid: hall.tileset.firstgid,
      tileId: object.tile.tileId,
      objectalignment: hall.tileset.objectalignment,
      imageSource: object.tile.imageSource
    },
    asset: {
      path: assetPath,
      sha256: scan.sha256,
      width: scan.width,
      height: scan.height
    },
    tmxRect,
    propAlphaAabbSource: scan.alphaAabb,
    propAlphaAabbWorld: propWorldAlphaAabb(tmxRect, scan.alphaAabb),
    sortAnchor: { ...def.sortAnchor },
    fixedPointY: Math.round(def.sortAnchor.y * 256),
    sortAnchorEvidence: {
      interpretation: semanticEvidence[def.semanticName],
      anchorImagePoint,
      alphaAabbSource: scan.alphaAabb,
      sampledRows: rows,
      boundaryRule: `world anchor Y=${def.sortAnchor.y} equals TMX top ${tmxRect.y} + image height ${scan.height}; it is the boundary immediately after source alpha row ${scan.height - 1}.`
    },
    sortAnchorRationale: semanticEvidence[def.semanticName],
    probes: null
  }
  propPngDataUris[def.tmxId] = `data:image/png;base64,${readFileSync(join(REPO_ROOT, assetPath)).toString('base64')}`
  props.push(prop)
}

function propBySemantic(name) { return props.find(prop => prop.semanticName === name) }
function roleDefinition(role) { return PERSONA_SPRITE_MANIFEST.personas[role] }
function agentSortKey(role, foot) {
  return worldSortKey(roles[role].evidenceStableId, Math.round(foot.y * 256), 0)
}
function propSortKey(prop) { return worldSortKey(prop.stableId, prop.fixedPointY, prop.tieBias) }

function buildEvidenceCell({ cellId, set, prop, role, probeName, foot, expectedRelation }) {
  const agentAabb = translateAabb(roles[role].relativeWorldAlphaAabb, foot)
  const propAabb = prop.propAlphaAabbWorld
  const intersection = intersectsHalfOpen(propAabb, agentAabb)
  const pKey = propSortKey(prop)
  const aKey = agentSortKey(role, foot)
  const comparison = compareWorldSortKeys(aKey, pKey)
  const sortRelation = relationFromComparison(comparison)
  const painterOrder = comparison < 0
    ? [roles[role].evidenceStableId, prop.stableId]
    : [prop.stableId, roles[role].evidenceStableId]
  return {
    cellId,
    set,
    captureMode: 'clean',
    commit: BASE_COMMIT,
    tmxSha256,
    cameraZoom: 1,
    cameraDpr: 1,
    propStableId: prop.stableId,
    tmxId: prop.tmxId,
    role,
    roleDisplayName: roles[role].displayName,
    roleAssetPath: roles[role].asset.path,
    roleAssetSha256: roles[role].asset.sha256,
    animation: EVIDENCE_ANIMATION,
    direction: EVIDENCE_DIRECTION,
    animationFrameOrdinal: EVIDENCE_FRAME_ORDINAL,
    sheetFrameIndex: roles[role].sheetFrameIndex,
    probeName,
    agentFootWorld: foot,
    expectedRelation,
    sortRelation,
    propSortKey: pKey,
    propSortKeyString: worldSortKeyToString(pKey),
    agentSortKey: aKey,
    agentSortKeyString: worldSortKeyToString(aKey),
    painterOrder,
    propAlphaAabbWorld: propAabb,
    agentAlphaAabbWorld: agentAabb,
    alphaAabbIntersection: intersection,
    pixelOverlap: intersection,
    horizontalGuardPixels: horizontalGap(propAabb, agentAabb, probeName)
  }
}

const referenceAabb = roles[REFERENCE_ROLE].relativeWorldAlphaAabb
for (const prop of props) {
  const anchor = prop.sortAnchor
  const roleAabbs = prop.semanticName === 'bounty-board'
    ? BOUNTY_ROLES.map(role => roles[role].relativeWorldAlphaAabb)
    : [referenceAabb]
  const points = prop.semanticName === 'roster-book'
    ? {
      north: { x: 306, y: 356 }, south: { x: 306, y: 412 },
      west: { x: westFoot(prop.propAlphaAabbWorld, roleAabbs), y: 384 },
      east: { x: eastFoot(prop.propAlphaAabbWorld, roleAabbs), y: 384 }
    }
    : {
      north: { x: anchor.x, y: anchor.y - 28 }, south: { x: anchor.x, y: anchor.y + 28 },
      west: { x: westFoot(prop.propAlphaAabbWorld, roleAabbs), y: anchor.y },
      east: { x: eastFoot(prop.propAlphaAabbWorld, roleAabbs), y: anchor.y }
    }
  prop.probes = {}
  for (const direction of DIRECTIONS) {
    const expectedRelation = direction === 'north' ? 'agent<prop' : direction === 'south' ? 'prop<agent' : 'non-overlap'
    const cell = buildEvidenceCell({
      cellId: `prop-${prop.semanticName}-${direction}-${REFERENCE_ROLE}`,
      set: 'prop-direction', prop, role: REFERENCE_ROLE, probeName: direction,
      foot: points[direction], expectedRelation
    })
    prop.probes[direction] = {
      agentFootPoint: points[direction],
      expectedRelation,
      pixelOverlap: cell.pixelOverlap,
      alphaAabbIntersection: cell.alphaAabbIntersection,
      propAlphaAabbWorld: cell.propAlphaAabbWorld,
      agentAlphaAabbWorld: cell.agentAlphaAabbWorld,
      horizontalGuardPixels: cell.horizontalGuardPixels,
      evidenceCellId: cell.cellId,
      roleFrameReference: `${REFERENCE_ROLE}/${EVIDENCE_ANIMATION}/${EVIDENCE_DIRECTION}/${EVIDENCE_FRAME_ORDINAL}`,
      rationale: direction === 'west' || direction === 'east'
        ? `${direction} footpoint is derived from the scanned prop alpha AABB and rendered ${REFERENCE_ROLE} frame alpha AABB with a minimum 4px horizontal guard; half-open alpha AABBs do not intersect.`
        : `${direction} is a WorldSortKey assertion at fixedPointY=${cell.agentSortKey.fixedPointY}; the rendered alpha AABB intersection is measured, not inferred from the TMX rectangle.`
    }
  }
}

const bounty = propBySemantic('bounty-board')
const bountyCommonAabbs = BOUNTY_ROLES.map(role => roles[role].relativeWorldAlphaAabb)
const bountyDirectionPoints = {
  north: { x: 1446, y: 351 },
  south: { x: 1446, y: 420 },
  west: { x: westFoot(bounty.propAlphaAabbWorld, bountyCommonAabbs), y: 379 },
  east: { x: eastFoot(bounty.propAlphaAabbWorld, bountyCommonAabbs), y: 379 }
}
const bountyDepthPoints = {
  behind: { x: 1446, y: 370 },
  boundary: { x: 1446, y: 379 },
  front: { x: 1446, y: 420 }
}
const bountyExpected = {
  north: 'agent<prop', south: 'prop<agent', west: 'non-overlap', east: 'non-overlap',
  behind: 'agent<prop', boundary: 'prop<agent', front: 'prop<agent'
}

bounty.bountyBoardMatrix = {
  description: 'Machine-readable 14-cell evidence contract: N/S/W/E × lujunyi/husanniang plus behind/boundary/front × both roles. Every role uses idle/down/frame ordinal 0 and each position uses an identical footpoint across roles.',
  roles: BOUNTY_ROLES,
  frozenFrame: {
    animation: EVIDENCE_ANIMATION,
    direction: EVIDENCE_DIRECTION,
    animationFrameOrdinal: EVIDENCE_FRAME_ORDINAL,
    sheetFrameIndex: 0
  },
  roleInvarianceRequirement: 'Within each named position, both roles use the same footpoint, direction, animation, frame ordinal, WorldSortKey fields except evidence stableId, and expected relation.',
  cleanMode: {
    description: 'Committed visual cells are clean: no UI labels, bubbles, or debug overlays inside image areas.',
    requiredFields: ['commit', 'tmxSha256', 'cameraZoom', 'cameraDpr', 'role', 'animation', 'direction', 'sheetFrameIndex', 'agentFootWorld', 'propSortKey', 'agentSortKey', 'propAlphaAabbWorld', 'agentAlphaAabbWorld', 'alphaAabbIntersection']
  },
  uiOnMode: {
    description: 'A later UI-on capture must preserve identical world footpoints/sort keys while allowing labels and bubbles outside the sorting contract.',
    requiredFields: ['commit', 'tmxSha256', 'cameraZoom', 'cameraDpr', 'role', 'animation', 'direction', 'sheetFrameIndex', 'agentFootWorld', 'propSortKey', 'agentSortKey']
  },
  matrixCells: Object.fromEntries(DIRECTIONS.map(direction => [direction, {
    agentFoot: bountyDirectionPoints[direction],
    expectedByRole: Object.fromEntries(BOUNTY_ROLES.map(role => [role, bountyExpected[direction]])),
    evidenceCellIds: Object.fromEntries(BOUNTY_ROLES.map(role => [role, `bounty-direction-${direction}-${role}`]))
  }])),
  behindBoundaryFront: Object.fromEntries(['behind', 'boundary', 'front'].map(position => [position, {
    agentFoot: bountyDepthPoints[position],
    expectedByRole: Object.fromEntries(BOUNTY_ROLES.map(role => [role, bountyExpected[position]])),
    evidenceCellIds: Object.fromEntries(BOUNTY_ROLES.map(role => [role, `bounty-depth-${position}-${role}`])),
    rationale: position === 'boundary'
      ? 'At Y=379 both keys have fixedPointY=97024; bounty tieBias=-4 sorts before agent tieBias=0, so prop<agent independently of either evidence stableId.'
      : `${position} relation is determined by fixedPointY against table anchor Y=379.`
  }])),
  mask58CrossReference: {
    action: 'E10A_REQUIRED_REVIEW',
    maskId: 58,
    maskAabb: { minX: 1197, minY: 342, maxX: 1663, maxY: 458 },
    distinction: 'Drawable bounty-board pixels and their sort spec remain separate from canonical occluder pixels, TMX mask geometry, and hotspot behavior. E8A does not migrate mask 58.'
  }
}
bounty.tieBiasRationale = 'At equal fixedPointY, E5 compares tieBias before stableId. bounty-board(-4) < either agent(0), proving table<agent at boundary without relying on an invented or hashed agent stableId.'

const propCells = []
for (const prop of props) {
  for (const direction of DIRECTIONS) {
    const probe = prop.probes[direction]
    propCells.push(buildEvidenceCell({
      cellId: probe.evidenceCellId,
      set: 'prop-direction', prop, role: REFERENCE_ROLE, probeName: direction,
      foot: probe.agentFootPoint, expectedRelation: probe.expectedRelation
    }))
  }
}
const bountyCells = []
for (const direction of DIRECTIONS) {
  for (const role of BOUNTY_ROLES) {
    bountyCells.push(buildEvidenceCell({
      cellId: `bounty-direction-${direction}-${role}`,
      set: 'bounty-direction-role', prop: bounty, role, probeName: direction,
      foot: bountyDirectionPoints[direction], expectedRelation: bountyExpected[direction]
    }))
  }
}
for (const position of ['behind', 'boundary', 'front']) {
  for (const role of BOUNTY_ROLES) {
    bountyCells.push(buildEvidenceCell({
      cellId: `bounty-depth-${position}-${role}`,
      set: 'bounty-depth-role', prop: bounty, role, probeName: position,
      foot: bountyDepthPoints[position], expectedRelation: bountyExpected[position]
    }))
  }
}

const sortedProps = [...props].sort((a, b) => compareWorldSortKeys(propSortKey(a), propSortKey(b)))
const expectedOrder = sortedProps.map(prop => prop.stableId)
const backgroundRel = 'public/juyiting/images/liangshan-hall-base-clean-v3.webp'
const backgroundBytes = readFileSync(join(REPO_ROOT, backgroundRel))
const manifestSha256 = sha256Bytes(readFileSync(manifestPath))
const resolverSha256 = sha256Bytes(readFileSync(resolverPath))

const spec = {
  $schema: 'jyt.occlusion.prop-sort-spec.v1',
  specVersion: 1,
  taskId: 'E8A',
  baseCommit: BASE_COMMIT,
  sceneId: MAP_SCENE_ID,
  propCount: 5,
  props,
  globalConstraints: {
    declarationOrderIndependence: {
      description: 'E5 WorldSortKey comparison is independent of declaration and insertion order.',
      testVector: 'Sort all five props, then sort deterministic shuffles; every result must equal expectedSequence.',
      expectedSequence: expectedOrder
    },
    fivePropSortOrder: {
      description: 'Expected ascending E5 WorldSortKey order after the REJECT-V1 roster-book correction.',
      order: expectedOrder,
      rationale: 'fixedPointY: main-seat=68608 < bounty-board=97024 < roster-book=98304 < library-shelf=184064 < agent-roster=188672.'
    },
    drawableAndOccluderSeparation: 'These five entries describe drawable props only. Canonical occluder pixels, TMX mask geometry, hotspots, fragments, and navigation remain separate contracts and are not changed by E8A.',
    failClosedRules: {
      propCompleteness: 'Anything other than exactly TMX objects 90-94 with unique stableIds fails.',
      tmxBinding: 'Object id/name/type/gid/rect and gid→hall-props firstgid/tile/image source/dimensions must match exactly.',
      provenance: 'TMX, prop, scene-background, manifest, resolver, and role-frame asset hashes must match.',
      anchorsAndProbes: 'Non-finite/out-of-bounds anchors or probes, fixedPoint mismatch, missing directions, or W/E alpha-AABB intersection/guard<4 fail.',
      matrix: 'Anything other than full 8 role-direction and 6 role-depth cells, same-foot role invariance, or boundary prop<agent fails.',
      evidence: 'Anything other than 20 prop cells plus 14 bounty cells with complete metadata and recomputed AABBs/sort order fails.',
      generation: 'generationId must equal SHA-256 of the pretty JSON with generationId replaced by 64 zeroes; SVG generationId/count/cell IDs and freshly generated bytes must match.'
    }
  },
  tmxSource: {
    path: TMX_REL,
    sha256: tmxSha256,
    tilewidth: hall.map.tilewidth,
    tileheight: hall.map.tileheight,
    width: hall.map.width,
    height: hall.map.height,
    coordinateWidth: hall.map.coordinateWidth,
    coordinateHeight: hall.map.coordinateHeight,
    hallPropsTileset: hall.tileset
  },
  visualEvidence: {
    verdictAddressed: 'REJECT-V1',
    rejectionRationale: [
      'The prior roster-book anchor treated a detachable book/page region as the drawable; V1 identifies the semantic prop as the full illuminated lectern/cabinet and requires floor/front-base anchor (306,384).',
      'The prior contact sheet did not render actual role frames composited with props and used generic horizontal points instead of scanned alpha-AABB separation.',
      'The prior bounty north matrix point was not frozen at the reviewed world point (1446,351).'
    ],
    renderingContract: 'Each clean SVG image area embeds the actual hall background, prop PNG, and decoded idle/down/frame-0 role pixels. Drawables are emitted in ascending E5 WorldSortKey painter order. All annotations are outside image areas.',
    cameraZoom: 1,
    cameraDpr: 1,
    captureMode: 'clean',
    referenceRole: REFERENCE_ROLE,
    animation: EVIDENCE_ANIMATION,
    direction: EVIDENCE_DIRECTION,
    animationFrameOrdinal: EVIDENCE_FRAME_ORDINAL,
    sceneBackground: {
      path: backgroundRel,
      sha256: sha256Bytes(backgroundBytes),
      width: hall.map.coordinateWidth,
      height: hall.map.coordinateHeight
    },
    personaManifest: { path: manifestRel, sha256: manifestSha256, version: PERSONA_SPRITE_MANIFEST.version },
    roleResolver: { path: resolverRel, sha256: resolverSha256, canonicalResolution: 'portraitRole first resolves personaCode via normalized portraitRoles slug; lujunyi and husanniang are canonical slugs.' },
    roles,
    propCellCount: propCells.length,
    bountyCellCount: bountyCells.length,
    totalCellCount: propCells.length + bountyCells.length,
    propCells,
    bountyCells,
    contactSheet: {
      path: 'tests/fixtures/juyiting/occlusion-v1-props/contact-sheet.svg',
      mediaType: 'image/svg+xml',
      embeddedAssets: true,
      imageAreaPolicy: 'No labels, speech bubbles, debug overlays, anchors, or AABB boxes inside evidence image areas; metadata is below each image.'
    }
  },
  sourceEpoch: SOURCE_EPOCH,
  generatedBy: {
    command: 'npm run generate:juyiting-prop-sort-spec',
    script: 'scripts/juyiting/generate-prop-sort-spec.mjs',
    deterministicInputs: [BASE_COMMIT, TMX_REL, ...props.map(prop => prop.asset.path), backgroundRel, manifestRel, resolverRel, ...BOUNTY_ROLES.map(role => roles[role].asset.path)],
    tooling: [
      'scripts/juyiting/generate-prop-sort-spec.mjs',
      'scripts/juyiting/lib/prop-sort-evidence.mjs',
      'scripts/juyiting/lib/alpha-scan.mjs',
      'scripts/juyiting/lib/webp-frame-scan.mjs'
    ].map(path => ({ path, sha256: sha256Bytes(readFileSync(join(REPO_ROOT, path))) })),
    alphaScanners: ['scripts/juyiting/lib/alpha-scan.mjs', 'scripts/juyiting/lib/webp-frame-scan.mjs'],
    sourceEpochSemantics: 'sourceEpoch is the frozen base commit committer timestamp from git show; no wall-clock generatedAt field is emitted.'
  },
  generationId: ZERO_GENERATION_ID
}

const provisional = stableJson(spec)
const generationId = createHash('sha256').update(provisional).digest('hex')
spec.generationId = generationId
writeFileSync(SPEC_OUT, `${stableJson(spec)}\n`)

function dataUri(mediaType, bytes) { return `data:${mediaType};base64,${bytes.toString('base64')}` }
function aabbText(aabb) { return `[${aabb.minX},${aabb.minY},${aabb.maxX},${aabb.maxY})` }
function pointText(point) { return `(${point.x},${point.y})` }
function cropForCell(cell, prop, role) {
  const def = roleDefinition(role)
  const frameLeft = cell.agentFootWorld.x - def.frame.width * def.scale * def.anchor.x
  const frameTop = cell.agentFootWorld.y - def.frame.height * def.scale * def.anchor.y
  let minX = Math.min(prop.tmxRect.minX, frameLeft) - 14
  let minY = Math.min(prop.tmxRect.minY, frameTop) - 14
  let maxX = Math.max(prop.tmxRect.maxX, frameLeft + def.frame.width * def.scale) + 14
  let maxY = Math.max(prop.tmxRect.maxY, frameTop + def.frame.height * def.scale) + 14
  const desiredAspect = 728 / 270
  const width = maxX - minX
  const height = maxY - minY
  if (width / height < desiredAspect) {
    const add = (height * desiredAspect - width) / 2
    minX -= add; maxX += add
  } else {
    const add = (width / desiredAspect - height) / 2
    minY -= add; maxY += add
  }
  if (minX < 0) { maxX -= minX; minX = 0 }
  if (minY < 0) { maxY -= minY; minY = 0 }
  if (maxX > hall.map.coordinateWidth) { minX -= maxX - hall.map.coordinateWidth; maxX = hall.map.coordinateWidth }
  if (maxY > hall.map.coordinateHeight) { minY -= maxY - hall.map.coordinateHeight; maxY = hall.map.coordinateHeight }
  return { minX, minY, width: maxX - minX, height: maxY - minY, frameLeft, frameTop }
}

const allCells = [...propCells, ...bountyCells]
const columns = 4
const cardWidth = 760
const cardHeight = 490
const gap = 12
const margin = 18
const headerHeight = 235
const rowsCount = Math.ceil(allCells.length / columns)
const sheetWidth = margin * 2 + columns * cardWidth + (columns - 1) * gap
const sheetHeight = headerHeight + margin + rowsCount * cardHeight + (rowsCount - 1) * gap + margin
const backgroundUri = dataUri('image/webp', backgroundBytes)
let svg = '<?xml version="1.0" encoding="UTF-8"?>\n'
svg += `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${sheetWidth} ${sheetHeight}" width="${sheetWidth}" height="${sheetHeight}" data-generation-id="${generationId}" data-base-commit="${BASE_COMMIT}" data-tmx-sha256="${tmxSha256}" data-prop-cell-count="20" data-bounty-cell-count="14" data-evidence-cell-count="34" data-camera-zoom="1" data-camera-dpr="1">\n`
svg += '  <defs>\n'
svg += '    <style>text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:#17202a}.title{font-size:24px;font-weight:700}.subtitle{font-size:13px}.meta{font-size:10.5px}.section{font-size:16px;font-weight:700}.card-title{font-size:13px;font-weight:700}.muted{fill:#4d5656}.ok{fill:#176b3a}.warn{fill:#8a3b12}</style>\n'
svg += `    <image id="hall-background" href="${backgroundUri}" xlink:href="${backgroundUri}" x="0" y="0" width="${hall.map.coordinateWidth}" height="${hall.map.coordinateHeight}"/>\n`
svg += '  </defs>\n'
svg += `  <rect width="${sheetWidth}" height="${sheetHeight}" fill="#edf1f4"/>\n`
svg += `  <rect x="0" y="0" width="${sheetWidth}" height="${headerHeight}" fill="#17202a"/>\n`
svg += '  <text x="24" y="38" class="title" fill="#fff">E8A Five Prop Sort — GPT V1 Visual-Gate Evidence</text>\n'
svg += '  <text x="24" y="65" class="subtitle" fill="#e5e8e8">REJECT-V1 addressed: roster-book is the full illuminated lectern/cabinet; anchor=(306,384), fixedPointY=98304.</text>\n'
svg += '  <text x="24" y="87" class="subtitle" fill="#e5e8e8">Actual clean composites: hall background + prop PNG + canonical persona idle/down/frame 0; painter order is the E5 WorldSortKey order.</text>\n'
svg += '  <text x="24" y="109" class="subtitle" fill="#e5e8e8">20 prop-direction cells (reference role 卢俊义) + 14 bounty cells (卢俊义/扈三娘). No overlays or labels occur inside image areas.</text>\n'
svg += `  <text x="24" y="137" class="meta" fill="#ccd1d1">baseCommit=${BASE_COMMIT} | tmxSha256=${tmxSha256}</text>\n`
svg += `  <text x="24" y="155" class="meta" fill="#ccd1d1">generationId=${generationId} | sourceEpoch=${SOURCE_EPOCH} | cameraZoom=1 | DPR=1 | captureMode=clean</text>\n`
svg += `  <text x="24" y="173" class="meta" fill="#ccd1d1">lujunyi=${roles.lujunyi.asset.sha256} | husanniang=${roles.husanniang.asset.sha256}</text>\n`
svg += `  <text x="24" y="191" class="meta" fill="#ccd1d1">prop sort order: ${xmlEscape(expectedOrder.join(' → '))}</text>\n`
svg += '  <text x="24" y="215" class="subtitle" fill="#f5cba7">W/E: scanned half-open alpha AABBs, ≥4px horizontal guard, machine-verified zero intersection. Bounty north=(1446,351); depth Y=370/379/420.</text>\n'

for (let index = 0; index < allCells.length; index++) {
  const cell = allCells[index]
  const prop = props.find(item => item.stableId === cell.propStableId)
  const role = cell.role
  const definition = roleDefinition(role)
  const crop = cropForCell(cell, prop, role)
  const column = index % columns
  const row = Math.floor(index / columns)
  const x = margin + column * (cardWidth + gap)
  const y = headerHeight + margin + row * (cardHeight + gap)
  const imageX = x + 16
  const imageY = y + 34
  const imageWidth = cardWidth - 32
  const imageHeight = 270
  const roleImage = `<image href="${rolePngDataUris[role]}" xlink:href="${rolePngDataUris[role]}" x="${crop.frameLeft}" y="${crop.frameTop}" width="${definition.frame.width * definition.scale}" height="${definition.frame.height * definition.scale}"/>`
  const propImage = `<image href="${propPngDataUris[prop.tmxId]}" xlink:href="${propPngDataUris[prop.tmxId]}" x="${prop.tmxRect.x}" y="${prop.tmxRect.y}" width="${prop.asset.width}" height="${prop.asset.height}"/>`
  const orderedImages = cell.painterOrder[0] === prop.stableId ? `${propImage}${roleImage}` : `${roleImage}${propImage}`
  const expectedClass = cell.expectedRelation === 'non-overlap' ? 'ok' : 'muted'
  const gapText = cell.horizontalGuardPixels === null ? 'n/a' : String(cell.horizontalGuardPixels)

  svg += `  <g class="evidence-cell" data-evidence-cell-id="${xmlEscape(cell.cellId)}" data-set="${cell.set}" data-role="${role}" data-probe="${cell.probeName}" data-expected-relation="${xmlEscape(cell.expectedRelation)}" data-alpha-intersection="${cell.alphaAabbIntersection}">\n`
  svg += `    <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="7" fill="#fff" stroke="#b8c2cc"/>\n`
  svg += `    <text x="${x + 16}" y="${y + 23}" class="card-title">${index + 1}/34 ${xmlEscape(cell.cellId)}</text>\n`
  svg += `    <svg class="clean-image-area" x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" viewBox="${crop.minX} ${crop.minY} ${crop.width} ${crop.height}" preserveAspectRatio="xMidYMid meet">\n`
  svg += `      <use href="#hall-background" xlink:href="#hall-background"/>${orderedImages}\n`
  svg += '    </svg>\n'
  svg += `    <rect x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" fill="none" stroke="#566573"/>\n`
  const lines = [
    `commit=${cell.commit} | TMX=${cell.tmxSha256}`,
    `cameraZoom=${cell.cameraZoom} DPR=${cell.cameraDpr} mode=${cell.captureMode} | role=${cell.roleDisplayName}/${role}`,
    `animation=${cell.animation} direction=${cell.direction} frameOrdinal=${cell.animationFrameOrdinal} sheetFrame=${cell.sheetFrameIndex} | foot=${pointText(cell.agentFootWorld)}`,
    `expected=${cell.expectedRelation} sortRelation=${cell.sortRelation} painter=${cell.painterOrder.join(' -> ')}`,
    `propKey=${cell.propSortKeyString}`,
    `agentKey=${cell.agentSortKeyString}`,
    `propAlpha=${aabbText(cell.propAlphaAabbWorld)} agentAlpha=${aabbText(cell.agentAlphaAabbWorld)} intersect=${cell.alphaAabbIntersection} horizontalGuard=${gapText}`,
    `propAsset=${prop.asset.sha256} roleAsset=${cell.roleAssetSha256}`
  ]
  for (let line = 0; line < lines.length; line++) {
    svg += `    <text x="${x + 16}" y="${y + 326 + line * 18}" class="meta ${line === 3 ? expectedClass : ''}">${xmlEscape(lines[line])}</text>\n`
  }
  svg += '  </g>\n'
}
svg += '</svg>\n'
svg = svg.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n')
if (!svg.endsWith('\n')) svg += '\n'
writeFileSync(SVG_OUT, svg)
console.error(`Spec: ${SPEC_OUT}`)
console.error(`SVG: ${SVG_OUT}`)
console.error(`generationId=${generationId}`)
