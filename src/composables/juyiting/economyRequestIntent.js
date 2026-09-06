const SCHEMA_VERSION = 1
const PREFIX = 'cyf.juyiting.economy-request-intent.v1'

const requiredString = value => typeof value === 'string' ? value.trim() : ''
const clone = value => JSON.parse(JSON.stringify(value))

/**
 * Stores one immutable, actor-scoped funded request before its first send.
 * Callers may only replay the stored body/key until they obtain a documented
 * no-effect result or a canonical success readback.
 */
export const createEconomyRequestIntentStore = ({ storage, scopeKey }) => {
  const key = () => {
    const scope = requiredString(scopeKey?.())
    return scope ? `${PREFIX}.${encodeURIComponent(scope)}` : ''
  }
  const readAll = () => {
    const storageKey = key()
    if (!storageKey || !storage) return {}
    try {
      const decoded = JSON.parse(storage.getItem(storageKey) || '{}')
      return decoded?.schemaVersion === SCHEMA_VERSION && decoded.records && typeof decoded.records === 'object' ? decoded.records : {}
    } catch { return {} }
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
      const record = readAll()[operation]
      return record && typeof record === 'object' ? clone(record) : null
    },
    save: (operation, record) => {
      const records = readAll()
      if (records[operation]) return clone(records[operation])
      const stored = { ...records, [operation]: clone(record) }
      return writeAll(stored) ? clone(stored[operation]) : null
    },
    remove: operation => {
      const records = readAll()
      if (!Object.prototype.hasOwnProperty.call(records, operation)) return true
      delete records[operation]
      return writeAll(records)
    }
  }
}
