import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'
import * as silver from '../src/utils/silverAmount.js'
import * as cancellation from '../src/composables/juyiting/useHallOrdinaryCancellation.js'

const read = name => readFileSync(new URL(`../src/components/${name}.vue`, import.meta.url), 'utf8')
const hall = read('world/JuyiHall')
const Empty = Vue.defineComponent({ render: () => Vue.h('span') })
const compile = name => {
  const { descriptor } = parse(read(name))
  const imports = new Proxy({ vue: Vue, '@/utils/silverAmount': silver,
    '../../composables/juyiting/useHallOrdinaryCancellation.js': cancellation }, { get: (target, key) => target[key] || Empty })
  const code = compileScript(descriptor, { id: 'flow-ui-test', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, names, path) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)(imports)
}
const Panel = compile('juyiting/BountyPanel')
const Catalog = compile('juyiting/PersonaCatalogPanel')
const baseProps = { embeddedHall: true, detailAllowed: true, identityScope: 'owner-a',
  abilityText: () => '', canAssign: () => true, formatTime: () => '', portraitName: () => '', portraitStyle: () => ({}),
  taskAgentMatchScore: () => 0, taskStateClass: () => '', taskStatusCount: () => 0, taskStatusText: value => value,
  operableAgents: [{ agentId: 'old-agent', name: '林冲', canOperate: true, status: 'online' }] }

describe('flow gap actual UI consumers', () => {
  for (const assignedAgentIds of [[], ['old-agent']]) it(`renders cancelled with ${assignedAgentIds.length} historical assignee(s) without executable CTA; retains history entry`, async () => {
    const task = { id: 'a', title: '普通事项', status: 'cancelled', taskVersion: '3', assignedAgentIds }
    const wrapper = mount(Panel, { props: { ...baseProps, tasks: [task], selectedTask: task } })
    try {
      wrapper.vm.openTask(task); await Vue.nextTick()
      expect(wrapper.get('.matter-advice-heading').text()).to.include('已取消')
      expect(wrapper.find('.ordinary-cancellation').exists()).to.equal(false)
      expect(wrapper.find('.matter-primary-action').exists()).to.equal(false)
      expect(wrapper.find('.task-operation-grid').exists()).to.equal(false)
      expect(wrapper.find('.deliberation-execution-route').exists()).to.equal(false)
      await wrapper.get('.matter-results-action').trigger('click')
      expect(wrapper.emitted('open-formal-results').at(-1)[0].id).to.equal('a')
      expect(wrapper.emitted('discuss-task')).to.equal(undefined)
      const refreshed = { ...task }; await wrapper.setProps({ selectedTask: refreshed }); await Vue.nextTick()
      expect(wrapper.get('.matter-advice-heading').text()).to.include('已取消')
      expect(task.assignedAgentIds).to.deep.equal(assignedAgentIds)
    } finally { wrapper.unmount() }
  })
  it('confirms assigned pre-start cancellation with the original version; busy prevents another click', async () => {
    const task = { id: 'a', title: '普通事项', status: 'assigned', taskVersion: '2', funding: null, assignedAgentIds: ['old-agent'] }
    const wrapper = mount(Panel, { props: { ...baseProps, tasks: [task], selectedTask: task } })
    try {
      wrapper.vm.openTask(task); await Vue.nextTick()
      const button = wrapper.get('.ordinary-cancellation button')
      await button.trigger('click'); expect(wrapper.emitted('cancel-task')).to.equal(undefined)
      wrapper.get('var-dialog').element.dispatchEvent(new window.Event('confirm')); await Vue.nextTick()
      expect(wrapper.emitted('cancel-task')).to.have.length(1)
      expect(wrapper.emitted('cancel-task')[0][0]).to.include({ id: 'a', taskVersion: '2' })
      await wrapper.setProps({ cancellationBusy: true }); await button.trigger('click')
      expect(button.attributes('disabled')).to.equal(''); expect(wrapper.emitted('cancel-task')).to.have.length(1)
      await wrapper.setProps({ cancellationBusy: false, cancellationState: { taskId: 'a', status: 'unresolved' } })
      expect(button.text()).to.equal('核对原取消结果')
    } finally { wrapper.unmount() }
  })
  it('funded tasks display only their own funded cancellation CTA', async () => {
    const task = { id: 'a', status: 'open', version: '2', funding: { mode: 'FUNDED_SINGLE_AGENT', fundingStatus: 'FUNDS_HELD', remainingMicro: '100' } }
    const wrapper = mount(Panel, { props: { ...baseProps, tasks: [task], selectedTask: task } })
    try {
      wrapper.vm.openTask(task); await Vue.nextTick()
      expect(wrapper.find('.ordinary-cancellation').exists()).to.equal(false)
      expect(wrapper.findAll('.funding-summary').every(row => row.text().includes(silver.formatSilverMicro('100')))).to.equal(true)
      expect(wrapper.get('.funded-preview-details').text()).to.include('开工前撤榜并退款')
      await wrapper.get('.funded-preview-details .funded-detail-button').trigger('click')
      expect(wrapper.emitted('cancel-funding')[0]).to.deep.equal([task])
    }
    finally { wrapper.unmount() }
  })
  it('catalog requests parent confirmation, never emits an immediate unbind, and respects busy', async () => {
    const persona = { personaCode: 'gss', agentId: 'old-agent', boundToMe: true, name: '公孙胜' }
    const wrapper = mount(Catalog, { props: { personas: [persona], portraitName: () => '', portraitStyle: () => ({}) }, global: { stubs: { 'var-icon': true } } })
    try {
      const button = wrapper.findAll('button').find(item => item.text() === '除名下山')
      await button.trigger('click'); expect(wrapper.emitted('request-unbind-persona')).to.have.length(1)
      expect(wrapper.emitted('unbind-persona')).to.equal(undefined)
      await wrapper.setProps({ unbindBusy: true }); await button.trigger('click')
      expect(wrapper.emitted('request-unbind-persona')).to.have.length(1)
    } finally { wrapper.unmount() }
  })
  it('all touched SFCs compile without a production build', () => {
    for (const name of ['juyiting/BountyPanel', 'juyiting/PersonaCatalogPanel', 'world/JuyiHall']) {
      const { descriptor, errors } = parse(read(name)); expect(errors).to.deep.equal([])
      compileScript(descriptor, { id: name })
      expect(compileTemplate({ source: descriptor.template.content, filename: `${name}.vue`, id: name }).errors).to.deep.equal([])
    }
  })
  it('completed and accepted still route to the existing acceptance receipt panel, not the new cancellation history', () => {
    const template = parse(hall).descriptor.template.content
    const history = template.match(/<section\s+v-if="([^"]+)"\s+class="terminal-task-history"/)[1]
    const acceptance = template.match(/<BountyAcceptancePanel\s+v-else-if="([^"]+)"/)[1]
    const evaluate = (condition, status) => new Function('renderedPanel', 'formalTaskRef', 'hallIdentityScope',
      'multimediaDeliberationUiEnabled', 'taskReviewRef', `return (${condition})`)('tasks', { id: 'a', status }, 'owner', true, null)
    for (const status of ['completed', 'accepted']) {
      expect(evaluate(history, status)).to.equal(false)
      expect(evaluate(acceptance, status)).to.equal(true)
    }
    expect(template).to.include(":task-completed=\"formalTaskRef.status === 'completed'\"")
  })
  it('groups history reload controls with responsive styling and preserves both read handlers', async () => {
    const template = hall.match(/<div class="terminal-history-actions"[\s\S]*?<\/div>/)[0]
    const compiled = compileTemplate({ source: template, filename: 'history-actions.vue', id: 'history-actions',
      compilerOptions: { mode: 'function' } })
    expect(compiled.errors).to.deep.equal([])
    const calls = []
    const wrapper = mount(Vue.defineComponent({
      setup: () => ({ refreshTerminalHistory: () => calls.push('history'),
        terminalConversationHistory: { refresh: () => calls.push('text') } }),
      render: new Function('Vue', compiled.code)(Vue)
    }))
    try {
      expect(wrapper.attributes('role')).to.equal('group')
      const buttons = wrapper.findAll('button')
      expect(buttons.map(button => button.text())).to.deep.equal(['重新读取历史成果', '重新读取议事文字成果'])
      for (const button of buttons) {
        expect(button.attributes('type')).to.equal('button')
        await button.trigger('click')
      }
      expect(calls).to.deep.equal(['history', 'text'])
    } finally { wrapper.unmount() }
    const css = parse(hall).descriptor.styles[0].content
    const actions = css.match(/\.terminal-history-actions \{([^}]+)\}/)[1]
    expect(actions).to.include('flex-wrap: wrap').and.include('gap: 12px').and.include('margin: 16px 0')
    const button = css.match(/\.terminal-history-actions button \{([^}]+)\}/)[1]
    for (const rule of ['min-height: 44px', 'font: inherit', 'white-space: normal', 'max-width: 100%', 'border: 1px solid']) {
      expect(button).to.include(rule)
    }
    expect(css).to.include('.terminal-history-actions button:focus-visible')
    expect(css).to.match(/@media \(max-width: 600px\) \{\s*\.terminal-history-actions \{ flex-direction: column; \}\s*\.terminal-history-actions button \{ width: 100%; \}/)
  })
  it('hides the workspace entry on every formal results page without removing the normal task entry', async () => {
    const template = hall.match(/<button\s+v-if="[^"]+"\s+class="panel-workspace-link"[\s\S]*?<\/button>/)[0]
    const compiled = compileTemplate({ source: template, filename: 'workspace-entry.vue', id: 'workspace-entry',
      compilerOptions: { mode: 'function' } })
    expect(compiled.errors).to.deep.equal([])
    const state = Vue.reactive({ taskWorkspaceEnabled: true, renderedPanel: 'tasks', formalTaskRef: null,
      taskWorkspaceSubject: { taskId: 'a', actorAgentId: 'agent-a' } })
    let opened = 0
    const wrapper = mount(Vue.defineComponent({
      setup: () => ({ ...Vue.toRefs(state), openTaskWorkspace: () => { opened += 1 } }),
      render: new Function('Vue', compiled.code)(Vue)
    }))
    try {
      await wrapper.get('button').trigger('click')
      expect(opened).to.equal(1)
      for (const status of ['open', 'assigned', 'running', 'completed', 'accepted', 'cancelled']) {
        state.formalTaskRef = { id: 'a', status }; await Vue.nextTick()
        expect(wrapper.find('button').exists(), status).to.equal(false)
      }
      state.formalTaskRef = null; await Vue.nextTick()
      expect(wrapper.get('button').text()).to.equal('协作工作台')
      state.taskWorkspaceSubject = null; await Vue.nextTick()
      expect(wrapper.find('button').exists()).to.equal(false)
      state.taskWorkspaceSubject = { taskId: 'a', actorAgentId: 'agent-a' }
      state.taskWorkspaceEnabled = false; await Vue.nextTick()
      expect(wrapper.find('button').exists()).to.equal(false)
      state.taskWorkspaceEnabled = true; state.renderedPanel = 'chat'; await Vue.nextTick()
      expect(wrapper.find('button').exists()).to.equal(false)
    } finally { wrapper.unmount() }
    expect(hall).to.include("if (renderedPanel.value === 'tasks' && formalTaskRef.value) { formalTaskRef.value = null; return true }")
    expect(hall).to.include('<TaskWorkspacePanel')
  })
  it('terminal history is a separate read adapter with preview/download, not acceptance or continuation', () => {
    const section = hall.match(/<section\s+v-if="renderedPanel[^>]+class="terminal-task-history"[\s\S]*?<\/section>/)?.[0]
    expect(section).to.include("formalTaskRef?.status === 'cancelled'")
    expect(section).to.include('terminalHistory.preview'); expect(section).to.include('downloadTerminalOutput(item)')
    expect(section).not.to.include('BountyAcceptancePanel'); expect(section).not.to.include('continue-modification')
    expect(hall).to.include('const terminalHistory = useOutputs(')
    expect(hall).to.include("{ type: 'task', id: formalTaskRef.value.id }")
    expect(hall.match(/const openFormalResults = task => \{[\s\S]*?\n\}/)[0]).not.to.include('isTerminalMatter')
    expect(hall).to.include("if (catalogError.value || rosterError.value || mapError.value) throw new Error('名册投影刷新待完成')")
  })
})

const handlerSource = hall.match(/const handleUnbindPersona = async \(persona\) => \{[\s\S]*?\n\}/)[0].replace('const handleUnbindPersona =', 'return')
const confirmationHarness = (action = 'confirm') => {
  const persona = { personaCode: 'gss', agentId: 'old-agent', boundToMe: true, name: '公孙胜' }
  const dialogs = []; const deleted = []; const toasts = []
  const deps = { personaUnbindBusy: Vue.ref(false), hallIdentityScope: Vue.ref('owner-a'), apiStore: { authorizationGeneration: 1 },
    panelSessionGeneration: Vue.ref(1), panelDisposed: false, renderedPanel: Vue.ref('catalog'),
    portraitShortName: item => item.name, Dialog: async options => { dialogs.push(options); return typeof action === 'function' ? action() : action },
    personaCatalog: Vue.ref([persona]), unbindPersona: async item => { deleted.push(item); return true },
    selectedAgent: Vue.ref(null), personaSetupResult: Vue.ref(null), syncAfterPersonaChanged() {}, playSuccess() {}, playError() {},
    showToast: message => toasts.push(message), log: { warn() {} } }
  const keys = Object.keys(deps)
  return { persona, deps, dialogs, deleted, toasts, run: new Function(...keys, handlerSource)(...keys.map(key => deps[key])) }
}
describe('actual JuyiHall destructive confirmation handler', () => {
  for (const action of ['cancel', 'close']) it(`${action} cannot delete the binding`, async () => {
    const h = confirmationHarness(action); expect(await h.run(h.persona)).to.equal(false); expect(h.deleted).to.have.length(0)
    expect(h.dialogs[0].message).to.include('不会自动承接剩余租期')
    expect(h.dialogs[0].message).to.include('重新报价并收费')
    expect(h.dialogs[0].message).to.include('免费重整')
    expect(h.dialogs[0].message).to.include('不能认定没有租约或没有成本')
  })
  it('deletes once only after explicit confirmation', async () => {
    const h = confirmationHarness(); expect(await h.run(h.persona)).to.equal(true)
    expect(h.deleted).to.have.length(1); expect(h.deps.personaUnbindBusy.value).to.equal(false)
  })
  for (const boundary of ['identity', 'epoch', 'panel', 'binding']) it(`does not delete after ${boundary} changed during confirmation`, async () => {
    const h = confirmationHarness(() => {
      if (boundary === 'identity') h.deps.hallIdentityScope.value = 'owner-b'
      if (boundary === 'epoch') h.deps.apiStore.authorizationGeneration++
      if (boundary === 'panel') h.deps.renderedPanel.value = 'tasks'
      if (boundary === 'binding') h.deps.personaCatalog.value = [{ ...h.persona, agentId: 'new-agent' }]
      return 'confirm'
    })
    expect(await h.run(h.persona)).to.equal(false); expect(h.deleted).to.have.length(0)
  })
  it('suppresses repeated clicks while awaiting confirmation', async () => {
    let resolve; const wait = new Promise(done => { resolve = done }); const h = confirmationHarness(() => wait)
    const pending = h.run(h.persona); expect(await h.run(h.persona)).to.equal(false)
    resolve('confirm'); expect(await pending).to.equal(true); expect(h.dialogs).to.have.length(1); expect(h.deleted).to.have.length(1)
  })
})
