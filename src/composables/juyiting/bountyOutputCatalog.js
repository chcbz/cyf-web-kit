import { typedOutcomeProjection } from './hallTypedDeliberation.js'

/** Browser-safe projection of the owner-authorized conversation output catalog. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
const HASH = /^[0-9a-f]{64}$/
export const INLINE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm', 'text/plain'])
export const exactOutputId = value => typeof value === 'string' && ID.test(value)
const assetRefValid = ref => ref && typeof ref === 'object' && !Array.isArray(ref) &&
  Object.keys(ref).length === 2 && Object.keys(ref).every(key => ['assetId', 'revision'].includes(key)) &&
  typeof ref.assetId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(ref.assetId) &&
  typeof ref.revision === 'string' && /^[1-9][0-9]{0,18}$/.test(ref.revision) && BigInt(ref.revision) <= 9223372036854775807n

const replacementValid = ref => ref && typeof ref === 'object' && !Array.isArray(ref) &&
  Object.keys(ref).length === 4 && Object.keys(ref).every(key => ['requestId', 'stepId', 'outputId', 'sha256'].includes(key)) &&
  [ref.requestId, ref.stepId, ref.outputId].every(exactOutputId) && typeof ref.sha256 === 'string' && HASH.test(ref.sha256)

// Only the server's persisted asset reference can enter the existing archive client.
export function outputAssetPart (item) {
  if (!assetRefValid(item?.assetRef)) return null
  return Object.freeze({ state: 'ready', kind: previewKind(item.contentMimeType),
    assetId: item.assetRef.assetId, revision: item.assetRef.revision })
}

export function scopedExecutionSteps (request, conversationId) {
  if (!exactOutputId(request?.requestId) || request?.conversationId !== conversationId) return []
  return (Array.isArray(request.steps) ? request.steps : []).filter(step =>
    step?.kind === 'EXECUTE' && exactOutputId(step.stepId) && exactOutputId(step.executionId)
  ).map(step => ({ requestId: request.requestId, stepId: step.stepId }))
}

export function outputCatalogItems (items, requestId, stepId) {
  if (!exactOutputId(requestId) || !exactOutputId(stepId) || !Array.isArray(items) || items.length > 128) return []
  const prefix = `/chat/requests/${encodeURIComponent(requestId)}/steps/${encodeURIComponent(stepId)}/outputs/`
  const seen = new Set()
  return items.filter(item => {
    if (!exactOutputId(item?.outputId) || seen.has(item.outputId) ||
        typeof item.contentMimeType !== 'string' || !item.contentMimeType ||
        typeof item.sha256 !== 'string' || !HASH.test(item.sha256) ||
        !Number.isSafeInteger(item.byteLength) || item.byteLength < 0) return false
    if (item.assetRef != null && !assetRefValid(item.assetRef)) return false
    if (item.replaces != null && (!replacementValid(item.replaces) || item.replaces.requestId === requestId)) return false
    const expected = `${prefix}${encodeURIComponent(item.outputId)}`
    if (item.downloadUrl !== `${expected}?download=true` ||
        (item.previewUrl != null && item.previewUrl !== expected) ||
        (INLINE_MIME.has(item.contentMimeType) && item.previewUrl !== expected) ||
        (!INLINE_MIME.has(item.contentMimeType) && item.previewUrl != null)) return false
    seen.add(item.outputId)
    return true
  }).map(item => Object.freeze({ ...item, requestId, stepId,
    replaces: item.replaces == null ? null : Object.freeze({ ...item.replaces }),
    assetRef: item.assetRef == null ? null : Object.freeze({ assetId: item.assetRef.assetId, revision: item.assetRef.revision }) }))
}

// A run can reuse output_1 in a later EXECUTE step. Cache keys must include the
// authoritative request and step rather than the output identifier alone.
export function outputItemKey (item) {
  if (item?.messageSource) return JSON.stringify(['COMPLETED_MESSAGE', item.requestId, item.messageSource.turnId,
    item.messageSource.messageId, item.messageSource.snapshotId, item.messageSource.finalDigest])
  return JSON.stringify([item?.requestId, item?.stepId, item?.outputId])
}

export function previewKind (mime) {
  if (/^image\/(?:png|jpeg|webp|gif)$/.test(mime)) return 'image'
  if (/^audio\/(?:mpeg|wav|ogg|mp4|webm)$/.test(mime)) return 'audio'
  if (mime === 'text/plain') return 'text'
  return 'file'
}

// Matches the server's passive attachment formats. Unsupported/active types use
// an opaque transport MIME, while the immutable catalogue hash still pins bytes.
const DOWNLOAD_EXTENSIONS = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'],
  ['audio/mpeg', 'mp3'], ['audio/wav', 'wav'], ['audio/ogg', 'ogg'], ['audio/mp4', 'm4a'],
  ['audio/webm', 'webm'], ['text/plain', 'txt'], ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx']
])
export const downloadMimeType = mime => DOWNLOAD_EXTENSIONS.has(mime) ? mime : 'application/octet-stream'
export const outputDownloadName = item => `${exactOutputId(item?.outputId) ? item.outputId : 'output'}.${DOWNLOAD_EXTENSIONS.get(item?.contentMimeType) || 'bin'}`

/** Apply only explicit server edit relations to an already explicit delivery list.
 * The caller must supply its persisted initial references. This never seeds a list
 * from history, MIME, arrival order or the active request. Missing/branched parents
 * require clarification rather than silently appending or choosing a latest draft.
 */
export function applyOutputReplacements (current, edits) {
  if (!Array.isArray(current) || !Array.isArray(edits) || !current.length) throw new Error('本次交付来源尚未明确。')
  const result = [...current]
  const keys = new Set()
  for (const item of result) {
    if (![item?.requestId, item?.stepId, item?.outputId].every(exactOutputId) || (typeof item?.sha256 !== 'string' || !HASH.test(item.sha256)) || keys.has(outputItemKey(item))) throw new Error('本次交付来源无效。')
    keys.add(outputItemKey(item))
  }
  // The caller's explicit edit order is persisted causal order, not network completion order.
  for (const edit of edits) {
    if (![edit?.requestId, edit?.stepId, edit?.outputId].every(exactOutputId) || (typeof edit?.sha256 !== 'string' || !HASH.test(edit.sha256)) || !replacementValid(edit?.replaces)) throw new Error('改稿未关联明确的原成果。')
    const parentKey = outputItemKey(edit.replaces)
    const index = result.findIndex(item => outputItemKey(item) === parentKey && item.sha256 === edit.replaces.sha256)
    if (index < 0 || keys.has(outputItemKey(edit))) throw new Error('改稿对象已变化，请在会话中明确要使用的稿件。')
    keys.delete(parentKey); keys.add(outputItemKey(edit))
    result[index] = edit
  }
  return Object.freeze(result.map(item => Object.freeze({ ...item,
    replaces: item.replaces == null ? null : Object.freeze({ ...item.replaces }) })))
}

/** A committed manifest is one explicit batch. With multiple independent batches
 * the conversation must clarify delivery intent; never union history or pick a latest batch.
 * Edits are resolved by exact parent hashes, independent of response arrival order. */
export function currentOutputDelivery (catalog, executionDeliveries = []) {
  if (executionDeliveries.length) return explicitExecutionDelivery(catalog, executionDeliveries)
  if (!Array.isArray(catalog) || !catalog.length) return Object.freeze([])
  const texts = catalog.filter(item => item.messageSource)
  if (texts.length) {
    if (catalog.length !== texts.length) throw new Error('本次图文或多轮文字交付关联尚不明确，请回到议事说明本次成果。')
    return textDeliveryProjection(texts).items
  }
  const originals = catalog.filter(item => !item.replaces)
  const roots = new Set(originals.map(item => JSON.stringify([item.requestId, item.stepId])))
  if (roots.size !== 1) throw new Error('本次交付范围尚不明确，请回到议事说明要交付哪些成果。')
  let current = applyOutputReplacements(originals, [])
  let pending = catalog.filter(item => item.replaces)
  while (pending.length) {
    const available = pending.filter(edit => current.some(item => outputItemKey(item) === outputItemKey(edit.replaces) && item.sha256 === edit.replaces.sha256))
    const parents = available.map(edit => outputItemKey(edit.replaces))
    if (!available.length || new Set(parents).size !== parents.length) throw new Error('改稿关联有歧义，请在议事中明确本次使用的稿件。')
    current = applyOutputReplacements(current, available)
    pending = pending.filter(edit => !available.includes(edit))
  }
  return current
}

/** Only a persisted, explicitly marked CHAT final can seed a text deliverable.
 * The original turn supplies snapshot/message identity. Never pick a latest ANSWER,
 * turn display prose into an output, or invent an execution/step identifier. */
export async function completedTextItem (raw, request, turn, taskId) {
  const value = typedOutcomeProjection(raw, { conversationId: request.conversationId,
    conversationGeneration: request.conversationGeneration, requestId: request.requestId,
    requestRevision: request.requestRevision, turnId: turn.turnId, taskId })
  if (!value) throw new Error('文字成果来源回执不匹配。')
  if (value.schemaVersion !== 3 || value.state !== 'READY' || value.outcome?.deliverable !== true) return null
  const source = value.outcome.messageSource
  if (request.state !== 'COMPLETED' || turn.route !== 'CHAT' || !['FINAL_PERSISTED', 'PUBLISHED'].includes(turn.state) ||
    source.messageId !== turn.finalMessageId || source.snapshotId !== turn.contextSnapshotId ||
    turn.requestId !== request.requestId || turn.requestRevision !== request.requestRevision ||
    turn.conversationId !== request.conversationId || turn.conversationGeneration !== request.conversationGeneration ||
    !exactOutputId(taskId) || value.outcome.taskId !== taskId ||
    ![request.requestId, source.turnId, source.snapshotId].every(exactOutputId)) throw new Error('文字成果与原消息快照不一致。')
  const bytes = new TextEncoder().encode(value.outcome.text)
  const sha256 = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  return Object.freeze({ requestId: request.requestId, outcomeId: value.outcome.outcomeId,
    deliveryRelation: value.outcome.deliveryRelation == null ? null : Object.freeze({ ...value.outcome.deliveryRelation }), messageSource: Object.freeze({ ...source }), sha256,
    contentMimeType: 'text/plain', byteLength: bytes.length, text: value.outcome.text,
    taskId, assignmentRevision: value.outcome.assignmentRevision, title: '文字成果', purpose: '本次确认交付成果' })
}

/** Replay only explicit persisted text relations. The terminal causal node is the
 * basis for a follow-up, not the latest message or the latest item by MIME. */
export function textDeliveryProjection (texts) {
  if (!Array.isArray(texts) || !texts.length) return Object.freeze({ items: Object.freeze([]), basis: null })
  const nodes = new Map()
  for (const text of texts) {
    if (!exactOutputId(text?.outcomeId) || nodes.has(text.outcomeId) || !/^sha256:[0-9a-f]{64}$/.test(text.messageSource?.finalDigest || '')) throw new Error('文字交付关联尚不明确。')
    nodes.set(text.outcomeId, text)
  }
  const roots = texts.filter(text => !text.deliveryRelation)
  if (roots.length !== 1) throw new Error('多轮文字交付关联尚不明确，请回到议事说明本次成果。')
  const children = new Map()
  for (const text of texts.filter(text => text.deliveryRelation)) {
    const relation = text.deliveryRelation; const parent = nodes.get(relation.parentOutcomeId)
    if (!parent || parent.messageSource.finalDigest !== relation.parentFinalDigest || !['APPEND', 'REPLACE', 'RESET'].includes(relation.mode) || children.has(parent.outcomeId)) throw new Error('文字改稿关联有歧义，请回到议事明确本次成果。')
    if ((Object.hasOwn(relation, 'targetOutcomeId') || Object.hasOwn(relation, 'targetFinalDigest')) && relation.mode !== 'REPLACE') throw new Error('文字改稿对象不匹配。')
    children.set(parent.outcomeId, text)
  }
  let node = roots[0]; let result = [node]; const visited = new Set([node.outcomeId])
  while (children.has(node.outcomeId)) {
    const child = children.get(node.outcomeId)
    if (visited.has(child.outcomeId)) throw new Error('文字交付关联有歧义。')
    visited.add(child.outcomeId)
    if (child.deliveryRelation.mode === 'APPEND') result.push(child)
    else if (child.deliveryRelation.mode === 'RESET') result = [child]
    else {
      const relation = child.deliveryRelation
      const target = relation.targetOutcomeId ?? node.outcomeId
      const targetDigest = relation.targetFinalDigest ?? node.messageSource.finalDigest
      if ((Object.hasOwn(relation, 'targetOutcomeId') !== Object.hasOwn(relation, 'targetFinalDigest')) ||
        (Object.hasOwn(relation, 'targetOutcomeId') && (!exactOutputId(target) || !/^sha256:[0-9a-f]{64}$/.test(targetDigest)))) throw new Error('文字改稿对象不匹配。')
      const index = result.findIndex(item => item.outcomeId === target && item.messageSource.finalDigest === targetDigest)
      if (index < 0) throw new Error('文字改稿对象已变化。')
      result[index] = child
    }
    node = child
  }
  if (visited.size !== texts.length) throw new Error('文字交付关联不完整，请回到议事明确本次成果。')
  return Object.freeze({ items: Object.freeze([...result]), basis: Object.freeze({ outcomeId: node.outcomeId, finalDigest: node.messageSource.finalDigest }) })
}

/** Join only the actual v3 action progress child to its completed EXECUTE step.
 * Planning prose and an output's arrival alone cannot manufacture a delivery node.
 * Null step means the explicit requested batch is not ready, never old-work acceptance.
 */
export function completedExecutionDelivery (raw, request, turn, snapshots, taskId) {
  const value = typedOutcomeProjection(raw, { conversationId: request.conversationId,
    conversationGeneration: request.conversationGeneration, requestId: request.requestId,
    requestRevision: request.requestRevision, turnId: turn.turnId, taskId })
  if (!value) throw new Error('媒体交付来源回执不匹配。')
  if (value.schemaVersion !== 3 || value.state !== 'READY' || value.outcome?.kind !== 'ACTION_REQUEST' || !value.outcome.deliveryRelation) return null
  const outcome = value.outcome; const progress = value.actionProgress
  if (request.state !== 'COMPLETED' || turn.route !== 'CHAT' || !['FINAL_PERSISTED', 'PUBLISHED'].includes(turn.state) ||
    turn.finalMessageId !== outcome.assistantMessageId || !exactOutputId(turn.contextSnapshotId) ||
    turn.requestId !== request.requestId || turn.requestRevision !== request.requestRevision ||
    turn.conversationId !== request.conversationId || turn.conversationGeneration !== request.conversationGeneration ||
    !exactOutputId(taskId) || outcome.taskId !== taskId) throw new Error('媒体交付与原动作快照不一致。')
  const node = { outcomeId: outcome.outcomeId, finalDigest: outcome.finalDigest,
    deliveryRelation: Object.freeze({ ...outcome.deliveryRelation }), requestId: progress.childRequestId, stepId: null }
  if (progress.childRoute != null && progress.childRoute !== 'EXECUTE') throw new Error('查阅动作不是媒体交付。')
  if (progress.state !== 'COMPLETED') return Object.freeze(node)
  const children = snapshots.filter(child => child.requestId === progress.childRequestId)
  if (children.length !== 1) return Object.freeze(node) // Late catalog page: keep polling, no guessed child.
  const child = children[0]; const steps = child.steps || []
  if (child.state !== 'OUTPUT_COMMITTED' || child.requestRevision !== '1' || child.stateVersion !== progress.childStateVersion ||
    child.conversationId !== request.conversationId || child.conversationGeneration !== request.conversationGeneration ||
    steps.length !== 1 || steps[0].kind !== 'EXECUTE' || steps[0].state !== 'OUTPUT_COMMITTED' ||
    steps[0].executionState !== 'OUTPUT_COMMITTED' || steps[0].taskId !== taskId ||
    steps[0].assignmentRevision !== outcome.assignmentRevision || steps[0].targetAgentId !== turn.targetAgentId ||
    !exactOutputId(steps[0].stepId) || !exactOutputId(steps[0].executionId)) throw new Error('媒体交付执行来源不一致。')
  return Object.freeze({ ...node, stepId: steps[0].stepId })
}

/** Replay original final metadata for text + explicitly requested independent batches.
 * No persisted collection, new API, history union, latest MIME or action prose output.
 * Legacy media-only manifests keep their original exact replacement projection.
 */
function explicitExecutionDelivery (catalog, executionDeliveries) {
  if (!Array.isArray(catalog) || !Array.isArray(executionDeliveries)) throw new Error('交付来源无效。')
  const texts = catalog.filter(item => item.messageSource)
  const nodes = texts.map(item => ({ outcomeId: item.outcomeId, finalDigest: item.messageSource.finalDigest,
    deliveryRelation: item.deliveryRelation, items: [item] }))
  const assigned = new Set(texts.map(outputItemKey))
  if (assigned.size !== texts.length) throw new Error('交付来源重复。')
  for (const action of executionDeliveries) {
    if (!action?.stepId) throw new Error('本次媒体成果尚未完成，完成后可验收。')
    const relation = action.deliveryRelation
    if (!relation || !['APPEND', 'RESET'].includes(relation.mode) || Object.keys(relation).length !== 3 ||
      ![action.requestId, action.stepId].every(exactOutputId)) throw new Error('媒体交付意图不明确。')
    const batch = catalog.filter(item => !item.messageSource && item.requestId === action.requestId && item.stepId === action.stepId)
    if (!batch.length || batch.some(item => item.replaces || !exactOutputId(item.outputId) || !HASH.test(item.sha256) || assigned.has(outputItemKey(item)))) throw new Error('本次媒体清单尚未明确。')
    for (const item of batch) { const key = outputItemKey(item); if (assigned.has(key)) throw new Error('交付来源重复。'); assigned.add(key) }
    nodes.push({ ...action, items: batch })
  }
  if (assigned.size !== catalog.length) throw new Error('存在未关联本次交付的成果，请回到议事明确。')
  const byId = new Map(); const children = new Map()
  for (const node of nodes) {
    if (!exactOutputId(node.outcomeId) || !/^sha256:[0-9a-f]{64}$/.test(node.finalDigest || '') || byId.has(node.outcomeId)) throw new Error('交付关联来源无效。')
    byId.set(node.outcomeId, node)
  }
  const roots = nodes.filter(node => !node.deliveryRelation)
  if (roots.length !== 1) throw new Error('本次交付范围尚不明确。')
  for (const node of nodes.filter(node => node.deliveryRelation)) {
    const relation = node.deliveryRelation; const parent = byId.get(relation.parentOutcomeId)
    if (!parent || parent.finalDigest !== relation.parentFinalDigest || children.has(parent.outcomeId) ||
      !['APPEND', 'REPLACE', 'RESET'].includes(relation.mode)) throw new Error('交付关联有歧义。')
    children.set(parent.outcomeId, node)
  }
  let current = roots[0]; let retained = [current]; const visited = new Set([current.outcomeId])
  while (children.has(current.outcomeId)) {
    const next = children.get(current.outcomeId); const relation = next.deliveryRelation
    if (visited.has(next.outcomeId)) throw new Error('交付关联有歧义。')
    visited.add(next.outcomeId)
    if (relation.mode === 'APPEND') retained.push(next)
    else if (relation.mode === 'RESET') retained = [next]
    else {
      const target = relation.targetOutcomeId ?? current.outcomeId
      const digest = relation.targetFinalDigest ?? current.finalDigest
      if (Object.hasOwn(relation, 'targetOutcomeId') !== Object.hasOwn(relation, 'targetFinalDigest')) throw new Error('交付改稿对象不匹配。')
      const index = retained.findIndex(node => node.outcomeId === target && node.finalDigest === digest)
      if (index < 0) throw new Error('交付改稿对象已变化。')
      retained[index] = next
    }
    current = next
  }
  if (visited.size !== nodes.length) throw new Error('交付关联不完整。')
  return Object.freeze(retained.flatMap(node => node.items))
}
