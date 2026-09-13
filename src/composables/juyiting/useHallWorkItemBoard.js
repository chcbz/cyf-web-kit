import { computed, unref } from 'vue'

const BOARD_STATUSES = Object.freeze(['pending', 'ready', 'claimed', 'running', 'blocked', 'submitted', 'completed', 'failed', 'cancelled', 'unknown'])
const STATUS_LABELS = Object.freeze({
  pending: '等待依赖',
  ready: '可领取',
  claimed: '已领取',
  running: '执行中',
  blocked: '已阻塞',
  submitted: '待验收',
  completed: '已完成',
  failed: '已失败',
  cancelled: '已取消',
  unknown: '状态未知'
})
const MAX_DEPENDENCY_JSON_BYTES = 65535
const MAX_DEPENDENCIES = 499
const MAX_DEPENDENCY_ID_CODE_POINTS = 100
const MAX_DISPLAYED_DEPENDENCIES = 8

/**
 * Read-only presentation adapter for the C04 workspace snapshot.  The server
 * remains the only authority for dependency readiness and work-item actions.
 */
export const useHallWorkItemBoard = ({ workspace } = {}) => {
  const items = computed(() => Array.isArray(unref(workspace)?.workItems) ? unref(workspace).workItems : [])
  const membersById = computed(() => new Map(
    (Array.isArray(unref(workspace)?.members) ? unref(workspace).members : [])
      .filter(member => validId(member?.agentId))
      .map(member => [member.agentId, member])
  ))
  const itemsById = computed(() => new Map(items.value.map(item => [item.workItemId, item])))

  const entries = computed(() => items.value.map(item => toEntry(item, itemsById.value, membersById.value)))
  const columns = computed(() => BOARD_STATUSES.map(status => Object.freeze({
    status,
    label: STATUS_LABELS[status],
    items: Object.freeze(entries.value.filter(item => item.status === status))
  })))

  return { columns, entries, statusLabels: STATUS_LABELS }
}

function toEntry (item, itemsById, membersById) {
  const dependency = parseDependencies(item?.dependencyJson)
  const dependencyItems = dependency.ids.slice(0, MAX_DISPLAYED_DEPENDENCIES).map(id => itemsById.get(id) || null)
  const missingDependencyIds = dependency.ids.filter(id => !itemsById.has(id))
  const completedDependencyCount = dependency.ids.reduce((count, id) => count + (itemsById.get(id)?.status === 'completed' ? 1 : 0), 0)
  const assignee = validId(item?.assigneeAgentId) ? membersById.get(item.assigneeAgentId) || null : null

  return Object.freeze({
    workItemId: item?.workItemId || '',
    title: item?.title || '',
    description: item?.description || '',
    workType: item?.workType || '',
    status: BOARD_STATUSES.includes(item?.status) ? item.status : 'unknown',
    statusLabel: STATUS_LABELS[item?.status] || '状态未知',
    assigneeAgentId: validId(item?.assigneeAgentId) ? item.assigneeAgentId : null,
    assigneeRole: assignee?.role || null,
    requiredItem: item?.requiredItem === true,
    attemptCount: Number.isInteger(item?.attemptCount) ? item.attemptCount : 0,
    maxAttempts: Number.isInteger(item?.maxAttempts) ? item.maxAttempts : 0,
    leaseUntil: item?.leaseUntil || null,
    dependencyState: dependency.state,
    dependencyIds: Object.freeze([...dependency.ids]),
    dependencyItems: Object.freeze(dependencyItems.map((dependencyItem, index) => Object.freeze({
      workItemId: dependency.ids[index],
      title: dependencyItem?.title || dependency.ids[index],
      status: dependencyItem?.status || null
    }))),
    missingDependencyIds: Object.freeze(missingDependencyIds),
    completedDependencyCount,
    dependencyCount: dependency.ids.length,
    remainingDependencyCount: Math.max(0, dependency.ids.length - dependencyItems.length)
  })
}

function parseDependencies (value) {
  if (value == null || value === '') return { state: 'none', ids: [] }
  if (typeof value !== 'string' || !hasBoundedUtf8Length(value, MAX_DEPENDENCY_JSON_BYTES)) return { state: 'invalid', ids: [] }
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    return { state: 'invalid', ids: [] }
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_DEPENDENCIES) return { state: 'invalid', ids: [] }
  const ids = []
  const seen = new Set()
  for (const candidate of parsed) {
    if (!validId(candidate)) return { state: 'invalid', ids: [] }
    if (!seen.has(candidate)) {
      seen.add(candidate)
      ids.push(candidate)
    }
  }
  return { state: ids.length ? 'listed' : 'none', ids }
}

function validId (value) {
  return typeof value === 'string' && Array.from(value).length > 0 && Array.from(value).length <= MAX_DEPENDENCY_ID_CODE_POINTS &&
    !/^[\s]|[\s]$/.test(value) && !Array.from(value).some(isIsoControlCharacter) && !hasUnpairedSurrogate(value)
}

function hasBoundedUtf8Length (value, maximum) {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index)
    if (codePoint > 0xffff) index += 1
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
    if (bytes > maximum) return false
  }
  return true
}

function isIsoControlCharacter (value) {
  const point = value.codePointAt(0)
  return point >= 0x0000 && point <= 0x001f || point >= 0x007f && point <= 0x009f
}

function hasUnpairedSurrogate (value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (++index >= value.length || value.charCodeAt(index) < 0xdc00 || value.charCodeAt(index) > 0xdfff) return true
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true
  }
  return false
}
