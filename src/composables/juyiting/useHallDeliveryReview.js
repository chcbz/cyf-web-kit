import { batchMatchesSelection } from './hallSelectedOutputs.js'
import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from '../useHttp.js'
import { batchDigest, freezeReviewIntent, freezeReviewValue, reviewId, validateContext, validateReceipt, validReviewIntent } from './hallDeliveryReviewIntent.js'
const read = value => typeof value === 'function' ? value() : unref(value)
const browserStorage = () => { try { return globalThis.sessionStorage || globalThis.window?.sessionStorage || null } catch { return null } }
const keyFactory = () => { if (!globalThis.crypto?.randomUUID) throw new Error('无法生成验收标识，未提交。'); return `review-${globalThis.crypto.randomUUID()}` }

/** One instance per task projection in the page shell; reads and remounts never submit. */
export function useHallDeliveryReview ({ api = createApi('/agent'), taskId, identityScope, authorizationGeneration = 0, enabled = true, storage = browserStorage(), idempotencyKeyFactory = keyFactory } = {}) {
  const context = ref(null); const loading = ref(false); const error = ref(''); const dialogOpen = ref(false); const frozenContext = ref(null)
  const operation = ref({ state: 'idle', busy: false, intent: null, receipt: null, message: '' })
  const scope = computed(() => read(identityScope)); const task = computed(() => read(taskId))
  const slot = computed(() => read(enabled) && typeof scope.value === 'string' && scope.value && scope.value.length <= 1024 && reviewId(task.value)
    ? `cyf.hall.delivery-review.v1:${encodeURIComponent(scope.value)}:${task.value}` : '')
  let epoch = 0; let readEpoch = 0; let disposed = false
  const controllers = new Set()
  const controller = () => { const c = new AbortController(); controllers.add(c); return c }
  const current = (version, c) => !disposed && epoch === version && !c.signal.aborted
  const options = c => ({ autoLoading: false, needAuth: true, signal: c.signal })
  const failStorage = () => { throw new Error('无法可靠保存原验收操作，未发送请求；请检查浏览器存储。') }
  const persist = intent => {
    if (!storage || !slot.value) failStorage()
    const raw = JSON.stringify(intent); storage.setItem(slot.value, raw); if (storage.getItem(slot.value) !== raw) failStorage()
  }
  const recover = () => {
    if (!slot.value || !storage) return
    try {
      const raw = storage.getItem(slot.value); if (raw === null) return
      const intent = JSON.parse(raw)
      if (!validReviewIntent(intent, scope.value, task.value)) throw new Error('无法核对原验收记录，请保留记录并联系支持。')
      operation.value = { state: 'UNKNOWN', busy: false, intent: freezeReviewValue(intent), receipt: null, message: '有原验收操作，正在只读核对。' }
    } catch (cause) { operation.value = { state: 'recovery_error', busy: false, intent: null, receipt: null, message: cause.message || '无法读取原验收记录。' } }
  }
  const refresh = async () => {
    if (!slot.value || disposed) return null
    const version = epoch; const serial = ++readEpoch; const c = controller(); const id = task.value
    loading.value = true; error.value = ''
    try {
      const raw = await api.get(`/tasks/${encodeURIComponent(id)}/delivery-review-context`, {}, options(c))
      const next = validateContext(raw, id)
      for (const batch of [next.currentDelivery, ...next.history].filter(Boolean)) if (await batchDigest(id, batch) !== batch.batchSha256) throw new Error('成果批次摘要不一致，请重新核对。')
      if (!current(version, c) || serial !== readEpoch) return null
      const frozen = frozenContext.value
      if (frozen && JSON.stringify([frozen.taskVersion, frozen.assignmentRevision, frozen.currentDelivery]) !== JSON.stringify([next.taskVersion, next.assignmentRevision, next.currentDelivery])) {
        dialogOpen.value = false; frozenContext.value = null; error.value = '成果或事项已更新，请重新查看后再验收。'
      }
      context.value = next
      return next
    } catch (cause) {
      if (current(version, c) && serial === readEpoch) { context.value = null; error.value = cause.message || '读取成果失败，请重新读取。' }
      return null
    } finally { controllers.delete(c); if (current(version, c) && serial === readEpoch) loading.value = false }
  }
  const apply = (raw, intent) => {
    const receipt = validateReceipt(raw, intent, operation.value.receipt)
    const next = freezeReviewValue({ ...intent, operationId: receipt.operationId, receiptVersion: receipt.stateVersion })
    persist(next)
    operation.value = { state: receipt.state, busy: true, intent: next, receipt, message: receipt.state === 'COMMITTED' ? '已确认验收。' : receipt.state === 'REJECTED' ? '原验收未通过，请重新核对事项。' : '原验收正在处理，可查询状态。' }
    if (receipt.state === 'COMMITTED') { dialogOpen.value = false; frozenContext.value = null }
    return receipt
  }
  const requestOriginal = async method => {
    const intent = operation.value.intent
    if (!slot.value || !intent || operation.value.busy || !validReviewIntent(intent, scope.value, task.value)) return null
    const version = epoch; const c = controller()
    operation.value = { ...operation.value, busy: true, message: method === 'POST' ? '正在提交原验收操作…' : '正在核对原验收状态…' }
    try {
      // Readback before *every* POST, including explicit resumption. No fresh key on uncertainty.
      if (method === 'POST') persist(intent)
      const url = `/tasks/${encodeURIComponent(intent.taskId)}/delivery-review-operations${method === 'GET' ? intent.operationId ? `/${encodeURIComponent(intent.operationId)}` : '/request' : ''}`
      const raw = await api.execute({ ...options(c), url, method, ...(method === 'POST' ? { data: intent.body } : {}), headers: { 'Idempotency-Key': intent.key } })
      if (!current(version, c)) return null
      const receipt = apply(raw, intent)
      await refresh()
      return current(version, c) ? receipt : null
    } catch (cause) {
      if (current(version, c)) operation.value = { ...operation.value, state: 'UNKNOWN', message: cause.message || '尚未确认结果；请查询原操作，不要重复创建。' }
      return null
    } finally { controllers.delete(c); if (current(version, c)) operation.value = { ...operation.value, busy: false } }
  }
  const checkOriginal = () => requestOriginal('GET')
  const resumeOriginal = () => requestOriginal('POST')
  const openConfirmation = async expected => {
    if (operation.value.busy || operation.value.intent || operation.value.state === 'recovery_error') { if (operation.value.intent) await checkOriginal(); return false }
    const version = epoch; const next = await refresh()
    if (version !== epoch || !next?.currentDelivery?.allowedActions.includes('ACCEPT')) return false
    if (expected && ((expected.assignmentRevision != null && next.assignmentRevision !== expected.assignmentRevision) || next.currentDelivery.deliveryId !== expected.deliveryId || !batchMatchesSelection(next.currentDelivery, expected.selectedOutputs))) {
      error.value = '当前交付与选定成果不一致，未提交验收。'; return false
    }
    frozenContext.value = next; dialogOpen.value = true; return true
  }
  const confirmAcceptance = async () => {
    if (!dialogOpen.value || !frozenContext.value || operation.value.busy || operation.value.intent || loading.value || error.value) return null
    try {
      // The displayed frozen set, not a newly read batch, is the user's explicit decision.
      const intent = freezeReviewIntent(frozenContext.value, scope.value, idempotencyKeyFactory())
      persist(intent)
      operation.value = { state: 'UNKNOWN', busy: false, intent, receipt: null, message: '' }
      return await requestOriginal('POST')
    } catch (cause) { error.value = cause.message || '无法保存原操作，未提交。'; return null }
  }
  const settleOriginal = async () => {
    const intent = operation.value.intent; const receipt = operation.value.receipt
    if (!intent || !receipt || !['COMMITTED', 'REJECTED'].includes(receipt.state) || operation.value.busy) return false
    const version = epoch; const next = await refresh()
    if (version !== epoch || !next || BigInt(next.taskVersion) < BigInt(receipt.taskVersion)) return false
    if (receipt.state === 'COMMITTED' && (next.taskState !== 'COMPLETED' || next.currentDelivery?.deliveryId !== receipt.deliveryId || next.currentDelivery?.state !== 'ACCEPTED')) return false
    try {
      const saved = JSON.parse(storage.getItem(slot.value))
      if (!validReviewIntent(saved, scope.value, task.value) || JSON.stringify(saved) !== JSON.stringify(intent)) failStorage()
      storage.removeItem(slot.value)
      if (storage.getItem(slot.value) !== null) failStorage()
      operation.value = { ...operation.value, intent: null }
      return true
    } catch (cause) { error.value = cause.message || '原验收恢复记录未能清理，请保留并核对。'; return false }
  }
  const close = () => { if (operation.value.busy) return; dialogOpen.value = false; frozenContext.value = null }
  const reset = () => {
    epoch++; readEpoch++; for (const c of controllers) c.abort(); controllers.clear()
    context.value = null; error.value = ''; loading.value = false; dialogOpen.value = false; frozenContext.value = null
    operation.value = { state: 'idle', busy: false, intent: null, receipt: null, message: '' }
    if (slot.value && !disposed) { recover(); void refresh(); if (operation.value.intent) void checkOriginal() }
  }
  const stopWatching = watch(() => [slot.value, read(authorizationGeneration)], reset, { immediate: true, flush: 'sync' })
  const dispose = () => { disposed = true; stopWatching(); reset() }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  const canReview = computed(() => context.value?.currentDelivery?.allowedActions.includes('ACCEPT') && !loading.value && !error.value &&
    !operation.value.intent && operation.value.state !== 'recovery_error')
  // Hide recovery controls only after the same operation's authoritative batch is confirmed.
  // Keep the durable intent for safe reload/readback; UNKNOWN never becomes success here.
  const recoveryNeeded = computed(() => {
    const op = operation.value; const next = context.value; const receipt = op.receipt
    if (!op.intent) return op.state === 'recovery_error'
    return !(op.state === 'COMMITTED' && receipt?.state === 'COMMITTED' && next?.taskId === op.intent.taskId &&
      next.taskState === 'COMPLETED' && BigInt(next.taskVersion) >= BigInt(receipt.taskVersion) &&
      next.currentDelivery?.deliveryId === receipt.deliveryId && next.currentDelivery?.state === 'ACCEPTED' &&
      BigInt(next.currentDelivery.deliveryVersion) >= BigInt(receipt.deliveryVersion))
  })
  return { recoveryNeeded, context, loading, error, dialogOpen, frozenContext, operation, canReview, refresh, openConfirmation, confirmAcceptance, checkOriginal, resumeOriginal, settleOriginal, close, dispose }
}
