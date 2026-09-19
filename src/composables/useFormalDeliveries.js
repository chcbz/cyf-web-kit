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
const unwrap = result => {
  let value = result
  for (let index = 0; index < 3 && value && typeof value === 'object' && Object.hasOwn(value, 'data'); index += 1) value = value.data
  return value
}
const validMime = value => typeof value === 'string' && /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/.test(value)
const reworkSource = (value, delivery) => value && typeof value === 'object' &&
  validId(value.outputId) && value.fileRef && validId(value.fileRef.fileId) && validRevision(Number(value.fileRef.fileVersion)) &&
  value.formalDeliveryId === delivery.deliveryId && validEntityVersion(value.formalDecisionVersion) &&
  value.formalDecisionVersion === delivery.deliveryVersion && value.formalDeliveryState === 'changes_requested' && validMime(value.mimeType)
const reworkExecution = (value, command) => value && typeof value === 'object' &&
  validId(value.executionId) && value.taskId === command.taskId && validId(value.runId) &&
  value.conversationId === command.conversationId && value.targetAgentId === command.targetAgentId && value.state === 'QUEUED'

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
  validEntityVersion(delivery.workItemVersion) && Array.isArray(delivery.items) && delivery.items.length <= 100 && delivery.items.every(formalItem) &&
  (delivery.state === 'submitted' ? delivery.deliveryVersion === 0 && delivery.reviewedAt == null && delivery.reviewReason == null
    : delivery.deliveryVersion >= 1 && positiveTimestamp(delivery.reviewedAt) &&
      (delivery.state === 'accepted' ? delivery.reviewReason == null : validReviewReason(delivery.reviewReason)))
const validatedPage = (value, taskId) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).every(key => PAGE_FIELDS.has(key)) ||
    !Array.isArray(value.items) || value.items.length > 100 || !value.items.every(item => formalDelivery(item, taskId))) {
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
    const result = unwrap(await api.execute({
      url: `/tasks/${encodeURIComponent(taskId)}/formal-deliveries`, method: 'GET', autoLoading: false, needAuth: true, signal
    }))
    return validatedPage(result, taskId)
  },
  async decide ({ taskId, deliveryId, expectedTaskVersion, expectedDeliveryVersion, decision, reviewReason, idempotencyKey, signal } = {}) {
    const normalizedReviewReason = decision === 'changes_requested' ? String(reviewReason || '') : ''
    if (!validId(taskId) || !validId(deliveryId) || !validEntityVersion(expectedTaskVersion) || !validEntityVersion(expectedDeliveryVersion) ||
      !['accepted', 'changes_requested'].includes(decision) || (decision === 'changes_requested' && !validReviewReason(normalizedReviewReason)) ||
      typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._~:/+-]{8,100}$/.test(idempotencyKey)) {
      throw Object.assign(new Error('正式交付验收请求无效，未发送。'), { retryable: false })
    }
    const body = { expectedTaskVersion, expectedDeliveryVersion, decision }
    if (normalizedReviewReason) body.reviewReason = normalizedReviewReason
    const api = createApi('/agent')
    await api.execute({
      url: `/tasks/${encodeURIComponent(taskId)}/formal-deliveries/${encodeURIComponent(deliveryId)}/decision`, method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey }, data: body, autoLoading: false, needAuth: true, signal
    })
  },
  async createRework ({ taskId, delivery, source, conversationId, targetAgentId, instruction, outputContentMimeType, idempotencyKey, signal } = {}) {
    if (!validId(taskId) || !formalDelivery(delivery, taskId) || delivery.state !== 'changes_requested' || delivery.deliveryVersion < 1 ||
      !reworkSource(source, delivery) || !validId(conversationId) || !validId(targetAgentId) || !validReviewReason(String(instruction || '')) ||
      !validMime(outputContentMimeType) || typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._~:/+-]{8,100}$/.test(idempotencyKey)) {
      throw Object.assign(new Error('正式返工请求无效，未发送。'), { retryable: false })
    }
    const command = { taskId, conversationId, targetAgentId }
    const body = {
      expectedDecisionVersion: delivery.deliveryVersion,
      conversationId,
      targetAgentId,
      sourceOutputId: source.outputId,
      sourceFileId: source.fileRef.fileId,
      sourceFileVersion: Number(source.fileRef.fileVersion),
      instruction: String(instruction).trim(),
      outputContentMimeType
    }
    const api = createApi('/agent')
    const result = unwrap(await api.execute({
      url: `/tasks/${encodeURIComponent(taskId)}/formal-deliveries/${encodeURIComponent(delivery.deliveryId)}/rework-executions`, method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey }, data: body, autoLoading: false, needAuth: true, signal
    }))
    if (!reworkExecution(result, command)) throw new Error('返工执行回执无效，未显示为已创建。')
    return result
  }
})

const defaultIdempotencyKey = () => {
  const value = globalThis.crypto?.randomUUID?.()
  if (!value) throw new Error('当前环境不能生成安全的幂等键，未发送验收决定。')
  return `formal-delivery-${value}`
}
const classifyFailure = failure => {
  if (failure?.name === 'AbortError') return null
  if (failure?.status === 401 || failure?.status === 403) return ['forbidden', '无访问权限。']
  if (failure?.status === 409) return ['conflict', '版本已变化，请刷新正式交付后再决定；系统未自动重试。']
  if (failure?.status >= 400 && failure?.status < 500) return ['error', failure.message || '验收请求未完成。']
  return ['unknown', '结果未知，请刷新正式交付确认；系统未自动重试。']
}

/** Owner-only formal-delivery read/decision boundary. Ownership stays server-derived from the JWT. */
export function useFormalDeliveries ({ taskId, identityFingerprint, adapter = formalDeliveryReadAdapter, idempotencyKeyFactory = defaultIdempotencyKey } = {}) {
  const items = ref([])
  const state = ref('idle')
  const message = ref('')
  const loading = ref(false)
  const busyDeliveryId = ref('')
  const reworkBusyDeliveryId = ref('')
  const refreshRequired = ref(false)
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
    items.value = []; state.value = 'idle'; message.value = ''; loading.value = false; busyDeliveryId.value = ''; reworkBusyDeliveryId.value = ''; refreshRequired.value = false
  }
  const current = (captured, capturedScope, requestController) => !disposed && captured === generation && capturedScope === scope.value && controller === requestController && !requestController.signal.aborted
  const refresh = async () => {
    if (!scope.value || loading.value || busyDeliveryId.value || reworkBusyDeliveryId.value) return null
    const captured = generation
    const capturedTask = taskValue.value
    const capturedScope = scope.value
    controller?.abort(abortError('Formal delivery request replaced'))
    const requestController = new AbortController(); controller = requestController
    loading.value = true; state.value = 'loading'; message.value = ''
    try {
      const rows = await adapter.list({ taskId: capturedTask, signal: requestController.signal })
      if (!current(captured, capturedScope, requestController)) return null
      items.value = rows; state.value = rows.length ? 'ready' : 'empty'; message.value = rows.length ? '' : '暂无正式交付批次。'; refreshRequired.value = false
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
  const decide = async ({ delivery, decision, reviewReason = '' } = {}) => {
    if (controller || busyDeliveryId.value || refreshRequired.value || !scope.value || !formalDelivery(delivery, taskValue.value) || !['accepted', 'changes_requested'].includes(decision) || delivery.state !== 'submitted') return null
    let idempotencyKey
    try { idempotencyKey = idempotencyKeyFactory() } catch (error) { state.value = 'error'; message.value = error.message; return null }
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._~:/+-]{8,100}$/.test(idempotencyKey)) { state.value = 'error'; message.value = '生成的幂等键无效，未发送验收决定。'; return null }
    const captured = generation; const capturedTask = taskValue.value; const capturedScope = scope.value
    const requestController = new AbortController(); controller = requestController; busyDeliveryId.value = delivery.deliveryId; message.value = ''
    try {
      await adapter.decide({ taskId: capturedTask, deliveryId: delivery.deliveryId, expectedTaskVersion: delivery.taskVersion, expectedDeliveryVersion: delivery.revision, decision, reviewReason: decision === 'changes_requested' ? reviewReason : '', idempotencyKey, signal: requestController.signal })
      if (!current(captured, capturedScope, requestController)) return null
      controller = null; busyDeliveryId.value = ''
      const rows = await refresh()
      if (rows) return rows
      if (state.value !== 'forbidden') { state.value = 'unknown'; message.value = '已收到验收决定响应，但请刷新正式交付确认最新结果。'; refreshRequired.value = true }
      return null
    } catch (error) {
      const presentation = classifyFailure(error)
      if (!presentation || !current(captured, capturedScope, requestController)) return null
      state.value = presentation[0]; message.value = presentation[1]
      refreshRequired.value = presentation[0] === 'conflict' || presentation[0] === 'unknown'
      return null
    } finally {
      if (controller === requestController) controller = null
      if (!disposed && captured === generation && capturedScope === scope.value) busyDeliveryId.value = ''
    }
  }

  const createRework = async ({ delivery, source, conversationId, targetAgentId, instruction, outputContentMimeType } = {}) => {
    if (controller || busyDeliveryId.value || reworkBusyDeliveryId.value || refreshRequired.value || !scope.value ||
      !formalDelivery(delivery, taskValue.value) || delivery.state !== 'changes_requested' ||
      !reworkSource(source, delivery) || !validId(conversationId) || !validId(targetAgentId) ||
      !validReviewReason(String(instruction || '')) || !validMime(outputContentMimeType)) return null
    let idempotencyKey
    try { idempotencyKey = idempotencyKeyFactory() } catch (error) { state.value = 'error'; message.value = error.message; return null }
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._~:/+-]{8,100}$/.test(idempotencyKey)) { state.value = 'error'; message.value = '生成的幂等键无效，未发送返工执行。'; return null }
    const captured = generation; const capturedTask = taskValue.value; const capturedScope = scope.value
    const requestController = new AbortController(); controller = requestController; reworkBusyDeliveryId.value = delivery.deliveryId; message.value = ''
    try {
      const result = await adapter.createRework({ taskId: capturedTask, delivery, source, conversationId, targetAgentId, instruction, outputContentMimeType, idempotencyKey, signal: requestController.signal })
      if (!current(captured, capturedScope, requestController)) return null
      state.value = 'ready'; message.value = '返工执行已创建，等待 Agent 交付新的正式成果。'
      return result
    } catch (error) {
      const presentation = classifyFailure(error)
      if (!presentation || !current(captured, capturedScope, requestController)) return null
      state.value = presentation[0]; message.value = presentation[0] === 'unknown'
        ? '返工执行结果未知，请刷新正式交付和执行成果确认；系统未自动重试。' : presentation[1]
      refreshRequired.value = presentation[0] === 'conflict' || presentation[0] === 'unknown'
      return null
    } finally {
      if (controller === requestController) controller = null
      if (!disposed && captured === generation && capturedScope === scope.value) reworkBusyDeliveryId.value = ''
    }
  }

  watch(scope, () => { reset(); if (scope.value) void refresh() }, { immediate: true })
  const unregisterIdentityCleanup = registerIdentityCleanup(reset)
  const dispose = () => { if (disposed) return; disposed = true; reset(); unregisterIdentityCleanup() }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { items, state, message, loading, busyDeliveryId, reworkBusyDeliveryId, refreshRequired, refresh, decide, createRework, dispose }
}
