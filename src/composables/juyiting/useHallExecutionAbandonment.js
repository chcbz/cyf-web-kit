import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from '../useHttp.js'

const REASON = 'OWNER_ABANDONED_UNDELIVERED'
const MAX = 9223372036854775807n
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)
const key = value => typeof value === 'string' && /^[A-Za-z0-9._~:/+-]{8,100}$/.test(value)
const version = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= MAX
const keys = (object, names) => object && typeof object === 'object' && !Array.isArray(object) &&
  Object.keys(object).length === names.length && Object.keys(object).every(name => names.includes(name))
const bodyFields = ['stepId', 'executionId', 'expectedRequestStateVersion', 'expectedStepStateVersion', 'reason']
const validBody = body => keys(body, bodyFields) && id(body.stepId) && body.stepId.length <= 64 && id(body.executionId) && body.executionId.length <= 64 &&
  version(body.expectedRequestStateVersion) && BigInt(body.expectedRequestStateVersion) < MAX &&
  version(body.expectedStepStateVersion) && BigInt(body.expectedStepStateVersion) < MAX && body.reason === REASON
const freeze = intent => Object.freeze({ ...intent, body: Object.freeze({ ...intent.body }) })
const validIntent = intent => keys(intent, ['conversationId', 'requestId', 'idempotencyKey', 'body']) &&
  id(intent.conversationId) && id(intent.requestId) && key(intent.idempotencyKey) && validBody(intent.body)
const receiptFields = ['operationId', 'conversationId', 'requestId', 'stepId', 'executionId', 'state', 'requestStateVersion',
  'stepStateVersion', 'reason', 'providerAlreadyStarted', 'providerStopped', 'paidFactsPreserved']
export const abandonmentCommand = (request, conversationId) => {
  if (!id(conversationId) || request?.conversationId !== conversationId || !id(request?.requestId) ||
    request.state !== 'RUNNING' || !Array.isArray(request.steps) || request.steps.length !== 1) return null
  const step = request.steps[0]
  if (step?.kind !== 'EXECUTE' || step.state !== 'RUNNING' || step.executionState !== 'RUNNING') return null
  const body = { stepId: step.stepId, executionId: step.executionId, expectedRequestStateVersion: request.stateVersion,
    expectedStepStateVersion: step.stateVersion, reason: REASON }
  return validBody(body) ? Object.freeze(body) : null
}
export const validAbandonmentReceipt = (receipt, intent) => validIntent(intent) && keys(receipt, receiptFields) &&
  typeof receipt.operationId === 'string' && /^[0-9a-f]{64}$/.test(receipt.operationId) &&
  receipt.conversationId === intent.conversationId && receipt.requestId === intent.requestId &&
  receipt.stepId === intent.body.stepId && receipt.executionId === intent.body.executionId && receipt.state === 'CANCELLED' &&
  receipt.requestStateVersion === String(BigInt(intent.body.expectedRequestStateVersion) + 1n) &&
  receipt.stepStateVersion === String(BigInt(intent.body.expectedStepStateVersion) + 1n) && receipt.reason === REASON &&
  receipt.providerAlreadyStarted === true && receipt.providerStopped === false && receipt.paidFactsPreserved === true
const browserStorage = () => { try { return globalThis.window?.sessionStorage ?? null } catch { return null } }
const uuid = () => { if (!globalThis.crypto?.randomUUID) throw new Error('无法创建安全操作标识'); return `abandon-${globalThis.crypto.randomUUID()}` }
const unwrap = value => value?.data?.data ?? value?.data ?? value
const initial = () => ({ state: 'idle', busy: false, message: '', intent: null, receipt: null })

/** Explicit owner action only. Recovery keeps the original key/body; it never retries generation. */
export const useHallExecutionAbandonment = ({ api = createApi('/chat'), conversationId, identityKey,
  storage = browserStorage(), idempotencyKeyFactory = uuid } = {}) => {
  const status = ref(initial())
  const conversation = computed(() => valueOf(conversationId))
  const identity = computed(() => valueOf(identityKey))
  const scopeKey = computed(() => id(conversation.value) && typeof identity.value === 'string' && identity.value && identity.value.length <= 512
    ? `juyiting:execution-abandon:v1:${encodeURIComponent(identity.value)}:${conversation.value}` : '')
  let generation = 0; let disposed = false
  const controllers = new Set()
  const reset = () => {
    generation++
    for (const controller of controllers) controller.abort()
    controllers.clear(); status.value = initial()
    if (!scopeKey.value) return
    try {
      const raw = storage?.getItem(scopeKey.value)
      if (!raw) return
      const intent = JSON.parse(raw)
      if (!validIntent(intent) || intent.conversationId !== conversation.value) throw new Error('invalid original intent')
      status.value = { ...initial(), state: 'unknown', intent: freeze(intent), message: '已恢复原放弃操作，请先查询结果；不会自动再次生成。' }
    } catch {
      status.value = { ...initial(), state: 'recovery_error', message: '原操作恢复凭据无法核验，未覆盖记录或发送新操作。' }
    }
  }
  const current = (snapshot, controller) => !disposed && snapshot.generation === generation && snapshot.scopeKey === scopeKey.value && !controller.signal.aborted
  const run = async method => {
    if (disposed || !scopeKey.value || status.value.busy || !status.value.intent || status.value.state === 'recovery_error') return null
    const snapshot = { generation, scopeKey: scopeKey.value, intent: status.value.intent }
    const controller = new AbortController(); controllers.add(controller)
    status.value = { ...status.value, busy: true, message: method === 'GET' ? '正在查询原放弃操作…' : '正在提交原放弃操作…' }
    try {
      const response = await api.execute({ method, url: `/conversations/${encodeURIComponent(snapshot.intent.conversationId)}/requests/${encodeURIComponent(snapshot.intent.requestId)}/abandon-execution`,
        ...(method === 'POST' ? { data: snapshot.intent.body } : {}), headers: { 'Idempotency-Key': snapshot.intent.idempotencyKey },
        autoLoading: false, needAuth: true, signal: controller.signal })
      if (!current(snapshot, controller)) return null
      const receipt = unwrap(response)
      if (!validAbandonmentReceipt(receipt, snapshot.intent) || (status.value.receipt && receiptFields.some(field => status.value.receipt[field] !== receipt[field]))) throw new Error('原放弃操作回执不匹配')
      status.value = { state: 'completed', busy: true, intent: snapshot.intent, receipt: Object.freeze({ ...receipt }),
        message: '本轮未交付结果已放弃；已发生的费用不撤销，不代表服务商已停止执行。' }
      return status.value.receipt
    } catch (cause) {
      if (!current(snapshot, controller)) return null
      const code = cause?.status ?? cause?.response?.status
      // Even a GET404 may race a committed POST. Keep the original operation; never infer "not executed".
      status.value = { ...status.value, state: status.value.receipt ? 'completed' : 'unknown', busy: true,
        message: code === 409 ? '执行状态已变化或已有成果；请刷新议事并查询原操作，未放弃已有成果。'
          : code === 401 || code === 403 ? '当前身份无权核对原操作；未显示终止成功。'
            : '尚不能确认原操作结果；请查询或继续原操作，原幂等键已保留。' }
      return null
    } finally {
      controllers.delete(controller)
      if (current(snapshot, controller)) status.value = { ...status.value, busy: false }
    }
  }
  const submit = async request => {
    if (disposed || !scopeKey.value || status.value.busy || status.value.state === 'recovery_error') return null
    if (status.value.intent && status.value.state !== 'completed') return null
    if (status.value.receipt?.requestId === request?.requestId) return status.value.receipt
    const body = abandonmentCommand(request, conversation.value)
    if (!body) { status.value = { ...status.value, message: '当前不是可结束的单轮执行，请刷新议事状态。' }; return null }
    try {
      const intent = freeze({ conversationId: conversation.value, requestId: request.requestId, idempotencyKey: idempotencyKeyFactory(), body })
      if (!validIntent(intent)) throw new Error('invalid key')
      if (!storage) throw new Error('missing recovery storage')
      const raw = JSON.stringify(intent)
      storage.setItem(scopeKey.value, raw)
      if (storage.getItem(scopeKey.value) !== raw) throw new Error('recovery readback differs')
      status.value = { ...initial(), state: 'ready', intent }
    } catch {
      status.value = { ...status.value, state: 'recovery_error', message: '无法保存原操作恢复凭据，未发送放弃请求。' }
      return null
    }
    return run('POST')
  }
  const stop = watch(scopeKey, reset, { immediate: true, flush: 'sync' })
  const dispose = () => {
    disposed = true; generation++; stop()
    for (const controller of controllers) controller.abort()
    controllers.clear(); status.value = initial()
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { status, submit, check: () => run('GET'), resume: () => status.value.state === 'completed' ? Promise.resolve(status.value.receipt) : run('POST'), dispose }
}
