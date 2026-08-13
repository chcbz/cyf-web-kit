/**
 * HallScene integration depth bands.
 *
 * E7 owns the logical, contiguous 0..N world order. HallScene maps that order
 * into the production render tree so the opaque tile base, lighting, and UI
 * remain independent render bands. Keep this integration policy outside the
 * frozen E7 sceneActivation/schema contracts.
 */
export const HALL_SCENE_DEPTH_BANDS = Object.freeze({
  BASE_MIN: 0,
  BASE_MAX_EXCLUSIVE: 100,
  V2_WORLD_START: 100,
  V2_WORLD_STRIDE: 1,
  // E16A P2: fail-closed fixed error-state band. These are static render
  // depths only (no Y sort, no mask, no declaration order). They keep the
  // complete fallback scene readable: props and agents sit above the legacy
  // foreground layer (5) and below lighting (8).
  ERROR_STATE_PROP_DEPTH: 6,
  ERROR_STATE_AGENT_DEPTH: 7,
  LIGHTING: 300,
  WORLD_UI: 400,
  SCREEN_UI: 500,
})

export const HALL_SCENE_LEGACY_OCCLUDER_LAYERS = Object.freeze([
  'mid-occluders',
  'foreground-occluders',
])

export function hallV2WorldDepth (logicalDepth) {
  if (!Number.isSafeInteger(logicalDepth) || logicalDepth < 0) {
    throw new TypeError(`HallScene V2 logical depth must be a non-negative safe integer; got ${logicalDepth}`)
  }
  const depth = HALL_SCENE_DEPTH_BANDS.V2_WORLD_START + logicalDepth * HALL_SCENE_DEPTH_BANDS.V2_WORLD_STRIDE
  if (!Number.isSafeInteger(depth) || depth >= HALL_SCENE_DEPTH_BANDS.LIGHTING) {
    throw new RangeError(`HallScene V2 world depth ${depth} escapes the world band`)
  }
  return depth
}
