import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { DOMWrapper, mount } from '@vue/test-utils'
import { validMaterialVersion } from '../src/composables/juyiting/materialVersion.js'
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
const chatDeps = {
  HallConversationHistory: History, HallChatComposer: Composer,
  HallMessageParts: { render: () => null }, HallMaterialPicker: { render: () => null }, BountyTextSelectionArchive: { render: () => null },
  BountyTypedOutcomeCard: { render: () => null }, WorkspaceWriteRecovery: { render: () => null },
  marked: Object.assign(value => value, { setOptions: () => {} }), DOMPurify: { sanitize: value => value },
  usePersonalWorkspace: directory, usePersonalWorkspaceConversationLinks: directory, usePersonalWorkspaceTaskLinks: directory
}
const Chat = compile('ChatPanel', chatDeps)
const Voice = compile('HallVoiceControls')
const RealComposer = compile('HallChatComposer', { HallVoiceControls: Voice })
const RealChat = compile('ChatPanel', { ...chatDeps, HallChatComposer: RealComposer })
const createChat = (component = Chat) => mount(component, { attachTo: document.body, props: { mentionLabel: () => '', senderText: () => '', draft: '草稿保留', conversationId: 'c1',
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


describe('discussion input switching with real voice controls', () => {
  const createVoice = () => {
    const calls = { start: [], stop: 0, cancel: 0 }
    const voice = Vue.reactive({ supported: true, state: 'idle', canRecord: true,
      startRecording: options => { calls.start.push(options) },
      stopRecording: () => { calls.stop++ }, cancel: () => { calls.cancel++ }
    })
    return { voice, calls }
  }
  const unchanged = (w, calls) => {
    expect(w.get('textarea').element.value).to.equal('草稿保留')
    for (const event of ['send-message', 'delete-conversation', 'update:draft', 'voice-apply', 'remove-attachment']) {
      expect(w.emitted(event), event).to.equal(undefined)
    }
    expect(calls.cancel).to.equal(0)
  }
  for (const tool of ['history', 'more', 'materials']) {
    it(`focus without pointerdown dismisses ${tool} and keeps focus/draft/recording`, async () => {
      const w = createChat(RealChat); const { voice, calls } = createVoice()
      try {
        await w.setProps({ voice })
        if (tool === 'history') await historyButton(w).trigger('click')
        if (tool === 'more') {
          await moreButton(w).trigger('click')
          await w.get('.voice-settings-trigger').trigger('click')
          expect(w.find('.voice-settings').exists()).to.equal(true)
        }
        if (tool === 'materials') await w.get('.composer-add-materials').trigger('click')
        w.get('textarea').element.focus(); await Vue.nextTick()
        expect(document.activeElement).to.equal(w.get('textarea').element)
        expect(w.findComponent(History).exists()).to.equal(false)
        expect(moreButton(w).attributes('aria-expanded')).to.equal('false')
        expect(w.find('.material-reference-picker').exists()).to.equal(false)
        expect(w.find('.voice-settings').exists()).to.equal(false)
        await moreButton(w).trigger('click')
        expect(w.get('.voice-settings-trigger').attributes('aria-expanded')).to.equal('false')
        unchanged(w, calls)
        expect(calls.start).to.deep.equal([])
        expect(calls.stop).to.equal(0)
      } finally { w.unmount() }
    })
    for (const withPointer of [false, true]) {
      it(`voice activation closes ${tool}, pointer=${withPointer}, starts draft-only exactly once`, async () => {
        const w = createChat(RealChat); const { voice, calls } = createVoice()
        try {
          await w.setProps({ voice }); await Vue.nextTick()
          if (tool === 'history') await historyButton(w).trigger('click')
          if (tool === 'more') {
            await moreButton(w).trigger('click')
            await w.get('.voice-settings-trigger').trigger('click')
          }
          if (tool === 'materials') await w.get('.composer-add-materials').trigger('click')
          const button = w.get('.composer-inline-voice .voice-start')
          if (withPointer) await pointer(button.element)
          await button.trigger('click')
          expect(w.findComponent(History).exists()).to.equal(false)
          expect(moreButton(w).attributes('aria-expanded')).to.equal('false')
          expect(w.find('.material-reference-picker').exists()).to.equal(false)
          expect(w.find('.voice-settings').exists()).to.equal(false)
          expect(calls.start).to.deep.equal([{ draftOnly: true }])
          expect(calls.stop).to.equal(0)
          unchanged(w, calls)
        } finally { w.unmount() }
      })
    }
  }
  it('stops/transcribes exactly once and keeps recording controls reachable on text focus', async () => {
    const w = createChat(RealChat); const { voice, calls } = createVoice()
    try {
      voice.state = 'recording'
      await w.setProps({ voice })
      await moreButton(w).trigger('click')
      w.get('textarea').element.focus(); await Vue.nextTick()
      expect(w.get('.composer-more-panel').element.style.display).not.to.equal('none')
      expect(w.find('.voice-cancel').exists()).to.equal(true)
      expect(calls.stop).to.equal(0)
      await historyButton(w).trigger('click')
      await w.get('.composer-inline-voice .is-recording').trigger('click')
      expect(w.findComponent(History).exists()).to.equal(false)
      expect(calls.stop).to.equal(1)
      expect(calls.start).to.deep.equal([])
      unchanged(w, calls)
    } finally { w.unmount() }
  })
  it('disabled or unsupported voice does not activate input', async () => {
    const w = createChat(RealChat); const { voice, calls } = createVoice()
    try {
      voice.canRecord = false
      await w.setProps({ voice })
      await historyButton(w).trigger('click')
      await w.get('.voice-start').trigger('click')
      expect(w.findComponent(History).exists()).to.equal(true)
      expect(calls.start).to.deep.equal([])
      voice.supported = false; await Vue.nextTick()
      expect(w.find('.voice-start').exists()).to.equal(false)
      unchanged(w, calls)
    } finally { w.unmount() }
  })
  it('preserves delete confirmation and child modal when input receives focus', async () => {
    const w = createChat(RealChat); let modal
    try {
      await historyButton(w).trigger('click')
      await w.get('.history-delete').trigger('click')
      w.get('textarea').element.focus(); await Vue.nextTick()
      expect(w.findComponent(History).exists()).to.equal(true)
      expect(w.getComponent(History).findComponent({ name: 'var-dialog' }).attributes('show')).to.equal('true')
      w.getComponent(History).findComponent({ name: 'var-dialog' }).vm.$emit('update:show', false)
      await Vue.nextTick()
      await moreButton(w).trigger('click')
      modal = visibleModal()
      w.get('textarea').element.blur(); w.get('textarea').element.focus(); await Vue.nextTick()
      expect(moreButton(w).attributes('aria-expanded')).to.equal('true')
      expect(w.emitted('delete-conversation')).to.equal(undefined)
    } finally { modal?.remove(); w.unmount() }
  })
  it('input activation is scoped to its discussion instance', async () => {
    const a = createChat(RealChat); const b = createChat(RealChat)
    try {
      const { voice } = createVoice(); await b.setProps({ voice })
      await historyButton(a).trigger('click'); await historyButton(b).trigger('click')
      await b.get('.voice-start').trigger('click')
      expect(a.findComponent(History).exists()).to.equal(true)
      expect(b.findComponent(History).exists()).to.equal(false)
    } finally { a.unmount(); b.unmount() }
  })
})


describe('task discussion material picker prototype parity', () => {
  const flush = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); await Vue.nextTick() } }
  const fixture = ({ failAttach = false } = {}) => {
    const calls = { attach: [], preview: [] }
    const files = [{ fileId: 'old', displayName: '原任务资料.pdf', latestVersion: '9' },
      { fileId: 'new', displayName: '本次资料.txt', latestVersion: '2' }]
    const workspace = () => {
      const state = { items: Vue.ref(files), links: Vue.ref([]), detail: Vue.ref(null), listState: Vue.ref('idle'),
        loading: Vue.ref(false), actionState: Vue.ref('idle'), error: Vue.ref(''), pendingWrites: Vue.ref([]),
        preview: Vue.ref({ kind: 'none' }), nextCursor: Vue.ref(null), hasMoreVersions: Vue.ref(false),
        refresh: async () => true, dispose: () => {}, reset: () => {},
        closeDetail: () => { state.detail.value = null }, revokePreview: () => { state.preview.value = { kind: 'none' } },
        select: async id => {
          state.detail.value = { file: { ...files.find(f => f.fileId === id), state: 'ACTIVE' },
            latestVersion: { version: id === 'new' ? '2' : '9' }, versions: [{ version: '1' }, { version: id === 'new' ? '2' : '9' }] }
          return state.detail.value
        },
        previewVersion: async version => { calls.preview.push(version); state.preview.value = { kind: 'text', text: '真实预览夹具' }; return true }
      }
      return state
    }
    const taskLinks = { ...directory(), attach: async value => {
      calls.attach.push(value)
      if (failAttach) { taskLinks.error.value = '关联结果待核对'; return null }
      const link = { ...value, relationId: 'new-link', state: 'ACTIVE' }
      taskLinks.links.value.push(link); return link
    } }
    taskLinks.links.value = [{ fileId: 'old', version: '1', role: 'INPUT', state: 'ACTIVE', relationId: 'old-link' }]
    const Picker = compile('HallMaterialPicker', { usePersonalWorkspace: workspace, validMaterialVersion,
      PdfDocumentPreview: { render: () => null } })
    const ChatWithPicker = compile('ChatPanel', { ...chatDeps, HallChatComposer: RealComposer,
      HallMaterialPicker: Picker, usePersonalWorkspace: workspace, usePersonalWorkspaceTaskLinks: () => taskLinks })
    const w = mount(ChatWithPicker, { attachTo: document.body, props: { mentionLabel: () => '', senderText: () => '',
      draft: '草稿保留', conversationId: 'c1', identityScope: 'tenant-owner', identityEpoch: 1,
      discussionVariant: 'bounty', selectedTask: { id: 'task-1', status: 'running' }, typedEnabled: true },
      global: { stubs: { 'var-dialog': true, 'var-icon': true } } })
    const dialog = () => new DOMWrapper(document.querySelector('dialog.quick-material-picker'))
    const open = async () => { w.get('.composer-add-materials').element.focus(); await w.get('.composer-add-materials').trigger('click'); await flush(); return dialog() }
    const select = async () => { await dialog().get('[data-file-id="new"]').trigger('click'); await flush(); await dialog().get('.quick-material-version-actions .primary').trigger('click'); await flush() }
    return { w, calls, taskLinks, dialog, open, select, Picker }
  }
  it('paperclip opens C08 directly without the inline intermediate panel, closing other tools', async () => {
    const h = fixture()
    try {
      await moreButton(h.w).trigger('click')
      await h.open()
      expect(h.w.find('.material-reference-picker').exists()).to.equal(false)
      expect(h.w.find('.quick-material-open').exists()).to.equal(false)
      expect(h.dialog().attributes()).to.have.property('open')
      expect(h.dialog().find('.quick-material-list-pane').exists()).to.equal(true)
      expect(h.dialog().find('.quick-material-detail-pane').exists()).to.equal(true)
      expect(h.dialog().get('input[type="file"]').attributes()).to.have.property('multiple')
      expect(h.dialog().get('.quick-material-confirm').text()).to.equal('完成（0）')
      expect(h.dialog().get('.material-use-settings').attributes()).not.to.have.property('open')
      expect(moreButton(h.w).attributes('aria-expanded')).to.equal('false')
      expect(h.calls.attach).to.deep.equal([])
      expect(h.w.emitted('send-message')).to.equal(undefined)
      await pointer(h.w.get('textarea').element)
      expect(h.dialog().exists()).to.equal(true)
    } finally { h.w.unmount() }
  })
  it('selection only stages; cancel restores focus without adding/removing existing task references', async () => {
    const h = fixture()
    try {
      await h.open(); await h.select()
      expect(h.dialog().get('.quick-material-confirm').text()).to.equal('完成（1）')
      expect(h.calls.attach).to.deep.equal([])
      expect(h.calls.preview).to.include('2')
      await h.dialog().get('.quick-material-footer-actions button').trigger('click'); await flush()
      expect(document.querySelector('dialog.quick-material-picker')).to.equal(null)
      expect(document.activeElement).to.equal(h.w.get('.composer-add-materials').element)
      expect(h.taskLinks.links.value.map(l => l.fileId)).to.deep.equal(['old'])
      await h.open()
      expect(h.dialog().get('.quick-material-confirm').text()).to.equal('完成（0）')
      expect(h.w.get('textarea').element.value).to.equal('草稿保留')
      expect(h.w.emitted('send-message')).to.equal(undefined)
    } finally { h.w.unmount() }
  })
  it('completion associates the selected immutable version exactly once without sending', async () => {
    const h = fixture()
    try {
      await h.open(); await h.select()
      await h.dialog().get('.quick-material-confirm').trigger('click'); await flush()
      expect(h.calls.attach).to.deep.equal([{ fileId: 'new', version: '2', role: 'REFERENCE' }])
      expect(h.taskLinks.links.value.map(l => l.fileId)).to.deep.equal(['old', 'new'])
      expect(h.w.emitted('send-message')).to.equal(undefined)
      expect(h.w.emitted('update:draft')).to.equal(undefined)
      await h.open()
      expect(h.dialog().get('.quick-material-confirm').text()).to.equal('完成（0）')
      expect(h.dialog().get('.material-use-settings').text()).to.include('2 份')
      expect(h.dialog().get('.material-use-settings').text()).to.include('原任务资料.pdf · v1')
    } finally { h.w.unmount() }
  })
  it('cancel discards scope edits; completion retains explicit fixed-version source selectors', async () => {
    const h = fixture()
    try {
      await h.open()
      await h.dialog().get('select[aria-label="资料范围"]').setValue('NONE')
      await h.dialog().get('.quick-material-footer-actions button').trigger('click'); await flush()
      await h.open()
      expect(h.dialog().get('select').element.value).to.equal('TASK_DEFAULT')
      await h.dialog().get('select').setValue('EXPLICIT')
      await h.dialog().get('.material-use-list input').setValue(true)
      await h.dialog().get('.quick-material-confirm').trigger('click'); await flush()
      h.w.getComponent(RealComposer).vm.$emit('send-message'); await flush()
      expect(h.w.emitted('send-message').at(-1)[0]).to.deep.equal({ materialScope: 'EXPLICIT',
        sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: 'old', version: '1', purpose: 'INPUT' }] })
      expect(h.calls.attach).to.deep.equal([])
    } finally { h.w.unmount() }
  })
  it('failed association keeps a visible recovery entry and the pending fixed selection', async () => {
    const h = fixture({ failAttach: true })
    try {
      await h.open(); await h.select()
      await h.dialog().get('.quick-material-confirm').trigger('click'); await flush()
      expect(h.w.get('.material-link-status').text()).to.include('部分资料尚未关联')
      await h.w.get('.material-link-status button').trigger('click'); await flush()
      expect(h.dialog().get('.quick-material-confirm').text()).to.equal('完成（1）')
      expect(h.dialog().text()).to.include('关联结果待核对')
      expect(h.calls.attach).to.have.length(1)
      expect(h.w.emitted('send-message')).to.equal(undefined)
    } finally { h.w.unmount() }
  })
  for (const change of [{ identityEpoch: 2 }, { selectedTask: { id: 'task-2', status: 'running' } }, { selectedTask: { id: 'task-1', status: 'completed' } }]) {
    it(`closes/discards picker on context change ${JSON.stringify(change)}`, async () => {
      const h = fixture()
      try {
        await h.open(); await h.select()
        await h.w.setProps(change); await flush()
        expect(document.querySelector('dialog.quick-material-picker')).to.equal(null)
        expect(h.calls.attach).to.deep.equal([])
        expect(h.w.emitted('send-message')).to.equal(undefined)
      } finally { h.w.unmount() }
    })
  }
})
