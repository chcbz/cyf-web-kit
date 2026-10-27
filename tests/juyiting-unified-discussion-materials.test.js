import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { validMaterialVersion } from '../src/composables/juyiting/materialVersion.js'
import * as turns from '../src/composables/juyiting/hallDiscussionTurns.js'

const compile = (name, deps) => {
  const { descriptor } = parse(readFileSync(new URL(`../src/components/juyiting/${name}.vue`, import.meta.url), 'utf8'))
  const code = compileScript(descriptor, { id: name, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, name) => `var ${name} = deps.${name}`)
    .replace('export default', 'return')
  return new Function('Vue', 'deps', code)(Vue, deps)
}
const receipt = (id = 'photo') => ({ file: { fileId: id, displayName: `${id}.png`, state: 'ACTIVE' }, version: { fileId: id, version: '1', contentMimeType: 'image/png' }, operation: { state: 'COMMITTED' } })
const settle = async () => { await flushPromises(); await Vue.nextTick() }
const workspace = () => ({ items: Vue.ref([]), listState: Vue.ref('empty'), nextCursor: Vue.ref(null), detail: Vue.ref(null), preview: Vue.ref({ kind: 'none' }), pendingWrites: Vue.ref([]), loading: Vue.ref(false), error: Vue.ref(''), actionState: Vue.ref('idle'), writeNotice: Vue.ref(''),
  refresh: async () => true, loadMore: async () => {}, closeDetail() {}, dispose() {}, upload: async () => receipt(), retryWrite: async () => receipt(), select: async () => null })
const stub = { render: () => null }
const picker = state => compile('HallMaterialPicker', { usePersonalWorkspace: () => state, validMaterialVersion, PdfDocumentPreview: stub })
const mountPicker = state => mount(picker(state), { attachTo: document.body, props: { identityScope: 'owner/thread-a', dialogOnly: true }, global: { stubs: { 'var-icon': true } } })

describe('shared discussion material import receipts', () => {
  it('imports authoritative fixed versions without opening a picker or sending a message', async () => {
    const state = workspace(), wrapper = mountPicker(state)
    try {
      await wrapper.vm.importImages([{ name: 'photo.png' }]); await settle()
      expect(wrapper.emitted('import-materials')[0][0]).to.deep.equal([{ fileId: 'photo', version: '1', displayName: 'photo.png', contentMimeType: 'image/png' }])
      expect(wrapper.emitted('update:modelValue')).to.equal(undefined)
      expect(document.querySelector('dialog')).to.equal(null)
    } finally { wrapper.unmount() }
  })
  it('unknown uploads are checked, not re-uploaded; confirmed files alone enter the draft', async () => {
    const state = workspace(); let uploads = 0, checks = 0
    state.upload = async () => { uploads++; state.pendingWrites.value = [{ target: 'CREATE' }]; return null }
    state.retryWrite = async target => { expect(target).to.equal('CREATE'); checks++; state.pendingWrites.value = []; return receipt() }
    const wrapper = mountPicker(state)
    try {
      await wrapper.vm.importImages([{ name: 'photo.png' }]); await settle()
      expect(wrapper.emitted('import-materials')).to.equal(undefined)
      await wrapper.vm.importImages([{ name: 'photo.png' }])
      expect(uploads).to.equal(1)
      await wrapper.get('.quick-material-import-status button').trigger('click'); await settle()
      expect(checks).to.equal(1); expect(uploads).to.equal(1)
      expect(wrapper.emitted('import-materials')[0][0][0].fileId).to.equal('photo')
      expect(wrapper.emitted('upload-busy').at(-1)).to.deep.equal([false])
    } finally { wrapper.unmount() }
  })
  it('does not adopt late results after changing identity/scope', async () => {
    const state = workspace(); let resolve
    state.upload = () => new Promise(done => { resolve = done })
    const wrapper = mountPicker(state)
    try {
      const pending = wrapper.vm.importImages([{ name: 'photo.png' }])
      await wrapper.setProps({ identityScope: 'owner/thread-b' })
      resolve(receipt()); await pending; await settle()
      expect(wrapper.emitted('import-materials')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })
  it('retains committed partial imports when the next file fails', async () => {
    const state = workspace(); let calls = 0
    state.upload = async () => ++calls === 1 ? receipt() : null
    const wrapper = mountPicker(state)
    try {
      await wrapper.vm.importImages([{ name: 'first.png' }, { name: 'second.png' }]); await settle()
      expect(wrapper.emitted('import-materials')[0][0]).to.have.length(1)
      expect(wrapper.text()).to.include('上传结果尚未确认')
    } finally { wrapper.unmount() }
  })
})

const directory = () => {
  const links = Vue.ref([]), calls = []
  return { ...workspace(), links, calls, load: async () => true,
    attach: async material => { calls.push(['attach', material]); const link = { ...material, relationId: `link-${material.fileId}`, state: 'ACTIVE' }; links.value.push(link); return link },
    detach: async link => { calls.push(['detach', link.fileId]); links.value = links.value.filter(item => item.relationId !== link.relationId); return true } }
}
const panel = variant => {
  const state = workspace(), conversation = directory(), task = directory()
  state.items.value = [{ fileId: 'photo', latestVersion: '1', displayName: 'photo.png', state: 'ACTIVE' }]
  state.select = async fileId => {
    const detail = { file: state.items.value.find(file => file.fileId === fileId), latestVersion: { version: '1' }, versions: [{ fileId, version: '1', contentMimeType: 'image/png' }] }
    state.detail.value = detail
    return detail
  }
  state.previewVersion = async () => { state.preview.value = { kind: 'unsupported', message: '测试替身不读取真实文件' } }
  const deps = { ...turns, usePersonalWorkspace: () => state, usePersonalWorkspaceConversationLinks: () => conversation, usePersonalWorkspaceTaskLinks: () => task,
    marked: Object.assign(x => x, { setOptions() {} }), DOMPurify: { sanitize: x => x }, HallMessageParts: stub, BountyTextSelectionArchive: stub,
    HallMaterialThumbnail: stub, HallConversationHistory: stub, BountyTypedOutcomeCard: stub, WorkspaceWriteRecovery: stub, HallVoiceControls: stub }
  deps.HallChatComposer = compile('HallChatComposer', deps)
  deps.HallMaterialPicker = picker(state)
  const wrapper = mount(compile('ChatPanel', deps), { attachTo: document.body, props: { discussionVariant: variant, conversationId: 'thread-a', selectedTask: { id: 'task-a' }, identityScope: 'owner', draft: '原有草稿', mentionLabel: () => '', senderText: () => '' }, global: { stubs: { 'var-icon': true } } })
  return { wrapper, conversation, task, state, Picker: deps.HallMaterialPicker }
}
describe('same production picker and attachment semantics in every discussion', () => {
  for (const variant of ['public', 'private', 'bounty']) it(`${variant}: common modal, cancellation, import and detach use the scoped adapter`, async () => {
    const { wrapper, conversation, task, Picker } = panel(variant)
    const selected = variant === 'bounty' ? task : conversation
    try {
      await settle()
      await wrapper.get('.composer-add-materials').trigger('click'); await settle()
      expect(document.querySelector('dialog[open]')).not.to.equal(null)
      const pickerWrapper = wrapper.findComponent(Picker)
      const click = async selector => { document.querySelector(selector).click(); await settle() }
      await click('.quick-material-files button')
      await click('.quick-material-version-actions .primary')
      await click('.quick-material-back')
      expect(selected.calls).to.have.length(0)
      expect(pickerWrapper.emitted('update:modelValue')).to.equal(undefined)
      await wrapper.get('.composer-add-materials').trigger('click'); await settle()
      await click('.quick-material-files button')
      await click('.quick-material-version-actions .primary')
      await click('.quick-material-confirm')
      expect(selected.calls[0][0]).to.equal('attach')
      expect((variant === 'bounty' ? conversation : task).calls).to.have.length(0)
      expect(wrapper.get('.composer-input-area .composer-attachment-strip').attributes('tabindex')).to.equal('0')
      expect(wrapper.get('.composer-attachment-card').text()).to.include('photo.png')
      await wrapper.get('[aria-label="移除 photo.png"]').trigger('click'); await settle()
      expect(selected.calls.at(-1)).to.deep.equal(['detach', 'photo'])
      expect(wrapper.find('.composer-attachment-card').exists()).to.equal(false)
      expect(wrapper.emitted('send-message')).to.equal(undefined)
      expect(wrapper.props('draft')).to.equal('原有草稿')
    } finally { wrapper.unmount() }
  })
})

describe('upload recovery leaves tools reachable', () => {
  it('blocks sending an unknown upload but allows checking it and opening the shared selector', async () => {
    const { wrapper, state, Picker, conversation } = panel('private')
    let uploads = 0
    state.upload = async () => { uploads++; state.pendingWrites.value = [{ target: 'CREATE' }]; return null }
    state.retryWrite = async () => { state.pendingWrites.value = []; return receipt() }
    try {
      await settle()
      await wrapper.findComponent(Picker).vm.$.exposed.importImages([{ name: 'photo.png' }]); await settle()
      expect(wrapper.get('.composer-send').attributes('disabled')).to.equal('')
      expect(wrapper.get('.composer-add-materials').attributes('disabled')).to.equal(undefined)
      await wrapper.get('.quick-material-import-status button').trigger('click'); await settle()
      expect(uploads).to.equal(1)
      expect(conversation.calls[0]).to.deep.equal(['attach', { fileId: 'photo', version: '1', role: 'REFERENCE' }])
      expect(wrapper.get('.composer-send').attributes('disabled')).to.equal(undefined)
      expect(wrapper.get('.composer-attachment-card').text()).to.include('photo.png')
      expect(wrapper.emitted('send-message')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })
  it('dialog-only identity resets never emit a user-confirmed empty selection', async () => {
    const state = workspace(), wrapper = mountPicker(state)
    try {
      await wrapper.setProps({ modelValue: [{ fileId: 'photo', version: '1' }] })
      await wrapper.setProps({ identityScope: 'owner/other-thread' })
      expect(wrapper.emitted('update:modelValue')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })
})

describe('fixed-version attachment thumbnails', () => {
  it('uses an independent workspace preview and falls back to a file icon on image failure', async () => {
    const state = workspace(), calls = []
    state.select = async () => ({ versions: [{ version: '1', contentMimeType: 'image/png' }] })
    state.previewVersion = async version => { calls.push(version); state.preview.value = { kind: 'image', url: 'blob:fixture-image' } }
    const component = compile('HallMaterialThumbnail', { usePersonalWorkspace: () => state })
    const wrapper = mount(component, { props: { fileId: 'photo', version: '1', identityKey: 'owner/thread-a' } })
    try {
      await settle()
      expect(calls).to.deep.equal(['1'])
      expect(wrapper.get('img').attributes('src')).to.equal('blob:fixture-image')
      await wrapper.get('img').trigger('error')
      expect(wrapper.find('img').exists()).to.equal(false)
      expect(wrapper.find('svg').exists()).to.equal(true)
    } finally { wrapper.unmount() }
  })
  it('does not preview a stale identity lookup or silently substitute the latest version', async () => {
    const state = workspace(), calls = []; let finish
    state.select = () => new Promise(resolve => { finish = resolve })
    state.previewVersion = async version => calls.push(version)
    const component = compile('HallMaterialThumbnail', { usePersonalWorkspace: () => state })
    const wrapper = mount(component, { props: { fileId: 'photo', version: '1', identityKey: 'owner/thread-a' } })
    try {
      const old = finish
      await wrapper.setProps({ identityKey: 'other-owner/thread-b' })
      old({ versions: [{ version: '1', contentMimeType: 'image/png' }] })
      finish({ versions: [{ version: '2', contentMimeType: 'image/png' }] })
      await settle()
      expect(calls).to.have.length(0)
      expect(wrapper.find('img').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })
})

describe('task-only source scope stays explicit', () => {
  it('does not reselect an existing file that was unchecked for this message', async () => {
    const { wrapper, task } = panel('bounty')
    task.links.value = [{ fileId: 'photo', version: '1', relationId: 'existing-photo', role: 'REFERENCE', state: 'ACTIVE' }]
    try {
      await wrapper.setProps({ typedEnabled: true }); await settle()
      await wrapper.get('.composer-add-materials').trigger('click'); await settle()
      const select = document.querySelector('[aria-label="资料范围"]')
      select.value = 'EXPLICIT'; select.dispatchEvent(new window.Event('change', { bubbles: true })); await settle()
      expect(document.querySelector('.material-use-list input').checked).to.equal(false)
      document.querySelector('.quick-material-confirm').click(); await settle()
      await wrapper.get('form').trigger('submit')
      expect(wrapper.emitted('send-message')[0][0]).to.deep.equal({ sourceSelectors: [], materialScope: 'EXPLICIT' })
      expect(task.links.value).to.have.length(1)
      expect(task.calls).to.have.length(0)
    } finally { wrapper.unmount() }
  })
})
