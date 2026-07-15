import type {
  PersonaAnimationName,
  PersonaSpriteAnimation,
  PersonaSpriteDefinition,
  PersonaSpriteManifest,
} from './personaSpriteManifest.js'

export function resolvePersonaSprite(
  personaCode: string,
  manifest: PersonaSpriteManifest,
): PersonaSpriteDefinition | null {
  const definition = manifest.personas[personaCode]
  if (!definition || definition.personaCode !== personaCode) return null
  return definition
}

export function resolvePersonaAnimation(
  definition: PersonaSpriteDefinition,
  requested: string,
): { name: PersonaAnimationName; animation: PersonaSpriteAnimation } {
  const name: PersonaAnimationName = requested === 'walk' ? 'walk' : 'idle'
  return { name, animation: definition.animations[name] }
}
