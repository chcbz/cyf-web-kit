import { computed, getCurrentScope, onScopeDispose, ref, unref, watch } from 'vue'

// Ordinary cancellation uses a JSON integer; funded cancellation keeps its own DTO.
export const ordinaryTaskVersion = task => {
  const value = task?.taskVersion ?? task?.version
  if (typeof value === 'string' && !/^(0|[1-9]\d*)$/.test(value)) return null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const version = Number(value)
  return Number.isSafeInteger(version) && version >= 0 && version < Number.MAX_SAFE_INTEGER ? version : null
}
export const isTerminalMatter = task => ['cancelled', 'completed', 'accepted', 'archived', 'failed'].includes(task?.status)
export const canCancelOrdinaryTask = task => Boolean(task?.id && !task.funding &&
  (task.reward == null || task.reward === 0 || task.reward === '0') &&
  ['open', 'planning', 'assigned'].includes(task.status) && task.startedAt == null && task.completedAt == null &&
  ordinaryTaskVersion(task) !== null)

export const cancellationPayload = result => {
  let body = result
  for (let depth = 0; depth < 4 && body && typeof body === 'object'; depth++) {
    if (Object.hasOwn(body, 'code') && ![undefined, null, 'E0', '0', 0, '200', 200].includes(body.code)) {
      const error = new Error(body.msg || body.message || '请求被拒绝')
      error.code = body.code; error.status = body.status
      throw error
    }
    if (!Object.hasOwn(body, 'data')) break
    body = body.data
  }
  return body
}
const read = source => unref(typeof source === 'function' ? source() : source)

export const useHallOrdinaryCancellation = ({ agentApi, selectedTask, tasks, identityScope = '', identityEpoch = 0,
  sessionKey = '', onCancelled = async () => {}, showToast = () => {}, playSuccess = () => {}, playError = () => {}, log = console }) => {
  const state = ref(null)
  const records = new Map()
  let generation = 0
  let controller = null
  let disposed = false
  let activeRecordKey = null
  const scope = () => `${read(identityEpoch)}\u0000${read(identityScope)}`
  const key = taskId => `${scope()}\u0000${taskId}`
  const invalidate = () => {
    generation++
    const record = records.get(activeRecordKey)
    if (record && ['posting', 'checking'].includes(record.status)) records.set(activeRecordKey, { ...record, status: 'unresolved' })
    controller?.abort(); controller = null
    state.value = records.get(key(selectedTask.value?.id)) || null
  }
  const stop = watch(() => [read(identityScope), read(identityEpoch), read(sessionKey), selectedTask.value?.id], invalidate, { flush: 'sync' })
  const dispose = () => { disposed = true; invalidate(); stop(); state.value = null }
  if (getCurrentScope()) onScopeDispose(dispose)
  const busy = computed(() => ['posting', 'checking'].includes(state.value?.status))

  const cancelTask = async task => {
    if (disposed || !read(identityScope) || task?.id !== selectedTask.value?.id || busy.value) return false
    const recordKey = key(task.id)
    const previous = records.get(recordKey)
    if (!previous && !canCancelOrdinaryTask(task)) return false
    if (previous?.status === 'confirmed') return false
    const expected = previous?.expectedTaskVersion ?? ordinaryTaskVersion(task)
    const identity = scope(); const session = read(sessionKey); const attempt = ++generation
    controller = new AbortController()
    const options = { autoLoading: false, signal: controller.signal }
    const current = () => !disposed && generation === attempt && identity === scope() && session === read(sessionKey) && selectedTask.value?.id === task.id
    activeRecordKey = recordKey
    const update = (status, start = false) => {
      if (!start && records.get(recordKey)?.attempt !== attempt) return
      const record = { taskId: task.id, expectedTaskVersion: expected, status, attempt }
      records.set(recordKey, record)
      if (current()) state.value = record
    }
    // Save uncertainty before POST: leaving the panel never makes another POST safe.
    update(previous ? 'checking' : 'posting', true)
    let receipt = null
    if (!previous) {
      try {
        receipt = cancellationPayload(await agentApi.create(`/tasks/${encodeURIComponent(task.id)}/cancel`,
          { expectedTaskVersion: expected }, options))
        if (receipt?.taskId !== task.id || receipt.status !== 'cancelled' || !Number.isSafeInteger(receipt.taskVersion) || receipt.taskVersion <= expected) {
          receipt = null
          throw new Error('取消回执不匹配')
        }
      } catch (error) {
        if (!current()) { update('unresolved'); return false }
        const status = Number(error?.status ?? error?.response?.status)
        if ([400, 401, 403, 404, 409].includes(status)) {
          records.delete(recordKey); state.value = null
          playError()
          showToast(error.code === 'INITIAL_CANCEL_UNSUPPORTED' ? '当前事项不支持普通取消：仅限无资金事实且未实际开始的事项。' :
            error.code === 'TASK_VERSION_CONFLICT' ? '事项版本已变化，取消未提交；请刷新后核对。' :
              status === 403 || status === 401 ? '无权取消此事项，请核对当前身份。' :
                status === 409 ? '取消被拒绝：状态不支持或版本冲突，请刷新核对。' : '取消被拒绝，请刷新核对原事项。')
          return false
        }
        log.warn('ordinary cancellation outcome unknown:', error)
      }
    }
    if (!current()) { update('unresolved'); return false }
    update('checking')
    let canonical = null
    try {
      canonical = cancellationPayload(await agentApi.get(`/tasks/${encodeURIComponent(task.id)}`, undefined, options))
      if (canonical?.id !== task.id || canonical.status !== 'cancelled' || ordinaryTaskVersion(canonical) === null ||
        ordinaryTaskVersion(canonical) < (receipt?.taskVersion ?? expected + 1)) canonical = null
    } catch (error) { log.warn('ordinary cancellation readback pending:', error) }
    if (!current()) { update('unresolved'); return false }
    if (!receipt && !canonical) {
      update('unresolved'); playError()
      showToast('取消结果尚未确认；请核对原事项，不会重复提交取消。')
      return false
    }
    // Merge, never clear the historical assignment to make a cancelled task look unassigned.
    const patch = canonical || { status: 'cancelled', taskVersion: receipt.taskVersion }
    for (const snapshot of new Set([task, selectedTask.value, ...tasks.value.filter(item => item.id === task.id)])) Object.assign(snapshot, patch)
    update('confirmed')
    let refreshed = Boolean(canonical)
    try { await onCancelled(task, { isCurrent: current, signal: options.signal }) } catch (error) {
      refreshed = false; log.warn('ordinary cancellation projections refresh pending:', error)
    }
    if (!current()) return false
    playSuccess()
    showToast(refreshed ? '事项已取消，历史指派与成果保留。' : '事项已取消确认；刷新待完成，请重查，勿重复取消。')
    return true
  }
  return { cancelTask, cancellationState: state, cancellationBusy: busy, dispose }
}
