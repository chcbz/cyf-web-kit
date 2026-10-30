import { useHallAgentAbilitiesEditor } from '../src/composables/juyiting/useHallAgentAbilitiesEditor.js'
import { skillComponents } from './helpers/skill-management-components.js'
import { readFileSync } from 'node:fs'
import { expect } from 'chai'
import { parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/juyiting/AgentPanel.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const AgentPanel = skillComponents().AgentPanel
const agent = { agentId: 'agent-actions-fixture', name: '公孙胜', abilities: [] }
const props = {
  selectedAgent: agent, hasPendingTask: true,
  canStartConversation: () => true, canPointAndDeliberate: () => true,
  abilityText: () => '', portraitName: () => '公孙胜', portraitStyle: () => ({}),
  statusClass: () => '', statusText: () => '候命'
}

describe('AgentPanel prototype actions', () => {
  it('groups secondary then primary actions and preserves emitted agent identity', async () => {
    const wrapper = mount(AgentPanel, { props })
    try {
      const buttons = wrapper.findAll('.agent-detail-actions button')
      expect(buttons.map(button => button.text())).to.deep.equal(['与这位好汉密议', '点将并议事'])
      await buttons[0].trigger('click')
      await buttons[1].trigger('click')
      expect(wrapper.emitted('start-conversation')[0]).to.deep.equal([agent])
      expect(wrapper.emitted('point-and-deliberate')[0]).to.deep.equal([agent])
    } finally { wrapper.unmount() }
  })

  it('preserves pending, eligibility, busy and conversation visibility guards', async () => {
    const wrapper = mount(AgentPanel, { props })
    try {
      await wrapper.setProps({ canPointAndDeliberate: () => false })
      expect(wrapper.get('.point-and-deliberate').element.disabled).to.equal(true)
      await wrapper.get('.point-and-deliberate').trigger('click')
      expect(wrapper.emitted('point-and-deliberate')).to.equal(undefined)
      await wrapper.setProps({ canPointAndDeliberate: () => true, pointAndStartBusy: true })
      expect(wrapper.get('.point-and-deliberate').text()).to.equal('正在点将…')
      expect(wrapper.get('.point-and-deliberate').element.disabled).to.equal(true)
      await wrapper.setProps({ hasPendingTask: false, canStartConversation: () => false })
      expect(wrapper.findAll('.agent-detail-actions button')).to.have.length(0)
      await wrapper.setProps({ selectedAgent: null })
      expect(wrapper.find('.agent-detail-actions').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })

  it('defines scoped prototype colors, spacing, wrapping and disabled/focus states', () => {
    expect(descriptor.styles[0].scoped).to.equal(true)
    const css = descriptor.styles[0].content
    const rule = selector => css.slice(css.lastIndexOf(selector)).split('}')[0]
    expect(rule('.agent-detail-actions {')).to.include('gap: 8px').and.include('flex-wrap: wrap')
    expect(rule('.agent-detail-actions button {')).to.include('flex: 1').and.include('min-height: 44px').and.include('background: var(--hall-brand, #923f30)').and.include('padding: 10px 12px')
    expect(rule('.agent-detail-actions:has(.point-and-deliberate) button:not(.point-and-deliberate) {')).to.include('background: var(--hall-surface-subtle, #f3f3ed)').and.include('color: var(--hall-text, #242e2b)')
    expect(rule('.agent-detail-actions button:disabled {')).to.include('opacity: 0.5')
    expect(rule('.agent-detail-actions button:focus-visible {')).to.include('outline: 2px solid')
  })
})


describe('AgentPanel D4 profile and mobile layers', () => {
  const ready = () => ({ agentId: agent.agentId, observedAt: 10000, abilities: [], skills: { status: 'AVAILABLE', items: [{ skillKey: 'image-edit', skillVersion: '1.0.0', title: '图片修改', installationVerified: true, runtimeState: 'RUNTIME_READY', reasonCode: null }] } })
  it('separates skill, installation, runtime and literal empty abilities without mutating props', () => {
    const target = { ...agent, boundToMe: true, abilities: ['旧本领'] }
    const wrapper = mount(AgentPanel, { props: { ...props, selectedAgent: target, profileCapabilities: ready() } })
    try {
      expect(wrapper.get('[aria-label="技能"]').text()).to.include('图片修改').and.include('1.0.0').and.include('已核验安装 1 项').and.include('运行就绪')
      expect(wrapper.get('[aria-label="本领"]').text()).to.include('暂无能力介绍').and.not.include('旧本领')
      expect(target.abilities).to.deep.equal(['旧本领'])
    } finally { wrapper.unmount() }
  })
  it('withdraws old readiness on refresh and distinguishes source failure, empty and no access', async () => {
    const wrapper = mount(AgentPanel, { props: { ...props, selectedAgent: { ...agent, boundToMe: true }, profileCapabilities: ready() } })
    try {
      await wrapper.get('.profile-refresh button').trigger('click'); expect(wrapper.emitted('refresh-profile-capabilities')).to.have.length(1)
      await wrapper.setProps({ profileCapabilitiesLoading: true }); expect(wrapper.findAll('.skill-states')).to.have.length(0); expect(wrapper.get('.profile-refresh button').element.disabled).to.equal(true)
      await wrapper.setProps({ profileCapabilitiesLoading: false, profileCapabilities: { ...ready(), skills: { status: 'UNAVAILABLE', items: [] } } }); expect(wrapper.text()).to.include('技能读取失败').and.not.include('暂无已登记技能')
      await wrapper.setProps({ profileCapabilities: { ...ready(), skills: { status: 'AVAILABLE', items: [] } } }); expect(wrapper.text()).to.include('暂无已登记技能')
      await wrapper.setProps({ selectedAgent: { ...agent, boundToMe: false } }); expect(wrapper.text()).to.include('仅拥有者可查看技能').and.not.include('图片修改')
    } finally { wrapper.unmount() }
  })
  it('opens only mobile detail, returns with list context, opens same ID again and cleans listeners', async () => {
    const original = window.matchMedia
    let listener, removed
    window.matchMedia = () => ({ matches: true, addEventListener: (name, callback) => { listener = callback }, removeEventListener: (name, callback) => { removed = callback } })
    const wrapper = mount(AgentPanel, { attachTo: document.body, props: { ...props, filteredAgents: [agent], agents: [agent] } })
    try {
      expect(wrapper.vm.profileVisible).to.equal(false)
      wrapper.get('.agent-list').element.scrollTop = 123
      await wrapper.get('.agent-row').trigger('click')
      expect(wrapper.vm.canGoBack).to.equal(true); expect(wrapper.vm.profileVisible).to.equal(true)
      expect(wrapper.get('.agent-list').attributes('aria-hidden')).to.equal('true')
      expect(wrapper.vm.back()).to.equal(true); await Vue.nextTick()
      expect(wrapper.get('.agent-list').element.scrollTop).to.equal(123)
      await wrapper.get('.agent-row').trigger('click'); expect(wrapper.vm.canGoBack).to.equal(true)
      await wrapper.setProps({ identityKey: 'new-owner' }); expect(wrapper.vm.canGoBack).to.equal(false)
      listener({ matches: false }); await Vue.nextTick(); expect(wrapper.vm.profileVisible).to.equal(true)
      await wrapper.setProps({ active: false }); expect(wrapper.vm.profileVisible).to.equal(false)
    } finally { wrapper.unmount(); window.matchMedia = original }
    expect(removed).to.equal(listener)
  })
  it('defines independent content scroll, safe-area footer and 720px local breakpoint', () => {
    const css = descriptor.styles[0].content
    expect(css).to.include('.agent-detail-scroll').and.include('env(safe-area-inset-bottom)').and.include('@media (max-width: 720px)').and.include('minmax(0, 43fr) minmax(0, 57fr)')
    const template = descriptor.template.content
    expect(template.indexOf('class="agent-detail-scroll"')).to.be.lessThan(template.indexOf('class="agent-detail-actions"'))
    expect(template).to.include(':inert="!listVisible').and.include(':inert="!detailVisible')
  })
})


describe('AgentPanel visual alignment follow-up', () => {
  it('keeps one full-width primary conversation action when no task is pending', async () => {
    const wrapper = mount(AgentPanel, { props: { ...props, hasPendingTask: false } })
    try {
      const buttons = wrapper.findAll('.agent-detail-actions button')
      expect(buttons).to.have.length(1)
      expect(buttons[0].text()).to.equal('与这位好汉密议')
      await buttons[0].trigger('click')
      expect(wrapper.emitted('start-conversation')[0]).to.deep.equal([agent])
    } finally { wrapper.unmount() }
  })
  it('uses the existing small portrait path and renders real profile time and explanatory notes', async () => {
    const calls = []
    const target = { ...agent, boundToMe: true }
    const wrapper = mount(AgentPanel, { props: { ...props, selectedAgent: target,
      portraitStyle: (...args) => { calls.push(args); return {} },
      profileCapabilities: { agentId: agent.agentId, observedAt: 10000, abilities: ['真实本领'], skills: { status: 'AVAILABLE', items: [] } }
    } })
    try {
      expect(calls.length).to.be.greaterThan(0)
      expect(calls.every(args => args.length === 1)).to.equal(true)
      expect(wrapper.get('[aria-label="本领"]').text()).to.include('真实本领').and.include('由你维护的能力介绍，仅供参考，不代表已安装技能或运行就绪')
      expect(wrapper.get('.profile-refresh small').text()).to.match(/^最近读取 \d{2}:\d{2}$/)
      expect(wrapper.text()).not.to.include('正在厅中候令')
      await wrapper.setProps({ selectedAgent: { ...target, errorMessage: '实际错误', currentTaskTitle: '实际任务' } })
      expect(wrapper.text()).to.include('实际错误')
      await wrapper.setProps({ selectedAgent: { ...target, currentTaskTitle: '实际任务' } })
      expect(wrapper.text()).to.include('实际任务')
    } finally { wrapper.unmount() }
  })
  it('defines unshrinking portraits, wrapped identity and flex refresh without broad parent changes', () => {
    const css = descriptor.styles[0].content
    const rule = selector => css.slice(css.lastIndexOf(selector)).split('}')[0]
    expect(rule('.large-avatar {')).to.include('flex: none').and.include('width: 68px').and.include('height: 68px')
    expect(rule('.detail-head small {')).to.include('white-space: normal').and.include('overflow-wrap: anywhere')
    expect(rule('.profile-refresh {')).to.include('display: flex').and.include('flex-wrap: wrap').and.include('border-top:')
    expect(rule('.profile-heading h3 {')).to.include('font-size: 14px').and.include('font-weight: 600')
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    expect(hall).to.include('<svg width="20" height="20"').and.include('stroke-width="1.8"')
    expect(hall).to.include('.is-agent-overlay :deep(.agent-panel.is-agent-detail .agent-panel-body) { padding: 0; gap: 0; }')
    expect(hall).to.include('.is-agent-overlay :deep(.agent-panel.is-agent-detail .detail-card) { width: 100%; border: 0; border-radius: 0; }')
  })
})


describe('AgentPanel abilities editor actual interaction', () => {
  it('focuses inline input, saves through the editor, and restores the edit entry', async () => {
    const target = { ...agent, boundToMe: true, systemAgent: false }
    const projection = Vue.ref({ agentId: agent.agentId, observedAt: 10000, abilities: ['old'], skills: { status: 'AVAILABLE', items: [] } })
    let persisted = ['old']; const writes = []
    const profile = { projection, loading: Vue.ref(false), error: Vue.ref(''), refresh: async () => { projection.value.abilities = persisted; return true } }
    const api = { put: async (url, data) => { writes.push({ url, data }); persisted = data.abilities; return { agentId: agent.agentId, abilities: persisted } } }
    const editor = useHallAgentAbilitiesEditor({ api, profile, getAgent: () => target, identityKey: () => 'owner', enabled: () => true })
    const wrapper = mount(AgentPanel, { attachTo: document.body, props: { ...props, selectedAgent: target, profileCapabilities: projection.value, abilityEditor: editor } })
    try {
      await wrapper.get('[aria-label="本领"] button').trigger('click'); await Vue.nextTick()
      expect(document.activeElement).to.equal(wrapper.get('textarea').element)
      await wrapper.get('textarea').setValue('分析\nANALYSIS\nanalysis')
      await wrapper.get('form.ability-editor').trigger('submit')
      for (let i = 0; i < 8; i++) await Promise.resolve()
      await Vue.nextTick()
      expect(writes).to.have.length(1)
      expect(writes[0].data).to.deep.equal({ expectedAbilities: ['old'], abilities: ['分析', 'ANALYSIS'] })
      expect(wrapper.find('form.ability-editor').exists()).to.equal(false)
      expect(wrapper.get('[aria-label="本领"]').text()).to.include('分析').and.include('本领已保存')
      expect(document.activeElement).to.equal(wrapper.get('[aria-label="本领"] button').element)
    } finally { wrapper.unmount(); editor.dispose() }
  })
})

describe('AgentPanel accepted abilities prototype fidelity', () => {
  const editor = () => ({ editing: Vue.ref(true), draft: Vue.ref('分析'), busy: Vue.ref(false), needsCheck: Vue.ref(false), message: Vue.ref(''), cancel: () => {}, save: () => {}, checkLatest: () => {} })
  const ownedProps = abilityEditor => ({ ...props, selectedAgent: { ...agent, boundToMe: true, systemAgent: false }, abilityEditor, profileCapabilities: { agentId: agent.agentId, observedAt: 10000, abilities: ['分析'], skills: { status: 'AVAILABLE', items: [] } } })
  it('renders the approved label, guidance, textarea and right-ordered secondary/primary actions', () => {
    const wrapper = mount(AgentPanel, { props: ownedProps(editor()) })
    try {
      expect(wrapper.get('label[for="hall-ability-editor"]').text()).to.equal('本领介绍')
      expect(wrapper.get('#hall-ability-editor-hint').text()).to.equal('每行填写一项，例如：资料整理、方案撰写。留空表示暂不填写。')
      expect(wrapper.get('#hall-ability-editor-note').text()).to.equal('仅维护这位好汉的能力介绍，不会安装技能或改变技能状态。')
      expect(wrapper.get('textarea').attributes()).to.include({ rows: '4', placeholder: '每行填写一项本领', 'aria-describedby': 'hall-ability-editor-hint hall-ability-editor-note' })
      expect(wrapper.findAll('.ability-editor-actions button').map(b => b.text())).to.deep.equal(['取消', '保存'])
      expect(wrapper.get('.ability-editor-actions button:last-child').attributes('type')).to.equal('submit')
      expect(wrapper.get('.ability-editor-actions button:first-child').attributes('type')).to.equal('button')
      expect(wrapper.find('[aria-label="本领"] > .profile-note').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })
  it('preserves conflict draft and disabled states without changing the primary action order', async () => {
    const e = editor(); const wrapper = mount(AgentPanel, { props: ownedProps(e) })
    try {
      e.needsCheck.value = true; e.message.value = '本领已被其他操作修改；草稿已保留'; await Vue.nextTick()
      expect(wrapper.findAll('.ability-editor-actions button').map(b => b.text())).to.deep.equal(['取消', '核对最新本领', '保存'])
      expect(wrapper.get('textarea').element.value).to.equal('分析')
      expect(wrapper.get('.ability-save').element.disabled).to.equal(true)
      expect(wrapper.get('.ability-editor-error[role="status"]').text()).to.include('草稿已保留')
      e.busy.value = true; await Vue.nextTick()
      expect(wrapper.findAll('.ability-editor-actions button').every(b => b.element.disabled)).to.equal(true)
      expect(wrapper.get('textarea').element.disabled).to.equal(true)
    } finally { wrapper.unmount() }
  })
  it('defines local approved borders, rounding, colors, alignment, hover and focus rather than native defaults', () => {
    const css = descriptor.styles.map(s => s.content).join('\n')
    const rule = selector => css.slice(css.lastIndexOf(selector)).split('}')[0]
    expect(rule('.agent-panel .profile-section .ability-edit-link {')).to.include('border: 1px solid #e3e5dc').and.include('padding: 6px 12px')
    expect(rule('.agent-panel .ability-editor textarea {')).to.include('border-radius: 8px').and.include('padding: 10px 12px').and.include('background: #fffefa')
    expect(rule('.agent-panel .ability-editor-actions {')).to.include('justify-content: flex-end').and.include('gap: 8px').and.include('flex-wrap: wrap')
    expect(rule('.agent-panel .ability-editor-actions button.ability-save {')).to.include('background: #923f30').and.include('color: #fffefa')
    expect(rule('.agent-panel .ability-editor-actions button.ability-save:hover:not(:disabled) {')).to.include('background: #793326')
    expect(rule('.agent-panel .ability-editor-actions button.ability-save:focus-visible {')).to.include('outline: 2px solid #923f30').and.include('outline-offset: 3px')
  })
})


describe('AgentPanel skill management heading alignment', () => {
  const owned = { ...agent, boundToMe: true, canOperate: true, systemAgent: false }
  const profile = { agentId: agent.agentId, observedAt: 10000, abilities: [], skills: { status: 'AVAILABLE', items: [] } }
  it('keeps the installation summary before the last management action', () => {
    const wrapper = mount(AgentPanel, { props: { ...props, selectedAgent: owned, profileCapabilities: profile } })
    try {
      const heading = wrapper.get('[aria-label="技能"] > .profile-heading')
      expect([...heading.element.children].map(e => e.tagName)).to.deep.equal(['H3', 'SMALL', 'BUTTON'])
      expect(heading.get('small').text()).to.equal('已核验安装 0 项')
      expect(heading.get('button:last-child').attributes('aria-label')).to.equal('管理技能')
    } finally { wrapper.unmount() }
  })
  it('retains the rightmost action without a count, and preserves owner/operation guards', async () => {
    const wrapper = mount(AgentPanel, { props: { ...props, selectedAgent: owned, profileCapabilitiesLoading: true } })
    try {
      const heading = () => wrapper.get('[aria-label="技能"] > .profile-heading')
      expect(heading().find('small').exists()).to.equal(false)
      expect(heading().get('button:last-child').attributes('aria-label')).to.equal('管理技能')
      await wrapper.setProps({ profileCapabilitiesLoading: false, profileCapabilities: { ...profile, skills: { status: 'UNAVAILABLE', items: [] } } })
      expect(heading().find('small').exists()).to.equal(false)
      expect(heading().find('button:last-child').exists()).to.equal(true)
      for (const change of [{ boundToMe: false }, { canOperate: false }, { systemAgent: true }]) {
        await wrapper.setProps({ selectedAgent: { ...owned, ...change } })
        expect(wrapper.find('.skill-manage-entry').exists()).to.equal(false)
      }
    } finally { wrapper.unmount() }
  })
  it('locally aligns the action to the right without changing shared heading layout', () => {
    const css = descriptor.styles[0].content
    const rule = css.slice(css.indexOf('.agent-panel .profile-heading .skill-manage-entry {')).split('}')[0]
    expect(rule).to.include('margin-left: auto').and.include('min-height: 44px').and.include('background: #f3f4ee').and.include('color: var(--hall-text, #242e2b)')
    expect(css).to.include('.profile-heading, .skill-title { display: flex; justify-content: space-between;')
  })
})

// The shared semantic-control policy is asserted here; business state remains in its owner.
describe('AgentPanel semantic controls', () => {
  const owner = { ...agent, boundToMe: true, canOperate: true, systemAgent: false }
  const profile = { agentId: agent.agentId, observedAt: 10000, abilities: [], skills: { status: 'AVAILABLE', items: [] } }
  it('renders familiar tools as named icons while leaving business actions as text', () => {
    const wrapper = mount(AgentPanel, { props: { ...props, selectedAgent: owner, profileCapabilities: profile } })
    try {
      const manage = wrapper.get('[aria-label="管理技能"]')
      expect(manage.text()).to.equal('')
      expect(manage.get('svg').attributes('aria-hidden')).to.equal('true')
      const refresh = wrapper.get('[aria-label="刷新技能与本领"]')
      expect(refresh.text()).to.equal('')
      expect(refresh.attributes('title')).to.equal('刷新技能与本领')
      for (const button of wrapper.findAll('.agent-detail-actions button')) {
        expect(button.text()).not.to.equal('')
        expect(button.find('svg').exists()).to.equal(false)
      }
    } finally { wrapper.unmount() }
  })
  it('draws a real switch without changing the original write, busy, unknown or owner boundaries', async () => {
    const wrapper = mount(AgentPanel, { props: { ...props, selectedAgent: owner, externalPolicy: { enabled: false }, externalPolicyCanWrite: true } })
    try {
      const toggle = () => wrapper.get('[role="switch"]')
      const expectStatusBeforeSwitch = text => {
        const children = toggle().element.children
        expect(children[0].className).to.equal('hall-switch-status')
        expect(children[0].textContent).to.equal(text)
        expect(children[1].className).to.equal('hall-switch-track')
      }
      expectStatusBeforeSwitch('已关闭')
      expect(toggle().attributes('aria-label')).to.equal('接受平台其他用户的委派')
      expect(toggle().find('.hall-switch-track > span').exists()).to.equal(true)
      expect(toggle().attributes('aria-checked')).to.equal('false')
      await toggle().trigger('click')
      expect(wrapper.emitted('set-external-policy')).to.deep.equal([[true]])
      await wrapper.setProps({ externalPolicy: { enabled: true } })
      expectStatusBeforeSwitch('已开启')
      await wrapper.setProps({ externalPolicyBusy: true, externalPolicyCanWrite: false })
      expectStatusBeforeSwitch('核对中…')
      expect(toggle().attributes('aria-checked')).to.equal('true')
      expect(toggle().attributes('aria-busy')).to.equal('true')
      expect(toggle().element.disabled).to.equal(true)
      await toggle().trigger('click')
      expect(wrapper.emitted('set-external-policy')).to.have.length(1)
      await wrapper.setProps({ externalPolicyBusy: false, externalPolicyStatus: 'UNKNOWN' })
      expectStatusBeforeSwitch('已开启')
      expect(toggle().element.disabled).to.equal(true)
      expect(wrapper.get('.external-policy-recovery').text()).to.include('查询结果').and.include('继续核对')
      await wrapper.setProps({ selectedAgent: { ...owner, boundToMe: false, canOperate: false } })
      expect(wrapper.find('[role="switch"]').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })
})
