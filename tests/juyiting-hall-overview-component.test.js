import { expect } from 'chai'
import { describe, it } from 'mocha'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount, flushPromises } from '@vue/test-utils'
import { canOpenHallItem, HALL_SOURCES, useHallOverview } from '../src/composables/juyiting/useHallOverview.js'

for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) {
  if (!globalThis[name]) Object.defineProperty(globalThis, name, { value: globalThis.window[name], configurable: true })
}
const load = api => {
  const filename = new URL('../src/components/juyiting/HallOverview.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const code = compileScript(descriptor, { id: 'hall-overview-mount', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]@\/composables\/juyiting\/useHallOverview['"];?\s*$/gm, 'var { canOpenHallItem, HALL_SOURCES, useHallOverview } = deps')
    .replace('export default', 'return')
  return new Function('Vue', 'deps', code)(Vue, { canOpenHallItem, HALL_SOURCES, useHallOverview: options => useHallOverview({ ...options, api }) })
}
const summary = (sourceType, sourceId, nextAction) => ({ ref: { sourceType, sourceId }, title: sourceId,
  status: { code: 'QUEUED', evidenceSource: 'PERSISTED', observedAt: 100 }, targetAgent: null, nextAction, allowedActions: [nextAction], updatedAt: 100 })
const response = () => {
  const partitions = {
    private: { items: [summary('PRIVATE_CASE', 'case-a', 'OPEN_CASE'), summary('LEGACY_EXECUTION', 'exec-a', 'OPEN_EXECUTION')], status: 'partial', nextCursor: null, count: null, errorCode: 'VIEWED_RESULT_NOT_TRACKED' },
    task: { items: [summary('TASK', 'task-a', 'OPEN_TASK')], status: 'partial', nextCursor: null, count: null, errorCode: 'TASK_REVIEW_NOT_PROJECTED' },
    draft: { items: [summary('DRAFT', 'draft-a', 'EDIT_DRAFT')], status: 'complete', nextCursor: null, count: null, errorCode: null }
  }
  const statuses = Object.fromEntries(Object.entries(partitions).map(([key, value]) => [key, { status: value.status, errorCode: value.errorCode }]))
  return { schemaVersion: 1, sections: { recent: { status: 'partial', partitions }, needsAction: { status: 'partial', partitions } }, sourceStatus: { recent: statuses, needsAction: statuses }, asOf: 100 }
}
const settle = async () => { await flushPromises(); await Vue.nextTick() }
const props = { enabled: true, identityScope: 'tenant\u0000client\u0000owner-a', identityEpoch: 1 }

describe('JYT-UX-W05 mounted overview and message projection', () => {
  it('shows only needsAction in messages, explains partial sources, and emits exact read refs', async () => {
    const calls = []
    const wrapper = mount(load({ execute: async options => { calls.push(options); return response() } }), { props: { ...props, messagesOnly: true } })
    try {
      await settle()
      expect(wrapper.findAll('.overview-section')).to.have.length(1)
      expect(wrapper.text()).not.to.include('最近事项')
      expect(wrapper.text()).to.include('打开或查看不代表已读、验收或归档')
      expect(wrapper.text()).to.include('正式成果的待验收情况尚未完整纳入')
      expect(wrapper.findAll('.overview-empty')).to.have.length(0)
      await wrapper.findAll('button').find(button => button.text() === '查看事项').trigger('click')
      await wrapper.findAll('button').find(button => button.text() === '查看原交办').trigger('click')
      await wrapper.findAll('button').find(button => button.text() === '继续草稿').trigger('click')
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
      expect(wrapper.findAll('.overview-section')).to.have.length(2)
      const create = wrapper.findAll('button').find(button => button.text() === '提出需求')
      expect(create.element.compareDocumentPosition(wrapper.find('.overview-sections').element) & Node.DOCUMENT_POSITION_FOLLOWING).not.to.equal(0)
      await create.trigger('click')
      expect(wrapper.emitted('start-draft')).to.have.length(1)
      expect(calls.map(call => [call.method, call.url])).to.deep.equal([['GET', '/hall/overview']])
    } finally { wrapper.unmount() }
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
      expect(wrapper.findAll('button').some(button => button.text() === '继续草稿')).to.equal(false)
      await wrapper.findAll('button').find(button => button.text() === '打开原悬赏').trigger('click')
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
        personalMark: kind === 'private' ? { revision: 1, archived: true, viewedResultRef: null } : null }
      const part = { items: [archived], status: 'complete', nextCursor: null, count: null, errorCode: null }
      return { schemaVersion: 1, kind, view: 'archive', q: '', section: { status: 'complete', partitions: { [kind]: part } }, sourceStatus: { [kind]: { status: 'complete', errorCode: null } }, asOf: 100 }
    } }), { props })
    try {
      await settle()
      await wrapper.findAll('button').find(button => button.text() === '案卷（私人 / 正式）').trigger('click')
      await settle()
      expect(wrapper.findAll('.overview-source').map(part => part.attributes('data-source'))).to.deep.equal(['private', 'task'])
      expect(calls.slice(1).map(call => call.params)).to.deep.equal([
        { kind: 'private', view: 'archive', q: '' }, { kind: 'task', view: 'archive', q: '' }
      ])
      expect(wrapper.text()).to.include('已收入案卷（个人整理）')
      expect(wrapper.text()).not.to.include('未交办草稿')
      expect(wrapper.findAll('[data-count]')).to.have.length(0)
    } finally { wrapper.unmount() }
  })

  it('routes review evidence to the exact canonical formal task and delivery without an acceptance or private mark call', async () => {
    const review = { code: 'FORMAL_DELIVERY_SUBMITTED', deliveryId: 'delivery-1', workItemId: 'work-1', deliveryVersion: '0', taskVersion: '9007199254740993' }
    const calls = []
    const task = { id: 'task-a', status: 'assigned', title: '原正式任务' }
    const wrapper = mount(load({ execute: async options => {
      calls.push(options)
      if (options.url === '/tasks/task-a') return task
      const data = response()
      data.sections.needsAction.partitions.task.items[0].review = review
      return data
    } }), { props: { ...props, messagesOnly: true } })
    try {
      await settle()
      expect(wrapper.text()).to.include('正式交付待验收')
      await wrapper.findAll('button').find(button => button.text() === '查看待验收交付').trigger('click')
      await settle()
      expect(wrapper.emitted('open-task')[0]).to.deep.equal([task, review])
      expect(calls.map(call => call.method)).to.deep.equal(['GET', 'GET'])
      expect(calls.some(call => call.url.endsWith('/mark'))).to.equal(false)
    } finally { wrapper.unmount() }
  })

})
