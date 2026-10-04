import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from '../useHttp.js'

const ID = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)
const KEY = value => typeof value === 'string' && /^[A-Za-z0-9._~:/+-]{8,160}$/.test(value)
const HASH = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const decimal = (value, positive = false) => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) &&
  BigInt(value) <= 9223372036854775807n && (!positive || value !== '0')
export const safeFinalizationVersion = value => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null
  return decimal(value) && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
}
const exactKeys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && Object.keys(value).every(key => fields.includes(key))
const text = (value, limit) => typeof value === 'string' && value.trim() === value && value.length > 0 && [...value].length <= limit
const selectionFields = ['requestId', 'stepId', 'outputId', 'sha256', 'title', 'purpose']
const textSelectionFields = ['requestId', 'messageSource', 'sha256', 'title', 'purpose']
const messageFields = ['turnId', 'messageId', 'snapshotId', 'finalDigest']
const validMessageSource = source => exactKeys(source, messageFields) && ID(source.turnId) &&
  decimal(source.messageId, true) && ID(source.snapshotId) &&
  typeof source.finalDigest === 'string' && /^sha256:[0-9a-f]{64}$/.test(source.finalDigest)
const bodyFields = ['expectedTaskVersion', 'expectedAssignmentRevision', 'conversationId', 'summary', 'selectedOutputs']
const validSelection = item => ((exactKeys(item, selectionFields) && ID(item.stepId) && ID(item.outputId)) ||
  (exactKeys(item, textSelectionFields) && validMessageSource(item.messageSource))) &&
  ID(item.requestId) && HASH(item.sha256) && text(item.title, 255) && text(item.purpose, 255)
// The actual persisted message is unique even if a caller changes its snapshot/digest.
const sourceKey = item => item.messageSource
  ? JSON.stringify(['COMPLETED_MESSAGE', item.requestId, item.messageSource.turnId, item.messageSource.messageId])
  : JSON.stringify([item.requestId, item.stepId, item.outputId])
const validBody = body => exactKeys(body, bodyFields) &&
  typeof body.expectedTaskVersion === 'number' && safeFinalizationVersion(body.expectedTaskVersion) != null &&
  typeof body.expectedAssignmentRevision === 'number' && safeFinalizationVersion(body.expectedAssignmentRevision) != null &&
  ID(body.conversationId) && text(body.summary, 4000) && Array.isArray(body.selectedOutputs) &&
  body.selectedOutputs.length >= 1 && body.selectedOutputs.length <= 99 && body.selectedOutputs.every(validSelection) &&
  new Set(body.selectedOutputs.map(sourceKey)).size === body.selectedOutputs.length
const freezeSelection = item => Object.freeze(item.messageSource
  ? { ...item, messageSource: Object.freeze({ ...item.messageSource }) } : { ...item })
const freezeBody = body => Object.freeze({ ...body, selectedOutputs: Object.freeze(body.selectedOutputs.map(freezeSelection)) })
const browserStorage = () => { try { return globalThis.sessionStorage || globalThis.window?.sessionStorage || null } catch { return null } }
const uuid = () => {
  const value = globalThis.crypto?.randomUUID?.()
  if (!value) throw new Error('当前环境无法生成安全验收幂等键，未发送请求。')
  return `conversation-finalize-${value}`
}
const unwrap = response => {
  let value = response
  for (let i = 0; i < 2 && value && typeof value === 'object' && Object.hasOwn(value, 'data'); i++) value = value.data
  return value
}
const stages = new Set(['PROMOTING', 'READY_TO_SUBMIT', 'SUBMITTED', 'ACCEPTING', 'TASK_COMPLETED'])
const receiptFields = ['operationId', 'taskId', 'conversationId', 'state', 'stateVersion', 'stage',
  'expectedTaskVersion', 'expectedAssignmentRevision', 'selectedOutputs', 'deliveryId', 'deliveryState',
  'taskState', 'taskVersion', 'errorCode', 'retryable']
const selectionMatches = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && actual.every((item, i) =>
  validSelection(item) && validSelection(expected[i]) &&
    ((item.messageSource && expected[i].messageSource &&
      textSelectionFields.filter(field => field !== 'messageSource').every(field => item[field] === expected[i][field]) &&
      messageFields.every(field => item.messageSource[field] === expected[i].messageSource[field])) ||
      (!item.messageSource && !expected[i].messageSource && selectionFields.every(field => item[field] === expected[i][field]))))
export function validFinalizationReceipt (value, intent) {
  if (!exactKeys(value, receiptFields) || !ID(value.operationId) || !ID(value.taskId) ||
    value.taskId !== intent.taskId || value.conversationId !== intent.body.conversationId ||
    (intent.operationId && intent.operationId !== value.operationId) ||
    !['pending', 'completed', 'failed'].includes(value.state) || !decimal(value.stateVersion, true) || !stages.has(value.stage) ||
    value.expectedTaskVersion !== String(intent.body.expectedTaskVersion) ||
    value.expectedAssignmentRevision !== String(intent.body.expectedAssignmentRevision) ||
    !selectionMatches(value.selectedOutputs, intent.body.selectedOutputs) || !decimal(value.taskVersion) ||
    BigInt(value.taskVersion) < BigInt(intent.body.expectedTaskVersion) ||
    (value.deliveryId != null && !ID(value.deliveryId)) ||
    (value.deliveryState != null && (typeof value.deliveryState !== 'string' || !/^[a-z_]{1,64}$/.test(value.deliveryState))) ||
    typeof value.taskState !== 'string' || !/^[a-z_]{1,64}$/.test(value.taskState) ||
    (value.errorCode != null && (typeof value.errorCode !== 'string' || !/^[A-Za-z0-9_:-]{1,100}$/.test(value.errorCode))) ||
    typeof value.retryable !== 'boolean') return false
  if (['SUBMITTED', 'ACCEPTING', 'TASK_COMPLETED'].includes(value.stage) && !ID(value.deliveryId)) return false
  if (value.stage === 'TASK_COMPLETED' || value.state === 'completed') {
    return value.stage === 'TASK_COMPLETED' && value.state === 'completed' && value.deliveryState === 'accepted' &&
      value.taskState === 'completed' && ID(value.deliveryId) && !value.errorCode && !value.retryable
  }
  return true
}
const stageOrder = [...stages]
const stageLabel = receipt => ({ PROMOTING: '正在准备成果', READY_TO_SUBMIT: '成果已准备',
  SUBMITTED: '成果已提交', ACCEPTING: '正在验收', TASK_COMPLETED: '验收完成' })[receipt.stage]
const statusCode = error => error?.status ?? error?.response?.status

/** One immutable selected-set acceptance intent. No Provider call or automatic write on recovery. */
export function useHallBountyFinalization ({ api = createApi('/agent'), conversationId = null, identityKey = null,
  storage = browserStorage(), idempotencyKeyFactory = uuid } = {}) {
  const status = ref({ state: 'idle', busy: false, message: '', intent: null, receipt: null })
  const conversation = computed(() => valueOf(conversationId))
  const identity = computed(() => valueOf(identityKey))
  const scopeKey = computed(() => ID(conversation.value) && typeof identity.value === 'string' && identity.value && identity.value.length <= 512
    ? `juyiting:finalization:v1:${encodeURIComponent(identity.value)}:${conversation.value}` : '')
  let generation = 0; let disposed = false
  const controllers = new Set()
  const persist = (intent, required = false) => {
    try {
      if (!storage || !scopeKey.value) throw new Error('missing recovery storage')
      const raw = JSON.stringify(intent)
      storage.setItem(scopeKey.value, raw)
      if (storage.getItem(scopeKey.value) !== raw) throw new Error('recovery readback differs')
      return true
    } catch {
      if (required) throw new Error('无法保存验收进度，请检查浏览器存储后重试。')
      return false
    }
  }
  const reset = () => {
    generation++
    for (const controller of controllers) controller.abort()
    controllers.clear()
    status.value = { state: 'idle', busy: false, message: '', intent: null, receipt: null }
    if (!scopeKey.value || !storage) return
    try {
      const raw = storage.getItem(scopeKey.value)
      if (!raw) return
      const entry = JSON.parse(raw)
      if (!exactKeys(entry, ['taskId', 'idempotencyKey', 'body', 'operationId']) || !ID(entry.taskId) || !KEY(entry.idempotencyKey) ||
        !validBody(entry.body) || entry.body.conversationId !== conversation.value || (entry.operationId !== '' && !ID(entry.operationId))) throw new Error('invalid intent')
      status.value = { state: 'unknown', busy: false, message: '验收尚未完成，可刷新状态或继续验收。',
        intent: Object.freeze({ ...entry, body: freezeBody(entry.body) }), receipt: null }
    } catch {
      status.value = { state: 'recovery_error', busy: false, message: '无法恢复验收进度，请联系支持。', intent: null, receipt: null }
    }
  }
  const active = (snapshot, controller) => !disposed && generation === snapshot.generation && scopeKey.value === snapshot.scopeKey && !controller.signal.aborted
  const request = async (options, snapshot, controller) => {
    const response = await api.execute({ ...options, autoLoading: false, needAuth: true, signal: controller.signal })
    if (!active(snapshot, controller)) throw new DOMException('Finalization scope changed', 'AbortError')
    return unwrap(response)
  }
  const applyReceipt = (raw, snapshot) => {
    if (!validFinalizationReceipt(raw, snapshot.intent)) throw new Error('暂时无法确认验收结果，请刷新状态。')
    const prior = status.value.receipt
    if (prior && (prior.operationId !== raw.operationId || BigInt(raw.stateVersion) < BigInt(prior.stateVersion) ||
      stageOrder.indexOf(raw.stage) < stageOrder.indexOf(prior.stage) ||
      (prior.state === 'completed' && raw.state !== 'completed') ||
      (raw.stateVersion === prior.stateVersion && receiptFields.some(field => field !== 'selectedOutputs' && raw[field] !== prior[field])))) {
      throw new Error('验收状态尚未更新，请稍后刷新。')
    }
    const receipt = Object.freeze({ ...raw, selectedOutputs: freezeBody(snapshot.intent.body).selectedOutputs })
    const intent = Object.freeze({ ...snapshot.intent, operationId: raw.operationId })
    const message = raw.state === 'failed'
      ? (raw.retryable ? '验收未完成，可继续验收。' : '验收未完成，请查看需求状态。')
      : `${stageLabel(raw)}。`
    status.value = { state: raw.state, busy: true, message, intent, receipt }
    persist(intent) // The original key/body was already persisted before any write.
    return receipt
  }
  const fail = (error, snapshot) => {
    const code = statusCode(error)
    const unknown = code === 404 || code >= 500 || error?.requestErrorClass === 'network' || error instanceof TypeError || !code
    status.value = { ...status.value, state: unknown ? 'unknown' : 'error', busy: true,
      message: code === 401 || code === 403 ? '当前账号无权验收此需求。'
        : code === 409 ? '需求状态已变化，请刷新后继续验收。'
          : unknown ? '暂时无法确认验收结果，请刷新状态。'
            : '验收未完成，请刷新状态。', intent: status.value.intent || snapshot.intent }
  }
  const run = async fn => {
    if (disposed || !scopeKey.value || status.value.busy || !status.value.intent) return null
    const snapshot = { generation, scopeKey: scopeKey.value, intent: status.value.intent }
    const controller = new AbortController(); controllers.add(controller)
    status.value = { ...status.value, busy: true }
    try { return await fn(snapshot, controller) }
    catch (error) { if (active(snapshot, controller) && error?.name !== 'AbortError') fail(error, snapshot); return null }
    finally { controllers.delete(controller); if (active(snapshot, controller)) status.value = { ...status.value, busy: false } }
  }
  const read = async (snapshot, controller) => {
    const intent = snapshot.intent
    const root = `/tasks/${encodeURIComponent(intent.taskId)}/finalizations`
    const options = intent.operationId
      ? { url: `${root}/${encodeURIComponent(intent.operationId)}`, method: 'GET' }
      : { url: `${root}/request`, method: 'GET', headers: { 'Idempotency-Key': intent.idempotencyKey } }
    return applyReceipt(await request(options, snapshot, controller), snapshot)
  }
  const post = async (snapshot, controller) => {
    status.value = { ...status.value, state: 'submitting', busy: true, message: '正在验收…' }
    const intent = snapshot.intent
    return applyReceipt(await request({ url: `/tasks/${encodeURIComponent(intent.taskId)}/finalizations`, method: 'POST',
      headers: { 'Idempotency-Key': intent.idempotencyKey }, data: intent.body }, snapshot, controller), snapshot)
  }
  const check = () => run(read)
  const resume = () => run(async (snapshot, controller) => {
    let receipt
    try { receipt = await read(snapshot, controller) }
    catch (error) {
      // A 404 does not prove absence. This explicit action may resend ONLY the same immutable key/body.
      if (statusCode(error) !== 404) throw error
    }
    if (receipt?.state === 'completed' || (receipt?.state === 'failed' && !receipt.retryable)) return receipt
    if (!active(snapshot, controller)) return null
    return post({ ...snapshot, intent: status.value.intent || snapshot.intent }, controller)
  })
  const submit = async command => {
    if (status.value.intent) return resume()
    if (disposed || !scopeKey.value || status.value.busy || status.value.state === 'recovery_error') return null
    try {
      if (!exactKeys(command, ['taskId', 'body']) || !ID(command.taskId) || !validBody(command.body) || command.body.conversationId !== conversation.value) {
        throw new Error('成果或需求已变化，请刷新后重新选择。')
      }
      const idempotencyKey = idempotencyKeyFactory()
      if (!KEY(idempotencyKey)) throw new Error('暂时无法发起验收，请重试。')
      const intent = Object.freeze({ taskId: command.taskId, idempotencyKey, body: freezeBody(command.body), operationId: '' })
      persist(intent, true)
      status.value = { state: 'idle', busy: false, message: '', intent, receipt: null }
    } catch (error) {
      status.value = { ...status.value, state: 'error', busy: false, message: error.message }
      return null
    }
    return run(post)
  }
  const stop = watch(scopeKey, reset, { immediate: true, flush: 'sync' })
  const dispose = () => {
    if (disposed) return
    disposed = true; stop(); generation++; for (const controller of controllers) controller.abort(); controllers.clear()
    status.value = { state: 'idle', busy: false, message: '', intent: null, receipt: null }
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { status, submit, resume, check, dispose }
}
