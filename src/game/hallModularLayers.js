export const HALL_MODULAR_ENVIRONMENT_LAYERS = [
  {
    id: 'hall-wall-back',
    resourceName: 'juyiting-modular-hall-wall-back',
    src: '/juyiting/images/modular/hall-wall-back-v1.png',
    depth: 0,
    defaultX: 0,
    defaultY: 0,
    defaultScale: 1,
    kind: 'environment'
  },
  {
    id: 'hall-floor',
    resourceName: 'juyiting-modular-hall-floor',
    src: '/juyiting/images/modular/hall-floor-v1.png',
    depth: 1,
    defaultX: 0,
    defaultY: 414,
    defaultScale: 1,
    sourceX: 0,
    sourceY: 414,
    sourceW: 1672,
    sourceH: 527,
    kind: 'environment'
  }
]

export const HALL_MODULAR_PROP_LAYERS = [
  {
    id: 'prop-main-seat',
    resourceName: 'juyiting-modular-prop-main-seat',
    src: '/juyiting/images/modular/prop-main-seat-v1.png',
    depth: 3,
    defaultX: 686,
    defaultY: 132,
    defaultScale: 0.22,
    kind: 'prop'
  },
  {
    id: 'prop-table-desk',
    resourceName: 'juyiting-modular-prop-table-desk',
    src: '/juyiting/images/modular/prop-table-desk-v1.png',
    depth: 4,
    defaultX: 686,
    defaultY: 452,
    defaultScale: 0.23,
    kind: 'prop'
  },
  {
    id: 'prop-bounty-board',
    resourceName: 'juyiting-modular-prop-bounty-board',
    src: '/juyiting/images/modular/prop-bounty-board-v1.png',
    depth: 3,
    defaultX: 1237,
    defaultY: 245,
    defaultScale: 0.16,
    kind: 'prop'
  },
  {
    id: 'prop-library-shelf',
    resourceName: 'juyiting-modular-prop-library-shelf',
    src: '/juyiting/images/modular/prop-library-shelf-v1.png',
    depth: 3,
    defaultX: 1221,
    defaultY: 452,
    defaultScale: 0.20,
    kind: 'prop'
  },
  {
    id: 'prop-roster-book',
    resourceName: 'juyiting-modular-prop-roster-book',
    src: '/juyiting/images/modular/prop-roster-book-v1.png',
    depth: 4,
    defaultX: 217,
    defaultY: 489,
    defaultScale: 0.14,
    kind: 'prop'
  },
  {
    id: 'prop-gate',
    resourceName: 'juyiting-modular-prop-gate',
    src: '/juyiting/images/modular/prop-gate-v1.png',
    depth: 2,
    defaultX: 686,
    defaultY: 649,
    defaultScale: 0.20,
    kind: 'prop'
  }
]

export const HALL_MODULAR_RENDER_LAYERS = HALL_MODULAR_ENVIRONMENT_LAYERS
  .concat(HALL_MODULAR_PROP_LAYERS)
  .slice()
  .sort((a, b) => a.depth - b.depth)

export const HALL_MODULAR_LAYER_RESOURCES = HALL_MODULAR_RENDER_LAYERS.map(layer => ({
  name: layer.resourceName,
  type: 'image',
  src: layer.src
}))
