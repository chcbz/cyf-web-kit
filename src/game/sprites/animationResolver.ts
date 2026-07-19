import type {
  PersonaAnimationName,
  PersonaDirection,
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
  direction: PersonaDirection = 'down',
): { name: PersonaAnimationName; direction: PersonaDirection; animation: PersonaSpriteAnimation } {
  const name: PersonaAnimationName = requested === 'walk' || requested === 'busy' ? 'walk' : 'idle'
  return { name, direction, animation: definition.animations[name][direction] }
}

export function resolvePersonaDirectionFromDelta(
  dx: number,
  dy: number,
  fallback: PersonaDirection = 'down',
): PersonaDirection {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return fallback
  const index = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8
  return ['right', 'downRight', 'down', 'downLeft', 'left', 'upLeft', 'up', 'upRight'][index] as PersonaDirection
}

export function personaAnimationKey(name: PersonaAnimationName, direction: PersonaDirection): string {
  return `${name}-${direction}`
}
