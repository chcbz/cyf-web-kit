import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20
const textMimeTypes = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json'])
const imageMimeTypes = new Set(['image/png', 'image/jpeg'])

const valueOf = value => typeof value === 'function' ? value() : unref(value)
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && !/\s/.test(value)
const validSource = value => value && ['task', 'conversation'].includes(value.type) && validId(value.id)
const abortError = message => new DOMException(message, 'AbortError')

export const outputReadAdapter = Object.freeze({
  // The API DTO/routes are being frozen in parallel. Until an authenticated adapter is supplied,
  // do not probe legacy artifact endpoints that require an actorAgentId.
  async list () { return { state: 'empty', items: [], nextCursor: null } },
  async download () { throw Object.assign(new Error('成果目录暂未对接。'), { status: 503, retryable: true }) },
  async preview () { throw Object.assign(new Error('成果预览暂未对接。'), { status: 503, retryable: true }) }
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
const normalizeItem = item => {
  if (!item || typeof item !== 'object') return null
  const artifactId = item.artifactId || item.outputId
  const artifactVersion = item.artifactVersion ?? item.version
  const mimeType = String(item.contentMimeType || item.mimeType || item.mime || '').toLowerCase()
  const byteLength = normalizeBytes(item.contentByteLength ?? item.byteLength ?? item.size)
  if (!validId(artifactId) || !/^[1-9][0-9]{0,18}$/.test(String(artifactVersion))) return null
  return Object.freeze({
    artifactId,
    artifactVersion: String(artifactVersion),
    title: safeText(item.title || item.name || '未命名成果'),
    artifactType: safeText(item.artifactType || item.type || '文件', 80),
    mimeType,
    byteLength,
    sha256: /^[a-f0-9]{64}$/i.test(String(item.sha256 || item.contentHash || '')) ? String(item.sha256 || item.contentHash).toLowerCase() : '',
    createdAt: item.createdAt ?? item.publishedAt ?? null,
    state: String(item.state || 'AVAILABLE').toUpperCase(),
    canDownload: item.canDownload !== false
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
        message.value = '成果同步中，聊天和悬赏主体不受影响。'
        return true
      }
      const received = Array.isArray(page?.items) ? page.items.map(normalizeItem).filter(Boolean) : []
      const combined = more ? [...items.value, ...received] : received
      const unique = new Map(combined.map(item => [`${item.artifactId}\u0000${item.artifactVersion}`, item]))
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
