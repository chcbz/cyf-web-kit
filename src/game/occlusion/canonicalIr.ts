import { SaxesParser } from 'saxes'

import {
  type CanonicalSceneIr,
  type OcclusionConstraintZone,
  type OccluderFragment,
  type Point,
  type Rect,
  type RenderBand,
  type RenderSchemaErrorCode,
  type SceneObject,
  type SceneObjectKind,
  type SceneRender,
  type SortMode,
  CONSTRAINT_RELATIONS,
  DEFAULT_FLOOR_REGISTRY,
  HYSTERESIS_PX,
  RENDER_BANDS,
  RENDER_BAND_ORDER,
  RENDER_SCHEMA_SOURCE,
  RENDER_SCHEMA_VERSION,
  SCENE_OBJECT_KINDS,
  SORT_MODES,
  STABLE_ID_PATTERN,
  TIE_BIAS_MAX,
  TIE_BIAS_MIN,
  isStructuredFatalRenderSchemaError,
  renderSchemaError,
} from './schema.js'
import { validateAndCompilePolygon } from './validation.js'

// ── Helpers ──

function isInteger(value: number): boolean {
  return Number.isSafeInteger(value) || (Number.isFinite(value) && Math.floor(value) === value)
}

function asciiCompare(a: string, b: string): number {
  // Byte-level compare via code-unit iteration; NOT localeCompare
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ca = a.charCodeAt(i)
    const cb = b.charCodeAt(i)
    if (ca < cb) return -1
    if (ca > cb) return 1
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0
}

function stableIdSort(a: { stableId: string }, b: { stableId: string }): number {
  return asciiCompare(a.stableId, b.stableId)
}

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw renderSchemaError(
      'CANONICAL_NUMBER_INVALID',
      '(canonical)',
      '(serializer)',
      'number',
      '规范化数字必须是有限数值。',
      `Canonical serialization requires a finite number, got ${String(n)}.`,
    )
  }
  // ECMAScript JSON number serialization is the deterministic shortest decimal
  // representation that round-trips to the same IEEE-754 value. Normalize -0
  // because JSON has no distinct negative-zero value.
  return JSON.stringify(Object.is(n, -0) ? 0 : n)
}

// ── Structured fatal builder ──

function fatal(
  code: RenderSchemaErrorCode,
  sceneId: string,
  objectId: string,
  field: string,
  technicalMessage: string,
): never {
  const userMessages: Record<string, string> = {
    RENDER_SCHEMA_VERSION_UNKNOWN: '遮挡渲染 schema 版本不受支持。',
    RENDER_SCHEMA_VERSION_MISSING: '地图缺少遮挡渲染 schema 版本。',
    RENDER_SCHEMA_VERSION_UNSUPPORTED: '遮挡渲染 schema 版本不受支持。',
    STABLE_ID_MISSING: '对象缺少 stableId。',
    STABLE_ID_INVALID_PATTERN: '对象 stableId 格式无效。',
    STABLE_ID_DUPLICATE: '对象 stableId 重复。',
    SCENE_ID_MISSING: '场景 ID 缺失。',
    SCENE_ID_INVALID: '场景 ID 无效。',
    CHUNK_ID_MISSING: 'chunk ID 缺失。',
    CHUNK_ID_INVALID: 'chunk ID 无效。',
    KIND_MISSING: '对象 kind 缺失。',
    KIND_INVALID: '对象 kind 无效。',
    RENDER_BAND_MISSING: 'render band 缺失。',
    RENDER_BAND_INVALID: 'render band 无效。',
    FLOOR_ID_MISSING: 'floor ID 缺失。',
    FLOOR_ID_UNKNOWN: 'floor ID 未在 registry 中注册。',
    FLOOR_REGISTRY_DUPLICATE: 'floor registry 中存在重复 ID。',
    FLOOR_REGISTRY_INVALID_ORDER: 'floor registry order 必须为整数。',
    OBJECTGROUP_OFFSET_INVALID: 'objectgroup offset 必须为有限数值。',
    OBJECT_ROTATION_UNSUPPORTED: 'render schema v2 暂不支持旋转对象。',
    NESTED_OBJECTGROUP_UNSUPPORTED: 'render schema v2 暂不支持嵌套对象组。',
    XML_PARSE_FAILED: 'TMX XML 无法解析。',
    CANONICAL_NUMBER_INVALID: '规范化数字必须为有限数值。',
    ELEVATION_MISSING: 'elevation 缺失。',
    ELEVATION_INVALID: 'elevation 必须为有符号整数。',
    SORT_MODE_MISSING: 'sortMode 缺失。',
    SORT_MODE_INVALID: 'sortMode 无效。',
    SORT_ANCHOR_MISSING: 'sortAnchor 缺失。',
    SORT_ANCHOR_INVALID: 'sortAnchor 坐标无效。',
    TIE_BIAS_INVALID: 'tieBias 必须为整数。',
    TIE_BIAS_OUT_OF_RANGE: `tieBias 必须在 [${TIE_BIAS_MIN}, ${TIE_BIAS_MAX}] 范围内。`,
    ASSET_REF_MISSING: 'asset render 缺少 assetRef。',
    ASSET_REF_INVALID: 'assetRef 无效。',
    RENDERER_KEY_MISSING: 'procedural render 缺少 rendererKey。',
    RENDERER_KEY_INVALID: 'rendererKey 无效。',
    RENDER_CONFLICT: 'render 不能同时包含 asset 和 procedural 字段。',
    DESTINATION_RECT_MISSING: 'render 缺少 destinationRect。',
    DESTINATION_RECT_INVALID: 'destinationRect 包含无效尺寸。',
    SOURCE_RECT_INVALID: 'sourceRect 包含无效尺寸。',
    FRAGMENT_RENDER_BAND_INVALID: 'fragment renderBand 只能为 world 或 overhead。',
    FRAGMENT_SORT_MODE_INVALID: 'fragment sortMode 必须为 fixed。',
    ZONE_TARGET_MISSING: 'zone 缺少 targetFragmentId。',
    ZONE_TARGET_NOT_WORLD: 'zone target fragment 必须位于 world band。',
    ZONE_TARGET_CROSS_SCENE: 'zone target fragment 必须位于同一 scene。',
    ZONE_TARGET_CROSS_FLOOR: 'zone target fragment 必须位于同一 floor。',
    ZONE_RELATION_INVALID: 'zone relation 必须为 behind 或 front。',
    ZONE_PRIORITY_INVALID: 'zone priority 必须为有符号整数。',
    ZONE_POLYGON_INVALID: 'zone polygon 至少需要 3 个有效点。',
    ZONE_BOUNDS_INVALID: 'zone bounds 无效。',
    ZONE_HYSTERESIS_INVALID: 'zone hysteresisPx 必须为 3。',
    ZONE_TARGET_NOT_FOUND: 'zone target fragment 未在 fragments 中找到。',
    OBJECT_REFERENCE_INVALID: '对象引用无效。',
    POLYGON_SELF_INTERSECTING: 'zone polygon 存在自相交（含共线重叠/T型接触/非相邻顶点触碰）。',
    POLYGON_DEGENERATE_EDGE: 'zone polygon 存在退化边（相邻重复点或零长度边）。',
    POLYGON_AREA_TOO_SMALL: 'zone polygon 绝对面积小于 1 平方世界像素。',
    POLYGON_EROSION_EMPTY: 'zone polygon 经 3px erosion 后没有非空内部面积。',
    POLYGON_FIXED_OVERFLOW: 'zone polygon 定点化后坐标超过安全整数范围。',
    POLYGON_NON_FINITE: 'zone polygon 包含非有限坐标。',
  }
  throw renderSchemaError(
    code,
    sceneId,
    objectId,
    field,
    userMessages[code] || '遮挡渲染 schema 错误。',
    technicalMessage,
  )
}

// ── Number/coordinate helpers ──

function parseFiniteNumber(raw: unknown, fallback: number | undefined): number | undefined {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function parseInteger(raw: unknown): number | undefined {
  const n = parseFiniteNumber(raw, undefined)
  if (n === undefined) return undefined
  return isInteger(n) ? n : undefined
}

function requireInteger(
  raw: unknown,
  sceneId: string,
  objectId: string,
  field: string,
  errorCode: RenderSchemaErrorCode,
): number {
  const n = parseInteger(raw)
  if (n === undefined) {
    fatal(errorCode, sceneId, objectId, field, `${field} must be a finite integer, got ${JSON.stringify(raw)}`)
  }
  return n
}

function requireFiniteNumber(
  raw: unknown,
  sceneId: string,
  objectId: string,
  field: string,
  errorCode: RenderSchemaErrorCode,
): number {
  const n = parseFiniteNumber(raw, undefined)
  if (n === undefined) {
    fatal(errorCode, sceneId, objectId, field, `${field} must be a finite number, got ${JSON.stringify(raw)}`)
  }
  return n
}

function parsePoint(
  rawX: unknown,
  rawY: unknown,
  sceneId: string,
  objectId: string,
  field: string,
  errorCode: RenderSchemaErrorCode,
): Point {
  return {
    x: requireFiniteNumber(rawX, sceneId, objectId, `${field}.x`, errorCode),
    y: requireFiniteNumber(rawY, sceneId, objectId, `${field}.y`, errorCode),
  }
}

function parseRect(
  rawX: unknown,
  rawY: unknown,
  rawW: unknown,
  rawH: unknown,
  sceneId: string,
  objectId: string,
  field: string,
  errorCode: RenderSchemaErrorCode,
): Rect {
  const x = requireFiniteNumber(rawX, sceneId, objectId, `${field}.x`, errorCode)
  const y = requireFiniteNumber(rawY, sceneId, objectId, `${field}.y`, errorCode)
  const w = requireFiniteNumber(rawW, sceneId, objectId, `${field}.width`, errorCode)
  const h = requireFiniteNumber(rawH, sceneId, objectId, `${field}.height`, errorCode)
  if (w <= 0 || h <= 0) {
    fatal(
      errorCode,
      sceneId,
      objectId,
      field,
      `${field} must have positive width and height, got ${w}x${h}`,
    )
  }
  return { x, y, width: w, height: h }
}

function normalizeBasicZonePolygon(
  rawPoints: unknown,
  objectOrigin: Point | undefined,
  sceneId: string,
  objectId: string,
): Point[] {
  if (!Array.isArray(rawPoints)) {
    fatal('ZONE_POLYGON_INVALID', sceneId, objectId, 'polygon', 'zone polygon must be an array')
  }

  const points: Point[] = rawPoints.map((rawPoint, index) => {
    if (!rawPoint || typeof rawPoint !== 'object' || Array.isArray(rawPoint)) {
      fatal(
        'ZONE_POLYGON_INVALID',
        sceneId,
        objectId,
        'polygon',
        `zone polygon point ${index} must be an object`,
      )
    }
    const point = rawPoint as Record<string, unknown>
    if (typeof point.x !== 'number' || !Number.isFinite(point.x)
      || typeof point.y !== 'number' || !Number.isFinite(point.y)) {
      fatal(
        'ZONE_POLYGON_INVALID',
        sceneId,
        objectId,
        'polygon',
        `zone polygon point ${index} must contain finite numeric x/y coordinates`,
      )
    }

    const x = point.x + (objectOrigin?.x ?? 0)
    const y = point.y + (objectOrigin?.y ?? 0)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      fatal(
        'ZONE_POLYGON_INVALID',
        sceneId,
        objectId,
        'polygon',
        `zone polygon point ${index} world coordinates must be finite`,
      )
    }
    return { x, y }
  })

  while (points.length >= 2) {
    const first = points[0]
    const last = points[points.length - 1]
    if (first.x !== last.x || first.y !== last.y) break
    points.pop()
  }

  const uniquePoints: Point[] = []
  for (const point of points) {
    if (!uniquePoints.some(candidate => candidate.x === point.x && candidate.y === point.y)) {
      uniquePoints.push(point)
    }
  }
  if (points.length < 3 || uniquePoints.length < 3) {
    fatal(
      'ZONE_POLYGON_INVALID',
      sceneId,
      objectId,
      'polygon',
      `zone polygon requires at least 3 unique points, got ${uniquePoints.length}`,
    )
  }

  return points
}

// ── Property extraction from TMX custom properties ──

interface RawProperties {
  [key: string]: string
}

function extractProperties(propsNode: Element | null): RawProperties {
  const result: RawProperties = {}
  if (!propsNode) return result
  propsNode.querySelectorAll('property').forEach((prop) => {
    const name = prop.getAttribute('name')
    const value = prop.getAttribute('value')
    if (name) result[name] = value ?? ''
  })
  return result
}

function extractPropertiesFromData(raw: unknown): RawProperties {
  if (!raw || typeof raw !== 'object') return {}
  // melonJS passes properties as array of {name, value} or plain object
  if (Array.isArray(raw)) {
    const result: RawProperties = {}
    for (const item of raw) {
      if (item && typeof item === 'object' && 'name' in item) {
        result[String((item as Record<string, unknown>).name)] = String((item as Record<string, unknown>).value ?? '')
      }
    }
    return result
  }
  const result: RawProperties = {}
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    result[key] = String(obj[key] ?? '')
  }
  return result
}

// ── Input types (abstract over XML DOM vs melonJS data) ──

interface TmxInputObject {
  name: string
  type: string
  x: number
  y: number
  width: number
  height: number
  gid?: number
  properties: RawProperties
  polygon?: Point[]
  ellipse?: boolean
}

interface TmxInputLayer {
  name: string
  type: string
  objects: TmxInputObject[]
}

interface TmxInputMap {
  properties: RawProperties
  layers: TmxInputLayer[]
  width: number
  height: number
  tilewidth: number
  tileheight: number
}

interface RawXmlNode {
  name: string
  attributes: Record<string, string>
  children: RawXmlNode[]
  text: string
}

function directRawChildren(node: RawXmlNode, name: string): RawXmlNode[] {
  return node.children.filter(child => child.name === name)
}

function directDomChildren(node: Element, name: string): Element[] {
  return Array.from(node.children).filter(child => child.tagName === name)
}

function inputSceneId(properties: RawProperties): string {
  return properties.sceneId || 'juyiting-main'
}

function parseObjectGroupOffset(
  raw: unknown,
  sceneId: string,
  layerName: string,
  field: 'offsetx' | 'offsety',
): number {
  const value = raw === undefined || raw === null || raw === '' ? 0 : Number(raw)
  if (!Number.isFinite(value)) {
    fatal(
      'OBJECTGROUP_OFFSET_INVALID',
      sceneId,
      layerName || '(objectgroup)',
      field,
      `objectgroup ${layerName || '(unnamed)'} ${field} must be finite, got ${String(raw)}`,
    )
  }
  return value
}

function validateObjectRotation(
  raw: unknown,
  sceneId: string,
  objectId: string,
): void {
  const rotation = raw === undefined || raw === null || raw === '' ? 0 : Number(raw)
  if (!Number.isFinite(rotation) || rotation !== 0) {
    fatal(
      'OBJECT_ROTATION_UNSUPPORTED',
      sceneId,
      objectId || '(unnamed)',
      'rotation',
      `object ${objectId || '(unnamed)'} rotation must be zero, got ${String(raw)}`,
    )
  }
}

function applyObjectGroupOffset(
  object: TmxInputObject,
  offsetX: number,
  offsetY: number,
): TmxInputObject {
  return {
    ...object,
    x: object.x + offsetX,
    y: object.y + offsetY,
  }
}

function nestedGroupFatal(sceneId: string, groupName: string): never {
  fatal(
    'NESTED_OBJECTGROUP_UNSUPPORTED',
    sceneId,
    groupName || '(group)',
    'layers',
    `nested group ${groupName || '(unnamed)'} is not supported by render schema v2`,
  )
}

// ── Map-level parsing ──

function duplicateJsonObjectKey(raw: string): string | undefined {
  const seen = new Set<string>()
  const keyPattern = /"((?:\\.|[^"\\])*)"\s*:/g
  for (const match of raw.matchAll(keyPattern)) {
    const key = JSON.parse(`"${match[1]}"`) as string
    if (seen.has(key)) return key
    seen.add(key)
  }
  return undefined
}

function parseFloorRegistry(
  raw: string | undefined,
  sceneId: string,
): Record<string, number> {
  if (!raw || raw.trim() === '') {
    return { ...DEFAULT_FLOOR_REGISTRY }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    fatal(
      'FLOOR_REGISTRY_INVALID_ORDER',
      sceneId,
      '(map)',
      'floorRegistry',
      `floorRegistry must be valid JSON, got: ${raw}`,
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fatal(
      'FLOOR_REGISTRY_INVALID_ORDER',
      sceneId,
      '(map)',
      'floorRegistry',
      `floorRegistry must be a JSON object, got: ${typeof parsed}`,
    )
  }

  const duplicateFloorId = duplicateJsonObjectKey(raw)
  if (duplicateFloorId !== undefined) {
    fatal(
      'FLOOR_REGISTRY_DUPLICATE',
      sceneId,
      '(map)',
      'floorRegistry',
      `duplicate floor ID in registry: ${duplicateFloorId}`,
    )
  }

  const registry: Record<string, number> = {}
  const floorIdSet = new Set<string>()
  const floorOrderSet = new Set<number>()
  for (const [floorId, orderRaw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!floorId.trim()) {
      fatal(
        'FLOOR_REGISTRY_INVALID_ORDER',
        sceneId,
        '(map)',
        'floorRegistry',
        `floor registry key must be a non-empty string, got: ${JSON.stringify(floorId)}`,
      )
    }
    if (floorIdSet.has(floorId)) {
      fatal(
        'FLOOR_REGISTRY_DUPLICATE',
        sceneId,
        '(map)',
        'floorRegistry',
        `duplicate floor ID in registry: ${floorId}`,
      )
    }
    const order = Number(orderRaw)
    if (!Number.isSafeInteger(order)) {
      fatal(
        'FLOOR_REGISTRY_INVALID_ORDER',
        sceneId,
        '(map)',
        'floorRegistry',
        `floor ${floorId} order must be an integer, got: ${String(orderRaw)}`,
      )
    }
    if (floorOrderSet.has(order)) {
      fatal(
        'FLOOR_REGISTRY_DUPLICATE',
        sceneId,
        '(map)',
        'floorRegistry',
        `duplicate floor order in registry: ${order}`,
      )
    }
    floorIdSet.add(floorId)
    floorOrderSet.add(order)
    registry[floorId] = order
  }

  return registry
}

// ── Normalize a single SceneObject from raw TMX object ──

function parseSceneObject(
  obj: TmxInputObject,
  sceneId: string,
  floorRegistry: Record<string, number>,
  stableIds: Set<string>,
): SceneObject {
  const props = obj.properties
  const objId = obj.name || '(unnamed)'
  const objectSceneId = (props.sceneId || sceneId).trim()
  if (!objectSceneId) {
    fatal('SCENE_ID_MISSING', sceneId, objId, 'sceneId', `${objId} has an empty sceneId`)
  }

  // stableId
  const stableId = (props.stableId || '').trim()
  if (!stableId) {
    fatal('STABLE_ID_MISSING', sceneId, objId, 'stableId', `object ${objId} missing stableId`)
  }
  if (!STABLE_ID_PATTERN.test(stableId)) {
    fatal('STABLE_ID_INVALID_PATTERN', sceneId, stableId, 'stableId', `stableId "${stableId}" does not match pattern ${STABLE_ID_PATTERN}`)
  }
  if (stableIds.has(stableId)) {
    fatal('STABLE_ID_DUPLICATE', sceneId, stableId, 'stableId', `duplicate stableId: ${stableId}`)
  }
  stableIds.add(stableId)

  // chunkId
  const chunkId = (props.chunkId || '').trim()
  if (!chunkId) {
    fatal('CHUNK_ID_MISSING', sceneId, stableId, 'chunkId', `missing chunkId for ${stableId}`)
  }

  // kind
  const kindRaw = (props.kind || '').trim()
  if (!kindRaw) {
    fatal('KIND_MISSING', sceneId, stableId, 'kind', `missing kind for ${stableId}`)
  }
  if (!(SCENE_OBJECT_KINDS as readonly string[]).includes(kindRaw)) {
    fatal('KIND_INVALID', sceneId, stableId, 'kind', `invalid kind "${kindRaw}" for ${stableId}`)
  }
  const kind = kindRaw as SceneObjectKind

  // renderBand
  const renderBandRaw = (props.renderBand || 'world').trim()
  if (!(RENDER_BANDS as readonly string[]).includes(renderBandRaw)) {
    fatal('RENDER_BAND_INVALID', sceneId, stableId, 'renderBand', `invalid renderBand "${renderBandRaw}" for ${stableId}`)
  }
  const renderBand = renderBandRaw as RenderBand

  // floorId
  const floorId = (props.floorId || 'floor-1').trim()
  if (!floorId) {
    fatal('FLOOR_ID_MISSING', sceneId, stableId, 'floorId', `missing floorId for ${stableId}`)
  }
  if (!(floorId in floorRegistry)) {
    fatal('FLOOR_ID_UNKNOWN', sceneId, stableId, 'floorId', `unknown floorId "${floorId}" for ${stableId}`)
  }

  // elevation
  const elevation = requireInteger(
    props.elevation ?? '0',
    sceneId, stableId, 'elevation', 'ELEVATION_INVALID',
  )

  // sortMode
  const sortModeRaw = (props.sortMode || 'fixed').trim()
  if (!(SORT_MODES as readonly string[]).includes(sortModeRaw)) {
    fatal('SORT_MODE_INVALID', sceneId, stableId, 'sortMode', `invalid sortMode "${sortModeRaw}" for ${stableId}`)
  }
  const sortMode = sortModeRaw as SortMode

  // sortAnchorX/Y are explicit world coordinates and are never inferred from
  // object origin or transformed by objectgroup offsets.
  const sortAnchorX = requireFiniteNumber(
    props.sortAnchorX,
    sceneId, stableId, 'sortAnchor.x', 'SORT_ANCHOR_INVALID',
  )
  const sortAnchorY = requireFiniteNumber(
    props.sortAnchorY,
    sceneId, stableId, 'sortAnchor.y', 'SORT_ANCHOR_INVALID',
  )
  const sortAnchor: Point = { x: sortAnchorX, y: sortAnchorY }

  // tieBias
  const tieBias = requireInteger(
    props.tieBias ?? '0',
    sceneId, stableId, 'tieBias', 'TIE_BIAS_INVALID',
  )
  if (tieBias < TIE_BIAS_MIN || tieBias > TIE_BIAS_MAX) {
    fatal('TIE_BIAS_OUT_OF_RANGE', sceneId, stableId, 'tieBias', `tieBias ${tieBias} out of range [${TIE_BIAS_MIN}, ${TIE_BIAS_MAX}]`)
  }

  // sourceEntityId (optional)
  const sourceEntityId = (props.sourceEntityId || '').trim() || undefined

  // ── render ──
  let render: SceneRender | undefined

  const hasAsset = props.assetRef !== undefined && props.assetRef !== ''
  const hasProcedural = 'rendererKey' in props

  if (hasAsset && hasProcedural) {
    fatal('RENDER_CONFLICT', sceneId, stableId, 'render', `cannot have both assetRef and rendererKey`)
  }

  if (hasAsset) {
    const assetRef = (props.assetRef || '').trim()
    if (!assetRef) {
      fatal('ASSET_REF_MISSING', sceneId, stableId, 'assetRef', `asset render missing assetRef`)
    }

    let sourceRect: Rect | undefined
    if (props.sourceRectX !== undefined) {
      sourceRect = parseRect(
        props.sourceRectX, props.sourceRectY,
        props.sourceRectW, props.sourceRectH,
        sceneId, stableId, 'sourceRect', 'SOURCE_RECT_INVALID',
      )
    }

    const destinationRect = parseRect(
      obj.x, obj.y, obj.width, obj.height,
      sceneId, stableId, 'destinationRect', 'DESTINATION_RECT_INVALID',
    )

    let anchor: Point | undefined
    if (props.anchorX !== undefined) {
      anchor = parsePoint(
        props.anchorX, props.anchorY,
        sceneId, stableId, 'anchor', 'SORT_ANCHOR_INVALID',
      )
    }

    render = {
      type: 'asset',
      assetRef,
      ...(sourceRect ? { sourceRect: normalizeRect(sourceRect) } : {}),
      destinationRect: normalizeRect(destinationRect),
      ...(anchor ? { anchor: normalizePoint(anchor) } : {}),
    }
  } else if (hasProcedural) {
    const rendererKey = (props.rendererKey || '').trim()
    if (!rendererKey) {
      fatal('RENDERER_KEY_MISSING', sceneId, stableId, 'rendererKey', `procedural render missing rendererKey`)
    }

    const destinationRect = parseRect(
      obj.x, obj.y, obj.width, obj.height,
      sceneId, stableId, 'destinationRect', 'DESTINATION_RECT_INVALID',
    )

    render = {
      type: 'procedural',
      rendererKey,
      destinationRect: normalizeRect(destinationRect),
      ...(props.styleRef ? { styleRef: props.styleRef } : {}),
    }
  } else {
    // No render: allowed (pure interaction object)
    // Also check if object has x/y/width/height – if so, it could still be a valid
    // pure interaction object
    render = undefined
  }

  // ── geometry (optional) ──
  let geometry: SceneObject['geometry'] | undefined
  if (props.geometryFootprint) {
    try {
      const pts = JSON.parse(props.geometryFootprint) as Point[]
      if (Array.isArray(pts) && pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
        geometry = { footprint: pts.map(normalizePoint) }
      }
    } catch { /* ignore invalid JSON */ }
  }

  // ── navigation (optional) ──
  let navigation: SceneObject['navigation'] | undefined
  if (props.blocksMovement !== undefined) {
    navigation = { blocksMovement: props.blocksMovement === 'true' }
  }

  // ── interaction (optional) ──
  let interaction: SceneObject['interaction'] | undefined
  if (props.hotspotId && props.panel) {
    interaction = { hotspotId: props.hotspotId, panel: props.panel }
  }

  return normalizeSceneObject({
    stableId,
    ...(sourceEntityId ? { sourceEntityId } : {}),
    sceneId: objectSceneId,
    chunkId,
    kind,
    renderBand,
    floorId,
    elevation,
    sortMode,
    sortAnchor: normalizePoint(sortAnchor),
    tieBias,
    ...(render ? { render } : {}),
    ...(geometry ? { geometry } : {}),
    ...(navigation ? { navigation } : {}),
    ...(interaction ? { interaction } : {}),
  })
}

// ── Parse OccluderFragment from raw TMX object ──

function parseOccluderFragment(
  obj: TmxInputObject,
  sceneId: string,
  floorRegistry: Record<string, number>,
  stableIds: Set<string>,
): OccluderFragment {
  const props = obj.properties
  const objId = obj.name || '(unnamed)'
  const objectSceneId = (props.sceneId || sceneId).trim()
  if (!objectSceneId) {
    fatal('SCENE_ID_MISSING', sceneId, objId, 'sceneId', `${objId} has an empty sceneId`)
  }

  // stableId
  const stableId = (props.stableId || '').trim()
  if (!stableId) {
    fatal('STABLE_ID_MISSING', sceneId, objId, 'stableId', `fragment ${objId} missing stableId`)
  }
  if (!STABLE_ID_PATTERN.test(stableId)) {
    fatal('STABLE_ID_INVALID_PATTERN', sceneId, stableId, 'stableId', `fragment stableId "${stableId}" invalid`)
  }
  if (stableIds.has(stableId)) {
    fatal('STABLE_ID_DUPLICATE', sceneId, stableId, 'stableId', `duplicate stableId: ${stableId}`)
  }
  stableIds.add(stableId)

  // chunkId
  const chunkId = (props.chunkId || '').trim()
  if (!chunkId) {
    fatal('CHUNK_ID_MISSING', sceneId, stableId, 'chunkId', `missing chunkId for fragment ${stableId}`)
  }

  // floorId
  const floorId = (props.floorId || 'floor-1').trim()
  if (!(floorId in floorRegistry)) {
    fatal('FLOOR_ID_UNKNOWN', sceneId, stableId, 'floorId', `unknown floorId "${floorId}"`)
  }

  // elevation
  const elevation = requireInteger(
    props.elevation ?? '0',
    sceneId, stableId, 'elevation', 'ELEVATION_INVALID',
  )

  // renderBand: only world or overhead
  const renderBandRaw = (props.renderBand || 'world').trim()
  if (renderBandRaw !== 'world' && renderBandRaw !== 'overhead') {
    fatal('FRAGMENT_RENDER_BAND_INVALID', sceneId, stableId, 'renderBand', `fragment renderBand must be world or overhead, got "${renderBandRaw}"`)
  }
  const renderBand: 'world' | 'overhead' = renderBandRaw

  // sortMode must be fixed
  if ((props.sortMode || 'fixed').trim() !== 'fixed') {
    fatal('FRAGMENT_SORT_MODE_INVALID', sceneId, stableId, 'sortMode', `fragment sortMode must be fixed`)
  }

  // Fragment sortAnchorX/Y use the same explicit world-coordinate contract.
  const sortAnchor = parsePoint(
    props.sortAnchorX, props.sortAnchorY,
    sceneId, stableId, 'sortAnchor', 'SORT_ANCHOR_INVALID',
  )

  // tieBias
  const tieBias = requireInteger(
    props.tieBias ?? '0',
    sceneId, stableId, 'tieBias', 'TIE_BIAS_INVALID',
  )
  if (tieBias < TIE_BIAS_MIN || tieBias > TIE_BIAS_MAX) {
    fatal('TIE_BIAS_OUT_OF_RANGE', sceneId, stableId, 'tieBias', `tieBias ${tieBias} out of range`)
  }

  // assetRef (required for fragment)
  const assetRef = (props.assetRef || '').trim()
  if (!assetRef) {
    fatal('ASSET_REF_MISSING', sceneId, stableId, 'assetRef', `fragment missing assetRef`)
  }

  // sourceRect
  const sourceRect = parseRect(
    props.sourceRectX, props.sourceRectY,
    props.sourceRectW, props.sourceRectH,
    sceneId, stableId, 'sourceRect', 'SOURCE_RECT_INVALID',
  )

  // destinationRect from TMX object position
  const destinationRect = parseRect(
    obj.x, obj.y, obj.width, obj.height,
    sceneId, stableId, 'destinationRect', 'DESTINATION_RECT_INVALID',
  )

  // visualClip (optional)
  let visualClip: Point[] | undefined
  if (props.visualClip) {
    try {
      const pts = JSON.parse(props.visualClip) as Point[]
      if (Array.isArray(pts) && pts.length >= 3 && pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
        visualClip = pts.map(normalizePoint)
      }
    } catch { /* ignore */ }
  }

  return normalizeFragment({
    stableId,
    sceneId: objectSceneId,
    chunkId,
    floorId,
    elevation,
    renderBand,
    sortMode: 'fixed',
    sortAnchor: normalizePoint(sortAnchor),
    tieBias,
    assetRef,
    sourceRect: normalizeRect(sourceRect),
    destinationRect: normalizeRect(destinationRect),
    ...(visualClip ? { visualClip } : {}),
  })
}

// ── Parse OcclusionConstraintZone ──

function parseConstraintZone(
  obj: TmxInputObject,
  sceneId: string,
  floorRegistry: Record<string, number>,
  stableIds: Set<string>,
): OcclusionConstraintZone {
  const props = obj.properties
  const objId = obj.name || '(unnamed)'
  const objectSceneId = (props.sceneId || sceneId).trim()
  if (!objectSceneId) {
    fatal('SCENE_ID_MISSING', sceneId, objId, 'sceneId', `${objId} has an empty sceneId`)
  }

  // stableId
  const stableId = (props.stableId || '').trim()
  if (!stableId) {
    fatal('STABLE_ID_MISSING', sceneId, objId, 'stableId', `zone ${objId} missing stableId`)
  }
  if (!STABLE_ID_PATTERN.test(stableId)) {
    fatal('STABLE_ID_INVALID_PATTERN', sceneId, stableId, 'stableId', `zone stableId "${stableId}" invalid`)
  }
  if (stableIds.has(stableId)) {
    fatal('STABLE_ID_DUPLICATE', sceneId, stableId, 'stableId', `duplicate stableId: ${stableId}`)
  }
  stableIds.add(stableId)

  // chunkId
  const chunkId = (props.chunkId || '').trim()
  if (!chunkId) {
    fatal('CHUNK_ID_MISSING', sceneId, stableId, 'chunkId', `missing chunkId for zone ${stableId}`)
  }

  // floorId
  const floorId = (props.floorId || 'floor-1').trim()
  if (!(floorId in floorRegistry)) {
    fatal('FLOOR_ID_UNKNOWN', sceneId, stableId, 'floorId', `unknown floorId "${floorId}"`)
  }

  // targetFragmentId
  const targetFragmentId = (props.targetFragmentId || '').trim()
  if (!targetFragmentId) {
    fatal('ZONE_TARGET_MISSING', sceneId, stableId, 'targetFragmentId', `zone missing targetFragmentId`)
  }

  // relation
  const relationRaw = (props.relation || '').trim()
  if (!(CONSTRAINT_RELATIONS as readonly string[]).includes(relationRaw)) {
    fatal('ZONE_RELATION_INVALID', sceneId, stableId, 'relation', `invalid relation "${relationRaw}"`)
  }
  const relation = relationRaw as 'behind' | 'front'

  // priority
  const priority = requireInteger(
    props.priority ?? '0',
    objectSceneId, stableId, 'priority', 'ZONE_PRIORITY_INVALID',
  )

  // polygon (TMX polygon points are object-local; property points are world-space)
  let rawPolygon: unknown
  let polygonOrigin: Point | undefined
  if (obj.polygon !== undefined) {
    rawPolygon = obj.polygon
    polygonOrigin = { x: obj.x, y: obj.y }
  } else if (props.polygon) {
    try {
      rawPolygon = JSON.parse(props.polygon) as unknown
    } catch {
      fatal('ZONE_POLYGON_INVALID', sceneId, stableId, 'polygon', `zone polygon JSON invalid`)
    }
  } else {
    fatal('ZONE_POLYGON_INVALID', sceneId, stableId, 'polygon', `zone requires a polygon`)
  }
  const polygon = normalizeBasicZonePolygon(rawPolygon, polygonOrigin, sceneId, stableId)

  // E4: Compile polygon to fixed-point and validate (fail-closed)
  validateAndCompilePolygon(polygon, sceneId, stableId)

  // bounds (AABB of polygon)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of polygon) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const bounds: Rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }

  // hysteresisPx must be 3
  const hysteresisRaw = props.hysteresisPx !== undefined ? Number(props.hysteresisPx) : HYSTERESIS_PX
  if (hysteresisRaw !== HYSTERESIS_PX) {
    fatal('ZONE_HYSTERESIS_INVALID', sceneId, stableId, 'hysteresisPx', `hysteresisPx must be ${HYSTERESIS_PX}, got ${hysteresisRaw}`)
  }

  return normalizeZone({
    stableId,
    sceneId: objectSceneId,
    chunkId,
    floorId,
    targetFragmentId,
    relation,
    priority,
    polygon: polygon.map(normalizePoint),
    bounds: normalizeRect(bounds),
    hysteresisPx: HYSTERESIS_PX,
  })
}

// ── Post-parse validation (cross-object references) ──

function validateCrossReferences(
  ir: CanonicalSceneIr,
): void {
  const fragmentIds = new Set(ir.fragments.map(f => f.stableId))
  const fragmentMap = new Map(ir.fragments.map(f => [f.stableId, f]))

  for (const zone of ir.zones) {
    const target = fragmentMap.get(zone.targetFragmentId)
    if (!target) {
      fatal(
        'ZONE_TARGET_NOT_FOUND',
        ir.sceneId,
        zone.stableId,
        'targetFragmentId',
        `zone ${zone.stableId} references unknown fragment ${zone.targetFragmentId}`,
      )
    }

    // target must be in world band
    if (target.renderBand !== 'world') {
      fatal(
        'ZONE_TARGET_NOT_WORLD',
        ir.sceneId,
        zone.stableId,
        'targetFragmentId',
        `zone ${zone.stableId} target fragment ${zone.targetFragmentId} is not in world band (is ${target.renderBand})`,
      )
    }

    // same scene
    if (target.sceneId !== zone.sceneId) {
      fatal(
        'ZONE_TARGET_CROSS_SCENE',
        ir.sceneId,
        zone.stableId,
        'targetFragmentId',
        `zone ${zone.stableId} scene ${zone.sceneId} != target scene ${target.sceneId}`,
      )
    }

    // same floor
    if (target.floorId !== zone.floorId) {
      fatal(
        'ZONE_TARGET_CROSS_FLOOR',
        ir.sceneId,
        zone.stableId,
        'targetFragmentId',
        `zone ${zone.stableId} floor ${zone.floorId} != target floor ${target.floorId}`,
      )
    }
  }
}

// ── Normalizers: enforce deterministic field order ──

function normalizePoint(p: Point): Point {
  return { x: p.x, y: p.y }
}

function normalizeRect(r: Rect): Rect {
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

function normalizeRender(r: SceneRender): SceneRender {
  if (r.type === 'asset') {
    const result: SceneRender = {
      type: 'asset',
      assetRef: r.assetRef,
      destinationRect: normalizeRect(r.destinationRect),
    }
    if (r.sourceRect) {
      ;(result as typeof r & { sourceRect?: Rect }).sourceRect = normalizeRect(r.sourceRect)
    }
    if (r.anchor) {
      ;(result as typeof r & { anchor?: Point }).anchor = normalizePoint(r.anchor)
    }
    return result
  } else {
    const result: SceneRender = {
      type: 'procedural',
      rendererKey: r.rendererKey,
      destinationRect: normalizeRect(r.destinationRect),
    }
    if (r.styleRef) {
      ;(result as typeof r & { styleRef?: string }).styleRef = r.styleRef
    }
    return result
  }
}

function normalizeSceneObject(obj: SceneObject): SceneObject {
  const result: SceneObject = {
    stableId: obj.stableId,
    sceneId: obj.sceneId,
    chunkId: obj.chunkId,
    kind: obj.kind,
    renderBand: obj.renderBand,
    floorId: obj.floorId,
    elevation: obj.elevation,
    sortMode: obj.sortMode,
    sortAnchor: normalizePoint(obj.sortAnchor),
    tieBias: obj.tieBias,
  }

  if (obj.sourceEntityId) result.sourceEntityId = obj.sourceEntityId
  if (obj.render) result.render = normalizeRender(obj.render)
  if (obj.geometry) {
    result.geometry = {}
    if (obj.geometry.footprint) result.geometry.footprint = obj.geometry.footprint.map(normalizePoint)
    if (obj.geometry.hitArea) result.geometry.hitArea = obj.geometry.hitArea.map(normalizePoint)
    if (obj.geometry.visualClip) result.geometry.visualClip = obj.geometry.visualClip.map(normalizePoint)
  }
  if (obj.navigation) result.navigation = { blocksMovement: obj.navigation.blocksMovement }
  if (obj.interaction) result.interaction = { hotspotId: obj.interaction.hotspotId, panel: obj.interaction.panel }

  return result
}

function normalizeFragment(f: OccluderFragment): OccluderFragment {
  const result: OccluderFragment = {
    stableId: f.stableId,
    sceneId: f.sceneId,
    chunkId: f.chunkId,
    floorId: f.floorId,
    elevation: f.elevation,
    renderBand: f.renderBand,
    sortMode: 'fixed',
    sortAnchor: normalizePoint(f.sortAnchor),
    tieBias: f.tieBias,
    assetRef: f.assetRef,
    sourceRect: normalizeRect(f.sourceRect),
    destinationRect: normalizeRect(f.destinationRect),
  }
  if (f.visualClip) result.visualClip = f.visualClip.map(normalizePoint)
  return result
}

function normalizeZone(z: OcclusionConstraintZone): OcclusionConstraintZone {
  return {
    stableId: z.stableId,
    sceneId: z.sceneId,
    chunkId: z.chunkId,
    floorId: z.floorId,
    targetFragmentId: z.targetFragmentId,
    relation: z.relation,
    priority: z.priority,
    polygon: z.polygon.map(normalizePoint),
    bounds: normalizeRect(z.bounds),
    hysteresisPx: HYSTERESIS_PX,
  }
}

// ── Main parse function (works on unified TmxInputMap) ──

function parseCanonicalIrFromInput(input: TmxInputMap): CanonicalSceneIr {
  const sceneId = input.properties.sceneId || 'juyiting-main'
  if (!sceneId.trim()) {
    fatal('SCENE_ID_MISSING', '(map)', '(map)', 'sceneId', 'map missing sceneId')
  }

  const renderSchemaVersion = input.properties.renderSchemaVersion || ''
  if (!renderSchemaVersion) {
    fatal('RENDER_SCHEMA_VERSION_MISSING', sceneId, '(map)', 'renderSchemaVersion', 'map missing renderSchemaVersion')
  }
  if (renderSchemaVersion !== RENDER_SCHEMA_VERSION) {
    fatal('RENDER_SCHEMA_VERSION_UNSUPPORTED', sceneId, '(map)', 'renderSchemaVersion', `unsupported renderSchemaVersion "${renderSchemaVersion}", expected "${RENDER_SCHEMA_VERSION}"`)
  }

  const floorRegistry = parseFloorRegistry(input.properties.floorRegistry, sceneId)

  const width = input.width * input.tilewidth
  const height = input.height * input.tileheight
  // coordinateWidth/Height: use map pixel dimensions as default
  const coordinateWidth = width
  const coordinateHeight = height

  const stableIds = new Set<string>()
  const objects: SceneObject[] = []
  const fragments: OccluderFragment[] = []
  const zones: OcclusionConstraintZone[] = []

  for (const layer of input.layers) {
    if (layer.type !== 'objectgroup') continue
    const layerName = layer.name

    for (const obj of layer.objects) {
      // Determine kind from layer name prefix or object type
      if (layerName.startsWith('v2-fragments') || obj.type === 'occluder-fragment' || obj.properties.kind === 'occluder-fragment') {
        fragments.push(parseOccluderFragment(obj, sceneId, floorRegistry, stableIds))
      } else if (layerName.startsWith('v2-zones') || obj.type === 'occlusion-zone' || obj.properties.kind === 'occlusion-zone') {
        zones.push(parseConstraintZone(obj, sceneId, floorRegistry, stableIds))
      } else if (layerName.startsWith('v2-') || obj.properties.stableId) {
        // Any v2- prefixed layer or object with stableId is a SceneObject
        objects.push(parseSceneObject(obj, sceneId, floorRegistry, stableIds))
      }
      // Objects without stableId in non-v2 layers are ignored (v1 objects)
    }
  }

  // Sort by stableId ASCII order
  objects.sort(stableIdSort)
  fragments.sort(stableIdSort)
  zones.sort(stableIdSort)

  const ir: CanonicalSceneIr = {
    sceneId,
    renderSchemaVersion,
    floorRegistry,
    width,
    height,
    coordinateWidth,
    coordinateHeight,
    objects,
    fragments,
    zones,
  }

  // Cross-reference validation
  validateCrossReferences(ir)

  return ir
}

// ── XML/data input adapters ──

function propertiesFromRawNode(owner: RawXmlNode): RawProperties {
  const propertiesNode = directRawChildren(owner, 'properties')[0]
  if (!propertiesNode) return {}
  const result: RawProperties = {}
  for (const property of directRawChildren(propertiesNode, 'property')) {
    const name = property.attributes.name
    if (name) result[name] = property.attributes.value ?? property.text.trim()
  }
  return result
}

function propertiesFromDomElement(owner: Element): RawProperties {
  const propertiesNode = directDomChildren(owner, 'properties')[0]
  return extractProperties(propertiesNode ?? null)
}

function pointsFromText(raw: string | undefined): Point[] | undefined {
  if (!raw?.trim()) return undefined
  return raw.trim().split(/\s+/).map(pair => {
    const [x, y] = pair.split(',').map(Number)
    return { x, y }
  })
}

function parseRawXmlTree(xml: string): RawXmlNode {
  if (!xml.trim()) {
    fatal('XML_PARSE_FAILED', '(unknown)', '(map)', 'xml', 'TMX XML input is empty')
  }

  let root: RawXmlNode | undefined
  let parseFailure: Error | undefined
  const stack: RawXmlNode[] = []
  const parser = new SaxesParser<{ xmlns: false }>({ xmlns: false })

  parser.on('opentag', tag => {
    const node: RawXmlNode = {
      name: tag.name,
      attributes: { ...tag.attributes },
      children: [],
      text: '',
    }
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else if (!root) root = node
    stack.push(node)
  })
  parser.on('text', text => {
    const current = stack[stack.length - 1]
    if (current) current.text += text
  })
  parser.on('cdata', text => {
    const current = stack[stack.length - 1]
    if (current) current.text += text
  })
  parser.on('closetag', () => {
    stack.pop()
  })
  parser.on('error', error => {
    parseFailure ??= error
  })

  try {
    parser.write(xml).close()
  } catch (error) {
    if (isStructuredFatalRenderSchemaError(error)) throw error
    parseFailure ??= error instanceof Error ? error : new Error(String(error))
  }

  if (parseFailure) {
    fatal(
      'XML_PARSE_FAILED',
      '(unknown)',
      '(map)',
      'xml',
      `TMX XML parsing failed: ${parseFailure.message}`,
    )
  }
  if (!root || root.name !== 'map') {
    fatal('XML_PARSE_FAILED', '(unknown)', '(map)', 'xml', 'TMX XML root element must be <map>')
  }
  return root
}

function objectFromRawNode(
  node: RawXmlNode,
  sceneId: string,
  offsetX: number,
  offsetY: number,
): TmxInputObject {
  const name = node.attributes.name || ''
  validateObjectRotation(node.attributes.rotation, sceneId, name)
  const polygonNode = directRawChildren(node, 'polygon')[0]
  return applyObjectGroupOffset({
    name,
    type: node.attributes.type || '',
    x: Number(node.attributes.x || '0'),
    y: Number(node.attributes.y || '0'),
    width: Number(node.attributes.width || '0'),
    height: Number(node.attributes.height || '0'),
    gid: Number(node.attributes.gid || '0') || undefined,
    properties: propertiesFromRawNode(node),
    polygon: pointsFromText(polygonNode?.attributes.points),
    ellipse: directRawChildren(node, 'ellipse').length > 0,
  }, offsetX, offsetY)
}

function inputFromRawXml(xml: string): TmxInputMap {
  const mapNode = parseRawXmlTree(xml)
  const properties = propertiesFromRawNode(mapNode)
  const sceneId = inputSceneId(properties)
  const layers: TmxInputLayer[] = []

  for (const child of mapNode.children) {
    if (child.name === 'group') nestedGroupFatal(sceneId, child.attributes.name || '')
    if (child.name !== 'objectgroup') continue
    if (child.children.some(nested => nested.name === 'group' || nested.name === 'objectgroup')) {
      nestedGroupFatal(sceneId, child.attributes.name || '')
    }
    const name = child.attributes.name || ''
    const offsetX = parseObjectGroupOffset(child.attributes.offsetx, sceneId, name, 'offsetx')
    const offsetY = parseObjectGroupOffset(child.attributes.offsety, sceneId, name, 'offsety')
    const objects = directRawChildren(child, 'object')
      .map(object => objectFromRawNode(object, sceneId, offsetX, offsetY))
    layers.push({ name, type: 'objectgroup', objects })
  }

  return {
    properties,
    layers,
    width: Number(mapNode.attributes.width || '0'),
    height: Number(mapNode.attributes.height || '0'),
    tilewidth: Number(mapNode.attributes.tilewidth || '0'),
    tileheight: Number(mapNode.attributes.tileheight || '0'),
  }
}

function objectFromDomElement(
  element: Element,
  sceneId: string,
  offsetX: number,
  offsetY: number,
): TmxInputObject {
  const name = element.getAttribute('name') || ''
  validateObjectRotation(element.getAttribute('rotation'), sceneId, name)
  const polygonNode = directDomChildren(element, 'polygon')[0]
  return applyObjectGroupOffset({
    name,
    type: element.getAttribute('type') || '',
    x: Number(element.getAttribute('x') || '0'),
    y: Number(element.getAttribute('y') || '0'),
    width: Number(element.getAttribute('width') || '0'),
    height: Number(element.getAttribute('height') || '0'),
    gid: Number(element.getAttribute('gid') || '0') || undefined,
    properties: propertiesFromDomElement(element),
    polygon: pointsFromText(polygonNode?.getAttribute('points') ?? undefined),
    ellipse: directDomChildren(element, 'ellipse').length > 0,
  }, offsetX, offsetY)
}

function inputFromXmlDocument(xmlDocument: Document): TmxInputMap {
  if (xmlDocument.getElementsByTagName('parsererror').length > 0) {
    fatal('XML_PARSE_FAILED', '(unknown)', '(map)', 'xml', 'TMX XML document contains parsererror')
  }
  const mapNode = xmlDocument.documentElement
  if (!mapNode || mapNode.tagName !== 'map') {
    fatal('XML_PARSE_FAILED', '(unknown)', '(map)', 'xml', 'TMX XML root element must be <map>')
  }

  const properties = propertiesFromDomElement(mapNode)
  const sceneId = inputSceneId(properties)
  const layers: TmxInputLayer[] = []

  for (const child of Array.from(mapNode.children)) {
    if (child.tagName === 'group') nestedGroupFatal(sceneId, child.getAttribute('name') || '')
    if (child.tagName !== 'objectgroup') continue
    if (Array.from(child.children).some(nested => nested.tagName === 'group' || nested.tagName === 'objectgroup')) {
      nestedGroupFatal(sceneId, child.getAttribute('name') || '')
    }
    const name = child.getAttribute('name') || ''
    const offsetX = parseObjectGroupOffset(child.getAttribute('offsetx'), sceneId, name, 'offsetx')
    const offsetY = parseObjectGroupOffset(child.getAttribute('offsety'), sceneId, name, 'offsety')
    const objects = directDomChildren(child, 'object')
      .map(object => objectFromDomElement(object, sceneId, offsetX, offsetY))
    layers.push({ name, type: 'objectgroup', objects })
  }

  return {
    properties,
    layers,
    width: Number(mapNode.getAttribute('width') || '0'),
    height: Number(mapNode.getAttribute('height') || '0'),
    tilewidth: Number(mapNode.getAttribute('tilewidth') || '0'),
    tileheight: Number(mapNode.getAttribute('tileheight') || '0'),
  }
}

// ── Public API: XML DOM or raw XML entry point ──

export function parseCanonicalIrFromXml(xml: Document | string): CanonicalSceneIr {
  if (typeof xml === 'string') return parseCanonicalIrFromInput(inputFromRawXml(xml))
  if (!isXmlDocument(xml)) {
    fatal('XML_PARSE_FAILED', '(unknown)', '(map)', 'xml', 'XML input must be a Document or string')
  }
  return parseCanonicalIrFromInput(inputFromXmlDocument(xml))
}

// ── Public API: melonJS / pre-parsed data entry point ──

export function parseCanonicalIrFromData(mapData: Record<string, unknown>): CanonicalSceneIr {
  const mapProperties = extractPropertiesFromData(mapData.properties)
  const sceneId = inputSceneId(mapProperties)
  const width = Number(mapData.width || '0')
  const height = Number(mapData.height || '0')
  const tilewidth = Number(mapData.tilewidth || '0')
  const tileheight = Number(mapData.tileheight || '0')

  const rawLayers = Array.isArray(mapData.layers) ? mapData.layers : []
  const layers: TmxInputLayer[] = []

  for (const rawLayer of rawLayers) {
    if (!rawLayer || typeof rawLayer !== 'object') continue
    const layer = rawLayer as Record<string, unknown>
    if (layer.type === 'group') nestedGroupFatal(sceneId, String(layer.name || ''))
    if (layer.type !== 'objectgroup') continue
    if (Array.isArray(layer.layers) && layer.layers.length > 0) {
      nestedGroupFatal(sceneId, String(layer.name || ''))
    }

    const layerName = String(layer.name || '')
    const offsetX = parseObjectGroupOffset(layer.offsetx ?? layer.offsetX, sceneId, layerName, 'offsetx')
    const offsetY = parseObjectGroupOffset(layer.offsety ?? layer.offsetY, sceneId, layerName, 'offsety')
    const rawObjects = Array.isArray(layer.objects) ? layer.objects : []
    const objects: TmxInputObject[] = []

    for (const rawObject of rawObjects) {
      if (!rawObject || typeof rawObject !== 'object') continue
      const object = rawObject as Record<string, unknown>
      const name = String(object.name || '')
      validateObjectRotation(object.rotation, sceneId, name)
      const properties = extractPropertiesFromData(object.properties)
      let polygon: Point[] | undefined
      if (Array.isArray(object.polygon)) {
        polygon = object.polygon.map(rawPoint => {
          if (!rawPoint || typeof rawPoint !== 'object' || Array.isArray(rawPoint)) {
            return { x: Number.NaN, y: Number.NaN }
          }
          const point = rawPoint as Record<string, unknown>
          return { x: Number(point.x), y: Number(point.y) }
        })
      }

      objects.push(applyObjectGroupOffset({
        name,
        type: String(object.type || ''),
        x: Number(object.x || '0'),
        y: Number(object.y || '0'),
        width: Number(object.width || '0'),
        height: Number(object.height || '0'),
        gid: object.gid ? Number(object.gid) : undefined,
        properties,
        polygon,
        ellipse: Boolean(object.ellipse),
      }, offsetX, offsetY))
    }

    layers.push({ name: layerName, type: 'objectgroup', objects })
  }

  return parseCanonicalIrFromInput({
    properties: mapProperties,
    layers,
    width,
    height,
    tilewidth,
    tileheight,
  })
}


// ── Canonical serializer ──
// Produces byte-for-byte identical JSON for equivalent inputs.
// Field order is fixed by insertion order; objects sorted by stableId.

function serializePoint(p: Point): string {
  return `{"x":${canonicalNumber(p.x)},"y":${canonicalNumber(p.y)}}`
}

function serializeRect(r: Rect): string {
  return `{"x":${canonicalNumber(r.x)},"y":${canonicalNumber(r.y)},"width":${canonicalNumber(r.width)},"height":${canonicalNumber(r.height)}}`
}

function serializeRender(r: SceneRender): string {
  if (r.type === 'asset') {
    let s = `{"type":"asset","assetRef":${JSON.stringify(r.assetRef)},"destinationRect":${serializeRect(r.destinationRect)}`
    if (r.sourceRect) s += `,"sourceRect":${serializeRect(r.sourceRect)}`
    if (r.anchor) s += `,"anchor":${serializePoint(r.anchor)}`
    s += '}'
    return s
  } else {
    let s = `{"type":"procedural","rendererKey":${JSON.stringify(r.rendererKey)},"destinationRect":${serializeRect(r.destinationRect)}`
    if (r.styleRef) s += `,"styleRef":${JSON.stringify(r.styleRef)}`
    s += '}'
    return s
  }
}

function serializePoints(pts: Point[]): string {
  return '[' + pts.map(serializePoint).join(',') + ']'
}

function serializeSceneObject(obj: SceneObject): string {
  let s = '{'
  s += `"stableId":${JSON.stringify(obj.stableId)}`
  if (obj.sourceEntityId) s += `,"sourceEntityId":${JSON.stringify(obj.sourceEntityId)}`
  s += `,"sceneId":${JSON.stringify(obj.sceneId)}`
  s += `,"chunkId":${JSON.stringify(obj.chunkId)}`
  s += `,"kind":${JSON.stringify(obj.kind)}`
  s += `,"renderBand":${JSON.stringify(obj.renderBand)}`
  s += `,"floorId":${JSON.stringify(obj.floorId)}`
  s += `,"elevation":${canonicalNumber(obj.elevation)}`
  s += `,"sortMode":${JSON.stringify(obj.sortMode)}`
  s += `,"sortAnchor":${serializePoint(obj.sortAnchor)}`
  s += `,"tieBias":${canonicalNumber(obj.tieBias)}`
  if (obj.render) s += `,"render":${serializeRender(obj.render)}`
  if (obj.geometry) {
    s += `,"geometry":{`
    const parts: string[] = []
    if (obj.geometry.footprint) parts.push(`"footprint":${serializePoints(obj.geometry.footprint)}`)
    if (obj.geometry.hitArea) parts.push(`"hitArea":${serializePoints(obj.geometry.hitArea)}`)
    if (obj.geometry.visualClip) parts.push(`"visualClip":${serializePoints(obj.geometry.visualClip)}`)
    s += parts.join(',') + '}'
  }
  if (obj.navigation) s += `,"navigation":{"blocksMovement":${obj.navigation.blocksMovement}}`
  if (obj.interaction) s += `,"interaction":{"hotspotId":${JSON.stringify(obj.interaction.hotspotId)},"panel":${JSON.stringify(obj.interaction.panel)}}`
  s += '}'
  return s
}

function serializeFragment(f: OccluderFragment): string {
  let s = '{'
  s += `"stableId":${JSON.stringify(f.stableId)}`
  s += `,"sceneId":${JSON.stringify(f.sceneId)}`
  s += `,"chunkId":${JSON.stringify(f.chunkId)}`
  s += `,"floorId":${JSON.stringify(f.floorId)}`
  s += `,"elevation":${canonicalNumber(f.elevation)}`
  s += `,"renderBand":${JSON.stringify(f.renderBand)}`
  s += `,"sortMode":"fixed"`
  s += `,"sortAnchor":${serializePoint(f.sortAnchor)}`
  s += `,"tieBias":${canonicalNumber(f.tieBias)}`
  s += `,"assetRef":${JSON.stringify(f.assetRef)}`
  s += `,"sourceRect":${serializeRect(f.sourceRect)}`
  s += `,"destinationRect":${serializeRect(f.destinationRect)}`
  if (f.visualClip) s += `,"visualClip":${serializePoints(f.visualClip)}`
  s += '}'
  return s
}

function serializeZone(z: OcclusionConstraintZone): string {
  let s = '{'
  s += `"stableId":${JSON.stringify(z.stableId)}`
  s += `,"sceneId":${JSON.stringify(z.sceneId)}`
  s += `,"chunkId":${JSON.stringify(z.chunkId)}`
  s += `,"floorId":${JSON.stringify(z.floorId)}`
  s += `,"targetFragmentId":${JSON.stringify(z.targetFragmentId)}`
  s += `,"relation":${JSON.stringify(z.relation)}`
  s += `,"priority":${canonicalNumber(z.priority)}`
  s += `,"polygon":${serializePoints(z.polygon)}`
  s += `,"bounds":${serializeRect(z.bounds)}`
  s += `,"hysteresisPx":3`
  s += '}'
  return s
}

function serializeFloorRegistry(registry: Record<string, number>): string {
  // Sort keys by ASCII for deterministic output
  const keys = Object.keys(registry).sort(asciiCompare)
  const parts = keys.map(k => `${JSON.stringify(k)}:${canonicalNumber(registry[k])}`)
  return '{' + parts.join(',') + '}'
}

export function serializeCanonicalIr(ir: CanonicalSceneIr): string {
  const parts: string[] = []
  parts.push(`"sceneId":${JSON.stringify(ir.sceneId)}`)
  parts.push(`"renderSchemaVersion":${JSON.stringify(ir.renderSchemaVersion)}`)
  parts.push(`"floorRegistry":${serializeFloorRegistry(ir.floorRegistry)}`)
  parts.push(`"width":${canonicalNumber(ir.width)}`)
  parts.push(`"height":${canonicalNumber(ir.height)}`)
  parts.push(`"coordinateWidth":${canonicalNumber(ir.coordinateWidth)}`)
  parts.push(`"coordinateHeight":${canonicalNumber(ir.coordinateHeight)}`)
  parts.push(`"objects":[${ir.objects.map(serializeSceneObject).join(',')}]`)
  parts.push(`"fragments":[${ir.fragments.map(serializeFragment).join(',')}]`)
  parts.push(`"zones":[${ir.zones.map(serializeZone).join(',')}]`)
  return '{' + parts.join(',') + '}'
}

// ── Helper: type predicate for XML DOM vs plain data ──

function isXmlDocument(input: unknown): input is Document {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as Partial<Document>
  return (
    candidate.nodeType === 9
    && candidate.documentElement?.nodeType === 1
    && candidate.documentElement.ownerDocument === input
    && typeof candidate.querySelector === 'function'
    && typeof candidate.getElementsByTagName === 'function'
    && typeof candidate.createElement === 'function'
  )
}

// ── Helper: check if input has v2 render schema ──

export function hasRenderSchemaV2(input: unknown): boolean {
  if (isXmlDocument(input)) {
    const mapNode = input.documentElement
    if (mapNode.tagName !== 'map') return false
    return propertiesFromDomElement(mapNode).renderSchemaVersion === RENDER_SCHEMA_VERSION
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false
  const props = extractPropertiesFromData((input as Record<string, unknown>).properties)
  return props.renderSchemaVersion === RENDER_SCHEMA_VERSION
}
