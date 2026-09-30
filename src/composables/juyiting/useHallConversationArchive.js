import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from '../useHttp.js'

const MAX_FILE_VERSION = 2147483647
const ID = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
const revisionOf = value => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  return typeof text === 'string' && /^[1-9][0-9]*$/.test(text) && BigInt(text) <= 9223372036854775807n ? text : ''
}
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const abortError = message => new DOMException(message, 'AbortError')
const unwrap = response => {
  let value = response
  for (let index = 0; index < 2 && value && typeof value === 'object' && Object.hasOwn(value, 'data'); index += 1) value = value.data
  return value
}
const operationStates = new Set(['pending', 'saving', 'saved', 'partial_failed'])
const itemStates = new Set(['pending', 'saving', 'saved', 'failed'])
const keyFor = ({ assetId, revision }) => `${assetId}\u0000${revision}`
const archiveStorageKey = (identityScope, conversationId, part) => {
  if (typeof identityScope !== 'string' || !identityScope || identityScope.length > 512 || !ID(conversationId) || !ID(part?.assetId) || !revisionOf(part?.revision)) return ''
  return `juyiting:archive-intent:v1:${encodeURIComponent(identityScope)}:${conversationId}:${part.assetId}:${revisionOf(part.revision)}`
}
const browserStorage = () => { try { return globalThis.sessionStorage } catch { return null } }
const persistedIntent = (storage, key) => {
  if (!storage || !key) return null
  try {
    const entry = JSON.parse(storage.getItem(key) || 'null')
    if (!entry || !validIdempotencyKey(entry.idempotencyKey) ||
        (entry.operationId != null && entry.operationId !== '' && !ID(entry.operationId))) return null
    return { state: 'unknown', message: '已找到先前的保存操作，请查询原操作，不要创建新的保存。',
      busy: false, idempotencyKey: entry.idempotencyKey, operationId: entry.operationId || '' }
  } catch { return null }
}
const storeIntent = (storage, key, intent) => {
  if (!storage || !key || !validIdempotencyKey(intent.idempotencyKey)) return
  try { storage.setItem(key, JSON.stringify({ idempotencyKey: intent.idempotencyKey, operationId: intent.operationId || '' })) } catch { /* No persistent browser storage: this tab still reuses the in-memory key. */ }
}
const defaultIdempotencyKey = () => {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (!uuid) throw new Error('当前环境不能生成安全的幂等键，未发送保存请求。')
  return `conversation-archive-${uuid}`
}
const validIdempotencyKey = value => typeof value === 'string' && /^[A-Za-z0-9._~:/+-]{8,160}$/.test(value)
const validPart = part => part && part.state === 'ready' && ['text', 'image', 'audio', 'file'].includes(part.kind) &&
  ID(part.assetId) && revisionOf(part.revision)
const operationItem = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => ['assetId', 'revision', 'state', 'fileId', 'version', 'errorCode', 'message'].includes(key)) &&
  value.assetId === expected.assetId && revisionOf(value.revision) === expected.revision && itemStates.has(value.state) &&
  (value.fileId == null || ID(value.fileId)) && (value.version == null || (Number.isInteger(value.version) && value.version >= 1 && value.version <= MAX_FILE_VERSION)) &&
  (value.errorCode == null || typeof value.errorCode === 'string') && (value.message == null || typeof value.message === 'string')
const operationReceipt = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !Object.keys(value).every(key => ['operationId', 'state', 'revision', 'items'].includes(key)) ||
    !ID(value.operationId) || !operationStates.has(value.state) || !revisionOf(value.revision) || !Array.isArray(value.items) || value.items.length !== 1) return null
  const item = value.items[0]
  if (!operationItem(item, expected)) return null
  // A completed archive must identify the concrete workspace version. A status label alone is never success.
  if (value.state === 'saved' && (item.state !== 'saved' || !ID(item.fileId) || !Number.isInteger(item.version) || item.version < 1)) return null
  if (value.state !== 'saved' && item.state === 'saved') return null
  return { operationId: value.operationId, state: value.state, revision: revisionOf(value.revision), item: { ...item } }
}
const failure = error => {
  if (error?.name === 'AbortError') return ['idle', '']
  if (error?.status === 401 || error?.status === 403) return ['error', '当前身份已无保存权限，未确认保存。']
  // A 404 is deliberately not interpreted as proof that a previous write was not accepted.
  if (error?.status === 404) return ['unknown', '服务端未返回可确认的保存状态；可能尚未启用或当前身份无权访问，未确认保存。']
  if (error?.status === 409) return ['error', '保存幂等键或归档状态发生冲突，未自动重试。请刷新确认。']
  if (error?.status === 422) return ['error', '该会话资产暂不支持保存到工作空间。']
  if (error?.status === 400) return ['error', '保存请求被拒绝；资产引用未被确认。']
  if (error?.status === 503) return ['unknown', '保存服务暂不可用，未确认保存；请稍后查询原操作。']
  if (error?.requestErrorClass === 'network' || error instanceof TypeError) return ['unknown', '网络结果不明确，未确认保存；请查询原操作，不要创建副本。']
  return ['error', error?.message || '保存未完成，尚不能确认已保存。']
}

/**
 * Owner-scoped archive client for a single persisted conversation asset. It deliberately accepts only
 * assetId + immutable revision; filenames, generated URLs, storage paths and model-authored text never
 * enter the archive wire payload.
 */
export function useHallConversationArchive ({ api = createApi('/chat'), conversationId = null, identityEpoch = 0, identityScope = null, storage = browserStorage(), idempotencyKeyFactory = defaultIdempotencyKey } = {}) {
  const records = ref({})
  const currentConversationId = computed(() => valueOf(conversationId))
  const currentEpoch = computed(() => String(valueOf(identityEpoch) ?? ''))
  const stableIdentity = computed(() => valueOf(identityScope))
  const intentKey = part => archiveStorageKey(stableIdentity.value, currentConversationId.value, part)
  const scopeKey = computed(() => ID(currentConversationId.value) ? `${currentEpoch.value}\u0000${stableIdentity.value || ''}\u0000${currentConversationId.value}` : '')
  const controllers = new Set()
  let generation = 0
  let disposed = false

  const reset = () => {
    generation += 1
    for (const controller of controllers) controller.abort(abortError('Conversation archive context changed'))
    controllers.clear()
    records.value = {}
  }
  const active = (snapshot, controller) => !disposed && snapshot.generation === generation && snapshot.scopeKey === scopeKey.value && !controller.signal.aborted
  const put = (key, value) => { records.value = { ...records.value, [key]: value } }
  const request = async (options, snapshot) => {
    const controller = new AbortController()
    controllers.add(controller)
    try {
      const response = await api.execute({ ...options, autoLoading: false, needAuth: true, signal: controller.signal })
      if (!active(snapshot, controller)) throw abortError('Conversation archive context changed')
      return unwrap(response)
    } finally { controllers.delete(controller) }
  }
  const statusFor = part => {
    if (!validPart(part)) return { state: 'idle', message: '', busy: false, operationId: '' }
    return records.value[keyFor(part)] || persistedIntent(storage, intentKey(part)) || { state: 'idle', message: '', busy: false, operationId: '' }
  }
  const updateFromReceipt = (key, entry, receipt) => {
    const message = receipt.state === 'saved'
      ? `服务端已保存到工作空间：文件 ${receipt.item.fileId} v${receipt.item.version}。`
      : receipt.state === 'partial_failed'
        ? (receipt.item.message || '保存仅部分完成；此项尚未保存。')
        : '保存请求已受理，正在等待服务端确认。'
    const next = { ...entry, state: receipt.state, message, busy: false, operationId: receipt.operationId, revision: receipt.revision, item: receipt.item }
    put(key, next)
    storeIntent(storage, intentKey(receipt.item), next)
    return next
  }
  const check = async part => {
    const current = statusFor(part)
    if (!validPart(part) || !current.operationId || current.busy || !scopeKey.value) return null
    const snapshot = { generation, scopeKey: scopeKey.value }
    const key = keyFor(part)
    const entry = { ...current, state: 'saving', busy: true, message: '正在查询服务端保存状态…' }
    put(key, entry)
    try {
      const raw = await request({ url: `/conversations/${encodeURIComponent(currentConversationId.value)}/archive-operations/${encodeURIComponent(current.operationId)}`, method: 'GET' }, snapshot)
      const receipt = operationReceipt(raw, part)
      if (!receipt) throw new Error('保存状态回执格式无效，尚不能确认已保存。')
      return updateFromReceipt(key, entry, receipt)
    } catch (error) {
      if (error?.name === 'AbortError' || snapshot.generation !== generation || snapshot.scopeKey !== scopeKey.value || disposed) return null
      const [state, message] = failure(error)
      put(key, { ...entry, state, message, busy: false })
      return null
    }
  }
  const send = async (part, existing = null) => {
    if (!validPart(part) || !scopeKey.value || !ID(currentConversationId.value)) return null
    const key = keyFor(part)
    const current = existing || statusFor(part)
    if (current.busy || current.state === 'saved') return null
    let idempotencyKey = current.idempotencyKey
    if (!idempotencyKey) {
      try { idempotencyKey = idempotencyKeyFactory() } catch (error) {
        put(key, { ...current, state: 'error', message: error.message || '未生成幂等键，未发送保存请求。', busy: false, operationId: '' })
        return null
      }
    }
    if (!validIdempotencyKey(idempotencyKey)) {
      put(key, { ...current, state: 'error', message: '生成的幂等键无效，未发送保存请求。', busy: false, operationId: '' })
      return null
    }
    const snapshot = { generation, scopeKey: scopeKey.value }
    const entry = { ...current, state: 'saving', message: '正在提交保存请求…', busy: true, idempotencyKey, operationId: current.operationId || '', item: null }
    put(key, entry)
    // Record the intent before the POST: a lost ACK or page refresh must not create a second file.
    storeIntent(storage, intentKey(part), entry)
    const body = { mode: 'create', items: [{ assetRef: { assetId: part.assetId, revision: revisionOf(part.revision) } }] }
    try {
      const raw = await request({ url: `/conversations/${encodeURIComponent(currentConversationId.value)}/archive-operations`, method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, data: body }, snapshot)
      const receipt = operationReceipt(raw, part)
      if (!receipt) throw new Error('保存回执格式无效，尚不能确认已保存。')
      const next = updateFromReceipt(key, entry, receipt)
      return next.state === 'saved' || next.state === 'partial_failed' ? next : check(part)
    } catch (error) {
      if (error?.name === 'AbortError' || snapshot.generation !== generation || snapshot.scopeKey !== scopeKey.value || disposed) return null
      const [state, message] = failure(error)
      put(key, { ...entry, state, message, busy: false })
      return null
    }
  }
  const retry = async part => {
    const current = statusFor(part)
    if (!current.operationId) return send(part, current)
    // A known operation may be left PROCESSING after the ACK/worker was lost. First
    // read the owner-scoped fact; only an explicit retry of a still-pending result
    // replays the original immutable POST/key so the server can reconcile its write.
    const status = await check(part)
    if (status && ['pending', 'saving'].includes(status.state) && validIdempotencyKey(status.idempotencyKey)) {
      return send(part, status)
    }
    return status
  }
  const save = part => retry(part)

  const stop = watch(scopeKey, reset, { immediate: true, flush: 'sync' })
  const dispose = () => { if (!disposed) { disposed = true; stop(); reset() } }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { records, statusFor, save, retry, check, reset, dispose }
}
