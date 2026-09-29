/** Browser-safe projection of the owner-authorized conversation output catalog. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
const HASH = /^[0-9a-f]{64}$/
export const INLINE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'text/plain'])
export const exactOutputId = value => typeof value === 'string' && ID.test(value)

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
    const expected = `${prefix}${encodeURIComponent(item.outputId)}`
    if (item.downloadUrl !== `${expected}?download=true` ||
        (item.previewUrl != null && item.previewUrl !== expected) ||
        (INLINE_MIME.has(item.contentMimeType) && item.previewUrl !== expected) ||
        (!INLINE_MIME.has(item.contentMimeType) && item.previewUrl != null)) return false
    seen.add(item.outputId)
    return true
  }).map(item => Object.freeze({ ...item, requestId, stepId }))
}

// A run can reuse output_1 in a later EXECUTE step. Cache keys must include the
// authoritative request and step rather than the output identifier alone.
export function outputItemKey (item) {
  return JSON.stringify([item?.requestId, item?.stepId, item?.outputId])
}

export function previewKind (mime) {
  if (/^image\/(?:png|jpeg|webp|gif)$/.test(mime)) return 'image'
  if (/^audio\/(?:mpeg|wav|ogg)$/.test(mime)) return 'audio'
  if (mime === 'text/plain') return 'text'
  return 'file'
}
