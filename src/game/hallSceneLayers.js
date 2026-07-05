export const HALL_SCENE_IMAGE_LAYERS = [
  {
    id: 'baseClean',
    resourceName: 'liangshan-hall-base-clean',
    src: '/juyiting/images/liangshan-hall-base-clean-v3.png',
    depth: 0,
    optional: false
  },
  {
    id: 'midOccluders',
    resourceName: 'liangshan-hall-mid-occluders',
    src: '/juyiting/images/liangshan-hall-mid-occluders-v3.png',
    depth: 2,
    optional: true
  },
  {
    id: 'foregroundOccluders',
    resourceName: 'liangshan-hall-foreground-occluders',
    src: '/juyiting/images/liangshan-hall-foreground-occluders-v3.png',
    depth: 5,
    optional: true
  },
  {
    id: 'lightingOverlay',
    resourceName: 'liangshan-hall-lighting-overlay',
    src: '/juyiting/images/liangshan-hall-lighting-overlay-v3.png',
    depth: 8,
    optional: true,
    blendMode: 'screen'
  }
]

export const HALL_SCENE_PROP_LAYERS = [
  {
    id: 'prop-main-seat',
    hotspotId: 'mainSeat',
    resourceName: 'liangshan-hall-prop-main-seat',
    src: '/juyiting/images/props/liangshan-hall-prop-main-seat-v3.png',
    depth: 4
  },
  {
    id: 'prop-bounty-board',
    hotspotId: 'bountyBoard',
    resourceName: 'liangshan-hall-prop-bounty-board',
    src: '/juyiting/images/props/liangshan-hall-prop-bounty-board-v3.png',
    depth: 4
  },
  {
    id: 'prop-library-shelf',
    hotspotId: 'libraryShelf',
    resourceName: 'liangshan-hall-prop-library-shelf',
    src: '/juyiting/images/props/liangshan-hall-prop-library-shelf-v3.png',
    depth: 4
  },
  {
    id: 'prop-agent-roster',
    hotspotId: 'agentRoster',
    resourceName: 'liangshan-hall-prop-agent-roster',
    src: '/juyiting/images/props/liangshan-hall-prop-agent-roster-v3.png',
    depth: 4
  },
  {
    id: 'prop-gate',
    hotspotId: 'gate',
    resourceName: 'liangshan-hall-prop-gate',
    src: '/juyiting/images/props/liangshan-hall-prop-gate-v2.png',
    depth: 4
  }
]

export const HALL_SCENE_RENDER_LAYERS = HALL_SCENE_IMAGE_LAYERS
  .concat(HALL_SCENE_PROP_LAYERS)
  .slice()
  .sort((a, b) => a.depth - b.depth)

export const HALL_SCENE_LAYER_RESOURCES = HALL_SCENE_RENDER_LAYERS.map(layer => ({
  name: layer.resourceName,
  type: 'image',
  src: layer.src
}))
