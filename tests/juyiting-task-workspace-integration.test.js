import { expect } from 'chai'
import { readFileSync } from 'fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { useTaskWorkspaceView } from '../src/composables/juyiting/useTaskWorkspaceView.js'

const hallSource = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const hallDataSource = readFileSync(new URL('../src/composables/juyiting/useHallData.js', import.meta.url), 'utf8')
const taskActionsSource = readFileSync(new URL('../src/composables/juyiting/useHallTaskActions.js', import.meta.url), 'utf8')
const panelSource = readFileSync(new URL('../src/components/juyiting/TaskWorkspacePanel.vue', import.meta.url), 'utf8')

let mount
let Vue
let TaskTimeline
let TaskWorkspacePanel
const domGlobalDescriptors = {}

const vueImportToVar = (_line, imports) => {
  const vueBindings = imports.split(',').map(part => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')
  return vueBindings ? `var { ${vueBindings} } = Vue` : ''
}

const loadSfc = (relativePath, child = null) => {
  const filename = new URL(relativePath, import.meta.url).pathname
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename })
  const id = `test-${relativePath.replace(/[^a-z0-9]/gi, '-')}`
  const script = compileScript(descriptor, { id, inlineTemplate: true }).content
  const scriptBody = script
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+TaskTimeline\s+from\s+['"].\/TaskTimeline\.vue['"];?\s*$/gm, 'var TaskTimeline = arguments[1]')
    .replace('export default', 'return')
  return new Function('Vue', 'TaskTimeline', scriptBody)(Vue, child)
}

const workspaceFixture = () => ({
  task: {
    taskId: 'task-1',
    status: 'running',
    requiredAbilities: '[]',
    collaborationMode: 'team',
    riskLevel: 'medium',
    maxAgents: 4
  },
  members: [],
  workItems: [],
  openRequests: [],
  recentArtifacts: [],
  recentArtifactsTruncated: false,
  conversationId: null,
  recentEvents: [],
  timelineTruncated: false,
  currentVersion: '3'
})

describe('C07 JuyiHall task workspace integration', () => {
  before(async () => {
    for (const key of ['SVGElement', 'Element', 'Node']) {
      domGlobalDescriptors[key] = Object.getOwnPropertyDescriptor(global, key)
      global[key] = global.window?.[key]
    }
    ;({ mount } = await import('@vue/test-utils'))
    Vue = await import('vue')
    TaskTimeline = Vue.defineComponent({ render: () => null })
    TaskWorkspacePanel = loadSfc('../src/components/juyiting/TaskWorkspacePanel.vue', TaskTimeline)
  })

  after(() => {
    for (const key of ['SVGElement', 'Element', 'Node']) {
      const descriptor = domGlobalDescriptors[key]
      if (descriptor) Object.defineProperty(global, key, descriptor)
      else delete global[key]
    }
  })
  it('uses the existing Hall dialog and concrete top-level values from the single FE1 workspace state source', () => {
    expect(hallSource).to.include("import TaskWorkspacePanel from '@/components/juyiting/TaskWorkspacePanel.vue'")
    expect(hallSource).to.include("import { useTaskWorkspaceView } from '@/composables/juyiting/useTaskWorkspaceView'")
    expect(hallSource).to.include('subject: taskWorkspaceSubject')
    expect(hallSource).to.include('workspace: taskWorkspaceSnapshot')
    expect(hallSource).to.include('connectionState: taskWorkspaceConnectionState')
    expect(hallSource).to.include('error: taskWorkspaceError')
    expect(hallSource).to.include('retry: retryTaskWorkspace')
    expect(hallSource).to.include("v-if=\"taskWorkspaceEnabled && renderedPanel === 'workspace' && taskWorkspaceSubject\"")
    expect(hallSource).to.include(':workspace="taskWorkspaceSnapshot"')
    expect(hallSource).to.include(':connection-state="taskWorkspaceConnectionState"')
    expect(hallSource).to.include(':error="taskWorkspaceError"')
    expect(hallSource).to.include(':actor-agent-id="taskWorkspaceSubject.actorAgentId"')
    expect(hallSource).to.include('@retry="retryTaskWorkspace"')
    expect(hallSource).not.to.include(':workspace="taskWorkspace?.workspace"')
    expect(hallSource).not.to.include(':connection-state="taskWorkspace?.connectionState"')
    expect(hallSource).not.to.include(':error="taskWorkspace?.error"')
    expect(hallSource).not.to.include(':actor-agent-id="taskWorkspace?.subject?.actorAgentId || \'\'"')
    expect(panelSource).not.to.include('role="dialog"')
    expect(hallSource).to.include("if (renderedPanel.value === 'workspace') return '协作工作台'")
  })

  it('opens only from an existing explicit workspace subject without actor fallback', () => {
    const openWorkspaceSource = hallSource.slice(hallSource.indexOf('const openTaskWorkspace'), hallSource.indexOf('const closePanel'))
    expect(openWorkspaceSource).to.include('taskWorkspaceSubject.value?.taskId')
    expect(openWorkspaceSource).to.include('taskWorkspaceSubject.value?.actorAgentId')
    expect(openWorkspaceSource).to.include("openPanel('workspace')")
    expect(openWorkspaceSource).not.to.match(/coordinator|assignee|roster|alias|agents\.value\[0\]|selectedAgent\.value\?\.agentId/)
  })

  it('mounts concrete workspace refs so subject, state, error, and retry are usable by the panel', async () => {
    const taskWorkspace = {
      subject: Vue.ref(null),
      workspace: Vue.ref(null),
      connectionState: Vue.ref('idle'),
      error: Vue.ref(null),
      retryCalls: 0,
      retry () {
        this.retryCalls += 1
      }
    }
    const WorkspaceSurface = Vue.defineComponent({
      setup () {
        const taskWorkspaceView = useTaskWorkspaceView(taskWorkspace)
        return {
          taskWorkspaceSubject: taskWorkspaceView.subject,
          taskWorkspaceSnapshot: taskWorkspaceView.workspace,
          taskWorkspaceConnectionState: taskWorkspaceView.connectionState,
          taskWorkspaceError: taskWorkspaceView.error,
          retryTaskWorkspace: taskWorkspaceView.retry,
          renderedPanel: Vue.ref('workspace')
        }
      },
      render () {
        return Vue.h('div', [
          this.taskWorkspaceSubject
            ? Vue.h('button', { class: 'panel-workspace-link', type: 'button' }, '协作工作台')
            : null,
          this.renderedPanel === 'workspace' && this.taskWorkspaceSubject
            ? Vue.h(TaskWorkspacePanel, {
              actorAgentId: this.taskWorkspaceSubject.actorAgentId,
              connectionState: this.taskWorkspaceConnectionState,
              error: this.taskWorkspaceError,
              workspace: this.taskWorkspaceSnapshot,
              onRetry: this.retryTaskWorkspace
            })
            : null
        ])
      }
    })
    const wrapper = mount(WorkspaceSurface)
    try {
      expect(wrapper.find('.panel-workspace-link').exists()).to.equal(false)
      expect(wrapper.findComponent(TaskWorkspacePanel).exists()).to.equal(false)

      taskWorkspace.subject.value = { taskId: 'task-1', actorAgentId: 'agent-77' }
      taskWorkspace.workspace.value = workspaceFixture()
      taskWorkspace.connectionState.value = 'degraded'
      taskWorkspace.error.value = { message: '服务暂不可用' }
      await Vue.nextTick()

      const panel = wrapper.findComponent(TaskWorkspacePanel)
      expect(wrapper.find('.panel-workspace-link').exists()).to.equal(true)
      expect(panel.exists()).to.equal(true)
      expect(panel.find('dd[title="agent-77"]').text()).to.equal('agent-77')
      expect(panel.find('.task-connection-badge').text()).to.equal('服务暂不可用')
      expect(panel.find('button.task-workspace-retry').exists()).to.equal(true)

      taskWorkspace.connectionState.value = 'error'
      await Vue.nextTick()
      expect(panel.find('[role="alert"]').text()).to.equal('服务暂不可用')
      await panel.find('button.task-workspace-retry').trigger('click')
      expect(taskWorkspace.retryCalls).to.equal(1)
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps the workspace read-only and conversation association-only', () => {
    const panelBinding = hallSource.slice(hallSource.indexOf('<TaskWorkspacePanel'), hallSource.indexOf('<PersonaCatalogPanel'))
    expect(panelBinding).not.to.match(/assign-task|create-task|archive-task|send-message|loadHallMessages|enterPrivateConversation/)
    expect(panelSource).not.to.match(/loadHallMessages|new-conversation|enterPrivateConversation|send-message/)
  })

  it('preserves map/roster separation, no active route, and explicit assignment targets', () => {
    expect(hallDataSource).to.include("agentApi.get('/map'")
    expect(hallDataSource).to.include("agentApi.search('/roster'")
    expect(hallDataSource).not.to.include("'/active'")
    expect(hallSource).to.include('await runAssignTask(task, agent)')
    expect(taskActionsSource).to.include('agentId: targetAgent.agentId')
  })
})
