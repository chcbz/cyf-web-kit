import { existsSync, readFileSync } from 'fs'
import { expect } from 'chai'

const hallSource = readFileSync(
  new URL('../src/components/world/JuyiHall.vue', import.meta.url),
  'utf8'
).replace(/\r\n/g, '\n')
const bountySource = readFileSync(
  new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url),
  'utf8'
)
const chatSource = readFileSync(
  new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url),
  'utf8'
)
const librarySource = readFileSync(
  new URL('../src/components/juyiting/LibraryPanel.vue', import.meta.url),
  'utf8'
)
const hallStageUrl = new URL('../src/components/juyiting/HallStage.vue', import.meta.url)
const hallDataUrl = new URL('../src/composables/juyiting/useHallData.js', import.meta.url)
const hallConversationUrl = new URL('../src/composables/juyiting/useHallConversation.js', import.meta.url)
const hallChatContextUrl = new URL('../src/composables/juyiting/useHallChatContext.js', import.meta.url)
const hallLibraryUrl = new URL('../src/composables/juyiting/useHallLibrary.js', import.meta.url)
const hallTaskActionsUrl = new URL('../src/composables/juyiting/useHallTaskActions.js', import.meta.url)
const hallConversationMessagesUrl = new URL('../src/composables/juyiting/hallConversationMessages.js', import.meta.url)
const publicDiscussionPanelUrl = new URL('../src/components/juyiting/PublicDiscussionPanel.vue', import.meta.url)
const bountyDiscussionPanelUrl = new URL('../src/components/juyiting/BountyDiscussionPanel.vue', import.meta.url)
const privateDiscussionPanelUrl = new URL('../src/components/juyiting/PrivateDiscussionPanel.vue', import.meta.url)
const hallChatComposerUrl = new URL('../src/components/juyiting/HallChatComposer.vue', import.meta.url)
const hallStageSource = readFileSync(hallStageUrl, 'utf8')
const hallDataSource = readFileSync(hallDataUrl, 'utf8')
const hallConversationSource = readFileSync(hallConversationUrl, 'utf8')
const hallChatContextSource = readFileSync(hallChatContextUrl, 'utf8')
const hallLibrarySource = readFileSync(hallLibraryUrl, 'utf8')
const hallTaskActionsSource = readFileSync(hallTaskActionsUrl, 'utf8')
const hallConversationMessagesSource = readFileSync(hallConversationMessagesUrl, 'utf8')

describe('JuyiHall collaboration flow contract', () => {
  it('uses the stage header as the primary action surface without the duplicate dock', () => {
    expect(hallSource).not.to.include('<BottomDock')
    expect(hallSource).not.to.include("import BottomDock")
    expect(hallStageUrl).to.not.equal(undefined)
    expect(hallStageSource).not.to.include("title=\"宋江号令\"")
    expect(hallStageSource).not.to.include("title=\"协同会办\"")
    expect(hallStageSource).to.include('class="melon-layer"')
    expect(hallStageSource).to.include('onHotspotClick')
    expect(hallStageSource).to.include("emit('open-panel', hotspot.panel)")
    expect(hallStageSource).not.to.include('hallPhysicalScene.interactiveZones')
    expect(hallStageSource).not.to.include('`room-${zone.key}`')
  })

  it('distributes discussion entry points across courtyard bounty board and task cards', () => {
    expect(hallStageSource).to.include('onHotspotClick')
    expect(hallStageSource).to.include("emit('open-panel', hotspot.panel)")
    expect(hallStageSource).not.to.include('openPublicDiscussion')
    expect(hallStageSource).not.to.include("zone.panel === 'chat'")
    expect(hallStageSource).not.to.include('room-${zone.key}')
    expect(hallStageSource).not.to.include('传令房')
    expect(hallStageSource).not.to.include('class="hall-room room-chat"')
    expect(hallStageSource).not.to.include('class="scene-hotspot hotspot-chat"')
    expect(hallSource).to.include("openPanel('chat', { mode: 'public', resetContext: true })")
    expect(bountySource).to.include('榜文议事')
    expect(bountySource).to.include('>密议<')
    expect(bountySource).not.to.include('单独议事')
    expect(bountySource).not.to.include('传令议事')
    expect(bountySource).not.to.include('>传令<')
  })

  it('uses in-scene objects as click targets without visible labels or highlight overlays', () => {
    expect(hallStageSource).to.include('class="melon-layer"')
    expect(hallStageSource).not.to.include('objectHitboxStyle(zone)')
    expect(hallStageSource).not.to.include('object-${zone.object}')
    expect(hallStageSource).not.to.include('sr-only')
    expect(hallStageSource).not.to.include('class="hall-room"')
    expect(hallStageSource).not.to.include('class="map-world"')
    expect(hallStageSource).not.to.include('object-highlight')
    expect(hallStageSource).not.to.include('objectAriaLabel(zone)')
    expect(hallStageSource).not.to.include('hall-room-label')
    expect(hallStageSource).not.to.include('<strong>{{ zone.title }}</strong>')
    expect(hallStageSource).not.to.include('<small>{{ zoneSubtitle(zone) }}</small>')
    expect(hallStageSource).not.to.include('scene-hotspot')
  })

  it('keeps bounty panel opening isolated from map drag and enter flicker', () => {
    expect(hallStageSource).not.to.include('@pointerdown.stop')
    expect(hallStageSource).not.to.include('@pointerup.stop')
    expect(hallStageSource).not.to.include('@click.stop="openZone(zone)"')
    expect(hallStageSource).not.to.include('startMapDrag')
    expect(hallSource).to.include(':class="{ \'is-panel-open\': activePanel }"')
    expect(hallSource).to.include('.juyi-page.is-panel-open :deep(.hall-board)')
    expect(hallSource).to.include('animation-play-state: paused !important;')
    expect(hallSource).to.include('.panel-enter-from .floating-panel')
    expect(hallSource).not.to.include('scale(0.995)')
    expect(hallSource).not.to.include('transition: background-color 0.16s ease-out;')
    expect(hallSource).not.to.include('.panel-enter-from .floating-panel {\n  opacity: 0;')
    expect(bountySource).not.to.include('backdrop-filter: blur(4px);')
    expect(bountySource).not.to.include('scale(0.985)')
  })

  it('assigns a bounty to an explicit agent instead of hidden selectedAgent only', () => {
    expect(bountySource).to.include("$emit('assign-task', detailTask, agent)")
    expect(hallSource).to.include('useHallTaskActions')
    expect(hallTaskActionsSource).to.include('const assignTask = async (task, agent')
    expect(hallTaskActionsSource).to.include('agentId: targetAgent.agentId')
  })

  it('keeps persistent command templates out of chat', () => {
    expect(chatSource).not.to.include('commandTemplates')
    expect(chatSource).not.to.include('command-templates')
    expect(chatSource).not.to.include("$emit('apply-template'")
  })

  it('keeps both agent and task context in outgoing chat metadata', () => {
    expect(hallConversationSource).to.include('selectedAgentId: selectedAgent.value?.agentId')
    expect(hallConversationSource).to.include('mentionAgentIds: currentChatContext.value.targetAgentIds')
    expect(hallConversationSource).to.include('selectedTaskId: selectedTask.value?.id')
    expect(hallConversationSource).to.include('...(outgoingMetadata?.value || {})')
  })

  it('sends hall messages with durable public bounty and private conversation scopes', () => {
    expect(hallSource).to.include('useHallChatContext')
    expect(hallChatContextSource).to.include("const chatMode = ref('public')")
    expect(hallChatContextSource).to.include('const chatContext = computed(')
    expect(hallChatContextSource).to.include("conversationScopeType: 'public'")
    expect(hallChatContextSource).to.include("conversationScopeKey: 'public'")
    expect(hallChatContextSource).to.include("conversationScopeType: 'bounty'")
    expect(hallChatContextSource).to.include("conversationScopeType: 'private'")
    expect(hallConversationSource).to.include('conversationScopeType: chatContext.value.conversationScopeType')
    expect(hallConversationSource).to.include('conversationScopeKey: chatContext.value.conversationScopeKey')
    expect(hallConversationSource).to.include('targetAgentIds: chatContext.value.targetAgentIds')
    expect(hallConversationSource).to.include('forceNewConversation')
  })

  it('loads hall messages by conversation scope instead of the latest juyiting conversation only', () => {
    expect(hallConversationSource).to.include('conversationScopeType: chatContext.value.conversationScopeType')
    expect(hallConversationSource).to.include('conversationScopeKey: chatContext.value.conversationScopeKey')
    expect(hallConversationSource).not.to.include('pageSize: 1,\n        orderBy: \'update_time desc\',\n        search: {\n          jiacn: globalStore.getJiacn,\n          conversationType: \'juyiting\'\n        }')
  })

  it('keeps bounty discussion scoped to assignees and private task chat separate', () => {
    expect(hallSource).to.include('enterBountyDiscussion')
    expect(hallSource).to.include('enterPrivateConversation')
    expect(hallChatContextSource).to.include("chatMode.value = 'bounty'")
    expect(hallChatContextSource).to.include("chatMode.value = 'private'")
    expect(hallChatContextSource).to.include('participantAgentIds')
    expect(hallChatContextSource).to.include('task:${selectedTask.value.id}:agent:${selectedAgent.value.agentId}')
    expect(hallChatContextSource).to.include('taskDiscussionAgentIds.value = taskAssigneeIds(selectedTask.value)')
    expect(hallChatContextSource).to.include('selectedAgent.value = null')
  })

  it('opens the courtyard discussion entrance as a fresh public discussion by default', () => {
    expect(hallSource).to.include('@open-panel="handleStagePanelOpen"')
    expect(hallSource).to.include('const handleStagePanelOpen = (panel) => {')
    expect(hallSource).to.include("openPanel('chat', { mode: 'public', resetContext: true })")
    expect(hallSource).to.include("if (panel === 'chat' && options.mode === 'public')")
    expect(hallSource).to.include('resetToPublic({ clearSelection: true })')
    expect(hallChatContextSource).to.include('selectedTask.value = null')
    expect(hallChatContextSource).to.include('selectedAgent.value = null')
  })

  it('uses separate discussion panels instead of one cross-scope chat interface', () => {
    expect(existsSync(publicDiscussionPanelUrl)).to.equal(true)
    expect(existsSync(bountyDiscussionPanelUrl)).to.equal(true)
    expect(existsSync(privateDiscussionPanelUrl)).to.equal(true)
    expect(existsSync(hallChatComposerUrl)).to.equal(true)
    expect(hallSource).to.include('<PublicDiscussionPanel')
    expect(hallSource).to.include('<BountyDiscussionPanel')
    expect(hallSource).to.include('<PrivateDiscussionPanel')
    expect(hallSource).to.include("chatMode === 'public'")
    expect(hallSource).to.include("chatMode === 'bounty'")
    expect(hallSource).to.include("chatMode === 'private'")
    expect(chatSource).to.include('discussion-surface')
    expect(chatSource).to.include('<HallChatComposer')
    expect(chatSource).not.to.include('discussion-target-controls')
    expect(chatSource).not.to.include('compact-mention-strip')
    expect(chatSource).not.to.include('mode-icon-button')
    expect(chatSource).not.to.include("$emit('set-mode', mode.key)")
    expect(chatSource).not.to.include('conversationModes')
    expect(chatSource).not.to.include('conversation-modes')
    expect(chatSource).not.to.include('command-groups')
    expect(chatSource).not.to.include('toolbar-meta')
  })

  it('limits hall chat mention choices to map agents', () => {
    expect(hallSource).to.include('<PublicDiscussionPanel')
    expect(hallSource).to.include('<BountyDiscussionPanel')
    expect(hallSource).to.include(':agents="chatMentionAgents"')
    expect(hallSource).to.match(/\} = useHallChatContext\(\{\s*mapAgents,/)
  })

  it('supports task management actions from the bounty board', () => {
    expect(hallSource).to.include('@create-task="createTask"')
    expect(hallSource).to.include('@archive-task="archiveTask"')
    expect(hallSource).to.include('@discuss-task="discussTask"')
    expect(hallSource).to.include('chatMentionAgents')
    expect(bountySource).to.include('new-task-button')
    expect(bountySource).to.include('assign-selected-agents')
    expect(bountySource).to.include("$emit('archive-task'")
    expect(bountySource).to.include("$emit('discuss-task'")
  })

  it('keeps low-value SongJiang and coordination panels out of the primary hall surface', () => {
    expect(hallSource).not.to.include('<CommandPanel')
    expect(hallSource).not.to.include('<CoordinationPanel')
    expect(hallSource).not.to.include("import CommandPanel")
    expect(hallSource).not.to.include("import CoordinationPanel")
    expect(hallSource).to.include('<LibraryPanel')
    expect(librarySource).to.include('藏书查卷')
    expect(hallSource).to.include('useHallLibrary')
    expect(hallLibrarySource).to.include("chatApi.search('/library/search'")
  })

  it('keeps low-value SongJiang and coordination actions out of chat panel', () => {
    expect(chatSource).not.to.include('chiefTemplates')
    expect(chatSource).not.to.include('coordination-inline')
    expect(chatSource).not.to.include('relay-message')
    expect(chatSource).not.to.include('coordinate-work')
    expect(hallSource).not.to.include('relayAgentMessageFromChat')
    expect(hallSource).not.to.include('coordinateAgentsFromChat')
  })

  it('shows an overflow hint when more than twelve agents are available', () => {
    expect(hallSource).to.include('hiddenAgentCount')
    expect(hallDataSource).to.match(/slice\(0,\s*12\)/)
  })

  it('keeps roster status filtering independent from map agents', () => {
    expect(hallDataSource).to.not.include("'/active'")
    expect(hallDataSource).to.include("agentApi.get('/map'")
    expect(hallDataSource).to.include("agentApi.search('/roster'")
    expect(hallDataSource).to.include("agentApi.get('/personas/catalog'")
    expect(hallDataSource).to.include('mapAgents')
    expect(hallDataSource).to.include("['online', 'busy'].includes(normalizeStatus(agent.status))")
    expect(hallDataSource).to.match(/slice\(0,\s*12\)/)
    expect(hallSource).to.include(':map-agents="mapAgents"')
    expect(hallSource).to.include(':tasks-total="tasks.length"')
    expect(hallSource).to.include('<PersonaCatalogPanel')
    expect(hallSource).not.to.include('<strong>{{ agents.length }}</strong>')
    expect(hallSource).to.include('@set-agent-filter="setAgentFilter"')
  })

  it('splits hall stage, data, and conversation responsibilities into dedicated units', () => {
    expect(existsSync(hallStageUrl)).to.equal(true)
    expect(existsSync(hallDataUrl)).to.equal(true)
    expect(existsSync(hallConversationUrl)).to.equal(true)
    expect(existsSync(hallChatContextUrl)).to.equal(true)
    expect(existsSync(hallLibraryUrl)).to.equal(true)
    expect(existsSync(hallTaskActionsUrl)).to.equal(true)
    expect(existsSync(hallConversationMessagesUrl)).to.equal(true)
    expect(existsSync(publicDiscussionPanelUrl)).to.equal(true)
    expect(existsSync(bountyDiscussionPanelUrl)).to.equal(true)
    expect(existsSync(privateDiscussionPanelUrl)).to.equal(true)
    expect(hallSource).to.include("import HallStage from '@/components/juyiting/HallStage.vue'")
    expect(hallSource).to.include("import { useHallData } from '@/composables/juyiting/useHallData'")
    expect(hallSource).to.include("import { useHallConversation } from '@/composables/juyiting/useHallConversation'")
    expect(hallConversationSource).to.include("from './hallConversationMessages.js'")
    expect(hallConversationMessagesSource).to.include('export const appendHallEventMessage')
  })
})
