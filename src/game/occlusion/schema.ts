// ── Frozen render-schema v2 constants ──

export const RENDER_SCHEMA_VERSION = '2' as const
export const RENDER_SCHEMA_SOURCE = 'render-schema' as const

export const RENDER_BANDS = [
  'background',
  'world',
  'overhead',
  'lighting',
  'world-ui',
  'screen-ui',
] as const
export type RenderBand = (typeof RENDER_BANDS)[number]

export const RENDER_BAND_ORDER: Record<RenderBand, number> = {
  background: 0,
  world: 100,
  overhead: 200,
  lighting: 300,
  'world-ui': 400,
  'screen-ui': 500,
}

export const SCENE_OBJECT_KINDS = [
  'agent',
  'prop',
  'occluder-fragment',
  'structure',
  'hotspot',
] as const
export type SceneObjectKind = (typeof SCENE_OBJECT_KINDS)[number]

export const SORT_MODES = ['fixed', 'y'] as const
export type SortMode = (typeof SORT_MODES)[number]

export const CONSTRAINT_RELATIONS = ['behind', 'front'] as const
export type ConstraintRelation = (typeof CONSTRAINT_RELATIONS)[number]

export const TIE_BIAS_MIN = -32
export const TIE_BIAS_MAX = 32

export const HYSTERESIS_PX = 3 as const

export const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,95}$/

// ── Default floor registry ──
// floor-1 is the only floor in the current hall; order 0 always.

export const DEFAULT_FLOOR_REGISTRY: Readonly<Record<string, number>> = Object.freeze({
  'floor-1': 0,
})

// ── Geometry primitives ──

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// ── Render discriminant union ──

export type SceneRender =
  | {
      type: 'asset'
      assetRef: string
      sourceRect?: Rect
      destinationRect: Rect
      anchor?: Point
    }
  | {
      type: 'procedural'
      rendererKey: string
      destinationRect: Rect
      styleRef?: string
    }

// ── Canonical SceneObject ──

export interface SceneObject {
  stableId: string
  sourceEntityId?: string
  sceneId: string
  chunkId: string
  kind: SceneObjectKind

  renderBand: RenderBand
  floorId: string
  elevation: number
  sortMode: SortMode
  sortAnchor: Point
  tieBias: number

  render?: SceneRender

  geometry?: {
    footprint?: Point[]
    hitArea?: Point[]
    visualClip?: Point[]
  }

  navigation?: {
    blocksMovement: boolean
  }

  interaction?: {
    hotspotId: string
    panel: string
  }
}

// ── OccluderFragment (typed collection in CanonicalSceneIr) ──

export interface OccluderFragment {
  stableId: string
  sceneId: string
  chunkId: string
  floorId: string
  elevation: number
  renderBand: 'world' | 'overhead'
  sortMode: 'fixed'
  sortAnchor: Point
  tieBias: number
  assetRef: string
  sourceRect: Rect
  destinationRect: Rect
  visualClip?: Point[]
}

// ── OcclusionConstraintZone ──

export interface OcclusionConstraintZone {
  stableId: string
  sceneId: string
  chunkId: string
  floorId: string
  targetFragmentId: string
  relation: ConstraintRelation
  priority: number
  polygon: Point[]
  bounds: Rect
  hysteresisPx: 3
}

// ── CanonicalSceneIr ──

export interface CanonicalSceneIr {
  sceneId: string
  renderSchemaVersion: string
  floorRegistry: Record<string, number>
  width: number
  height: number
  coordinateWidth: number
  coordinateHeight: number
  objects: SceneObject[]
  fragments: OccluderFragment[]
  zones: OcclusionConstraintZone[]
}

// ── Structured fatal error ──

export interface RenderSchemaError extends Error {
  code: string
  severity: 'fatal'
  source: 'render-schema'
  retryable: false
  sceneId: string
  objectId: string
  field: string
  errorCode: string
  userMessage: string
  technicalMessage: string
}

const ERROR_CODE_SET = new Set([
  'RENDER_SCHEMA_VERSION_UNKNOWN',
  'RENDER_SCHEMA_VERSION_MISSING',
  'RENDER_SCHEMA_VERSION_UNSUPPORTED',
  'STABLE_ID_MISSING',
  'STABLE_ID_INVALID_PATTERN',
  'STABLE_ID_DUPLICATE',
  'SCENE_ID_MISSING',
  'SCENE_ID_INVALID',
  'CHUNK_ID_MISSING',
  'CHUNK_ID_INVALID',
  'KIND_MISSING',
  'KIND_INVALID',
  'RENDER_BAND_MISSING',
  'RENDER_BAND_INVALID',
  'FLOOR_ID_MISSING',
  'FLOOR_ID_UNKNOWN',
  'FLOOR_REGISTRY_DUPLICATE',
  'FLOOR_REGISTRY_INVALID_ORDER',
  'ELEVATION_MISSING',
  'ELEVATION_INVALID',
  'SORT_MODE_MISSING',
  'SORT_MODE_INVALID',
  'SORT_ANCHOR_MISSING',
  'SORT_ANCHOR_INVALID',
  'TIE_BIAS_INVALID',
  'TIE_BIAS_OUT_OF_RANGE',
  'ASSET_REF_MISSING',
  'ASSET_REF_INVALID',
  'RENDERER_KEY_MISSING',
  'RENDERER_KEY_INVALID',
  'RENDER_CONFLICT',
  'DESTINATION_RECT_MISSING',
  'DESTINATION_RECT_INVALID',
  'SOURCE_RECT_INVALID',
  'FRAGMENT_RENDER_BAND_INVALID',
  'FRAGMENT_SORT_MODE_INVALID',
  'ZONE_TARGET_MISSING',
  'ZONE_TARGET_NOT_WORLD',
  'ZONE_TARGET_CROSS_SCENE',
  'ZONE_TARGET_CROSS_FLOOR',
  'ZONE_RELATION_INVALID',
  'ZONE_PRIORITY_INVALID',
  'ZONE_POLYGON_INVALID',
  'ZONE_BOUNDS_INVALID',
  'ZONE_HYSTERESIS_INVALID',
  'ZONE_TARGET_NOT_FOUND',
  'OBJECT_REFERENCE_INVALID',
] as const)

export type RenderSchemaErrorCode = (typeof ERROR_CODE_SET) extends Set<infer T> ? T : never

export function renderSchemaError(
  code: RenderSchemaErrorCode,
  sceneId: string,
  objectId: string,
  field: string,
  userMessage: string,
  technicalMessage: string,
): RenderSchemaError {
  const err = new Error(technicalMessage) as RenderSchemaError
  Object.assign(err, {
    code,
    severity: 'fatal' as const,
    source: 'render-schema' as const,
    retryable: false as const,
    sceneId,
    objectId,
    field,
    errorCode: code,
    userMessage,
    technicalMessage,
  })
  // Preserve deterministic stack for same input
  if (Error.captureStackTrace) {
    Error.captureStackTrace(err, renderSchemaError)
  }
  return err
}

export function isRenderSchemaError(value: unknown): value is RenderSchemaError {
  return (
    value instanceof Error &&
    (value as RenderSchemaError).severity === 'fatal' &&
    (value as RenderSchemaError).source === 'render-schema' &&
    typeof (value as RenderSchemaError).sceneId === 'string' &&
    typeof (value as RenderSchemaError).objectId === 'string' &&
    typeof (value as RenderSchemaError).field === 'string' &&
    typeof (value as RenderSchemaError).errorCode === 'string'
  )
}

export function isStructuredFatalRenderSchemaError(error: unknown): error is RenderSchemaError {
  return isRenderSchemaError(error)
}
