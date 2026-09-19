import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from './useHttp.js'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'

const MAX_ID_LENGTH = 100
export const PERSONAL_WORKSPACE_EXECUTION_MIME_TYPES = Object.freeze([
  'image/png', 'image/jpeg', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
])
const EXECUTION_MIME_TYPES = new Set(PERSONAL_WORKSPACE_EXECUTION_MIME_TYPES)
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
const validSelections = value => Array.isArray(value) && value.length <= 128 && value.every(validSelection) && new Set(value.map(item => item.fileId)).size === value.length
const validOutputMime = value => EXECUTION_MIME_TYPES.has(value)
const validCapabilities = value => value && typeof value === 'object' && Array.isArray(value.allowedMimeTypes) &&
  value.allowedMimeTypes.every(validOutputMime) && new Set(value.allowedMimeTypes).size === value.allowedMimeTypes.length &&
  typeof value.generationEnabled === 'boolean'
const validInput = value => validSelection(value) && ID(value.inputRef)
const EXECUTION_STATES = new Set(['QUEUED', 'INPUTS_REVOKED', 'OUTPUT_COMMITTED', 'FAILED'])
const TERMINAL_EXECUTION_STATES = new Set(['INPUTS_REVOKED', 'OUTPUT_COMMITTED', 'FAILED'])
const validRuntimeCommand = value => value == null || (value && typeof value === 'object' && ID(value.taskId) && ID(value.runId) && Array.isArray(value.inputManifest) && Array.isArray(value.outputManifest))
const validFailure = value => value?.state !== 'FAILED'
  ? value?.failureCode == null && value?.failureMessage == null
  : value.failureCode === 'AGENT_DELIVERY_FAILED' && TEXT(value.failureMessage, 255)
const validExecution = value => value && typeof value === 'object' && ID(value.executionId) && ID(value.taskId) && ID(value.runId) &&
  (value.conversationId == null || ID(value.conversationId)) && ID(value.targetAgentId) && EXECUTION_STATES.has(value.state) &&
  validFailure(value) && REVISION(value.grantRevision) && validOutputMime(value.outputContentMimeType) && Array.isArray(value.inputs) &&
  value.inputs.every(validInput) && validRuntimeCommand(value.runtimeCommand)
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
  const allowedMimeTypes = ref([])
  const capabilityState = ref('idle')
  const capabilityError = ref('')
  const generationEnabled = ref(false)
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
    allowedMimeTypes.value = []
    capabilityState.value = 'idle'
    capabilityError.value = ''
    generationEnabled.value = false
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
    // Terminal states are server-owned. Stop polling on every terminal fact; never infer a delivery.
    if (value.state === 'OUTPUT_COMMITTED') {
      stopPolling()
      completionNotice.value = '交付件已归档到工作空间。请刷新文件列表领取成果；文件可用性以本次服务端回执和下载结果为准。'
    } else if (value.state === 'INPUTS_REVOKED') {
      stopPolling()
      completionNotice.value = '输入授权已撤销，本次执行不会再继续。'
    } else if (value.state === 'FAILED') {
      stopPolling()
      completionNotice.value = ''
      error.value = value.failureMessage
    }
    return value
  }
  const loadCapabilities = async () => {
    const snapshot = { generation, epoch: currentEpoch.value }
    capabilityState.value = 'loading'; capabilityError.value = ''
    try {
      const value = await request({ url: '/personal-workspace/executions/capabilities', method: 'GET' }, snapshot)
      if (!validCapabilities(value)) throw new Error('执行能力返回格式无效，未开放任何交付类型。')
      allowedMimeTypes.value = [...value.allowedMimeTypes]
      generationEnabled.value = value.generationEnabled
      capabilityState.value = value.allowedMimeTypes.length ? 'ready' : 'empty'
      return value
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) {
        capabilityError.value = errorMessage(cause)
        capabilityState.value = 'error'
      }
      return null
    }
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
      if (!TERMINAL_EXECUTION_STATES.has(result.state) && !disposed && execution.value?.executionId === executionId) {
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
  const create = async ({ fileId = null, version = null, inputs = null, instruction, outputContentMimeType, taskId = null, conversationId = null } = {}) => {
    const agent = selectedAgent.value
    const legacyHasInput = fileId != null || version != null
    const selections = inputs == null ? (legacyHasInput ? [{ fileId, version: String(version ?? '') }] : []) : inputs.map(item => ({ fileId: item?.fileId, version: String(item?.version ?? '') }))
    if (!validSelections(selections)) { error.value = '请选择不重复的明确文件版本。'; return null }
    if (!validOutputMime(outputContentMimeType) || !allowedMimeTypes.value.includes(outputContentMimeType)) { error.value = '该交付类型当前未开放；请刷新执行能力后重试。'; return null }
    if (!selections.length && !generationEnabled.value) { error.value = '当前 Agent 执行通道未开放无文件生成。'; return null }
    if (!agent) { error.value = '请明确选择一个已有 Agent。'; return null }
    if (!TEXT(instruction, 4000)) { error.value = '请填写需求说明。'; return null }
    const snapshot = { generation, epoch: currentEpoch.value }
    stopPolling(); executionState.value = 'creating'; error.value = ''; completionNotice.value = ''
    try {
      const result = applyExecution(await request({
        url: '/personal-workspace/executions', method: 'POST',
        data: { conversationId, targetAgentId: agent.agentId, taskId, instruction: instruction.trim(), outputContentMimeType, inputs: selections },
        headers: { 'Idempotency-Key': randomKey() }
      }, snapshot))
      void startPolling(result.executionId)
      return result
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { error.value = errorMessage(cause); executionState.value = 'error' }
      return null
    }
  }
  const adoptExecution = value => {
    try {
      const result = applyExecution(value)
      if (!TERMINAL_EXECUTION_STATES.has(result.state)) void startPolling(result.executionId)
      return result
    } catch (cause) {
      error.value = cause?.message || '执行状态返回格式无效，未显示为成功。'
      executionState.value = 'error'
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
      if (!TERMINAL_EXECUTION_STATES.has(result.state)) void startPolling(result.executionId)
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

  return { agents, rosterState, rosterError, selectedAgentId, selectedAgent, allowedMimeTypes, capabilityState, capabilityError, generationEnabled, execution, executionState, error, completionNotice, loadCapabilities, loadAgents, selectAgent, create, adoptExecution, refreshExecution, revokeInputs, stopPolling, reset, dispose }
}
