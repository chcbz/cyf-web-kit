import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { taskStateClass, taskStatusFilters, taskStatusText } from '../src/constants/juyiting.js'

describe('Juyi Hall formal bounty status mapping', () => {
  const expectedStatuses = [
    ['open', '待点将', 'task-state-open'],
    ['planning', '筹划中', 'task-state-planning'],
    ['assigned', '待开工（已点将）', 'task-state-assigned'],
    ['running', '办理中', 'task-state-running'],
    ['reviewing', '待验收', 'task-state-reviewing'],
    ['blocked', '受阻', 'task-state-blocked'],
    ['completed', '已完成', 'task-state-done'],
    ['failed', '失败', 'task-state-failed'],
    ['cancelled', '已取消', 'task-state-cancelled'],
    ['archived', '已归档', 'task-state-archived']
  ]

  it('defines all ten formal task statuses once for filters, labels, and styles', () => {
    assert.deepEqual(taskStatusFilters.map(({ value, label, className }) => [value, label, className]), expectedStatuses)
    for (const [status, label, className] of expectedStatuses) {
      assert.equal(taskStatusText(status.toUpperCase()), label)
      assert.equal(taskStateClass(status), className)
    }
  })

  it('does not classify an unknown server state as open', () => {
    assert.equal(taskStatusText('completed'), '已完成')
    assert.equal(taskStatusText('server-new-status'), '状态待核对')
    assert.equal(taskStateClass('server-new-status'), 'task-state-unknown')
    assert.notEqual(taskStatusText('server-new-status'), taskStatusText('open'))
  })
})
