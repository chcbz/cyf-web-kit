const SCHEMA_VERSION = 1
const PREFIX = 'cyf.juyiting.economy-request-intent.v1'

const requiredString = value => typeof value === 'string' ? value.trim() : ''
const clone = value => JSON.parse(JSON.stringify(value))
const validRecord = record => record && typeof record === 'object' && record.body && typeof record.body === 'object' && Boolean(requiredString(record.key))

/** Actor-scoped funded-create recovery storage. ABSENT is the only writable state. */
export const createEconomyRequestIntentStore = ({ storage, scopeKey }) => {
  const key = () => {
    const scope = requiredString(scopeKey?.())
    return scope ? `${PREFIX}.${encodeURIComponent(scope)}` : ''
  }
  const readAll = () => {
    const storageKey = key()
    if (!storageKey || !storage) return { state: 'UNAVAILABLE' }
    let raw
    try { raw = storage.getItem(storageKey) } catch { return { state: 'UNAVAILABLE' } }
    if (raw === null) return { state: 'ABSENT', records: {} }
    try {
      const decoded = JSON.parse(raw)
      if (decoded?.schemaVersion !== SCHEMA_VERSION || !decoded.records || typeof decoded.records !== 'object' || Array.isArray(decoded.records)) return { state: 'CORRUPT' }
      if (Object.values(decoded.records).some(record => !validRecord(record))) return { state: 'CORRUPT' }
      return { state: 'PRESENT', records: decoded.records }
    } catch { return { state: 'CORRUPT' } }
  }
  const writeAll = records => {
    const storageKey = key()
    if (!storageKey || !storage) return false
    try {
      const encoded = JSON.stringify({ schemaVersion: SCHEMA_VERSION, records })
      storage.setItem(storageKey, encoded)
      return storage.getItem(storageKey) === encoded
    } catch { return false }
  }
  return {
    get: operation => {
      const read = readAll()
      if (read.state !== 'PRESENT') return read
      const record = read.records[operation]
      return record ? { state: 'PRESENT', record: clone(record) } : { state: 'ABSENT' }
    },
    save: (operation, record) => {
      const read = readAll()
      if (read.state === 'PRESENT' && read.records[operation]) return { state: 'PRESENT', record: clone(read.records[operation]) }
      if ((read.state !== 'ABSENT' && read.state !== 'PRESENT') || !validRecord(record)) return read.state === 'ABSENT' ? { state: 'CORRUPT' } : read
      // A valid legacy empty envelope means this operation is absent. Preserve
      // any sibling unresolved intent rather than replacing its namespace.
      const records = { ...(read.records || {}), [operation]: clone(record) }
      return writeAll(records) ? { state: 'PRESENT', record: clone(records[operation]) } : { state: 'UNAVAILABLE' }
    },
    remove: operation => {
      const read = readAll()
      if (read.state === 'ABSENT') return { state: 'ABSENT' }
      if (read.state !== 'PRESENT') return read
      const records = { ...read.records }
      delete records[operation]
      return writeAll(records) ? { state: 'ABSENT' } : { state: 'UNAVAILABLE' }
    }
  }
}
