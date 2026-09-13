import { computed, getCurrentInstance, onUnmounted, ref, unref, watch } from 'vue'
import { createApi } from '../useHttp.js'

const MAX_ARTIFACT_VERSION = 2147483647
const MAX_SAFE_OUTCOME_VERSION = Number.MAX_SAFE_INTEGER - 1
const hasControl = value => Array.from(value).some(character => {
  const code = character.codePointAt(0)
  return code < 32 || (code >= 127 && code <= 159)
})
const ID = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && !/^\s|\s$/.test(value) && !hasControl(value)
const resolveValue = value => typeof value === 'function' ? value() : unref(value)
const unwrap = result => {
  let value = result
  for (let index = 0; index < 3 && value && typeof value === 'object' && Object.hasOwn(value, 'data'); index += 1) value = value.data
  return value
}
const exactArtifactVersion = value => Number.isInteger(value) && value >= 1 && value <= MAX_ARTIFACT_VERSION
const workspaceArtifact = item => ID(item?.artifactId) && exactArtifactVersion(Number(item?.artifactVersion))
const ACCEPTED_FIELDS = new Set('artifactId taskId workItemId producerAgentId artifactType title contentHash artifactVersion visibility createdAt outcomeState outcomeVersion decisionId decidedByAgentId decidedAt'.split(' '))
const acceptedRow = (row, taskId) => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).every(key => ACCEPTED_FIELDS.has(key)) &&
  ID(row.artifactId) && row.taskId === taskId && (row.workItemId == null || ID(row.workItemId)) &&
  ID(row.producerAgentId) && typeof row.artifactType === 'string' && row.artifactType.length > 0 &&
  typeof row.title === 'string' && row.title.length > 0 && typeof row.contentHash === 'string' && /^[0-9a-f]{64}$/.test(row.contentHash) &&
  exactArtifactVersion(row.artifactVersion) && typeof row.visibility === 'string' && Number.isSafeInteger(row.createdAt) && row.createdAt > 0 &&
  row.outcomeState === 'accepted' && Number.isSafeInteger(row.outcomeVersion) && row.outcomeVersion >= 1 && row.outcomeVersion <= MAX_SAFE_OUTCOME_VERSION &&
  ID(row.decisionId) && ID(row.decidedByAgentId) && Number.isSafeInteger(row.decidedAt) && row.decidedAt > 0
const errorPresentation = error => {
  if (error?.status === 403 || error?.status === 404) return ['inaccessible', '当前身份或任务不可访问；已清除本次选择。']
  if (error?.status === 409) return ['conflict', '裁决版本已变化。请先刷新权威接受结果，再重新选择；未自动重试。']
  if (error?.status === 503) return ['unavailable', '成果裁决服务暂不可用（默认未启用时会返回此状态）。']
  if (error?.requestErrorClass === 'network' || error instanceof TypeError) return ['unknown', '网络结果不明确，尚不能确认裁决；请先刷新确认，未自动重试。']
  return ['error', error?.message || '成果裁决未完成；尚不能确认结果。']
}
const defaultIdempotencyKey = () => {
  const value = globalThis.crypto?.randomUUID?.()
  if (!value) throw new Error('当前环境不能生成安全的幂等键，未发送裁决。')
  return `f06-${value}`
}

/** F06 client boundary: workspace artifacts are only selectable references; outcome state is never inferred from them. */
export const useHallArtifactOutcomes = ({ api = createApi('/agent'), subject, workspace, identityEpoch = 0, idempotencyKeyFactory = defaultIdempotencyKey } = {}) => {
  const accepted = ref([])
  const acceptedState = ref('idle')
  const acceptedMessage = ref('')
  const acceptedSelection = ref('')
  const supersededSelections = ref([])
  const refreshRequired = ref(false)
  const confirmed = ref(false)
  const submitState = ref('idle')
  const submitMessage = ref('')
  const receipt = ref(null)
  let generation = 0
  let listController = null
  let submitController = null

  const currentSubject = computed(() => resolveValue(subject) || null)
  const currentWorkspace = computed(() => resolveValue(workspace) || null)
  const currentEpoch = computed(() => resolveValue(identityEpoch))
  const taskId = computed(() => currentSubject.value?.taskId || '')
  // The actor is intentionally captured only as an async fence. JWT is the sole authority on wire.
  const actorAgentId = computed(() => currentSubject.value?.actorAgentId || '')
  const operable = computed(() => ID(taskId.value) && ID(actorAgentId.value))
  const scope = computed(() => `${taskId.value}\u0000${actorAgentId.value}\u0000${String(currentEpoch.value)}`)
  const workspaceArtifacts = computed(() => {
    const rows = Array.isArray(currentWorkspace.value?.recentArtifacts) ? currentWorkspace.value.recentArtifacts : []
    const keys = new Set()
    return rows.filter(item => {
      if (!workspaceArtifact(item) || accepted.value.some(row => row.artifactId === item.artifactId && row.artifactVersion === Number(item.artifactVersion))) return false
      const key = `${item.artifactId}\u0000${Number(item.artifactVersion)}`
      if (keys.has(key)) return false
      keys.add(key)
      return true
    }).map(item => ({ ...item, artifactVersion: Number(item.artifactVersion), key: `${item.artifactId}\u0000${Number(item.artifactVersion)}` }))
  })
  const selectedArtifact = computed(() => workspaceArtifacts.value.find(item => item.key === acceptedSelection.value) || null)
  const selectedSuperseded = computed(() => accepted.value.filter(row => supersededSelections.value.includes(`${row.artifactId}\u0000${row.artifactVersion}`)))
  const busy = computed(() => acceptedState.value === 'loading' || submitState.value === 'submitting')
  const readReady = computed(() => acceptedState.value === 'ready' || acceptedState.value === 'empty')
  const canSubmit = computed(() => operable.value && readReady.value && !busy.value && !refreshRequired.value && Boolean(selectedArtifact.value) && confirmed.value)
  const current = (captured, capturedTask, capturedActor, capturedEpoch, controller) => captured === generation && !controller.signal.aborted && capturedTask === taskId.value && capturedActor === actorAgentId.value && capturedEpoch === currentEpoch.value
  const clearSelection = () => { acceptedSelection.value = ''; supersededSelections.value = []; confirmed.value = false; receipt.value = null }
  const reset = () => {
    generation += 1
    listController?.abort(); submitController?.abort(); listController = null; submitController = null
    accepted.value = []; acceptedState.value = 'idle'; acceptedMessage.value = ''; submitState.value = 'idle'; submitMessage.value = ''
    refreshRequired.value = false; clearSelection()
  }
  const request = (options, controller) => api.execute({ ...options, autoLoading: false, needAuth: true, signal: controller.signal })

  const refreshAccepted = async () => {
    if (listController || submitController || !operable.value) return null
    const captured = ++generation
    const capturedTask = taskId.value; const capturedActor = actorAgentId.value; const capturedEpoch = currentEpoch.value
    const controller = new AbortController(); listController = controller
    clearSelection(); submitState.value = 'idle'; submitMessage.value = ''
    acceptedState.value = 'loading'; acceptedMessage.value = ''
    try {
      const rows = unwrap(await request({ url: `/tasks/${encodeURIComponent(capturedTask)}/artifact-outcomes/accepted`, method: 'GET', params: { limit: 100 } }, controller))
      if (!current(captured, capturedTask, capturedActor, capturedEpoch, controller)) return null
      if (!Array.isArray(rows) || rows.length > 100 || !rows.every(row => acceptedRow(row, capturedTask))) throw new Error('权威接受结果格式无效，未展示为权威状态。')
      const keys = new Set()
      if (rows.some(row => { const key = `${row.artifactId}\u0000${row.artifactVersion}`; if (keys.has(key)) return true; keys.add(key); return false })) throw new Error('权威接受结果存在重复项，未展示为权威状态。')
      accepted.value = rows; refreshRequired.value = false
      supersededSelections.value = supersededSelections.value.filter(key => keys.has(key))
      acceptedState.value = rows.length ? 'ready' : 'empty'
      acceptedMessage.value = rows.length ? '以下仅为服务端确认的已接受成果。' : '服务端尚未返回已接受成果。'
      return rows
    } catch (error) {
      if (!current(captured, capturedTask, capturedActor, capturedEpoch, controller) || error?.name === 'AbortError') return null
      const [state, message] = errorPresentation(error)
      accepted.value = []; acceptedState.value = state; acceptedMessage.value = message
      if (state === 'inaccessible') clearSelection()
      return null
    } finally { if (listController === controller) listController = null }
  }

  const selectArtifact = artifact => {
    if (busy.value || refreshRequired.value || !readReady.value || !workspaceArtifact(artifact)) return false
    const key = `${artifact.artifactId}\u0000${Number(artifact.artifactVersion)}`
    if (!workspaceArtifacts.value.some(item => item.key === key)) return false
    acceptedSelection.value = key; confirmed.value = false; receipt.value = null
    return true
  }
  const toggleSuperseded = row => {
    if (busy.value || refreshRequired.value || !readReady.value || !acceptedRow(row, taskId.value)) return false
    const key = `${row.artifactId}\u0000${row.artifactVersion}`
    supersededSelections.value = supersededSelections.value.includes(key)
      ? supersededSelections.value.filter(value => value !== key)
      : [...supersededSelections.value, key]
    confirmed.value = false; receipt.value = null
    return true
  }

  const accept = async () => {
    if (submitController || listController || refreshRequired.value) return null
    const artifact = selectedArtifact.value
    if (!operable.value || !readReady.value || !artifact || !confirmed.value) {
      submitState.value = 'error'; submitMessage.value = '请从当前工作台可见成果中选择一个成果，并明确确认仅接受尚未裁决的成果。'; return null
    }
    // The service permits a target only when its outcome row is absent. Zero is
    // an atomic accept-if-undecided PRECONDITION, not an inferred current state.
    const acceptedRef = { artifactId: artifact.artifactId, artifactVersion: artifact.artifactVersion, expectedOutcomeVersion: 0 }
    const superseded = selectedSuperseded.value.map(row => ({ artifactId: row.artifactId, artifactVersion: row.artifactVersion, expectedOutcomeVersion: row.outcomeVersion }))
    if (superseded.some(row => row.artifactId === acceptedRef.artifactId && row.artifactVersion === acceptedRef.artifactVersion)) {
      submitState.value = 'error'; submitMessage.value = '接受成果不能同时作为被取代成果。'; return null
    }
    let idempotencyKey
    try { idempotencyKey = idempotencyKeyFactory() } catch (error) { submitState.value = 'error'; submitMessage.value = error.message; return null }
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._~:/+-]{8,100}$/.test(idempotencyKey)) { submitState.value = 'error'; submitMessage.value = '生成的幂等键无效，未发送裁决。'; return null }
    const captured = ++generation
    const capturedTask = taskId.value; const capturedActor = actorAgentId.value; const capturedEpoch = currentEpoch.value
    const controller = new AbortController(); submitController = controller
    const body = { acceptedArtifact: acceptedRef, supersededArtifacts: superseded }
    submitState.value = 'submitting'; submitMessage.value = ''; receipt.value = null
    try {
      const result = unwrap(await request({ url: `/tasks/${encodeURIComponent(capturedTask)}/artifact-outcomes/accept`, method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, data: body }, controller))
      if (!current(captured, capturedTask, capturedActor, capturedEpoch, controller)) return null
      if (!acceptedRow(result, capturedTask) || result.artifactId !== acceptedRef.artifactId || result.artifactVersion !== acceptedRef.artifactVersion || result.outcomeVersion !== acceptedRef.expectedOutcomeVersion + 1 || result.decisionId !== idempotencyKey) throw new Error('服务回执与本次精确裁决不匹配，未确认裁决。')
      receipt.value = result; submitState.value = 'accepted'; submitMessage.value = '服务端已确认该成果为权威接受结果。'
      const remainder = accepted.value.filter(row => !superseded.some(item => item.artifactId === row.artifactId && item.artifactVersion === row.artifactVersion))
      accepted.value = [result, ...remainder]
      supersededSelections.value = []; confirmed.value = false
      return result
    } catch (error) {
      if (!current(captured, capturedTask, capturedActor, capturedEpoch, controller) || error?.name === 'AbortError') return null
      const [state, message] = errorPresentation(error)
      submitState.value = state; submitMessage.value = message
      // A failed HTTP reply does not prove that no decision committed. Require
      // an explicit authoritative refresh before any further submission.
      refreshRequired.value = true
      clearSelection()
      return null
    } finally { if (submitController === controller) submitController = null }
  }

  const stopScope = watch(scope, () => { reset(); if (operable.value) void refreshAccepted() }, { immediate: true, flush: 'sync' })
  const dispose = () => { stopScope(); reset() }
  if (getCurrentInstance()) onUnmounted(dispose)
  return { accepted, acceptedState, acceptedMessage, acceptedSelection, supersededSelections, refreshRequired, busy, confirmed, submitState, submitMessage, receipt, workspaceArtifacts, selectedArtifact, selectedSuperseded, canSubmit, refreshAccepted, selectArtifact, toggleSuperseded, accept, dispose }
}
