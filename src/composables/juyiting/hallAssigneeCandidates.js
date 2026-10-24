import { exactPointAndStartId } from './hallPointAndStartIntent.js'

export const assigneeSummary = value => {
  const fields = ['agentId', 'displayName', 'providerDisplayName', 'isMine', 'availability']
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !fields.every(key => Object.hasOwn(value, key)) || !exactPointAndStartId(value.agentId) ||
    typeof value.displayName !== 'string' || !value.displayName.trim() ||
    !(value.providerDisplayName === null || typeof value.providerDisplayName === 'string') ||
    typeof value.isMine !== 'boolean' || typeof value.availability !== 'string' || !value.availability) return null
  return Object.freeze(Object.fromEntries(fields.map(key => [key, value[key]])))
}
export const assigneePage = (value, afterAgentId = null) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['items', 'nextAfterAgentId'].every(key => Object.hasOwn(value, key)) || !Array.isArray(value.items) ||
    !(value.nextAfterAgentId === null || exactPointAndStartId(value.nextAfterAgentId))) return null
  const items = value.items.map(assigneeSummary)
  if (items.some(item => !item) || new Set(items.map(item => item.agentId)).size !== items.length ||
    items.some(item => item.agentId === afterAgentId) ||
    (value.nextAfterAgentId !== null && (!items.length || value.nextAfterAgentId !== items.at(-1).agentId))) return null
  return { items, nextAfterAgentId: value.nextAfterAgentId }
}
export const assignedTaskTarget = task => {
  const target = assigneeSummary(task?.assignedTarget)
  const ids = [...new Set((Array.isArray(task?.assignedAgentIds) ? task.assignedAgentIds : [task?.assignedAgentId]).filter(Boolean))]
  return target && ids.length === 1 && ids[0] === target.agentId ? target : null
}
export const assigneeProviderText = agent => agent?.providerDisplayName?.trim() || (agent?.isMine ? '我' : '其他用户')
export const assigneeAvailabilityText = agent => ({ online: '在线', offline: '离线 · 等待运行', busy: '忙碌 · 等待运行',
  unavailable: '暂不可用，请核对运行与绑定', error: '运行异常，请核对' }[agent?.availability] || '运行状态待核对')
