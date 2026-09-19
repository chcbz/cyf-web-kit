import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from './useHttp.js'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20
const textMimeTypes = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json'])
const imageMimeTypes = new Set(['image/png', 'image/jpeg'])

const valueOf = value => typeof value === 'function' ? value() : unref(value)
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && !/\s/.test(value)
const validSource = value => value && ['task', 'conversation'].includes(value.type) && validId(value.id)
const abortError = message => new DOMException(message, 'AbortError')

const DELIVERABLE_PAGE_FIELDS = new Set(['items', 'nextCursor', 'publicationPending', 'state'])
const TASK_DELIVERABLE_FIELDS = new Set([
  'artifactId', 'taskId', 'workItemId', 'producerAgentId', 'artifactType', 'title',
  'contentHash', 'contentByteLength', 'contentMimeType', 'artifactVersion', 'visibility', 'createdAt'
])
const CONVERSATION_DELIVERABLE_FIELDS = new Set([
  'outputId', 'executionId', 'fileId', 'fileVersion', 'contentHash', 'contentMimeType',
  'byteLength', 'committedAt', 'state', 'publicationState', 'formalDeliveryState'
])
const DELIVERABLE_STATES = new Set(['AVAILABLE', 'EMPTY', 'SYNCING'])
const unwrap = result => {
  let value = result
  for (let index = 0; index < 3 && value && typeof value === 'object' && Object.hasOwn(value, 'data'); index += 1) value = value.data
  return value
}
const exactId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 &&
  !/^\s|\s$/.test(value) && ![...value].some(char => { const code = char.codePointAt(0); return code < 32 || (code >= 127 && code <= 159) })
const exactText = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum &&
  !/^\s|\s$/.test(value) && ![...value].some(char => { const code = char.codePointAt(0); return code < 32 || (code >= 127 && code <= 159) })
const exactVersion = value => Number.isInteger(value) && value >= 1 && value <= 2147483647
const exactByteLength = value => Number.isSafeInteger(value) && value >= 0 && value <= 64 * 1024 * 1024
const exactMime = value => typeof value === 'string' && /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/.test(value)
const exactTimestamp = value => Number.isSafeInteger(value) && value >= 0
const exactState = value => typeof value === 'string' && DELIVERABLE_STATES.has(value)
const taskDeliverable = (value, taskId) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => TASK_DELIVERABLE_FIELDS.has(key)) && value.taskId === taskId &&
  exactId(value.artifactId) && (value.workItemId == null || exactId(value.workItemId)) &&
  exactId(value.producerAgentId) && exactText(value.artifactType, 100) && exactText(value.title, 255) &&
  typeof value.contentHash === 'string' && /^[0-9a-f]{64}$/.test(value.contentHash) &&
  exactByteLength(value.contentByteLength) && exactMime(value.contentMimeType) &&
  exactVersion(value.artifactVersion) && typeof value.visibility === 'string' &&
  exactTimestamp(value.createdAt)
const conversationDeliverable = value => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => CONVERSATION_DELIVERABLE_FIELDS.has(key)) &&
  exactId(value.outputId) && exactId(value.executionId) && exactId(value.fileId) &&
  exactVersion(value.fileVersion) && typeof value.contentHash === 'string' && /^[0-9a-f]{64}$/.test(value.contentHash) &&
  exactMime(value.contentMimeType) && exactByteLength(value.byteLength) && exactTimestamp(value.committedAt) &&
  value.state === 'AVAILABLE' && value.publicationState === 'WORKSPACE_COMMITTED' &&
  value.formalDeliveryState === 'NOT_APPLICABLE'
const validatedPage = (value, sourceType, sourceId, limit) => {
  const itemValidator = sourceType === 'task'
    ? item => taskDeliverable(item, sourceId)
    : conversationDeliverable
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !Object.keys(value).every(key => DELIVERABLE_PAGE_FIELDS.has(key)) ||
    !Array.isArray(value.items) || value.items.length > limit || !itemValidator || !value.items.every(itemValidator) ||
    (value.state != null && !exactState(value.state)) ||
    (value.publicationPending != null && typeof value.publicationPending !== 'boolean') ||
    (value.nextCursor != null && !exactText(value.nextCursor, 200))) {
    throw new Error('成果目录返回格式无效，未展示可能不完整的数据。')
  }
  const seen = new Set()
  const keyFor = sourceType === 'conversation'
    ? item => `${item.outputId}\u0000${item.fileId}\u0000${item.fileVersion}`
    : item => `${item.artifactId}\u0000${item.artifactVersion}`
  if (value.items.some(item => { const key = keyFor(item); if (seen.has(key)) return true; seen.add(key); return false })) {
    throw new Error('成果目录返回了重复版本，未展示可能不完整的数据。')
  }
  return {
    state: value.state || (value.items.length ? 'AVAILABLE' : 'EMPTY'),
    items: value.items,
    publicationPending: value.publicationPending === true,
    nextCursor: value.nextCursor || null
  }
}

/** Authenticated read adapter. Conversation delivery is reference-only until W04 supplies content actions. */
export const outputReadAdapter = Object.freeze({
  async list ({ sourceType, sourceId, cursor, limit, signal } = {}) {
    if (!['task', 'conversation'].includes(sourceType) || !validId(sourceId) || cursor != null || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw Object.assign(new Error('成果目录请求无效。'), { retryable: false })
    }
    const api = createApi('/agent')
    const path = sourceType === 'conversation'
      ? `/conversations/${encodeURIComponent(sourceId)}/deliverables`
      : `/tasks/${encodeURIComponent(sourceId)}/deliverables`
    const result = unwrap(await api.execute({
      url: path, method: 'GET', params: { limit }, autoLoading: false, needAuth: true, signal
    }))
    return validatedPage(result, sourceType, sourceId, limit)
  },
  async download ({ sourceType, sourceId, artifactId, artifactVersion, signal } = {}) {
    if (sourceType !== 'task' || !validId(sourceId) || !validId(artifactId) || !/^[1-9][0-9]{0,9}$/.test(String(artifactVersion))) {
      throw Object.assign(new Error('成果下载请求无效。'), { retryable: false })
    }
    const api = createApi('/agent')
    const blob = unwrap(await api.execute({
      url: `/tasks/${encodeURIComponent(sourceId)}/deliverables/${encodeURIComponent(artifactId)}/versions/${artifactVersion}/content`,
      method: 'GET', responseType: 'blob', autoLoading: false, needAuth: true, signal
    }))
    if (!(blob instanceof Blob) || blob.size > 64 * 1024 * 1024) throw new Error('成果下载响应无效，未创建文件。')
    return blob
  },
  async preview (request = {}) { return this.download(request) }
})

export const outputSource = (type, id) => computed(() => {
  const source = { type, id: valueOf(id) }
  return validSource(source) ? source : null
})

export const outputCacheKey = (identityFingerprint, source) => {
  const identity = String(valueOf(identityFingerprint) || '')
  return validSource(source) && identity ? `${identity}\u0000${source.type}\u0000${source.id}` : ''
}

const safeText = (value, maximum = 255) => typeof value === 'string'
  ? [...value].filter(char => { const code = char.charCodeAt(0); return code >= 32 && code !== 127 }).join('').slice(0, maximum)
  : ''
const normalizeBytes = value => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}
const normalizeItem = (item, sourceType) => {
  if (sourceType === 'conversation') {
    if (!conversationDeliverable(item)) return null
    return Object.freeze({
      outputId: item.outputId,
      executionId: item.executionId,
      artifactId: '',
      artifactVersion: '',
      title: '执行成果',
      artifactType: '执行成果',
      mimeType: item.contentMimeType,
      byteLength: item.byteLength,
      sha256: item.contentHash,
      createdAt: item.committedAt,
      state: item.state,
      publicationState: item.publicationState,
      formalDeliveryState: item.formalDeliveryState,
      fileRef: Object.freeze({ fileId: item.fileId, fileVersion: String(item.fileVersion) }),
      artifactRef: null,
      canDownload: false,
      canPreview: false
    })
  }
  if (!taskDeliverable(item, item?.taskId)) return null
  return Object.freeze({
    outputId: '',
    executionId: '',
    artifactId: item.artifactId,
    artifactVersion: String(item.artifactVersion),
    title: safeText(item.title),
    artifactType: safeText(item.artifactType, 80),
    mimeType: item.contentMimeType,
    byteLength: normalizeBytes(item.contentByteLength),
    sha256: item.contentHash,
    createdAt: item.createdAt,
    state: 'AVAILABLE',
    publicationState: '',
    formalDeliveryState: '',
    fileRef: null,
    artifactRef: Object.freeze({ artifactId: item.artifactId, artifactVersion: String(item.artifactVersion) }),
    canDownload: true,
    canPreview: true
  })
}

const normalizeFailure = failure => {
  const status = Number(failure?.status || 0)
  if (status === 401 || status === 403) return { kind: 'forbidden', message: '无访问权限。', retryable: false }
  if (status === 404) return { kind: 'unavailable', message: '成果目录暂不可读取，请刷新确认。', retryable: true }
  if (failure?.name === 'AbortError') return null
  return {
    kind: 'unavailable',
    message: failure?.message || '成果目录暂不可读取，请刷新确认。',
    retryable: failure?.retryable !== false
  }
}

/**
 * Read-only output directory boundary. The injected adapter is the only API seam;
 * components never embed provisional output endpoints or browser upload behavior.
 */
export function useOutputs ({ source, identityFingerprint, adapter = outputReadAdapter, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const items = ref([])
  const state = ref('empty')
  const message = ref('暂无可领取成果。')
  const loading = ref(false)
  const nextCursor = ref(null)
  const requestGeneration = ref(0)
  const sourceValue = computed(() => valueOf(source))
  const identityValue = computed(() => String(valueOf(identityFingerprint) || ''))
  const cacheKey = computed(() => outputCacheKey(identityValue.value, sourceValue.value))
  let controller = null
  let disposed = false

  const reset = () => {
    requestGeneration.value += 1
    controller?.abort(abortError('Output context changed'))
    controller = null
    items.value = []
    nextCursor.value = null
    loading.value = false
    state.value = 'empty'
    message.value = '暂无可领取成果。'
  }

  const isCurrent = (generation, key, requestController) => !disposed &&
    generation === requestGeneration.value && key === cacheKey.value && controller === requestController && !requestController.signal.aborted

  const load = async ({ more = false } = {}) => {
    const currentSource = sourceValue.value
    const key = cacheKey.value
    if (!validSource(currentSource) || !key || (more && !nextCursor.value) || loading.value) return false
    const generation = requestGeneration.value
    controller?.abort(abortError('Output request replaced'))
    const requestController = new AbortController()
    controller = requestController
    loading.value = true
    if (!more) {
      state.value = 'loading'
      message.value = '成果目录读取中…'
    }
    try {
      const page = await adapter.list({
        sourceType: currentSource.type,
        sourceId: currentSource.id,
        cursor: more ? nextCursor.value : null,
        limit: Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE),
        signal: requestController.signal
      })
      if (!isCurrent(generation, key, requestController)) return false
      const responseState = String(page?.state || 'available').toLowerCase()
      if (responseState === 'syncing') {
        items.value = []
        nextCursor.value = null
        state.value = 'syncing'
        message.value = '交付同步中，尚未提交待验收。'
        return true
      }
      const received = Array.isArray(page?.items) ? page.items.map(item => normalizeItem(item, currentSource.type)).filter(Boolean) : []
      const combined = more ? [...items.value, ...received] : received
      const unique = new Map(combined.map(item => [`${item.outputId || item.artifactId}\u0000${item.fileRef?.fileId || item.artifactRef?.artifactId || ''}\u0000${item.fileRef?.fileVersion || item.artifactRef?.artifactVersion || ''}`, item]))
      items.value = [...unique.values()]
      nextCursor.value = typeof page?.nextCursor === 'string' && page.nextCursor ? page.nextCursor : null
      state.value = items.value.length ? 'available' : 'empty'
      message.value = items.value.length ? '已分享，非正式验收。' : '暂无可领取成果。'
      return true
    } catch (failure) {
      const normalized = normalizeFailure(failure)
      if (!normalized || !isCurrent(generation, key, requestController)) return false
      items.value = []
      nextCursor.value = null
      state.value = normalized.kind
      message.value = normalized.message
      return false
    } finally {
      if (controller === requestController) controller = null
      if (!disposed && generation === requestGeneration.value && key === cacheKey.value) loading.value = false
    }
  }

  const refresh = () => load()
  const loadMore = () => load({ more: true })
  const download = async (item, options = {}) => {
    if (!items.value.includes(item) || !validSource(sourceValue.value) || !cacheKey.value) throw abortError('Output context changed')
    return adapter.download({ sourceType: sourceValue.value.type, sourceId: sourceValue.value.id, artifactId: item.artifactId, artifactVersion: item.artifactVersion, signal: options.signal })
  }
  const preview = async (item, options = {}) => {
    if (!items.value.includes(item) || !validSource(sourceValue.value) || !cacheKey.value) throw abortError('Output context changed')
    return adapter.preview({ sourceType: sourceValue.value.type, sourceId: sourceValue.value.id, artifactId: item.artifactId, artifactVersion: item.artifactVersion, signal: options.signal })
  }

  watch(cacheKey, () => {
    reset()
    if (cacheKey.value) void load()
  }, { immediate: true })
  const unregisterIdentityCleanup = registerIdentityCleanup(reset)
  const dispose = () => {
    if (disposed) return
    disposed = true
    reset()
    unregisterIdentityCleanup()
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return { items, state, message, loading, nextCursor, cacheKey, refresh, loadMore, download, preview, reset, dispose }
}

export const outputPreviewKind = item => {
  if (!item || item.byteLength == null || item.byteLength > 1024 * 1024) return 'none'
  if (textMimeTypes.has(item.mimeType)) return 'text'
  if (imageMimeTypes.has(item.mimeType)) return 'image'
  return 'none'
}
