import * as discussionTurnHelpers from '../src/composables/juyiting/hallDiscussionTurns.js'
import { useHallExecutionAbandonment } from '../src/composables/juyiting/useHallExecutionAbandonment.js'
import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import * as outputCatalog from '../src/composables/juyiting/bountyOutputCatalog.js'
import * as discussionContract from '../src/components/juyiting/discussionPanelContract.js'
import { bountyDeliberationPresentation } from '../src/composables/juyiting/hallMultimediaDeliberationUi.js'
import { useHallSkillResults } from '../src/composables/juyiting/useHallSkillResults.js'
import { skillResultDataText } from '../src/composables/juyiting/hallSkillResults.js'
import { revisionProgressPending } from '../src/composables/juyiting/hallTypedDeliberation.js'
import { conversationAssetContentPath, safeMediaKind, revisionOf } from '../src/composables/juyiting/hallMessageParts.js'

const source = name => readFileSync(new URL(`../src/components/juyiting/${name}.vue`, import.meta.url), 'utf8')
const load = (name, deps) => {
  const filename = `src/components/juyiting/${name}.vue`
  const { descriptor } = parse(source(name), { filename })
  const code = compileScript(descriptor, { id: name, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, name) => `var ${name} = deps.${name}`)
    .replace('export default', 'return')
  return new Function('Vue', 'deps', code)(Vue, deps)
}
const noRender = { render: () => null }
const directory = () => ({ items: Vue.ref([]), links: Vue.ref([]), pendingWrites: Vue.ref([]), loading: Vue.ref(false), error: Vue.ref(''),
  actionState: Vue.ref('idle'), writeNotice: Vue.ref(''), refresh: async () => true, load: async () => true,
  dispose: () => {}, retryWrite: () => {} })
const createComponents = api => {
  const deps = { ...discussionTurnHelpers, useHallExecutionAbandonment, ...outputCatalog, ...discussionContract, bountyDeliberationPresentation, useHallSkillResults, skillResultDataText,
    revisionProgressPending, conversationAssetContentPath, safeMediaKind, revisionOf, createApi: () => api, saveOutputBlob: () => {},
    useHallConversationArchive: () => ({ statusFor: () => ({}), save: () => {}, check: () => {} }),
    marked: Object.assign(value => value, { setOptions: () => {} }), DOMPurify: { sanitize: value => value },
    usePersonalWorkspace: directory, usePersonalWorkspaceConversationLinks: directory, usePersonalWorkspaceTaskLinks: directory,
    BountyTextSelectionArchive: noRender, BountyTypedOutcomeCard: noRender, HallConversationHistory: noRender,
    WorkspaceWriteRecovery: noRender, HallChatComposer: noRender, HallMaterialPicker: noRender,
    TaskSkillCapabilities: noRender, BountyDeliberationStatus: noRender, BountyExecutionTermination: noRender }
  for (const name of ['HallMessageMedia', 'HallMessageParts', 'BountyExecutionOutputs', 'ChatPanel', 'BountyDiscussionPanel']) deps[name] = load(name, deps)
  return deps
}
const part = (n, changes = {}) => ({ partId: `part-${n}`, kind: 'image', state: 'ready', assetId: `asset-${n}`, revision: '1', filename: `版本${n}.png`, mime: 'image/png', ...changes })
const message = (n, changes = {}) => ({ localId: `message-${n}`, sender: 'AGENT', content: `第${n}稿`, parts: [part(n)], ...changes })
const output = (n, changes = {}) => {
  const url = `/chat/requests/request-${n}/steps/step-1/outputs/output-1`
  return { outputId: 'output-1', contentMimeType: 'image/png', sha256: String(n).repeat(64), byteLength: '3', previewUrl: url,
    downloadUrl: `${url}?download=true`, assetRef: { assetId: `asset-${n}`, revision: '1' }, ...changes }
}
const request = n => ({ requestId: `request-${n}`, conversationId: 'conversation-1', state: 'COMPLETED',
  steps: [{ stepId: 'step-1', kind: 'EXECUTE', executionId: `execution-${n}`, executionState: 'OUTPUT_COMMITTED' }] })
const props = { deliberationV2Enabled: true, selectedTask: { id: 'task-1', status: 'running', taskVersion: '1' },
  conversationId: 'conversation-1', identityScope: 'owner-a', identityEpoch: 1,
  requestCatalog: [1, 2].map(n => ({ request: request(n) })), messages: [message(1), message(2)], mentionLabel: () => '', senderText: () => 'Agent' }
const settle = async () => { await flushPromises(); await Vue.nextTick() }
const setup = (outputs = [output(1), output(2)]) => {
  const calls = []
  let failure = false
  let gate = null
  const api = { get: async path => {
    calls.push({ path, method: 'GET' })
    if (gate) await gate
    if (failure) throw new Error('读取失败')
    const n = Number(path.match(/request-(\d+)/)?.[1])
    return path.endsWith('/outputs') ? [outputs[n - 1]] : request(n)
  }, execute: async options => { calls.push(options); return new Blob(['png'], { type: 'image/png' }) } }
  const components = createComponents(api)
  const wrapper = mount(components.BountyDiscussionPanel, { props, global: { stubs: { 'var-icon': true } } })
  return { wrapper, calls, components, fail: value => { failure = value }, pause: () => {
    let release; gate = new Promise(resolve => { release = resolve })
    return () => { gate = null; release() }
  } }
}

describe('scoped bounty output actions live on the actual message cards', () => {
  let oldCreate; let oldRevoke
  before(() => {
    oldCreate = URL.createObjectURL; oldRevoke = URL.revokeObjectURL
    URL.createObjectURL = () => 'blob:inline-test'; URL.revokeObjectURL = () => {}
  })
  after(() => { URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke })
  it('renders preview then accept on each message version, without a second gallery or writes', async () => {
    const f = setup()
    try {
      await settle()
      expect(f.wrapper.find('.bounty-output-gallery').exists()).to.equal(false)
      expect(f.wrapper.text()).not.to.include('议事成果')
      const rows = f.wrapper.findAll('.hall-message')
      expect(rows).to.have.length(2)
      for (const row of rows) expect(row.findAll('.media-actions button').map(button => button.text())).to.deep.equal(['预览', '验收此版'])
      await rows[0].get('.message-output-accept').trigger('click')
      const selected = f.wrapper.emitted('accept-output')[0][0]
      expect(selected).to.include({ requestId: 'request-1', stepId: 'step-1', outputId: 'output-1', sha256: '1'.repeat(64) })
      expect(selected.assetRef).to.deep.equal({ assetId: 'asset-1', revision: '1' })
      await rows[1].get('.message-output-accept').trigger('click')
      expect(f.wrapper.emitted('accept-output')[1][0].requestId).to.equal('request-2')
      expect(f.calls.every(call => call.method === 'GET')).to.equal(true)
      await f.wrapper.get('[aria-label="统一验收"]').trigger('click')
      expect(f.wrapper.emitted('review-delivery')).to.deep.equal([[]])
      expect(f.wrapper.emitted('outputs-change').at(-1)[0]).to.have.length(2)
    } finally { f.wrapper.unmount() }
  })
  it('merged reply retains the exact child asset preview and acceptance identity', async () => {
    const f = setup()
    try {
      const original = { localId: 'parent-1', sender: 'AGENT', content: '正在修改图片', parts: [] }
      const projection = { key: 'action-1', conversationId: 'conversation-1', outcome: { taskId: 'task-1', kind: 'ACTION_REQUEST', assistantMessageId: 'parent-1' },
        actionProgress: { childRequestId: 'request-1', state: 'COMPLETED' } }
      await f.wrapper.setProps({ messages: [original, message(1, { requestId: 'request-1', content: '已生成成果；可预览或下载。' })], typedOutcomes: [projection] })
      await settle()
      const rows = f.wrapper.findAll('.hall-message')
      expect(rows).to.have.length(1)
      expect(rows[0].text()).to.include('正在修改图片').and.include('本轮完成')
      expect(rows[0].text()).not.to.include('可预览或下载')
      expect(rows[0].findAll('.media-actions button').map(button => button.text())).to.deep.equal(['预览', '验收此版'])
      await rows[0].get('.media-actions button').trigger('click'); await settle()
      expect(document.querySelector('[aria-label="会话资料预览"] img').src).to.include('blob:inline-test')
      document.querySelector('[aria-label="关闭预览"]').click(); await settle()
      await rows[0].get('.message-output-accept').trigger('click')
      expect(f.wrapper.emitted('accept-output')[0][0]).to.include({ requestId: 'request-1', stepId: 'step-1', outputId: 'output-1', sha256: '1'.repeat(64) })
      expect(original.parts).to.deep.equal([])
      expect(f.calls.every(call => call.method === 'GET')).to.equal(true)
    } finally { f.wrapper.unmount() }
  })
  it('keeps busy/voice/terminal guards and previews when the task becomes read-only', async () => {
    const f = setup()
    try {
      await settle(); await f.wrapper.setProps({ reviewBusy: true })
      expect(f.wrapper.findAll('.message-output-accept').every(button => button.attributes('disabled') === '')).to.equal(true)
      await f.wrapper.get('.message-output-accept').trigger('click'); expect(f.wrapper.emitted('accept-output')).to.equal(undefined)
      await f.wrapper.setProps({ reviewBusy: false, voice: { voiceInteractionLocked: true } })
      expect(f.wrapper.get('.message-output-accept').attributes('disabled')).to.equal('')
      await f.wrapper.setProps({ voice: null, selectedTask: { ...props.selectedTask, status: 'completed' } })
      expect(f.wrapper.find('.message-output-accept').exists()).to.equal(false)
      expect(f.wrapper.find('[aria-label="统一验收"]').exists()).to.equal(false)
      expect(f.wrapper.findAll('.media-actions button').map(button => button.text())).to.deep.equal(['预览', '预览'])
      await f.wrapper.findAll('.media-actions button')[0].trigger('click'); await settle()
      expect(document.querySelector('[aria-label="会话资料预览"]')).not.to.equal(null)
    } finally { f.wrapper.unmount() }
  })
  it('disables card acceptance during an authoritative catalog refresh', async () => {
    const f = setup(); let release
    try {
      await settle(); release = f.pause()
      await f.wrapper.get('[aria-label="重取回话"]').trigger('click')
      expect(f.wrapper.emitted('load-messages')).to.deep.equal([[]])
      await settle()
      expect(f.wrapper.findAll('.message-output-accept')).to.have.length(2)
      expect(f.wrapper.findAll('.message-output-accept').every(button => button.attributes('disabled') === '')).to.equal(true)
      await f.wrapper.get('.message-output-accept').trigger('click')
      expect(f.wrapper.emitted('accept-output')).to.equal(undefined)
      release(); await settle()
      expect(f.wrapper.get('.message-output-accept').attributes('disabled')).to.equal(undefined)
    } finally { release?.(); f.wrapper.unmount() }
  })
  it('uses the same inline preview/accept row for audio and file results', async () => {
    for (const [kind, mime] of [['audio', 'audio/mpeg'], ['file', 'application/pdf']]) {
      const f = setup([output(1, { contentMimeType: mime, ...(kind === 'file' ? { previewUrl: null } : {}) }), output(2)])
      try {
        await f.wrapper.setProps({ messages: [message(1, { parts: [part(1, { kind, mime })] })] }); await settle()
        expect(f.wrapper.findAll('.media-actions button').map(button => button.text())).to.deep.equal(['预览', '验收此版'])
        await f.wrapper.get('.message-output-accept').trigger('click')
        expect(f.wrapper.emitted('accept-output')[0][0].contentMimeType).to.equal(mime)
        expect(f.calls.every(call => call.method === 'GET')).to.equal(true)
      } finally { f.wrapper.unmount() }
    }
  })
  it('does not guess an ambiguous/missing asset reference or authorize user/input/processing parts', async () => {
    for (const pair of [[output(1), output(2, { assetRef: { assetId: 'asset-1', revision: '1' } })],
      [output(1, { assetRef: null }), output(2, { assetRef: { assetId: 'asset-2', revision: '2' } })]]) {
      const f = setup(pair)
      try {
        await settle()
        expect(f.wrapper.find('.message-output-accept').exists()).to.equal(false)
        expect(f.wrapper.emitted('outputs-change').at(-1)[0]).to.have.length(2)
      } finally { f.wrapper.unmount() }
    }
    const f = setup()
    try {
      await settle(); await f.wrapper.setProps({ messages: [message(1, { sender: 'USER' }), message(2, { parts: [part(2, { state: 'processing' })] })] })
      expect(f.wrapper.find('.message-output-accept').exists()).to.equal(false)
    } finally { f.wrapper.unmount() }
  })
  it('drops old candidates on identity change and shows read errors/retry without restoring a gallery', async () => {
    const f = setup()
    try {
      await settle(); f.fail(true); await f.wrapper.setProps({ identityScope: 'owner-b', identityEpoch: 2 }); await settle()
      expect(f.wrapper.find('.message-output-accept').exists()).to.equal(false)
      expect(f.wrapper.find('[role="alert"]').text()).to.include('读取失败')
      expect(f.wrapper.find('.bounty-output-gallery').exists()).to.equal(false)
      f.fail(false); await f.wrapper.findAll('button').find(button => button.text() === '重新读取成果').trigger('click'); await settle()
      expect(f.wrapper.findAll('.message-output-accept')).to.have.length(2)
    } finally { f.wrapper.unmount() }
  })
  it('keeps completed text previews/version acceptance scoped to the exact assistant message and task', async () => {
    const components = createComponents({ execute: async () => { throw new Error('no write') } })
    const candidates = [1, 2].map(n => ({ taskId: 'task-1', requestId: `request-${n}`, text: `固定文字${n}`, sha256: String(n).repeat(64),
      messageSource: { messageId: `message-${n}` } }))
    const wrapper = mount(components.ChatPanel, { props: { ...props, discussionVariant: 'bounty', outputReviewEnabled: true,
      outputCandidates: candidates, messages: [message(1, { parts: [] }), message(2, { parts: [] })] }, global: { stubs: { 'var-icon': true } } })
    try {
      await settle()
      const rows = wrapper.findAll('.hall-message')
      expect(rows[0].findAll('.message-output-actions button').map(button => button.text())).to.deep.equal(['预览', '验收此版'])
      await rows[0].get('.message-output-actions button').trigger('click'); await settle()
      expect(document.querySelector('[aria-label="文字成果预览"] pre').textContent).to.equal('固定文字1')
      document.querySelector('[aria-label="关闭预览"]').click(); await settle()
      expect(wrapper.emitted('accept-output')).to.equal(undefined)
      await rows[0].get('.message-output-accept').trigger('click')
      expect(wrapper.emitted('accept-output')[0][0]).to.deep.equal(candidates[0])
      await rows[1].get('.message-output-actions button').trigger('click'); await settle()
      await wrapper.setProps({ identityScope: 'owner-b' }); await settle()
      expect(document.querySelector('[aria-label="文字成果预览"]')).to.equal(null)
      await wrapper.setProps({ discussionVariant: 'private' })
      expect(wrapper.find('.message-output-actions').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })
  for (const [kind, mime] of [['image', 'image/png'], ['audio', 'audio/wav'], ['file', 'application/octet-stream']]) {
    it(`discussion ${kind} preview has no download action or misleading download guidance`, async () => {
      const calls = []
      const components = createComponents({ execute: async request => { calls.push(request); return new Blob(['content'], { type: mime }) } })
      const wrapper = mount(components.HallMessageMedia, { attachTo: document.body,
        props: { part: part(1, { kind, mime }), conversationId: 'conversation-1', identityKey: 'owner-a' } })
      try {
        await settle()
        const trigger = wrapper.get('.media-actions button'); trigger.element.focus()
        await trigger.trigger('click'); await settle()
        const dialog = document.querySelector('[aria-label="会话资料预览"]')
        expect(dialog).not.to.equal(null)
        expect(dialog.textContent).not.to.include('下载')
        expect(dialog.querySelector('.media-preview-download, a[download]')).to.equal(null)
        expect(dialog.querySelector('footer')).to.equal(null)
        if (kind === 'image') expect(dialog.querySelector('img').src).to.include('blob:inline-test')
        if (kind === 'audio') expect(dialog.querySelector('audio').getAttribute('controlslist')).to.equal('nodownload')
        if (kind === 'file') {
          expect(dialog.textContent).to.include('此格式暂不支持在线预览')
          expect(calls).to.deep.equal([])
        }
        expect(calls.every(request => request.method === 'GET' && request.needAuth === true)).to.equal(true)
        dialog.querySelector('[aria-label="关闭预览"]').click(); await settle()
        expect(document.querySelector('[aria-label="会话资料预览"]')).to.equal(null)
        expect(document.activeElement).to.equal(trigger.element)
      } finally { wrapper.unmount() }
    })
  }
  it('preview still exposes real errors/retry and discards old media on identity change', async () => {
    let fail = true
    const components = createComponents({ execute: async () => {
      if (fail) throw new Error('媒体读取失败')
      return new Blob(['audio'], { type: 'audio/wav' })
    } })
    const wrapper = mount(components.HallMessageMedia, { props: { part: part(1, { kind: 'audio', mime: 'audio/wav' }),
      conversationId: 'conversation-1', identityKey: 'owner-a' } })
    try {
      await wrapper.get('.media-actions button').trigger('click'); await settle()
      const dialog = document.querySelector('[aria-label="会话资料预览"]')
      expect(dialog.querySelector('[role="alert"]').textContent).to.include('媒体读取失败')
      expect(dialog.querySelector('footer').textContent).to.equal('重试预览')
      fail = false; dialog.querySelector('footer button').click(); await settle()
      expect(dialog.querySelector('audio')).not.to.equal(null)
      expect(dialog.querySelector('footer')).to.equal(null)
      await wrapper.setProps({ identityKey: 'owner-b' }); await settle()
      expect(document.querySelector('[aria-label="会话资料预览"]')).to.equal(null)
      expect(wrapper.find('audio').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })
  it('compiles the provider, message slots and shared discussion shell', () => {
    for (const name of ['ChatPanel', 'BountyDiscussionPanel', 'BountyExecutionOutputs', 'HallMessageParts', 'HallMessageMedia']) {
      const filename = `src/components/juyiting/${name}.vue`
      const { descriptor, errors } = parse(source(name), { filename })
      expect(errors, filename).to.deep.equal([]); compileScript(descriptor, { id: name })
      expect(compileTemplate({ source: descriptor.template.content, filename, id: name }).errors, filename).to.deep.equal([])
    }
  })
})
