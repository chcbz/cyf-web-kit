export type PersonaAnimationName = 'idle' | 'walk'
export const PERSONA_DIRECTIONS = [
  'down', 'downRight', 'right', 'upRight', 'up', 'upLeft', 'left', 'downLeft',
] as const
export type PersonaDirection = typeof PERSONA_DIRECTIONS[number]

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
  animations: Record<PersonaAnimationName, Record<PersonaDirection, PersonaSpriteAnimation>>
}

export type PersonaSpriteManifest = {
  version: string
  personas: Record<string, PersonaSpriteDefinition>
}

const STANDARD_PERSONA_ANIMATIONS = {
  idle: {
    down: { frames: [0, 1, 2, 3], frameMs: 180 },
    downRight: { frames: [4, 5, 6, 7], frameMs: 180 },
    right: { frames: [8, 9, 10, 11], frameMs: 180 },
    upRight: { frames: [12, 13, 14, 15], frameMs: 180 },
    up: { frames: [16, 17, 18, 19], frameMs: 180 },
    upLeft: { frames: [20, 21, 22, 23], frameMs: 180 },
    left: { frames: [24, 25, 26, 27], frameMs: 180 },
    downLeft: { frames: [28, 29, 30, 31], frameMs: 180 },
  },
  walk: {
    down: { frames: [32, 33, 34, 35], frameMs: 90 },
    downRight: { frames: [36, 37, 38, 39], frameMs: 90 },
    right: { frames: [40, 41, 42, 43], frameMs: 90 },
    upRight: { frames: [44, 45, 46, 47], frameMs: 90 },
    up: { frames: [48, 49, 50, 51], frameMs: 90 },
    upLeft: { frames: [52, 53, 54, 55], frameMs: 90 },
    left: { frames: [56, 57, 58, 59], frameMs: 90 },
    downLeft: { frames: [60, 61, 62, 63], frameMs: 90 },
  },
} as const

export const PERSONA_SPRITE_MANIFEST = {
  version: 'persona-sheets-v1',
  personas: {
    songjiang: {
      personaCode: 'songjiang', required: true,
      src: '/juyiting/sprites/persona-sheets-v1/songjiang-8-direction-v3.png',
      image: { width: 1024, height: 1024 },
      frame: { width: 128, height: 128, columns: 8, rows: 8 },
      anchor: { x: 0.5, y: 0.86 },
      collider: { width: 36, height: 20, offsetX: 0, offsetY: -10 },
      scale: 0.52, baseSpeed: 96,
      animations: {
        idle: {
          down: { frames: [0, 1, 2, 3], frameMs: 180 },
          downRight: { frames: [4, 5, 6, 7], frameMs: 180 },
          right: { frames: [8, 9, 10, 11], frameMs: 180 },
          upRight: { frames: [12, 13, 14, 15], frameMs: 180 },
          up: { frames: [16, 17, 18, 19], frameMs: 180 },
          upLeft: { frames: [20, 21, 22, 23], frameMs: 180 },
          left: { frames: [24, 25, 26, 27], frameMs: 180 },
          downLeft: { frames: [28, 29, 30, 31], frameMs: 180 },
        },
        walk: {
          down: { frames: [32, 33, 34, 35], frameMs: 90 },
          downRight: { frames: [36, 37, 38, 39], frameMs: 90 },
          right: { frames: [40, 41, 42, 43], frameMs: 90 },
          upRight: { frames: [44, 45, 46, 47], frameMs: 90 },
          up: { frames: [48, 49, 50, 51], frameMs: 90 },
          upLeft: { frames: [52, 53, 54, 55], frameMs: 90 },
          left: { frames: [56, 57, 58, 59], frameMs: 90 },
          downLeft: { frames: [60, 61, 62, 63], frameMs: 90 },
        },
      },
    },
    lujunyi: {
      personaCode: 'lujunyi', required: false,
      src: '/juyiting/sprites/persona-sheets-v1/lujunyi-8-direction-v1.png',
      image: { width: 1024, height: 1024 },
      frame: { width: 128, height: 128, columns: 8, rows: 8 },
      anchor: { x: 0.5, y: 0.86 },
      collider: { width: 36, height: 20, offsetX: 0, offsetY: -10 },
      scale: 0.52, baseSpeed: 92,
      animations: STANDARD_PERSONA_ANIMATIONS,
    },
    wuyong: {
      personaCode: 'wuyong', required: false,
      src: '/juyiting/sprites/persona-sheets-v1/wuyong-8-direction-v1.png',
      image: { width: 1024, height: 1024 },
      frame: { width: 128, height: 128, columns: 8, rows: 8 },
      anchor: { x: 0.5, y: 0.86 },
      collider: { width: 34, height: 18, offsetX: 0, offsetY: -9 },
      scale: 0.5, baseSpeed: 86,
      animations: STANDARD_PERSONA_ANIMATIONS,
    },
    linchong: {
      personaCode: 'linchong', required: false,
      src: '/juyiting/sprites/persona-sheets-v1/linchong-8-direction-v1.png',
      image: { width: 1024, height: 1024 },
      frame: { width: 128, height: 128, columns: 8, rows: 8 },
      anchor: { x: 0.5, y: 0.86 },
      collider: { width: 38, height: 20, offsetX: 0, offsetY: -10 },
      scale: 0.54, baseSpeed: 100,
      animations: STANDARD_PERSONA_ANIMATIONS,
    },
    likui: {
      personaCode: 'likui', required: false,
      src: '/juyiting/sprites/persona-sheets-v1/likui-8-direction-v1.png',
      image: { width: 1024, height: 1024 },
      frame: { width: 128, height: 128, columns: 8, rows: 8 },
      anchor: { x: 0.5, y: 0.86 },
      collider: { width: 42, height: 22, offsetX: 0, offsetY: -11 },
      scale: 0.56, baseSpeed: 94,
      animations: STANDARD_PERSONA_ANIMATIONS,
    },
    husanniang: {
      personaCode: 'husanniang', required: false,
      src: '/juyiting/sprites/persona-sheets-v1/husanniang-8-direction-v1.png',
      image: { width: 1024, height: 1024 },
      frame: { width: 128, height: 128, columns: 8, rows: 8 },
      anchor: { x: 0.5, y: 0.86 },
      collider: { width: 34, height: 18, offsetX: 0, offsetY: -9 },
      scale: 0.5, baseSpeed: 102,
      animations: STANDARD_PERSONA_ANIMATIONS,
    },
  },
} as const satisfies PersonaSpriteManifest
