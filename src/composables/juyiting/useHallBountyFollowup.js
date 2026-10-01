import { computed, ref, unref, watch } from 'vue'
import { buildFollowupIntent, createHallBountyFollowupIntentStore, followupDescriptor, followupId, followupLong, followupScope, validFollowupRecord } from './hallBountyFollowupIntent.js'

export const followupProviderAcknowledgement = 'UNPRICED_EXTERNAL_ACCOUNT_ONE_IMAGE_REQUEST_ATTEMPT'
const clone = value => JSON.parse(JSON.stringify(value))
const unwrap = result => {
  const envelope = result && Object.hasOwn(result, 'code') ? result : result?.data ?? result
  if (envelope && Object.hasOwn(envelope, 'code')) {
    if (![undefined, null, 'E0', '0', 0, '200', 200].includes(envelope.code)) {
      const error = new Error(envelope.msg || envelope.message || '多轮图像办理被拒绝')
      error.code = envelope.code; error.status = envelope.status
      throw error
    }
    return envelope.data?.data ?? envelope.data
  }
  return envelope?.data ?? envelope
}
const key = value => followupId(value) && value.length >= 8
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && Object.keys(value).every(name => keys.includes(name))
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const contextProjection = value => exactKeys(value, ['schemaVersion', 'conversationId', 'conversationGeneration', 'taskId',
  'targetAgentId', 'taskVersion', 'assignmentRevision', 'baselineGrantVersion', 'requirementRevision']) && value.schemaVersion === 1 &&
  followupId(value.conversationId) && followupId(value.taskId) && followupId(value.targetAgentId) &&
  followupLong(value.conversationGeneration) && followupLong(value.taskVersion, true) && followupLong(value.assignmentRevision, true) &&
  followupLong(value.baselineGrantVersion) && followupLong(value.requirementRevision)
const previewProjection = (value, intent, context) => {
  const fields = ['schemaVersion', 'requestId', 'stepId', 'executionIntentId', 'ownerPayloadSha256', 'instructionSha256',
    'sourceSnapshotSha256', 'conversationGeneration', 'taskVersion', 'assignmentRevision', 'grantVersion', 'requirementRevision',
    'targetAgentId', 'operation', 'sources', 'providerBinding', 'modelId', 'custody', 'operatorPolicyRevision', 'pricingMode', 'maxOutboundRequestAttempts']
  if (!exactKeys(value, fields) || value.schemaVersion !== 3 || !followupId(value.requestId) || !followupId(value.stepId) ||
    !followupId(value.executionIntentId) || !hash(value.ownerPayloadSha256) || !hash(value.instructionSha256) || !hash(value.sourceSnapshotSha256) ||
    !followupLong(value.conversationGeneration) || !followupLong(value.taskVersion, true) || !followupLong(value.assignmentRevision, true) ||
    !followupLong(value.grantVersion) || !followupLong(value.requirementRevision) || !followupId(value.targetAgentId) ||
    !['GENERATE_IMAGE', 'EDIT_IMAGE'].includes(value.operation) || !Array.isArray(value.sources) ||
    !exactKeys(value.providerBinding, ['bindingId', 'bindingEpoch']) || !followupDescriptor(value.providerBinding.bindingId) || !followupLong(value.providerBinding.bindingEpoch) ||
    !followupDescriptor(value.modelId) || !followupDescriptor(value.custody) || !followupDescriptor(value.operatorPolicyRevision) ||
    value.pricingMode !== 'UNPRICED_EXTERNAL_ACCOUNT' || value.maxOutboundRequestAttempts !== 1) return null
  const op = intent.actionProposal.kind === 'edit_image' ? 'EDIT_IMAGE' : 'GENERATE_IMAGE'
  if (value.conversationGeneration !== context.conversationGeneration || value.taskVersion !== context.taskVersion ||
    value.assignmentRevision !== context.assignmentRevision || value.grantVersion !== context.baselineGrantVersion ||
    value.requirementRevision !== context.requirementRevision || value.targetAgentId !== context.targetAgentId || value.operation !== op) return null
  return Object.freeze(clone(value))
}
const expectedPreview = preview => ({ ownerPayloadSha256: preview.ownerPayloadSha256, instructionSha256: preview.instructionSha256,
  sourceSnapshotSha256: preview.sourceSnapshotSha256, modelId: preview.modelId, custody: preview.custody,
  operatorPolicyRevision: preview.operatorPolicyRevision })
const issueReceipt = (value, record) => {
  const fields = ['schemaVersion', 'consentId', 'consentState', 'consentVersion', 'operationGrantId', 'operationGrantState',
    'operationGrantVersion', 'taskId', 'conversationId', 'conversationGeneration', 'requestId', 'stepId', 'executionIntentId',
    'targetAgentId', 'operation', 'ownerPayloadSha256', 'instructionSha256', 'sourceSnapshotSha256', 'providerBinding', 'modelId',
    'custody', 'operatorPolicyRevision', 'pricingMode', 'maxOutboundRequestAttempts', 'expiresAt']
  if (!exactKeys(value, fields) || value.schemaVersion !== 2 || !followupId(value.consentId) || value.consentState !== 'ISSUED' ||
    !followupLong(value.consentVersion) || !followupId(value.operationGrantId) || value.operationGrantState !== 'AUTHORIZED' ||
    !followupLong(value.operationGrantVersion) || value.taskId !== record.taskId || value.conversationId !== record.conversationId ||
    value.targetAgentId !== record.targetAgentId || !followupLong(value.conversationGeneration) || !followupId(value.requestId) ||
    !followupId(value.stepId) || !followupId(value.executionIntentId) || !['GENERATE_IMAGE', 'EDIT_IMAGE'].includes(value.operation) ||
    !hash(value.ownerPayloadSha256) || !hash(value.instructionSha256) || !hash(value.sourceSnapshotSha256) ||
    !exactKeys(value.providerBinding, ['bindingId', 'bindingEpoch']) || !followupDescriptor(value.providerBinding.bindingId) ||
    !followupLong(value.providerBinding.bindingEpoch) || !followupDescriptor(value.modelId) || !followupDescriptor(value.custody) ||
    !followupDescriptor(value.operatorPolicyRevision) || value.pricingMode !== 'UNPRICED_EXTERNAL_ACCOUNT' ||
    value.maxOutboundRequestAttempts !== 1 || typeof value.expiresAt !== 'string' || !value.expiresAt) return null
  const preview = record.expectedPreview
  if (value.conversationGeneration !== record.intent.expectedConversationGeneration || value.requestId !== record.preview.requestId ||
    value.stepId !== record.preview.stepId || value.executionIntentId !== record.preview.executionIntentId ||
    value.operation !== record.preview.operation || value.ownerPayloadSha256 !== preview.ownerPayloadSha256 ||
    value.instructionSha256 !== preview.instructionSha256 || value.sourceSnapshotSha256 !== preview.sourceSnapshotSha256 ||
    value.providerBinding.bindingId !== record.providerBinding.bindingId || value.providerBinding.bindingEpoch !== record.providerBinding.bindingEpoch ||
    value.modelId !== preview.modelId || value.custody !== preview.custody || value.operatorPolicyRevision !== preview.operatorPolicyRevision) return null
  return Object.freeze(clone(value))
}
const finalReceipt = (value, record) => {
  const fields = ['schemaVersion', 'requestId', 'userMessageId', 'stepId', 'executionIntentId', 'consentId', 'operationGrantId',
    'state', 'stateVersion', 'eventCursor', 'statusUrl', 'replay']
  if (!exactKeys(value, fields) || value.schemaVersion !== 3 || value.requestId !== record.preview.requestId ||
    !followupId(value.userMessageId) || value.stepId !== record.preview.stepId || value.executionIntentId !== record.preview.executionIntentId ||
    value.consentId !== record.issueReceipt?.consentId || value.operationGrantId !== record.issueReceipt?.operationGrantId ||
    typeof value.state !== 'string' || !value.state || !followupLong(value.stateVersion, true) || typeof value.eventCursor !== 'string' ||
    !value.eventCursor || typeof value.statusUrl !== 'string' || !value.statusUrl || typeof value.replay !== 'boolean') return null
  return Object.freeze(clone(value))
}
const stableContext = (projection, current) => projection && current && projection.conversationId === current.conversationId &&
  projection.taskId === current.taskId && projection.targetAgentId === current.targetAgentId
const state0 = () => ({ status: 'IDLE', record: null, preview: null, receipt: null, error: null })

/** F1 schema-3 EXECUTE only. No legacy stream/schema-2 fallback and no automatic POST from recovery. */
export const useHallBountyFollowup = ({ chatApi, actorScopeKey, authorizationGeneration, getContext, getContextGeneration, storage = null,
  keys = {}, enabled = () => false, onAdmitted = null }) => {
  const scope = computed(() => unref(typeof actorScopeKey === 'function' ? actorScopeKey() : actorScopeKey))
  const state = ref(state0()); const busy = ref(false)
  let generation = 0; let disposed = false
  const capture = () => {
    const current = getContext?.() || {}
    return Object.freeze({ generation, scope: scope.value, authorization: unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration),
      contextGeneration: getContextGeneration?.(), conversationId: current.conversationId || '', taskId: current.taskId || '', targetAgentId: current.targetAgentId || '' })
  }
  const current = captured => !disposed && Boolean(enabled?.()) && captured.generation === generation && captured.scope === scope.value &&
    captured.authorization === unref(typeof authorizationGeneration === 'function' ? authorizationGeneration() : authorizationGeneration) &&
    captured.contextGeneration === getContextGeneration?.() && (() => { const now = getContext?.() || {}; return now.conversationId === captured.conversationId && now.taskId === captured.taskId && now.targetAgentId === captured.targetAgentId })()
  const storeFor = (captured, record) => createHallBountyFollowupIntentStore({ storage, scope: captured.scope,
    conversationId: record?.conversationId || captured.conversationId, taskId: record?.taskId || captured.taskId,
    targetAgentId: record?.targetAgentId || captured.targetAgentId })
  const save = (captured, record) => {
    const stored = storeFor(captured, record).write(record)
    if (stored.state !== 'PRESENT') throw new Error('多轮办理原键持久化核对失败；未继续发送请求')
    return stored.record
  }
  const requestOptions = idempotencyKey => ({ autoLoading: false, needAuth: true, headers: { 'Idempotency-Key': idempotencyKey } })
  const path = (conversationId, suffix = '') => `/conversations/${encodeURIComponent(conversationId)}/interactions${suffix}`
  const fail = (record, status, error) => { state.value = { status, record: record || null, preview: record?.preview || null, receipt: record?.finalReceipt || record?.issueReceipt || null, error: error?.message || String(error || '') } }
  const run = async action => {
    if (disposed || busy.value || !enabled?.() || !followupScope(scope.value)) return false
    const captured = capture()
    if (!followupId(captured.conversationId) || !followupId(captured.taskId) || !followupId(captured.targetAgentId)) return false
    busy.value = true
    try { return Boolean(await action(captured)) } catch (error) { if (current(captured)) fail(state.value.record, 'REJECTED', error); return false } finally { if (current(captured)) busy.value = false }
  }
  const context = async captured => {
    const value = unwrap(await chatApi.get(path(captured.conversationId, '/context'), undefined, { autoLoading: false, needAuth: true }))
    if (!current(captured)) return null
    if (!contextProjection(value) || !stableContext(value, captured)) throw new Error('当前悬赏办理上下文未能权威核对')
    return Object.freeze(clone(value))
  }
  const makeKey = (factory, prefix) => typeof factory === 'function' ? factory() : `${prefix}-${globalThis.crypto?.randomUUID?.() || ''}`
  const prepare = ({ kind, content, inputRefs, continuationOf }) => run(async captured => {
    const projection = await context(captured)
    if (!projection || !current(captured)) return false
    const intent = buildFollowupIntent({ context: projection, content, kind, inputRefs, continuationOf })
    const finalKey = makeKey(keys.createFinalKey, 'mmd-followup-final'); const issueKey = makeKey(keys.createIssueKey, 'mmd-followup-issue')
    if (!intent || !key(finalKey) || !key(issueKey) || finalKey === issueKey) throw new Error('多轮办理意图不符合冻结合同；未发送预览')
    state.value = { status: 'PREVIEWING', record: null, preview: null, receipt: null, error: null }
    const preview = previewProjection(unwrap(await chatApi.create(path(projection.conversationId, '/preview'), clone(intent), requestOptions(finalKey))), intent, projection)
    if (!current(captured)) return false
    if (!preview) throw new Error('服务端预览回执不匹配；未签发同意')
    const record = save(captured, { schemaVersion: 1, finalKey, issueKey, conversationId: projection.conversationId,
      taskId: projection.taskId, targetAgentId: projection.targetAgentId, intent: clone(intent), preview: clone(preview),
      expectedPreview: expectedPreview(preview), providerBinding: clone(preview.providerBinding), authority: null,
      issueReceipt: null, finalReceipt: null, status: 'PREVIEWED' })
    state.value = { status: 'PREVIEWED', record, preview, receipt: null, error: null }
    return true
  })
  const prepareGenerate = ({ content, inputRefs = [] }) => prepare({ kind: 'generate_image', content, inputRefs, continuationOf: null })
  const prepareEdit = ({ content, assetRef, continuationOf }) => prepare({ kind: 'edit_image', content,
    inputRefs: [{ kind: 'CURRENT_CONVERSATION_ASSET', assetRef: clone(assetRef) }], continuationOf })
  const confirm = acknowledgement => run(async captured => {
    const record = state.value.record
    if (!record || record.status !== 'PREVIEWED' || acknowledgement !== followupProviderAcknowledgement || !current(captured)) return false
    const issueBody = { schemaVersion: 2, interactionIdempotencyKey: record.finalKey, intent: clone(record.intent),
      providerBinding: clone(record.providerBinding), expectedPreview: clone(record.expectedPreview), acknowledgement }
    state.value = { status: 'ISSUING', record, preview: record.preview, receipt: null, error: null }
    const issued = issueReceipt(unwrap(await chatApi.create(path(record.conversationId, '/provider-consents'), issueBody, requestOptions(record.issueKey))), record)
    if (!current(captured)) return false
    if (!issued) throw new Error('费用同意回执不匹配；保留原键只读核对')
    let next = save(captured, { ...record, issueReceipt: clone(issued), authority: { consentId: issued.consentId,
      expectedConsentVersion: issued.consentVersion, operationGrantId: issued.operationGrantId,
      expectedOperationGrantVersion: issued.operationGrantVersion }, status: 'ISSUED' })
    state.value = { status: 'ADMITTING', record: next, preview: next.preview, receipt: issued, error: null }
    try {
      const received = finalReceipt(unwrap(await chatApi.create(path(next.conversationId), { ...clone(next.intent), authority: clone(next.authority) }, requestOptions(next.finalKey))), next)
      if (!current(captured)) return false
      if (!received) throw new Error('最终办理回执不匹配；保留原键只读核对')
      next = save(captured, { ...next, finalReceipt: clone(received), status: 'ADMITTED' })
      state.value = { status: 'ADMITTED', record: next, preview: next.preview, receipt: received, error: null }
      if (onAdmitted) await onAdmitted({ record: next, receipt: received, isCurrent: () => current(captured) })
      return true
    } catch (error) {
      if (!current(captured)) return false
      next = save(captured, { ...next, status: 'UNKNOWN' })
      state.value = { status: 'UNKNOWN', record: next, preview: next.preview, receipt: next.issueReceipt, error: error?.message || '最终办理结果待核对' }
      return false
    }
  })
  const readIssue = async (captured, record) => {
    const receipt = issueReceipt(unwrap(await chatApi.get(path(record.conversationId, '/provider-consents/request'), undefined, requestOptions(record.issueKey))), record)
    if (!current(captured)) return null
    if (!receipt) throw new Error('原费用同意回执不匹配')
    return save(captured, { ...record, issueReceipt: clone(receipt), authority: { consentId: receipt.consentId,
      expectedConsentVersion: receipt.consentVersion, operationGrantId: receipt.operationGrantId,
      expectedOperationGrantVersion: receipt.operationGrantVersion }, status: 'ISSUED' })
  }
  const readFinal = async (captured, record) => {
    const receipt = finalReceipt(unwrap(await chatApi.get(path(record.conversationId, '/request'), undefined, requestOptions(record.finalKey))), record)
    if (!current(captured)) return null
    if (!receipt) throw new Error('原最终办理回执不匹配')
    const next = save(captured, { ...record, finalReceipt: clone(receipt), status: 'ADMITTED' })
    state.value = { status: 'ADMITTED', record: next, preview: next.preview, receipt, error: null }
    if (onAdmitted) await onAdmitted({ record: next, receipt, isCurrent: () => current(captured) })
    return next
  }
  // Recovery is GET-only. 404/409/503/unknown never emits a new POST or key.
  const checkOriginal = finalKey => run(async captured => {
    const records = storeFor(captured).read()
    const record = records.records?.[finalKey || state.value.record?.finalKey]
    if (records.state !== 'PRESENT' || !validFollowupRecord(record)) return false
    try {
      let next = record
      if (!next.issueReceipt) next = await readIssue(captured, next)
      if (!next || !current(captured)) return false
      return Boolean(await readFinal(captured, next))
    } catch (error) {
      if (current(captured)) state.value = { status: 'UNKNOWN', record, preview: record.preview, receipt: record.finalReceipt || record.issueReceipt || null,
        error: error?.message || '原办理状态待核对' }
      return false
    }
  })
  const invalidate = () => { generation++; busy.value = false; state.value = state0() }
  const stop = watch(scope, invalidate, { flush: 'sync' })
  return { state, busy, prepareGenerate, prepareEdit, confirm, checkOriginal, invalidate,
    dispose: () => { disposed = true; generation++; busy.value = false; stop() } }
}
