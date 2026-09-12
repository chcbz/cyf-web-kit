import { computed, ref, unref, watch } from 'vue'
import { createApi } from '../useHttp.js'

const MAX_ITEMS = 8
const ID = value => typeof value === 'string' && value.length > 0 && value.length <= 100 &&
  !/^[\s]|[\s]$|[\x00-\x1f\x7f]/.test(value)
const clone = value => JSON.parse(JSON.stringify(value))
const unwrap = result => {
  let value = result
  for (let index = 0; index < 3 && value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data'); index += 1) value = value.data
  return value
}
const requestKey = () => globalThis.crypto?.randomUUID?.() || `work-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`
const stable = value => JSON.stringify(value)
const editableItem = item => ({
  itemKey: item?.itemKey || '', title: item?.title || '', description: item?.description || '',
  workType: item?.workType || 'implementation', requiredAbilities: Array.isArray(item?.requiredAbilities) ? [...item.requiredAbilities] : [],
  priority: Number.isInteger(item?.priority) ? item.priority : 0,
  requiredItem: item?.requiredItem !== false,
  dependsOn: Array.isArray(item?.dependsOn) ? [...item.dependsOn] : [],
  maxAttempts: Number.isInteger(item?.maxAttempts) ? item.maxAttempts : 3
})
const planItems = plan => Array.isArray(plan?.items) ? plan.items.map(editableItem) : []
const apiFailure = error => {
  if (error?.status === 404 || error?.status === 403) return '任务计划功能暂不可用或当前协调者无权操作。'
  if (error?.status === 409) return '任务计划状态已变化，请重新获取建议后再确认。'
  return error?.message || '请求未完成；尚不能确认已创建工作项。'
}

/** Manual-only E03 client boundary. It never assigns, dispatches, probes, or infers an actor. */
export const useHallWorkItemPlan = ({ api = createApi('/agent'), enabled = false, task, actorAgentId,
  authorizationGeneration = 0, createIdempotencyKey = requestKey } = {}) => {
  const objective = ref('')
  const maxItems = ref(4)
  const dependencyMode = ref('sequential')
  const suggestion = ref(null)
  const items = ref([])
  const state = ref('idle')
  const message = ref('')
  const confirmedItems = ref([])
  const stale = ref(false)
  let generation = 0
  let controller = null
  let confirmFingerprint = ''
  let confirmKey = ''

  const currentTask = computed(() => unref(task) || null)
  const actor = computed(() => unref(actorAgentId) || '')
  const available = computed(() => unref(enabled) === true)
  const identityGeneration = computed(() => unref(authorizationGeneration))
  const operable = computed(() => available.value && ID(currentTask.value?.id) && ID(actor.value))
  const scope = computed(() => `${currentTask.value?.id || ''}\u0000${actor.value}\u0000${identityGeneration.value}`)
  const confirmationBody = () => suggestion.value ? {
    confirmed: true,
    sourcePlanId: suggestion.value.sourcePlanId,
    sourcePlanDigest: suggestion.value.sourcePlanDigest,
    expectedTaskVersion: suggestion.value.expectedTaskVersion,
    items: items.value.map(editableItem)
  } : null
  const validSuggestion = value => value && ID(value.taskId) && typeof value.sourcePlanId === 'string' &&
    typeof value.sourcePlanDigest === 'string' && typeof value.expectedTaskVersion === 'string' && Array.isArray(value.items)
  const matchingConfirmation = (value, body, taskId) => value?.confirmed === true && Array.isArray(value.items) &&
    value.taskId === taskId && value.sourcePlanId === body.sourcePlanId &&
    value.sourcePlanDigest === body.sourcePlanDigest && value.expectedTaskVersion === body.expectedTaskVersion

  const reset = () => {
    generation += 1
    controller?.abort()
    controller = null
    suggestion.value = null; items.value = []; confirmedItems.value = []
    state.value = 'idle'; message.value = ''; stale.value = false
    confirmFingerprint = ''; confirmKey = ''
  }
  watch(scope, reset, { immediate: true, flush: 'sync' })

  const send = async (path, body, headers = {}) => {
    controller?.abort()
    controller = new AbortController()
    return api.execute({ url: path, method: 'POST', data: body, params: { actorAgentId: actor.value },
      autoLoading: false, signal: controller.signal, headers })
  }
  const suggest = async () => {
    // Do not cancel a submitted confirmation: its key must remain available for an
    // explicit retry if the outcome becomes unknown.
    if (state.value === 'confirming') return null
    if (!available.value) { message.value = '任务计划功能尚未在此环境启用。'; return null }
    if (!operable.value) { message.value = '未取得此榜文的明确协调者身份，不能代猜或操作。'; return null }
    const captured = ++generation
    const taskId = currentTask.value.id
    const capturedActor = actor.value
    const capturedIdentityGeneration = identityGeneration.value
    // A fresh suggestion supersedes any prior server plan. A failed refresh must not leave
    // an older plan confirmable under a new intent.
    suggestion.value = null; items.value = []; stale.value = false
    state.value = 'suggesting'; message.value = ''
    try {
      const result = unwrap(await send(`/tasks/${encodeURIComponent(taskId)}/work-item-plans/suggest`, {
        objective: objective.value, maxItems: maxItems.value, dependencyMode: dependencyMode.value
      }, { }))
      if (captured !== generation || taskId !== currentTask.value?.id || capturedActor !== actor.value ||
        capturedIdentityGeneration !== identityGeneration.value) return null
      if (!validSuggestion(result) || result.taskId !== taskId) throw new Error('服务返回的任务计划无效')
      suggestion.value = clone(result); items.value = planItems(result); state.value = 'editing'
      confirmFingerprint = ''; confirmKey = ''
      return result
    } catch (error) {
      if (captured !== generation || error?.name === 'AbortError') return null
      state.value = 'error'; message.value = apiFailure(error)
      return null
    }
  }
  const confirm = async () => {
    if (!operable.value || !suggestion.value || stale.value || state.value === 'confirming') return null
    const body = confirmationBody()
    const fingerprint = stable(body)
    if (fingerprint !== confirmFingerprint) { confirmFingerprint = fingerprint; confirmKey = createIdempotencyKey() }
    const captured = ++generation
    const taskId = currentTask.value.id
    const capturedActor = actor.value
    const capturedIdentityGeneration = identityGeneration.value
    state.value = 'confirming'; message.value = ''
    try {
      const result = unwrap(await send(`/tasks/${encodeURIComponent(taskId)}/work-item-plans/confirm`, body, {
        'Idempotency-Key': confirmKey
      }))
      if (captured !== generation || taskId !== currentTask.value?.id || capturedActor !== actor.value ||
        capturedIdentityGeneration !== identityGeneration.value) return null
      if (!matchingConfirmation(result, body, taskId)) throw new Error('服务确认回执与原计划不匹配')
      confirmedItems.value = clone(result.items); state.value = 'confirmed'; message.value = '已确认创建未分配工作项；未自动点将或派发。'
      return result
    } catch (error) {
      if (captured !== generation || error?.name === 'AbortError') return null
      if (error?.status === 409) stale.value = true
      state.value = 'error'; message.value = apiFailure(error)
      return null
    }
  }
  const dispose = () => { generation += 1; controller?.abort(); controller = null }
  return { MAX_ITEMS, objective, maxItems, dependencyMode, suggestion, items, state, message, confirmedItems, stale, available, operable, suggest, confirm, reset, dispose }
}
