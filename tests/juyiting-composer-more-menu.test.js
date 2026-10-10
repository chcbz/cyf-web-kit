import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/juyiting/HallChatComposer.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'more-menu', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import HallVoiceControls[^\n]+/m, 'var HallVoiceControls = { template: "<span class=voice-stub />" }')
  .replace('export default', 'return')
const Composer = new Function('Vue', script)(Vue)
const create = props => mount(Composer, { attachTo: document.body, props: { mentionLabel: () => '', draft: '保留我的草稿', ...props }, global: { stubs: { 'var-icon': true } } })

describe('Juyi Hall simple composer more menu', () => {
  it('allows attachment-only bounty input, but not empty, private, public or locked sends', async () => {
    for (const discussionVariant of ['public', 'private', 'bounty']) {
      const wrapper = create({ draft: '  ', discussionVariant, hasTypedAttachments: true })
      try {
        expect(wrapper.get('.composer-send').attributes('disabled')).to.equal(discussionVariant === 'bounty' ? undefined : '')
        await wrapper.get('form').trigger('submit')
        expect(Boolean(wrapper.emitted('send-message'))).to.equal(discussionVariant === 'bounty')
        await wrapper.setProps({ hasTypedAttachments: false })
        expect(wrapper.get('.composer-send').attributes('disabled')).to.equal('')
        await wrapper.setProps({ hasTypedAttachments: true, interactionLocked: true })
        expect(wrapper.get('.composer-send').attributes('disabled')).to.equal('')
      } finally { wrapper.unmount() }
    }
  })
  it('maps target chips consistently without letting private or bounty targets be removed', async () => {
    const agents = [{ agentId: 'a', name: '甲' }, { agentId: 'b', name: '乙' }]
    for (const discussionVariant of ['public', 'private', 'bounty']) {
      const wrapper = create({ agents, selectedAgent: agents[0], discussionVariant, mentionLabel: agent => agent.name })
      try {
        const chips = wrapper.findAll('.composer-target-chip')
        expect(chips.map(chip => chip.text())).to.deep.equal(discussionVariant === 'bounty' ? ['@甲', '@乙'] : ['@甲'])
        for (const chip of chips) expect(chip.element.disabled).to.equal(discussionVariant !== 'public')
        await chips[0].trigger('click')
        expect(wrapper.emitted('clear-target')).to.deep.equal(discussionVariant === 'public' ? [['a']] : undefined)
        await wrapper.setProps({ selectedAgent: { agentId: 'outside', name: '不在当前名单' } })
        expect(wrapper.findAll('.composer-target-chip')).to.have.length(discussionVariant === 'bounty' ? 2 : 0)
      } finally { wrapper.unmount() }
    }
  })
  it('keeps draft display and all input locks consistent for clicks and direct submits', async () => {
    const wrapper = create({ draft: '   ' })
    try {
      expect(wrapper.classes()).not.to.include('has-draft')
      expect(wrapper.get('.composer-send').element.disabled).to.equal(true)
      expect(wrapper.get('.composer-meta').text()).to.include('3/1200')
      await wrapper.setProps({ draft: '  消息  ' })
      expect(wrapper.classes()).to.include('has-draft')
      expect(wrapper.get('.composer-send').element.disabled).to.equal(false)
      for (const lock of [{ interactionLocked: true }, { isStreaming: true }, { isAwaitingReply: true },
        { voice: { supported: true, state: 'recording', voiceInteractionLocked: true } }]) {
        await wrapper.setProps(lock)
        expect(wrapper.get('textarea').element.disabled).to.equal(true)
        expect(wrapper.get('.composer-send').element.disabled).to.equal(true)
        expect(wrapper.get('.composer-add-materials').element.disabled).to.equal(true)
        await wrapper.get('form').trigger('submit')
        await wrapper.get('.composer-add-materials').trigger('click')
        expect(wrapper.emitted('send-message')).to.equal(undefined)
        expect(wrapper.emitted('open-materials')).to.equal(undefined)
        await wrapper.setProps({ interactionLocked: false, isStreaming: false, isAwaitingReply: false, voice: null })
      }
      await wrapper.get('form').trigger('submit')
      expect(wrapper.emitted('send-message')).to.deep.equal([[]])
      expect(wrapper.emitted('update:draft')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })
  it('groups the textarea, plus, voice target and send inside one input frame', () => {
    const wrapper = create()
    try {
      const frame = wrapper.get('.composer-input-area')
      expect(frame.find('textarea').exists()).to.equal(true)
      expect(frame.find('.composer-more').exists()).to.equal(true)
      expect(frame.find('.composer-inline-voice').exists()).to.equal(true)
      expect(frame.find('.composer-send').exists()).to.equal(true)
      expect(wrapper.text()).not.to.contain('工作空间')
    } finally { wrapper.unmount() }
  })
  it('opens materials directly after plus without opening the menu or changing the draft', async () => {
    const wrapper = create()
    try {
      expect(wrapper.get('.composer-more-panel').element.style.display).to.equal('none')
      expect(wrapper.find('.composer-clear').exists()).to.equal(false)
      await wrapper.get('.composer-add-materials').trigger('click')
      expect(wrapper.emitted('open-materials')).to.have.length(1)
      expect(wrapper.emitted('send-message')).to.equal(undefined)
      expect(wrapper.emitted('update:draft')).to.equal(undefined)
      expect(wrapper.get('.composer-more').attributes('aria-expanded')).to.equal('false')
      expect(wrapper.get('.composer-more-panel').find('.composer-add-materials').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })
  it('renders the existing materials slot while plus is closed', async () => {
    const wrapper = mount(Composer, {
      props: { mentionLabel: () => '', draft: '原有草稿' },
      slots: { materials: '<section class="material-reference-picker">真实资料选择器</section>' }
    })
    try {
      expect(wrapper.get('.composer-more').attributes('aria-expanded')).to.equal('false')
      const picker = wrapper.get('.composer-materials .material-reference-picker').element
      for (let node = picker; node; node = node.parentElement) {
        expect(node.style.display).not.to.equal('none')
      }
      expect(wrapper.get('.composer-more-panel').find('.material-reference-picker').exists()).to.equal(false)
      const buttons = wrapper.get('.composer-actions').findAll('button')
      expect(buttons.map(button => button.attributes('aria-label'))).to.deep.equal(['更多操作', '添加资料', '发送'])
      for (const button of buttons) {
        const icon = button.get('svg')
        expect(icon.attributes('width')).to.equal('20')
        expect(icon.attributes('height')).to.equal('20')
        expect(icon.attributes('stroke-width')).to.equal('1.8')
        expect(icon.attributes('aria-hidden')).to.equal('true')
      }
      await wrapper.setProps({ isAwaitingReply: true })
      expect(wrapper.get('.composer-send').attributes('aria-label')).to.equal('处理中')
      expect(wrapper.get('.composer-send').attributes('disabled')).to.equal('')
      expect(wrapper.get('.composer-add-materials').attributes('disabled')).to.equal('')
      expect(wrapper.get('.composer-more').attributes('disabled')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })
  it('disables the action menu only for a server-completed task', async () => {
    const wrapper = create({ actionsDisabled: true, interactionLocked: true })
    try {
      expect(wrapper.get('.composer-more').attributes('disabled')).to.equal('')
      expect(wrapper.get('.composer-add-materials').attributes('disabled')).to.equal('')
      expect(wrapper.get('.composer-send').attributes('disabled')).to.equal('')
      await wrapper.setProps({ actionsDisabled: false, interactionLocked: false, isAwaitingReply: true })
      expect(wrapper.get('.composer-more').attributes('disabled')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })

  it('closes on Escape or outside click and restores focus', async () => {
    const wrapper = create()
    try {
      await wrapper.get('.composer-more').trigger('click')
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await Vue.nextTick()
      expect(wrapper.get('.composer-more-panel').element.style.display).to.equal('none')
      expect(document.activeElement).to.equal(wrapper.get('.composer-more').element)
      await wrapper.get('.composer-more').trigger('click')
      document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
      await Vue.nextTick()
      expect(wrapper.get('.composer-more-panel').element.style.display).to.equal('none')
    } finally { wrapper.unmount() }
  })
  it('closes the menu when the real identity/conversation context changes', async () => {
    const wrapper = create({ contextKey: 'owner-a:conversation-a' })
    try {
      await wrapper.get('.composer-more').trigger('click')
      await wrapper.setProps({ contextKey: 'owner-b:conversation-b' })
      expect(wrapper.get('.composer-more').attributes('aria-expanded')).to.equal('false')
      expect(wrapper.get('.composer-more-panel').element.style.display).to.equal('none')
      expect(wrapper.emitted('update:draft')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })
  it('keeps recording controls reachable after closing the menu', async () => {
    const wrapper = create({ voice: { supported: true, state: 'recording', voiceInteractionLocked: true } })
    try {
      expect(wrapper.get('.composer-more-panel').element.style.display).not.to.equal('none')
      expect(wrapper.find('.composer-more-actions').exists()).to.equal(false)
      expect(wrapper.get('.composer-add-materials').attributes('disabled')).to.equal('')
      expect(wrapper.get('.voice-stub').element.style.display).not.to.equal('none')
      expect(wrapper.get('.composer-send').attributes('disabled')).to.equal('')
    } finally { wrapper.unmount() }
  })
})
