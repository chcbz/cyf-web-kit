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

export const quickActions = [
  { key: 'summon', icon: 'bell-outline', label: '点将', text: '请各位好汉报上当前状态和可接任务。' },
  { key: 'bounty', icon: 'format-list-checkbox', label: '看榜', text: '请汇总当前悬赏榜中最适合优先处理的任务。' },
  { key: 'review', icon: 'check-circle-outline', label: '复盘', text: '请复盘最近一次任务协作，列出风险和下一步。' },
  { key: 'tea', icon: 'message-text-outline', label: '闲谈', text: '今日聚义厅中，哪位好汉有新的见闻？' }
]

export const portraitRoles = [
  { slug: 'songjiang', name: '宋江', title: '统领型', x: 0, y: 0, robe: '#7c1f1b', trim: '#f4c84c', scale: 1, step: 0.86 },
  { slug: 'wuyong', name: '吴用', title: '谋略型', x: 1, y: 0, robe: '#23483e', trim: '#d7b875', scale: 0.96, step: 0.78 },
  { slug: 'linchong', name: '林冲', title: '攻坚型', x: 2, y: 0, robe: '#3f4f78', trim: '#c08a46', scale: 1.04, step: 0.72 },
  { slug: 'luzhishen', name: '鲁智深', title: '护法型', x: 0, y: 1, robe: '#8b5a1f', trim: '#d9d0be', scale: 1.12, step: 0.92 },
  { slug: 'yanqing', name: '燕青', title: '机动型', x: 1, y: 1, robe: '#5c2d63', trim: '#7a9e7e', scale: 0.92, step: 0.62 },
  { slug: 'likui', name: '李逵', title: '先锋型', x: 2, y: 1, robe: '#6d3f1f', trim: '#b93622', scale: 1.08, step: 0.68 }
]

export const hallRoutes = [
  [[12, 72], [16, 45], [34, 28], [62, 28], [82, 44], [86, 70], [58, 73], [28, 76]],
  [[18, 38], [38, 24], [72, 30], [86, 50], [78, 70], [63, 62], [42, 61], [22, 68]],
  [[78, 36], [58, 24], [31, 30], [14, 52], [24, 72], [41, 64], [61, 62], [84, 68]],
  [[27, 80], [18, 64], [26, 43], [48, 31], [73, 40], [84, 58], [70, 76], [43, 78]],
  [[52, 24], [78, 33], [88, 52], [73, 66], [61, 55], [39, 55], [25, 66], [12, 50]],
  [[15, 58], [24, 33], [49, 24], [77, 34], [86, 62], [66, 73], [50, 60], [34, 73]]
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
