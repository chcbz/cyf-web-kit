import { expect } from 'chai'
import { ref } from 'vue'

import { HALL_SCENE_REGIONS } from '../src/constants/juyitingScene.js'
import { useHallScene } from '../src/composables/juyiting/useHallScene.js'
import { isPointInPolygon } from '../src/game/walkableArea.js'

const normalizeStatus = (status = '') => status.toLowerCase()

const makeAgent = (agentId, name, status = 'online') => ({
  agentId,
  name,
  personaCode: agentId,
  status
})

describe('useHallScene', () => {
  it('keeps the six featured Water Margin heroes visible in the 2.5D hall', () => {
    const mapAgents = ref([
      makeAgent('songjiang', '瀹嬫睙'),
      makeAgent('linchong', '鏋楀啿')
    ])

    const hallScene = useHallScene({
      mapAgents,
      normalizeStatus,
      selectedAgent: ref(null),
      selectedTask: ref(null)
    })

    expect(hallScene.sceneAgents.value.map(agent => agent.agentId)).to.include.members([
      'songjiang',
      'linchong',
      'wuyong',
      'likui',
      'husanniang',
      'lujunyi'
    ])
    expect(hallScene.sceneAgents.value.filter(agent => agent.featuredHero)).to.have.length(6)
    expect(hallScene.sceneAgents.value.find(agent => agent.agentId === 'wuyong')).to.include({
      featuredHero: true,
      synthetic: true,
      visualKey: 'wuyong'
    })
  })

  it('places featured heroes on readable floor anchors with stronger foreground scale', () => {
    const hallScene = useHallScene({
      mapAgents: ref([]),
      normalizeStatus,
      selectedAgent: ref(null),
      selectedTask: ref(null)
    })

    const byId = Object.fromEntries(hallScene.sceneAgents.value.map(agent => [agent.agentId, agent]))

    expect(byId.songjiang).to.include({ x: 50, y: 45, regionId: 'mainSeat' })
    expect(byId.linchong).to.include({ x: 34, y: 63, regionId: 'leftGuard' })
    expect(byId.husanniang).to.include({ x: 65, y: 64, regionId: 'rightGuard' })
    expect(byId.likui.scale).to.be.greaterThan(byId.songjiang.scale)
    expect(byId.songjiang.scale).to.be.within(0.48, 0.58)
    expect(byId.likui.scale).to.be.within(0.62, 0.76)
    expect(hallScene.sceneAgents.value.map(agent => agent.depth)).to.deep.equal(
      [...hallScene.sceneAgents.value.map(agent => agent.depth)].sort((a, b) => a - b)
    )
  })

  it('keeps scene agent anchors inside their configured walkable regions', () => {
    const hallScene = useHallScene({
      mapAgents: ref([]),
      normalizeStatus,
      selectedAgent: ref(null),
      selectedTask: ref(null)
    })

    hallScene.sceneAgents.value.forEach((agent) => {
      const region = HALL_SCENE_REGIONS[agent.regionId]
      expect(isPointInPolygon({ x: agent.x, y: agent.y }, region.walkable), agent.agentId).to.equal(true)
      expect(agent.walkableRegion).to.equal(region)
    })
  })

  it('derives scene agents with regions, depth and selected focus from map agents', () => {
    const songjiang = makeAgent('songjiang', '宋江')
    const linchong = makeAgent('linchong', '林冲')
    const wuyong = makeAgent('wuyong', '吴用')
    const mapAgents = ref([linchong, songjiang, wuyong])
    const selectedAgent = ref(linchong)

    const hallScene = useHallScene({
      mapAgents,
      normalizeStatus,
      selectedAgent,
      selectedTask: ref(null)
    })

    expect(hallScene.sceneAgents.value.map(agent => agent.agentId)).to.include.members([
      'songjiang',
      'linchong',
      'wuyong'
    ])
    expect(hallScene.sceneAgents.value.map(agent => agent.depth)).to.deep.equal(
      [...hallScene.sceneAgents.value.map(agent => agent.depth)].sort((a, b) => a - b)
    )
    expect(hallScene.sceneAgents.value.find(agent => agent.agentId === 'songjiang')).to.include({
      regionId: 'mainSeat',
      visualKey: 'songjiang',
      sceneStatus: 'idle'
    })
    expect(hallScene.sceneAgents.value.find(agent => agent.agentId === 'linchong')).to.include({
      regionId: 'leftGuard',
      selected: true,
      focused: true
    })
  })

  it('keeps all multi-assigned targets in task feedback while limiting prominent movers', () => {
    const agents = [
      makeAgent('wuyong', '吴用'),
      makeAgent('linchong', '林冲'),
      makeAgent('likui', '李逵'),
      makeAgent('husanniang', '扈三娘'),
      makeAgent('lujunyi', '卢俊义')
    ]
    const hallScene = useHallScene({
      mapAgents: ref(agents),
      normalizeStatus,
      selectedAgent: ref(null),
      selectedTask: ref(null)
    })

    hallScene.markTaskAssigned({ id: 'task-1', title: '巡山查哨' }, agents)

    const targetAgents = hallScene.sceneAgents.value.filter(agent => agents.some(item => item.agentId === agent.agentId))
    expect(targetAgents.every(agent => agent.sceneStatus === 'busy')).to.equal(true)
    expect(targetAgents.every(agent => agent.bubble?.tone === 'task')).to.equal(true)
    expect(targetAgents.filter(agent => agent.prominentMotion)).to.have.length(4)
    expect(hallScene.sceneHotspots.value.find(hotspot => hotspot.id === 'bountyBoard')).to.include({
      state: 'active'
    })
  })

  it('falls back to bounty board feedback when auto assignment has no assignee', () => {
    const hallScene = useHallScene({
      mapAgents: ref([makeAgent('songjiang', '宋江')]),
      normalizeStatus,
      selectedAgent: ref(null),
      selectedTask: ref(null)
    })

    hallScene.markTaskAutoAssigned({ id: 'task-1', title: '查访线索' }, [])

    expect(hallScene.sceneAgents.value.find(agent => agent.agentId === 'songjiang').sceneStatus).to.equal('idle')
    const bountyBoard = hallScene.sceneHotspots.value.find(hotspot => hotspot.id === 'bountyBoard')
    expect(bountyBoard).to.include({ state: 'active' })
    expect(bountyBoard.feedbackText).to.equal('宋江已点将')
  })

  it('maps discussion, speech and library events into scene feedback', () => {
    const agents = [
      makeAgent('wuyong', '吴用'),
      makeAgent('linchong', '林冲'),
      makeAgent('husanniang', '扈三娘')
    ]
    const hallScene = useHallScene({
      mapAgents: ref(agents),
      normalizeStatus,
      selectedAgent: ref(null),
      selectedTask: ref(null)
    })

    hallScene.markDiscussionStarted({ id: 'task-1', title: '合议榜文' }, ['wuyong', 'linchong'])
    hallScene.markAgentSpeaking('husanniang', '我去前路探一探', 'speech')
    hallScene.markLibrarySearching('success')
    hallScene.markLibraryCitation({ id: 'doc-1', content: '案卷' })

    expect(hallScene.sceneAgents.value.find(agent => agent.agentId === 'wuyong')).to.include({
      regionId: 'councilTable',
      sceneStatus: 'discuss'
    })
    expect(hallScene.sceneAgents.value.find(agent => agent.agentId === 'husanniang').bubble).to.include({
      text: '我去前路探一探',
      tone: 'speech'
    })
    const library = hallScene.sceneHotspots.value.find(hotspot => hotspot.id === 'libraryShelf')
    expect(library).to.include({
      state: 'active',
      feedbackText: '案卷已引用'
    })
  })

  it('marks recommended map agents without selecting them', () => {
    const agents = [
      makeAgent('songjiang', '宋江'),
      makeAgent('wuyong', '吴用'),
      makeAgent('linchong', '林冲'),
      makeAgent('likui', '李逵')
    ]
    const hallScene = useHallScene({
      mapAgents: ref(agents),
      normalizeStatus,
      selectedAgent: ref(null),
      selectedTask: ref({ id: 'task-1', title: '巡山查哨' })
    })

    hallScene.markRecommendedAgents([
      { agentId: 'wuyong', name: '吴用' },
      { agentId: 'linchong', name: '林冲' },
      { agentId: 'not-in-map', name: '偏厅好汉' }
    ])

    const recommended = hallScene.sceneAgents.value.filter(agent => agent.recommended)
    expect(recommended.map(agent => agent.agentId)).to.have.members(['wuyong', 'linchong'])
    expect(recommended.every(agent => agent.focused && !agent.selected)).to.equal(true)
    expect(hallScene.sceneHotspots.value.find(hotspot => hotspot.id === 'bountyBoard')).to.include({
      state: 'active',
      feedbackText: '荐单已出'
    })
  })
})
