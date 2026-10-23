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
      expect(wrapper.get('[aria-label="本领"]').text()).to.include('未录本领').and.not.include('旧本领')
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
      expect(wrapper.get('[aria-label="本领"]').text()).to.include('真实本领').and.include('不等同于已安装技能')
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
