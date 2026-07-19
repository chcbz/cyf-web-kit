import type { SceneError } from '../map/mapValidation.js'
import type {
  PersonaSpriteDefinition,
  PersonaSpriteManifest,
} from './personaSpriteManifest.js'
import { PERSONA_DIRECTIONS } from './personaSpriteManifest.js'

export type LoadedPersonaSprite = {
  width?: number
  height?: number
  naturalWidth?: number
  naturalHeight?: number
}

export type PersonaSpriteAssetLoader = (
  definition: PersonaSpriteDefinition,
) => Promise<LoadedPersonaSprite>

export type PersonaSpriteLoadResult = {
  available: Set<string>
  assets: Map<string, LoadedPersonaSprite>
  degraded: boolean
  requiredMissingCount: number
  optionalMissingCount: number
  placeholderCount: 0
  errors: SceneError[]
}

export type PersonaSpriteLoadOptions = {
  timeoutMs?: number
  signal?: AbortSignal
}

const DEFAULT_SPRITE_LOAD_TIMEOUT_MS = 5_000
const SUPPORTED_RUNTIME_MANIFEST_VERSION = 'persona-sheets-v1'

/**
 * Loads each exact persona definition independently. Failures are reported as
 * degraded scene errors and never reject map readiness or substitute another
 * persona's artwork.
 */
export async function loadPersonaSprites(
  loader: PersonaSpriteAssetLoader,
  manifest: PersonaSpriteManifest,
  options: PersonaSpriteLoadOptions = {},
): Promise<PersonaSpriteLoadResult> {
  const available = new Set<string>()
  const assets = new Map<string, LoadedPersonaSprite>()
  const errors: SceneError[] = []
  let requiredMissingCount = 0
  let optionalMissingCount = 0

  await Promise.all(Object.entries(manifest.personas).map(async ([personaCode, definition]) => {
    if (manifest.version !== SUPPORTED_RUNTIME_MANIFEST_VERSION) {
      recordFailure(
        definition,
        `Unsupported sprite manifest version ${manifest.version}; expected ${SUPPORTED_RUNTIME_MANIFEST_VERSION}.`,
        false,
      )
      return
    }
    if (definition.personaCode !== personaCode) {
      recordFailure(
        definition,
        `Manifest key ${personaCode} does not match persona ${definition.personaCode}.`,
        false,
      )
      return
    }

    const configurationProblem = validateRuntimeDefinition(definition)
    if (configurationProblem) {
      recordFailure(definition, configurationProblem, false)
      return
    }

    try {
      const asset = await loadWithBounds(
        loader(definition),
        normalizeTimeout(options.timeoutMs),
        options.signal,
        definition.personaCode,
      )
      const width = asset.naturalWidth ?? asset.width
      const height = asset.naturalHeight ?? asset.height
      if (width !== definition.image.width || height !== definition.image.height) {
        recordFailure(
          definition,
          `Expected ${definition.image.width}x${definition.image.height}; received ${width ?? '?'}x${height ?? '?'}.`,
          false,
        )
        return
      }
      available.add(personaCode)
      assets.set(personaCode, asset)
    } catch (error) {
      recordFailure(definition, error instanceof Error ? error.message : String(error), true)
    }
  }))

  function recordFailure(
    definition: PersonaSpriteDefinition,
    technicalMessage: string,
    retryable: boolean,
  ): void {
    if (definition.required) requiredMissingCount += 1
    else optionalMissingCount += 1
    errors.push({
      code: definition.required ? 'REQUIRED_SPRITE_LOAD_FAILED' : 'OPTIONAL_SPRITE_LOAD_FAILED',
      severity: 'degraded',
      retryable,
      userMessage: '部分大厅人物暂时无法显示，地图仍可继续使用。',
      technicalMessage: `${definition.personaCode}: ${technicalMessage}`,
      source: 'sprites',
    })
  }

  errors.sort((left, right) => (
    left.code.localeCompare(right.code)
      || (left.technicalMessage ?? '').localeCompare(right.technicalMessage ?? '')
  ))

  return {
    available,
    assets,
    degraded: errors.length > 0,
    requiredMissingCount,
    optionalMissingCount,
    placeholderCount: 0,
    errors,
  }
}

function validateRuntimeDefinition(definition: PersonaSpriteDefinition): string | null {
  const { image, frame } = definition
  if (![image.width, image.height, frame.width, frame.height, frame.columns, frame.rows]
    .every(value => Number.isInteger(value) && value > 0)) {
    return 'Sprite image and frame configuration must use positive integer dimensions.'
  }
  if (frame.width * frame.columns !== image.width || frame.height * frame.rows !== image.height) {
    return 'Sprite frame grid does not match the configured image dimensions.'
  }
  if (!definition.src.startsWith('/') || !definition.src.toLowerCase().endsWith('.png')) {
    return 'Sprite source must be an absolute PNG path.'
  }
  if (!(definition.scale > 0) || !(definition.baseSpeed > 0)) {
    return 'Sprite scale and base speed must be positive.'
  }
  if (![definition.anchor.x, definition.anchor.y]
    .every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    return 'Sprite anchor configuration must be between zero and one.'
  }
  if (!(definition.collider.width > 0) || !(definition.collider.height > 0)
    || !Number.isFinite(definition.collider.offsetX) || !Number.isFinite(definition.collider.offsetY)) {
    return 'Sprite collider configuration is invalid.'
  }
  const frameCount = frame.columns * frame.rows
  for (const action of ['idle', 'walk'] as const) {
    for (const direction of PERSONA_DIRECTIONS) {
      const animation = definition.animations[action]?.[direction]
      if (!animation || animation.frames.length === 0
        || !Number.isInteger(animation.frameMs) || !(animation.frameMs > 0)) {
        return `Sprite ${action}.${direction} animation configuration is invalid.`
      }
      if (animation.frames.some(index => !Number.isInteger(index) || index < 0 || index >= frameCount)) {
        return `Sprite ${action}.${direction} animation frame is outside the configured frame grid.`
      }
    }
  }
  return null
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  return Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0
    ? Math.floor(timeoutMs as number)
    : DEFAULT_SPRITE_LOAD_TIMEOUT_MS
}

function loadWithBounds<T>(
  load: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  personaCode: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => finish(() => reject(new Error(`Sprite load cancelled for ${personaCode}.`)))
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Sprite load timed out after ${timeoutMs}ms for ${personaCode}.`)))
    }, timeoutMs)

    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    load.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    )
  })
}
