export const mapControlsConfig = [
  { key: 'up', icon: 'chevron-up', label: '上移视野', direction: 'up' },
  { key: 'left', icon: 'chevron-left', label: '左移视野', direction: 'left' },
  { key: 'center', icon: 'crosshairs-gps', label: '回到中心', direction: 'center' },
  { key: 'right', icon: 'chevron-right', label: '右移视野', direction: 'right' },
  { key: 'down', icon: 'chevron-down', label: '下移视野', direction: 'down' }
]

export const statusFilters = [
  { label: '全寨', value: 'all' },
  { label: '候命', value: 'online' },
  { label: '办事', value: 'busy' },
  { label: '出征', value: 'offline' },
  { label: '失联', value: 'error' }
]

export const taskStatusFilters = [
  { label: '全榜', value: '' },
  { label: '待点将', value: 'open' },
  { label: '已点将', value: 'assigned' },
  { label: '在办', value: 'running' },
  { label: '交令', value: 'completed' },
  { label: '失手', value: 'failed' },
  { label: '入档', value: 'archived' }
]

export const hallRoomPropVisuals = [
  {
    key: 'main',
    className: 'prop-main-seat',
    atlas: { columns: 3, rows: 2, column: 0, row: 0 },
    style: { left: 50, top: 32, width: 23, height: 16 }
  },
  {
    key: 'agents',
    className: 'prop-roster-rack',
    atlas: { columns: 3, rows: 2, column: 1, row: 0 },
    style: { left: 25, top: 38, width: 20, height: 18 }
  },
  {
    key: 'tasks',
    className: 'prop-bounty-board',
    atlas: { columns: 3, rows: 2, column: 2, row: 0 },
    style: { left: 77, top: 37, width: 20, height: 18 }
  },
  {
    key: 'catalog',
    className: 'prop-recruit-drum',
    atlas: { columns: 3, rows: 2, column: 0, row: 1 },
    style: { left: 24, top: 69, width: 18, height: 18 }
  },
  {
    key: 'library',
    className: 'prop-library-shelf',
    atlas: { columns: 3, rows: 2, column: 1, row: 1 },
    style: { left: 68, top: 69, width: 20, height: 18 }
  },
  {
    key: 'back',
    className: 'prop-rear-armory',
    atlas: { columns: 3, rows: 2, column: 2, row: 1 },
    style: { left: 51, top: 79, width: 18, height: 18 }
  }
]

export const roleCostumeVisuals = {
  songjiang: { column: 0, row: 0, scale: 1.06 },
  wuyong: { column: 1, row: 0, scale: 1.03 },
  guansheng: { column: 2, row: 0, scale: 1.07 },
  linchong: { column: 2, row: 0, scale: 1.06 },
  luzhishen: { column: 3, row: 0, scale: 1.08 },
  huarong: { column: 0, row: 1, scale: 1.05 },
  husanniang: { column: 1, row: 1, scale: 1.04 },
  likui: { column: 2, row: 1, scale: 1.1 },
  andaoquan: { column: 0, row: 2, scale: 1.03 },
  daizong: { column: 1, row: 2, scale: 1.05 },
  qinming: { column: 3, row: 2, scale: 1.07 },
  scroll: { column: 1, row: 0, scale: 1.03 },
  craft: { column: 0, row: 2, scale: 1.03 },
  weapon: { column: 2, row: 0, scale: 1.06 },
  wave: { column: 3, row: 1, scale: 1.05 },
  beast: { column: 2, row: 2, scale: 1.08 },
  spirit: { column: 3, row: 2, scale: 1.07 },
  wind: { column: 1, row: 2, scale: 1.05 },
  flourish: { column: 1, row: 1, scale: 1.04 },
  crest: { column: 0, row: 0, scale: 1.04 },
  default: { column: 0, row: 0, scale: 1.04 }
}

const robePalette = [
  '#7c1f1b', '#23483e', '#3f4f78', '#8b5a1f', '#5c2d63', '#6d3f1f',
  '#2f6f6a', '#6f2e2e', '#315f3e', '#384f7a', '#865335', '#4f5d2f'
]

const trimPalette = ['#f4c84c', '#d7b875', '#c08a46', '#d9d0be', '#7a9e7e', '#b93622', '#d4a949', '#bfc7d5']

const personaPortraitSeeds = [
  ['songjiang', 1, '天魁星', '宋江', '及时雨'],
  ['lujunyi', 2, '天罡星', '卢俊义', '玉麒麟'],
  ['wuyong', 3, '天机星', '吴用', '智多星'],
  ['gongsunsheng', 4, '天闲星', '公孙胜', '入云龙'],
  ['guansheng', 5, '天勇星', '关胜', '大刀'],
  ['linchong', 6, '天雄星', '林冲', '豹子头'],
  ['qinming', 7, '天猛星', '秦明', '霹雳火'],
  ['huyanzhuo', 8, '天威星', '呼延灼', '双鞭'],
  ['huarong', 9, '天英星', '花荣', '小李广'],
  ['chaijin', 10, '天贵星', '柴进', '小旋风'],
  ['liying', 11, '天富星', '李应', '扑天雕'],
  ['zhutong', 12, '天满星', '朱仝', '美髯公'],
  ['luzhishen', 13, '天孤星', '鲁智深', '花和尚'],
  ['wusong', 14, '天伤星', '武松', '行者'],
  ['dongping', 15, '天立星', '董平', '双枪将'],
  ['zhangqing', 16, '天捷星', '张清', '没羽箭'],
  ['yangzhi', 17, '天暗星', '杨志', '青面兽'],
  ['xuning', 18, '天佑星', '徐宁', '金枪手'],
  ['suochao', 19, '天空星', '索超', '急先锋'],
  ['daizong', 20, '天速星', '戴宗', '神行太保'],
  ['liutang', 21, '天异星', '刘唐', '赤发鬼'],
  ['likui', 22, '天杀星', '李逵', '黑旋风'],
  ['shijin', 23, '天微星', '史进', '九纹龙'],
  ['muhong', 24, '天究星', '穆弘', '没遮拦'],
  ['leiheng', 25, '天退星', '雷横', '插翅虎'],
  ['lijun', 26, '天寿星', '李俊', '混江龙'],
  ['ruanxiaoer', 27, '天剑星', '阮小二', '立地太岁'],
  ['zhangheng', 28, '天平星', '张横', '船火儿'],
  ['ruanxiaowu', 29, '天罪星', '阮小五', '短命二郎'],
  ['zhangshun', 30, '天损星', '张顺', '浪里白条'],
  ['ruanxiaoqi', 31, '天败星', '阮小七', '活阎罗'],
  ['yangxiong', 32, '天牢星', '杨雄', '病关索'],
  ['shixiu', 33, '天慧星', '石秀', '拼命三郎'],
  ['xiezhen', 34, '天暴星', '解珍', '两头蛇'],
  ['xiebao', 35, '天哭星', '解宝', '双尾蝎'],
  ['yanqing', 36, '天巧星', '燕青', '浪子'],
  ['zhuwu', 37, '地魁星', '朱武', '神机军师'],
  ['huangxin', 38, '地煞星', '黄信', '镇三山'],
  ['sunli', 39, '地勇星', '孙立', '病尉迟'],
  ['xuanzan', 40, '地杰星', '宣赞', '丑郡马'],
  ['haosiwen', 41, '地雄星', '郝思文', '井木犴'],
  ['hantao', 42, '地威星', '韩滔', '百胜将'],
  ['pengqi', 43, '地英星', '彭玘', '天目将'],
  ['shantinggui', 44, '地奇星', '单廷珪', '圣水将'],
  ['weidingguo', 45, '地猛星', '魏定国', '神火将'],
  ['xiaorang', 46, '地文星', '萧让', '圣手书生'],
  ['peixuan', 47, '地正星', '裴宣', '铁面孔目'],
  ['oupeng', 48, '地阔星', '欧鹏', '摩云金翅'],
  ['dengfei', 49, '地阖星', '邓飞', '火眼狻猊'],
  ['yanshun', 50, '地强星', '燕顺', '锦毛虎'],
  ['yanglin', 51, '地暗星', '杨林', '锦豹子'],
  ['lingzhen', 52, '地轴星', '凌振', '轰天雷'],
  ['jiangjing', 53, '地会星', '蒋敬', '神算子'],
  ['lvfang', 54, '地佐星', '吕方', '小温侯'],
  ['guosheng', 55, '地佑星', '郭盛', '赛仁贵'],
  ['andaoquan', 56, '地灵星', '安道全', '神医'],
  ['huangfuduan', 57, '地兽星', '皇甫端', '紫髯伯'],
  ['wangying', 58, '地微星', '王英', '矮脚虎'],
  ['husanniang', 59, '地慧星', '扈三娘', '一丈青'],
  ['baoxu', 60, '地暴星', '鲍旭', '丧门神'],
  ['fanrui', 61, '地然星', '樊瑞', '混世魔王'],
  ['kongming', 62, '地猖星', '孔明', '毛头星'],
  ['kongliang', 63, '地狂星', '孔亮', '独火星'],
  ['xiangchong', 64, '地飞星', '项充', '八臂哪吒'],
  ['ligun', 65, '地走星', '李衮', '飞天大圣'],
  ['jindajian', 66, '地巧星', '金大坚', '玉臂匠'],
  ['malin', 67, '地明星', '马麟', '铁笛仙'],
  ['tongwei', 68, '地进星', '童威', '出洞蛟'],
  ['tongmeng', 69, '地退星', '童猛', '翻江蜃'],
  ['mengkang', 70, '地满星', '孟康', '玉幡竿'],
  ['houjian', 71, '地遂星', '侯健', '通臂猿'],
  ['chenda', 72, '地周星', '陈达', '跳涧虎'],
  ['yangchun', 73, '地隐星', '杨春', '白花蛇'],
  ['zhengtianshou', 74, '地异星', '郑天寿', '白面郎君'],
  ['taozongwang', 75, '地理星', '陶宗旺', '九尾龟'],
  ['songqing', 76, '地俊星', '宋清', '铁扇子'],
  ['yuehe', 77, '地乐星', '乐和', '铁叫子'],
  ['gongwang', 78, '地捷星', '龚旺', '花项虎'],
  ['dingdesun', 79, '地速星', '丁得孙', '中箭虎'],
  ['muchun', 80, '地镇星', '穆春', '小遮拦'],
  ['caozheng', 81, '地稽星', '曹正', '操刀鬼'],
  ['songwan', 82, '地魔星', '宋万', '云里金刚'],
  ['duqian', 83, '地妖星', '杜迁', '摸着天'],
  ['xueyong', 84, '地幽星', '薛永', '病大虫'],
  ['shien', 85, '地伏星', '施恩', '金眼彪'],
  ['lizhong', 86, '地僻星', '李忠', '打虎将'],
  ['zhoutong', 87, '地空星', '周通', '小霸王'],
  ['tanglong', 88, '地孤星', '汤隆', '金钱豹子'],
  ['duxing', 89, '地全星', '杜兴', '鬼脸儿'],
  ['zouyuan', 90, '地短星', '邹渊', '出林龙'],
  ['zourun', 91, '地角星', '邹润', '独角龙'],
  ['zhugui', 92, '地囚星', '朱贵', '旱地忽律'],
  ['zhufu', 93, '地藏星', '朱富', '笑面虎'],
  ['caifu', 94, '地平星', '蔡福', '铁臂膊'],
  ['caiqing', 95, '地损星', '蔡庆', '一枝花'],
  ['lili', 96, '地奴星', '李立', '催命判官'],
  ['liyun', 97, '地察星', '李云', '青眼虎'],
  ['jiaoting', 98, '地恶星', '焦挺', '没面目'],
  ['shiyong', 99, '地丑星', '石勇', '石将军'],
  ['sunxin', 100, '地数星', '孙新', '小尉迟'],
  ['gudasao', 101, '地阴星', '顾大嫂', '母大虫'],
  ['zhangqing_gardener', 102, '地刑星', '张青', '菜园子'],
  ['sunerniang', 103, '地壮星', '孙二娘', '母夜叉'],
  ['wangdingliu', 104, '地劣星', '王定六', '活闪婆'],
  ['yubaosi', 105, '地健星', '郁保四', '险道神'],
  ['baisheng', 106, '地耗星', '白胜', '白日鼠'],
  ['shiqian', 107, '地贼星', '时迁', '鼓上蚤'],
  ['duanjingzhu', 108, '地狗星', '段景住', '金毛犬']
]

const motifFor = (name, title) => {
  if (/军师|智|神算|书生|孔目/.test(title)) return 'scroll'
  if (/医|匠|扇|笛|叫子/.test(title)) return 'craft'
  if (/枪|箭|刀|鞭|将|先锋|温侯|仁贵|尉迟|霸王/.test(title)) return 'weapon'
  if (/龙|蛟|江|浪|船|水|蜃/.test(title)) return 'wave'
  if (/虎|豹|狻猊|兽|大虫|蛇|蝎|犬|鼠|蚤|猿|雕|金翅|龟|忽律|麒麟/.test(title)) return 'beast'
  if (/神|魔|哪吒|大圣|行者|和尚|判官|夜叉|阎罗/.test(title)) return 'spirit'
  if (/飞|行|旋风|插翅|摸着天|云里|闪婆/.test(title)) return 'wind'
  if (/三娘|大嫂|二娘|一枝花|白面郎君|美髯公/.test(`${name}${title}`)) return 'flourish'
  return 'crest'
}

export const portraitRoles = personaPortraitSeeds.map(([slug, rankNo, starName, name, title], index) => ({
  slug,
  rankNo,
  starName,
  name,
  title,
  robe: robePalette[index % robePalette.length],
  trim: trimPalette[(index + Math.floor(index / robePalette.length)) % trimPalette.length],
  motif: motifFor(name, title),
  scale: 0.94 + ((index % 7) * 0.025),
  step: 0.6 + ((index % 9) * 0.035),
  faceTone: index % 5,
  beard: /宋江|卢俊义|关胜|林冲|朱仝|鲁智深|杨志|朱武|裴宣|宋万|杜迁|郁保四|段景住/.test(name),
  headwear: /军师|书生|神算|神医|孔目|铁扇子|圣手/.test(title) ? 'cap' : (/和尚|行者/.test(title) ? 'band' : 'helm')
}))

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
  husanniang: [
    '前锋一线，我可先行破阵。',
    '轻骑快进，最忌迟疑。',
    '若要擒拿要点，交给我便是。'
  ],
  likui: [
    '哥哥吩咐便是！',
    '这活儿交给俺！',
    '莫磨蹭，快派俺去。'
  ],
  default: [
    '我在厅中候命。',
    '有榜文尽管传来。',
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

export const trainingRoomAnchor = {
  x: 74,
  y: 49,
  radiusX: 4,
  radiusY: 4
}

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
