import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { artifactRegistrationRequest, confirmedArtifactRegistration } from '../src/composables/juyiting/taskArtifactRegistration.js'
import { outputCatalogItems } from '../src/composables/juyiting/bountyOutputCatalog.js'
import { mount, flushPromises } from '@vue/test-utils'
import { completedReviewRecords, exactReviewOutput, completedRecordTitle } from '../src/composables/juyiting/completedReviewRecords.js'
const file = new URL('../src/components/juyiting/HallCompletedRecords.vue', import.meta.url)
const script = compileScript(parse(readFileSync(file, 'utf8'), { filename: file.pathname }).descriptor, { id: 'completed-records-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
  .replace(/^import OutputPreview from[^\n]+/m, 'var OutputPreview = deps.OutputPreview')
  .replace('export default', 'return')
const item = (id, version = '1') => ({ artifactId: id, artifactVersion: version, contentHash: id.repeat(64).slice(0, 64), purpose: 'result', displayRole: 'RESULT', unavailableReason: null })
const batch = (id, state, items) => ({ deliveryId: id, deliveryVersion: '1', state, summary: '本轮议事成果', items, allowedActions: [] })
const context = () => ({ taskId: 'task-1', taskVersion: '8', taskState: 'COMPLETED', currentDelivery: batch('current', 'ACCEPTED', [item('a', '2'), item('b')]), history: [batch('old', 'CHANGES_REQUESTED', [item('a')])], pendingOperation: null })
const output = item => ({ ...item, sha256: item.contentHash, title: `${item.artifactId}.png`, canPreview: true, canDownload: true, mimeType: 'image/png' })
function harness (props = {}, initialOutputs, get = async () => [], actions = {}) {
  const c = context(); let refreshes = 0, more = 0
  const outputs = { items: Vue.ref(initialOutputs ?? [...c.currentDelivery.items, ...c.history[0].items].map(output)), loading: Vue.ref(false), nextCursor: Vue.ref(null), cacheKey: Vue.ref('owner:task-1'), state: Vue.ref('available'), message: Vue.ref(''), refresh: async () => { refreshes++ }, loadMore: async () => { more++; outputs.nextCursor.value = null }, preview: async () => {}, download: actions.download || (async () => new Blob(['fixed'], { type: 'image/png' })) }
  const registered = [], downloaded = []
  const receipt = data => ({ operation: { state: 'COMMITTED', fileId: 'pws_test', fileVersion: '1' }, file: { fileId: 'pws_test', originKind: 'AGENT_DELIVERY', state: 'ACTIVE' }, version: { fileId: 'pws_test', version: '1', sha256: data.contentSha256 } })
  const post = async (path, data, options) => { registered.push({ path, data, options }); return actions.register ? actions.register(data) : receipt(data) }
  const Component = new Function('Vue', 'deps', script)(Vue, { completedReviewRecords, exactReviewOutput, completedRecordTitle, outputCatalogItems, createApi: base => base === '/agent' ? { post } : { get }, useOutputs: () => outputs, artifactRegistrationRequest, confirmedArtifactRegistration,
    safeOutputFilename: item => item.title, saveOutputBlob: async args => { downloaded.push(args) },
    OutputPreview: Vue.defineComponent({ props: ['item'], template: '<div class="actual-preview">{{ item.artifactId }}:{{ item.artifactVersion }}</div>' }) })
  const wrapper = mount(Component, { props: { taskId: 'task-1', taskVersion: '8', identityKey: 'owner', title: '已完成事项', context: c, ...props } })
  return { wrapper, outputs, registered, downloaded, refreshes: () => refreshes, more: () => more }
}
describe('completed matter records display over fixed acceptance facts', () => {
  it('labels historical files only from the exact source and hash, without changing acceptance records', () => {
    const fixed = item('a'); fixed.source = { kind: 'CONVERSATION_OUTPUT', requestId: 'request-1', stepId: 'step-1', outputId: 'output_1' }
    const row = { item: fixed }; const metadata = [{ ...output(fixed), title: 'output_1' }]
    const original = { requestId: 'request-1', stepId: 'step-1', outputId: 'output_1', sha256: fixed.contentHash, filename: 'roles.txt' }
    const before = JSON.stringify(row)
    expect(completedRecordTitle(row, 0, metadata, [original])).to.equal('roles.txt')
    for (const change of [{ requestId: 'other' }, { stepId: 'other' }, { outputId: 'other' }, { sha256: 'b'.repeat(64) }]) {
      expect(completedRecordTitle(row, 0, metadata, [{ ...original, ...change }])).to.equal('成果 1')
    }
    expect(completedRecordTitle(row, 0, metadata, [])).to.equal('成果 1')
    // Live archived task: the old stored filename itself is the technical output ID.
    expect(completedRecordTitle(row, 0, metadata, [{ ...original, filename: original.outputId }])).to.equal('成果 1')
    expect(completedRecordTitle(row, 1, metadata, [{ ...original, filename: ` ${original.outputId} ` }])).to.equal('成果 2')
    expect(JSON.stringify(row)).to.equal(before)
  })
  it('loads original names once per source step and discards late labels after identity change', async () => {
    const c = context()
    c.currentDelivery.items.forEach((item, i) => { item.source = { kind: 'CONVERSATION_OUTPUT', requestId: 'request-1', stepId: 'step-1', outputId: `output_${i}` } })
    const calls = []
    const { wrapper } = harness({ context: c }, [], (url, params, options) => new Promise(resolve => { calls.push({ url, options, resolve }) }))
    const catalogue = name => c.currentDelivery.items.map((item, i) => ({ outputId: `output_${i}`, filename: `${name}-${i}.txt`, contentMimeType: 'text/plain', sha256: item.contentHash, byteLength: '1', previewUrl: `/chat/requests/request-1/steps/step-1/outputs/output_${i}`, downloadUrl: `/chat/requests/request-1/steps/step-1/outputs/output_${i}?download=true` }))
    try {
      expect(calls).to.have.length(1)
      await wrapper.setProps({ identityKey: 'other' })
      expect(calls).to.have.length(2)
      expect(calls[0].options.signal.aborted).to.equal(true)
      calls[0].resolve(catalogue('old-owner')); await flushPromises()
      expect(wrapper.text()).not.to.include('old-owner')
      calls[1].resolve(catalogue('current-owner')); await flushPromises()
      expect(wrapper.text()).to.include('current-owner-0.txt').and.include('current-owner-1.txt')
      expect(wrapper.text()).to.include('已验收成果（2）')
    } finally { wrapper.unmount() }
    expect(calls[1].options.signal.aborted).to.equal(true)
  })
  it('failed source-name lookup retains accepted records and formal previews', async () => {
    const c = context(); c.currentDelivery.items[0].source = { kind: 'CONVERSATION_OUTPUT', requestId: 'request-1', stepId: 'step-1', outputId: 'output_0' }
    const { wrapper } = harness({ context: c }, undefined, async () => { throw new Error('unavailable') })
    try {
      await flushPromises()
      expect(wrapper.text()).to.include('已验收成果（2）').and.include('a.png')
      await wrapper.findAll('.completed-result-heading button[aria-expanded]')[0].trigger('click')
      expect(wrapper.get('.actual-preview').text()).to.equal('a:2')
    } finally { wrapper.unmount() }
  })
  it('does not infer acceptance from COMPLETED or from newest/current output; excludes manifests', () => {
    const c = context(); c.currentDelivery.state = 'SUBMITTED'; c.currentDelivery.items.push({ ...item('m'), displayRole: 'MANIFEST' })
    expect(completedReviewRecords(c, 'task-1').accepted).to.have.length(0)
    expect(completedReviewRecords(c, 'task-1').history).to.have.length(3)
    expect(completedReviewRecords(c, 'task-1').complete).to.equal(false)
    expect(completedReviewRecords(context(), 'other').accepted).to.have.length(0)
    c.taskState = 'REVIEWING'; expect(completedReviewRecords(c, 'task-1').history).to.have.length(0)
  })
  it('archived matter keeps exact accepted history read-only, never treating archive itself as acceptance', () => {
    const c = context(); c.taskState = 'ARCHIVED'; c.history.unshift(c.currentDelivery); c.currentDelivery = null
    const r = completedReviewRecords(c, 'task-1')
    expect(r.accepted).to.have.length(2); expect(r.complete).to.equal(true)
    const { wrapper } = harness({ context: c, archived: true })
    expect(wrapper.text()).to.include('已归档 · 只读')
    expect(wrapper.text()).not.to.include('继续议事'); expect(wrapper.text()).not.to.include('验收此版')
    expect(readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')).to.include("['completed', 'archived'].includes(formalTaskRef?.status)")
    c.history.forEach(batch => { batch.state = 'SUBMITTED' })
    expect(completedReviewRecords(c, 'task-1').accepted).to.have.length(0)
    expect(completedReviewRecords(c, 'task-1').complete).to.equal(false)
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
  it('normal view offers fixed-version preview, download and library actions without acceptance mutation', async () => {
    const { wrapper } = harness()
    try {
      expect(wrapper.findAll('.completed-result')).to.have.length(3)
      expect(wrapper.findAll('button').map(b => b.text())).to.deep.equal(Array(3).fill(['预览', '下载', '保存']).flat())
      expect(wrapper.text()).to.include('已验收成果（2）').and.include('其他历史成果（1）').and.include('版本 2')
      expect(wrapper.get('.completed-history').element.open).to.equal(false)
      expect(wrapper.get('.completed-receipt').element.open).to.equal(false)
      expect(wrapper.emitted()).to.deep.equal({})
    } finally { wrapper.unmount() }
  })
  it('expands only the corresponding row, switches, collapses, and resets on identity/context change', async () => {
    const { wrapper } = harness()
    try {
      await wrapper.findAll('.completed-result button[aria-expanded]')[0].trigger('click')
      expect(wrapper.findAll('.completed-inline-preview')).to.have.length(1)
      expect(wrapper.findAll('.completed-result')[0].text()).to.include('a:2')
      await wrapper.findAll('.completed-result-heading button[aria-expanded]')[1].trigger('click')
      expect(wrapper.findAll('.completed-inline-preview')).to.have.length(1)
      expect(wrapper.findAll('.completed-result')[1].text()).to.include('b:1')
      await wrapper.findAll('.completed-result-heading button[aria-expanded]')[1].trigger('click')
      expect(wrapper.find('.completed-inline-preview').exists()).to.equal(false)
      await wrapper.findAll('.completed-result-heading button[aria-expanded]')[2].trigger('click')
      expect(wrapper.get('.completed-history').element.open).to.equal(true)
      await wrapper.setProps({ identityKey: 'other' }); expect(wrapper.find('.completed-inline-preview').exists()).to.equal(false)
      await wrapper.setProps({ context: { ...context(), taskId: 'foreign' } }); expect(wrapper.findAll('.completed-result')).to.have.length(0)
    } finally { wrapper.unmount() }
  })
  it('downloads accepted and history exact versions using the shared download handoff', async () => {
    const reads = []
    const { wrapper, downloaded } = harness({}, undefined, undefined, { download: async item => { reads.push(item); return new Blob(['fixed']) } })
    try {
      for (const row of wrapper.findAll('.completed-result')) { await row.findAll('button')[1].trigger('click'); await flushPromises() }
      expect(reads.map(item => [item.artifactId, item.artifactVersion])).to.deep.equal([['a', '2'], ['b', '1'], ['a', '1']])
      expect(downloaded).to.have.length(3)
      expect(downloaded[0].item.title).to.equal('a.png')
      expect(wrapper.emitted('review-delivery')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })
  it('registers the exact source without downloading/uploading bytes; committed receipt disables repeat save', async () => {
    let complete
    const h = harness({}, undefined, undefined, { register: () => new Promise(resolve => { complete = resolve }) })
    try {
      const save = h.wrapper.findAll('.completed-result')[0].findAll('button')[2]
      await save.trigger('click'); await new Promise(resolve => setTimeout(resolve, 10)); await flushPromises()
      expect(save.text()).to.equal('保存中…'); expect(save.element.disabled).to.equal(true)
      expect(h.registered).to.have.length(1)
      const r = h.registered[0]
      expect(r.path).to.equal('/personal-workspace/task-artifact-registrations')
      expect(r.data).to.deep.equal({ taskId: 'task-1', artifactId: 'a', artifactVersion: '2', contentSha256: 'a'.repeat(64), filename: 'a.png' })
      expect(r.options.headers['Idempotency-Key']).to.match(/^task-artifact-[0-9a-f]{64}$/)
      complete({ operation: { state: 'COMMITTED', fileId: 'pws_test', fileVersion: '1' }, file: { fileId: 'pws_test', originKind: 'AGENT_DELIVERY', state: 'ACTIVE' }, version: { fileId: 'pws_test', version: '1', sha256: 'a'.repeat(64) } }); await flushPromises()
      expect(save.text()).to.equal('已保存'); expect(save.element.disabled).to.equal(true)
      expect(h.downloaded).to.have.length(0)
    } finally { h.wrapper.unmount() }
  })
  it('unknown save replays the immutable registration and key only after explicit retry', async () => {
    let attempts = 0
    const h = harness({}, undefined, undefined, { register: () => { attempts++; throw new Error('network') } })
    try {
      const save = h.wrapper.findAll('.completed-result')[0].findAll('button')[2]
      await save.trigger('click'); await new Promise(resolve => setTimeout(resolve, 10)); await flushPromises()
      expect(save.text()).to.equal('核对保存结果'); expect(attempts).to.equal(1)
      await save.trigger('click'); await flushPromises(); expect(attempts).to.equal(2)
      expect(h.registered[0].data).to.equal(h.registered[1].data)
      expect(h.registered[0].options.headers).to.deep.equal(h.registered[1].options.headers)
      expect(h.downloaded).to.have.length(0)
    } finally { h.wrapper.unmount() }
  })
  it('download errors are visible and a user can retry without changing fixed facts', async () => {
    let attempts = 0
    const { wrapper, downloaded } = harness({}, undefined, undefined, { download: async () => { if (++attempts === 1) throw new Error('下载失败'); return new Blob(['ok']) } })
    try {
      const download = wrapper.findAll('.completed-result')[0].findAll('button')[1]
      await download.trigger('click'); await flushPromises(); expect(wrapper.text()).to.include('下载失败'); expect(downloaded).to.have.length(0)
      await download.trigger('click'); await flushPromises(); expect(downloaded).to.have.length(1)
    } finally { wrapper.unmount() }
  })
  it('scope change or unmount discards late downloads before save/upload side effects', async () => {
    for (const change of [async w => w.setProps({ identityKey: 'other' }), async w => w.setProps({ taskId: 'other' }), async w => w.unmount()]) {
      let complete, signal
      const h = harness({}, undefined, undefined, { download: () => new Promise(resolve => { complete = resolve }) })
      // Capture the production controller passed into the read adapter.
      const read = h.outputs.download; h.outputs.download = (item, options) => { signal = options.signal; return read(item) }
      await h.wrapper.findAll('.completed-result')[0].findAll('button')[1].trigger('click')
      await change(h.wrapper); complete(new Blob(['fixed'])); await flushPromises()
      expect(signal.aborted).to.equal(true); expect(h.registered).to.have.length(0); expect(h.downloaded).to.have.length(0)
      h.wrapper.unmount()
    }
  })
  it('missing or mismatched fixed metadata never enables transfer of another version', () => {
    const { wrapper } = harness({}, [{ ...output(item('a', '2')), sha256: 'wrong' }])
    try { expect(wrapper.findAll('.completed-result-actions button').filter(b => !b.attributes('aria-controls')).every(b => b.element.disabled)).to.equal(true) }
    finally { wrapper.unmount() }
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
    try { expect(wrapper.findAll('.completed-result button[aria-expanded]')[0].element.disabled).to.equal(true); expect(wrapper.text()).to.include('验收记录仍保留') }
    finally { wrapper.unmount() }
  })
  it('ignores wrong digest/version metadata and never places it in a preview; late catalogue updates follow the expanded row', async () => {
    const { wrapper, outputs } = harness({}, [{ ...output(item('a', '2')), sha256: 'wrong', title: 'foreign.png' }])
    try {
      expect(wrapper.text()).not.to.include('foreign.png')
      await wrapper.findAll('.completed-result-heading button[aria-expanded]')[0].trigger('click'); expect(wrapper.find('.actual-preview').exists()).to.equal(false)
      await wrapper.findAll('.completed-result-heading button[aria-expanded]')[1].trigger('click')
      outputs.items.value = [output(item('a', '2'))]; await flushPromises(); expect(wrapper.find('.actual-preview').exists()).to.equal(false)
      outputs.items.value.push(output(item('b'))); await flushPromises(); expect(wrapper.get('.actual-preview').text()).to.equal('b:1')
    } finally { wrapper.unmount() }
  })
  it('reads remaining existing catalogue pages for missing metadata without replaying commands', async () => {
    const { wrapper, outputs, more } = harness({}, [])
    try {
      outputs.nextCursor.value = 'page-2'; await flushPromises(); expect(more()).to.equal(1)
      outputs.nextCursor.value = 'page-2'; await flushPromises(); expect(more()).to.equal(1)
      await wrapper.findAll('.completed-result-heading button[aria-expanded]')[0].trigger('click')
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
    expect(hall).to.include("!['completed', 'archived'].includes(formalTaskRef.value.status)")
  })
})
