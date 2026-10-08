import { expect } from 'chai'
import { currentBountyAssignmentRevision } from '../src/composables/juyiting/hallBountyAssignmentContext.js'
const context = () => ({
  task: { id: '423', taskVersion: '9', assignedAgentId: 'agent-a' },
  targetAgentId: 'agent-a', conversationId: '9007199254740993',
  state: { status: 'ATTACHED', projection: { taskId: '423', taskVersion: '9',
    targetAgentId: 'agent-a', conversationId: '9007199254740993', assignmentRevision: '1',
    currentAssignment: true, grantState: 'ACTIVE', bootstrapState: 'ADMITTED' } }
})
describe('current bounty assignment context from authenticated adoption', () => {
  it('uses actual TaskDTO without assignmentRevision; never aliases taskVersion or mutates DTO', () => {
    const c = context(); const before = JSON.stringify(c.task)
    expect(currentBountyAssignmentRevision(c)).to.equal('1')
    expect(JSON.stringify(c.task)).to.equal(before)
  })
  for (const [field, value] of [['taskId', '424'], ['targetAgentId', 'agent-b'],
    ['conversationId', '88'], ['taskVersion', '8'], ['currentAssignment', false],
    ['grantState', 'REVOKED'], ['bootstrapState', 'RETRY'], ['assignmentRevision', 1],
    ['assignmentRevision', '01'], ['assignmentRevision', '9223372036854775808']]) {
    it(`rejects stale/cross-scope/invalid projection ${field}=${value}`, () => {
      const c = context(); c.state.projection[field] = value
      expect(currentBountyAssignmentRevision(c)).to.equal('')
    })
  }
  it('rejects fenced identity/reset state and historical stored receipts after refresh', () => {
    for (const state of [{ status: 'IDLE' }, { ...context().state, status: 'ADMITTED' },
      { ...context().state, status: 'HISTORICAL' }]) {
      expect(currentBountyAssignmentRevision({ ...context(), state })).to.equal('')
    }
  })
  it('rejects canonical reassignment and imprecise task versions', () => {
    const c = context(); c.task.assignedAgentId = 'agent-b'
    expect(currentBountyAssignmentRevision(c)).to.equal('')
    c.task.assignedAgentId = 'agent-a'; c.task.taskVersion = 9
    expect(currentBountyAssignmentRevision(c)).to.equal('')
  })
})
