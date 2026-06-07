export const mapControlsConfig = [
  { key: 'up', icon: 'chevron-up', label: '上移视野', direction: 'up' },
  { key: 'left', icon: 'chevron-left', label: '左移视野', direction: 'left' },
  { key: 'center', icon: 'crosshairs-gps', label: '回到中心', direction: 'center' },
  { key: 'right', icon: 'chevron-right', label: '右移视野', direction: 'right' },
  { key: 'down', icon: 'chevron-down', label: '下移视野', direction: 'down' }
]

export const statusFilters = [
  { label: '全部', value: 'all' },
  { label: '空闲', value: 'idle' },
  { label: '忙碌', value: 'busy' },
  { label: '异常', value: 'error' }
]

export const taskStatusFilters = [
  { label: '全部', value: '' },
  { label: '待接取', value: 'open' },
  { label: '已指派', value: 'assigned' },
  { label: '进行中', value: 'running' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' }
]

export const portraitRoles = [
  { slug: 'songjiang', name: '宋江', title: '统领型', x: 0, y: 0, robe: '#7c1f1b', trim: '#f4c84c', scale: 1, step: 0.86 },
  { slug: 'wuyong', name: '吴用', title: '谋略型', x: 1, y: 0, robe: '#23483e', trim: '#d7b875', scale: 0.96, step: 0.78 },
  { slug: 'linchong', name: '林冲', title: '攻坚型', x: 2, y: 0, robe: '#3f4f78', trim: '#c08a46', scale: 1.04, step: 0.72 },
  { slug: 'luzhishen', name: '鲁智深', title: '护法型', x: 0, y: 1, robe: '#8b5a1f', trim: '#d9d0be', scale: 1.12, step: 0.92 },
  { slug: 'yanqing', name: '燕青', title: '机动型', x: 1, y: 1, robe: '#5c2d63', trim: '#7a9e7e', scale: 0.92, step: 0.62 },
  { slug: 'likui', name: '李逵', title: '先锋型', x: 2, y: 1, robe: '#6d3f1f', trim: '#b93622', scale: 1.08, step: 0.68 }
]

export const roleDialogues = {
  songjiang: [
    '诸位兄弟，先稳住阵脚。',
    '此事须从长计议。',
    '山寨事务，贵在同心。'
  ],
  wuyong: [
    '待我筹划一二。',
    '先看形势，再定人手。',
    '此计可分三步来办。'
  ],
  linchong: [
    '军令既下，便去执行。',
    '此处交给我守住。',
    '莫慌，先看破绽。'
  ],
  luzhishen: [
    '洒家看这事不难。',
    '路见不平，自当出手。',
    '先把要紧处办了。'
  ],
  yanqing: [
    '我去探一探消息。',
    '此事宜快不宜迟。',
    '且听我细说来路。'
  ],
  likui: [
    '哥哥吩咐便是！',
    '这活儿交给俺！',
    '莫磨蹭，快派俺去。'
  ],
  default: [
    '我在厅中候命。',
    '有任务尽管传来。',
    '先听各位安排。'
  ]
}

export const hallPatrolAnchors = [
  { x: 16, y: 71, radiusX: 3, radiusY: 2.5, linger: [2800, 5200] },
  { x: 18, y: 50, radiusX: 2.5, radiusY: 3, linger: [2200, 4200] },
  { x: 28, y: 32, radiusX: 3, radiusY: 2.5, linger: [1800, 3600] },
  { x: 43, y: 27, radiusX: 4, radiusY: 2.5, linger: [1800, 3400] },
  { x: 58, y: 28, radiusX: 4, radiusY: 2.5, linger: [1800, 3400] },
  { x: 74, y: 35, radiusX: 3, radiusY: 3, linger: [2000, 3600] },
  { x: 84, y: 49, radiusX: 2.5, radiusY: 3, linger: [2000, 3800] },
  { x: 80, y: 67, radiusX: 3, radiusY: 3, linger: [2600, 4800] },
  { x: 64, y: 68, radiusX: 3.5, radiusY: 2.5, linger: [2200, 4200] },
  { x: 50, y: 61, radiusX: 4, radiusY: 3, linger: [1600, 3000] },
  { x: 36, y: 66, radiusX: 3.5, radiusY: 3, linger: [2200, 4200] },
  { x: 24, y: 73, radiusX: 3, radiusY: 2.5, linger: [2600, 4800] }
]

export const hallObstacles = [
  { x: 50, y: 23, rx: 12, ry: 8, strength: 1.7 },
  { x: 8, y: 63, rx: 12, ry: 9, strength: 1.4 },
  { x: 88, y: 63, rx: 12, ry: 9, strength: 1.4 },
  { x: 84, y: 22, rx: 12, ry: 9, strength: 1.3 }
]

export const walkBounds = {
  minX: 9,
  maxX: 91,
  minY: 22,
  maxY: 84
}
