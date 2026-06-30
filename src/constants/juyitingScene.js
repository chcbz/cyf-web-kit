export const HALL_SCENE_REGIONS = {
  mainSeat: {
    id: 'mainSeat',
    label: '主位',
    bounds: { x1: 43, y1: 25, x2: 57, y2: 36 },
    anchor: { x: 50, y: 34 },
    depthOffset: -8
  },
  councilTable: {
    id: 'councilTable',
    label: '议事区',
    bounds: { x1: 39, y1: 50, x2: 61, y2: 66 },
    anchor: { x: 50, y: 60 },
    depthOffset: 0
  },
  bountyBoard: {
    id: 'bountyBoard',
    label: '悬赏榜',
    bounds: { x1: 68, y1: 50, x2: 84, y2: 65 },
    anchor: { x: 76, y: 61 },
    depthOffset: 1
  },
  libraryShelf: {
    id: 'libraryShelf',
    label: '案卷阁',
    bounds: { x1: 66, y1: 67, x2: 90, y2: 86 },
    anchor: { x: 78, y: 77 },
    depthOffset: 2
  },
  gate: {
    id: 'gate',
    label: '大门',
    bounds: { x1: 45, y1: 74, x2: 57, y2: 84 },
    anchor: { x: 51, y: 80 },
    depthOffset: 3
  },
  leftGuard: {
    id: 'leftGuard',
    label: '点将册',
    bounds: { x1: 18, y1: 45, x2: 36, y2: 66 },
    anchor: { x: 28, y: 62 },
    depthOffset: 0
  },
  rightGuard: {
    id: 'rightGuard',
    label: '右侧巡守',
    bounds: { x1: 60, y1: 51, x2: 72, y2: 72 },
    anchor: { x: 65, y: 63 },
    depthOffset: 0
  },
  idleFloor: {
    id: 'idleFloor',
    label: '大厅空地',
    bounds: { x1: 38, y1: 61, x2: 62, y2: 79 },
    anchor: { x: 50, y: 72 },
    depthOffset: 0
  }
}

export const HALL_FEATURED_HEROES = [
  {
    agentId: 'songjiang',
    personaCode: 'songjiang',
    name: '宋江',
    title: '及时雨',
    regionId: 'mainSeat',
    anchor: { x: 50, y: 45 },
    facing: 'right'
  },
  {
    agentId: 'linchong',
    personaCode: 'linchong',
    name: '林冲',
    title: '豹子头',
    regionId: 'leftGuard',
    anchor: { x: 34, y: 63 },
    facing: 'right'
  },
  {
    agentId: 'wuyong',
    personaCode: 'wuyong',
    name: '吴用',
    title: '智多星',
    regionId: 'councilTable',
    anchor: { x: 47, y: 58 },
    facing: 'right'
  },
  {
    agentId: 'likui',
    personaCode: 'likui',
    name: '李逵',
    title: '黑旋风',
    regionId: 'gate',
    anchor: { x: 44, y: 79 },
    facing: 'right'
  },
  {
    agentId: 'husanniang',
    personaCode: 'husanniang',
    name: '扈三娘',
    title: '一丈青',
    regionId: 'rightGuard',
    anchor: { x: 65, y: 64 },
    facing: 'left'
  },
  {
    agentId: 'lujunyi',
    personaCode: 'lujunyi',
    name: '卢俊义',
    title: '玉麒麟',
    regionId: 'councilTable',
    anchor: { x: 56, y: 58 },
    facing: 'left'
  }
]

export const HALL_SCENE_HOTSPOTS = [
  { id: 'mainSeat', panel: 'chat', regionId: 'mainSeat', label: '忠义堂公议', x: 50, y: 30 },
  { id: 'agentRoster', panel: 'agents', regionId: 'leftGuard', label: '点将册', x: 25, y: 52 },
  { id: 'bountyBoard', panel: 'tasks', regionId: 'bountyBoard', label: '悬赏榜', x: 78, y: 47 },
  { id: 'personaCatalog', panel: 'catalog', regionId: 'leftGuard', label: '招贤令', x: 8, y: 72 },
  { id: 'libraryShelf', panel: 'library', regionId: 'libraryShelf', label: '案卷阁', x: 78, y: 77 }
]

export const HALL_CHARACTER_VISUALS = {
  songjiang: {
    visualKey: 'songjiang',
    defaultRegion: 'mainSeat',
    prop: 'scroll',
    idleStyle: 'commanding'
  },
  linchong: {
    visualKey: 'linchong',
    defaultRegion: 'leftGuard',
    prop: 'spear',
    idleStyle: 'guard'
  },
  wuyong: {
    visualKey: 'wuyong',
    defaultRegion: 'councilTable',
    prop: 'fan',
    idleStyle: 'thinking'
  },
  likui: {
    visualKey: 'likui',
    defaultRegion: 'gate',
    prop: 'axes',
    idleStyle: 'heavy'
  },
  husanniang: {
    visualKey: 'husanniang',
    defaultRegion: 'rightGuard',
    prop: 'dual-blades',
    idleStyle: 'alert'
  },
  lujunyi: {
    visualKey: 'lujunyi',
    defaultRegion: 'councilTable',
    prop: 'polearm',
    idleStyle: 'noble'
  },
  default: {
    visualKey: 'default',
    defaultRegion: 'idleFloor',
    prop: 'none',
    idleStyle: 'idle'
  }
}

export const HALL_BUBBLE_PRESETS = {
  speech: { ttlMs: 5000, maxLength: 28 },
  task: { ttlMs: 4200, maxLength: 20 },
  system: { ttlMs: 3800, maxLength: 18 },
  error: { ttlMs: 6000, maxLength: 24 }
}

export const HALL_SCENE_MAX_PROMINENT_MOTION = 4
