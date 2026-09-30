/** Browser-safe projection of the owner-authorized conversation output catalog. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
const HASH = /^[0-9a-f]{64}$/
export const INLINE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm', 'text/plain'])
export const exactOutputId = value => typeof value === 'string' && ID.test(value)
const assetRefValid = ref => ref && typeof ref === 'object' && !Array.isArray(ref) &&
  Object.keys(ref).length === 2 && Object.keys(ref).every(key => ['assetId', 'revision'].includes(key)) &&
  typeof ref.assetId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(ref.assetId) &&
  typeof ref.revision === 'string' && /^[1-9][0-9]{0,18}$/.test(ref.revision) && BigInt(ref.revision) <= 9223372036854775807n

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
    const expected = `${prefix}${encodeURIComponent(item.outputId)}`
    if (item.downloadUrl !== `${expected}?download=true` ||
        (item.previewUrl != null && item.previewUrl !== expected) ||
        (INLINE_MIME.has(item.contentMimeType) && item.previewUrl !== expected) ||
        (!INLINE_MIME.has(item.contentMimeType) && item.previewUrl != null)) return false
    seen.add(item.outputId)
    return true
  }).map(item => Object.freeze({ ...item, requestId, stepId,
    assetRef: item.assetRef == null ? null : Object.freeze({ assetId: item.assetRef.assetId, revision: item.assetRef.revision }) }))
}

// A run can reuse output_1 in a later EXECUTE step. Cache keys must include the
// authoritative request and step rather than the output identifier alone.
export function outputItemKey (item) {
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
