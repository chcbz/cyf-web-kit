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
  // Must be byte-identical across serializations.
  // Use toFixed for integers, avoid exponential notation.
  if (Number.isSafeInteger(n)) return String(n)
  // For non-integers, use enough precision to round-trip but no exponential
  const s = n.toFixed(10)
  // Strip trailing zeros after decimal, but keep at least one digit
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0')
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
    FLOOR_REGISTRY_INVALID_ORDER: 'floor registry order 仅支持非负整数。',
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
    ZONE_PRIORITY_INVALID: 'zone priority 必须为有限数值。',
    ZONE_POLYGON_INVALID: 'zone polygon 至少需要 3 个有效点。',
    ZONE_BOUNDS_INVALID: 'zone bounds 无效。',
    ZONE_HYSTERESIS_INVALID: 'zone hysteresisPx 必须为 3。',
    ZONE_TARGET_NOT_FOUND: 'zone target fragment 未在 fragments 中找到。',
    OBJECT_REFERENCE_INVALID: '对象引用无效。',
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

// ── Map-level parsing ──

function parseFloorRegistry(
  raw: string | undefined,
  sceneId: string,
): Record<string, number> {
  if (!raw || raw.trim() === '') {
    // Default registry
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

  const registry: Record<string, number> = {}
  const seenOrders = new Set<string>()
  for (const [floorId, orderRaw] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof floorId !== 'string' || floorId.trim() === '') {
      fatal(
        'FLOOR_REGISTRY_INVALID_ORDER',
        sceneId,
        '(map)',
        'floorRegistry',
        `floor registry key must be a non-empty string, got: ${JSON.stringify(floorId)}`,
      )
    }
    if (seenOrders.has(floorId)) {
      fatal(
        'FLOOR_REGISTRY_DUPLICATE',
        sceneId,
        '(map)',
        'floorRegistry',
        `duplicate floor ID in registry: ${floorId}`,
      )
    }
    const order = Number(orderRaw)
    if (!Number.isSafeInteger(order) || order < 0) {
      fatal(
        'FLOOR_REGISTRY_INVALID_ORDER',
        sceneId,
        '(map)',
        'floorRegistry',
        `floor ${floorId} order must be a non-negative integer, got: ${orderRaw}`,
      )
    }
    seenOrders.add(floorId)
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

  // sortAnchor (explicit, never inferred)
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
    sceneId,
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

  // sortAnchor
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
    sceneId,
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
  const priority = requireFiniteNumber(
    props.priority ?? '0',
    sceneId, stableId, 'priority', 'ZONE_PRIORITY_INVALID',
  )

  // polygon (from TMX polygon element or object properties)
  let polygon: Point[]
  if (obj.polygon && obj.polygon.length >= 3) {
    // TMX polygon points are relative to object origin
    polygon = obj.polygon.map(p => ({ x: obj.x + p.x, y: obj.y + p.y }))
  } else if (props.polygon) {
    try {
      const pts = JSON.parse(props.polygon) as Point[]
      if (Array.isArray(pts) && pts.length >= 3 && pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
        polygon = pts
      } else {
        fatal('ZONE_POLYGON_INVALID', sceneId, stableId, 'polygon', `zone polygon must have at least 3 valid points`)
      }
    } catch {
      fatal('ZONE_POLYGON_INVALID', sceneId, stableId, 'polygon', `zone polygon JSON invalid`)
    }
  } else {
    fatal('ZONE_POLYGON_INVALID', sceneId, stableId, 'polygon', `zone requires a polygon`)
  }

  if (polygon.length < 3) {
    fatal('ZONE_POLYGON_INVALID', sceneId, stableId, 'polygon', `zone polygon needs at least 3 points, got ${polygon.length}`)
  }

  // Deduplicate consecutive trailing vertex that equals the first
  if (polygon.length > 3) {
    const first = polygon[0]
    const last = polygon[polygon.length - 1]
    if (first.x === last.x && first.y === last.y) {
      polygon = polygon.slice(0, -1)
    }
  }

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
    sceneId,
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

// ── Public API: XML DOM entry point ──

export function parseCanonicalIrFromXml(xmlDoc: Document): CanonicalSceneIr {
  const mapNode = xmlDoc.querySelector('map')
  if (!mapNode) {
    throw renderSchemaError(
      'SCENE_ID_MISSING',
      '(unknown)',
      '(map)',
      'mapNode',
      'XML document missing <map> element',
      'TMX XML missing root <map> element',
    )
  }

  // Parse map-level properties
  const propsNode = mapNode.querySelector('properties')
  const mapProperties = extractProperties(propsNode)

  const width = Number(mapNode.getAttribute('width') || '0')
  const height = Number(mapNode.getAttribute('height') || '0')
  const tilewidth = Number(mapNode.getAttribute('tilewidth') || '0')
  const tileheight = Number(mapNode.getAttribute('tileheight') || '0')

  // Parse object layers
  const layers: TmxInputLayer[] = []
  mapNode.querySelectorAll('objectgroup').forEach((group) => {
    const layerName = group.getAttribute('name') || ''
    const objects: TmxInputObject[] = []

    group.querySelectorAll('object').forEach((objEl) => {
      const objProps = extractProperties(objEl.querySelector('properties'))

      // Parse polygon if present
      let polygon: Point[] | undefined
      const polyEl = objEl.querySelector('polygon')
      if (polyEl) {
        const pointsStr = polyEl.getAttribute('points') || ''
        const pts = pointsStr.split(/\s+/).filter(Boolean).map(p => {
          const [px, py] = p.split(',').map(Number)
          return { x: px, y: py }
        })
        if (pts.length >= 3) polygon = pts
      }

      objects.push({
        name: objEl.getAttribute('name') || '',
        type: objEl.getAttribute('type') || '',
        x: Number(objEl.getAttribute('x') || '0'),
        y: Number(objEl.getAttribute('y') || '0'),
        width: Number(objEl.getAttribute('width') || '0'),
        height: Number(objEl.getAttribute('height') || '0'),
        gid: Number(objEl.getAttribute('gid') || '0') || undefined,
        properties: objProps,
        polygon,
        ellipse: objEl.querySelector('ellipse') !== null,
      })
    })

    layers.push({ name: layerName, type: 'objectgroup', objects })
  })

  return parseCanonicalIrFromInput({
    properties: mapProperties,
    layers,
    width,
    height,
    tilewidth,
    tileheight,
  })
}

// ── Public API: melonJS / pre-parsed data entry point ──

export function parseCanonicalIrFromData(mapData: Record<string, unknown>): CanonicalSceneIr {
  const mapProperties = extractPropertiesFromData(mapData.properties)

  const width = Number(mapData.width || '0')
  const height = Number(mapData.height || '0')
  const tilewidth = Number(mapData.tilewidth || '0')
  const tileheight = Number(mapData.tileheight || '0')

  const rawLayers = Array.isArray(mapData.layers) ? mapData.layers : []
  const layers: TmxInputLayer[] = []

  for (const rawLayer of rawLayers) {
    const layer = rawLayer as Record<string, unknown>
    if (layer.type !== 'objectgroup') continue

    const layerName = String(layer.name || '')
    const rawObjects = Array.isArray(layer.objects) ? layer.objects : []
    const objects: TmxInputObject[] = []

    for (const rawObj of rawObjects) {
      const obj = rawObj as Record<string, unknown>
      const objProperties = extractPropertiesFromData(obj.properties)

      // Parse polygon from melonJS data
      let polygon: Point[] | undefined
      if (Array.isArray(obj.polygon) && obj.polygon.length >= 3) {
        polygon = (obj.polygon as Array<{ x: number; y: number }>).map(p => ({ x: p.x, y: p.y }))
      }

      objects.push({
        name: String(obj.name || ''),
        type: String(obj.type || ''),
        x: Number(obj.x || '0'),
        y: Number(obj.y || '0'),
        width: Number(obj.width || '0'),
        height: Number(obj.height || '0'),
        gid: obj.gid ? Number(obj.gid) : undefined,
        properties: objProperties,
        polygon,
        ellipse: Boolean(obj.ellipse),
      })
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

// ── Helper: check if input has v2 render schema ──

export function hasRenderSchemaV2(input: Document | Record<string, unknown>): boolean {
  if (typeof (input as Document).querySelector === "function" && (input as Document).nodeType !== undefined) {
    const mapNode = input.querySelector('map')
    if (!mapNode) return false
    const propsNode = mapNode.querySelector('properties')
    const props = extractProperties(propsNode)
    return props.renderSchemaVersion === RENDER_SCHEMA_VERSION
  }
  // melonJS data
  const props = extractPropertiesFromData((input as Record<string, unknown>).properties)
  return props.renderSchemaVersion === RENDER_SCHEMA_VERSION
}
