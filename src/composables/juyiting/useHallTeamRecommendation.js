import { computed, ref, unref, watch } from 'vue'
import { createApi } from '../useHttp.js'

const ID = value => typeof value === 'string' && value.length > 0 && value.length <= 100 &&
  value.trim() === value
const INTEGER = value => Number.isInteger(value) && value >= 0
const clone = value => JSON.parse(JSON.stringify(value))
const unwrap = result => {
  let value = result
  for (let index = 0; index < 3 && value && typeof value === 'object' && Object.hasOwn(value, 'data'); index += 1) value = value.data
  return value
}
const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.length > 0) : []
const highRiskFor = task => task?.riskLevel === 'high'
const hasRequiredReviewer = task => highRiskFor(task) || task?.reviewRequired === true
const teamFailure = error => {
  if (error?.status === 404) return '团队推荐暂不可用；此榜文或该接口尚未提供。'
  if (error?.status === 403) return '当前身份无权取得团队推荐预览。'
  if (error?.status === 409) return '榜文状态已变化；请刷新榜文后再手动获取推荐。'
  return error?.message || '团队推荐未完成；尚未确认任何成员。'
}

const validPreview = (value, taskId, requiredReviewer) => value && value.taskId === taskId &&
  value.previewOnly === true && value.autoDispatchAllowed === false && value.monetaryCostKnown === false &&
  value.costModel === 'NON_MONETARY_TEAM_SLOT' && typeof value.highRisk === 'boolean' &&
  Array.isArray(value.members) && Array.isArray(value.candidates) &&
  value.members.every(member => ID(member?.agentId) && typeof member.role === 'string' && INTEGER(member.costUnits)) &&
  value.candidates.every(candidate => ID(candidate?.agentId) && typeof candidate.eligible === 'boolean' &&
    typeof candidate.selected === 'boolean' && INTEGER(candidate.costUnits)) &&
  (!requiredReviewer || value.independentReviewerRequired === true)

/** E07 is a preview-only, manual client boundary. It never confirms a team, assigns, or dispatches. */
export const useHallTeamRecommendation = ({ api = createApi('/agent'), task, authorizationGeneration = 0 } = {}) => {
  const maxTeamSize = ref(4)
  const budgetUnits = ref(4)
  const preview = ref(null)
  const state = ref('idle')
  const message = ref('')
  const manualSelectedIds = ref([])
  let generation = 0
  let controller = null

  const currentTask = computed(() => unref(task) || null)
  const identityGeneration = computed(() => unref(authorizationGeneration))
  const taskId = computed(() => currentTask.value?.id || '')
  const highRisk = computed(() => highRiskFor(currentTask.value))
  const reviewerRequired = computed(() => hasRequiredReviewer(currentTask.value))
  const maxAgents = computed(() => Number.isInteger(currentTask.value?.maxAgents) && currentTask.value.maxAgents > 0
    ? currentTask.value.maxAgents : 0)
  const operable = computed(() => ID(taskId.value) && ['low', 'medium', 'high'].includes(currentTask.value?.riskLevel) &&
    typeof currentTask.value?.reviewRequired === 'boolean' && maxAgents.value > 0)
  const scope = computed(() => `${taskId.value}\u0000${currentTask.value?.riskLevel || ''}\u0000${currentTask.value?.reviewRequired}\u0000${maxAgents.value}\u0000${identityGeneration.value}`)
  const selectedIdSet = computed(() => new Set(manualSelectedIds.value))
  const memberById = computed(() => new Map((preview.value?.members || []).map(member => [member.agentId, member])))
  const lockedReviewerIds = computed(() => new Set((preview.value?.members || [])
    .filter(member => member.role === 'REVIEWER').map(member => member.agentId)))
  const localLimit = computed(() => {
    const responseMax = preview.value?.maxTeamSize
    const responseBudget = preview.value?.budgetUnits
    const max = Number.isInteger(responseMax) && responseMax >= 0 ? responseMax : 0
    const budget = Number.isInteger(responseBudget) && responseBudget >= 0 ? responseBudget : 0
    return Math.min(max, budget)
  })
  const localMembers = computed(() => (preview.value?.candidates || [])
    .filter(candidate => selectedIdSet.value.has(candidate.agentId))
    .map(candidate => ({ ...candidate, role: memberById.value.get(candidate.agentId)?.role || 'PRODUCER' })))
  const localOverride = computed(() => {
    const baseline = (preview.value?.members || []).map(member => member.agentId)
    return baseline.length !== manualSelectedIds.value.length || baseline.some(id => !selectedIdSet.value.has(id))
  })
  const localConstraintsSatisfied = computed(() => localMembers.value.length <= localLimit.value &&
    (!reviewerRequired.value || (preview.value?.independentReviewerSatisfied === true &&
      [...lockedReviewerIds.value].every(id => selectedIdSet.value.has(id)))) &&
    localMembers.value.every(member => member.eligible === true))

  const reset = () => {
    generation += 1
    controller?.abort()
    controller = null
    preview.value = null
    manualSelectedIds.value = []
    state.value = 'idle'
    message.value = ''
  }
  watch(scope, () => {
    const defaultSize = maxAgents.value ? Math.min(4, maxAgents.value) : 4
    maxTeamSize.value = defaultSize
    budgetUnits.value = defaultSize
    reset()
  }, { immediate: true, flush: 'sync' })

  const request = async () => {
    if (state.value === 'loading') return null
    if (!operable.value) {
      message.value = '榜文缺少权威风险、复核要求或人数上限，不能代猜推荐请求。'
      return null
    }
    if (!Number.isInteger(maxTeamSize.value) || maxTeamSize.value < 1 ||
      !Number.isInteger(budgetUnits.value) || budgetUnits.value < 0) {
      message.value = '人数上限和非货币席位预算必须是有效整数。'
      return null
    }
    const captured = ++generation
    const capturedTaskId = taskId.value
    const capturedIdentityGeneration = identityGeneration.value
    controller?.abort()
    controller = new AbortController()
    preview.value = null
    manualSelectedIds.value = []
    state.value = 'loading'
    message.value = ''
    const body = {
      maxTeamSize: maxTeamSize.value,
      budgetUnits: budgetUnits.value,
      highRisk: highRisk.value,
      independentReviewerRequired: reviewerRequired.value
    }
    try {
      const result = unwrap(await api.execute({
        url: `/tasks/${encodeURIComponent(capturedTaskId)}/team-recommendation`,
        method: 'POST', data: body, autoLoading: false, signal: controller.signal
      }))
      if (captured !== generation || capturedTaskId !== taskId.value || capturedIdentityGeneration !== identityGeneration.value) return null
      if (!validPreview(result, capturedTaskId, reviewerRequired.value) || result.highRisk !== highRisk.value) {
        throw new Error('服务返回的团队预览与当前榜文约束不一致')
      }
      preview.value = clone(result)
      manualSelectedIds.value = result.members.map(member => member.agentId)
      state.value = 'ready'
      return result
    } catch (error) {
      if (captured !== generation || error?.name === 'AbortError') return null
      state.value = 'error'
      message.value = teamFailure(error)
      return null
    }
  }

  const canToggleCandidate = candidate => {
    if (!candidate?.eligible || !ID(candidate.agentId)) return false
    if (lockedReviewerIds.value.has(candidate.agentId)) return false
    if (selectedIdSet.value.has(candidate.agentId)) return true
    return localMembers.value.length < localLimit.value
  }
  const toggleCandidate = candidate => {
    if (!canToggleCandidate(candidate)) return false
    const id = candidate.agentId
    manualSelectedIds.value = selectedIdSet.value.has(id)
      ? manualSelectedIds.value.filter(item => item !== id)
      : [...manualSelectedIds.value, id]
    return true
  }
  const dispose = () => { generation += 1; controller?.abort(); controller = null }

  return {
    maxTeamSize, budgetUnits, preview, state, message, operable, highRisk, reviewerRequired,
    localMembers, localOverride, localConstraintsSatisfied, localLimit, lockedReviewerIds,
    request, toggleCandidate, canToggleCandidate, reset, dispose,
    strings
  }
}
