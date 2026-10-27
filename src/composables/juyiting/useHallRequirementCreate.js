import { computed, ref, unref, watch } from 'vue'
import { createRequirementCreateIntentStore, requirementCreateBody, requirementMaterialsBody, requirementReceiptForIntent } from './hallRequirementCreateIntent.js'

const valueOf = value => typeof value === 'function' ? value() : unref(value)
const clone = value => JSON.parse(JSON.stringify(value))
const unwrap = result => result
const initial = () => ({ status: 'IDLE', intent: null, error: null })
const storageError = state => state === 'CORRUPT'
  ? '原需求保存操作恢复记录损坏；未创建另一份事项，请核对原请求。'
  : '原需求保存操作恢复记录不可用；未创建另一份事项。'

/** Creates a task and its references through the atomic owner endpoint, never
 * independent /tasks + link POSTs. Mount/identity refresh only reconcile GET. */
export const useHallRequirementCreate = ({ agentApi, actorScopeKey, identityEpoch = 0, storage = null, schemaVersion = 1,
  createIdempotencyKey = () => globalThis.crypto.randomUUID(), onCommitted = () => true } = {}) => {
  if (![1, 2].includes(schemaVersion)) throw new TypeError('Unsupported requirement create schema')
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
    const receipt = requirementReceiptForIntent(unwrap(value), intent)
    if (!receipt) throw new Error('暂时无法确认需求是否保存，请查询结果，勿重复创建事项。')
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
  const route = intent => `/tasks/creation-operations${intent.schemaVersion === 2 ? '/v2' : ''}`
  const query = intent => agentApi.get(`${route(intent)}/request`, undefined, {
    autoLoading: false, needAuth: true, headers: { 'Idempotency-Key': intent.key }
  })
  const send = intent => agentApi.create(route(intent), clone(intent.body), {
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
          error: error?.status === 404 ? '原操作尚未查到；不代表没有受理。请核对原需求，再明确继续原需求保存操作。'
            : error?.code === 'IDEMPOTENCY_CONFLICT' ? '需求内容已变化，请核对上次提交的内容，勿重复创建事项。'
              : '原需求保存操作结果未完成核对；请检查原请求，不要创建另一份事项。' }
      }
      return false
    } finally { if (current(c)) busy.value = false }
  }
  const create = payload => run('POST', c => {
    const read = readOriginal()
    if (read.state === 'PRESENT') {
      state.value = { ...state.value, error: '已有原需求保存操作待核对；当前编辑稿未提交。' }
      return null
    }
    if (read.state !== 'ABSENT') return null
    const body = schemaVersion === 2 ? requirementMaterialsBody(payload) : requirementCreateBody(payload)
    if (!body) { state.value = { ...initial(), status: 'INVALID_DRAFT', error: '请提供完整需求及精确资料版本。' }; return null }
    try { return persist({ schemaVersion, key: createIdempotencyKey(), body, receipt: null }, c) } catch {
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
