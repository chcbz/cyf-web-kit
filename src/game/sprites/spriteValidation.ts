import type { PersonaSpriteDefinition, PersonaSpriteManifest } from './personaSpriteManifest.js'

export const SUPPORTED_SPRITE_MANIFEST_VERSION = 'persona-sheets-v1'
const REQUIRED_PERSONAS = ['songjiang'] as const

export type SpriteValidationErrorCode =
  | 'SPRITE_MANIFEST_VERSION_MISMATCH'
  | 'REQUIRED_SPRITE_LOAD_FAILED'
  | 'OPTIONAL_SPRITE_LOAD_FAILED'
  | 'SPRITE_SUBSTITUTION_DETECTED'

export type SpriteValidationError = {
  code: SpriteValidationErrorCode
  personaCode?: string
  message: string
}

export type SpriteAssetInspection = {
  exists: boolean
  signatureValid: boolean
  width?: number
  height?: number
}

export type SpriteValidationOptions = {
  assets?: Record<string, SpriteAssetInspection>
  substitutionCount?: number
}

export type SpriteManifestValidation = {
  valid: boolean
  manifestVersion: string
  requiredMissingCount: number
  optionalMissingCount: number
  substitutionCount: number
  errors: SpriteValidationError[]
}

export function validateSpriteManifest(
  manifest: PersonaSpriteManifest,
  options: SpriteValidationOptions = {},
): SpriteManifestValidation {
  const errors: SpriteValidationError[] = []
  const failedRequired = new Set<string>()
  const failedOptional = new Set<string>()
  let substitutionCount = normalizeSubstitutionCount(options.substitutionCount)

  if (manifest.version !== SUPPORTED_SPRITE_MANIFEST_VERSION) {
    errors.push({
      code: 'SPRITE_MANIFEST_VERSION_MISMATCH',
      message: `Expected ${SUPPORTED_SPRITE_MANIFEST_VERSION}, received ${manifest.version}.`,
    })
  }

  for (const personaCode of REQUIRED_PERSONAS) {
    const definition = manifest.personas[personaCode]
    if (!definition || !definition.required) {
      failedRequired.add(personaCode)
      errors.push({
        code: 'REQUIRED_SPRITE_LOAD_FAILED', personaCode,
        message: `Required persona ${personaCode} is missing or is not marked required.`,
      })
    }
  }

  for (const [key, definition] of Object.entries(manifest.personas)) {
    if (key !== definition.personaCode) {
      substitutionCount += 1
      errors.push({
        code: 'SPRITE_SUBSTITUTION_DETECTED', personaCode: key,
        message: `Manifest key ${key} resolves to ${definition.personaCode}.`,
      })
    }

    const problems = validateDefinition(definition)
    const asset = options.assets?.[key]
    if (options.assets && (!asset || !asset.exists)) problems.push('sprite PNG is missing')
    else if (asset?.exists) {
      if (!asset.signatureValid) problems.push('sprite PNG signature is invalid')
      if (asset.width !== definition.image.width || asset.height !== definition.image.height) {
        problems.push(
          `sprite PNG dimensions must be ${definition.image.width}x${definition.image.height}; received ${asset.width ?? '?'}x${asset.height ?? '?'}`,
        )
      }
    }

    if (problems.length > 0) {
      const failed = definition.required ? failedRequired : failedOptional
      failed.add(key)
      errors.push({
        code: definition.required ? 'REQUIRED_SPRITE_LOAD_FAILED' : 'OPTIONAL_SPRITE_LOAD_FAILED',
        personaCode: key,
        message: problems.join('; '),
      })
    }
  }

  if (substitutionCount > 0 && !errors.some(error => error.code === 'SPRITE_SUBSTITUTION_DETECTED')) {
    errors.push({
      code: 'SPRITE_SUBSTITUTION_DETECTED',
      message: `${substitutionCount} persona sprite substitution(s) were reported.`,
    })
  }

  return {
    valid: errors.length === 0,
    manifestVersion: manifest.version,
    requiredMissingCount: failedRequired.size,
    optionalMissingCount: failedOptional.size,
    substitutionCount,
    errors,
  }
}

function validateDefinition(definition: PersonaSpriteDefinition): string[] {
  const problems: string[] = []
  const { image, frame } = definition
  if (!positiveInteger(image.width) || !positiveInteger(image.height)) problems.push('image dimensions must be positive integers')
  if (![frame.width, frame.height, frame.columns, frame.rows].every(positiveInteger)) {
    problems.push('frame dimensions and grid counts must be positive integers')
  } else if (frame.width * frame.columns !== image.width || frame.height * frame.rows !== image.height) {
    problems.push('frame grid does not match image dimensions')
  }
  if (!definition.src.startsWith('/') || !definition.src.toLowerCase().endsWith('.png')) problems.push('src must be an absolute PNG path')
  if (!(definition.scale > 0) || !(definition.baseSpeed > 0)) problems.push('scale and baseSpeed must be positive')
  if (![definition.anchor.x, definition.anchor.y].every(unitInterval)) problems.push('anchor values must be between 0 and 1')
  if (!(definition.collider.width > 0) || !(definition.collider.height > 0)) problems.push('collider dimensions must be positive')

  const frameCount = frame.columns * frame.rows
  for (const action of ['idle', 'walk'] as const) {
    const animation = definition.animations[action]
    if (!animation || animation.frames.length === 0) {
      problems.push(`${action} animation must contain frames`)
      continue
    }
    if (!positiveInteger(animation.frameMs)) problems.push(`${action} frameMs must be a positive integer`)
    if (animation.frames.some(index => !Number.isInteger(index) || index < 0 || index >= frameCount)) {
      problems.push(`${action} animation contains an out-of-bounds frame`)
    }
  }
  return problems
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function unitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function normalizeSubstitutionCount(value: number | undefined): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value as number : 0
}
