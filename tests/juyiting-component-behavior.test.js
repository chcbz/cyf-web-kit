import { expect } from 'chai'
import { readFileSync } from 'fs'
import { compileScript, parse } from '@vue/compiler-sfc'

global.SVGElement = global.window?.SVGElement

let mount
let Vue
let BottomDock
let BountyPanel
let ChatPanel
let CommandPanel
let CoordinationPanel
let HallStage
let LibraryPanel

const vueImportToVar = (_line, imports) => {
  const vueBindings = imports.split(',').map((part) => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')

  return vueBindings ? `var { ${vueBindings} } = Vue` : ''
}

const loadSfc = (relativePath) => {
  const filename = new URL(relativePath, import.meta.url).pathname
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename })
  const id = `test-${relativePath.replace(/[^a-z0-9]/gi, '-')}`
  const script = compileScript(descriptor, {
    id,
    inlineTemplate: true,
    templateOptions: {
      compilerOptions: {
        isCustomElement: tag => tag === 'var-icon'
      }
    }
  }).content

  const scriptBody = script
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+AgentToken\s+from\s+['"]@\/components\/juyiting\/AgentToken\.vue['"];?\s*$/gm, 'var AgentToken = { template: \'<span />\', props: [\'agent\'] }')
    .replace(/^import\s+\{\s*marked\s*\}\s+from\s+['"]marked['"];?\s*$/gm, 'var marked = { setOptions: () => {}, parse: value => value }')
    .replace(/^import\s+DOMPurify\s+from\s+['"]dompurify['"];?\s*$/gm, 'var DOMPurify = { sanitize: value => value }')
    .replace('export default', 'return')

  return new Function('Vue', scriptBody)(Vue)
}

const stubs = {
  'var-icon': { template: '<i />' }
}

describe('JuyiHall component behavior', () => {
  before(async () => {
    global.SVGElement = global.window?.SVGElement
    global.Element = global.window?.Element
    global.Node = global.window?.Node
    ;({ mount } = await import('@vue/test-utils'))
    Vue = await import('vue')
    BottomDock = loadSfc('../src/components/juyiting/BottomDock.vue')
    BountyPanel = loadSfc('../src/components/juyiting/BountyPanel.vue')
    ChatPanel = loadSfc('../src/components/juyiting/ChatPanel.vue')
    CommandPanel = loadSfc('../src/components/juyiting/CommandPanel.vue')
    CoordinationPanel = loadSfc('../src/components/juyiting/CoordinationPanel.vue')
    HallStage = loadSfc('../src/components/juyiting/HallStage.vue')
    LibraryPanel = loadSfc('../src/components/juyiting/LibraryPanel.vue')
  })

  it('uses the central courtyard as the all-hands discussion entrance without a command room', async () => {
    const wrapper = mount(HallStage, {
      global: { stubs },
      props: {
        agentKey: agent => agent.agentId,
        agentStyle: () => ({}),
        portraitName: agent => agent.name,
        portraitShortName: agent => agent.name,
        portraitStyle: () => ({}),
        roleClass: () => '',
        statusClass: () => '',
        statusText: () => '',
        tasksTotal: 3,
        visibleAgents: []
      }
    })

    expect(wrapper.text()).to.include('议事中庭')
    expect(wrapper.text()).to.include('全员议事')
    expect(wrapper.text()).not.to.include('传令房')
    expect(wrapper.find('.room-chat').exists()).to.equal(false)
    expect(wrapper.find('.hotspot-chat').exists()).to.equal(false)

    await wrapper.find('.room-main').trigger('click')

    expect(wrapper.emitted('open-panel')[0]).to.deep.equal(['chat'])
  })

  it('opens panels and clears locked contexts from BottomDock', async () => {
    const wrapper = mount(BottomDock, {
      global: { stubs },
      props: {
        activePanel: 'tasks',
        agentsTotal: 18,
        tasksTotal: 5,
        selectedAgent: { agentId: 'agent-wuyong', name: 'Wu Yong' },
        selectedTask: { id: 'task-1', title: 'Inspect the camp' },
        agentLabel: 'Strategist / Wu Yong'
      }
    })

    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    await buttons[6].trigger('click')
    await buttons[7].trigger('click')

    expect(wrapper.emitted('open-panel')[0]).to.deep.equal(['command'])
    expect(wrapper.emitted('clear-agent')).to.have.length(1)
    expect(wrapper.emitted('clear-task')).to.have.length(1)
    expect(wrapper.text()).to.include('Strategist / Wu Yong')
    expect(wrapper.text()).to.include('Inspect the camp')
  })

  it('emits explicit recommendation actions from BountyPanel', async () => {
    const selectedTask = {
      id: 'task-1',
      title: 'Inspect the camp',
      status: 'open',
      description: 'Inspect every outpost',
      requiredAbilities: ['planning']
    }
    const agent = {
      agentId: 'agent-wuyong',
      name: 'Wu Yong',
      status: 'online',
      abilities: ['planning']
    }
    const wrapper = mount(BountyPanel, {
      global: { stubs },
      props: {
        tasks: [selectedTask],
        selectedTask,
        selectedAgent: null,
        recommendedAgents: [agent],
        taskAbilityOptions: ['planning'],
        taskStatusFilters: [],
        abilityText: item => (item.abilities || []).join(' / '),
        canAssign: (task, targetAgent) => Boolean(task && targetAgent),
        formatTime: value => value,
        portraitName: item => item.name,
        portraitStyle: () => ({}),
        taskAgentMatchScore: () => 98,
        taskStateClass: () => 'is-open',
        taskStatusCount: () => 1,
        taskStatusText: status => status
      }
    })

    await wrapper.find('.task-card').trigger('click')

    expect(wrapper.text()).to.include('单独议事')
    expect(wrapper.text()).to.include('悬赏议事')
    expect(wrapper.text()).not.to.include('传令议事')

    const actionButtons = wrapper.findAll('.recommended-agent-actions button')
    await actionButtons[0].trigger('click')
    await actionButtons[1].trigger('click')
    await actionButtons[2].trigger('click')

    expect(wrapper.emitted('select-agent')[0]).to.deep.equal([agent])
    expect(wrapper.emitted('assign-task')[0]).to.deep.equal([selectedTask, agent])
    expect(wrapper.emitted('brief-selected-task')[0]).to.deep.equal([selectedTask, agent])
  })

  it('does not reopen BountyPanel detail modal from a stale selected task', async () => {
    const selectedTask = {
      id: 'task-1',
      title: 'Inspect the camp',
      status: 'open',
      description: 'Inspect every outpost',
      requiredAbilities: ['planning']
    }
    const wrapper = mount(BountyPanel, {
      global: { stubs },
      props: {
        tasks: [selectedTask],
        selectedTask,
        selectedAgent: null,
        recommendedAgents: [],
        taskAbilityOptions: ['planning'],
        taskStatusFilters: [],
        abilityText: item => (item.abilities || []).join(' / '),
        canAssign: (task, targetAgent) => Boolean(task && targetAgent),
        formatTime: value => value,
        portraitName: item => item.name,
        portraitStyle: () => ({}),
        taskAgentMatchScore: () => 98,
        taskStateClass: () => 'is-open',
        taskStatusCount: () => 1,
        taskStatusText: status => status
      }
    })

    expect(wrapper.find('.bounty-modal-overlay').exists()).to.equal(false)

    await wrapper.find('.task-card').trigger('click')

    expect(wrapper.find('.bounty-modal-overlay').exists()).to.equal(true)
    expect(wrapper.emitted('select-task')[0]).to.deep.equal([selectedTask])
  })

  it('emits create, multi-assign, discussion and archive actions from BountyPanel', async () => {
    const selectedTask = {
      id: 'task-1',
      title: 'Inspect the camp',
      status: 'assigned',
      description: 'Inspect every outpost',
      assignedAgentIds: ['agent-wuyong']
    }
    const agents = [
      { agentId: 'agent-wuyong', name: 'Wu Yong', status: 'online', abilities: ['planning'] },
      { agentId: 'agent-linchong', name: 'Lin Chong', status: 'online', abilities: ['execute'] }
    ]
    const wrapper = mount(BountyPanel, {
      global: { stubs },
      props: {
        tasks: [selectedTask],
        selectedTask,
        selectedAgent: null,
        recommendedAgents: agents,
        taskAbilityOptions: ['planning'],
        taskStatusFilters: [],
        abilityText: item => (item.abilities || []).join(' / '),
        canAssign: () => true,
        formatTime: value => value,
        portraitName: item => item.name,
        portraitStyle: () => ({}),
        taskAgentMatchScore: () => 98,
        taskStateClass: () => 'is-open',
        taskStatusCount: () => 1,
        taskStatusText: status => status
      }
    })

    await wrapper.find('.new-task-button').trigger('click')
    await wrapper.find('input[name="taskTitle"]').setValue('Review reports')
    await wrapper.find('textarea[name="taskDescription"]').setValue('Summarize reports')
    await wrapper.find('.task-create-form').trigger('submit')
    await wrapper.find('.task-card').trigger('click')
    await wrapper.findAll('.assignee-check')[0].setChecked(true)
    await wrapper.findAll('.assignee-check')[1].setChecked(true)
    await wrapper.find('.assign-selected-agents').trigger('click')
    await wrapper.find('.discuss-task-button').trigger('click')
    await wrapper.find('.archive-task-button').trigger('click')

    expect(wrapper.emitted('create-task')[0][0]).to.include({
      title: 'Review reports',
      description: 'Summarize reports'
    })
    expect(wrapper.emitted('assign-task')[0]).to.deep.equal([selectedTask, agents])
    expect(wrapper.emitted('discuss-task')[0]).to.deep.equal([selectedTask])
    expect(wrapper.emitted('archive-task')[0]).to.deep.equal([selectedTask])
  })

  it('keeps discussion disabled for unassigned bounty tasks with a readable hint', async () => {
    const selectedTask = {
      id: 'task-1',
      title: 'Inspect the camp',
      status: 'open',
      description: 'Inspect every outpost',
      assignedAgentIds: []
    }
    const wrapper = mount(BountyPanel, {
      global: { stubs },
      props: {
        tasks: [selectedTask],
        selectedTask,
        selectedAgent: null,
        recommendedAgents: [],
        taskAbilityOptions: ['planning'],
        taskStatusFilters: [],
        abilityText: item => (item.abilities || []).join(' / '),
        canAssign: () => false,
        formatTime: value => value,
        portraitName: item => item.name,
        portraitStyle: () => ({}),
        taskAgentMatchScore: () => 98,
        taskStateClass: () => 'is-open',
        taskStatusCount: () => 1,
        taskStatusText: status => status
      }
    })

    await wrapper.find('.task-card').trigger('click')

    const discussButton = wrapper.find('.discuss-task-button')
    await discussButton.trigger('click')

    expect(discussButton.attributes('disabled')).to.not.equal(undefined)
    expect(wrapper.text()).to.include('该悬赏还未分派，暂不能进入议事')
    expect(wrapper.emitted('discuss-task')).to.equal(undefined)
  })

  it('keeps persistent command templates out of ChatPanel', async () => {
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents: [],
        draft: '',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        selectedTask: { id: 'task-1', title: 'Inspect the camp' },
        targetText: 'Strategist / Wu Yong',
        connectionStatus: 'Synced'
      }
    })

    expect(wrapper.find('.command-templates').exists()).to.equal(false)
    expect(wrapper.text()).to.include('Inspect the camp')
    expect(wrapper.emitted('apply-template')).to.equal(undefined)
    expect(wrapper.emitted('send-message')).to.equal(undefined)
  })

  it('keeps ChatPanel targets collapsed behind a local target action', async () => {
    const agents = [
      { agentId: 'wuyong', name: 'Wu Yong' },
      { agentId: 'linchong', name: 'Lin Chong' }
    ]
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents,
        draft: '',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        targetText: 'All agents',
        connectionStatus: 'Synced'
      }
    })

    expect(wrapper.find('.discussion-target-controls').exists()).to.equal(true)
    expect(wrapper.find('.compact-mention-strip').exists()).to.equal(false)

    await wrapper.find('.target-toggle').trigger('click')
    await wrapper.findAll('.compact-mention-strip button')[1].trigger('click')

    expect(wrapper.emitted('mention-agent')[0]).to.deep.equal([agents[1]])
  })

  it('does not expose a cross-scope mode switch inside the shared ChatPanel', () => {
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents: [],
        draft: '',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        targetText: 'All agents',
        connectionStatus: 'Synced'
      }
    })

    expect(wrapper.find('.mode-switch').exists()).to.equal(false)
    expect(wrapper.find('.mode-icon-button').exists()).to.equal(false)
    expect(wrapper.text()).not.to.include('公开会谈')
    expect(wrapper.text()).not.to.include('私聊')
  })

  it('keeps ChatPanel composer as a dedicated bottom region', () => {
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents: [],
        draft: '',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        targetText: 'All agents',
        connectionStatus: 'Synced'
      }
    })

    expect(wrapper.find('.chat-composer').exists()).to.equal(true)
    expect(wrapper.find('.hall-messages').exists()).to.equal(true)
  })

  it('keeps low-value SongJiang and coordination actions out of ChatPanel', async () => {
    const agents = [
      { agentId: 'wuyong', name: '吴用' },
      { agentId: 'linchong', name: '林冲' }
    ]
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents,
        draft: '',
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        selectedTask: { id: 'task-1', title: 'Inspect the camp' },
        targetText: '全体好汉',
        connectionStatus: 'Synced'
      }
    })

    expect(wrapper.find('.command-templates').exists()).to.equal(false)
    expect(wrapper.emitted('apply-template')).to.equal(undefined)
    expect(wrapper.find('.chief-templates').exists()).to.equal(false)
    expect(wrapper.find('.coordination-inline').exists()).to.equal(false)
    expect(wrapper.text()).not.to.include('宋江号令')
    expect(wrapper.text()).not.to.include('互相传话')
    expect(wrapper.text()).not.to.include('配合办事')
    expect(wrapper.emitted('relay-message')).to.equal(undefined)
    expect(wrapper.emitted('coordinate-work')).to.equal(undefined)
  })

  it('shows a readable recovery status while chat event stream reconnects', () => {
    const wrapper = mount(ChatPanel, {
      global: { stubs },
      props: {
        agents: [],
        draft: '',
        eventStreamRecovering: true,
        messages: [],
        mentionLabel: agent => agent.name,
        senderText: message => message.sender,
        targetText: '全体好汉'
      }
    })

    expect(wrapper.text()).to.include('正在尝试恢复回话')
  })

  it('emits SongJiang management commands from CommandPanel', async () => {
    const wrapper = mount(CommandPanel, {
      global: { stubs },
      props: {
        agentsTotal: 10,
        chiefAgent: { agentId: 'songjiang', name: '宋江' },
        portraitStyle: () => ({}),
        selectedAgent: null,
        selectedTask: { id: 'task-1', title: 'Inspect the camp' },
        tasksTotal: 3
      }
    })

    expect(wrapper.text()).to.include('巡检悬赏榜')
    expect(wrapper.text()).to.include('整备好汉名册')
    expect(wrapper.text()).to.include('全员议事')

    await wrapper.findAll('.command-grid button')[0].trigger('click')
    expect(wrapper.emitted('issue-command')[0]).to.deep.equal(['reviewBounties'])
  })

  it('emits relay and coordination actions from CoordinationPanel', async () => {
    const agents = [
      { agentId: 'wuyong', name: '吴用', abilities: ['planning'] },
      { agentId: 'linchong', name: '林冲', abilities: ['execute'] }
    ]
    const wrapper = mount(CoordinationPanel, {
      global: { stubs },
      props: {
        abilityText: agent => (agent.abilities || []).join(' / '),
        agents,
        fromAgentId: 'wuyong',
        message: '请同步风险',
        portraitStyle: () => ({}),
        selectedTask: { id: 'task-1', title: 'Inspect the camp' },
        toAgentId: 'linchong'
      }
    })

    const actionButtons = wrapper.findAll('.action-row button')
    await actionButtons[0].trigger('click')
    await actionButtons[1].trigger('click')

    expect(wrapper.text()).to.include('互相传话')
    expect(wrapper.text()).to.include('配合办事')
    expect(wrapper.emitted('relay-message')).to.have.length(1)
    expect(wrapper.emitted('coordinate-work')).to.have.length(1)
  })

  it('searches and cites vector library results from LibraryPanel', async () => {
    const wrapper = mount(LibraryPanel, {
      global: { stubs },
      props: {
        formatTime: value => String(value),
        keyword: 'deploy',
        loading: false,
        results: [{ id: 'm1', content: 'Deployment notes', summaryType: 'project', score: 0.8 }],
        sourceType: 'project'
      }
    })

    await wrapper.find('form').trigger('submit')
    await wrapper.find('.result-card button').trigger('click')

    expect(wrapper.text()).to.include('向量检索')
    expect(wrapper.emitted('search-library')).to.have.length(1)
    expect(wrapper.emitted('cite-library')[0][0].content).to.equal('Deployment notes')
  })

  it('shows public beta empty and error states for LibraryPanel', async () => {
    const emptyWrapper = mount(LibraryPanel, {
      global: { stubs },
      props: {
        formatTime: value => String(value),
        hasSearched: true,
        keyword: 'unknown',
        loading: false,
        results: [],
        sourceType: 'project'
      }
    })

    expect(emptyWrapper.text()).to.include('暂未检索到资料')

    const errorWrapper = mount(LibraryPanel, {
      global: { stubs },
      props: {
        errorMessage: '藏经阁暂不可用，主流程不受影响',
        formatTime: value => String(value),
        hasSearched: true,
        keyword: 'deploy',
        loading: false,
        results: [],
        sourceType: 'project'
      }
    })

    expect(errorWrapper.text()).to.include('藏经阁暂不可用，主流程不受影响')
  })
})
