import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from './useHttp.js'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'

const MAX_ID_LENGTH = 100
const ID = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && !/^\s|\s$/u.test(value)
const TEXT = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
const REVISION = value => (typeof value === 'string' && /^(0|[1-9]\d*)$/u.test(value)) || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const randomKey = () => globalThis.crypto?.randomUUID?.() || `pws-execution-${Date.now()}-${Math.random().toString(36).slice(2)}`
const unwrap = result => {
  let value = result
  for (let index = 0; index < 2 && value && typeof value === 'object' && Object.hasOwn(value, 'data'); index += 1) value = value.data
  return value
}
const rosterItems = payload => Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload?.list) ? payload.list : (Array.isArray(payload?.records) ? payload.records : (Array.isArray(payload?.rows) ? payload.rows : []))))
const validAgent = value => value && typeof value === 'object' && ID(value.agentId || value.id)
const normalizeAgent = value => ({
  agentId: value.agentId || value.id,
  name: TEXT(value.name, 160) ? value.name : (TEXT(value.personaName, 160) ? value.personaName : (value.agentId || value.id)),
  status: typeof value.status === 'string' ? value.status : ''
})
const validSelection = value => value && typeof value === 'object' && ID(value.fileId) && REVISION(value.version)
const validInput = value => validSelection(value) && ID(value.inputRef)
const validRuntimeCommand = value => value == null || (value && typeof value === 'object' && ID(value.taskId) && ID(value.runId) && Array.isArray(value.inputManifest) && Array.isArray(value.outputManifest))
const validExecution = value => value && typeof value === 'object' && ID(value.executionId) && ID(value.taskId) && ID(value.runId) &&
  (value.conversationId == null || ID(value.conversationId)) && ID(value.targetAgentId) && TEXT(value.state, 80) &&
  REVISION(value.grantRevision) && Array.isArray(value.inputs) && value.inputs.every(validInput) && validRuntimeCommand(value.runtimeCommand)
const abortError = message => new DOMException(message, 'AbortError')
const errorMessage = error => {
  if (error?.name === 'AbortError') return ''
  if ([401, 403, 404].includes(error?.status)) return '当前身份、文件或 Agent 已不可访问，请刷新后重新选择。'
  if (error?.code === 'IDEMPOTENCY_CONFLICT') return '本次执行请求与已有请求不一致，请刷新后确认执行记录。'
  if (error?.code === 'CAPABILITY_UNAVAILABLE' || error?.status === 422) return '当前 Agent 连接或受控能力尚不可用；未确认执行成功。'
  if (error?.status === 503) return '执行服务暂不可用，请稍后刷新确认，不要重复提交。'
  return error?.message || '执行请求未完成，请刷新后确认。'
}

/**
 * Browser adapter for the contract-frozen personal execution endpoints. It never
 * fabricates an Agent, completion, or output: roster and execution state are server data.
 */
export function usePersonalWorkspaceExecution ({ api = createApi('/agent'), identityEpoch = 0, pollInterval = 2000, timerApi = globalThis } = {}) {
  const agents = ref([])
  const rosterState = ref('idle')
  const rosterError = ref('')
  const selectedAgentId = ref('')
  const execution = ref(null)
  const executionState = ref('idle')
  const error = ref('')
  const completionNotice = ref('')
  const currentEpoch = computed(() => String(valueOf(identityEpoch) ?? ''))
  const controllers = new Set()
  let generation = 0
  let polling = null
  let disposed = false

  const selectedAgent = computed(() => agents.value.find(agent => agent.agentId === selectedAgentId.value) || null)
  const stopPolling = () => {
    if (polling != null) timerApi.clearTimeout?.(polling)
    polling = null
  }
  const reset = () => {
    generation += 1
    stopPolling()
    for (const controller of controllers) controller.abort(abortError('Workspace identity changed'))
    controllers.clear()
    agents.value = []
    rosterState.value = 'idle'
    rosterError.value = ''
    selectedAgentId.value = ''
    execution.value = null
    executionState.value = 'idle'
    error.value = ''
    completionNotice.value = ''
  }
  const stillCurrent = (snapshot, controller) => !disposed && snapshot.generation === generation && !controller.signal.aborted && currentEpoch.value === snapshot.epoch
  const request = async (options, snapshot = { generation, epoch: currentEpoch.value }) => {
    const controller = new AbortController()
    controllers.add(controller)
    try {
      const response = await api.execute({ ...options, autoLoading: false, needAuth: true, signal: controller.signal })
      if (!stillCurrent(snapshot, controller)) throw abortError('Workspace context changed')
      return unwrap(response)
    } finally {
      controllers.delete(controller)
    }
  }
  const applyExecution = value => {
    if (!validExecution(value)) throw new Error('执行状态返回格式无效，未将其显示为成功。')
    execution.value = value
    executionState.value = 'ready'
    // OUTPUT_COMMITTED is the server-side receipt after output manifest verification and workspace archive.
    // Other states remain server-owned and continue to be polled rather than guessed.
    if (value.state === 'OUTPUT_COMMITTED') {
      stopPolling()
      completionNotice.value = '交付件已归档到工作空间。请刷新文件列表领取成果；受控试行不表示 Word、图片或 PPT 已可用。'
    }
    return value
  }
  const loadAgents = async () => {
    const snapshot = { generation, epoch: currentEpoch.value }
    rosterState.value = 'loading'; rosterError.value = ''
    try {
      const payload = await request({ url: '/roster', method: 'POST', data: { pageNum: 1, pageSize: 100 } }, snapshot)
      const next = rosterItems(payload).filter(validAgent).map(normalizeAgent)
      agents.value = next
      if (!next.some(agent => agent.agentId === selectedAgentId.value)) selectedAgentId.value = ''
      rosterState.value = next.length ? 'ready' : 'empty'
      return next
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) {
        rosterError.value = errorMessage(cause)
        rosterState.value = 'error'
      }
      return []
    }
  }
  const selectAgent = agentId => {
    if (!agents.value.some(agent => agent.agentId === agentId)) return false
    selectedAgentId.value = agentId
    return true
  }
  const poll = async executionId => {
    if (!ID(executionId) || disposed || !execution.value || execution.value.executionId !== executionId) return null
    const snapshot = { generation, epoch: currentEpoch.value }
    try {
      const result = applyExecution(await request({ url: `/personal-workspace/executions/${encodeURIComponent(executionId)}`, method: 'GET' }, snapshot))
      if (result.state !== 'OUTPUT_COMMITTED' && !disposed && execution.value?.executionId === executionId) {
        polling = timerApi.setTimeout?.(() => { void poll(executionId) }, pollInterval) ?? null
      }
      return result
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) error.value = errorMessage(cause)
      return null
    }
  }
  const startPolling = executionId => {
    stopPolling()
    return poll(executionId)
  }
  const create = async ({ fileId, version, instruction, taskId = null, conversationId = null } = {}) => {
    const agent = selectedAgent.value
    if (!validSelection({ fileId, version: String(version ?? '') })) { error.value = '请先选择当前文件的一个明确版本。'; return null }
    if (!agent) { error.value = '请明确选择一个已有 Agent。'; return null }
    if (!TEXT(instruction, 4000)) { error.value = '请填写需求说明。'; return null }
    const snapshot = { generation, epoch: currentEpoch.value }
    stopPolling(); executionState.value = 'creating'; error.value = ''; completionNotice.value = ''
    try {
      const result = applyExecution(await request({
        url: '/personal-workspace/executions', method: 'POST',
        data: { conversationId, targetAgentId: agent.agentId, taskId, instruction: instruction.trim(), inputs: [{ fileId, version: String(version) }] },
        headers: { 'Idempotency-Key': randomKey() }
      }, snapshot))
      void startPolling(result.executionId)
      return result
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { error.value = errorMessage(cause); executionState.value = 'error' }
      return null
    }
  }
  const refreshExecution = () => execution.value?.executionId ? startPolling(execution.value.executionId) : Promise.resolve(null)
  const revokeInputs = async () => {
    const current = execution.value
    if (!validExecution(current)) { error.value = '请先创建或刷新执行记录。'; return null }
    const snapshot = { generation, epoch: currentEpoch.value }
    executionState.value = 'revoking'; error.value = ''
    try {
      const result = applyExecution(await request({
        url: `/personal-workspace/executions/${encodeURIComponent(current.executionId)}/revoke-inputs`, method: 'POST',
        data: { expectedGrantRevision: current.grantRevision }, headers: { 'Idempotency-Key': randomKey() }
      }, snapshot))
      if (result.state !== 'OUTPUT_COMMITTED') void startPolling(result.executionId)
      return result
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { error.value = errorMessage(cause); executionState.value = 'error' }
      return null
    }
  }

  watch(currentEpoch, reset, { immediate: true, flush: 'sync' })
  const unregisterIdentityCleanup = registerIdentityCleanup(reset)
  const dispose = () => {
    if (disposed) return
    disposed = true
    unregisterIdentityCleanup()
    reset()
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return { agents, rosterState, rosterError, selectedAgentId, selectedAgent, execution, executionState, error, completionNotice, loadAgents, selectAgent, create, refreshExecution, revokeInputs, stopPolling, reset, dispose }
}
