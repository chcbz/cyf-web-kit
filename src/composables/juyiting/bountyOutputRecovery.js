import { exactOutputId } from './bountyOutputCatalog.js'

const KEY = /^[A-Za-z0-9._~:/+-]{8,160}$/
const HASH = /^[0-9a-f]{64}$/
const browserStorage = () => { try { return globalThis.sessionStorage } catch { return null } }
const scopedKey = ({ identityKey, conversationId, rootRequestId }) =>
  typeof identityKey === 'string' && identityKey.length > 0 && identityKey.length <= 512 &&
  exactOutputId(conversationId) && exactOutputId(rootRequestId)
    ? `juyiting:output-recovery:v1:${encodeURIComponent(identityKey)}:${conversationId}:${rootRequestId}` : ''
const validEdit = (key, value) => {
  try {
    const ids = JSON.parse(key)
    return Array.isArray(ids) && ids.length === 3 && ids.every(exactOutputId) &&
      value && KEY.test(value.idempotencyKey) && HASH.test(value.sha256) &&
      typeof value.content === 'string' && value.content.trim() && value.content.length <= 4000 &&
      value.requestId === ids[0] && value.stepId === ids[1] && value.outputId === ids[2] &&
      exactOutputId(value.taskId) && Number.isSafeInteger(value.assignmentRevision) && value.assignmentRevision >= 0
  } catch { return false }
}

// Session-scoped recovery only; the authoritative request/output catalogs remain server-owned.
export const readOutputRecovery = (scope, storage = browserStorage()) => {
  const key = scopedKey(scope)
  if (!key || !storage) return { followups: [], edits: {} }
  try {
    const value = JSON.parse(storage.getItem(key) || 'null')
    return { followups: Array.isArray(value?.followups) ? [...new Set(value.followups.filter(exactOutputId))].slice(0, 64) : [],
      edits: Object.fromEntries(Object.entries(value?.edits && typeof value.edits === 'object' && !Array.isArray(value.edits) ? value.edits : {})
        .filter(([id, intent]) => validEdit(id, intent)).slice(0, 32)) }
  } catch { return { followups: [], edits: {} } }
}
export const writeOutputRecovery = (scope, value, storage = browserStorage()) => {
  const key = scopedKey(scope)
  if (!key || !storage) return false
  const safe = { followups: [...new Set((value.followups || []).filter(exactOutputId))].slice(0, 64),
    edits: Object.fromEntries(Object.entries(value.edits || {}).filter(([id, intent]) => validEdit(id, intent)).slice(0, 32)) }
  try { storage.setItem(key, JSON.stringify(safe)); return true } catch { return false }
}
