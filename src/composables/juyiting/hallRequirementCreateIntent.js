import { exactPointAndStartId, exactPointAndStartScope } from './hallPointAndStartIntent.js'

// Keep the original single recovery slot: v1 pending work must block new v2 creation too.
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

const utf8Compare = (left, right) => {
  const encoder = new TextEncoder(), a = encoder.encode(left), b = encoder.encode(right)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return a.length - b.length
}
const wellFormed = value => typeof value === 'string' && [...value].every(char => {
  const code = char.codePointAt(0)
  return code < 0xD800 || code > 0xDFFF
})

/** Neutral product selection. MIME, purpose and execution parameters are server/adapter concerns. */
export const requirementMaterialInputs = list => {
  if (!Array.isArray(list) || list.length > 32) return null
  const attachments = [], seen = new Set()
  for (const item of list) {
    if (!exactKeys(item, ['fileId', 'version']) || !exactPointAndStartId(item.fileId) || !wellFormed(item.fileId) ||
      !Number.isInteger(item.version) || item.version < 1 || item.version > 2147483647) return null
    const key = JSON.stringify([item.fileId, item.version])
    if (seen.has(key)) return null
    seen.add(key)
    attachments.push({ fileId: item.fileId, version: item.version })
  }
  return attachments.sort((a, b) => utf8Compare(a.fileId, b.fileId) || a.version - b.version)
}

export const requirementMaterialsBody = payload => {
  if (!object(payload) || Object.keys(payload).some(key => !['title', 'description', 'requiredAbilities', 'reward', 'attachments'].includes(key)) ||
    !wellFormed(payload.title) || !payload.title.trim() ||
    (payload.description != null && !wellFormed(payload.description)) ||
    (payload.requiredAbilities != null && (!Array.isArray(payload.requiredAbilities) || payload.requiredAbilities.some(item => !wellFormed(item)))) ||
    (payload.reward != null && (!Number.isInteger(payload.reward) || payload.reward < -2147483648 || payload.reward > 2147483647))) return null
  const attachments = requirementMaterialInputs(Object.hasOwn(payload, 'attachments') ? payload.attachments : [])
  if (!attachments) return null
  return { title: payload.title, description: payload.description ?? null,
    requiredAbilities: payload.requiredAbilities == null ? null : [...payload.requiredAbilities],
    reward: payload.reward ?? null, attachments }
}

export const requirementMaterialsReceipt = (value, intent) => {
  if (!exactKeys(value, ['schemaVersion', 'operationId', 'taskId', 'requirementRevision', 'state', 'attachments', 'task']) ||
    value.schemaVersion !== 2 || intent?.schemaVersion !== 2 || !exactPointAndStartId(value.operationId) || !exactPointAndStartId(value.taskId) ||
    value.requirementRevision !== 1 || value.state !== 'COMMITTED' || !object(value.task) || value.task.id !== value.taskId) return null
  const attachments = requirementMaterialInputs(value.attachments)
  if (!attachments || !equal(attachments, intent.body?.attachments)) return null
  const old = intent.receipt
  if (old && ['operationId', 'taskId', 'requirementRevision'].some(key => old[key] !== value[key])) return null
  return clone({ schemaVersion: 2, operationId: value.operationId, taskId: value.taskId,
    requirementRevision: value.requirementRevision, state: value.state, attachments, task: value.task })
}

export const requirementReceiptForIntent = (value, intent) => intent?.schemaVersion === 2
  ? requirementMaterialsReceipt(value, intent) : requirementCreateReceipt(value, intent)
const bodyForIntent = value => value.schemaVersion === 2 ? requirementMaterialsBody(value.body) : requirementCreateBody(value.body)
const validIntent = value => exactKeys(value, ['schemaVersion', 'key', 'body', 'receipt']) && [1, 2].includes(value.schemaVersion) &&
  exactPointAndStartId(value.key) && Boolean(bodyForIntent(value)) && equal(value.body, bodyForIntent(value)) &&
  (value.receipt === null || Boolean(requirementReceiptForIntent(value.receipt, value)))

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
    if (old.state === 'PRESENT' && (old.record.schemaVersion !== record.schemaVersion || old.record.key !== record.key || !equal(old.record.body, record.body) ||
      (old.record.receipt && (!record.receipt || !requirementReceiptForIntent(record.receipt, old.record))))) return { state: 'CORRUPT' }
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
