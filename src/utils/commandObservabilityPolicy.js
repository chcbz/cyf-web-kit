const CONTRACT_VERSION = 'command-observability-v1'
const CAPABILITY_KEYS = Object.freeze(['contractVersion', 'available', 'readOnly', 'reason'])
const CAPABILITY_REASONS = new Set([null, 'FORBIDDEN', 'DISABLED'])

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

export const isSafeObservationNumber = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export const observationValue = value => isSafeObservationNumber(value) ? String(value) : '未知'
export const observationDuration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? String(value) : '未知'
export const observationTimestamp = value => isSafeObservationNumber(value) && value > 0 && !Number.isNaN(new Date(value).getTime())
  ? new Date(value).toLocaleString()
  : '未知'
export const observationString = value => typeof value === 'string' && value.length > 0 ? value : '未知'

/** Fails closed: the browser never derives this capability from a token or cached profile. */
export function assessCommandObservabilityCapability (value) {
  if (!isRecord(value) || Object.keys(value).length !== CAPABILITY_KEYS.length || !CAPABILITY_KEYS.every(key => own(value, key))) {
    return Object.freeze({ available: false, reason: 'MALFORMED' })
  }
  if (value.contractVersion !== CONTRACT_VERSION || typeof value.available !== 'boolean' || value.readOnly !== true || !CAPABILITY_REASONS.has(value.reason)) {
    return Object.freeze({ available: false, reason: 'MALFORMED' })
  }
  if (value.available !== (value.reason === null)) return Object.freeze({ available: false, reason: 'MALFORMED' })
  return Object.freeze({ available: value.available, reason: value.reason, capability: Object.freeze({ ...value }) })
}

const validCursor = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && (value.length < 19 || (value.length === 19 && value <= '9223372036854775807'))
const cursorAdvanced = (next, previous) => validCursor(next) && validCursor(previous) && (next.length > previous.length || (next.length === previous.length && next > previous))

const pageShape = (value, cursorKey, requestedCursor) => {
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.hasMore !== 'boolean' || !own(value, cursorKey)) {
    throw new Error('看板分页响应格式无效。')
  }
  const cursor = value[cursorKey]
  if (value.hasMore && !cursorAdvanced(cursor, requestedCursor)) {
    const error = new Error('看板分页游标未前进。')
    error.protocol = true
    throw error
  }
  if (!value.hasMore && cursor !== null && !validCursor(cursor)) throw new Error('看板分页游标格式无效。')
  return Object.freeze({ items: value.items, nextCursor: cursor, hasMore: value.hasMore })
}

export const normalizeDlqPage = (value, requestedCursor) => pageShape(value, 'nextAfterDeliveryId', requestedCursor)
export const normalizeAuditPage = (value, requestedCursor) => pageShape(value, 'nextAfterId', requestedCursor)

export const capabilityUnavailableMessage = reason => ({
  FORBIDDEN: '当前账号没有查看协作运行看板的权限。',
  DISABLED: '协作运行看板当前未启用。',
  MALFORMED: '协作运行看板能力响应无效，请稍后重试。',
  UNAVAILABLE: '暂时无法确认协作运行看板是否可用，请稍后重试。',
  UNAUTHENTICATED: '登录状态已失效，请重新登录后再试。'
}[reason] || '协作运行看板暂时不可用，请稍后重试。')

export const isAuthorizationFailure = error => error?.status === 401 || error?.status === 403
export const safeOperationError = error => isAuthorizationFailure(error)
  ? capabilityUnavailableMessage(error.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN')
  : error?.protocol ? '服务返回的分页游标无效，已停止继续读取。' : '暂时无法读取该区块，请重试。'
