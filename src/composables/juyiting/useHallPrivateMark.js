import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { agentApi as defaultApi } from '../useHttp.js'
import { registerIdentityCleanup } from '../../utils/identityLifecycle.js'

const PREFIX = 'cyf.hall.private-mark-intent.v1'
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && value === value.trim() &&
  ![...value].some(char => char.codePointAt(0) < 32)
const revision = value => Number.isSafeInteger(value) && value >= 0
export const privateMarkRef = value => ['PRIVATE_CASE', 'LEGACY_EXECUTION'].includes(value?.sourceType) && id(value.sourceId)
export const markResultRef = value => value === null || Boolean(id(value?.executionId) && id(value?.manifestId))
export const sameMarkResult = (first, second) => first?.executionId === second?.executionId && first?.manifestId === second?.manifestId
const sameRef = (first, second) => first?.sourceType === second?.sourceType && first?.sourceId === second?.sourceId
const validView = (value, source) => value && sameRef(value.ref, source) && revision(value.revision) &&
  typeof value.archived === 'boolean' && markResultRef(value.viewedResultRef) && revision(value.updatedAt)
const validCommand = value => value && revision(value.expectedRevision) && value.expectedRevision < Number.MAX_SAFE_INTEGER &&
  typeof value.archived === 'boolean' && markResultRef(value.viewedResultRef)
const validIntent = (value, source) => value && sameRef(value.ref, source) && id(value.key) && validCommand(value.command)
const abort = () => new DOMException('Private mark identity changed', 'AbortError')
const unwrap = response => response?.data?.data ?? response?.data ?? response
const defaultKey = () => globalThis.crypto?.randomUUID?.() || ''

/** MARK-v1 only. Its explicit same-key PATCH reconciliation is never an execution retry. */
export function useHallPrivateMark ({ sourceRef, identityScope = '', identityEpoch = 0, api = defaultApi,
  storage = globalThis.localStorage || globalThis.window?.localStorage, keyFactory = defaultKey } = {}) {
  const mark = ref(null)
  const pending = ref(null)
  const conflict = ref(null)
  const busy = ref(false)
  const currentKnown = ref(false)
  const error = ref('')
  const source = computed(() => valueOf(sourceRef))
  const scope = computed(() => typeof valueOf(identityScope) === 'string' ? valueOf(identityScope).trim() : '')
  const enabled = computed(() => Boolean(scope.value && privateMarkRef(source.value)))
  const storageKey = () => enabled.value ? `${PREFIX}.${encodeURIComponent(scope.value)}.${source.value.sourceType}.${encodeURIComponent(source.value.sourceId)}` : ''
  const endpoint = () => `/hall/items/${source.value.sourceType}/${encodeURIComponent(source.value.sourceId)}/mark`
  let generation = 0
  let disposed = false
  const controllers = new Set()
  const readIntent = () => {
    const key = storageKey()
    if (!key || !storage) return { ok: false, intent: null }
    try {
      const value = JSON.parse(storage.getItem(key) || 'null')
      return { ok: value === null || validIntent(value, source.value), intent: validIntent(value, source.value) ? value : null }
    } catch { return { ok: false, intent: null } }
  }
  const saveIntent = intent => {
    const key = storageKey()
    if (!key || !storage || !validIntent(intent, source.value)) return false
    // Only opaque refs, CAS revision, desired booleans and the operation key. No text or file body.
    const encoded = JSON.stringify({ key: intent.key, ref: intent.ref, command: intent.command })
    try { storage.setItem(key, encoded); return storage.getItem(key) === encoded } catch { return false }
  }
  const clearIntent = intent => {
    if (readIntent().intent?.key !== intent.key) return
    try { storage.removeItem(storageKey()) } catch { /* A retained key can only be explicitly reconciled. */ }
  }
  const reset = ({ restore = true } = {}) => {
    generation += 1
    for (const controller of controllers) controller.abort(abort())
    controllers.clear()
    mark.value = null
    pending.value = restore ? readIntent().intent : null
    conflict.value = null
    busy.value = false
    currentKnown.value = false
    error.value = ''
  }
  const request = async options => {
    if (disposed || !enabled.value) throw abort()
    const captured = generation
    const controller = new AbortController()
    controllers.add(controller)
    try {
      const response = await api.execute({ ...options, needAuth: true, autoLoading: false, signal: controller.signal })
      if (disposed || captured !== generation || controller.signal.aborted) throw abort()
      return unwrap(response)
    } catch (cause) {
      if (disposed || captured !== generation || controller.signal.aborted) throw abort()
      throw cause
    } finally { controllers.delete(controller) }
  }
  const load = async () => {
    if (!enabled.value || busy.value) return null
    const captured = generation
    busy.value = true
    currentKnown.value = false
    error.value = ''
    pending.value = readIntent().intent
    try {
      const value = await request({ url: endpoint(), method: 'GET' })
      if (!validView(value, source.value)) throw new Error('invalid mark')
      mark.value = value
      currentKnown.value = true
      // GET has no operation key. Even a matching state does not unlock an unknown PATCH.
      return value
    } catch (cause) {
      if (cause?.name !== 'AbortError') {
        if ([401, 403, 404].includes(cause?.status)) mark.value = null
        error.value = '当前个人整理状态未能核对；原操作仍保留，请重新授权或重读。'
      }
      return null
    } finally { if (captured === generation) busy.value = false }
  }
  const send = async (intent, replay = false) => {
    if (!enabled.value || busy.value || !validIntent(intent, source.value)) return null
    const captured = generation
    busy.value = true
    error.value = ''
    currentKnown.value = false
    pending.value = intent
    let accepted = null
    try {
      const value = await request({ url: endpoint(), method: 'PATCH', headers: { 'Idempotency-Key': intent.key }, data: intent.command })
      if (!validView(value, source.value) || value.revision !== intent.command.expectedRevision + 1 ||
        value.archived !== intent.command.archived || (intent.command.viewedResultRef && !sameMarkResult(value.viewedResultRef, intent.command.viewedResultRef))) {
        throw new Error('invalid mark receipt')
      }
      clearIntent(intent)
      pending.value = readIntent().intent
      conflict.value = null
      mark.value = value
      accepted = value
    } catch (cause) {
      if (cause?.name !== 'AbortError') {
        if (!replay && cause?.status >= 400 && cause.status < 500) {
          clearIntent(intent)
          pending.value = readIntent().intent
          conflict.value = intent.command
          error.value = cause.status === 412
            ? '个人整理状态已变化，本次选择仍保留。请重读后明确重新确认，不会自动覆盖。'
            : '本次标记被明确拒绝，选择仍保留；请重读状态后处理。'
        } else {
          error.value = '原标记结果尚不确定；只能按原请求核对，不会另发新的标记。'
        }
        if ([401, 403, 404].includes(cause?.status)) mark.value = null
      }
    } finally { if (captured === generation) busy.value = false }
    if (accepted && captured === generation) await load()
    return accepted
  }
  const change = async ({ archived, viewedResultRef = null } = {}, { retryConflict = false } = {}) => {
    if (!enabled.value || busy.value || !currentKnown.value || !mark.value || (conflict.value && !retryConflict)) return null
    const stored = readIntent()
    if (!stored.ok || stored.intent) {
      pending.value = stored.intent
      error.value = stored.intent ? '请先核对原标记，不能另发新的操作。' : '无法安全保存原标记标识，未发送操作。'
      return null
    }
    const command = { expectedRevision: mark.value.revision, archived, viewedResultRef }
    let key
    try { key = keyFactory() } catch { key = '' }
    const intent = { key, ref: { ...source.value }, command }
    if (!validIntent(intent, source.value) || !saveIntent(intent)) {
      error.value = '无法安全保存原标记标识，未发送操作。'
      return null
    }
    return send(intent)
  }
  const reconcile = () => {
    const intent = readIntent().intent
    return intent ? send(intent, true) : Promise.resolve(null)
  }
  const retryConflict = () => conflict.value
    ? change({ archived: conflict.value.archived, viewedResultRef: conflict.value.viewedResultRef }, { retryConflict: true }) : Promise.resolve(null)
  const cancelConflict = () => { if (!busy.value) conflict.value = null }
  watch([scope, () => source.value?.sourceType, () => source.value?.sourceId, () => valueOf(identityEpoch)], () => reset(), { immediate: true, flush: 'sync' })
  const unregister = registerIdentityCleanup(() => reset({ restore: false }))
  const dispose = () => { disposed = true; unregister(); reset({ restore: false }) }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { mark, pending, conflict, busy, currentKnown, error, enabled, load, change, reconcile, retryConflict, cancelConflict, dispose }
}
