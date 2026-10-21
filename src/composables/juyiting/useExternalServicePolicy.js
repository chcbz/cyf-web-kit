import { computed, ref, watch } from 'vue'
import { exactPointAndStartId, exactPointAndStartScope, pointAndStartLong } from './hallPointAndStartIntent.js'

const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name))
export const externalPolicyProjection = (value, agentId) => keys(value, ['agentId', 'enabled', 'revision']) &&
  value.agentId === agentId && typeof value.enabled === 'boolean' && pointAndStartLong(value.revision, true)
  ? Object.freeze({ ...value }) : null
const validIntent = (value, scope, agentId) => keys(value, ['scope', 'agentId', 'key', 'requestId', 'body']) &&
  value.scope === scope && value.agentId === agentId && exactPointAndStartId(value.key) && exactPointAndStartId(value.requestId) &&
  keys(value.body, ['enabled', 'expectedRevision']) && typeof value.body.enabled === 'boolean' && pointAndStartLong(value.body.expectedRevision, true)

/** Owner detail only. Auth/target/binding/visibility fence every read and write.
 * A hidden panel cancels observation, not the durable original intent. Same-Agent
 * projection refreshes do not reset writes; current policy is never a PUT receipt. */
export const useExternalServicePolicy = ({ api, getAgent, identityScope, authorizationGeneration = () => 0,
  enabled = () => true, storage, createKey = () => globalThis.crypto.randomUUID() }) => {
  const policy = ref(null)
  const receipt = ref(null)
  const intent = ref(null)
  const status = ref('IDLE')
  const error = ref('')
  const busy = ref(false)
  let epoch = 0
  let disposed = false
  let controller = null
  const allowed = () => enabled() && exactPointAndStartScope(identityScope()) &&
    exactPointAndStartId(getAgent()?.agentId) && getAgent()?.boundToMe === true &&
    getAgent()?.canOperate === true && !getAgent()?.systemAgent
  const fingerprint = () => JSON.stringify([identityScope(), authorizationGeneration(), getAgent()?.agentId,
    getAgent()?.bindingId, allowed()])
  const slot = () => `cyf.juyiting.external-policy.v1:${encodeURIComponent(identityScope())}:${encodeURIComponent(getAgent()?.agentId || '')}`
  const readIntent = () => {
    if (!storage) throw new Error('无法读取原开关操作记录，暂不可修改')
    const raw = storage.getItem(slot())
    if (raw === null) return null
    const saved = JSON.parse(raw)
    if (!validIntent(saved, identityScope(), getAgent().agentId)) throw new Error('原开关操作记录损坏，请核对；未发送新操作')
    return saved
  }
  const saveIntent = value => {
    storage.setItem(slot(), JSON.stringify(value))
    if (JSON.stringify(readIntent()) !== JSON.stringify(value)) throw new Error('原操作保存未核对，未发送')
    intent.value = value
  }
  const clearIntent = original => {
    const saved = readIntent()
    if (saved && JSON.stringify(saved) !== JSON.stringify(original)) throw new Error('原操作记录已变化，请重新核对；未删除其他操作')
    if (saved) storage.removeItem(slot())
    if (readIntent()) throw new Error('原操作记录尚未清除，请核对')
    intent.value = null
  }
  const path = () => `/${encodeURIComponent(getAgent().agentId)}/external-service-policy`
  const reset = () => {
    epoch++; controller?.abort(); controller = null
    policy.value = null; receipt.value = null; intent.value = null
    status.value = 'IDLE'; error.value = ''; busy.value = false
  }
  const run = async action => {
    if (!allowed() || disposed || busy.value) return false
    const generation = ++epoch, scope = fingerprint(), own = new AbortController()
    controller = own; busy.value = true; error.value = ''
    const current = () => !disposed && generation === epoch && scope === fingerprint() && !own.signal.aborted
    try { return await action(current, own.signal) } catch (cause) {
      if (current()) {
        status.value = intent.value ? 'UNKNOWN' : 'UNAVAILABLE'
        error.value = cause?.message || '接外单设置暂不可用，请重试'
      }
      return false
    } finally { if (current()) { busy.value = false; controller = null } }
  }
  const options = (signal, original) => ({ autoLoading: false, needAuth: true, signal,
    ...(original ? { headers: { 'Idempotency-Key': original.key, 'X-Request-Id': original.requestId } } : {}) })
  const load = async (current, signal) => {
    status.value = 'LOADING'
    const raw = await api.get(path(), undefined, options(signal))
    if (!current()) return false
    const value = externalPolicyProjection(raw, getAgent().agentId)
    if (!value) throw new Error('接外单设置返回未核对，请重试')
    policy.value = value; status.value = 'READY'
    return true
  }
  const refresh = () => run(async (current, signal) => {
    intent.value = readIntent()
    if (intent.value) { status.value = 'UNKNOWN'; return false }
    return load(current, signal)
  })
  const accept = async (raw, original, current, signal) => {
    if (!current()) return false
    const value = externalPolicyProjection(raw, original.agentId)
    if (!value || value.enabled !== original.body.enabled || BigInt(value.revision) !== BigInt(original.body.expectedRevision) + 1n) {
      throw new Error('原开关回执未核对；请继续查询原操作')
    }
    // Keep the original fixed receipt distinct from a newer current policy.
    receipt.value = value
    clearIntent(original)
    policy.value = null
    return load(current, signal)
  }
  const send = async (original, current, signal, firstAttempt = false) => {
    status.value = 'SAVING'
    let raw
    try { raw = await api.put(path(), { ...original.body }, options(signal, original)) } catch (cause) {
      if (!current()) return false
      if (firstAttempt && [400, 401, 403, 404, 409, 422].includes(cause?.status)) {
        // Definitive rejection is not a timeout. Reload before a new intent.
        clearIntent(original)
        policy.value = null
        status.value = 'UNAVAILABLE'
      }
      throw cause
    }
    return accept(raw, original, current, signal)
  }
  const setEnabled = value => run(async (current, signal) => {
    const original = readIntent()
    if (original) { intent.value = original; status.value = 'UNKNOWN'; return false }
    if (typeof value !== 'boolean' || status.value !== 'READY' || !policy.value) return false
    const record = { scope: identityScope(), agentId: getAgent().agentId, key: createKey(), requestId: createKey(),
      body: { enabled: value, expectedRevision: policy.value.revision } }
    saveIntent(record)
    return send(record, current, signal, true)
  })
  const checkOriginal = () => run(async (current, signal) => {
    const original = readIntent()
    if (!original) return load(current, signal)
    intent.value = original; status.value = 'UNKNOWN'
    try {
      const raw = await api.get(`${path()}/request`, undefined, options(signal, original))
      return await accept(raw, original, current, signal)
    } catch (cause) {
      if (cause?.status === 404) throw new Error('原操作尚未查到，结果仍未知；只能以原键继续，不能另开操作')
      throw cause
    }
  })
  const resumeOriginal = () => run(async (current, signal) => {
    const original = readIntent()
    if (!original) return false
    intent.value = original
    return send(original, current, signal)
  })
  const stop = watch(fingerprint, () => { reset(); if (allowed()) void refresh() }, { immediate: true, flush: 'sync' })
  return { policy, receipt, intent, status, error, busy, refresh, setEnabled, checkOriginal, resumeOriginal,
    canWrite: computed(() => allowed() && status.value === 'READY' && !busy.value && !intent.value),
    dispose: () => { disposed = true; stop(); reset() } }
}
