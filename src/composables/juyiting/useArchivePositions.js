import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createApi } from '../useHttp'
import { createEconomyRequestIntentStore } from './economyRequestIntent.js'
import { registerIdentityCleanup } from '../../utils/identityLifecycle.js'

const empty = () => ({ skills: [], positions: [], appointments: [], installations: [] })
const digest = async body => {
  const bytes = new TextEncoder().encode(JSON.stringify(body))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
}

/** Persist only identity-scoped recovery references/metadata, never credentials or source text. */
export const useArchivePositions = ({ identityScope, identityEpoch = () => 0,
  positionApi = createApi('/agent/positions/v1'),
  storage = globalThis.sessionStorage, createKey = () => crypto.randomUUID() } = {}) => {
  const positions = ref(empty()), busy = ref(false), error = ref(''), notice = ref(''), pending = ref(null)
  let generation = 0, disposed = false, controller = null, pendingSlot = 'position-mutation'
  const scope = () => identityScope?.() || ''
  const storeFor = identity => createEconomyRequestIntentStore({ storage, scopeKey: () => `archive-maintenance:${identity}` })
  const snapshot = () => ({ identity: scope(), epoch: identityEpoch(), generation })
  const current = s => !disposed && s.identity && s.identity === scope() && s.epoch === identityEpoch() && s.generation === generation
  const reset = () => { generation++; controller?.abort(); positions.value = empty(); busy.value = false; error.value = ''; notice.value = ''; pending.value = null }
  const inspect = () => {
    if (!scope()) return null
    // Preserve legacy job evidence without querying or replaying retired maintenance APIs.
    const store = storeFor(scope())
    const legacy = store.get('mutation')
    if (legacy.state === 'PRESENT' && !['position', 'job'].includes(legacy.record.body.kind)) throw new Error('恢复记录类型未知，已停止新操作。')
    pendingSlot = legacy.state === 'PRESENT' && legacy.record.body.kind === 'position' ? 'mutation' : 'position-mutation'
    const found = pendingSlot === 'mutation' ? legacy : store.get(pendingSlot)
    if (found.state === 'PRESENT') {
      if (found.record.body.kind !== 'position') throw new Error('任职恢复记录类型未知，已停止新操作。')
      pending.value = found.record; return found.record
    }
    if (found.state !== 'ABSENT') throw new Error('恢复记录不可读，已停止新操作；请先核对当前身份和浏览器存储。')
    pending.value = null; return null
  }
  const recover = async () => {
    const s = snapshot(), saved = inspect()
    if (!saved || !current(s)) return null
    try {
      const result = await positionApi.get('/operations/request', {}, { headers: { 'Idempotency-Key': saved.key }, signal: controller?.signal, autoLoading: false })
      if (!current(s)) return null
      if (storeFor(s.identity).remove(pendingSlot).state !== 'ABSENT') throw new Error('结果已查到，但恢复引用尚未清除；请再次查询，不要重复提交。')
      pending.value = null; notice.value = ''; return result
    } catch (failure) {
      if (!current(s)) return null
      if (failure.status === 404) { notice.value = '暂未查到提交结果。保留原键；可核对原表单并重试，不能创建重复操作。'; return null }
      throw failure
    }
  }
  const reload = async () => {
    const s = snapshot(); if (!current(s) || busy.value) return
    busy.value = true; error.value = ''; controller = new AbortController()
    try {
      await recover()
      if (!current(s)) return
      const p = await positionApi.get('', {}, { signal: controller.signal, autoLoading: false })
      if (!current(s)) return
      if (!['skills', 'positions', 'appointments', 'installations'].every(key => Array.isArray(p?.[key]))) throw new Error('任职接口返回结构不正确')
      positions.value = p
    } catch (failure) { if (current(s)) error.value = failure.message || '任职状态暂不可查' }
    finally { if (current(s)) busy.value = false }
  }
  const mutate = async (path, body, retry = false) => {
    const kind = 'position'
    const s = snapshot(); if (!current(s) || busy.value) return null
    busy.value = true; error.value = ''; notice.value = ''; controller = new AbortController()
    let freshSubmission = false
    try {
      const requestDigest = await digest({ kind, path, body }); if (!current(s)) return null
      let saved = inspect()
      if (saved && (!retry || saved.body.requestDigest !== requestDigest)) throw new Error('存在原操作未决，请先恢复；重试必须使用完全相同的输入。')
      if (!saved) {
        if (retry) throw new Error('没有可重试的原操作')
        const metadata = { ...body }
        const record = { key: createKey(), body: { kind, path, requestDigest, metadata } }
        const persisted = storeFor(s.identity).save(pendingSlot, record)
        if (persisted.state !== 'PRESENT' || persisted.record.key !== record.key) throw new Error('无法可靠保存操作引用，尚未发送请求。')
        saved = persisted.record; pending.value = saved; freshSubmission = true
      }
      const result = await positionApi.post(path, body, { headers: { 'Idempotency-Key': saved.key }, signal: controller.signal, autoLoading: false })
      if (!current(s)) return null
      if (storeFor(s.identity).remove(pendingSlot).state !== 'ABSENT') throw new Error('操作已受理，但恢复引用尚未清除；请重新查询。')
      pending.value = null; notice.value = '已受理，请查看安装进度。'
      return result
    } catch (failure) {
      if (current(s)) {
        // Only an original request's validated domain rejection proves that transaction did not commit.
        // A rejection on an ambiguous retry says nothing about the first request; keep its recovery key.
        const rejected = freshSubmission && failure.failureClass === 'http' && [400, 403, 404, 409].includes(failure.status) &&
          /^(?:POSITION_|APPOINTMENT_)/.test(failure.code || '') && !failure.code.includes('IDEMPOTENCY_CONFLICT')
        if (rejected && storeFor(s.identity).remove(pendingSlot).state === 'ABSENT') pending.value = null
        error.value = failure.message || '操作结果未知，请恢复原操作'
      }
      return null
    } finally { if (current(s)) { const mutationError = error.value; busy.value = false; await reload(); if (current(s) && mutationError) error.value = mutationError } }
  }
  const submit = (path, body) => mutate(path, body)
  const retry = () => {
    const p = inspect(); if (!p) return null
    return mutate(p.body.path, { ...p.body.metadata }, true)
  }
  const stop = watch([scope, identityEpoch], () => { reset(); if (scope()) void reload() }, { immediate: true, flush: 'sync' })
  const cleanup = registerIdentityCleanup(reset)
  onBeforeUnmount(() => { reset(); disposed = true; stop(); cleanup() })
  return { positions, busy, error, notice, pending, blocked: computed(() => busy.value || !!pending.value || !scope()), reload, submit, retry }
}
