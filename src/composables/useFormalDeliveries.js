import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from './useHttp.js'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'

const MAX_VERSION = 2147483647
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const abortError = message => new DOMException(message, 'AbortError')
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 &&
  !/^\s|\s$/.test(value) && ![...value].some(character => { const code = character.codePointAt(0); return code < 32 || (code >= 127 && code <= 159) })
const validText = (value, maximum = 4000) => typeof value === 'string' && value.length <= maximum &&
  ![...value].some(character => { const code = character.codePointAt(0); return code < 32 || (code >= 127 && code <= 159) })
const validRevision = value => Number.isSafeInteger(value) && value >= 1 && value <= MAX_VERSION
const validEntityVersion = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_VERSION
const validTimestamp = value => (Number.isSafeInteger(value) && value >= 0) || (typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value)))
const positiveTimestamp = value => (Number.isSafeInteger(value) && value > 0) || (typeof value === 'string' && value.length > 0 && Date.parse(value) > 0)
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
const validReviewReason = value => validText(value, 4000) && value.length > 0 && value === value.trim()
const PAGE_FIELDS = new Set(['items'])
const DELIVERY_FIELDS = new Set([
  'taskId', 'workItemId', 'deliveryId', 'revision', 'deliveryVersion', 'state', 'runId', 'producerAgentId', 'summary',
  'manifestArtifactId', 'manifestArtifactVersion', 'submittedAt', 'reviewedAt', 'reviewReason',
  'taskVersion', 'workItemVersion', 'items'
])
const ITEM_FIELDS = new Set(['artifactId', 'artifactVersion', 'contentHash', 'purpose'])
const formalItem = item => item && typeof item === 'object' && !Array.isArray(item) &&
  Object.keys(item).every(key => ITEM_FIELDS.has(key)) && validId(item.artifactId) && validRevision(item.artifactVersion) &&
  validHash(item.contentHash) && validText(item.purpose, 1000)
const formalDelivery = (delivery, taskId) => delivery && typeof delivery === 'object' && !Array.isArray(delivery) &&
  Object.keys(delivery).every(key => DELIVERY_FIELDS.has(key)) && delivery.taskId === taskId && validId(delivery.workItemId) &&
  validId(delivery.deliveryId) && validRevision(delivery.revision) && validEntityVersion(delivery.deliveryVersion) &&
  ['submitted', 'accepted', 'changes_requested'].includes(delivery.state) &&
  validId(delivery.runId) && validId(delivery.producerAgentId) && validText(delivery.summary, 4000) &&
  validId(delivery.manifestArtifactId) && validRevision(delivery.manifestArtifactVersion) && validTimestamp(delivery.submittedAt) &&
  (delivery.reviewedAt == null || validTimestamp(delivery.reviewedAt)) &&
  (delivery.reviewReason == null || validText(delivery.reviewReason, 4000)) && validEntityVersion(delivery.taskVersion) &&
  validEntityVersion(delivery.workItemVersion) && Array.isArray(delivery.items) && delivery.items.every(formalItem) &&
  (delivery.state === 'submitted' ? delivery.deliveryVersion === 0 && delivery.reviewedAt == null && delivery.reviewReason == null
    : delivery.deliveryVersion >= 1 && positiveTimestamp(delivery.reviewedAt) &&
      (delivery.state === 'accepted' ? delivery.reviewReason == null : validReviewReason(delivery.reviewReason)))
const validatedPage = (value, taskId) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).every(key => PAGE_FIELDS.has(key)) ||
    !Array.isArray(value.items) || !value.items.every(item => formalDelivery(item, taskId))) {
    throw new Error('正式交付返回格式无效，未展示可能不完整的数据。')
  }
  const seen = new Set()
  if (value.items.some(item => { if (seen.has(item.deliveryId)) return true; seen.add(item.deliveryId); return false })) {
    throw new Error('正式交付返回了重复批次，未展示可能不完整的数据。')
  }
  return value.items
}

export const formalDeliveryReadAdapter = Object.freeze({
  async list ({ taskId, signal } = {}) {
    if (!validId(taskId)) throw Object.assign(new Error('正式交付请求无效。'), { retryable: false })
    const api = createApi('/agent')
    const result = await api.execute({
      url: `/tasks/${encodeURIComponent(taskId)}/formal-deliveries`, method: 'GET', autoLoading: false, needAuth: true, signal
    })
    return validatedPage(result, taskId)
  }
})

const classifyFailure = failure => {
  if (failure?.name === 'AbortError') return null
  if (failure?.status === 401 || failure?.status === 403) return ['forbidden', '无访问权限。']
  if (failure?.status === 409) return ['conflict', '版本已变化，请刷新正式交付；系统未自动重试。']
  if (failure?.status >= 400 && failure?.status < 500) return ['error', failure.message || '正式交付读取失败。']
  return ['unknown', '正式交付读取失败，请刷新确认；系统未自动重试。']
}

/** Owner-only historical read boundary. New decisions belong to the shell-owned useHallDeliveryReview. */
export function useFormalDeliveries ({ taskId, identityFingerprint, adapter = formalDeliveryReadAdapter } = {}) {
  const items = ref([])
  const state = ref('idle')
  const message = ref('')
  const loading = ref(false)
  const taskValue = computed(() => String(valueOf(taskId) || ''))
  const identityValue = computed(() => String(valueOf(identityFingerprint) || ''))
  const scope = computed(() => validId(taskValue.value) && identityValue.value ? `${identityValue.value}\u0000${taskValue.value}` : '')
  let generation = 0
  let controller = null
  let disposed = false

  const reset = () => {
    generation += 1
    controller?.abort(abortError('Formal delivery context changed'))
    controller = null
    items.value = []; state.value = 'idle'; message.value = ''; loading.value = false
  }
  const current = (captured, capturedScope, requestController) => !disposed && captured === generation && capturedScope === scope.value && controller === requestController && !requestController.signal.aborted
  const refresh = async () => {
    if (disposed || !scope.value || loading.value) return null
    const captured = generation
    const capturedTask = taskValue.value
    const capturedScope = scope.value
    controller?.abort(abortError('Formal delivery request replaced'))
    const requestController = new AbortController(); controller = requestController
    loading.value = true; state.value = 'loading'; message.value = ''
    try {
      const rows = await adapter.list({ taskId: capturedTask, signal: requestController.signal })
      if (!current(captured, capturedScope, requestController)) return null
      items.value = validatedPage({ items: rows }, capturedTask); state.value = rows.length ? 'ready' : 'empty'; message.value = rows.length ? '' : '暂无正式交付批次。'
      return rows
    } catch (error) {
      const presentation = classifyFailure(error)
      if (!presentation || !current(captured, capturedScope, requestController)) return null
      items.value = []; state.value = presentation[0]; message.value = presentation[1]
      return null
    } finally {
      if (controller === requestController) controller = null
      if (!disposed && captured === generation && capturedScope === scope.value) loading.value = false
    }
  }
  const stop = watch(scope, () => { reset(); if (scope.value) void refresh() }, { immediate: true, flush: 'sync' })
  const unregisterIdentityCleanup = registerIdentityCleanup(reset)
  const dispose = () => { if (disposed) return; disposed = true; stop(); reset(); unregisterIdentityCleanup() }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { items, state, message, loading, refresh, dispose }
}
