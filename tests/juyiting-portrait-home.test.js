import { existsSync, readFileSync } from 'fs'
import { expect } from 'chai'

const portraitHomeUrl = new URL('../src/components/juyiting/HallPortraitHome.vue', import.meta.url)
const hallUrl = new URL('../src/components/world/JuyiHall.vue', import.meta.url)
const portraitHomeSource = readFileSync(portraitHomeUrl, 'utf8').replace(/\r\n/g, '\n')
const hallSource = readFileSync(hallUrl, 'utf8').replace(/\r\n/g, '\n')

const quickActions = [
  ['agents', '点将册'],
  ['tasks', '悬赏榜'],
  ['discussion', '厅前议事'],
  ['catalog', '招贤令'],
  ['library', '案卷阁'],
  ['refresh', '点验刷新']
]

describe('HallPortraitHome', () => {
  it('keeps first portrait entry outside the melon stage mount path', () => {
    expect(existsSync(portraitHomeUrl)).to.equal(true)
    expect(hallSource).to.match(/<HallPortraitHome\s+v-if="!experienceReady \|\| experienceMode === 'portrait-command'"[\s\S]*?\/>\s*\n\s*<HallStage\s+v-else/)
    expect(portraitHomeSource).not.to.include('juyitingGame')
    expect(portraitHomeSource).not.to.include('<canvas')
    expect(portraitHomeSource).not.to.include('melon')
    expect(hallSource).to.include('const experienceReady = ref(false)')
    expect(hallSource).to.include('experienceReady.value = true')
    expect(hallSource).not.to.include('juyitingGame.mount')
  })

  it('renders all six real quick entries and routes them through the page owner', () => {
    expect(portraitHomeSource).to.include('const quickActions = Object.freeze([')
    for (const [key, label] of quickActions) {
      expect(portraitHomeSource).to.include(`{ key: '${key}', label: '${label}'`)
    }
    expect(portraitHomeSource).to.include("emit('quick-action', action.key)")
    expect(hallSource).to.include('const handlePortraitQuickAction = (action) => {')
    expect(hallSource).to.include("handleStagePanelOpen('chat')")
    expect(hallSource).to.include("['agents', 'tasks', 'catalog', 'library'].includes(action)")
    expect(hallSource).to.include('void refreshHall()')
  })

  it('uses the O01 request capability without preemptively changing the experience shell', () => {
    expect(portraitHomeSource).to.include("emit('request-landscape')")
    expect(hallSource).to.include('@request-landscape="requestLandscape"')
    expect(portraitHomeSource).not.to.include('experienceMode')
    expect(portraitHomeSource).not.to.match(/transform:\s*rotate|rotate\(/)
    expect(portraitHomeSource).not.to.include('miniProgram.redirectTo')
    expect(portraitHomeSource).not.to.include('visualViewport')
  })

  it('opens a tapped todo in the page-owned portrait detail without depending on the bounty-panel watcher', () => {
    const handler = hallSource.match(/const handlePortraitTaskOpen = task => \{([\s\S]*?)\n\}/)?.[1] || ''
    const boardHandler = hallSource.match(/const handlePortraitTaskBoard = \(\) => \{([\s\S]*?)\n\}/)?.[1] || ''
    const discussionHandler = hallSource.match(/const handlePortraitTaskDiscussion = task => \{([\s\S]*?)\n\}/)?.[1] || ''

    expect(portraitHomeSource).to.include("const openTask = task => emit('open-task', task)")
    expect(portraitHomeSource).to.include('taskDetailOpen: Boolean')
    expect(portraitHomeSource).to.include('v-if="taskDetailOpen && selectedTask"')
    expect(portraitHomeSource).to.include('{{ taskStatusText(selectedTask.status) }}')
    expect(portraitHomeSource).to.include('榜号 {{ selectedTask.id }}')
    expect(portraitHomeSource).to.include("selectedTask.description || selectedTask.content || '暂无详情，待厅中议定。'")
    expect(portraitHomeSource).to.include("selectedTask.requiredAbilities?.length ? selectedTask.requiredAbilities.join(' / ') : '不拘本领'")
    expect(portraitHomeSource).to.include("emit('close-task-detail')")
    expect(portraitHomeSource).to.include("emit('open-task-board')")
    expect(portraitHomeSource).to.include("emit('discuss-task', selectedTask)")

    expect(handler).to.include('const selection = selectTask(task)')
    expect(handler).to.include('portraitTaskDetailOpen.value = true')
    expect(handler).not.to.include("openPanel('tasks')")
    expect(handler).not.to.include('nextTick')
    expect(handler.indexOf('selectTask(task)')).to.be.lessThan(handler.indexOf('portraitTaskDetailOpen.value = true'))
    expect(hallSource).to.include('const closePortraitTaskDetail = () => {')
    expect(hallSource).to.include('portraitTaskDetailOpen.value = false')
    expect(boardHandler).to.include('closePortraitTaskDetail()')
    expect(boardHandler).to.include("openPanel('tasks')")
    expect(discussionHandler).to.include('closePortraitTaskDetail()')
    expect(discussionHandler).to.include('discussTask(task)')
    expect(hallSource).to.include("if (mode !== 'portrait-command') closePortraitTaskDetail()")
  })

  it('consumes page-owned map, roster, task, and selected-context state without creating a second session', () => {
    for (const binding of [
      ':agents="agents"',
      ':map-agents="mapAgents"',
      ':tasks="tasks"',
      ':selected-agent="selectedAgent"',
      ':selected-task="selectedTask"',
      ':task-detail-open="portraitTaskDetailOpen"'
    ]) expect(hallSource).to.include(binding)

    expect(portraitHomeSource).to.include("emit('select-agent', agent)")
    expect(portraitHomeSource).to.include("emit('open-task', task)")
    expect(hallSource).to.include('@open-task="handlePortraitTaskOpen"')
    expect(hallSource).to.include('@close-task-detail="closePortraitTaskDetail"')
    expect(hallSource).to.include('@open-task-board="handlePortraitTaskBoard"')
    expect(hallSource).to.include('@discuss-task="handlePortraitTaskDiscussion"')
    expect(portraitHomeSource).to.not.include('useHallData')
    expect(portraitHomeSource).to.not.include('useHallConversation')
    expect(portraitHomeSource).to.not.include("ref(")
  })
})
