import type { SceneError } from '../map/mapValidation.js'
import type {
  PersonaSpriteDefinition,
  PersonaSpriteManifest,
} from './personaSpriteManifest.js'

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

/**
 * Loads each exact persona definition independently. Failures are reported as
 * degraded scene errors and never reject map readiness or substitute another
 * persona's artwork.
 */
export async function loadPersonaSprites(
  loader: PersonaSpriteAssetLoader,
  manifest: PersonaSpriteManifest,
): Promise<PersonaSpriteLoadResult> {
  const available = new Set<string>()
  const assets = new Map<string, LoadedPersonaSprite>()
  const errors: SceneError[] = []
  let requiredMissingCount = 0
  let optionalMissingCount = 0

  await Promise.all(Object.entries(manifest.personas).map(async ([personaCode, definition]) => {
    if (definition.personaCode !== personaCode) {
      recordFailure(definition, `Manifest key ${personaCode} does not match persona ${definition.personaCode}.`)
      return
    }

    try {
      const asset = await loader(definition)
      const width = asset.naturalWidth ?? asset.width
      const height = asset.naturalHeight ?? asset.height
      if (width !== definition.image.width || height !== definition.image.height) {
        recordFailure(
          definition,
          `Expected ${definition.image.width}x${definition.image.height}; received ${width ?? '?'}x${height ?? '?'}.`,
        )
        return
      }
      available.add(personaCode)
      assets.set(personaCode, asset)
    } catch (error) {
      recordFailure(definition, error instanceof Error ? error.message : String(error))
    }
  }))

  function recordFailure(definition: PersonaSpriteDefinition, technicalMessage: string): void {
    if (definition.required) requiredMissingCount += 1
    else optionalMissingCount += 1
    errors.push({
      code: definition.required ? 'REQUIRED_SPRITE_LOAD_FAILED' : 'OPTIONAL_SPRITE_LOAD_FAILED',
      severity: 'degraded',
      retryable: true,
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
