import { expect } from 'chai'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { selectedOutput, batchMatchesSelection, selectionKey } from '../src/composables/juyiting/hallSelectedOutputs.js'
import { useHallSelectedOutputReview } from '../src/composables/juyiting/useHallSelectedOutputReview.js'
const item = n => ({ requestId: `request-${n}`, stepId: 'step-1', outputId: 'output-1', sha256: String(n).repeat(64), title: `第${n}稿`, contentMimeType: 'image/png' })
const batch = items => ({ deliveryId: 'delivery-1', items: items.map(value => ({ displayRole: 'RESULT', contentHash: value.sha256,
  source: { kind: 'CONVERSATION_OUTPUT', requestId: value.requestId, stepId: value.stepId, outputId: value.outputId }, unavailableReason: null })) })
const setup = (options = {}) => {
  const candidates = ref([item(1), item(2), item(3)]); const identity = ref('owner-1'); const calls = []; let body; let accepts = 0
  const context = ref({ taskId: 'task-1', taskVersion: '9', assignmentRevision: '3', taskState: 'ASSIGNED', currentDelivery: options.batch || null })
  const review = { context, error: ref(''), operation: ref({}), refresh: async () => context.value,
    openConfirmation: async expected => { calls.push({ kind: 'open', expected }); return options.mismatch ? false : true },
    confirmAcceptance: async () => { accepts++; return { state: 'COMMITTED' } }, close: () => {} }
  const receipt = () => ({ operationId: 'finalization-1', taskId: 'task-1', conversationId: 'conversation-1', state: 'COMPLETED', stateVersion: '3', stage: 'SUBMITTED',
    expectedTaskVersion: body.expectedTaskVersion, expectedAssignmentRevision: body.expectedAssignmentRevision, selectedOutputs: body.selectedOutputs,
    deliveryId: 'delivery-1', deliveryState: 'SUBMITTED', taskState: 'REVIEWING', taskVersion: '11', errorCode: null, retryable: false })
  const api = { execute: async request => { calls.push(request); if (request.method === 'POST') body = request.data
    if (options.defer) await options.defer
    if (options.unknown && request.method === 'POST') throw new TypeError('network')
    return receipt() } }
  const client = useHallSelectedOutputReview({ api, review, taskId: ref('task-1'), conversationId: ref('conversation-1'), identityKey: identity, candidates })
  return { client, calls, candidates, identity, accepts: () => accepts }
}
describe('selected existing outputs unified acceptance', () => {
  beforeEach(() => window.sessionStorage.clear())
  afterEach(() => window.sessionStorage.clear())
  it('toolbar starts empty; card preselects the historical version; close writes nothing', async () => {
    const f = setup(); try {
      await f.client.show(); expect(f.client.selected.value).to.deep.equal([])
      f.client.toggle(selectionKey(item(2))); f.client.close(); expect(f.calls).to.deep.equal([])
      await f.client.show(item(1)); expect(f.client.selected.value.map(x => x.requestId)).to.deep.equal(['request-1'])
      expect(f.client.choices.value).to.have.length(3); expect(f.calls).to.deep.equal([])
    } finally { f.client.dispose() }
  })
  it('submits only selected historical/multiple outputs then accepts exactly the returned delivery', async () => {
    const f = setup(); try {
      await f.client.show(item(1)); f.client.toggle(selectionKey(item(3))); await f.client.confirm()
      const post = f.calls.find(x => x.method === 'POST'); expect(post.data.selectedOutputs.map(x => x.requestId)).to.deep.equal(['request-1', 'request-3'])
      expect(f.calls.find(x => x.kind === 'open').expected.selectedOutputs).to.deep.equal(post.data.selectedOutputs)
      expect(f.accepts()).to.equal(1); expect(f.client.open.value).to.equal(false)
    } finally { f.client.dispose() }
  })
  it('reuses an exactly matching submitted batch without another promotion', async () => {
    const f = setup({ batch: batch([item(1)]) }); try {
      await f.client.show(item(1)); await f.client.confirm()
      expect(f.calls.some(x => x.method === 'POST')).to.equal(false); expect(f.accepts()).to.equal(1)
    } finally { f.client.dispose() }
  })
  it('different submitted set goes through promotion and never accepts a mismatched batch', async () => {
    const f = setup({ batch: batch([item(3)]), mismatch: true }); try {
      await f.client.show(item(1)); await f.client.confirm(); expect(f.calls.some(x => x.method === 'POST')).to.equal(true)
      expect(f.accepts()).to.equal(0); expect(f.client.error.value).not.to.equal('')
    } finally { f.client.dispose() }
  })
  it('double confirmation freezes original selection and writes once', async () => {
    let release; const wait = new Promise(resolve => { release = resolve }); const f = setup({ defer: wait })
    try {
      await f.client.show(item(1)); const first = f.client.confirm(); await flushPromises()
      f.client.toggle(selectionKey(item(2))); await f.client.confirm(); release(); await first
      expect(f.calls.filter(x => x.method === 'POST')).to.have.length(1)
      expect(f.client.selected.value).to.have.length(1); expect(f.accepts()).to.equal(1)
    } finally { release(); f.client.dispose() }
  })
  it('unknown submission never accepts; recovery/read does not write or silently accept', async () => {
    const f = setup({ unknown: true }); try {
      await f.client.show(item(1)); await f.client.confirm(); expect(f.accepts()).to.equal(0)
      await f.client.finalization.check(); expect(f.calls.filter(x => x.method === 'POST')).to.have.length(1); expect(f.accepts()).to.equal(0)
      await f.client.confirm(); expect(f.accepts()).to.equal(1); expect(f.calls.filter(x => x.method === 'POST')).to.have.length(1)
    } finally { f.client.dispose() }
  })
  it('identity change during submission cannot accept under the new identity', async () => {
    let release; const wait = new Promise(resolve => { release = resolve }); const f = setup({ defer: wait })
    try { await f.client.show(item(1)); const pending = f.client.confirm(); f.identity.value = 'owner-2'; release(); await pending; expect(f.accepts()).to.equal(0) } finally { release(); f.client.dispose() }
  })
  it('compares exact source and content hash, not title or newest output; supports completed text', () => {
    const a = selectedOutput(item(1)); expect(batchMatchesSelection(batch([item(1)]), [a])).to.equal(true)
    expect(batchMatchesSelection(batch([item(2)]), [a])).to.equal(false)
    const messageSource = { turnId: 'turn-1', messageId: '1', snapshotId: 'snapshot-1', finalSha256: 'a'.repeat(64) }
    const text = { requestId: 'request-1', messageSource, sha256: 'b'.repeat(64) }
    const b = { items: [{ displayRole: 'RESULT', contentHash: text.sha256, source: { kind: 'COMPLETED_MESSAGE', requestId: text.requestId, messageSource } }] }
    expect(batchMatchesSelection(b, [selectedOutput(text)])).to.equal(true)
    expect(batchMatchesSelection(b, [{ ...selectedOutput(text), messageSource: { ...messageSource, messageId: '2' } }])).to.equal(false)
  })
})
