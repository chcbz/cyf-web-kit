import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

const compile = (name, deps = {}) => {
  const { descriptor } = parse(readFileSync(new URL(`../src/components/juyiting/${name}.vue`, import.meta.url), 'utf8'))
  const script = compileScript(descriptor, { id: name, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, name) => `var ${name} = deps.${name}`)
    .replace('export default', 'return')
  return new Function('Vue', 'deps', script)(Vue, deps)
}
const History = compile('HallConversationHistory')
const Composer = compile('HallChatComposer', { HallVoiceControls: { template: '<button class="voice-control">录音状态</button>' } })
const directory = () => ({ items: Vue.ref([]), links: Vue.ref([]), pendingWrites: Vue.ref([]), loading: Vue.ref(false), error: Vue.ref(''),
  actionState: Vue.ref('idle'), writeNotice: Vue.ref(''), refresh: async () => true, load: async () => true, dispose: () => {} })
const Chat = compile('ChatPanel', {
  HallConversationHistory: History, HallChatComposer: Composer,
  HallMessageParts: { render: () => null }, HallMaterialPicker: { render: () => null }, BountyTextSelectionArchive: { render: () => null },
  BountyTypedOutcomeCard: { render: () => null }, WorkspaceWriteRecovery: { render: () => null },
  marked: Object.assign(value => value, { setOptions: () => {} }), DOMPurify: { sanitize: value => value },
  usePersonalWorkspace: directory, usePersonalWorkspaceConversationLinks: directory, usePersonalWorkspaceTaskLinks: directory
})
const createChat = () => mount(Chat, { attachTo: document.body, props: { mentionLabel: () => '', senderText: () => '', draft: '草稿保留', conversationId: 'c1',
  conversationHistory: [{ id: 'c1', title: '旧话头' }] }, global: { stubs: { 'var-dialog': true, 'var-icon': true } } })
const pointer = async target => { target.dispatchEvent(new window.Event('pointerdown', { bubbles: true })); await Vue.nextTick() }
const escape = async (target = document) => { target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await Vue.nextTick() }
const historyButton = w => w.get('button[aria-label="话头记录"]')
const moreButton = w => w.get('.composer-more')
const visibleModal = () => { const node = document.createElement('section'); node.setAttribute('role', 'dialog'); node.setAttribute('aria-modal', 'true'); document.body.append(node); return node }

// Real shared components, mounted together: no sends/deletes or draft writes on dismissal.
describe('discussion transient tools dismissal', () => {
  for (const action of ['outside', 'textarea', 'Escape']) {
    it(`closes history via ${action}, preserving draft and restoring focus only for Escape`, async () => {
      const w = createChat()
      try {
        await historyButton(w).trigger('click')
        expect(w.findComponent(History).exists()).to.equal(true)
        await pointer(historyButton(w).element)
        expect(w.findComponent(History).exists()).to.equal(true)
        await pointer(w.get('.history-item').element)
        expect(w.findComponent(History).exists()).to.equal(true)
        if (action === 'Escape') await escape()
        else { w.get('textarea').element.focus(); await pointer(action === 'textarea' ? w.get('textarea').element : w.get('.hall-messages').element) }
        expect(w.findComponent(History).exists()).to.equal(false)
        expect(document.activeElement).to.equal(action === 'Escape' ? historyButton(w).element : w.get('textarea').element)
        expect(w.emitted('send-message')).to.equal(undefined)
        expect(w.emitted('delete-conversation')).to.equal(undefined)
        expect(w.emitted('update:draft')).to.equal(undefined)
        expect(w.get('textarea').element.value).to.equal('草稿保留')
      } finally { w.unmount() }
    })
  }
  it('switches tools even for keyboard-generated clicks, without selecting or sending', async () => {
    const w = createChat()
    try {
      await historyButton(w).trigger('click')
      await moreButton(w).trigger('click')
      expect(w.findComponent(History).exists()).to.equal(false)
      expect(moreButton(w).attributes('aria-expanded')).to.equal('true')
      await historyButton(w).trigger('click')
      expect(moreButton(w).attributes('aria-expanded')).to.equal('false')
      await w.get('.composer-add-materials').trigger('click')
      expect(w.findComponent(History).exists()).to.equal(false)
      expect(w.find('.material-reference-picker').exists()).to.equal(true)
      await moreButton(w).trigger('click')
      expect(w.find('.material-reference-picker').exists()).to.equal(false)
      expect(w.emitted('send-message')).to.equal(undefined)
    } finally { w.unmount() }
  })
  for (const action of ['textarea', 'Escape']) {
    it(`dismisses materials via ${action} but keeps internal operations and draft intact`, async () => {
      const w = createChat()
      try {
        await w.get('.composer-add-materials').trigger('click')
        await pointer(w.get('.material-reference-picker').element)
        expect(w.find('.material-reference-picker').exists()).to.equal(true)
        await pointer(w.get('.composer-add-materials').element)
        expect(w.find('.material-reference-picker').exists()).to.equal(true)
        if (action === 'Escape') await escape()
        else await pointer(w.get('textarea').element)
        expect(w.find('.material-reference-picker').exists()).to.equal(false)
        if (action === 'Escape') expect(document.activeElement).to.equal(w.get('.composer-add-materials').element)
        expect(w.emitted('update:draft')).to.equal(undefined)
        expect(w.emitted('send-message')).to.equal(undefined)
      } finally { w.unmount() }
    })
  }
  it('closes plus when clicking the input, not when operating its settings, and keeps recording reachable', async () => {
    const w = createChat()
    try {
      await w.setProps({ voice: { supported: true, state: 'recording', voiceInteractionLocked: true } })
      await moreButton(w).trigger('click')
      await pointer(w.get('.voice-control').element)
      expect(moreButton(w).attributes('aria-expanded')).to.equal('true')
      await pointer(w.get('textarea').element)
      expect(moreButton(w).attributes('aria-expanded')).to.equal('false')
      expect(w.get('.composer-more-panel').element.style.display).not.to.equal('none')
      expect(w.find('.voice-control').exists()).to.equal(true)
      expect(w.emitted('voice-apply')).to.equal(undefined)
      expect(w.emitted('update:draft')).to.equal(undefined)
    } finally { w.unmount() }
  })
  it('does not unmount a delete confirmation on outside/Escape/toggle or implicitly delete', async () => {
    const w = createChat()
    try {
      await historyButton(w).trigger('click')
      await w.get('.history-delete').trigger('click')
      const h = w.getComponent(History)
      expect(h.findComponent({ name: 'var-dialog' }).attributes('show')).to.equal('true')
      await pointer(w.get('.hall-messages').element)
      await escape()
      await historyButton(w).trigger('click')
      expect(w.findComponent(History).exists()).to.equal(true)
      expect(w.emitted('delete-conversation')).to.equal(undefined)
      h.findComponent({ name: 'var-dialog' }).vm.$emit('update:show', false)
      await Vue.nextTick()
      await escape()
      expect(w.findComponent(History).exists()).to.equal(false)
      expect(w.emitted('delete-conversation')).to.equal(undefined)
    } finally { w.unmount() }
  })
  it('defers dismissal to teleported dialogs; hidden, closed dialogs do not block tools', async () => {
    const w = createChat(); let modal
    try {
      await moreButton(w).trigger('click')
      modal = visibleModal()
      await pointer(modal); await escape(modal)
      expect(moreButton(w).attributes('aria-expanded')).to.equal('true')
      modal.style.display = 'none'
      await escape()
      expect(moreButton(w).attributes('aria-expanded')).to.equal('false')
      modal.remove()
      await historyButton(w).trigger('click')
      modal = visibleModal()
      await pointer(modal); await escape(modal)
      expect(w.findComponent(History).exists()).to.equal(true)
      modal.remove(); await escape()
      expect(w.findComponent(History).exists()).to.equal(false)
    } finally { modal?.remove(); w.unmount() }
  })
  it('does not dismiss another discussion instance when Escape originates in this one', async () => {
    const a = createChat(); const b = createChat()
    try {
      await historyButton(a).trigger('click')
      await historyButton(b).trigger('click')
      await escape(b.get('.history-item').element)
      expect(b.findComponent(History).exists()).to.equal(false)
      expect(a.findComponent(History).exists()).to.equal(true)
      await moreButton(b).trigger('click')
      await escape(b.get('textarea').element)
      expect(moreButton(b).attributes('aria-expanded')).to.equal('false')
      expect(a.findComponent(History).exists()).to.equal(true)
    } finally { a.unmount(); b.unmount() }
  })
  it('keeps a deleting history mounted and respects an already-handled Escape', async () => {
    const w = createChat()
    try {
      await historyButton(w).trigger('click')
      await w.setProps({ conversationHistoryDeletingId: 'c1' })
      await pointer(document.body); await escape()
      expect(w.findComponent(History).exists()).to.equal(true)
      await w.setProps({ conversationHistoryDeletingId: '' })
      const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      event.preventDefault(); document.dispatchEvent(event); await Vue.nextTick()
      expect(w.findComponent(History).exists()).to.equal(true)
      await escape()
      expect(w.findComponent(History).exists()).to.equal(false)
    } finally { w.unmount() }
  })
  it('closes history on context changes and releases document listeners on unmount', async () => {
    const w = createChat()
    await historyButton(w).trigger('click')
    await w.setProps({ conversationId: 'c2' })
    expect(w.findComponent(History).exists()).to.equal(false)
    await moreButton(w).trigger('click')
    const escaped = []
    const observer = event => escaped.push(event.defaultPrevented)
    w.unmount()
    document.addEventListener('keydown', observer)
    try {
      await pointer(document.body); await escape()
      expect(escaped).to.deep.equal([false])
    } finally { document.removeEventListener('keydown', observer) }
  })
})
