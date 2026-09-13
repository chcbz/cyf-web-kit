import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { useHallWorkItemBoard } from '../src/composables/juyiting/useHallWorkItemBoard.js'

const boardSource = readFileSync(new URL('../src/components/juyiting/WorkItemBoard.vue', import.meta.url), 'utf8')
const panelSource = readFileSync(new URL('../src/components/juyiting/TaskWorkspacePanel.vue', import.meta.url), 'utf8')
const adapterSource = readFileSync(new URL('../src/composables/juyiting/useHallWorkItemBoard.js', import.meta.url), 'utf8')

const workItem = (overrides = {}) => ({
  workItemId: 'work-a', title: '分析约束', description: '', workType: 'analysis', requiredAbilities: '[]',
  assigneeAgentId: null, status: 'pending', priority: 0, requiredItem: true, dependencyJson: '[]',
  leaseUntil: null, attemptCount: 0, maxAttempts: 3, resultArtifactId: null, submittedAt: null, completedAt: null, version: '1',
  ...overrides
})

describe('E08 work item board', () => {
  it('projects the frozen workspace snapshot into status columns without adding a transport or mutation path', () => {
    const workspace = ref({
      members: [{ agentId: 'agent-a', role: 'worker' }],
      workItems: [
        workItem({ workItemId: 'work-a', status: 'completed', assigneeAgentId: 'agent-a' }),
        workItem({ workItemId: 'work-b', title: '实现', status: 'pending', dependencyJson: '["work-a", "work-missing"]' })
      ]
    })
    const board = useHallWorkItemBoard({ workspace })

    expect(board.columns.value.map(column => column.status)).to.deep.equal([
      'pending', 'ready', 'claimed', 'running', 'blocked', 'submitted', 'completed', 'failed', 'cancelled', 'unknown'
    ])
    const pending = board.columns.value.find(column => column.status === 'pending').items[0]
    expect(pending.dependencyItems).to.deep.equal([
      { workItemId: 'work-a', title: '分析约束', status: 'completed' },
      { workItemId: 'work-missing', title: 'work-missing', status: null }
    ])
    expect(pending.completedDependencyCount).to.equal(1)
    expect(pending.missingDependencyIds).to.deep.equal(['work-missing'])
    expect(board.columns.value.find(column => column.status === 'completed').items[0].assigneeRole).to.equal('worker')
  })

  it('keeps unknown statuses out of the pending column and bounds dependency rows without losing totals', () => {
    const dependencyIds = Array.from({ length: 9 }, (_, index) => `dependency-${index + 1}`)
    const workspace = ref({
      members: [],
      workItems: [
        workItem({ workItemId: 'work-unknown', status: 'server-new-status', dependencyJson: JSON.stringify(dependencyIds) }),
        ...dependencyIds.slice(0, 8).map(workItemId => workItem({ workItemId, status: 'completed' }))
      ]
    })
    const board = useHallWorkItemBoard({ workspace })
    const unknown = board.entries.value.find(item => item.workItemId === 'work-unknown')

    expect(unknown.status).to.equal('unknown')
    expect(board.columns.value.find(column => column.status === 'pending').items).to.have.length(0)
    expect(board.columns.value.find(column => column.status === 'unknown').items).to.deep.equal([unknown])
    expect(unknown.dependencyItems).to.have.length(8)
    expect(unknown.remainingDependencyCount).to.equal(1)
    expect(unknown.dependencyCount).to.equal(9)
    expect(unknown.completedDependencyCount).to.equal(8)
    expect(unknown.missingDependencyIds).to.deep.equal(['dependency-9'])
  })

  it('does not infer a ready transition from dependencies and bounds malformed dependency display', () => {
    const workspace = ref({ members: [], workItems: [
      workItem({ dependencyJson: '{not-json}', status: 'pending' }),
      workItem({ workItemId: 'work-b', dependencyJson: JSON.stringify(Array.from({ length: 500 }, (_, index) => `work-${index}`)) })
    ] })
    const board = useHallWorkItemBoard({ workspace })
    const [malformed, oversized] = board.entries.value
    expect(malformed.dependencyState).to.equal('invalid')
    expect(malformed.status).to.equal('pending')
    expect(oversized.dependencyState).to.equal('invalid')
    expect(oversized.dependencyIds).to.deep.equal([])
  })

  it('integrates the board into the existing read-only workspace and explicitly keeps unsupported actions unavailable', () => {
    expect(panelSource).to.include("import WorkItemBoard from './WorkItemBoard.vue'")
    expect(panelSource).to.include('<WorkItemBoard :workspace="workspace" />')
    expect(boardSource).to.include('系统负责依赖解锁')
    expect(boardSource).to.include('当前支持查看进度，协作操作暂未开放')
    expect(panelSource).to.include('<details v-if="workspace.workItems.length" class="task-work-item-details">')
    expect(panelSource).to.include('查看工作项详情（{{ workspace.workItems.length }} 项）')
    expect(boardSource).to.not.match(/agentApi|fetch\(|EventSource|work-item-plans|upload|assign-task|auto-assign|create-task/)
    expect(adapterSource).to.not.match(/agentApi|fetch\(|EventSource|execute\(|Idempotency-Key|work-item-plans|upload/)
  })
})
