export const MAIN_HALL_FOCUS = Object.freeze({ x: 832, y: 390 } as const)

export const VIEW_PRESETS = Object.freeze({
  mobilePortrait: Object.freeze({ id: 'main-hall-mobile', zoom: 1.25 } as const),
  mobileLandscape: Object.freeze({ id: 'main-hall-mobile-landscape', zoom: 1.05 } as const),
  tabletLandscape: Object.freeze({ id: 'main-hall-tablet-landscape', zoom: 0.92 } as const),
  desktop: Object.freeze({ id: 'main-hall-desktop', zoom: 0.84 } as const)
} as const)

export const MAIN_HALL_PRESETS = Object.freeze({
  mobilePortrait: Object.freeze({ ...VIEW_PRESETS.mobilePortrait, focus: MAIN_HALL_FOCUS }),
  mobileLandscape: Object.freeze({ ...VIEW_PRESETS.mobileLandscape, focus: MAIN_HALL_FOCUS }),
  tabletLandscape: Object.freeze({ ...VIEW_PRESETS.tabletLandscape, focus: MAIN_HALL_FOCUS }),
  desktop: Object.freeze({ ...VIEW_PRESETS.desktop, focus: MAIN_HALL_FOCUS })
} as const)

export type ViewPresetKey = keyof typeof VIEW_PRESETS

type PresetViewport = { width: number; height: number }

const TABLET_LANDSCAPE_MIN_WIDTH = 900

export const selectViewPreset = (
  viewport: PresetViewport,
  coarsePointer: boolean
): ViewPresetKey => {
  if (!coarsePointer) return 'desktop'

  const width = Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 0
  const height = Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : 0
  if (width <= height) return 'mobilePortrait'
  return width >= TABLET_LANDSCAPE_MIN_WIDTH ? 'tabletLandscape' : 'mobileLandscape'
}
