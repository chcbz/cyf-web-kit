import { computed, ref, unref, watch } from 'vue'
import { discussionAccepted, discussionBody, inspectionAccepted, inspectionOutcomeProjection, outcomeCardKey, typedId, typedLong, typedOutcomeProjection } from './hallTypedDeliberation.js'

const unwrap = response => response?.data?.data ?? response?.data ?? response
const clone = value => JSON.parse(JSON.stringify(value))
const storagePrefix = 'cyf:hall:typed-deliberation:v1'
const recordPurpose = record => record?.purpose === 'INSPECT' ? 'INSPECT' : 'CHAT'
const secureKey = () => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      const value = globalThis.crypto.randomUUID()
      return typeof value === 'string' && value ? `mmd-typed-discussion-${value}` : ''
    }
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16)
      globalThis.crypto.getRandomValues(bytes)
      return `mmd-typed-discussion-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
    }
  } catch { /* Secure entropy unavailable: do not POST. */ }
  return ''
}
const apiOptions = key => ({ autoLoading: false, needAuth: true, headers: { 'Idempotency-Key': key } })
const storageKey = (scope, context) => scope && context?.conversationId && context?.taskId
  ? `${storagePrefix}:${encodeURIComponent(scope)}:${context.conversationId}:${context.taskId}` : ''
const readRecords = (storage, scope, context) => {
  const key = storageKey(scope, context)
  if (!storage || !key) return []
  try {
    const value = JSON.parse(storage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter(record => record && typeof record === 'object' && typedId(record.key) && record.body && (record.purpose === undefined || ['CHAT', 'INSPECT'].includes(record.purpose))) : []
  } catch { return [] }
}
const writeRecords = (storage, scope, context, records) => {
  const key = storageKey(scope, context)
  if (!storage || !key) return false
  try { storage.setItem(key, JSON.stringify(records)); return true } catch { return false }
}
const sameContext = (one, two) => one && two && one.conversationId === two.conversationId && one.taskId === two.taskId &&
  one.targetAgentId === two.targetAgentId && one.assignmentRevision === two.assignmentRevision &&
  one.conversationGeneration === two.conversationGeneration
const selectorInputs = proposal => proposal.sourceSelectors.map(selector => selector.kind === 'CURRENT_CONVERSATION_ASSET'
  ? { kind: selector.kind, assetRef: { assetId: selector.assetId, revision: selector.assetRevision } }
  : { kind: selector.kind, fileId: selector.fileId, version: selector.version, purpose: selector.purpose })
const storedBody = value => {
  const body = discussionBody({ intent: value?.intent, taskId: value?.taskId, assignmentRevision: value?.expectedAssignmentRevision,
    content: value?.content, parentOutcomeId: value?.parentOutcomeId, expectedParentStateVersion: value?.expectedParentStateVersion,
    pendingQuestionId: value?.pendingQuestionId, expectedPendingQuestionStateVersion: value?.expectedPendingQuestionStateVersion,
    sourceSelectors: value?.sourceSelectors })
  return body && JSON.stringify(body) === JSON.stringify(value) ? body : null
}

/** Typed natural CHAT UI adapter. It owns only the frozen discussion/read wire; no model, grant, or legacy stream fallback. */
export const useHallTypedDeliberation = ({ chatApi, actorScopeKey, authorizationGeneration, getContext, getContextGeneration,
  getCatalogEntries, storage = null, enabled = () => false, onAccepted = null, onProposal = null }) => {
  const scope = computed(() => unref(typeof actorScopeKey === 'function' ? actorScopeKey() : actorScopeKey))
  const projections = ref([]); const selectedPending = ref(null); const error = ref(''); const busy = ref(false); const storageRevision = ref(0)
  let generation = 0; let disposed = false; let queued = false; let refreshing = false
  const capture = () => Object.freeze({ generation, scope: scope.value,
    authorization: unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration),
    contextGeneration: getContextGeneration?.(), context: { ...(getContext?.() || {}) } })
  const current = captured => !disposed && enabled?.() && captured.generation === generation && captured.scope === scope.value &&
    captured.authorization === unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration) &&
    captured.contextGeneration === getContextGeneration?.() && sameContext(captured.context, getContext?.() || {})
  const path = (context, requestId = '', purpose = 'CHAT') => `/conversations/${encodeURIComponent(context.conversationId)}/requests/${encodeURIComponent(requestId)}/${purpose === 'INSPECT' ? 'inspection-outcome' : 'typed-outcome'}`
  const sorted = values => [...values].sort((a, b) => a.requestId.localeCompare(b.requestId))
  const compareLong = (one, two) => one.length - two.length || (one < two ? -1 : one > two ? 1 : 0)
  const sameFinalBinding = (one, two) => one?.requestId === two?.requestId && one?.turnId === two?.turnId &&
    one?.outcome?.outcomeId === two?.outcome?.outcomeId && one?.outcome?.finalDigest === two?.outcome?.finalDigest &&
    one?.outcome?.taskId === two?.outcome?.taskId && one?.outcome?.assignmentRevision === two?.outcome?.assignmentRevision &&
    one?.outcome?.assistantMessageId === two?.outcome?.assistantMessageId && one?.outcome?.kind === two?.outcome?.kind
  const persistRecords = (captured, records) => {
    if (!writeRecords(storage, captured.scope, captured.context, records)) return false
    storageRevision.value++
    return true
  }
  const apply = (projection, captured) => {
    if (!current(captured)) return false
    const previous = projections.value.find(item => item.requestId === projection.requestId)
    if (previous && previous.state === 'READY' && projection.state === 'PENDING') return false
    if (previous?.state === 'READY' && projection.state === 'READY' && !sameFinalBinding(previous, projection)) return false
    const previousClarification = previous?.outcome?.kind === 'CLARIFY' ? previous.outcome.clarification : null
    const clarification = projection?.outcome?.kind === 'CLARIFY' ? projection.outcome.clarification : null
    if (previousClarification && clarification) {
      if (previousClarification.pendingQuestionId !== clarification.pendingQuestionId) return false
      const version = compareLong(clarification.stateVersion, previousClarification.stateVersion)
      if (version < 0 || (previousClarification.state === 'ANSWERED' && clarification.state === 'OPEN')) return false
      if (version === 0 && JSON.stringify(previous.outcome) !== JSON.stringify(projection.outcome)) return false
    }
    const next = projections.value.filter(item => item.requestId !== projection.requestId).concat(projection)
    projections.value = sorted(next)
    const selected = selectedPending.value
    if (clarification && selected && selected.pendingQuestionId === clarification.pendingQuestionId &&
      (clarification.state === 'ANSWERED' || selected.expectedPendingQuestionStateVersion !== clarification.stateVersion)) selectedPending.value = null
    return true
  }
  const readOne = async (requestId, captured = capture(), requestedPurpose = '') => {
    if (!typedId(requestId) || !current(captured)) return null
    const record = readRecords(storage, captured.scope, captured.context).find(item => item.receipt?.requestId === requestId)
    const purpose = requestedPurpose || recordPurpose(record)
    try {
      const raw = unwrap(await chatApi.get(path(captured.context, requestId, purpose), {}, { autoLoading: false, needAuth: true }))
      if (!current(captured)) return null
      const projection = purpose === 'INSPECT'
        ? inspectionOutcomeProjection(raw, { conversationId: captured.context.conversationId, conversationGeneration: captured.context.conversationGeneration, taskId: captured.context.taskId, requestId })
        : typedOutcomeProjection(raw, { conversationId: captured.context.conversationId, conversationGeneration: captured.context.conversationGeneration, taskId: captured.context.taskId, requestId })
      if (!projection) return null
      apply(projection, captured)
      return projection
    } catch (cause) {
      // 404 means this catalog request is ordinary durable CHAT; it is not a typed UI failure.
      if (current(captured) && cause?.status && cause.status !== 404) error.value = cause?.message || '读取结构化议事结果失败'
      return null
    }
  }
  const refresh = async () => {
    if (refreshing) { queued = true; return false }
    const captured = capture()
    if (!current(captured) || !typedId(captured.context.conversationId) || !typedId(captured.context.taskId) ||
      !typedLong(captured.context.assignmentRevision, { allowZero: true })) return false
    refreshing = true; error.value = ''
    try {
      const requestIds = [...new Set((getCatalogEntries?.() || []).map(entry => entry?.request?.requestId).filter(typedId))]
      const inspectionRequestIds = [...new Set(readRecords(storage, captured.scope, captured.context).filter(record => recordPurpose(record) === 'INSPECT').map(record => record.receipt?.requestId).filter(typedId))]
      await Promise.all(requestIds.map(requestId => readOne(requestId, captured, 'CHAT')).concat(inspectionRequestIds.map(requestId => readOne(requestId, captured, 'INSPECT'))))
      return current(captured)
    } finally {
      if (current(captured)) refreshing = false
      else refreshing = false
      if (queued) { queued = false; void refresh() }
    }
  }
  const choosePending = projection => {
    const clarification = projection?.outcome?.kind === 'CLARIFY' ? projection.outcome.clarification : null
    if (!clarification || clarification.state !== 'OPEN') return false
    selectedPending.value = Object.freeze({ parentOutcomeId: projection.outcome.outcomeId,
      expectedParentStateVersion: clarification.stateVersion, pendingQuestionId: clarification.pendingQuestionId,
      expectedPendingQuestionStateVersion: clarification.stateVersion, question: clarification.question, purpose: projection.purpose || 'CHAT' })
    return true
  }
  const submit = async ({ content, sourceSelectors = [], inspection = false } = {}) => {
    if (busy.value || !enabled?.()) return false
    const captured = capture(); const context = captured.context
    if (!current(captured) || !typedId(context.conversationId) || !typedId(context.taskId) || !typedId(context.targetAgentId) ||
      !typedLong(context.assignmentRevision, { allowZero: true })) return false
    const pending = selectedPending.value
    const purpose = inspection ? 'INSPECT' : (pending?.purpose || 'CHAT')
    if (purpose === 'INSPECT' && !pending && (!Array.isArray(sourceSelectors) || sourceSelectors.length === 0)) {
      if (current(captured)) error.value = '请明确选择本轮交给当前 Agent 查阅的资料；未发送'
      return false
    }
    const body = discussionBody(pending ? { intent: 'CLARIFICATION_REPLY', taskId: context.taskId, assignmentRevision: context.assignmentRevision,
      content, parentOutcomeId: pending.parentOutcomeId, expectedParentStateVersion: pending.expectedParentStateVersion,
      pendingQuestionId: pending.pendingQuestionId, expectedPendingQuestionStateVersion: pending.expectedPendingQuestionStateVersion, sourceSelectors }
      : { intent: 'DISCUSSION', taskId: context.taskId, assignmentRevision: context.assignmentRevision, content, sourceSelectors })
    const key = secureKey()
    if (!body || !key) { if (current(captured)) error.value = '议事输入或安全请求键不符合冻结合同；未发送'; return false }
    const record = { key, purpose, body: clone(body), context: clone(context), status: 'POSTING' }
    const records = readRecords(storage, captured.scope, context)
    if (!persistRecords(captured, [...records, record])) { if (current(captured)) error.value = '原议事键持久化失败；未发送'; return false }
    busy.value = true; error.value = ''
    try { return await postOriginal(record, captured) }
    finally { if (current(captured)) busy.value = false }
  }
  const postOriginal = async (record, captured) => {
    const context = captured.context
    const body = storedBody(record?.body)
    const purpose = recordPurpose(record)
    if (!body || !typedId(record?.key) || !sameContext(record.context, context) || !current(captured)) return false
    try {
      const receipt = (purpose === 'INSPECT' ? inspectionAccepted : discussionAccepted)(unwrap(await chatApi.create(`/conversations/${encodeURIComponent(context.conversationId)}/interactions/${purpose === 'INSPECT' ? 'inspection' : 'discussion'}`, clone(body), apiOptions(record.key))), body, context.conversationId)
      if (!current(captured)) return false
      if (!receipt) throw new Error('议事受理回执不匹配')
      persistRecords(captured, readRecords(storage, captured.scope, context).map(item => item.key === record.key
        ? { ...item, purpose, status: 'ACCEPTED', receipt: clone(receipt) } : item))
      if (body.intent === 'CLARIFICATION_REPLY') selectedPending.value = null
      await readOne(receipt.requestId, captured, purpose)
      await onAccepted?.({ receipt, body, purpose, context: clone(context), isCurrent: () => current(captured) })
      return true
    } catch (cause) {
      if (current(captured)) {
        persistRecords(captured, readRecords(storage, captured.scope, context).map(item => item.key === record.key
          ? { ...item, purpose, status: 'UNKNOWN' } : item))
        error.value = cause?.message || (purpose === 'INSPECT' ? '查阅受理待核对；不会改走普通议事或办理' : '议事受理结果待核对；请按原键只读恢复或显式续办')
      }
      return false
    }
  }
  // Recovery is GET-only. It never posts a stored unknown request automatically.
  const recover = async () => {
    const captured = capture(); if (!current(captured)) return false
    const records = readRecords(storage, captured.scope, captured.context).filter(record => sameContext(record.context, captured.context))
    await Promise.all(records.filter(record => typedId(record.receipt?.requestId)).map(record => readOne(record.receipt.requestId, captured, recordPurpose(record))))
    await Promise.all(records.filter(record => record.status === 'UNKNOWN' && recordPurpose(record) === 'INSPECT').map(async record => {
      try {
        const raw = unwrap(await chatApi.get(`/conversations/${encodeURIComponent(captured.context.conversationId)}/interactions/inspection/request`, {}, apiOptions(record.key)))
        const receipt = inspectionAccepted(raw, storedBody(record.body), captured.context.conversationId)
        if (!receipt || !current(captured)) return
        persistRecords(captured, readRecords(storage, captured.scope, captured.context).map(item => item.key === record.key
          ? { ...item, purpose: 'INSPECT', status: 'ACCEPTED', receipt: clone(receipt) } : item))
        await readOne(receipt.requestId, captured, 'INSPECT')
      } catch (cause) {
        if (current(captured) && cause?.status && cause.status !== 404) error.value = cause?.message || '查阅恢复读取失败'
      }
    }))
    return current(captured)
  }
  const resumeUnknown = async (key = '') => {
    if (busy.value || !enabled?.()) return false
    const captured = capture(); if (!current(captured)) return false
    const record = readRecords(storage, captured.scope, captured.context).find(item => item.status === 'UNKNOWN' && (!key || item.key === key))
    if (!record) return false
    busy.value = true; error.value = ''
    try { return await postOriginal(record, captured) }
    finally { if (current(captured)) busy.value = false }
  }
  const confirmProposal = async projection => {
    if (projection?.purpose === 'INSPECT') return false
    const proposal = projection?.outcome?.proposal
    if (!proposal || !current(capture())) return false
    const inputs = selectorInputs(proposal)
    if (proposal.operation === 'GENERATE_IMAGE') return Boolean(await onProposal?.({ kind: 'GENERATE_IMAGE', content: proposal.instruction,
      inputRefs: inputs, continuationOf: null, projection: clone(projection) }))
    if (proposal.operation === 'EDIT_IMAGE' && proposal.parent && inputs.length === 1 && inputs[0].kind === 'CURRENT_CONVERSATION_ASSET') {
      return Boolean(await onProposal?.({ kind: 'EDIT_IMAGE', content: proposal.instruction, assetRef: inputs[0].assetRef,
        continuationOf: clone(proposal.parent), projection: clone(projection) }))
    }
    return false
  }
  const cards = computed(() => projections.value.filter(item => item.state === 'READY' && item.outcome).map(item => Object.freeze({ ...item, key: outcomeCardKey(item) })))
  const inspectionStatus = computed(() => {
    storageRevision.value
    if (projections.value.some(item => item.purpose === 'INSPECT' && item.state === 'PENDING')) return '正在查阅资料；受理或目录可用不表示已读。'
    return readRecords(storage, scope.value, getContext?.() || {}).some(record => recordPurpose(record) === 'INSPECT' && record.status === 'ACCEPTED')
      ? '查阅已受理，正在等待 Agent 查阅；尚未表示已读。' : ''
  })
  const invalidate = () => { generation++; busy.value = false; projections.value = []; selectedPending.value = null; error.value = '' }
  const stopScope = watch(scope, invalidate, { flush: 'sync' })
  const stopCatalog = typeof getCatalogEntries === 'function' ? watch(getCatalogEntries, () => { void refresh(); void recover() }, { deep: true }) : () => {}
  const recoveryAvailable = computed(() => { storageRevision.value; return readRecords(storage, scope.value, getContext?.() || {}).some(record => record.status === 'UNKNOWN') })
  return { projections, cards, selectedPending, error, busy, recoveryAvailable, inspectionStatus, refresh, readOne, submit, recover, resumeUnknown, choosePending, confirmProposal,
    invalidate, dispose: () => { disposed = true; invalidate(); stopScope(); stopCatalog() } }
}
