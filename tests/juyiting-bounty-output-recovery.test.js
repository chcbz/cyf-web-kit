import { expect } from 'chai'
import { readOutputRecovery, writeOutputRecovery } from '../src/composables/juyiting/bountyOutputRecovery.js'

const storage = () => { const data = new Map(); return {
  getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value)
} }
const scope = identityKey => ({ identityKey, conversationId: 'conversation-1', rootRequestId: 'request-1' })
const digest = 'a'.repeat(64)
const id = JSON.stringify(['request-1', 'step-1', 'output_1'])
const intent = { idempotencyKey: 'conversation-edit-safe-key', content: '改蓝色', requestId: 'request-1',
  stepId: 'step-1', outputId: 'output_1', sha256: digest, taskId: 'task-1', assignmentRevision: 3 }

describe('bounty output edit recovery', () => {
  it('restores only scoped, validated request IDs and an immutable in-flight edit', () => {
    const store = storage()
    const key = `juyiting:output-recovery:v1:${encodeURIComponent('owner-a')}:conversation-1:request-1`
    store.setItem(key, JSON.stringify({ followups: ['request-2', 'request-2', '../bad'], edits: {
      [id]: intent, [JSON.stringify(['request-1', 'bad', '../x'])]: intent } }))
    expect(readOutputRecovery(scope('owner-a'), store)).to.deep.equal({ followups: ['request-2'], legacyEdits: { [id]: intent } })
    expect(readOutputRecovery(scope('owner-b'), store)).to.deep.equal({ followups: [], legacyEdits: {} })
    expect(readOutputRecovery({ ...scope('owner-a'), conversationId: 'conversation-2' }, store)).to.deep.equal({ followups: [], legacyEdits: {} })
  })
  it('does not persist malformed scope and exposes malformed legacy edits to no new request path', () => {
    const store = storage()
    expect(writeOutputRecovery({ ...scope('owner-a'), conversationId: '../bad' }, { followups: ['request-2'] }, store)).to.equal(false)
    writeOutputRecovery(scope('owner-a'), { edits: { [id]: { ...intent, sha256: '', content: 'x' } } }, store)
    expect(readOutputRecovery(scope('owner-a'), store).legacyEdits).to.deep.equal({})
  })
})
