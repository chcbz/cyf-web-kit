import { exactPointAndStartId, exactPointAndStartScope } from './hallPointAndStartIntent.js'

const PREFIX = 'cyf.juyiting.requirement-create.v1'
const clone = value => JSON.parse(JSON.stringify(value))
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

// A principal namespace is not a resource ID. Actual Hall scope uses NUL-delimited
// tenant/client/owner components; encoding it does not create backend authority.
export const requirementCreateScope = exactPointAndStartScope

export const requirementReferenceInputs = list => {
  if (!Array.isArray(list) || list.length > 32) return null
  const refs = []
  const seen = new Set()
  for (const item of list) {
    if (!exactKeys(item, ['fileId', 'version', 'purpose']) || !exactPointAndStartId(item.fileId) ||
      !Number.isInteger(item.version) || item.version < 1 || item.version > 2147483647 || item.purpose !== 'REFERENCE') return null
    const key = JSON.stringify([item.fileId, item.version, item.purpose])
    if (seen.has(key)) return null
    seen.add(key)
    refs.push({ fileId: item.fileId, version: item.version, purpose: 'REFERENCE' })
  }
  return refs.sort((a, b) => a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : a.version - b.version)
}

export const requirementCreateBody = payload => {
  if (!object(payload) || Object.keys(payload).some(key => !['title', 'description', 'requiredAbilities', 'reward', 'inputRefs'].includes(key)) ||
    typeof payload.title !== 'string' || !payload.title.trim() ||
    (payload.description != null && typeof payload.description !== 'string') ||
    (payload.requiredAbilities != null && (!Array.isArray(payload.requiredAbilities) || payload.requiredAbilities.some(item => typeof item !== 'string'))) ||
    (payload.reward != null && (!Number.isInteger(payload.reward) || payload.reward < -2147483648 || payload.reward > 2147483647))) return null
  const refs = requirementReferenceInputs(payload.inputRefs ?? [])
  if (!refs) return null
  // Preserve the full original Unicode and null/empty distinctions. Sorting refs
  // only normalizes the selection set; it never chooses a newer file version.
  return { title: payload.title, description: payload.description ?? null,
    requiredAbilities: payload.requiredAbilities == null ? null : [...payload.requiredAbilities],
    reward: payload.reward ?? null, inputRefs: refs }
}

export const requirementCreateReceipt = (value, intent) => {
  if (!exactKeys(value, ['schemaVersion', 'operationId', 'taskId', 'requirementRevision', 'state', 'inputRefs', 'task']) ||
    value.schemaVersion !== 1 || !exactPointAndStartId(value.operationId) || !exactPointAndStartId(value.taskId) ||
    value.requirementRevision !== 1 || value.state !== 'COMMITTED' || !object(value.task) || value.task.id !== value.taskId) return null
  const refs = requirementReferenceInputs(value.inputRefs)
  if (!refs || !equal(refs, intent?.body?.inputRefs)) return null
  const old = intent.receipt
  if (old && ['operationId', 'taskId', 'requirementRevision'].some(key => old[key] !== value[key])) return null
  return clone({ schemaVersion: 1, operationId: value.operationId, taskId: value.taskId,
    requirementRevision: value.requirementRevision, state: value.state, inputRefs: refs, task: value.task })
}

const validIntent = value => exactKeys(value, ['schemaVersion', 'key', 'body', 'receipt']) && value.schemaVersion === 1 &&
  exactPointAndStartId(value.key) && Boolean(requirementCreateBody(value.body)) && equal(value.body, requirementCreateBody(value.body)) &&
  (value.receipt === null || Boolean(requirementCreateReceipt(value.receipt, value)))

/** Immutable original key/body; neither corrupt nor inaccessible storage means absent. */
export const createRequirementCreateIntentStore = ({ storage, scope }) => {
  const name = requirementCreateScope(scope) ? `${PREFIX}.${encodeURIComponent(scope)}` : ''
  const read = () => {
    if (!name || !storage) return { state: 'UNAVAILABLE' }
    let raw
    try { raw = storage.getItem(name) } catch { return { state: 'UNAVAILABLE' } }
    if (raw === null) return { state: 'ABSENT' }
    try {
      const record = JSON.parse(raw)
      return validIntent(record) ? { state: 'PRESENT', record: clone(record) } : { state: 'CORRUPT' }
    } catch { return { state: 'CORRUPT' } }
  }
  const write = record => {
    const old = read()
    if (!['ABSENT', 'PRESENT'].includes(old.state)) return old
    if (!validIntent(record)) return { state: 'CORRUPT' }
    if (old.state === 'PRESENT' && (old.record.key !== record.key || !equal(old.record.body, record.body) ||
      (old.record.receipt && (!record.receipt || !requirementCreateReceipt(record.receipt, old.record))))) return { state: 'CORRUPT' }
    try {
      const encoded = JSON.stringify(record)
      storage.setItem(name, encoded)
      return storage.getItem(name) === encoded ? read() : { state: 'UNAVAILABLE' }
    } catch { return { state: 'UNAVAILABLE' } }
  }
  const settle = expected => {
    const old = read()
    if (old.state !== 'PRESENT') return old
    if (!expected?.receipt || !equal(old.record, expected)) return { state: 'CORRUPT' }
    try {
      storage.removeItem(name)
      return read()
    } catch { return { state: 'UNAVAILABLE' } }
  }
  return { read, write, settle }
}
