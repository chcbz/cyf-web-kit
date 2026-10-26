import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { taskStateClass, taskStatusFilters, taskStatusText } from '../src/constants/juyiting.js'

describe('Juyi Hall formal bounty status mapping', () => {
  const expectedStatuses = [
    ['PENDING_ASSIGNMENT', '待确认承办', 'task-state-open'],
    ['IN_PROGRESS', '进行中', 'task-state-running'],
    ['PENDING_ACCEPTANCE', '待验收', 'task-state-reviewing'],
    ['COMPLETED', '已完成', 'task-state-done'],
    ['HISTORY', '历史', 'task-state-archived'],
    ['UNKNOWN', '待核对', 'task-state-unknown']
  ]

  it('keeps four primary phases and secondary history/reconciliation, without losing terminal reasons', () => {
    assert.deepEqual(taskStatusFilters.map(({ value, label, className }) => [value, label, className]), expectedStatuses)
    for (const status of ['planning', 'assigned', 'running', 'blocked']) assert.equal(taskStatusText(status), '进行中')
    for (const [status, label] of [['failed', '办理未完成'], ['cancelled', '已取消'], ['archived', '已归档']]) assert.equal(taskStatusText(status), label)
    assert.equal(taskStatusText('open'), '待确认承办')
    assert.equal(taskStatusText('reviewing'), '待验收')
  })

  it('does not classify an unknown server state as open', () => {
    assert.equal(taskStatusText('completed'), '已完成')
    assert.equal(taskStatusText('server-new-status'), '状态待核对')
    assert.equal(taskStateClass('server-new-status'), 'task-state-unknown')
    assert.notEqual(taskStatusText('server-new-status'), taskStatusText('open'))
  })
})
