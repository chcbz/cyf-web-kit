export type PersonaAnimationName = 'idle' | 'walk'

export type PersonaSpriteAnimation = {
  frames: number[]
  frameMs: number
}

export type PersonaSpriteDefinition = {
  personaCode: string
  required: boolean
  src: string
  image: { width: number; height: number }
  frame: { width: number; height: number; columns: number; rows: number }
  anchor: { x: number; y: number }
  collider: { width: number; height: number; offsetX: number; offsetY: number }
  scale: number
  baseSpeed: number
  animations: Record<PersonaAnimationName, PersonaSpriteAnimation>
}

export type PersonaSpriteManifest = {
  version: string
  personas: Record<string, PersonaSpriteDefinition>
}

export const PERSONA_SPRITE_MANIFEST = {
  version: 'persona-sheets-v1',
  personas: {
    songjiang: {
      personaCode: 'songjiang', required: true,
      src: '/juyiting/sprites/persona-sheets-v1/songjiang.png',
      image: { width: 1024, height: 256 },
      frame: { width: 128, height: 128, columns: 8, rows: 2 },
      anchor: { x: 0.5, y: 0.86 },
      collider: { width: 36, height: 20, offsetX: 0, offsetY: -10 },
      scale: 0.52, baseSpeed: 96,
      animations: {
        idle: { frames: [0, 1, 2, 3], frameMs: 180 },
        walk: { frames: [8, 9, 10, 11, 12, 13, 14, 15], frameMs: 90 },
      },
    },
  },
} as const satisfies PersonaSpriteManifest
