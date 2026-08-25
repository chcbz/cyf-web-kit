/* global before, beforeEach, after */
import { expect } from 'chai'
import { readFileSync } from 'fs'
import { compileScript, parse } from '@vue/compiler-sfc'

let mount
let Vue
let TaskTimeline
let TaskWorkspacePanel
const domGlobalDescriptors = {}
const domGlobalKeys = ['SVGElement', 'Element', 'Node']

const installDomGlobals = () => {
  for (const key of domGlobalKeys) global[key] = global.window?.[key]
}

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

const componentDeclarations = readFileSync(new URL('../src/components.d.ts', import.meta.url), 'utf8')

const workspaceFixture = (overrides = {}) => ({
  task: {
    taskId: 'task-1',
    status: 'running',
    requiredAbilities: '["analysis"]',
    reward: 0,
    assignedAgentId: 'agent-1',
    assignedAt: null,
    startedAt: null,
    completedAt: null,
    collaborationMode: 'team',
    riskLevel: 'medium',
    maxAgents: 4,
    coordinatorAgentId: null,
    reviewRequired: false,
    version: '3'
  },
  members: [{ agentId: 'agent-1', role: 'worker', status: 'working', assignmentSource: 'manual' }],
  workItems: [{ workItemId: 'work-1', title: 'A'.repeat(300), description: 'B'.repeat(500), workType: 'analysis', assigneeAgentId: 'agent-1', status: 'running', priority: 1, requiredItem: true, attemptCount: 1, maxAttempts: 3 }],
  openRequests: [{ requestId: 'request-1', title: 'Review', description: 'Please review', requestType: 'review', targetType: 'role', targetId: 'reviewer', status: 'open' }],
  recentArtifacts: [{ artifactId: 'artifact-1', title: 'Result', artifactType: 'report', visibility: 'task_members', producerAgentId: 'agent-1', artifactVersion: '1' }],
  recentArtifactsTruncated: false,
  conversationId: null,
  recentEvents: [{ version: '1', redacted: false, eventType: 'TASK_STARTED', actorType: 'system', aggregateType: 'task', aggregateId: 'task-1', occurredAt: '1' }],
  timelineTruncated: false,
  currentVersion: '3',
  ...overrides
})

describe('C07C task workspace accessibility and responsive contract', () => {
  before(async () => {
    for (const key of domGlobalKeys) {
      domGlobalDescriptors[key] = Object.getOwnPropertyDescriptor(global, key)
    }
    installDomGlobals()
    ;({ mount } = await import('@vue/test-utils'))
    Vue = await import('vue')
    TaskTimeline = loadSfc('../src/components/juyiting/TaskTimeline.vue')
    TaskWorkspacePanel = loadSfc('../src/components/juyiting/TaskWorkspacePanel.vue', TaskTimeline)
  })

  beforeEach(() => {
    installDomGlobals()
  })

  after(() => {
    for (const key of domGlobalKeys) {
      const descriptor = domGlobalDescriptors[key]
      if (descriptor) Object.defineProperty(global, key, descriptor)
      else delete global[key]
    }
  })

  it('renders semantic status, error, retry intent, and stable empty states', async () => {
    const wrapper = mount(TaskWorkspacePanel, {
      props: { actorAgentId: 'agent-1', connectionState: 'degraded', workspace: workspaceFixture() }
    })
    try {
      expect(wrapper.find('[role="status"]').text()).to.include('服务暂不可用')
      await wrapper.find('button.task-workspace-retry').trigger('click')
      expect(wrapper.emitted('retry')).to.have.length(1)
      await wrapper.setProps({ connectionState: 'error', error: { message: '无访问权限' }, workspace: workspaceFixture({ task: null }) })
      expect(wrapper.find('[role="alert"]').text()).to.equal('无访问权限')
      expect(wrapper.text()).to.include('请先明确选择任务与可访问的好汉')
    } finally {
      wrapper.unmount()
    }
  })

  it('renders bounded collection shapes and wraps extreme text without a second modal or write action', () => {
    const members = Array.from({ length: 499 }, (_, index) => ({ agentId: `agent-${index}`, role: 'worker', status: 'working', assignmentSource: 'manual' }))
    const wrapper = mount(TaskWorkspacePanel, { props: { workspace: workspaceFixture({ members }) } })
    try {
      expect(wrapper.findAll('[aria-label="协作成员"] .task-data-row')).to.have.length(499)
      expect(wrapper.find('.task-work-card').text()).to.include('A'.repeat(300))
      expect(wrapper.find('[role="dialog"]').exists()).to.equal(false)
      expect(wrapper.find('[data-action="write"]').exists()).to.equal(false)
    } finally {
      wrapper.unmount()
    }
  })

  it('renders required-ability JSON strings with strict bounded normalization', async () => {
    const sharedLongPrefix = '界'.repeat(64)
    const firstLongAbility = `${sharedLongPrefix}甲`
    const secondLongAbility = `${sharedLongPrefix}乙`
    const abilities = [' analysis ', '', 'analysis', firstLongAbility, secondLongAbility, ...Array.from({ length: 14 }, (_, index) => `ability-${index}`)]
    const initial = workspaceFixture()
    const wrapper = mount(TaskWorkspacePanel, {
      props: {
        workspace: workspaceFixture({
          task: { ...initial.task, requiredAbilities: JSON.stringify(abilities) }
        })
      }
    })
    try {
      const tags = wrapper.findAll('.task-abilities .task-tag')
      expect(tags).to.have.length(12)
      expect(tags.map(tag => tag.text()).filter(value => value === 'analysis')).to.deep.equal(['analysis'])
      expect(tags[1].text()).to.equal(`${sharedLongPrefix}…`)
      expect(tags[2].text()).to.equal(`${sharedLongPrefix}…`)
      expect(tags[1].attributes('title')).to.equal(firstLongAbility)
      expect(tags[2].attributes('title')).to.equal(secondLongAbility)
      expect(tags[1].attributes('title')).not.to.equal(tags[2].attributes('title'))
      expect(wrapper.find('.task-abilities [role="status"]').text()).to.equal('仅显示前 12 项本领')

      for (const requiredAbilities of ['["analysis"', '"analysis"', '["analysis", 7]']) {
        await wrapper.setProps({
          workspace: workspaceFixture({ task: { ...initial.task, requiredAbilities } })
        })
        expect(wrapper.findAll('.task-abilities .task-tag')).to.have.length(0)
        expect(wrapper.find('.task-abilities').text()).to.equal('所需本领格式不可用')
      }

      await wrapper.setProps({
        workspace: workspaceFixture({
          task: { ...initial.task, requiredAbilities: JSON.stringify(['界'.repeat(22000)]) }
        })
      })
      expect(wrapper.findAll('.task-abilities .task-tag')).to.have.length(0)
      expect(wrapper.find('.task-abilities').text()).to.equal('所需本领格式不可用')

      for (const requiredAbilities of [null, '', '   ', '[]', '["", "   "]']) {
        await wrapper.setProps({
          workspace: workspaceFixture({ task: { ...initial.task, requiredAbilities } })
        })
        expect(wrapper.find('.task-abilities').text()).to.equal('未声明所需本领')
      }
    } finally {
      wrapper.unmount()
    }
  })

  it('renders redacted timeline events by reading only redacted and version', () => {
    const accessed = []
    const redacted = {}
    Object.defineProperties(redacted, {
      version: { enumerable: true, get: () => { accessed.push('version'); return '9' } },
      redacted: { enumerable: true, get: () => { accessed.push('redacted'); return true } },
      eventType: { enumerable: false, get: () => { throw new Error('redacted event type must not be read') } },
      actorId: { enumerable: false, get: () => { throw new Error('redacted actor must not be read') } },
      aggregateId: { enumerable: false, get: () => { throw new Error('redacted aggregate must not be read') } },
      occurredAt: { enumerable: false, get: () => { throw new Error('redacted timestamp must not be read') } }
    })
    const wrapper = mount(TaskTimeline, { props: { events: [redacted] } })
    try {
      expect(wrapper.text()).to.include('版本 9')
      expect(wrapper.text()).to.include('此事件内容已脱敏。')
      expect(new Set(accessed)).to.deep.equal(new Set(['redacted', 'version']))
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps generated declarations for both workspace presentation components', () => {
    expect(componentDeclarations).to.include("TaskTimeline: typeof import('./components/juyiting/TaskTimeline.vue')['default']")
    expect(componentDeclarations).to.include("TaskWorkspacePanel: typeof import('./components/juyiting/TaskWorkspacePanel.vue')['default']")
  })

  it('keeps responsive, keyboard, long-text, and reduced-motion protections explicit', () => {
    const panelSource = readFileSync(new URL('../src/components/juyiting/TaskWorkspacePanel.vue', import.meta.url), 'utf8')
    const timelineSource = readFileSync(new URL('../src/components/juyiting/TaskTimeline.vue', import.meta.url), 'utf8')
    for (const source of [panelSource, timelineSource]) {
      expect(source).to.include('@media (max-width: 640px)')
      expect(source).to.include('@media (prefers-reduced-motion: reduce)')
      expect(source).to.include('overflow-wrap: anywhere')
    }
    expect(panelSource).to.include('button')
    expect(panelSource).to.include(':focus-visible')
    expect(panelSource).to.include('role="status" aria-live="polite"')
    expect(panelSource).to.include('role="alert"')
  })
})
