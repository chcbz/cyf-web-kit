import { computed, shallowRef } from 'vue'

const randomKey = () => globalThis.crypto?.randomUUID?.() || `pws-${Date.now()}-${Math.random().toString(36).slice(2)}`
const pendingStates = new Set(['SENDING', 'UNKNOWN', 'PROCESSING'])
const sameInput = (left, right) => left.length === right.length && left.every((value, index) => value === right[index])
const rejectedCodes = new Set(['BAD_REQUEST', 'FILE_NOT_FOUND', 'METADATA_CHANGED', 'PRECONDITION_REQUIRED',
  'FILE_VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'FILE_TYPE_UNSUPPORTED', 'TASK_FILE_LINK_NOT_FOUND', 'CONVERSATION_FILE_LINK_NOT_FOUND', 'TASK_FILE_LINK_CHANGED',
  'CONVERSATION_FILE_LINK_CHANGED', 'OUTPUT_LINK_MANAGED_BY_EXECUTION'])

/** Instance-local immutable write intentions, not a durable or cross-tab recovery journal. */
export function usePersonalWorkspaceWriteIntent () {
  const entries = new Map()
  const revision = shallowRef(0)
  let generation = 0
  const publish = () => { revision.value += 1 }
  const pending = computed(() => {
    void revision.value
    return [...entries.values()].filter(entry => pendingStates.has(entry.state))
      .map(({ target, label, state }) => ({ target, label, state }))
  })
  const attempt = entry => {
    if (entry.promise) return entry.promise
    const epoch = generation
    entry.state = 'SENDING'
    // Register before executing user code or the first await, including synchronous double clicks.
    entry.promise = Promise.resolve().then(async () => {
      try {
        if (epoch !== generation) return null
        const value = await entry.execute(entry.key, entry.attempts++ > 0)
        if (epoch !== generation) return null
        entry.state = 'COMMITTED'
        publish()
        // A known successful write must never become UNKNOWN because its follow-up GET failed.
        await entry.committed?.(value)
        return value
      } catch (cause) {
        if (epoch !== generation) return null
        if (entry.state !== 'COMMITTED') {
          entry.state = cause?.code === 'OPERATION_PROCESSING' ? 'PROCESSING'
            : rejectedCodes.has(cause?.code) && cause?.status >= 400 && cause?.status < 500 ? 'REJECTED' : 'UNKNOWN'
          publish()
        }
        throw cause
      } finally {
        entry.promise = null
        if (epoch === generation) {
          // Terminal records no longer need to retain File objects or request closures.
          if (!pendingStates.has(entry.state) && entries.get(entry.target) === entry) entries.delete(entry.target)
          publish()
        }
      }
    })
    publish()
    return entry.promise
  }
  const run = ({ target, input, label, execute, committed }) => {
    const prior = entries.get(target)
    if (prior) {
      if (!sameInput(prior.input, input)) {
        return Promise.reject(new Error('该目标有结果尚未确认的操作，请先重试，不要修改内容后重复提交。'))
      }
      return attempt(prior)
    }
    const entry = { target, input: [...input], label, execute, committed, key: randomKey(), state: 'PREPARED', attempts: 0, promise: null }
    entries.set(target, entry)
    return attempt(entry)
  }
  const retry = target => entries.has(target) ? attempt(entries.get(target)) : Promise.resolve(null)
  const clear = () => { generation += 1; entries.clear(); publish() }
  return { pending, run, retry, clear }
}
