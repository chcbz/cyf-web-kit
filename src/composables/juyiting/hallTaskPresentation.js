const rawPhases = Object.freeze({
  open: 'PENDING_ASSIGNMENT',
  planning: 'IN_PROGRESS', assigned: 'IN_PROGRESS', running: 'IN_PROGRESS', blocked: 'IN_PROGRESS',
  reviewing: 'PENDING_ACCEPTANCE', completed: 'COMPLETED',
  failed: 'HISTORY', cancelled: 'HISTORY', archived: 'HISTORY'
})
export const hallTaskPhases = Object.freeze(['PENDING_ASSIGNMENT', 'IN_PROGRESS', 'PENDING_ACCEPTANCE', 'COMPLETED', 'HISTORY', 'UNKNOWN'])
const meta = Object.freeze({
  PENDING_ASSIGNMENT: ['待确认承办', 'neutral', 'task-state-open'],
  IN_PROGRESS: ['进行中', 'info', 'task-state-running'],
  PENDING_ACCEPTANCE: ['待验收', 'warning', 'task-state-reviewing'],
  COMPLETED: ['已完成', 'positive', 'task-state-done'],
  HISTORY: ['历史事项', 'neutral', 'task-state-archived'],
  UNKNOWN: ['状态待核对', 'warning', 'task-state-unknown']
})
const terminal = status => ['completed', 'failed', 'cancelled', 'archived'].includes(status)

// Server phase owns submitted-batch integrity. A missing context may provide a label,
// never permission to accept. Queue/question/stream activity is not a root phase.
export const projectHallTask = ({ task, reviewContext = null, pendingOperation = null } = {}) => {
  if (typeof task === 'string') task = { status: task }
  const rawStatus = typeof task?.status === 'string' ? task.status : ''
  const expectedPhase = rawPhases[rawStatus] || 'UNKNOWN'
  let phase = expectedPhase
  let reason = null
  if (task?.phase != null) {
    phase = hallTaskPhases.includes(task.phase) ? task.phase : 'UNKNOWN'
    if (phase !== expectedPhase && phase !== 'UNKNOWN') phase = 'UNKNOWN'
  }
  if (phase === 'UNKNOWN') reason = '事项与交付状态需要核对'
  if (reviewContext && (reviewContext.taskId !== task?.id || reviewContext.taskState !== rawStatus.toUpperCase() ||
    (task?.taskVersion != null && reviewContext.taskVersion !== String(task.taskVersion)))) {
    phase = 'UNKNOWN'
    reason = '事项版本已变化，请重新核对'
  } else if (reviewContext && phase === 'PENDING_ACCEPTANCE' && reviewContext.currentDelivery?.state !== 'SUBMITTED') {
    phase = 'UNKNOWN'
    reason = '尚未核对到本批正式成果'
  }
  const pending = pendingOperation || reviewContext?.pendingOperation
  const needsReconcile = phase === 'UNKNOWN' || (phase === 'PENDING_ACCEPTANCE' && !reviewContext)
  const readOnly = terminal(rawStatus) || phase === 'UNKNOWN'
  const actions = ['VIEW']
  if (pending) actions.push('CHECK_OPERATION')
  else if (!readOnly) {
    if (phase === 'PENDING_ASSIGNMENT') actions.push('ASSIGN')
    else actions.push('DISCUSS')
    if (phase === 'PENDING_ACCEPTANCE' && !needsReconcile && reviewContext.currentDelivery.allowedActions?.includes('ACCEPT')) actions.push('ACCEPT')
  }
  const [baseLabel, tone, className] = meta[phase]
  const label = phase === 'HISTORY' ? ({ failed: '办理未完成', cancelled: '已取消', archived: '已归档' })[rawStatus] || baseLabel : baseLabel
  return Object.freeze({ phase, label, tone, className, reason, readOnly, actions: Object.freeze(actions), rawStatus, needsReconcile })
}

const decimalCount = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 9223372036854775807n
export const validateHallTaskCounts = value => {
  if (!value || Object.keys(value).sort().join(',') !== 'phaseCounts,rawStatusCounts') return null
  const { phaseCounts, rawStatusCounts } = value
  if (!phaseCounts || !rawStatusCounts || Array.isArray(phaseCounts) || Array.isArray(rawStatusCounts) ||
    Object.keys(phaseCounts).sort().join(',') !== [...hallTaskPhases, 'total'].sort().join(',') ||
    !Object.hasOwn(rawStatusCounts, 'total') || !Object.values(phaseCounts).every(decimalCount) || !Object.values(rawStatusCounts).every(decimalCount)) return null
  const sum = record => Object.entries(record).reduce((total, [key, count]) => total + (key === 'total' ? 0n : BigInt(count)), 0n)
  if (phaseCounts.total !== rawStatusCounts.total || sum(phaseCounts) !== BigInt(phaseCounts.total) || sum(rawStatusCounts) !== BigInt(rawStatusCounts.total)) return null
  return Object.freeze({ phaseCounts: Object.freeze({ ...phaseCounts }), rawStatusCounts: Object.freeze({ ...rawStatusCounts }) })
}
