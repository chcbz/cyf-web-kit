import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { ref } from 'vue'
import { useFormalTaskExecutionScope } from '../src/composables/useFormalTaskExecutionScope.js'

const workspace = ({ taskId = 'task_395', agentId = 'agent_wuyong', workItems = [] } = {}) => ({
  task: { taskId, assignedAgentId: agentId }, workItems
})
const readyItem = (overrides = {}) => ({ workItemId: 'work_1', assigneeAgentId: 'agent_wuyong', requiredItem: true, status: 'ready', ...overrides })

const scopeFixture = () => {
  const selectedTask = ref({ id: 'task_395', assignedAgentId: 'agent_wuyong' })
  const chatContext = ref({ mode: 'bounty', conversationScopeType: 'bounty', conversationScopeKey: 'task:task_395', taskId: 'task_395', targetAgentId: 'agent_wuyong', targetAgentIds: ['agent_wuyong'] })
  const conversationId = ref('conversation_395')
  const identityScope = ref('tenant\u0000client\u0000owner')
  const taskWorkspaceEnabled = ref(true)
  const taskWorkspaceSubject = ref({ taskId: 'task_395', actorAgentId: 'agent_wuyong' })
  const taskWorkspaceSnapshot = ref(workspace({ workItems: [readyItem()] }))
  const taskWorkspaceConnectionState = ref('live')
  const taskWorkspaceError = ref(null)
  const formal = useFormalTaskExecutionScope({ selectedTask, chatContext, conversationId, identityScope, taskWorkspaceEnabled, taskWorkspaceSubject, taskWorkspaceSnapshot, taskWorkspaceConnectionState, taskWorkspaceError })
  return { selectedTask, chatContext, conversationId, taskWorkspaceEnabled, taskWorkspaceSubject, taskWorkspaceSnapshot, taskWorkspaceConnectionState, taskWorkspaceError, formal }
}

describe('formal TASK execution Hall scope', () => {
  it('authorizes only one ready required work item for the exact bounty discussion and explicit assigned agent', () => {
    const fixture = scopeFixture()
    assert.deepEqual(fixture.formal.value, {
      taskId: 'task_395', conversationId: 'conversation_395', targetAgentId: 'agent_wuyong', conversationConfirmed: true,
      formalExecutionAuthorized: true, authorizationReason: ''
    })
  })

  it('uses a validated snapshot while SSE headers are pending, without relaxing identity/task/actor checks', () => {
    const fixture = scopeFixture()
    fixture.taskWorkspaceConnectionState.value = 'snapshot_ready'
    assert.equal(fixture.formal.value.formalExecutionAuthorized, true)
    fixture.taskWorkspaceSubject.value = { taskId: 'task_other', actorAgentId: 'agent_wuyong' }
    assert.equal(fixture.formal.value.formalExecutionAuthorized, false)
    fixture.taskWorkspaceSubject.value = { taskId: 'task_395', actorAgentId: 'agent_other' }
    assert.equal(fixture.formal.value.formalExecutionAuthorized, false)
    fixture.taskWorkspaceSubject.value = { taskId: 'task_395', actorAgentId: 'agent_wuyong' }
    fixture.taskWorkspaceSnapshot.value = workspace({ agentId: 'agent_other', workItems: [readyItem()] })
    assert.equal(fixture.formal.value.formalExecutionAuthorized, false)
    fixture.taskWorkspaceSnapshot.value = workspace({ workItems: [readyItem({ status: 'running' })] })
    assert.equal(fixture.formal.value.formalExecutionAuthorized, false)
    fixture.taskWorkspaceSnapshot.value = workspace({ workItems: [readyItem()] })
    for (const state of ['loading', 'resyncing', 'degraded', 'error', 'idle']) {
      fixture.taskWorkspaceConnectionState.value = state
      assert.equal(fixture.formal.value.formalExecutionAuthorized, false, state)
    }
  })

  it('does not borrow a conversation from another task', () => {
    const fixture = scopeFixture()
    fixture.chatContext.value = { ...fixture.chatContext.value, conversationScopeKey: 'task:task_other', taskId: 'task_other' }
    assert.equal(fixture.formal.value.conversationId, '')
    assert.equal(fixture.formal.value.formalExecutionAuthorized, false)
    assert.match(fixture.formal.value.authorizationReason, /不会使用其他榜文或私人会话/)
  })

  it('truthfully blocks missing, unavailable, and ambiguous required work-item facts', () => {
    const fixture = scopeFixture()
    fixture.taskWorkspaceSnapshot.value = workspace({ workItems: [] })
    assert.match(fixture.formal.value.authorizationReason, /没有由该已指派好汉承办的 ready 必需工作项/)

    fixture.taskWorkspaceSnapshot.value = workspace({ workItems: [readyItem(), readyItem({ workItemId: 'work_2' })] })
    assert.match(fixture.formal.value.authorizationReason, /多个匹配的 ready 必需工作项/)

    fixture.taskWorkspaceConnectionState.value = 'degraded'
    fixture.taskWorkspaceError.value = { status: 503 }
    assert.match(fixture.formal.value.authorizationReason, /返回 503/)
  })
})
