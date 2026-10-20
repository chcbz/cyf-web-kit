import { computed, ref, unref, watch } from 'vue'
import { textDeliveryProjection } from './bountyOutputCatalog.js'
import { actionProgressAdvances, submissionProgressAdvances, reviewProgressAdvances, discussionAccepted, discussionBody, inspectionOutcomeProjection, outcomeCardKey, typedId, typedLong, typedOutcomeProjection } from './hallTypedDeliberation.js'

const unwrap = response => response
const clone = value => JSON.parse(JSON.stringify(value))
const storagePrefix = 'cyf:hall:typed-deliberation:v3'
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
const storedBody = value => {
  const body = discussionBody({ intent: value?.intent, taskId: value?.taskId, assignmentRevision: value?.expectedAssignmentRevision,
    content: value?.content, parentOutcomeId: value?.parentOutcomeId, expectedParentStateVersion: value?.expectedParentStateVersion,
    pendingQuestionId: value?.pendingQuestionId, expectedPendingQuestionStateVersion: value?.expectedPendingQuestionStateVersion,
    sourceSelectors: value?.sourceSelectors, materialScope: value?.materialScope })
  return body && JSON.stringify(body) === JSON.stringify(value) ? body : null
}

/** Typed natural CHAT UI adapter. It owns only the frozen discussion/read wire; no model, grant, or legacy stream fallback. */
export const useHallTypedDeliberation = ({ chatApi, actorScopeKey, authorizationGeneration, getContext, getContextGeneration,
  getCatalogEntries, storage = null, enabled = () => false, onAccepted = null }) => {
  const scope = computed(() => unref(typeof actorScopeKey === 'function' ? actorScopeKey() : actorScopeKey))
  const projections = ref([]); const selectedPending = ref(null); const error = ref(''); const busy = ref(false); const storageRevision = ref(0)
  const failedReads = new Set()
  let generation = 0; let disposed = false; let queued = false; let refreshFlight = null
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
    one?.outcome?.outcomeId === two?.outcome?.outcomeId && one?.outcome?.finalSha256 === two?.outcome?.finalSha256 &&
    one?.outcome?.taskId === two?.outcome?.taskId && one?.outcome?.assignmentRevision === two?.outcome?.assignmentRevision &&
    one?.outcome?.assistantMessageId === two?.outcome?.assistantMessageId && one?.outcome?.kind === two?.outcome?.kind &&
    one?.schemaVersion === two?.schemaVersion && one?.requestRevision === two?.requestRevision && one?.purpose === two?.purpose
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
    if (previous?.state === 'READY' && projection.state === 'READY' && projection.outcome?.kind !== 'CLARIFY' &&
      JSON.stringify(previous.outcome) !== JSON.stringify(projection.outcome)) return false
    if (previous?.schemaVersion === 6 && previous.schemaVersion === projection.schemaVersion &&
      (!actionProgressAdvances(previous.actionProgress, projection.actionProgress) || !submissionProgressAdvances(previous.submissionProgress, projection.submissionProgress) || !reviewProgressAdvances(previous.reviewProgress, projection.reviewProgress))) return false
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
  const readOne = async (requestId, captured = capture(), requestedPurpose = '', visited = new Set()) => {
    if (!typedId(requestId) || !current(captured) || visited.has(requestId)) return null
    visited.add(requestId)
    const record = readRecords(storage, captured.scope, captured.context).find(item => item.receipt?.requestId === requestId)
    const purpose = requestedPurpose || recordPurpose(record)
    try {
      const raw = unwrap(await chatApi.get(path(captured.context, requestId, purpose), {}, { autoLoading: false, needAuth: true }))
      if (!current(captured)) return null
      const projection = purpose === 'INSPECT'
        ? inspectionOutcomeProjection(raw, { conversationId: captured.context.conversationId, conversationGeneration: captured.context.conversationGeneration, taskId: captured.context.taskId, requestId })
        : typedOutcomeProjection(raw, { conversationId: captured.context.conversationId, conversationGeneration: captured.context.conversationGeneration, taskId: captured.context.taskId, requestId })
      if (!projection || !apply(projection, captured)) {
        failedReads.add(requestId)
        error.value = '答复状态尚未核对，请重试。'
        return null
      }
      failedReads.delete(requestId)
      const child = projection.reviewProgress?.state === 'COMMITTED' ? projection.reviewProgress.childRequestId : null
      if (child && child !== requestId) await readOne(child, captured, 'CHAT', visited)
      return projection
    } catch (cause) {
      // 404 means this catalog request is ordinary durable CHAT; it is not a typed UI failure.
      if (current(captured)) {
        if (cause?.status === 404) failedReads.delete(requestId)
        else { failedReads.add(requestId); error.value = '暂时无法读取答复，请刷新状态。' }
      }
      return null
    }
  }
  const refresh = () => {
    // Read hints and send preparation join one exact in-flight projection read.
    // Joining is not an unsuccessful read and must not reject every prepared send.
    if (refreshFlight) { queued = true; return refreshFlight }
    const captured = capture()
    if (!current(captured) || !typedId(captured.context.conversationId) || !typedId(captured.context.taskId) ||
      !typedLong(captured.context.assignmentRevision, { allowZero: true })) return Promise.resolve(false)
    error.value = ''
    const read = async () => {
      const visited = new Set()
      const catalogEntries = getCatalogEntries?.() || []
      const catalogInspectionIds = catalogEntries.filter(entry => entry?.request?.turns?.some(turn => turn?.route === 'INSPECT'))
        .map(entry => entry.request.requestId).filter(typedId)
      const catalogChatIds = catalogEntries.filter(entry => !entry?.request?.turns?.some(turn => turn?.route === 'INSPECT'))
        .map(entry => entry?.request?.requestId).filter(typedId)
      const storedInspectionIds = readRecords(storage, captured.scope, captured.context).filter(record => recordPurpose(record) === 'INSPECT')
        .map(record => record.receipt?.requestId).filter(typedId)
      const inspectionRequestIds = [...new Set([...catalogInspectionIds, ...storedInspectionIds])]
      await Promise.all([...new Set(catalogChatIds)].map(requestId => readOne(requestId, captured, 'CHAT', visited))
        .concat(inspectionRequestIds.map(requestId => readOne(requestId, captured, 'INSPECT', visited))))
      return current(captured) && failedReads.size === 0
    }
    const flight = read().finally(() => {
      if (refreshFlight !== flight) return
      refreshFlight = null
      if (queued) { queued = false; void refresh() }
    })
    refreshFlight = flight
    return flight
  }
  const choosePending = projection => {
    const clarification = projection?.outcome?.kind === 'CLARIFY' ? projection.outcome.clarification : null
    if (!clarification || clarification.state !== 'OPEN') return false
    selectedPending.value = Object.freeze({ parentOutcomeId: projection.outcome.outcomeId,
      expectedParentStateVersion: clarification.stateVersion, pendingQuestionId: clarification.pendingQuestionId,
      expectedPendingQuestionStateVersion: clarification.stateVersion, question: clarification.question, purpose: projection.purpose || 'CHAT' })
    return true
  }
  // A single explicit manifest/edit chain supplies context, not delivery intent or tool authority.
  // Independent roots, pending projections and late assets remain unresolved; never pick latest MIME.
  const submit = async ({ content, sourceSelectors = [], materialScope = 'TASK_DEFAULT', inspection = false } = {}) => {
    if (inspection) { error.value = '资料在原议事回合使用，请直接发送需求。'; return false }
    if (busy.value || !enabled?.()) return false
    const captured = capture(); const context = captured.context
    if (!current(captured) || !typedId(context.conversationId) || !typedId(context.taskId) || !typedId(context.targetAgentId) ||
      !typedLong(context.assignmentRevision, { allowZero: true })) {
      if (current(captured)) error.value = '当前指派上下文尚未核对，请刷新事项后重试；未发送消息。'
      return false
    }
    if (!current(captured)) return false
    const pending = selectedPending.value
    const purpose = inspection ? 'INSPECT' : 'CHAT'
    if (purpose === 'INSPECT' && !pending && (!Array.isArray(sourceSelectors) || sourceSelectors.length === 0)) {
      if (current(captured)) error.value = '请选择要添加的资料。'
      return false
    }
    let deliveryParent = null
    const catalog = clone(getCatalogEntries?.() || [])
    const unresolved = catalog.some(entry => !entry?.request?.turns?.some(turn => turn.route === 'INSPECT') &&
      !projections.value.some(value => value.requestId === entry?.request?.requestId && value.state === 'READY'))
    if (!deliveryParent && !pending && purpose === 'CHAT' && !unresolved && !catalog.some(entry => entry?.request?.steps?.some(step => step.kind === 'EXECUTE'))) {
      const finals = projections.value.filter(value => value.schemaVersion === 6 && value.state === 'READY' && value.route === 'CHAT' &&
        value.outcome?.deliverable === true && value.outcome.assignmentRevision === context.assignmentRevision)
      try {
        deliveryParent = textDeliveryProjection(finals.map(value => ({ outcomeId: value.outcome.outcomeId,
          messageSource: value.outcome.messageSource, deliveryRelation: value.outcome.deliveryRelation }))).basis
      } catch { /* Multiple independent roots or branches are not a parent choice. */ }
    }
    const body = discussionBody(pending ? { intent: 'CLARIFICATION_REPLY', taskId: context.taskId, assignmentRevision: context.assignmentRevision,
      content, parentOutcomeId: pending.parentOutcomeId, expectedParentStateVersion: pending.expectedParentStateVersion,
      pendingQuestionId: pending.pendingQuestionId, expectedPendingQuestionStateVersion: pending.expectedPendingQuestionStateVersion, sourceSelectors, materialScope }
      : { intent: 'DISCUSSION', taskId: context.taskId, assignmentRevision: context.assignmentRevision, content, sourceSelectors, materialScope,
        parentOutcomeId: deliveryParent?.outcomeId ?? null, expectedParentStateVersion: deliveryParent ? '0' : null })
    const key = secureKey()
    if (!body || !key) { if (current(captured)) error.value = '暂时无法发送，请检查内容和资料后重试。'; return false }
    const record = { key, purpose, body: clone(body), context: clone(context), status: 'POSTING' }
    const records = readRecords(storage, captured.scope, context)
    if (!persistRecords(captured, [...records, record])) { if (current(captured)) error.value = '无法保存发送状态，请稍后重试。'; return false }
    busy.value = true; error.value = ''
    try { return await postOriginal(record, captured) }
    finally { if (current(captured)) busy.value = false }
  }
  const postOriginal = async (record, captured) => {
    const context = captured.context
    const body = storedBody(record?.body)
    const purpose = recordPurpose(record)
    if (purpose !== 'CHAT' || record?.body?.schemaVersion !== 3 || !body || !typedId(record?.key) || !sameContext(record.context, context) || !current(captured)) return false
    try {
      const receipt = discussionAccepted(unwrap(await chatApi.create(`/conversations/${encodeURIComponent(context.conversationId)}/interactions/${purpose === 'INSPECT' ? 'inspection' : 'discussion'}`, clone(body), apiOptions(record.key))), body, context.conversationId)
      if (!current(captured)) return false
      if (!receipt) throw new Error('议事受理回执不匹配')
      persistRecords(captured, readRecords(storage, captured.scope, context).map(item => item.key === record.key
        ? { ...item, purpose, status: 'ACCEPTED', receipt: clone(receipt) } : item))
      if (body.intent === 'CLARIFICATION_REPLY') selectedPending.value = null
      await readOne(receipt.requestId, captured, purpose)
      await onAccepted?.({ receipt, body, purpose, context: clone(context), isCurrent: () => current(captured) })
      return true
    } catch {
      if (current(captured)) {
        persistRecords(captured, readRecords(storage, captured.scope, context).map(item => item.key === record.key
          ? { ...item, purpose, status: 'UNKNOWN' } : item))
        error.value = '暂时无法确认发送结果，请刷新状态。'
      }
      return false
    }
  }
  // Recovery is GET-only. It never posts a stored unknown request automatically.
  const recover = async () => {
    const captured = capture(); if (!current(captured)) return false
    const records = readRecords(storage, captured.scope, captured.context).filter(record => sameContext(record.context, captured.context))
    await Promise.all(records.filter(record => typedId(record.receipt?.requestId)).map(record => readOne(record.receipt.requestId, captured, recordPurpose(record))))
    return current(captured) && failedReads.size === 0
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
  const confirmProposal = async () => false // Historical proposals are audit data, never a new write entry.
  const cards = computed(() => projections.value.filter(item => item.state === 'READY' && item.outcome).map(item => Object.freeze({ ...item, key: outcomeCardKey(item) })))
  const inspectionStatus = computed(() => {
    storageRevision.value
    if (projections.value.some(item => item.purpose === 'INSPECT' && item.state === 'PENDING')) return '正在查阅资料…'
    const ready = new Set(projections.value.filter(item => item.purpose === 'INSPECT' && item.state === 'READY').map(item => item.requestId))
    return readRecords(storage, scope.value, getContext?.() || {}).some(record => recordPurpose(record) === 'INSPECT' && record.status === 'ACCEPTED' && !ready.has(record.receipt?.requestId))
      ? '等待查阅资料…' : ''
  })
  const invalidate = () => { generation++; failedReads.clear(); busy.value = false; projections.value = []; selectedPending.value = null; error.value = '' }
  const stopScope = watch(scope, invalidate, { flush: 'sync' })
  const stopCatalog = typeof getCatalogEntries === 'function' ? watch(getCatalogEntries, () => { void refresh(); void recover() }, { deep: true }) : () => {}
  const recoveryAvailable = computed(() => { storageRevision.value; return readRecords(storage, scope.value, getContext?.() || {}).some(record => record.status === 'UNKNOWN') })
  return { projections, cards, selectedPending, error, busy, recoveryAvailable, inspectionStatus, refresh, readOne, submit, recover, resumeUnknown, choosePending, confirmProposal,
    invalidate, dispose: () => { disposed = true; invalidate(); stopScope(); stopCatalog() } }
}
