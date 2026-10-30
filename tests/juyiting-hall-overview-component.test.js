import { taskStatusText } from '../src/constants/juyiting.js'
import { expect } from 'chai'
import { beforeEach, describe, it } from 'mocha'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount, flushPromises } from '@vue/test-utils'
import { usePersonalWorkspace } from '../src/composables/usePersonalWorkspace.js'
import { canOpenHallItem, HALL_SOURCES, useHallOverview } from '../src/composables/juyiting/useHallOverview.js'

import { validMaterialVersion } from '../src/composables/juyiting/materialVersion.js'

const overviewSource = readFileSync(new URL('../src/components/juyiting/HallOverview.vue', import.meta.url), 'utf8')

for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) {
  if (!globalThis[name]) Object.defineProperty(globalThis, name, { value: globalThis.window[name], configurable: true })
}
const emptyWorkspace = () => ({
  hasMoreVersions: Vue.ref(false), versionsState: Vue.ref('idle'), versionsError: Vue.ref(''),
  closeDetail () { this.detail.value = null; this.revokePreview?.() },
  items: Vue.ref([]), nextCursor: Vue.ref(null), listState: Vue.ref('empty'), loading: Vue.ref(false), error: Vue.ref(''), detail: Vue.ref(null),
  refresh: async () => true, loadMore: async () => false, select: async () => null, dispose: () => {}
})
const loadMaterialPicker = (workspace, save) => {
  workspace.previewVersion ||= async () => null
  workspace.closeDetail = () => { workspace.detail.value = null; workspace.revokePreview?.() }
  const filename = fileURLToPath(new URL('../src/components/juyiting/HallMaterialPicker.vue', import.meta.url))
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const code = compileScript(descriptor, { id: 'hall-material-picker-mount', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]@\/composables\/usePersonalWorkspace['"];?\s*$/gm, 'var { usePersonalWorkspace, savePersonalWorkspaceBlob } = deps')
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\.\/\.\.\/composables\/juyiting\/materialVersion\.js['"];?\s*$/gm, 'var { validMaterialVersion } = deps')
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\.\/\.\.\/constants\/juyiting\.js['"];?\s*$/gm, 'var { taskStatusText } = deps')
    .replace(/^import\s+PdfDocumentPreview\s+from\s+['"][^'"]+['"];?\s*$/gm, "var PdfDocumentPreview = { name: 'PdfDocumentPreview', template: '<section class=\"pdf-preview-test-slot\" />', props: ['blob'] }")
    .replace('export default', 'return')
  return new Function('Vue', 'deps', code)(Vue, { taskStatusText, validMaterialVersion, usePersonalWorkspace: () => workspace, savePersonalWorkspaceBlob: save })
}
const load = (api, workspace = emptyWorkspace(), save = () => {}) => {
  const filename = fileURLToPath(new URL('../src/components/juyiting/HallOverview.vue', import.meta.url))
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const code = compileScript(descriptor, { id: 'hall-overview-mount', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]@\/composables\/juyiting\/useHallOverview['"];?\s*$/gm, 'var { canOpenHallItem, HALL_SOURCES, useHallOverview } = deps')
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]@\/composables\/usePersonalWorkspace['"];?\s*$/gm, 'var { usePersonalWorkspace, savePersonalWorkspaceBlob } = deps')
    .replace(/^import HallMaterialPicker from ['"]\.\/HallMaterialPicker\.vue['"];?\s*$/gm, 'var HallMaterialPicker = deps.HallMaterialPicker')
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\.\/\.\.\/composables\/juyiting\/materialVersion\.js['"];?\s*$/gm, 'var { validMaterialVersion } = deps')
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\.\/\.\.\/constants\/juyiting\.js['"];?\s*$/gm, 'var { taskStatusText } = deps')
    .replace(/^import\s+PdfDocumentPreview\s+from\s+['"][^'"]+['"];?\s*$/gm, "var PdfDocumentPreview = { name: 'PdfDocumentPreview', template: '<section class=\"pdf-preview-test-slot\" />', props: ['blob'] }")
    .replace('export default', 'return')
  return new Function('Vue', 'deps', code)(Vue, { taskStatusText, validMaterialVersion, HallMaterialPicker: loadMaterialPicker(workspace, save), canOpenHallItem, HALL_SOURCES, useHallOverview: options => useHallOverview({ ...options, api }), usePersonalWorkspace: () => workspace, savePersonalWorkspaceBlob: save })
}
const summary = (sourceType, sourceId, nextAction) => ({ ref: { sourceType, sourceId }, title: sourceId,
  phase: sourceType === 'TASK' ? 'UNKNOWN' : null, status: { code: sourceType === 'TASK' ? 'open' : 'QUEUED', evidenceSource: 'PERSISTED', observedAt: 100 }, targetAgent: null, nextAction, allowedActions: [nextAction], updatedAt: 100 })
const response = () => {
  const partitions = {
    private: { items: [summary('PRIVATE_CASE', 'case-a', 'OPEN_CASE'), summary('LEGACY_EXECUTION', 'exec-a', 'OPEN_EXECUTION')], status: 'partial', nextCursor: null, hasMore: false, count: null, errorCode: 'VIEWED_RESULT_NOT_TRACKED' },
    task: { items: [summary('TASK', 'task-a', 'OPEN_TASK')], status: 'partial', nextCursor: null, hasMore: false, count: null, errorCode: 'TASK_REVIEW_NOT_PROJECTED' },
    draft: { items: [summary('DRAFT', 'draft-a', 'EDIT_DRAFT')], status: 'complete', nextCursor: null, hasMore: false, count: null, errorCode: null }
  }
  const statuses = Object.fromEntries(Object.entries(partitions).map(([key, value]) => [key, { status: value.status, errorCode: value.errorCode }]))
  return { schemaVersion: 1, sections: { recent: { status: 'partial', partitions }, needsAction: { status: 'partial', partitions } }, sourceStatus: { recent: statuses, needsAction: statuses }, asOf: 100 }
}
const settle = async () => { await flushPromises(); await Vue.nextTick() }
const props = { enabled: true, identityScope: 'tenant\u0000client\u0000owner-a', identityEpoch: 1 }

describe('JYT-UX-W05 mounted overview and message projection', () => {
  it('explains save-before-delegation without inventing a beta or free-use promise', async () => {
    const writes = []
    const wrapper = mount(load({ execute: async request => { writes.push(request); return response() } }), { props })
    try {
      await settle()
      expect(wrapper.get('.overview-start-copy > p').text()).to.equal('可添加参考资料。点击“开始办事”先保存需求，确认承办后再交给好汉。')
      expect(wrapper.text()).not.to.include('免费')
      expect(wrapper.text()).not.to.include('聚义厅 · 内测')
      const all = wrapper.findAll('.overview-list-heading button').find(button => button.text() === '查看全部事项')
      await all.trigger('click')
      expect(wrapper.emitted('open-board')).to.have.length(1)
      expect(wrapper.emitted('quick-request')).to.equal(undefined)
      expect(writes.every(request => request.method !== 'POST')).to.equal(true)
    } finally { wrapper.unmount() }
  })

  const manyItems = () => {
    const data = response()
    for (const [source, type, action, times] of [
      ['private', 'PRIVATE_CASE', 'OPEN_CASE', [2, 9, 5]],
      ['task', 'TASK', 'OPEN_TASK', [8, 1, 6]],
      ['draft', 'DRAFT', 'EDIT_DRAFT', [4, 7, 3]]
    ]) {
      const part = data.sections.recent.partitions[source]
      Object.assign(part, { status: 'complete', errorCode: null, nextCursor: 'more', hasMore: true,
        items: times.map(updatedAt => ({ ...summary(type, `item-${updatedAt}`, action), updatedAt })) })
      data.sourceStatus.recent[source] = { status: 'complete', errorCode: null }
    }
    return data
  }
  const rowTitles = wrapper => wrapper.findAll('.overview-section .overview-item strong').map(row => row.text())
  it('shows the latest five across all sources, descending in recent and ascending in needsAction', async () => {
    const calls = []
    const wrapper = mount(load({ execute: async options => { calls.push(options); return manyItems() } }), { props })
    try {
      await settle()
      expect(rowTitles(wrapper)).to.deep.equal([9, 8, 7, 6, 5].map(n => `item-${n}`))
      expect(wrapper.text()).not.to.include('读取更多事项')
      await wrapper.findAll('.overview-tabs button')[1].trigger('click')
      expect(rowTitles(wrapper)).to.deep.equal([5, 6, 7, 8, 9].map(n => `item-${n}`))
      expect(wrapper.findAll('.overview-aside-card button span').map(row => row.element.firstChild.textContent)).to.deep.equal(['item-9', 'item-8'])
      expect(wrapper.text()).not.to.include('读取更多事项')
      await wrapper.findAll('.overview-tabs button')[0].trigger('click')
      expect(rowTitles(wrapper)).to.deep.equal([9, 8, 7, 6, 5].map(n => `item-${n}`))
      expect(calls).to.have.length(1)
    } finally { wrapper.unmount() }
  })
  it('shows only the latest five archive rows descending across private and task sources', async () => {
    const wrapper = mount(load({ execute: async options => {
      const data = manyItems()
      if (options.url === '/hall/overview') return data
      return { schemaVersion: 1, kind: options.params.kind, view: 'archive', q: '',
        section: data.sections.recent, sourceStatus: data.sourceStatus.recent, asOf: 100 }
    } }), { props })
    try {
      await settle()
      await wrapper.findAll('.overview-tabs button')[2].trigger('click')
      await settle()
      expect(rowTitles(wrapper)).to.deep.equal([9, 8, 6, 5, 2].map(n => `item-${n}`))
      expect(wrapper.text()).not.to.include('读取更多事项')
    } finally { wrapper.unmount() }
  })
  it('keeps fewer than five rows and the empty state without fabricating entries', async () => {
    const data = response()
    const wrapper = mount(load({ execute: async () => data }), { props })
    try {
      await settle()
      expect(rowTitles(wrapper)).to.have.length(4)
      for (const source of HALL_SOURCES) {
        Object.assign(data.sections.recent.partitions[source], { items: [], status: 'complete', errorCode: null })
        data.sourceStatus.recent[source] = { status: 'complete', errorCode: null }
      }
      await wrapper.get('.overview-list-heading [aria-label="刷新事项"]').trigger('click')
      await settle()
      expect(rowTitles(wrapper)).to.have.length(0)
      expect(wrapper.find('.overview-empty').exists()).to.equal(true)
    } finally { wrapper.unmount() }
  })
  it('does not cap or change pagination on the independent messages page', async () => {
    const wrapper = mount(load({ execute: async () => manyItems() }), { props: { ...props, messagesOnly: true } })
    try {
      await settle()
      expect(rowTitles(wrapper)).to.deep.equal([9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => `item-${n}`))
      expect(wrapper.text()).to.include('读取更多事项')
    } finally { wrapper.unmount() }
  })

  beforeEach(() => { try { window.sessionStorage.clear() } catch {} })
  it('renders cancelled/failed/blocked formal statuses accurately without reinterpreting private execution failures', async () => {
    const data = response()
    data.sections.recent.partitions.task.items = ['cancelled', 'failed', 'blocked'].map(code => ({ ...summary('TASK', code, 'OPEN_TASK'), phase: code === 'blocked' ? 'IN_PROGRESS' : 'HISTORY', status: { code, evidenceSource: 'PERSISTED', observedAt: 100 } }))
    data.sections.recent.partitions.private.items = [{ ...summary('PRIVATE_CASE', 'private-failure', 'OPEN_CASE'), status: { code: 'FAILED', evidenceSource: 'PERSISTED', observedAt: 100 } }]
    const wrapper = mount(load({ execute: async () => data }), { props })
    try {
      await settle()
      const row = code => wrapper.findAll('.overview-item').find(item => item.text().includes(code))
      expect(row('cancelled').get('.overview-status').text()).to.equal('已取消')
      expect(row('failed').get('.overview-status').text()).to.equal('办理未完成')
      expect(row('blocked').get('.overview-status').text()).to.equal('进行中')
      expect(row('private-failure').get('.overview-status').text()).to.equal('执行未完成')
    } finally { wrapper.unmount() }
  })

  it('uses explicit UNKNOWN instead of raw reviewing and never labels an unverified summary as acceptable', async () => {
    const data = response()
    data.sections.recent.partitions.task.items = [{ ...summary('TASK', 'stale-batch', 'OPEN_TASK'), phase: 'UNKNOWN', status: { code: 'reviewing', evidenceSource: 'AGENT_TASK_META', observedAt: 100 } }]
    const wrapper = mount(load({ execute: async () => data }), { props })
    try {
      await settle()
      const row = wrapper.findAll('.overview-item').find(item => item.text().includes('stale-batch'))
      expect(row.get('.overview-status').text()).to.equal('状态待核对')
      expect(row.get('button').attributes('aria-label')).to.equal('核对事项：stale-batch')
      expect(row.text()).not.to.include('查看待验收交付')
    } finally { wrapper.unmount() }
  })

  it('shows only needsAction in messages, explains partial sources, and emits exact read refs', async () => {
    const calls = []
    const wrapper = mount(load({ execute: async options => { calls.push(options); return response() } }), { props: { ...props, messagesOnly: true } })
    try {
      await settle()
      expect(wrapper.findAll('.overview-section')).to.have.length(1)
      expect(wrapper.text()).not.to.include('最近事项')
      expect(wrapper.text()).to.include('打开查看不会自动验收或归档')
      expect(wrapper.text()).to.include('正式成果的待验收情况尚未完整纳入')
      expect(wrapper.findAll('.overview-empty')).to.have.length(0)
      await wrapper.findAll('.overview-item').find(row => row.text().includes('case-a')).find('button').trigger('click')
      await wrapper.findAll('.overview-item').find(row => row.text().includes('exec-a')).find('button').trigger('click')
      await wrapper.findAll('.overview-item').find(row => row.text().includes('draft-a')).find('button').trigger('click')
      expect(wrapper.emitted('open-item').map(event => event[0])).to.deep.equal([
        { sourceType: 'PRIVATE_CASE', sourceId: 'case-a' }, { sourceType: 'LEGACY_EXECUTION', sourceId: 'exec-a' }, { sourceType: 'DRAFT', sourceId: 'draft-a' }
      ])
      expect(wrapper.findAll('button').some(button => button.text() === '提出需求')).to.equal(false)
      expect(calls).to.have.length(1)
      expect(calls[0]).not.to.have.property('params')
      expect(wrapper.findAll('button').some(button => ['标记已读', '验收', '归档'].includes(button.text()))).to.equal(false)
    } finally { wrapper.unmount() }
  })

  it('prioritizes a real draft entry in overview without submitting or waiting for the map', async () => {
    const calls = []
    const wrapper = mount(load({ execute: async options => { calls.push(options); return response() } }), { props })
    try {
      await settle()
      expect(wrapper.findAll('.overview-section')).to.have.length(1)
      expect(wrapper.find('.overview-section').attributes('aria-label')).to.equal('最近事项')
      expect(wrapper.find('.overview-quick-request').exists()).to.equal(true)
      expect(wrapper.find('.quick-request-input').exists()).to.equal(true)
      expect(wrapper.find('.quick-request-input small').text()).to.equal('0/200')
      expect(overviewSource).to.include('padding:13px 14px 34px')
      expect(overviewSource).to.include('resize:none')
      expect(overviewSource).to.include('.overview-tabs button:hover')
      expect(wrapper.text()).to.include('可添加参考资料')
      const request = wrapper.find('.overview-quick-request textarea')
      const create = wrapper.findAll('button').find(button => button.text() === '开始办事')
      expect(create.attributes('disabled')).to.equal('')
      expect(create.find('svg, var-icon').exists()).to.equal(false)
      expect(wrapper.get('.quick-material-open').attributes('aria-label')).to.equal('添加资料（可选）')
      expect(wrapper.findAll('button').some(button => button.text().includes('参考图'))).to.equal(false)
      expect(wrapper.find('.overview-resource-icon').attributes('name')).to.equal('file-document-outline')
      expect(create.element.compareDocumentPosition(wrapper.find('.overview-section').element) & Node.DOCUMENT_POSITION_FOLLOWING).not.to.equal(0)
      await request.setValue('整理一份明天活动的执行方案')
      expect(create.attributes('disabled')).to.equal(undefined)
      await create.trigger('submit')
      expect(wrapper.emitted('quick-request')[0][0]).to.deep.equal({ request: '整理一份明天活动的执行方案', materials: [] })
      expect(wrapper.emitted('quick-request')[0]).to.have.length(2)
      expect(request.element.value).to.equal('整理一份明天活动的执行方案')
      wrapper.emitted('quick-request')[0][1](false)
      expect(request.element.value).to.equal('整理一份明天活动的执行方案')
      wrapper.emitted('quick-request')[0][1](true)
      await settle()
      expect(request.element.value).to.equal('')
      expect(calls.map(call => [call.method, call.url])).to.deep.equal([['GET', '/hall/overview']])
    } finally { wrapper.unmount() }
  })

  it('refreshes the existing server overview source when the owner advances its refresh key', async () => {
    const calls = []
    const wrapper = mount(load({ execute: async options => { calls.push(options); return response() } }), { props })
    try {
      await settle()
      expect(calls.map(call => call.url)).to.deep.equal(['/hall/overview'])
      await wrapper.setProps({ refreshKey: 1 })
      await settle()
      expect(calls.map(call => call.url)).to.deep.equal(['/hall/overview', '/hall/overview'])
      expect(calls.every(call => call.method === 'GET')).to.equal(true)
    } finally { wrapper.unmount() }
  })

  it('clears only the exact quick-request edit generation acknowledged as committed', async () => {
    const wrapper = mount(load({ execute: async () => response() }), { props })
    try {
      await settle()
      const request = wrapper.find('.overview-quick-request textarea')
      await request.setValue('原始需求')
      await wrapper.get('.overview-quick-request').trigger('submit')
      const settleCreate = wrapper.emitted('quick-request')[0][1]
      await request.setValue('提交期间的新编辑')
      settleCreate(true)
      await settle()
      expect(request.element.value).to.equal('提交期间的新编辑')
      await wrapper.get('.overview-quick-request').trigger('submit')
      const settleNewRequest = wrapper.emitted('quick-request')[1][1]
      settleNewRequest(true)
      await settle()
      expect(request.element.value).to.equal('')
    } finally { wrapper.unmount() }
  })

  it('uses a real fixed-version picker, preserves confirmed selection on cancel, and clears it on identity change', async () => {
    const detail = Vue.ref(null)
    const refreshes = []
    const workspace = {
      items: Vue.ref([{ fileId: 'file-a', displayName: '活动底稿', latestVersion: '2' }, { fileId: 'file-b', displayName: '另一份底稿', latestVersion: '3' }]), nextCursor: Vue.ref(null), listState: Vue.ref('ready'), loading: Vue.ref(false), error: Vue.ref(''), detail,
      refresh: async options => { refreshes.push(options); return true }, loadMore: async () => false,
      select: async fileId => {
        if (fileId === 'file-b') {
          detail.value = { file: { fileId, displayName: '另一份底稿', state: 'ACTIVE', latestVersion: '3' }, latestVersion: { version: '3', contentMimeType: 'image/jpeg' }, versions: [{ version: '3', originalFilename: 'other-v3.jpg', contentMimeType: 'image/jpeg' }] }
          return detail.value
        }
        detail.value = { file: { fileId: 'file-a', displayName: '活动底稿', state: 'ACTIVE', latestVersion: '2' }, latestVersion: { version: '2', contentMimeType: 'image/jpeg' }, versions: [{ version: '1', originalFilename: 'bird-v1.png', contentMimeType: 'image/png' }, { version: '2', originalFilename: 'bird-v2.jpg', contentMimeType: 'image/jpeg' }] }
        return detail.value
      }, dispose: () => {}
    }
    const wrapper = mount(load({ execute: async () => response() }, workspace), { props, global: { stubs: { teleport: true } } })
    try {
      await settle()
      await wrapper.get('.quick-material-open').trigger('click')
      expect(refreshes).to.deep.equal([{ state: 'ACTIVE' }])
      expect(wrapper.get('.quick-material-open').attributes('aria-label')).to.equal('添加资料（可选）')
      expect(wrapper.find('.quick-reference-open').exists()).to.equal(false)
      expect(wrapper.text()).not.to.include('资料用途')
      expect(wrapper.get('.quick-material-picker h3').text()).to.equal('选择资料')
      expect(wrapper.get('.quick-material-picker header p').text()).to.equal('选择或上传资料，点击“完成”带入当前需求或议事。')
      expect(wrapper.get('.quick-material-confirm').text()).to.equal('完成（0）')
      expect(wrapper.text()).not.to.include('受控请求')
      expect(wrapper.emitted('open-workspace')).to.equal(undefined)
      await wrapper.get('.quick-material-files button').trigger('click')
      await settle()
      expect(wrapper.findAll('.quick-material-fields select')).to.have.length(0)
      expect(wrapper.get('.quick-material-version').text()).to.include('使用版本 2')
      await wrapper.get('.quick-material-version-actions .primary').trigger('click')
      await wrapper.get('.quick-material-confirm').trigger('click')
      expect(wrapper.get('.quick-material-summary').text()).not.to.include('image/png')
      expect(wrapper.get('.quick-material-summary').text()).not.to.include('固定')
      expect(wrapper.get('.quick-material-summary button[aria-label^="移除"]').exists()).to.equal(true)
      expect(wrapper.get('.quick-material-summary').text()).to.include('活动底稿')
      expect(wrapper.get('.quick-material-summary').text()).to.include('v2')

      await wrapper.get('.quick-material-open').trigger('click')
      await wrapper.findAll('.quick-material-files button')[1].trigger('click')
      await settle()
      expect(wrapper.get('.quick-material-version').text()).to.include('使用版本 3')
      await wrapper.get('.quick-material-version-actions .primary').trigger('click')
      await wrapper.get('.quick-material-footer-actions button:first-child').trigger('click')
      expect(wrapper.get('.quick-material-summary').text()).to.include('v2')
      expect(wrapper.get('.quick-material-summary').text()).not.to.include('另一份底稿')
      expect(wrapper.get('.quick-material-summary').text()).not.to.include('v3')

      await wrapper.get('textarea').setValue('整理活动方案')
      await wrapper.get('.overview-quick-request').trigger('submit')
      expect(wrapper.emitted('quick-request')[0][0]).to.deep.equal({ request: '整理活动方案', materials: [{ fileId: 'file-a', version: '2' }] })
      await wrapper.setProps({ identityScope: 'tenant\u0000client\u0000owner-b', identityEpoch: 2 })
      expect(wrapper.find('.quick-material-summary').exists()).to.equal(false)
    } finally { wrapper.unmount() }
  })

  it('selects non-image fixed versions through the same neutral material entry', async () => {
    const detail = Vue.ref(null)
    const refreshes = []
    const workspace = {
      items: Vue.ref([{ fileId: 'file-pdf', displayName: '执行说明', latestVersion: '3' }]), nextCursor: Vue.ref(null), listState: Vue.ref('ready'), loading: Vue.ref(false), error: Vue.ref(''), detail,
      refresh: async options => { refreshes.push(options); return true }, loadMore: async () => false,
      select: async () => {
        detail.value = { file: { fileId: 'file-pdf', displayName: '执行说明', state: 'ACTIVE', latestVersion: '3' }, latestVersion: { version: '3', contentMimeType: 'application/pdf' }, versions: [{ version: '2', originalFilename: 'brief-v2.pdf', contentMimeType: 'application/pdf' }, { version: '3', originalFilename: 'brief-v3.pdf', contentMimeType: 'application/pdf' }] }
        return detail.value
      }, dispose: () => {}
    }
    const wrapper = mount(load({ execute: async () => response() }, workspace), { props, global: { stubs: { teleport: true } } })
    try {
      await settle()
      await wrapper.get('.quick-material-open').trigger('click')
      expect(refreshes).to.deep.equal([{ state: 'ACTIVE' }])
      expect(wrapper.text()).to.include('选择资料')
      await wrapper.get('.quick-material-files button').trigger('click')
      await settle()
      expect(wrapper.findAll('.quick-material-fields select')).to.have.length(0)
      expect(wrapper.get('.quick-material-version').text()).to.include('使用版本 3')
      await wrapper.get('.quick-material-version-actions .primary').trigger('click')
      await wrapper.get('.quick-material-confirm').trigger('click')
      expect(wrapper.get('.quick-material-summary').text()).to.include('执行说明')
      expect(wrapper.get('.quick-material-summary').text()).not.to.include('application/pdf')
      await wrapper.get('textarea').setValue('整理活动方案')
      await wrapper.get('.overview-quick-request').trigger('submit')
      expect(wrapper.emitted('quick-request')[0][0]).to.deep.equal({ request: '整理活动方案', materials: [{ fileId: 'file-pdf', version: '3' }] })
    } finally { wrapper.unmount() }
  })

  it('mixes image/document/audio/text using the real workspace adapter, previews, downloads and removes without writes', async () => {
    const types = [['bird.png', 'image/png', 'IMAGE'], ['brief.pdf', 'application/pdf', 'PDF'], ['song.mp3', 'audio/mpeg', 'AUDIO'], ['notes.txt', 'text/plain', 'TEXT']]
    const calls = []; const saves = []; const revoked = []
    const files = types.map(([name, , family], index) => ({ fileId: `file-${index}`, displayName: name, mediaFamily: family, state: 'ACTIVE', metadataRevision: '1', latestVersion: '2' }))
    const versions = index => ['1', '2'].map(version => ({ fileId: `file-${index}`, version, originalFilename: types[index][0], contentMimeType: types[index][1], byteLength: '10' }))
    const workspace = usePersonalWorkspace({ identityEpoch: Vue.ref('owner-a'), urlApi: { createObjectURL: blob => `blob:${blob.type}`, revokeObjectURL: url => revoked.push(url) }, api: { execute: async options => {
      calls.push(options)
      if (options.url === '/personal-workspace/files') return { items: files, nextCursor: null, hasMore: false }
      const index = Number(/files\/file-(\d+)/.exec(options.url)[1])
      const mime = types[index][1]
      if (options.url.endsWith('/preview')) return { state: 'READY', parts: [{ partId: 'content', contentMimeType: mime }], partial: false }
      if (options.url.includes('/preview/parts/')) return new Blob(['safe preview'], { type: mime })
      if (options.url.endsWith('/content')) return new Blob(['original bytes'], { type: types[index][1] })
      return { file: files[index], latestVersion: versions(index)[1], versions: versions(index) }
    } } })
    const wrapper = mount(load({ execute: async () => response() }, workspace, content => saves.push(content)), { props, global: { stubs: { teleport: true } } })
    try {
      await settle()
      await wrapper.get('.quick-material-open').trigger('click'); await settle()
      for (let index = 0; index < types.length; index += 1) {
        await wrapper.findAll('.quick-material-files button')[index].trigger('click'); await settle()
        expect(wrapper.find('.quick-material-fields select').exists()).to.equal(false)
        expect(wrapper.get('.quick-material-version').text()).to.include('使用版本 2')
        expect(wrapper.find('.quick-material-preview-toggle').exists()).to.equal(false)
        // Desktop previews the pinned version without a redundant toggle.
        const preview = wrapper.get('.quick-material-preview')
        if (index === 0) expect(preview.get('img').attributes('src')).to.equal('blob:image/png')
        else if (index === 1) {
          expect(preview.find('.pdf-preview-test-slot').exists()).to.equal(true)
          expect(wrapper.findComponent({ name: 'PdfDocumentPreview' }).props('blob').type).to.equal('application/pdf')
        } else if (index === 2) {
          expect(preview.get('audio').attributes('src')).to.equal('blob:audio/mpeg')
          expect(preview.get('audio').attributes('preload')).to.equal('none')
        } else expect(preview.get('pre').text()).to.equal('safe preview')
        expect(wrapper.find('.quick-material-download').exists()).to.equal(false)
        await wrapper.get('.quick-material-version-actions .primary').trigger('click')
      }
      await wrapper.get('.quick-material-count').trigger('click')
      expect(wrapper.findAll('.quick-material-draft li')).to.have.length(4)
      await wrapper.get('.quick-material-confirm').trigger('click')
      await wrapper.get('textarea').setValue('结合全部资料整理方案，不生成图片')
      await wrapper.get('.overview-quick-request').trigger('submit')
      expect(wrapper.emitted('quick-request')[0][0].materials).to.deep.equal(files.map(file => ({ fileId: file.fileId, version: '2' })))
      expect(saves).to.deep.equal([])
      expect(calls.every(call => call.method === 'GET')).to.equal(true)
      expect(calls.filter(call => call.url === '/personal-workspace/files')[0].params).to.deep.equal({ state: 'ACTIVE' })
      expect(calls.filter(call => call.url.endsWith('/preview')).every(call => call.url.includes('/versions/2/'))).to.equal(true)
      expect(revoked).to.include('blob:audio/mpeg')
      await wrapper.findAll('.quick-material-summary li')[1].get('button[aria-label="预览所选资料"]').trigger('click'); await settle()
      expect(wrapper.findComponent({ name: 'PdfDocumentPreview' }).props('blob').type).to.equal('application/pdf')
      await wrapper.get('.quick-material-close').trigger('click')
      expect(wrapper.findComponent({ name: 'PdfDocumentPreview' }).exists()).to.equal(false)
      await wrapper.findAll('.quick-material-summary li')[2].get('button[aria-label="预览所选资料"]').trigger('click'); await settle()
      expect(wrapper.get('.quick-material-preview audio').attributes('src')).to.equal('blob:audio/mpeg')
      expect(wrapper.find('.quick-material-picker').exists()).to.equal(false)
      await wrapper.get('.quick-material-download').trigger('click'); await settle()
      expect(saves).to.have.length(1)
      expect(saves[0].filename).to.equal('song.mp3')
      await wrapper.get('.quick-material-close').trigger('click')
      await wrapper.get('.quick-material-summary li button[aria-label^="移除"]').trigger('click')
      expect(wrapper.findAll('.quick-material-summary li')).to.have.length(3)
      expect(calls.every(call => call.method === 'GET')).to.equal(true)
    } finally { wrapper.unmount(); workspace.dispose() }
  })

  it('only opens formal tasks after a canonical read and hides actions missing permission', async () => {
    const calls = []
    const wrapper = mount(load({ execute: async options => {
      calls.push(options)
      if (options.url === '/tasks/task-a') return { id: 'task-a', title: '原榜文', status: 'open' }
      const value = response()
      value.sections.needsAction.partitions.draft.items[0].allowedActions = []
      return value
    } }), { props: { ...props, messagesOnly: true } })
    try {
      await settle()
      expect(wrapper.findAll('button').some(button => button.text() === '继续填写')).to.equal(false)
      await wrapper.findAll('.overview-item').find(row => row.text().includes('task-a')).find('button').trigger('click')
      await settle()
      expect(wrapper.emitted('open-task')[0][0]).to.deep.equal({ id: 'task-a', title: '原榜文', status: 'open' })
      expect(wrapper.emitted('open-item')).to.equal(undefined)
      expect(calls.map(call => call.method)).to.deep.equal(['GET', 'GET'])
    } finally { wrapper.unmount() }
  })

  it('does not query before production identity readiness and never shows prior-account titles while reloading', async () => {
    const calls = []
    let resolveNext
    const wrapper = mount(load({ execute: async options => {
      calls.push(options)
      if (calls.length === 1) return response()
      return new Promise(resolve => { resolveNext = resolve })
    } }), { props: { ...props, enabled: false } })
    try {
      await settle()
      expect(calls).to.have.length(0)
      await wrapper.setProps({ enabled: true })
      await settle()
      expect(wrapper.text()).to.include('case-a')
      await wrapper.setProps({ identityScope: 'tenant\u0000client\u0000owner-b', identityEpoch: 2 })
      expect(wrapper.text()).not.to.include('case-a')
      expect(wrapper.text()).to.include('正在读取事项')
      resolveNext(response())
      await settle()
      expect(calls).to.have.length(2)
    } finally { wrapper.unmount() }
  })

  it('offers archive only for private/task sources and reads them without inventing a global count', async () => {
    const calls = []
    const wrapper = mount(load({ execute: async options => {
      calls.push(options)
      if (options.url === '/hall/overview') return response()
      const kind = options.params.kind
      const archived = { ...summary(kind === 'private' ? 'PRIVATE_CASE' : 'TASK', `${kind}-archived`, kind === 'private' ? 'OPEN_CASE' : 'OPEN_TASK'),
        personalMark: kind === 'private' ? { revision: '1', archived: true, viewedResultRef: null } : null }
      const part = { items: [archived], status: 'complete', nextCursor: null, hasMore: false, count: null, errorCode: null }
      return { schemaVersion: 1, kind, view: 'archive', q: '', section: { status: 'complete', partitions: { [kind]: part } }, sourceStatus: { [kind]: { status: 'complete', errorCode: null } }, asOf: 100 }
    } }), { props })
    try {
      await settle()
      await wrapper.findAll('button').find(button => button.text() === '已归档').trigger('click')
      await settle()
      expect(wrapper.findAll('.overview-item').map(row => row.find('strong').text())).to.deep.equal(['private-archived', 'task-archived'])
      expect(calls.slice(1).map(call => call.params)).to.deep.equal([
        { kind: 'private', view: 'archive', q: '' }, { kind: 'task', view: 'archive', q: '' }
      ])
      expect(wrapper.text()).to.include('已归档')
      expect(wrapper.text()).not.to.include('未交办草稿')
      expect(wrapper.findAll('[data-count]')).to.have.length(0)
    } finally { wrapper.unmount() }
  })

  it('routes review evidence to the exact canonical formal task and delivery without an acceptance or private mark call', async () => {
    const review = { code: 'FORMAL_DELIVERY_SUBMITTED', deliveryId: 'delivery-1', workItemId: 'work-1', deliveryVersion: '0', taskVersion: '9007199254740993' }
    const calls = []
    const task = { id: 'task-a', status: 'reviewing', title: '原正式任务' }
    const wrapper = mount(load({ execute: async options => {
      calls.push(options)
      if (options.url === '/tasks/task-a') return task
      const data = response()
      data.sections.needsAction.partitions.task.items[0].review = review
      data.sections.needsAction.partitions.task.items[0].phase = 'PENDING_ACCEPTANCE'
      data.sections.needsAction.partitions.task.items[0].status.code = 'reviewing'
      return data
    } }), { props: { ...props, messagesOnly: true } })
    try {
      await settle()
      expect(wrapper.text()).to.include('待验收')
      const row = wrapper.findAll('.overview-item').find(item => item.text().includes('task-a'))
      expect(row.get('button').attributes('aria-label')).to.equal('查看进展：task-a')
      await row.get('button').trigger('click')
      await settle()
      expect(wrapper.emitted('open-task')[0]).to.deep.equal([task, review])
      expect(calls.map(call => call.method)).to.deep.equal(['GET', 'GET'])
      expect(calls.some(call => call.url.endsWith('/mark'))).to.equal(false)
    } finally { wrapper.unmount() }
  })

  it('keeps the mobile preview toggle reachable, returns to the list without losing staged files, and commits only on Done', async () => {
    const original = window.matchMedia
    let resized
    window.matchMedia = () => ({ matches: true, addEventListener: (_name, listener) => { resized = listener }, removeEventListener () {} })
    const preview = Vue.ref({ kind: 'none' })
    const workspace = { ...emptyWorkspace(), preview,
      items: Vue.ref([{ fileId: 'image-a', displayName: '很长的参考图片名称'.repeat(8), latestVersion: '2' }]),
      select: async fileId => {
        workspace.detail.value = { file: { fileId, displayName: '参考图片', state: 'ACTIVE' }, latestVersion: { version: '2' }, versions: [{ version: '2', contentMimeType: 'image/png' }] }
        return workspace.detail.value
      },
      previewVersion: async () => { preview.value = { kind: 'image', url: 'blob:preview' } },
      revokePreview: () => { preview.value = { kind: 'none' } }
    }
    const wrapper = mount(loadMaterialPicker(workspace, () => {}), { props: { ...props, modelValue: [] }, global: { stubs: { teleport: true } } })
    try {
      await wrapper.get('.quick-material-open').trigger('click'); await settle()
      await wrapper.get('.quick-material-files button').trigger('click'); await settle()
      expect(preview.value.kind).to.equal('none')
      await wrapper.get('.quick-material-version-actions .primary').trigger('click')
      expect(wrapper.emitted('update:modelValue')).to.equal(undefined)
      const toggle = wrapper.get('.quick-material-preview-toggle')
      await toggle.trigger('click'); await settle()
      expect(wrapper.get('.quick-material-preview-toggle').attributes('aria-label'), wrapper.get('dialog').html()).to.equal('收起预览')
      expect(wrapper.get('.quick-material-preview-toggle').attributes('aria-expanded')).to.equal('true')
      expect(wrapper.get('.quick-material-preview img').attributes('src')).to.equal('blob:preview')
      await wrapper.get('.quick-material-picker header button').trigger('click'); await settle()
      expect(wrapper.find('.quick-material-picker').exists()).to.equal(true)
      expect(wrapper.get('.quick-material-preview-toggle').attributes('aria-expanded')).to.equal('false')
      await wrapper.get('.quick-material-count').trigger('click')
      expect(wrapper.findAll('.quick-material-draft li')).to.have.length(1)
      resized({ matches: false }); await settle()
      expect(wrapper.find('.quick-material-preview-toggle').exists()).to.equal(false)
      expect(wrapper.get('.quick-material-preview img').attributes('src')).to.equal('blob:preview')
      resized({ matches: true }); await settle()
      expect(wrapper.findAll('.quick-material-draft li')).to.have.length(1)
      await wrapper.get('.quick-material-confirm').trigger('click')
      expect(wrapper.emitted('update:modelValue')[0][0]).to.deep.equal([{ fileId: 'image-a', version: '2', displayName: '参考图片', contentMimeType: 'image/png' }])
    } finally { wrapper.unmount(); window.matchMedia = original }
  })

  it('resolves an older restored input page without previewing or replacing it with latest', async () => {
    const previewCalls = []
    const workspace = { ...emptyWorkspace(), hasMoreVersions: Vue.ref(true), preview: Vue.ref({ kind: 'none' }),
      items: Vue.ref([{ fileId: 'old-file', displayName: '原资料', latestVersion: '100' }]),
      select: async fileId => {
        workspace.detail.value = { file: { fileId, displayName: '原资料', state: 'ACTIVE' }, latestVersion: { version: '100' }, versions: [{ version: '100' }] }
        return workspace.detail.value
      },
      loadMoreVersions: async () => {
        workspace.detail.value = { ...workspace.detail.value, versions: [...workspace.detail.value.versions, { version: '1' }] }
        workspace.hasMoreVersions.value = false
        return true
      },
      previewVersion: async version => { previewCalls.push(version); workspace.preview.value = { kind: 'text', text: '原固定版本' } }
    }
    const original = [{ fileId: 'old-file', version: '1', displayName: '原资料' }]
    const wrapper = mount(loadMaterialPicker(workspace, () => {}), { props: { ...props, modelValue: original }, global: { stubs: { teleport: true } } })
    try {
      await wrapper.get('.quick-material-summary button').trigger('click'); await settle()
      expect(wrapper.find('.quick-material-picker').exists()).to.equal(false)
      expect(wrapper.get('.quick-material-standalone pre').text()).to.equal('原固定版本')
      expect(previewCalls).to.deep.equal(['1'])
      expect(original).to.deep.equal([{ fileId: 'old-file', version: '1', displayName: '原资料' }])
      await wrapper.get('.quick-material-close').trigger('click')
      expect(wrapper.emitted('update:modelValue')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })

  it('never substitutes a missing fixed version with a newer file when reopening a restored draft', async () => {
    const previewCalls = []
    const workspace = { ...emptyWorkspace(), items: Vue.ref([{ fileId: 'missing-old', displayName: '资料', latestVersion: '2' }]),
      select: async fileId => {
        workspace.detail.value = { file: { fileId, state: 'ACTIVE' }, latestVersion: { version: '2' }, versions: [{ version: '2' }] }
        return workspace.detail.value
      }, previewVersion: async version => previewCalls.push(version) }
    const wrapper = mount(loadMaterialPicker(workspace, () => {}), { props: { ...props, modelValue: [{ fileId: 'missing-old', version: '1' }] }, global: { stubs: { teleport: true } } })
    try {
      await wrapper.get('.quick-material-summary button').trigger('click'); await settle()
      expect(workspace.error.value).to.include('固定版本暂时无法打开')
      expect(previewCalls).to.deep.equal([])
      expect(wrapper.find('.quick-material-version-actions .primary').exists()).to.equal(false)
      expect(wrapper.emitted('update:modelValue')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })

  it('uses only one leading exit and discards unconfirmed mobile selections on cancel or identity change', async () => {
    const original = window.matchMedia
    window.matchMedia = () => ({ matches: true, addEventListener () {}, removeEventListener () {} })
    const wrapper = mount(loadMaterialPicker(emptyWorkspace(), () => {}), { props: { ...props, modelValue: [] }, global: { stubs: { teleport: true } } })
    try {
      await wrapper.get('.quick-material-open').trigger('click'); await settle()
      expect(wrapper.get('dialog').attributes('aria-labelledby')).to.equal('hall-material-picker-title')
      expect(wrapper.findAll('dialog header button')).to.have.length(1)
      await wrapper.get('dialog header button').trigger('click'); await settle()
      expect(wrapper.find('dialog').exists()).to.equal(false)
      expect(wrapper.emitted('update:modelValue')).to.equal(undefined)
      await wrapper.get('.quick-material-open').trigger('click'); await settle()
      await wrapper.setProps({ identityEpoch: 2 })
      expect(wrapper.find('dialog').exists()).to.equal(false)
      expect(wrapper.emitted('update:modelValue').at(-1)[0]).to.deep.equal([])
    } finally { wrapper.unmount(); window.matchMedia = original }
  })

})


describe('page parity fixes: home draft and picker uploads', () => {
  beforeEach(() => { try { window.sessionStorage.clear() } catch {} })
  it('restores unsent home text after remount and clears it on identity change', async () => {
    const C = load({ execute: async () => response() })
    let wrapper = mount(C, { props })
    await settle(); await wrapper.get('textarea').setValue('刷新后仍保留的需求')
    wrapper.unmount()
    wrapper = mount(C, { props })
    try {
      await settle(); expect(wrapper.get('textarea').element.value).to.equal('刷新后仍保留的需求')
      await wrapper.setProps({ identityEpoch: 2, identityScope: 'another-owner' })
      expect(wrapper.get('textarea').element.value).to.equal('')
    } finally { wrapper.unmount() }
  })
  const uploadWorkspace = () => ({ ...emptyWorkspace(), pendingWrites: Vue.ref([]), preview: Vue.ref({ kind: 'none' }),
    upload: async file => ({ operation: { state: 'COMMITTED' }, file: { fileId: file.name, displayName: file.name }, version: { fileId: file.name, version: '1', contentMimeType: 'text/plain' } }) })
  const selectFiles = async (wrapper, names) => {
    const input = wrapper.get('input[type=file]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: names.map(name => new File(['hello'], name, { type: 'text/plain' })) })
    await input.trigger('change'); await settle()
  }
  it('uploads multiple files, auto-selects receipt versions and permits attachment-only creation', async () => {
    const wrapper = mount(load({ execute: async () => response() }, uploadWorkspace()), { props, global: { stubs: { teleport: true } } })
    try {
      await settle(); await wrapper.get('.quick-material-open').trigger('click')
      await selectFiles(wrapper, ['a.txt', 'b.txt'])
      expect(wrapper.get('.quick-material-count').text()).to.include('已选 2')
      expect(wrapper.findAll('.quick-material-files button')).to.have.length(2)
      expect(wrapper.findAll('.quick-material-added')).to.have.length(2)
      expect(wrapper.get('.quick-material-selection-row').text()).to.include('上传资料')
      expect(wrapper.find('.quick-material-download').exists()).to.equal(false)
      expect(wrapper.find('.quick-material-upload-status').exists()).to.equal(false)
      await wrapper.get('.quick-material-confirm').trigger('click')
      expect(wrapper.get('button[type=submit]').element.disabled).to.equal(false)
      await wrapper.get('form').trigger('submit')
      expect(wrapper.emitted('quick-request')[0][0]).to.deep.equal({ request: '', materials: [{ fileId: 'a.txt', version: '1' }, { fileId: 'b.txt', version: '1' }] })
    } finally { wrapper.unmount() }
  })
  it('fences a late upload receipt after cancelling the picker', async () => {
    const workspace = uploadWorkspace(); let finish
    workspace.upload = () => new Promise(resolve => { finish = resolve })
    const wrapper = mount(loadMaterialPicker(workspace), { props: { identityScope: props.identityScope, modelValue: [] }, global: { stubs: { teleport: true } } })
    try {
      await wrapper.get('.quick-material-open').trigger('click')
      await selectFiles(wrapper, ['late.txt'])
      await wrapper.get('.quick-material-footer-actions button:first-child').trigger('click')
      finish({ operation: { state: 'COMMITTED' }, file: { fileId: 'late', displayName: 'late' }, version: { fileId: 'late', version: '1' } })
      await settle()
      expect(wrapper.emitted('update:modelValue')).to.equal(undefined)
      await wrapper.get('.quick-material-open').trigger('click')
      expect(wrapper.get('.quick-material-count').text()).to.include('已选 0')
    } finally { wrapper.unmount() }
  })
  it('retains existing selection on failed upload and retries only the original unknown write', async () => {
    const workspace = uploadWorkspace()
    workspace.upload = async () => { workspace.pendingWrites.value = [{ target: 'CREATE', state: 'UNKNOWN' }]; workspace.error.value = '结果未知'; return null }
    let retries = 0
    workspace.retryWrite = async target => { expect(target).to.equal('CREATE'); retries++; workspace.pendingWrites.value = []; return { operation: { state: 'COMMITTED' }, file: { fileId: 'new', displayName: '新资料' }, version: { fileId: 'new', version: '2' } } }
    const wrapper = mount(loadMaterialPicker(workspace), { props: { identityScope: props.identityScope, modelValue: [{ fileId: 'old', version: '1', displayName: '原资料' }] }, global: { stubs: { teleport: true } } })
    try {
      await wrapper.get('.quick-material-open').trigger('click'); await selectFiles(wrapper, ['new.txt'])
      expect(wrapper.get('.quick-material-count').text()).to.include('已选 1')
      expect(wrapper.get('input[type=file]').element.disabled).to.equal(true)
      await wrapper.findAll('button').find(b => b.text() === '核对原上传').trigger('click'); await settle()
      expect(retries).to.equal(1); expect(wrapper.get('.quick-material-count').text()).to.include('已选 2')
    } finally { wrapper.unmount() }
  })
})

describe('material picker screenshot feedback: directory, preview and layout contracts', () => {
  it('refreshes the real workspace directory once after a successful batch and deduplicates committed receipt rows', async () => {
    const rows = [], calls = []
    const version = file => ({ fileId: file.fileId, version: '1', originalFilename: file.displayName, contentMimeType: 'text/plain', byteLength: '5' })
    const workspace = usePersonalWorkspace({ identityEpoch: Vue.ref('owner-upload'), api: { execute: async options => {
      calls.push(options)
      if (options.url === '/personal-workspace/files' && options.method === 'POST') {
        const name = options.data.get('file').name
        const file = { fileId: `pws_${rows.length}`, displayName: name, mediaFamily: 'TEXT', state: 'ACTIVE', metadataRevision: '1', latestVersion: '1' }
        rows.unshift(file)
        return { operation: { operationId: `upload-${rows.length}`, state: 'COMMITTED' }, file, version: version(file) }
      }
      if (options.url === '/personal-workspace/files') return { items: [...rows], nextCursor: null, hasMore: false }
      if (options.url.endsWith('/preview')) return { state: 'READY', parts: [{ partId: 'text', contentMimeType: 'text/plain' }], partial: false }
      if (options.url.includes('/preview/parts/')) return new Blob(['hello'], { type: 'text/plain' })
      const file = rows.find(row => options.url.endsWith(row.fileId))
      return { file, latestVersion: version(file), versions: [version(file)] }
    } } })
    const wrapper = mount(loadMaterialPicker(workspace), { props: { identityScope: 'owner-upload' }, global: { stubs: { teleport: true } } })
    try {
      await wrapper.get('.quick-material-open').trigger('click'); await settle()
      const input = wrapper.get('input[type=file]')
      const files = ['first.txt', 'second.txt'].map(name => { const file = new Blob(['hello'], { type: 'text/plain' }); Object.defineProperty(file, 'name', { value: name }); return file })
      Object.defineProperty(input.element, 'files', { configurable: true, value: files })
      await input.trigger('change'); await settle()
      expect(calls.filter(call => call.url === '/personal-workspace/files' && call.method === 'GET')).to.have.length(2)
      expect(calls.filter(call => call.method === 'POST')).to.have.length(2)
      expect(workspace.items.value).to.have.length(2)
      expect(wrapper.findAll('.quick-material-files button')).to.have.length(2)
      expect(wrapper.findAll('.quick-material-added')).to.have.length(2)
      expect(wrapper.get('.quick-material-files .selected').text()).to.include('second.txt')
      expect(wrapper.get('.quick-material-version-actions .primary').element.disabled).to.equal(true)
      const children = [...wrapper.get('.quick-material-detail-pane').element.children]
      expect(children.indexOf(wrapper.get('.quick-material-version-actions').element)).to.be.greaterThan(children.indexOf(wrapper.get('.quick-material-preview').element))
    } finally { wrapper.unmount(); workspace.dispose() }
  })

  it('retains committed rows and selections when the post-upload directory refresh fails', async () => {
    let refreshes = 0
    const workspace = { ...emptyWorkspace(), pendingWrites: Vue.ref([]), refresh: async () => { refreshes++; if (refreshes > 1) { workspace.error.value = '目录暂不可用'; workspace.listState.value = 'error'; return false } return true },
      upload: async () => ({ operation: { state: 'COMMITTED' }, file: { fileId: 'new-file', displayName: 'new.txt' }, version: { fileId: 'new-file', version: '1' } }) }
    const wrapper = mount(loadMaterialPicker(workspace), { props: { identityScope: 'owner-upload' }, global: { stubs: { teleport: true } } })
    try {
      await wrapper.get('.quick-material-open').trigger('click')
      const input = wrapper.get('input[type=file]')
      Object.defineProperty(input.element, 'files', { value: [new File(['hello'], 'new.txt', { type: 'text/plain' })] })
      await input.trigger('change'); await settle()
      expect(refreshes).to.equal(2)
      expect(wrapper.get('.quick-material-files button').text()).to.include('new.txt')
      expect(wrapper.get('.quick-material-count').text()).to.include('已选 1')
    } finally { wrapper.unmount() }
  })

  it('opens a read-only standalone fixed-version preview without refreshing the chooser or altering selections, and closes on identity change', async () => {
    let refreshes = 0
    const workspace = { ...emptyWorkspace(), preview: Vue.ref({ kind: 'none' }), refresh: async () => { refreshes++; return true }, select: async fileId => {
      workspace.detail.value = { file: { fileId, displayName: 'fixed.txt', state: 'ACTIVE' }, latestVersion: { version: '2' }, versions: [{ version: '1' }, { version: '2' }] }; return workspace.detail.value
    }, previewVersion: async v => { expect(v).to.equal('1'); workspace.preview.value = { kind: 'text', text: '固定版本原文' } }, revokePreview: () => { workspace.preview.value = { kind: 'none' } } }
    const materials = [{ fileId: 'fixed', version: '1', displayName: 'fixed.txt' }]
    const wrapper = mount(loadMaterialPicker(workspace), { props: { identityScope: 'owner-a', modelValue: materials }, global: { stubs: { teleport: true } } })
    try {
      await wrapper.get('.quick-material-summary button').trigger('click'); await settle()
      expect(refreshes).to.equal(0)
      expect(wrapper.find('.quick-material-picker').exists()).to.equal(false)
      expect(wrapper.get('.quick-material-standalone pre').text()).to.equal('固定版本原文')
      expect(wrapper.get('.quick-material-close').attributes('aria-label')).to.equal('关闭预览')
      expect(wrapper.emitted('update:modelValue')).to.equal(undefined)
      await wrapper.get('.quick-material-standalone').trigger('cancel'); await settle()
      expect(wrapper.find('.quick-material-standalone').exists()).to.equal(false)
      expect(wrapper.emitted('update:modelValue')).to.equal(undefined)
      await wrapper.get('.quick-material-summary button').trigger('click'); await settle()
      await wrapper.setProps({ identityScope: 'owner-b' }); await settle()
      expect(wrapper.find('.quick-material-standalone').exists()).to.equal(false)
      expect(workspace.preview.value.kind).to.equal('none')
    } finally { wrapper.unmount() }
  })
})
