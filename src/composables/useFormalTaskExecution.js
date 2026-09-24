import { computed, ref, unref, watch } from 'vue'
import { usePersonalWorkspaceExecution, createPersonalWorkspaceExecutionRecoveryStore } from './usePersonalWorkspaceExecution.js'

export const FORMAL_TASK_OUTPUT_MIME_TYPE = 'application/pdf'

const MAX_ID_LENGTH = 100
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH &&
  value === value.trim() && ![...value].some(character => character.codePointAt(0) < 32)
const validInput = value => value && validId(value.fileId) && Number.isSafeInteger(Number(value.version)) && Number(value.version) > 0
const scopeText = value => String(valueOf(value) ?? '').trim()
const sameInputs = (left, right) => left.length === right.length && left.every((item, index) => item.fileId === right[index].fileId && Number(item.version) === Number(right[index].version))
const scopeMatches = (value, scope) => value && value.executionMode === 'TASK' &&
  value.businessTaskId === scope.taskId && validId(value.workItemId) &&
  value.taskId === scope.taskId && value.conversationId === scope.conversationId &&
  value.targetAgentId === scope.targetAgentId && value.outputContentMimeType === FORMAL_TASK_OUTPUT_MIME_TYPE

/**
 * TASK-only boundary over the generic execution adapter. It never supplies null task or
 * conversation values and retains only execution records that match this exact formal scope.
 */
export function useFormalTaskExecution ({
  taskId,
  conversationId,
  targetAgentId,
  conversationConfirmed = false,
  executionAuthorized = false,
  executionAuthorizationReason = '',
  identityEpoch = 0,
  identityScope = identityEpoch,
  executionFactory = usePersonalWorkspaceExecution,
  storage = globalThis.localStorage || globalThis.window?.localStorage
} = {}) {
  const formalHistory = ref([])
  const historyState = ref('idle')
  const historyError = ref('')
  const scopeError = ref('')
  const currentScope = computed(() => ({
    taskId: scopeText(taskId),
    conversationId: scopeText(conversationId),
    targetAgentId: scopeText(targetAgentId),
    conversationConfirmed: valueOf(conversationConfirmed) === true,
    executionAuthorized: valueOf(executionAuthorized) === true,
    executionAuthorizationReason: scopeText(executionAuthorizationReason)
  }))
  const scopeKey = computed(() => {
    const scope = currentScope.value
    return validId(scope.taskId) ? `${scopeText(identityScope)}\u0000formal-task\u0000${scope.taskId}` : ''
  })
  const execution = executionFactory({ identityEpoch, identityScope: scopeKey })
  const activeExecution = computed(() => scopeMatches(execution.execution.value, currentScope.value) ? execution.execution.value : null)
  const revoking = ref(false)
  const revokeStore = createPersonalWorkspaceExecutionRecoveryStore({ storage, scopeKey: () => `${scopeKey.value}\u0000revoke` })
  const canRevoke = computed(() => Boolean(activeExecution.value?.state === 'QUEUED'
    && currentScope.value.conversationConfirmed && !execution.unresolvedIntent.value && !revoking.value
    && !revokeStore.read()?.uncertain))
  const revokeOriginal = async ({ confirmed = false } = {}) => {
    if (!confirmed) { scopeError.value = '请明确确认撤销本次执行的输入授权。'; return null }
    const current = activeExecution.value
    const pending = revokeStore.read()
    if (pending?.uncertain) { scopeError.value = '原撤销请求结果待核对，只查询原执行，不重复发送撤销或新执行。'; return null }
    if (!canRevoke.value || !current) return null
    const key = globalThis.crypto?.randomUUID?.() || `formal-revoke-${Date.now()}-${Math.random().toString(36).slice(2)}`
    if (!revokeStore.save({ idempotencyKey: key, executionId: current.executionId, uncertain: true })) {
      scopeError.value = '无法保存撤销请求的恢复标识，未发送请求。'; return null
    }
    const operationScope = scopeKey.value
    revoking.value = true; scopeError.value = ''
    try {
      const result = await execution.revokeInputs({ idempotencyKey: key })
      if (scopeKey.value !== operationScope) return null
      if (result && isFormalExecution(result) && result.executionId === current.executionId && result.state === 'INPUTS_REVOKED') {
        revokeStore.clear(); return result
      }
      scopeError.value = '撤销结果待核对，请恢复查询原执行；不会自动重复撤销或发起新执行。'
      return null
    } finally { if (scopeKey.value === operationScope) revoking.value = false }
  }
  watch(() => [scopeKey.value, valueOf(identityEpoch)], () => { revoking.value = false }, { flush: 'sync' })
  watch(activeExecution, value => {
    const intent = revokeStore.read()
    if (value && value.executionId === intent?.executionId && ['INPUTS_REVOKED', 'OUTPUT_COMMITTED', 'FAILED'].includes(value.state)) revokeStore.clear()
  }, { flush: 'sync' })
  const readyReason = computed(() => {
    const scope = currentScope.value
    if (!validId(scope.taskId)) return scope.executionAuthorizationReason || '未提供正式 taskId，不能开始执行。'
    if (!validId(scope.conversationId)) return scope.executionAuthorizationReason || '尚未提供已确认的正式议事 conversationId，不能开始执行。'
    if (!scope.conversationConfirmed) return scope.executionAuthorizationReason || '正式议事尚未由父级确认，不能开始执行。'
    if (!validId(scope.targetAgentId)) return scope.executionAuthorizationReason || '尚未提供明确 targetAgentId，不能开始执行。'
    if (!scope.executionAuthorized) return scope.executionAuthorizationReason || '当前任务尚未获父级授权进入正式执行，不能开始执行。'
    if (execution.capabilityState.value === 'loading') return '正在读取执行能力。'
    if (execution.capabilityState.value !== 'ready' || !execution.allowedMimeTypes.value.includes(FORMAL_TASK_OUTPUT_MIME_TYPE)) return '当前能力未确认可生成真实 PDF，不能开始执行。'
    if (execution.rosterState.value === 'loading') return '正在核对目标 Agent。'
    if (execution.rosterState.value !== 'ready' || !execution.agents.value.some(agent => agent.agentId === scope.targetAgentId)) return '指定 targetAgentId 当前不可作为正式执行目标。'
    if (execution.unresolvedIntent.value) return '原执行请求结果未知，正在仅查询原请求；不能重复提交。'
    if (execution.pending.value) return '当前正式执行仍在处理中；不能重复提交。'
    if (scopeError.value) return scopeError.value
    return ''
  })
  const stateText = computed(() => {
    if (execution.unresolvedIntent.value || execution.executionState.value === 'unknown') return '原请求结果未知：仅可恢复查询，不能重发。'
    const value = activeExecution.value
    if (!value) return '尚未确认本正式任务的执行记录。'
    if (value.state === 'QUEUED') return '服务端已建立 TASK 执行，正在等待客户端接收或运行；这不表示 Provider 已开始，也不表示已有交付。'
    if (value.state === 'OUTPUT_COMMITTED') return 'TASK runtime 已提交输出；正式交付是否 submitted/accepted 仍须以 formal-deliveries 回执为准。'
    if (value.state === 'INPUTS_REVOKED') return '本次 TASK 输入授权已撤销，后续读取和提交将被拒绝；不代表已取消外部调用或免除费用。'
    if (value.state === 'FAILED') return value.failureMessage || '本次 TASK 执行已报告失败。'
    return `执行状态 ${value.state} 尚待核对。`
  })
  const isFormalExecution = value => scopeMatches(value, currentScope.value)
  const normalizeInputs = inputs => {
    if (!Array.isArray(inputs) || !inputs.length || !inputs.every(validInput)) return null
    const normalized = inputs.map(input => ({ fileId: input.fileId, version: Number(input.version) }))
    if (new Set(normalized.map(input => input.fileId)).size !== normalized.length) return null
    return normalized
  }
  const refreshReadiness = async () => {
    await Promise.all([execution.loadCapabilities(), execution.loadAgents()])
    if (validId(currentScope.value.targetAgentId)) execution.selectAgent(currentScope.value.targetAgentId)
    return !readyReason.value
  }
  const recoverOriginalRequest = async () => {
    scopeError.value = ''
    await execution.refreshExecution()
    if (execution.execution.value && !isFormalExecution(execution.execution.value)) {
      scopeError.value = '服务端恢复记录与当前正式 taskId、TASK 模式、workItemId、conversationId、targetAgentId 或 PDF 输出不一致；未显示为本任务执行，也不会重发。'
      return null
    }
    return activeExecution.value
  }
  const begin = async ({ inputs, instruction, confirmed } = {}) => {
    const normalized = normalizeInputs(inputs)
    if (!confirmed) { scopeError.value = '请确认授权这些固定版本资料用于本次正式 TASK 执行。'; return null }
    if (!normalized) { scopeError.value = '请选择至少一份不重复的固定 INPUT 文件版本。'; return null }
    scopeError.value = ''
    if (readyReason.value) { scopeError.value = readyReason.value; return null }
    const scope = currentScope.value
    if (!execution.selectAgent(scope.targetAgentId)) { scopeError.value = '指定 targetAgentId 不在当前可访问的 Agent 名册中，未发送执行请求。'; return null }
    scopeError.value = ''
    const result = await execution.create({
      taskId: scope.taskId,
      conversationId: scope.conversationId,
      inputs: normalized,
      instruction,
      outputContentMimeType: FORMAL_TASK_OUTPUT_MIME_TYPE
    })
    if (!result) return null
    if (!isFormalExecution(result) || !sameInputs(
      result.inputs.map(input => ({ fileId: input.fileId, version: Number(input.version) })), normalized
    )) {
      scopeError.value = '执行回执未精确回显本任务、TASK 模式、工作项、会话、目标、PDF 或输入版本；未显示为成功，请仅恢复查询。'
      return null
    }
    return result
  }
  const loadFormalHistory = async () => {
    historyState.value = 'loading'; historyError.value = ''
    const summaries = await execution.loadHistory({ adopt: false })
    if (execution.historyState.value === 'error') { historyState.value = 'error'; historyError.value = execution.historyError.value; return [] }
    const matched = []
    for (const summary of summaries) {
      if (execution.unresolvedIntent.value) break
      const detail = await execution.selectHistoryExecution(summary.executionId)
      execution.stopPolling()
      if (detail && isFormalExecution(detail)) matched.push({ ...detail, createdAt: summary.createdAt })
    }
    formalHistory.value = matched
    historyState.value = matched.length ? 'ready' : 'empty'
    return matched
  }
  const selectFormalHistory = async executionId => {
    if (!formalHistory.value.some(item => item.executionId === executionId)) return null
    const value = await execution.selectHistoryExecution(executionId)
    if (value && !isFormalExecution(value)) { execution.stopPolling(); scopeError.value = '历史执行详情不再匹配当前正式任务，未显示为本任务记录。'; return null }
    return value
  }

  watch(() => {
    const scope = currentScope.value
    return `${scopeKey.value}\u0000${scope.conversationId}\u0000${scope.targetAgentId}\u0000${scope.conversationConfirmed}\u0000${scope.executionAuthorized}\u0000${scope.executionAuthorizationReason}`
  }, () => { formalHistory.value = []; historyState.value = 'idle'; historyError.value = ''; scopeError.value = '' }, { immediate: true, flush: 'sync' })

  return {
    execution, activeExecution, formalHistory, historyState, historyError, scopeError,
    readyReason, stateText, refreshReadiness, recoverOriginalRequest, begin, canRevoke, revoking, revokeOriginal,
    loadFormalHistory, selectFormalHistory, dispose: execution.dispose
  }
}
