import { computed, ref, unref, watch } from 'vue'
import { readDeliveryContextPage } from './hallDeliveryContext.js'
import { actionProgressAdvances, submissionProgressAdvances, reviewProgressAdvances, discussionAccepted, discussionBody, inspectionOutcomeProjection, outcomeCardKey, typedId, typedLong, typedOutcomeProjection } from './hallTypedDeliberation.js'

const unwrap = response => response
const clone = value => JSON.parse(JSON.stringify(value))
const storagePrefix = 'cyf:hall:typed-deliberation:v3'
const recordPurpose = record => record?.purpose === 'INSPECT' ? 'INSPECT' : 'CHAT'
// Authoritative empty cancellation is history, not an unread delivery or an unknown execution.
const cancelledWithoutOutput = entry => {
  const request = entry?.request
  return request?.state === 'CANCELLED' && Array.isArray(request.steps) && request.steps.length === 0 &&
    Array.isArray(request.turns) && request.turns.length > 0 && request.turns.every(turn =>
    turn.state === 'CANCELLED' && turn.finalMessageId === null && String(turn.lastDeltaSeq) === '0')
}

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
  const selectedDelivery = ref(null)
  const deliveryItems = ref([]); const deliveryPage = ref(null)
  const deliveryLoading = ref(false); const deliveryError = ref('')
  const deliveryControllers = new Set()
  let deliveryFlight = null
  const deliveryHasMore = computed(() => deliveryPage.value?.hasMore === true)
  // Keep an explicit later-page choice visible; submit rechecks its exact ID/digest.
  const deliveryChoices = computed(() => selectedDelivery.value && !deliveryItems.value.some(item => item.outcomeId === selectedDelivery.value.outcomeId)
    ? [...deliveryItems.value, selectedDelivery.value] : deliveryItems.value)
  const chooseDelivery = outcomeId => {
    if (busy.value) return
    const choice = deliveryChoices.value.find(item => item.outcomeId === outcomeId)
    selectedDelivery.value = choice ? { ...choice, context: { ...(getContext?.() || {}) }, scope: scope.value,
      authorization: unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration) } : null
  }
  const selectedDeliveryId = computed(() => {
    const selected = selectedDelivery.value
    return selected && selected.scope === scope.value && sameContext(selected.context, getContext?.() || {}) &&
      selected.authorization === unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration) ? selected.outcomeId : ''
  })
  const failedReads = new Set()
  const emptyCancellation = entry => cancelledWithoutOutput(entry) &&
    !projections.value.some(value => value.requestId === entry.request.requestId && value.state === 'READY')

  let generation = 0; let disposed = false; let refreshFlight = null
  const capture = () => Object.freeze({ generation, scope: scope.value,
    authorization: unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration),
    contextGeneration: getContextGeneration?.(), context: { ...(getContext?.() || {}) } })
  const current = captured => !disposed && enabled?.() && captured.generation === generation && captured.scope === scope.value &&
    captured.authorization === unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration) &&
    captured.contextGeneration === getContextGeneration?.() && sameContext(captured.context, getContext?.() || {})
  const fetchDeliveryPage = async (captured, options = {}) => {
    const controller = new AbortController()
    deliveryControllers.add(controller)
    try { return await readDeliveryContextPage({ chatApi, context: captured.context, ...options, signal: controller.signal }) }
    finally { deliveryControllers.delete(controller) }
  }
  const refreshDeliveryChoices = (more = false) => {
    if (deliveryFlight) return deliveryFlight
    const captured = capture()
    if (!current(captured) || (more && !deliveryHasMore.value)) return Promise.resolve(false)
    const before = more ? { assistantMessageId: deliveryPage.value.nextBeforeMessageId, outcomeId: deliveryPage.value.nextBeforeOutcomeId } : null
    deliveryLoading.value = true; deliveryError.value = ''
    const flight = (async () => {
      try {
        const page = await fetchDeliveryPage(captured, { before })
        if (!current(captured)) return false
        const items = more ? [...deliveryItems.value, ...page.items] : page.items
        deliveryItems.value = [...new Map(items.map(item => [item.outcomeId, item])).values()]
        deliveryPage.value = page
        return true
      } catch (cause) {
        if (current(captured)) deliveryError.value = cause.message || '暂时无法读取当前成果。'
        return false
      } finally {
        if (deliveryFlight === flight) { deliveryFlight = null; deliveryLoading.value = false }
      }
    })()
    deliveryFlight = flight
    return flight
  }
  const loadMoreDeliveryChoices = () => refreshDeliveryChoices(true)
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
    // A delayed read cannot downgrade an authoritative final or create a false read failure.
    if (previous && previous.state !== 'PENDING' && projection.state === 'PENDING' &&
      previous.turnId === projection.turnId && previous.requestRevision === projection.requestRevision) return true
    if (previous && previous.state !== 'PENDING' && projection.state !== previous.state) return false
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
    if ((getCatalogEntries?.() || []).some(entry => entry?.request?.requestId === requestId && emptyCancellation(entry))) {
      failedReads.delete(requestId)
      return null
    }
    visited.add(requestId)
    const purpose = requestedPurpose || recordPurpose(readRecords(storage, captured.scope, captured.context)
      .find(item => item.receipt?.requestId === requestId))
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
      return projection
    } catch (cause) {
      // 404 means this catalog request is ordinary durable CHAT; it is not a typed UI failure.
      if (current(captured)) {
        if ((cause?.status ?? cause?.response?.status) === 404) {
          failedReads.delete(requestId)
        }
        else { failedReads.add(requestId); error.value = '暂时无法读取答复，请刷新状态。' }
      }
      return null
    }
  }
  const refresh = () => {
    // Refresh only the caller-supplied display catalog. Send context is separate;
    // historical stored receipts do not expand this read scope.
    if (refreshFlight) return refreshFlight
    const captured = capture()
    if (!current(captured) || !typedId(captured.context.conversationId) || !typedId(captured.context.taskId) ||
      !typedLong(captured.context.assignmentRevision, { allowZero: true })) return Promise.resolve(false)
    error.value = ''
    const read = async () => {
      const visited = new Set()
      const catalogEntries = getCatalogEntries?.() || []
      const catalogInspectionIds = catalogEntries.filter(entry => entry?.request?.turns?.some(turn => turn?.route === 'INSPECT'))
        .map(entry => entry.request.requestId).filter(typedId)
      const catalogChatIds = catalogEntries.filter(entry => !entry?.request?.turns?.some(turn => turn?.route === 'INSPECT') &&
        !(entry?.request?.steps?.some(step => step.kind === 'EXECUTE') && !entry?.request?.turns?.some(turn => turn.route === 'CHAT')))
        .map(entry => entry?.request?.requestId).filter(typedId)
      await Promise.all([...new Set(catalogChatIds)].map(requestId => readOne(requestId, captured, 'CHAT', visited))
        .concat([...new Set(catalogInspectionIds)].map(requestId => readOne(requestId, captured, 'INSPECT', visited))))
      if (current(captured)) await refreshDeliveryChoices()
      return current(captured) && failedReads.size === 0
    }
    const flight = read().finally(() => {
      if (refreshFlight !== flight) return
      refreshFlight = null
    })
    refreshFlight = flight
    return flight
  }
  const relatedRequestIds = events => {
    const ids = new Set(events.flatMap(event => [event.requestId, event.childRequestId, event.replyRequestId]).filter(typedId))
    const parents = new Set(events.map(event => event.parentOutcomeId).filter(typedId))
    const changed = new Set(ids)
    for (const value of projections.value) {
      if (changed.has(value.requestId)) {
        for (const child of [value.actionProgress?.childRequestId, value.reviewProgress?.childRequestId]) if (typedId(child)) ids.add(child)
      }
      if (parents.has(value.outcome?.outcomeId) || ids.has(value.actionProgress?.childRequestId) ||
          ids.has(value.reviewProgress?.childRequestId) || ids.has(value.outcome?.clarification?.replyRequestId)) ids.add(value.requestId)
    }
    return [...ids]
  }
  const refreshRequests = async (requestIds, { choices = true } = {}) => {
    const captured = capture()
    if (!current(captured)) return false
    if (refreshFlight) await refreshFlight
    if (!current(captured)) return false
    const entries = new Map((getCatalogEntries?.() || []).map(entry => [entry.request.requestId, entry]))
    const visited = new Set()
    const ids = [...new Set(requestIds)].filter(typedId)
    await Promise.all(ids.map(requestId => {
      const request = entries.get(requestId)?.request
      if (request?.steps?.some(step => step.kind === 'EXECUTE') && !request?.turns?.some(turn => ['CHAT', 'INSPECT'].includes(turn.route))) return null
      const purpose = request?.turns?.some(turn => turn.route === 'INSPECT') ? 'INSPECT' : 'CHAT'
      return readOne(requestId, captured, purpose, visited)
    }))
    if (choices && current(captured)) await refreshDeliveryChoices()
    return current(captured) && ids.every(id => !failedReads.has(id))
  }
  const choosePending = projection => {
    const clarification = projection?.outcome?.kind === 'CLARIFY' ? projection.outcome.clarification : null
    if (!clarification || clarification.state !== 'OPEN') return false
    selectedPending.value = Object.freeze({ parentOutcomeId: projection.outcome.outcomeId,
      expectedParentStateVersion: clarification.stateVersion, pendingQuestionId: clarification.pendingQuestionId,
      expectedPendingQuestionStateVersion: clarification.stateVersion, question: clarification.question, purpose: projection.purpose || 'CHAT' })
    return true
  }
  // Server-selected heads supply context, not delivery intent or tool authority.
  // Never rebuild a history graph here or pick the newest item by MIME.
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
    let body = discussionBody(pending ? { intent: 'CLARIFICATION_REPLY', taskId: context.taskId, assignmentRevision: context.assignmentRevision,
      content, parentOutcomeId: pending.parentOutcomeId, expectedParentStateVersion: pending.expectedParentStateVersion,
      pendingQuestionId: pending.pendingQuestionId, expectedPendingQuestionStateVersion: pending.expectedPendingQuestionStateVersion, sourceSelectors, materialScope }
      : { intent: 'DISCUSSION', taskId: context.taskId, assignmentRevision: context.assignmentRevision, content, sourceSelectors, materialScope,
        parentOutcomeId: null, expectedParentStateVersion: null })
    if (!body) { error.value = '暂时无法发送，请检查内容和资料后重试。'; return false }
    busy.value = true; error.value = ''
    try {
      let deliveryParent = null
      if (!pending) {
        const selected = selectedDeliveryId.value ? selectedDelivery.value : null
        const page = await fetchDeliveryPage(captured, { outcomeId: selected?.outcomeId })
        if (!current(captured) || selectedPending.value !== pending) return false
        if (selected) {
          deliveryParent = page.items.find(item => item.outcomeId === selected.outcomeId && item.finalSha256 === selected.finalSha256)
          if (!deliveryParent) { error.value = '所选成果已变化，请重新选择本轮成果。'; return false }
        } else {
          deliveryItems.value = page.items; deliveryPage.value = page
          if (!page.pendingExecution) {
            if (page.items.length > 1 || page.hasMore) { error.value = '存在多份独立成果，请先选择本轮成果。'; return false }
            deliveryParent = page.items[0] || null
          }
        }
      }
      if (!pending && deliveryParent) body = Object.freeze({ ...body, parentOutcomeId: deliveryParent.outcomeId, expectedParentStateVersion: '0' })
      // A definitive startup refusal is not UNKNOWN. Reuse the same key on an
      // explicit retry of the same body, including concurrent/late receipt races.
      const records = readRecords(storage, captured.scope, context)
      const refused = records.find(item => item.status === 'NOT_READY' && sameContext(item.context, context) && JSON.stringify(item.body) === JSON.stringify(body))
      const key = refused?.key || secureKey()
      if (!body || !key) { if (current(captured)) error.value = '暂时无法发送，请检查内容和资料后重试。'; return false }
      const record = { key, purpose, body: clone(body), context: clone(context), status: 'POSTING' }
      if (!persistRecords(captured, [...records.filter(item => item.key !== key), record])) { if (current(captured)) error.value = '无法保存发送状态，请稍后重试。'; return false }
      return await postOriginal(record, captured)
    } catch (cause) {
      if (current(captured)) error.value = cause.message || '暂时无法读取当前成果，未发送消息。'
      return false
    } finally { if (current(captured)) busy.value = false }
  }
  const postOriginal = async (record, captured) => {
    const context = captured.context
    const body = storedBody(record?.body)
    const purpose = recordPurpose(record)
    if (purpose !== 'CHAT' || record?.body?.schemaVersion !== 3 || !body || !typedId(record?.key) || !sameContext(record.context, context) || !current(captured)) return false
    try {
      const receipt = discussionAccepted(unwrap(await chatApi.create(`/conversations/${encodeURIComponent(context.conversationId)}/interactions/${purpose === 'INSPECT' ? 'inspection' : 'discussion'}`, clone(body), apiOptions(record.key))), body, context.conversationId)
      if (!current(captured)) return false
      if (!receipt) throw new Error('暂时无法确认消息是否受理，请查询记录，勿重复发送。')
      persistRecords(captured, readRecords(storage, captured.scope, context).map(item => item.key === record.key
        ? { ...item, purpose, status: 'ACCEPTED', receipt: clone(receipt) } : item))
      if (body.intent === 'CLARIFICATION_REPLY') selectedPending.value = null
      await readOne(receipt.requestId, captured, purpose)
      await onAccepted?.({ receipt, body, purpose, context: clone(context), isCurrent: () => current(captured) })
      return true
    } catch (cause) {
      if (current(captured)) {
        const notReady = cause?.code === 'TYPED_DELIBERATION_RUNTIME_NOT_READY'
        persistRecords(captured, readRecords(storage, captured.scope, context).map(item => item.key === record.key
          ? { ...item, purpose, status: notReady ? 'NOT_READY' : 'UNKNOWN' } : item))
        error.value = notReady ? '执行工具尚未就绪，本次未受理。内容已保留，请稍后手动发送。' : '暂时无法确认发送结果，请刷新状态。'
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
  const invalidate = () => {
    for (const controller of deliveryControllers) controller.abort()
    deliveryControllers.clear(); deliveryFlight = null; deliveryLoading.value = false
    deliveryItems.value = []; deliveryPage.value = null; deliveryError.value = ''
    generation++; failedReads.clear(); busy.value = false; projections.value = []; selectedPending.value = null; selectedDelivery.value = null; error.value = '' }
  const stopScope = watch(scope, invalidate, { flush: 'sync' })
  const recoveryAvailable = computed(() => { storageRevision.value; return readRecords(storage, scope.value, getContext?.() || {}).some(record => record.status === 'UNKNOWN') })
  return { deliveryHasMore, deliveryLoading, deliveryError, refreshDeliveryChoices, loadMoreDeliveryChoices, deliveryChoices, selectedDeliveryId, chooseDelivery, projections, cards, selectedPending, error, busy, recoveryAvailable, inspectionStatus, refresh, refreshRequests, relatedRequestIds, readOne, submit, recover, resumeUnknown, choosePending, confirmProposal,
    invalidate, dispose: () => { disposed = true; invalidate(); stopScope() } }
}
