import { computed, ref, unref, watch } from 'vue'
import { createRequirementCreateIntentStore, requirementCreateBody, requirementCreateReceipt } from './hallRequirementCreateIntent.js'

const valueOf = value => typeof value === 'function' ? value() : unref(value)
const clone = value => JSON.parse(JSON.stringify(value))
const unwrap = result => {
  const envelope = result?.data ?? result
  if (envelope && Object.hasOwn(envelope, 'code')) {
    if (!['E0', '0', 0, '200', 200].includes(envelope.code)) {
      const error = new Error('原张榜请求未确认')
      error.code = envelope.code; error.status = envelope.status
      throw error
    }
    return envelope.data
  }
  return envelope
}
const initial = () => ({ status: 'IDLE', intent: null, error: null })
const storageError = state => state === 'CORRUPT'
  ? '原张榜恢复记录损坏；未创建另一份榜文，请核对原请求。'
  : '原张榜恢复记录不可用；未创建另一份榜文。'

/** Creates a task and its references through the atomic owner endpoint, never
 * independent /tasks + link POSTs. Mount/identity refresh only reconcile GET. */
export const useHallRequirementCreate = ({ agentApi, actorScopeKey, identityEpoch = 0, storage = null,
  createIdempotencyKey = () => globalThis.crypto.randomUUID(), onCommitted = () => true } = {}) => {
  const scope = computed(() => valueOf(actorScopeKey))
  const authEpoch = computed(() => valueOf(identityEpoch))
  const state = ref(initial())
  const busy = ref(false)
  let generation = 0
  let disposed = false
  const storeFor = captured => createRequirementCreateIntentStore({ storage, scope: captured })
  const capture = () => ({ scope: scope.value, authEpoch: authEpoch.value, generation })
  const current = c => !disposed && c.scope === scope.value && c.authEpoch === authEpoch.value && c.generation === generation
  const readOriginal = () => {
    const read = storeFor(scope.value).read()
    if (read.state === 'PRESENT') state.value = { status: read.record.receipt ? 'COMMITTED' : 'UNKNOWN', intent: read.record, error: null }
    else if (read.state === 'ABSENT') state.value = initial()
    else state.value = { status: read.state === 'CORRUPT' ? 'STORAGE_CORRUPT' : 'STORAGE_UNAVAILABLE', intent: null, error: storageError(read.state) }
    return read
  }
  const persist = (intent, c) => {
    const read = storeFor(c.scope).write(intent)
    if (read.state !== 'PRESENT') throw new Error(storageError(read.state))
    return read.record
  }
  const adopt = async (value, intent, c) => {
    if (!current(c)) return false
    const receipt = requirementCreateReceipt(unwrap(value), intent)
    if (!receipt) throw new Error('张榜回执与原需求或精确资料不一致；请核对原操作，未另行创建。')
    const confirmed = persist({ ...intent, receipt }, c)
    if (!current(c)) return false
    state.value = { status: 'COMMITTED', intent: confirmed, error: null }
    if (await onCommitted(clone(receipt), { isCurrent: () => current(c) }) !== true || !current(c)) return false
    const removed = storeFor(c.scope).settle(confirmed)
    if (removed.state !== 'ABSENT') throw new Error(storageError(removed.state))
    if (!current(c)) return false
    state.value = initial()
    return true
  }
  const query = intent => agentApi.get('/tasks/creation-operations/request', undefined, {
    autoLoading: false, needAuth: true, headers: { 'Idempotency-Key': intent.key }
  })
  const send = intent => agentApi.create('/tasks/creation-operations', clone(intent.body), {
    autoLoading: false, needAuth: true, headers: { 'Idempotency-Key': intent.key }
  })
  const run = async (action, getIntent) => {
    if (disposed || busy.value) return false
    const c = capture()
    const intent = getIntent(c)
    if (!intent) return false
    busy.value = true
    state.value = { status: action === 'POST' ? 'POSTING' : 'CHECKING', intent, error: null }
    try {
      return await adopt(await (action === 'POST' ? send(intent) : query(intent)), intent, c)
    } catch (error) {
      if (current(c)) {
        const retained = storeFor(c.scope).read().record || intent
        state.value = { status: retained.receipt ? 'COMMITTED' : 'UNKNOWN', intent: retained,
          error: error?.status === 404 ? '原操作尚未查到；不代表没有受理。请核对原需求，再明确继续原张榜。'
            : error?.code === 'IDEMPOTENCY_CONFLICT' ? '原键与服务端需求不一致；请核对原请求，未使用新键重试。'
              : '原张榜结果未完成核对；请检查原请求，不要创建另一份榜文。' }
      }
      return false
    } finally { if (current(c)) busy.value = false }
  }
  const create = payload => run('POST', c => {
    const read = readOriginal()
    if (read.state === 'PRESENT') {
      state.value = { ...state.value, error: '已有原张榜待核对；当前编辑稿未提交。' }
      return null
    }
    if (read.state !== 'ABSENT') return null
    const body = requirementCreateBody(payload)
    if (!body) { state.value = { ...initial(), status: 'INVALID_DRAFT', error: '请提供完整需求及精确参考图版本。' }; return null }
    try { return persist({ schemaVersion: 1, key: createIdempotencyKey(), body, receipt: null }, c) } catch {
      readOriginal(); return null
    }
  })
  const original = () => {
    const read = readOriginal()
    return read.state === 'PRESENT' ? read.record : null
  }
  const checkOriginal = () => run('GET', original)
  // Only explicit user action invokes POST. Any stored committed receipt is
  // reconciled through GET instead; never replay a known committed write.
  const resumeOriginal = () => {
    const read = storeFor(scope.value).read()
    return run(read.record?.receipt ? 'GET' : 'POST', original)
  }
  const stopWatch = watch([scope, authEpoch], () => {
    generation++; busy.value = false; state.value = initial()
    if (readOriginal().state === 'PRESENT') void checkOriginal()
  }, { immediate: true, flush: 'sync' })
  return { state, busy, create, checkOriginal, resumeOriginal, readOriginal,
    dispose: () => { disposed = true; generation++; stopWatch(); busy.value = false } }
}
