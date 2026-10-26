import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount, flushPromises } from '@vue/test-utils'
import { completedReviewRecords, exactReviewOutput } from '../src/composables/juyiting/completedReviewRecords.js'
const file = new URL('../src/components/juyiting/HallCompletedRecords.vue', import.meta.url)
const script = compileScript(parse(readFileSync(file, 'utf8'), { filename: file.pathname }).descriptor, { id: 'completed-records-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
  .replace(/^import OutputPreview from[^\n]+/m, 'var OutputPreview = deps.OutputPreview')
  .replace('export default', 'return')
const item = (id, version = '1') => ({ artifactId: id, artifactVersion: version, contentHash: id.repeat(64).slice(0, 64), purpose: 'result', displayRole: 'RESULT', unavailableReason: null })
const batch = (id, state, items) => ({ deliveryId: id, deliveryVersion: '1', state, summary: '本轮议事成果', items, allowedActions: [] })
const context = () => ({ taskId: 'task-1', taskVersion: '8', taskState: 'COMPLETED', currentDelivery: batch('current', 'ACCEPTED', [item('a', '2'), item('b')]), history: [batch('old', 'CHANGES_REQUESTED', [item('a')])], pendingOperation: null })
const output = item => ({ ...item, sha256: item.contentHash, title: `${item.artifactId}.png`, canPreview: true })
function harness (props = {}, initialOutputs) {
  const c = context(); let refreshes = 0, more = 0
  const outputs = { items: Vue.ref(initialOutputs ?? [...c.currentDelivery.items, ...c.history[0].items].map(output)), loading: Vue.ref(false), nextCursor: Vue.ref(null), cacheKey: Vue.ref('owner:task-1'), state: Vue.ref('available'), message: Vue.ref(''), refresh: async () => { refreshes++ }, loadMore: async () => { more++; outputs.nextCursor.value = null }, preview: async () => {} }
  const Component = new Function('Vue', 'deps', script)(Vue, { completedReviewRecords, exactReviewOutput, useOutputs: () => outputs,
    OutputPreview: Vue.defineComponent({ props: ['item'], template: '<div class="actual-preview">{{ item.artifactId }}:{{ item.artifactVersion }}</div>' }) })
  const wrapper = mount(Component, { props: { taskId: 'task-1', taskVersion: '8', identityKey: 'owner', title: '已完成事项', context: c, ...props } })
  return { wrapper, outputs, refreshes: () => refreshes, more: () => more }
}
describe('completed matter records display over fixed acceptance facts', () => {
  it('does not infer acceptance from COMPLETED or from newest/current output; excludes manifests', () => {
    const c = context(); c.currentDelivery.state = 'SUBMITTED'; c.currentDelivery.items.push({ ...item('m'), displayRole: 'MANIFEST' })
    expect(completedReviewRecords(c, 'task-1').accepted).to.have.length(0)
    expect(completedReviewRecords(c, 'task-1').history).to.have.length(3)
    expect(completedReviewRecords(c, 'task-1').complete).to.equal(false)
    expect(completedReviewRecords(context(), 'other').accepted).to.have.length(0)
    c.taskState = 'REVIEWING'; expect(completedReviewRecords(c, 'task-1').history).to.have.length(0)
  })
  it('does not repeat an accepted exact version in other history while retaining a distinct prior version', () => {
    const c = context(); c.history[0].items.push(item('a', '2'))
    const result = completedReviewRecords(c, 'task-1')
    expect(result.accepted).to.have.length(2); expect(result.history).to.have.length(1); expect(result.history[0].item.artifactVersion).to.equal('1')
  })
  it('retains historical ACCEPTED facts without inventing acceptance times or actors', () => {
    const c = context(); c.history[0].state = 'ACCEPTED'
    const r = completedReviewRecords(c, 'task-1'); expect(r.accepted).to.have.length(3); expect(r.history).to.have.length(0)
    expect(r.acceptedBatches[0]).not.to.have.property('acceptedAt')
  })
  it('normal view has no history-navigation, refresh, download or acceptance action; fixed rows identify versions', async () => {
    const { wrapper } = harness()
    try {
      expect(wrapper.findAll('.completed-result')).to.have.length(3)
      expect(wrapper.findAll('button').map(b => b.text())).to.deep.equal(['预览', '预览', '预览'])
      expect(wrapper.text()).to.include('已验收成果（2）').and.include('其他历史成果（1）').and.include('版本 2')
      expect(wrapper.get('.completed-history').element.open).to.equal(false)
      expect(wrapper.get('.completed-receipt').element.open).to.equal(false)
      expect(wrapper.emitted()).to.deep.equal({})
    } finally { wrapper.unmount() }
  })
  it('expands only the corresponding row, switches, collapses, and resets on identity/context change', async () => {
    const { wrapper } = harness()
    try {
      await wrapper.findAll('.completed-result button')[0].trigger('click')
      expect(wrapper.findAll('.completed-inline-preview')).to.have.length(1)
      expect(wrapper.findAll('.completed-result')[0].text()).to.include('a:2')
      await wrapper.findAll('.completed-result-heading button')[1].trigger('click')
      expect(wrapper.findAll('.completed-inline-preview')).to.have.length(1)
      expect(wrapper.findAll('.completed-result')[1].text()).to.include('b:1')
      await wrapper.findAll('.completed-result-heading button')[1].trigger('click')
      expect(wrapper.find('.completed-inline-preview').exists()).to.equal(false)
      await wrapper.findAll('.completed-result-heading button')[2].trigger('click')
      expect(wrapper.get('.completed-history').element.open).to.equal(true)
      await wrapper.setProps({ identityKey: 'other' }); expect(wrapper.find('.completed-inline-preview').exists()).to.equal(false)
      await wrapper.setProps({ context: { ...context(), taskId: 'foreign' } }); expect(wrapper.findAll('.completed-result')).to.have.length(0)
    } finally { wrapper.unmount() }
  })
  it('failed/absent context offers only explicit read recovery and loading prevents repeat controls', async () => {
    const { wrapper } = harness({ context: null, error: 'network' })
    try {
      expect(wrapper.findAll('button').map(b => b.text())).to.deep.equal(['重试'])
      await wrapper.get('button').trigger('click'); expect(wrapper.emitted('refresh')).to.have.length(1)
      await wrapper.setProps({ loading: true }); expect(wrapper.findAll('button')).to.have.length(0)
      await wrapper.setProps({ loading: false, error: '' }); expect(wrapper.get('button').text()).to.equal('重新核对')
      expect(wrapper.emitted('review-delivery')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })
  it('unavailable source keeps the accepted record without preview or substitute', () => {
    const c = context(); c.currentDelivery.items[0].unavailableReason = 'SOURCE_UNAVAILABLE'
    const { wrapper } = harness({ context: c })
    try { expect(wrapper.findAll('.completed-result button')[0].element.disabled).to.equal(true); expect(wrapper.text()).to.include('验收记录仍保留') }
    finally { wrapper.unmount() }
  })
  it('ignores wrong digest/version metadata and never places it in a preview; late catalogue updates follow the expanded row', async () => {
    const { wrapper, outputs } = harness({}, [{ ...output(item('a', '2')), sha256: 'wrong', title: 'foreign.png' }])
    try {
      expect(wrapper.text()).not.to.include('foreign.png')
      await wrapper.findAll('.completed-result-heading button')[0].trigger('click'); expect(wrapper.find('.actual-preview').exists()).to.equal(false)
      await wrapper.findAll('.completed-result-heading button')[1].trigger('click')
      outputs.items.value = [output(item('a', '2'))]; await flushPromises(); expect(wrapper.find('.actual-preview').exists()).to.equal(false)
      outputs.items.value.push(output(item('b'))); await flushPromises(); expect(wrapper.get('.actual-preview').text()).to.equal('b:1')
    } finally { wrapper.unmount() }
  })
  it('reads remaining existing catalogue pages for missing metadata without replaying commands', async () => {
    const { wrapper, outputs, more } = harness({}, [])
    try {
      outputs.nextCursor.value = 'page-2'; await flushPromises(); expect(more()).to.equal(1)
      outputs.nextCursor.value = 'page-2'; await flushPromises(); expect(more()).to.equal(1)
      await wrapper.findAll('.completed-result-heading button')[0].trigger('click')
      await wrapper.findAll('button').find(b => b.text() === '重试预览').trigger('click')
      outputs.nextCursor.value = null; await flushPromises(); outputs.nextCursor.value = 'page-2'; await flushPromises()
      expect(more()).to.equal(2)
    }
    finally { wrapper.unmount() }
  })
})

describe('completed detail shell confirmation and original read-only navigation', () => {
  const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
  const archiveCode = hall.slice(hall.indexOf('const archiveTask = async'), hall.indexOf('const cancelFunding ='))
  const archiveHarness = dialog => {
    const task = { id: 'task-1', status: 'completed', taskVersion: '8' }, selectedTask = Vue.ref(task), store = { authorizationGeneration: 1 }
    const pending = Vue.ref(false), calls = []
    const archive = new Function('archiveConfirmationPending', 'apiStore', 'hallIdentityScope', 'selectedTask', 'Dialog', 'runArchiveTask', 'markTaskArchived', `${archiveCode};return archiveTask`)(pending, store, Vue.ref('owner'), selectedTask, dialog, async t => { calls.push(t) }, () => {})
    return { task, selectedTask, store, pending, calls, archive }
  }
  it('cancel never archives; confirm uses the original task once', async () => {
    const cancelled = archiveHarness(async () => 'cancel'); await cancelled.archive(cancelled.task); expect(cancelled.calls).to.have.length(0)
    const confirmed = archiveHarness(async () => 'confirm'); await confirmed.archive(confirmed.task); expect(confirmed.calls).to.deep.equal([confirmed.task])
  })
  it('identity/task/version switch while confirming discards the old intent, with no parallel dialogs', async () => {
    for (const change of [h => { h.store.authorizationGeneration++ }, h => { h.selectedTask.value = { ...h.task, id: 'other' } }, h => { h.selectedTask.value = { ...h.task, taskVersion: '9' } }]) {
      let resolve; const h = archiveHarness(() => new Promise(r => { resolve = r })); const pending = h.archive(h.task)
      expect(await h.archive(h.task)).to.equal(false); change(h); resolve('confirm'); await pending
      expect(h.calls).to.have.length(0); expect(h.pending.value).to.equal(false)
    }
  })
  it('completed detail uses the original read-only navigation, not the write-capable discuss handler', () => {
    const panel = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    expect(panel).to.include("$emit('view-discussion-history', detailTask)")
    expect(hall).to.include('@view-discussion-history="continueBountyModification($event)"')
    expect(hall).to.include("formalTaskRef.value.status !== 'completed'")
  })
})
