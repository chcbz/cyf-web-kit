import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from './useHttp.js'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'

const MAX_ID_LENGTH = 100
const RECOVERY_PREFIX = 'cyf.personal-workspace.execution-recovery.v1'
const BROWSER_KEY = `${RECOVERY_PREFIX}.browser`
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
const TIMESTAMP = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
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
  (value.inputMimeTypes == null || (Array.isArray(value.inputMimeTypes) && value.inputMimeTypes.every(validOutputMime) && new Set(value.inputMimeTypes).size === value.inputMimeTypes.length)) &&
  typeof value.generationEnabled === 'boolean'
export const validPersonalWorkspaceExecutionCapabilities = validCapabilities
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
const validExecutionSummary = value => value && typeof value === 'object' && ID(value.executionId) && ID(value.targetAgentId) &&
  EXECUTION_STATES.has(value.state) && validOutputMime(value.outputContentMimeType) && TIMESTAMP(value.createdAt)
const validCursor = value => value == null || (value && typeof value === 'object' && TIMESTAMP(value.createdAt) && ID(value.executionId))
const descendingHistory = items => items.every((item, index) => index === 0 || items[index - 1].createdAt > item.createdAt || (items[index - 1].createdAt === item.createdAt && items[index - 1].executionId > item.executionId))
const abortError = message => new DOMException(message, 'AbortError')
const errorMessage = error => {
  if (error?.name === 'AbortError') return ''
  if (error?.status === 404 && error?.code === 'EXECUTION_NOT_FOUND') return '尚未查到原执行请求；它仍可能稍后被服务端确认，请继续查询，勿重复提交。'
  if ([401, 403, 404].includes(error?.status)) return '当前身份、文件或 Agent 已不可访问，请刷新后重新选择。'
  if (error?.code === 'IDEMPOTENCY_CONFLICT') return '本次执行请求与已有请求不一致，请刷新后确认执行记录。'
  if (error?.code === 'CAPABILITY_UNAVAILABLE' || error?.status === 422) return '当前 Agent 连接或受控能力尚不可用；未确认执行成功。'
  if (error?.status === 503) return '执行服务暂不可用，请稍后刷新确认，不要重复提交。'
  return error?.message || '执行请求未完成，请刷新后确认。'
}
const sameScope = value => TEXT(value, 256) ? value.trim() : ''

/** Stores only the original idempotency key and optional execution id; no request contents are persisted. */
export function createPersonalWorkspaceExecutionRecoveryStore ({ storage = globalThis.localStorage || globalThis.window?.localStorage, scopeKey, keyFactory = randomKey } = {}) {
  const scope = () => sameScope(valueOf(scopeKey))
  const browserId = () => {
    if (!storage) return ''
    try {
      const existing = storage.getItem(BROWSER_KEY)
      if (ID(existing)) return existing
      const next = keyFactory()
      if (!ID(next)) return ''
      storage.setItem(BROWSER_KEY, next)
      return storage.getItem(BROWSER_KEY) === next ? next : ''
    } catch { return '' }
  }
  const storageKey = (ownerOverride = null) => {
    const owner = sameScope(ownerOverride == null ? scope() : ownerOverride); const browser = browserId()
    return owner && browser ? `${RECOVERY_PREFIX}.${encodeURIComponent(owner)}.${encodeURIComponent(browser)}` : ''
  }
  const valid = value => value && typeof value === 'object' && ID(value.idempotencyKey) &&
    (value.executionId == null || ID(value.executionId)) && (value.uncertain == null || typeof value.uncertain === 'boolean')
  return {
    read () {
      const key = storageKey()
      if (!key || !storage) return null
      try { const value = JSON.parse(storage.getItem(key) || 'null'); return valid(value) ? { idempotencyKey: value.idempotencyKey, executionId: value.executionId || null, uncertain: value.uncertain === true } : null } catch { return null }
    },
    save (value) {
      const key = storageKey()
      if (!key || !storage || !valid(value)) return false
      const encoded = JSON.stringify({ idempotencyKey: value.idempotencyKey, executionId: value.executionId || null, uncertain: value.uncertain === true })
      try { storage.setItem(key, encoded); return storage.getItem(key) === encoded } catch { return false }
    },
    clear (ownerOverride = null) {
      const key = storageKey(ownerOverride)
      if (!key || !storage) return false
      try { storage.removeItem(key); return true } catch { return false }
    }
  }
}

/** Browser adapter for contract-frozen personal execution endpoints. Server state is authoritative. */
export function usePersonalWorkspaceExecution ({ api = createApi('/agent'), identityEpoch = 0, identityScope = identityEpoch, storage = globalThis.localStorage || globalThis.window?.localStorage, pollInterval = 2000, timerApi = globalThis } = {}) {
  const agents = ref([])
  const rosterState = ref('idle')
  const rosterError = ref('')
  const selectedAgentId = ref('')
  const allowedMimeTypes = ref([])
  const inputMimeTypes = ref([])
  const capabilityState = ref('idle')
  const capabilityError = ref('')
  const generationEnabled = ref(false)
  const execution = ref(null)
  const receipt = ref(null)
  const executionState = ref('idle')
  const error = ref('')
  const completionNotice = ref('')
  const history = ref([])
  const historyState = ref('idle')
  const historyError = ref('')
  const historyNextCursor = ref(null)
  const unresolvedIntent = ref(null)
  const currentEpoch = computed(() => String(valueOf(identityEpoch) ?? ''))
  const currentScope = computed(() => sameScope(valueOf(identityScope)))
  const recoveryStore = createPersonalWorkspaceExecutionRecoveryStore({ storage, scopeKey: currentScope })
  const controllers = new Set()
  let generation = 0
  let polling = null
  let disposed = false
  let selectionSequence = 0
  let previousScope = currentScope.value

  const selectedAgent = computed(() => agents.value.find(agent => agent.agentId === selectedAgentId.value) || null)
  const selectedExecutionAgent = computed(() => receipt.value ? agents.value.find(agent => agent.agentId === receipt.value.targetAgentId) || null : null)
  const pending = computed(() => Boolean(unresolvedIntent.value) || executionState.value === 'creating' || executionState.value === 'reconciling' || executionState.value === 'unknown' || receipt.value?.state === 'QUEUED')
  const stopPolling = () => { if (polling != null) timerApi.clearTimeout?.(polling); polling = null }
  const reset = () => {
    generation += 1; selectionSequence += 1; stopPolling()
    for (const controller of controllers) controller.abort(abortError('Workspace identity changed'))
    controllers.clear()
    agents.value = []; rosterState.value = 'idle'; rosterError.value = ''; selectedAgentId.value = ''
    allowedMimeTypes.value = []; inputMimeTypes.value = []; capabilityState.value = 'idle'; capabilityError.value = ''; generationEnabled.value = false
    execution.value = null; receipt.value = null; executionState.value = 'idle'; error.value = ''; completionNotice.value = ''; unresolvedIntent.value = null
    history.value = []; historyState.value = 'idle'; historyError.value = ''; historyNextCursor.value = null
  }
  const clearIdentityState = () => { recoveryStore.clear(); reset() }
  const stillCurrent = (snapshot, controller) => !disposed && snapshot.generation === generation && !controller.signal.aborted && currentEpoch.value === snapshot.epoch && currentScope.value === snapshot.scope
  const snapshotNow = () => ({ generation, epoch: currentEpoch.value, scope: currentScope.value })
  const request = async (options, snapshot = snapshotNow()) => {
    const controller = new AbortController(); controllers.add(controller)
    try {
      const response = await api.execute({ ...options, autoLoading: false, needAuth: true, signal: controller.signal })
      if (!stillCurrent(snapshot, controller)) throw abortError('Workspace context changed')
      return unwrap(response)
    } finally { controllers.delete(controller) }
  }
  const applySummary = value => {
    if (!validExecutionSummary(value)) throw new Error('执行历史返回格式无效，未将其显示为可恢复执行。')
    receipt.value = { executionId: value.executionId, targetAgentId: value.targetAgentId, state: value.state, outputContentMimeType: value.outputContentMimeType, createdAt: value.createdAt }
    return receipt.value
  }
  const clearMatchedTerminalIntent = value => {
    const saved = recoveryStore.read()
    if (TERMINAL_EXECUTION_STATES.has(value.state) && saved?.executionId === value.executionId) { recoveryStore.clear(); unresolvedIntent.value = null }
  }
  const confirmIntent = (intent, executionId) => {
    if (!intent || !ID(executionId)) return false
    const saved = recoveryStore.save({ idempotencyKey: intent.idempotencyKey, executionId, uncertain: false })
    if (saved) unresolvedIntent.value = null
    return saved
  }
  const applyExecution = value => {
    if (!validExecution(value)) throw new Error('执行状态返回格式无效，未将其显示为成功。')
    execution.value = value; receipt.value = value; executionState.value = 'ready'
    clearMatchedTerminalIntent(value)
    if (value.state === 'OUTPUT_COMMITTED') { stopPolling(); completionNotice.value = '交付件已归档到工作空间。请刷新文件列表领取成果；文件可用性以本次服务端回执和下载结果为准。' } else if (value.state === 'INPUTS_REVOKED') { stopPolling(); completionNotice.value = '输入授权已撤销，本次执行不会再继续。' } else if (value.state === 'FAILED') { stopPolling(); completionNotice.value = ''; error.value = value.failureMessage } else completionNotice.value = ''
    return value
  }
  const loadCapabilities = async () => {
    const snapshot = snapshotNow(); capabilityState.value = 'loading'; capabilityError.value = ''
    try {
      const value = await request({ url: '/personal-workspace/executions/capabilities', method: 'GET' }, snapshot)
      if (!validCapabilities(value)) throw new Error('执行能力返回格式无效，未开放任何交付类型。')
      allowedMimeTypes.value = [...value.allowedMimeTypes]; inputMimeTypes.value = Array.isArray(value.inputMimeTypes) ? [...value.inputMimeTypes] : [...value.allowedMimeTypes]
      generationEnabled.value = value.generationEnabled; capabilityState.value = value.allowedMimeTypes.length ? 'ready' : 'empty'
      return value
    } catch (cause) { if (cause?.name !== 'AbortError' && snapshot.generation === generation) { capabilityError.value = errorMessage(cause); capabilityState.value = 'error' } return null }
  }
  const loadAgents = async () => {
    const snapshot = snapshotNow(); rosterState.value = 'loading'; rosterError.value = ''
    try {
      const payload = await request({ url: '/roster', method: 'POST', data: { pageNum: 1, pageSize: 100 } }, snapshot)
      const next = rosterItems(payload).filter(validAgent).map(normalizeAgent); agents.value = next
      if (!next.some(agent => agent.agentId === selectedAgentId.value)) selectedAgentId.value = ''
      rosterState.value = next.length ? 'ready' : 'empty'; return next
    } catch (cause) { if (cause?.name !== 'AbortError' && snapshot.generation === generation) { rosterError.value = errorMessage(cause); rosterState.value = 'error' } return [] }
  }
  const selectAgent = agentId => { if (!agents.value.some(agent => agent.agentId === agentId)) return false; selectedAgentId.value = agentId; return true }
  const poll = async executionId => {
    if (!ID(executionId) || disposed || receipt.value?.executionId !== executionId) return null
    const snapshot = snapshotNow(); const sequence = selectionSequence
    try {
      const value = await request({ url: `/personal-workspace/executions/${encodeURIComponent(executionId)}`, method: 'GET' }, snapshot)
      if (sequence !== selectionSequence || receipt.value?.executionId !== executionId) return null
      const result = applyExecution(value)
      if (!TERMINAL_EXECUTION_STATES.has(result.state) && !disposed && receipt.value?.executionId === executionId) polling = timerApi.setTimeout?.(() => { void poll(executionId) }, pollInterval) ?? null
      return result
    } catch (cause) { if (cause?.name !== 'AbortError' && snapshot.generation === generation && sequence === selectionSequence && receipt.value?.executionId === executionId) error.value = errorMessage(cause); return null }
  }
  const startPolling = executionId => { stopPolling(); return poll(executionId) }
  const reconcile = async ({ quiet = false } = {}) => {
    const pendingIntent = recoveryStore.read()
    if (!pendingIntent) return null
    const snapshot = snapshotNow(); executionState.value = 'reconciling'; if (!quiet) error.value = ''
    try {
      const value = await request({ url: '/personal-workspace/executions/request', method: 'GET', headers: { 'Idempotency-Key': pendingIntent.idempotencyKey } }, snapshot)
      if (!validExecution(value)) throw new Error('执行状态返回格式无效，未将其显示为已确认。')
      if (!confirmIntent(pendingIntent, value?.executionId)) throw new Error('原执行请求标识无法安全更新，未将其显示为已确认。')
      const result = applyExecution(value)
      if (!TERMINAL_EXECUTION_STATES.has(result.state)) void startPolling(result.executionId)
      return result
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) {
        unresolvedIntent.value = { ...pendingIntent, uncertain: true }
        recoveryStore.save(unresolvedIntent.value)
        execution.value = null; receipt.value = pendingIntent.executionId ? { executionId: pendingIntent.executionId, targetAgentId: '', state: 'UNKNOWN', outputContentMimeType: '', createdAt: 0 } : null
        executionState.value = 'unknown'; error.value = errorMessage(cause)
      }
      return null
    }
  }
  const create = async ({ fileId = null, version = null, inputs = null, instruction, outputContentMimeType, taskId = null, conversationId = null } = {}) => {
    if (pending.value) { error.value = '当前执行仍待确认或排队中。若要另起请求，请先明确选择“另起一项新交付”。'; return null }
    const agent = selectedAgent.value; const legacyHasInput = fileId != null || version != null
    const selections = inputs == null ? (legacyHasInput ? [{ fileId, version: String(version ?? '') }] : []) : inputs.map(item => ({ fileId: item?.fileId, version: String(item?.version ?? '') }))
    if (!validSelections(selections)) { error.value = '请选择不重复的明确文件版本。'; return null }
    if (!validOutputMime(outputContentMimeType) || !allowedMimeTypes.value.includes(outputContentMimeType)) { error.value = '该交付类型当前未开放；请刷新执行能力后重试。'; return null }
    if (!selections.length && !generationEnabled.value) { error.value = '当前 Agent 执行通道未开放无文件生成。'; return null }
    if (!agent) { error.value = '请明确选择一个已有 Agent。'; return null }
    if (!TEXT(instruction, 4000)) { error.value = '请填写需求说明。'; return null }
    const snapshot = snapshotNow(); const idempotencyKey = randomKey(); selectionSequence += 1
    if (!recoveryStore.save({ idempotencyKey, uncertain: true })) { error.value = '无法安全保存原请求标识，未发送新的执行请求。'; return null }
    unresolvedIntent.value = { idempotencyKey, executionId: null, uncertain: true }
    stopPolling(); execution.value = null; receipt.value = null; executionState.value = 'creating'; error.value = ''; completionNotice.value = ''
    try {
      const value = await request({ url: '/personal-workspace/executions', method: 'POST', data: { conversationId, targetAgentId: agent.agentId, taskId, instruction: instruction.trim(), outputContentMimeType, inputs: selections }, headers: { 'Idempotency-Key': idempotencyKey } }, snapshot)
      if (!validExecution(value)) throw new Error('执行状态返回格式无效，未将其显示为已确认。')
      if (!confirmIntent({ idempotencyKey }, value?.executionId)) throw new Error('执行回执无法安全关联到原请求，未将其显示为已确认。')
      const result = applyExecution(value)
      if (!TERMINAL_EXECUTION_STATES.has(result.state)) void startPolling(result.executionId)
      return result
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) {
        executionState.value = 'unknown'; error.value = '提交结果尚未确认，正在仅查询原请求；请勿重复提交。'
        return reconcile({ quiet: true })
      }
      return null
    }
  }
  const prepareNewRequest = () => {
    if (unresolvedIntent.value || executionState.value === 'creating' || executionState.value === 'reconciling' || executionState.value === 'unknown') { error.value = '原请求尚未确认；请继续查询原请求，不能安全地另起执行。'; return false }
    if (!receipt.value && !pending.value) return true
    // This deliberately does not retry, cancel, or alter the server execution.
    recoveryStore.clear(); selectionSequence += 1; stopPolling(); execution.value = null; receipt.value = null; executionState.value = 'idle'; error.value = ''; completionNotice.value = ''
    return true
  }
  const selectHistoryExecution = async executionId => {
    const item = history.value.find(value => value.executionId === executionId)
    if (!item || unresolvedIntent.value || executionState.value === 'creating' || executionState.value === 'reconciling') return null
    const snapshot = snapshotNow(); const sequence = ++selectionSequence
    stopPolling(); execution.value = null; applySummary(item); executionState.value = 'loading'; error.value = ''; completionNotice.value = ''
    try {
      const value = await request({ url: `/personal-workspace/executions/${encodeURIComponent(executionId)}`, method: 'GET' }, snapshot)
      if (sequence !== selectionSequence || snapshot.generation !== generation) return null
      const result = applyExecution(value)
      if (!TERMINAL_EXECUTION_STATES.has(result.state)) void startPolling(result.executionId)
      return result
    } catch (cause) { if (cause?.name !== 'AbortError' && sequence === selectionSequence && snapshot.generation === generation) { executionState.value = 'error'; error.value = errorMessage(cause) } return null }
  }
  const loadHistory = async ({ beforeCreatedAt = null, beforeExecutionId = null, append = false, adopt = false } = {}) => {
    const snapshot = snapshotNow(); const selectionAtStart = selectionSequence; historyState.value = 'loading'; historyError.value = ''
    const params = { limit: 20 }
    if (TIMESTAMP(beforeCreatedAt) && ID(beforeExecutionId)) { params.beforeCreatedAt = beforeCreatedAt; params.beforeExecutionId = beforeExecutionId }
    try {
      const value = await request({ url: '/personal-workspace/executions', method: 'GET', params }, snapshot)
      if (!value || !Array.isArray(value.items) || value.items.length > 20 || !value.items.every(validExecutionSummary) || !descendingHistory(value.items) || !validCursor(value.nextCursor)) throw new Error('执行历史返回格式无效，未展示可能不完整的数据。')
      history.value = append ? [...history.value, ...value.items.filter(item => !history.value.some(old => old.executionId === item.executionId))] : value.items
      historyNextCursor.value = value.nextCursor || null; historyState.value = history.value.length ? 'ready' : 'empty'
      const preferred = receipt.value?.executionId && !TERMINAL_EXECUTION_STATES.has(receipt.value.state) && history.value.some(item => item.executionId === receipt.value.executionId) ? receipt.value.executionId : history.value[0]?.executionId
      if (adopt && preferred && !unresolvedIntent.value && selectionAtStart === selectionSequence) void selectHistoryExecution(preferred)
      return history.value
    } catch (cause) { if (cause?.name !== 'AbortError' && snapshot.generation === generation) { historyError.value = errorMessage(cause); historyState.value = 'error' } return [] }
  }
  const recover = async () => { await reconcile({ quiet: true }); return loadHistory({ adopt: !unresolvedIntent.value }) }
  const adoptExecution = value => { try { const result = applyExecution(value); if (!TERMINAL_EXECUTION_STATES.has(result.state)) void startPolling(result.executionId); return result } catch (cause) { error.value = cause?.message || '执行状态返回格式无效，未显示为成功。'; executionState.value = 'error'; return null } }
  const refreshExecution = () => unresolvedIntent.value ? reconcile() : receipt.value?.executionId ? startPolling(receipt.value.executionId) : reconcile()
  const revokeInputs = async () => {
    const current = execution.value
    if (!validExecution(current)) { error.value = '请先创建或刷新执行记录。'; return null }
    const snapshot = snapshotNow(); executionState.value = 'revoking'; error.value = ''
    try { const result = applyExecution(await request({ url: `/personal-workspace/executions/${encodeURIComponent(current.executionId)}/revoke-inputs`, method: 'POST', data: { expectedGrantRevision: current.grantRevision }, headers: { 'Idempotency-Key': randomKey() } }, snapshot)); if (!TERMINAL_EXECUTION_STATES.has(result.state)) void startPolling(result.executionId); return result } catch (cause) { if (cause?.name !== 'AbortError' && snapshot.generation === generation) { error.value = errorMessage(cause); executionState.value = 'error' } return null }
  }

  watch([currentEpoch, currentScope], () => { if (previousScope && previousScope !== currentScope.value) recoveryStore.clear(previousScope); previousScope = currentScope.value; reset() }, { immediate: true, flush: 'sync' })
  const unregisterIdentityCleanup = registerIdentityCleanup(clearIdentityState)
  const dispose = () => { if (disposed) return; disposed = true; unregisterIdentityCleanup(); reset() }
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return { agents, rosterState, rosterError, selectedAgentId, selectedAgent, selectedExecutionAgent, allowedMimeTypes, inputMimeTypes, capabilityState, capabilityError, generationEnabled, execution, receipt, executionState, error, completionNotice, history, historyState, historyError, historyNextCursor, unresolvedIntent, pending, loadCapabilities, loadAgents, loadHistory, recover, selectAgent, create, prepareNewRequest, adoptExecution, selectHistoryExecution, refreshExecution, revokeInputs, stopPolling, reset, dispose }
}
