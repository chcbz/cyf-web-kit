import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { discussionAccepted, discussionBody, typedOutcomeProjection } from '../src/composables/juyiting/hallTypedDeliberation.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/juyiting/typed-deliberation-atomic-followup-v1.json', import.meta.url)))
const clone = value => JSON.parse(JSON.stringify(value))
describe('typed natural deliberation frozen wire', () => {
  it('copies the frozen fixture byte-exact and emits only the exact ten-key discussion body', () => {
    const body = discussionBody({ intent: 'DISCUSSION', taskId: 'task-1', assignmentRevision: '4', content: fixture.golden.discussion.content })
    expect(body).to.deep.equal(fixture.golden.discussion)
    expect(Object.keys(body)).to.have.length(10)
  })
  it('accepts only exact six-key selected workspace versions as optional available references', () => {
    const selector = { kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: 'file-1', version: '7', purpose: 'REFERENCE', assetId: null, assetRevision: null }
    const body = discussionBody({ intent: 'DISCUSSION', taskId: 'task-1', assignmentRevision: '4', content: '请参考此稿。', sourceSelectors: [selector] })
    expect(body.sourceSelectors).to.deep.equal([selector])
    expect(discussionBody({ intent: 'DISCUSSION', taskId: 'task-1', assignmentRevision: '4', content: '请参考此稿。', sourceSelectors: [{ ...selector, extra: true }] })).to.equal(null)
  })
  it('carries up to 32 unified materials with exact roles instead of coercing everything to reference', () => {
    const sourceSelectors = Array.from({ length: 32 }, (_, i) => ({ kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: `file-${i}`,
      version: '7', purpose: i % 2 ? 'REFERENCE' : 'INPUT', assetId: null, assetRevision: null }))
    const command = { intent: 'DISCUSSION', taskId: 'task-1', assignmentRevision: '4', content: '查看这些资料', sourceSelectors }
    expect(discussionBody(command).sourceSelectors).to.deep.equal(sourceSelectors)
    expect(discussionBody({ ...command, sourceSelectors: [...sourceSelectors, { ...sourceSelectors[0], fileId: 'extra' }] })).to.equal(null)
    for (const purpose of ['OUTPUT', 'input', 'REFERENCE ']) {
      expect(discussionBody({ ...command, sourceSelectors: [{ ...sourceSelectors[0], purpose }] })).to.equal(null)
    }
  })
  it('rejects noncanonical long values, C0/C1 controls, and malformed nullable lineage', () => {
    expect(discussionBody({ intent: 'DISCUSSION', taskId: 'task-1', assignmentRevision: '04', content: '画鸟' })).to.equal(null)
    expect(discussionBody({ intent: 'DISCUSSION', taskId: 'task-1', assignmentRevision: '4', content: '画\n鸟' })).to.equal(null)
    expect(discussionBody({ intent: 'DISCUSSION', taskId: 'task-1', assignmentRevision: '4', content: '画\u0085鸟' })).to.equal(null)
    expect(discussionBody({ intent: 'CLARIFICATION_REPLY', taskId: 'task-1', assignmentRevision: '4', content: '蓝色' })).to.equal(null)
  })
  it('accepts the golden receipt without coercing its cursor above Number.MAX_SAFE_INTEGER', () => {
    const body = fixture.golden.discussion
    expect(discussionAccepted(fixture.golden.accepted, body, '7')).to.deep.equal(fixture.golden.accepted)
    const invalid = clone(fixture.golden.accepted); invalid.eventCursor = '9007199254740993x'
    expect(discussionAccepted(invalid, body, '7')).to.equal(null)
  })

  it('accepts a GENERATE proposal with exact image reference selectors while preserving EDIT lineage constraints', () => {
    const generate = clone(fixture.golden.proposalRead)
    generate.outcome.proposal.sourceRefIds = ['asset-1']
    generate.outcome.proposal.sourceSelectors = [{ kind: 'CURRENT_CONVERSATION_ASSET', fileId: null, version: null, purpose: null, assetId: 'asset-1', assetRevision: '7' }]
    expect(typedOutcomeProjection(generate, { conversationId: '7', conversationGeneration: '1', taskId: 'task-1', requestId: 'request-1' })).to.deep.equal(generate)
    const foreignTask = clone(fixture.golden.answerRead); foreignTask.outcome.taskId = 'other-task'
    expect(typedOutcomeProjection(foreignTask, { conversationId: '7', conversationGeneration: '1', taskId: 'task-1', requestId: 'request-1' })).to.equal(null)
    const malformedEdit = clone(generate); malformedEdit.outcome.proposal.operation = 'EDIT_IMAGE'; malformedEdit.outcome.proposal.parent = null
    expect(typedOutcomeProjection(malformedEdit)).to.equal(null)
  })
  it('accepts all frozen typed views and rejects a foreign scope or unknown union key', () => {
    for (const name of ['pendingRead', 'answerRead', 'clarifyRead', 'proposalRead']) {
      expect(typedOutcomeProjection(fixture.golden[name], { conversationId: '7', conversationGeneration: '1', requestId: 'request-1' })).to.deep.equal(fixture.golden[name])
    }
    const foreign = clone(fixture.golden.answerRead); foreign.conversationGeneration = '2'
    expect(typedOutcomeProjection(foreign, { conversationId: '7', conversationGeneration: '1', requestId: 'request-1' })).to.equal(null)
    const extra = clone(fixture.golden.proposalRead); extra.outcome.proposal.unknown = true
    expect(typedOutcomeProjection(extra)).to.equal(null)
  })
})

describe('typed inspection v2 wire', () => {
  it('keeps INSPECT v2 distinct from CHAT v1 and rejects unknown versions', async () => {
    const { inspectionOutcomeProjection } = await import('../src/composables/juyiting/hallTypedDeliberation.js')
    const inspection = { schemaVersion: 2, contract: 'juyiting-typed-inspection-v1', conversationId: '7', conversationGeneration: '1', requestId: 'request-inspect', requestRevision: '1', turnId: 'turn-inspect', state: 'PENDING', outcome: null, inspection: { authorizationId: 'inspection-1', manifestDigest: `sha256:${'a'.repeat(64)}`, sourceRefIds: ['source-1'], inputSummary: null } }
    expect(inspectionOutcomeProjection(inspection, { conversationId: '7', conversationGeneration: '1', requestId: 'request-inspect' })).to.include({ purpose: 'INSPECT', state: 'PENDING' })
    expect(typedOutcomeProjection(inspection)).to.equal(null)
    expect(inspectionOutcomeProjection({ ...inspection, schemaVersion: 3 })).to.equal(null)
  })
})
