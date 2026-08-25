import { expect } from 'chai'
import { readFileSync } from 'fs'

const panelSource = readFileSync(new URL('../src/components/juyiting/TaskWorkspacePanel.vue', import.meta.url), 'utf8')
const timelineSource = readFileSync(new URL('../src/components/juyiting/TaskTimeline.vue', import.meta.url), 'utf8')

describe('C07B task workspace presentation', () => {
  it('keeps the workspace panel as a pure read-only presentation surface', () => {
    expect(panelSource).to.include("import TaskTimeline from './TaskTimeline.vue'")
    expect(panelSource).to.include("defineEmits(['retry'])")
    expect(panelSource).not.to.match(/agentApi|fetch\(|EventSource|setTimeout|setInterval|useTaskWorkspace|taskWorkspaceReducer|useTaskEventStream/)
    expect(timelineSource).not.to.match(/agentApi|fetch\(|EventSource|setTimeout|setInterval|taskWorkspaceReducer|useTaskEventStream/)
  })

  it('renders the frozen workspace projections and all connection states without business writes', () => {
    for (const state of ['idle', 'loading', 'live', 'reconnecting', 'degraded', 'resyncing', 'error']) {
      expect(panelSource).to.include(`${state}:`)
    }
    for (const section of ['成员', '工作项', '待处理诉求', '最近成果', '关联会话']) {
      expect(panelSource).to.include(section)
    }
    expect(panelSource).to.include('workspace.members')
    expect(panelSource).to.include('workspace.workItems')
    expect(panelSource).to.include('workspace.openRequests')
    expect(panelSource).to.include('workspace.recentArtifacts')
    expect(panelSource).to.include('workspace.conversationId')
    expect(panelSource).to.not.match(/assign-task|auto-assign|create-task|archive-task|send-message/)
  })

  it('parses JSON-string required abilities without character iteration or unbounded DOM output', () => {
    expect(panelSource).to.include('MAX_REQUIRED_ABILITIES_JSON_BYTES = 65535')
    expect(panelSource).to.include('MAX_REQUIRED_ABILITIES_DISPLAY = 12')
    expect(panelSource).to.include('MAX_REQUIRED_ABILITY_CODE_POINTS = 64')
    expect(panelSource).to.include('JSON.parse(value)')
    expect(panelSource).to.include('所需本领格式不可用')
    expect(panelSource).to.include('仅显示前 12 项本领')
    expect(panelSource).to.include(':key="ability.full"')
    expect(panelSource).to.include(':title="ability.full"')
    expect(panelSource).to.include('{{ ability.display }}')
    expect(panelSource).not.to.include('v-for="ability in task.requiredAbilities"')
  })

  it('uses safe timeline projections and a fixed redaction message', () => {
    expect(timelineSource).to.include('v-if="event.redacted"')
    expect(timelineSource).to.include('此事件内容已脱敏。')
    expect(timelineSource).to.include('版本 {{ event.version }}')
    expect(timelineSource).not.to.include('event.payload')
    expect(timelineSource).not.to.include('v-html')
    expect(timelineSource).to.include('aria-label="按事件版本升序的协作时间线"')
  })

  it('keeps artifacts and conversation association metadata-only and exposes truncation indicators', () => {
    expect(panelSource).to.include('workspace.recentArtifactsTruncated')
    expect(panelSource).to.include('仅显示最近 100 条成果')
    expect(timelineSource).to.include('仅显示最近 100 条事件')
    expect(panelSource).to.not.match(/href=|router-link|loadHallMessages|new-conversation|enterPrivateConversation/)
  })
})
