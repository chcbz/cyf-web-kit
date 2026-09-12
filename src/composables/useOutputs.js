import { computed, onBeforeUnmount, ref, unref, watch } from 'vue'
import { useHttp } from './useHttp.js'
import { downloadOutput } from '../utils/outputDownload.js'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'

const LIMIT = 20
const POLL_START_MS = 5_000
const POLL_MAX_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1_000
const validWireId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && /^\S+$/u.test(value)
const validVersion = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
const validSource = value => value && (value.type === 'CONVERSATION' || value.type === 'TASK') && validWireId(value.id)
const pathPart = value => encodeURIComponent(String(value))
const itemKey = item => `${String(item?.outputId)}:${String(item?.version)}`
const abortFailure = message => new DOMException(message, 'AbortError')

const mergeUnique = (preferred, retained = []) => {
  const seen = new Set()
  return [...preferred, ...retained].filter(item => {
    const key = itemKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function outputPageMatchesSource (page, source) {
  return Boolean(validSource(source) && page && Array.isArray(page.items) && page.items.every(item =>
    item?.source?.type === source.type && item.source?.id === source.id &&
    validWireId(item.outputId) && validVersion(item.version)))
}

export function outputVersionPageMatches (page, source, outputId) {
  return typeof outputId === 'string' && outputPageMatchesSource(page, source) && page.items.every(item => item.outputId === outputId)
}

export function parseOutputResourceQuery (query) {
  const read = key => typeof query?.get === 'function' ? query.get(key) : query?.[key]
  const sourceType = read('outputSourceType')
  const sourceId = read('outputSourceId')
  const outputId = read('outputId')
  const version = read('outputVersion')
  if (!validSource({ type: sourceType, id: sourceId }) || !validWireId(outputId) || !validVersion(version)) return null
  return { source: { type: sourceType, id: sourceId }, outputId, version }
}

export function normalizeOutputError (failure, fallback = '成果暂时无法取得') {
  const status = Number(failure?.status || 0)
  const retryable = typeof failure?.retryable === 'boolean'
    ? failure.retryable
    : (!status || status === 429 || status >= 500)
  return {
    message: failure?.message || fallback,
    retryable,
    requestId: failure?.requestId || '',
    status
  }
}

export function outputSource (type, id) {
  return computed(() => {
    const sourceId = typeof id === 'function' ? id() : id
    return validSource({ type, id: sourceId }) ? { type, id: sourceId } : null
  })
}

export function useOutputs (source, options = {}) {
  const items = ref([])
  const nextCursor = ref(null)
  const snapshotAt = ref(null)
  const loading = ref(false)
  const error = ref(null)
  const listRevision = ref(0)
  const versions = ref([])
  const versionTarget = ref(null)
  const versionNextCursor = ref(null)
  const versionSnapshotAt = ref(null)
  const versionsLoading = ref(false)
  const versionsError = ref(null)
  const lifecycleKey = ref(0)
  const sourceValue = computed(() => source?.value ?? source ?? null)
  const sourceKey = computed(() => validSource(sourceValue.value) ? JSON.stringify([sourceValue.value.type, sourceValue.value.id]) : '')
  const syncing = computed(() => Boolean(unref(options.syncing)))
  const requestedResource = computed(() => unref(options.requestedResource) || null)
  const requestClient = () => options.http || options.httpFactory?.() || useHttp()
  const downloadHandler = options.download || downloadOutput
  const timerApi = options.timer || globalThis
  const visibilityDocument = options.document === undefined ? globalThis.document : options.document
  const routeLocation = options.location === undefined ? globalThis.location : options.location
  const operationControllers = new Set()
  let listController = null
  let versionController = null
  let versionRequestSequence = 0
  let pollTimer = null
  let pollDelay = POLL_START_MS
  let generation = 0
  let disposed = false
  let refreshAfterLoad = false
  let loadedPageCount = 1

  const basePath = current => current.type === 'TASK'
    ? `/agent/tasks/${pathPart(current.id)}/artifacts`
    : `/chat/conversations/${pathPart(current.id)}/outputs`
  const versionCollectionPath = (current, item) => `${basePath(current)}/${pathPart(item.outputId)}/versions`
  const versionPath = (current, item, suffix = '') => `${versionCollectionPath(current, item)}/${pathPart(item.version)}${suffix}`
  const isVisible = () => !visibilityDocument?.hidden
  const isCurrent = (current, requestGeneration) => !disposed && requestGeneration === generation &&
    current?.type === sourceValue.value?.type && current?.id === sourceValue.value?.id
  const assertCurrentItem = (current, item) => {
    if (!validSource(current) || item?.source?.type !== current.type || item?.source?.id !== current.id ||
        !validWireId(item?.outputId) || !validVersion(item?.version)) {
      throw new Error('成果来源或版本不匹配')
    }
  }
  const cancelPoll = () => {
    if (pollTimer != null) timerApi.clearTimeout(pollTimer)
    pollTimer = null
  }
  const shouldPoll = () => validSource(sourceValue.value) && error.value?.retryable !== false &&
    (syncing.value || error.value?.retryable === true)
  const schedulePoll = () => {
    cancelPoll()
    if (!shouldPoll() || !isVisible() || disposed) return
    pollTimer = timerApi.setTimeout(() => {
      pollTimer = null
      void load({ reason: 'poll' })
    }, error.value?.retryable ? pollDelay : POLL_START_MS)
  }
  const clearVersions = () => {
    versionRequestSequence += 1
    versionController?.abort()
    versionController = null
    versions.value = []
    versionTarget.value = null
    versionNextCursor.value = null
    versionSnapshotAt.value = null
    versionsLoading.value = false
    versionsError.value = null
  }
  const clear = () => {
    generation += 1
    lifecycleKey.value += 1
    cancelPoll()
    listController?.abort()
    listController = null
    for (const controller of operationControllers) controller.abort()
    operationControllers.clear()
    clearVersions()
    items.value = []
    nextCursor.value = null
    snapshotAt.value = null
    error.value = null
    loading.value = false
    pollDelay = POLL_START_MS
    refreshAfterLoad = false
    loadedPageCount = 1
  }
  const operation = (signal) => {
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(signal?.reason || abortFailure('Operation cancelled'))
    if (signal?.aborted) forwardAbort()
    else signal?.addEventListener('abort', forwardAbort, { once: true })
    operationControllers.add(controller)
    return {
      controller,
      finish: () => {
        signal?.removeEventListener('abort', forwardAbort)
        operationControllers.delete(controller)
      }
    }
  }
  const load = async ({ more = false, reason = 'manual' } = {}) => {
    const current = sourceValue.value
    if (!validSource(current) || (more && !nextCursor.value)) return
    if (loading.value) {
      if (!more) refreshAfterLoad = true
      return
    }
    const requestGeneration = generation
    listController?.abort()
    const requestController = new AbortController()
    listController = requestController
    loading.value = true
    if (reason !== 'poll') error.value = null
    try {
      const pages = []
      let cursor = more ? nextCursor.value : null
      const targetPageCount = more ? 1 : Math.max(1, loadedPageCount)
      for (let pageIndex = 0; pageIndex < targetPageCount; pageIndex += 1) {
        if (pageIndex > 0 && !cursor) break
        const result = await requestClient().get(basePath(current), {
          limit: LIMIT,
          ...(cursor ? { cursor } : {})
        }, { signal: requestController.signal })
        if (!isCurrent(current, requestGeneration) || listController !== requestController) return
        const page = result.data?.data
        if (!outputPageMatchesSource(page, current)) throw new Error('成果列表来源不匹配')
        if (pages.length && page.snapshotAt !== pages[0].snapshotAt) throw new Error('成果分页快照不匹配')
        pages.push(page)
        cursor = page.nextCursor ?? null
      }
      if (!pages.length) return
      const received = pages.flatMap(page => page.items)
      items.value = more ? mergeUnique(items.value, received) : mergeUnique(received)
      nextCursor.value = cursor
      snapshotAt.value = pages[0].snapshotAt ?? null
      loadedPageCount = more ? loadedPageCount + pages.length : pages.length
      if (!more) listRevision.value += 1
      error.value = null
      pollDelay = POLL_START_MS
    } catch (failure) {
      if (failure?.name === 'AbortError' || !isCurrent(current, requestGeneration)) return
      error.value = normalizeOutputError(failure)
      if (reason === 'poll' && error.value.retryable) pollDelay = Math.min(pollDelay * 2, POLL_MAX_MS)
    } finally {
      if (isCurrent(current, requestGeneration)) {
        loading.value = false
        if (listController === requestController) listController = null
        if (refreshAfterLoad) {
          refreshAfterLoad = false
          void load({ reason: 'queued' })
        } else {
          schedulePoll()
        }
      }
    }
  }
  const refresh = () => load()
  const loadMore = () => load({ more: true })
  const loadVersions = async (item, { more = false } = {}) => {
    const current = sourceValue.value
    assertCurrentItem(current, item)
    const sameTarget = versionTarget.value?.outputId === item.outputId
    if (more && (!sameTarget || !versionNextCursor.value)) return
    if (versionsLoading.value) return
    if (!sameTarget) {
      clearVersions()
      versionTarget.value = item
    }
    const requestGeneration = generation
    const requestSequence = ++versionRequestSequence
    versionController?.abort()
    const requestController = new AbortController()
    versionController = requestController
    versionsLoading.value = true
    versionsError.value = null
    try {
      const result = await requestClient().get(versionCollectionPath(current, item), {
        limit: LIMIT,
        ...(more ? { cursor: versionNextCursor.value } : {})
      }, { signal: requestController.signal })
      if (!isCurrent(current, requestGeneration) || requestSequence !== versionRequestSequence || versionController !== requestController) return
      const page = result.data?.data
      if (!outputVersionPageMatches(page, current, item.outputId)) throw new Error('成果历史版本来源不匹配')
      versions.value = more ? mergeUnique(versions.value, page.items) : mergeUnique(page.items, versions.value)
      versionNextCursor.value = page.nextCursor ?? null
      versionSnapshotAt.value = page.snapshotAt ?? null
    } catch (failure) {
      if (failure?.name === 'AbortError' || !isCurrent(current, requestGeneration) || requestSequence !== versionRequestSequence) return
      versionsError.value = normalizeOutputError(failure, '历史版本暂时无法取得')
    } finally {
      if (isCurrent(current, requestGeneration) && requestSequence === versionRequestSequence) versionsLoading.value = false
      if (requestSequence === versionRequestSequence && versionController === requestController) versionController = null
    }
  }
  const detail = async (item, { signal } = {}) => {
    const current = sourceValue.value
    assertCurrentItem(current, item)
    const requestGeneration = generation
    const active = operation(signal)
    try {
      const result = await requestClient().get(versionPath(current, item), undefined, { signal: active.controller.signal })
      if (!isCurrent(current, requestGeneration)) throw abortFailure('Source changed')
      const payload = result.data?.data
      if (!payload?.item || !outputVersionPageMatches({ items: [payload.item] }, current, item.outputId) || payload.item.version !== item.version) {
        throw new Error('成果详情来源或版本不匹配')
      }
      return payload
    } finally {
      active.finish()
    }
  }
  const downloadBlob = async (item, { signal } = {}) => {
    const current = sourceValue.value
    assertCurrentItem(current, item)
    const requestGeneration = generation
    const active = operation(signal)
    try {
      const result = await requestClient().get(versionPath(current, item, '/download'), undefined, {
        responseType: 'blob',
        signal: active.controller.signal,
        timeout: DOWNLOAD_TIMEOUT_MS
      })
      if (!isCurrent(current, requestGeneration)) throw abortFailure('Source changed')
      return result
    } finally {
      active.finish()
    }
  }
  const download = async item => {
    const current = sourceValue.value
    assertCurrentItem(current, item)
    const requestGeneration = generation
    const active = operation()
    try {
      await downloadHandler({
        url: versionPath(current, item, '/download'),
        item,
        signal: active.controller.signal,
        timeout: DOWNLOAD_TIMEOUT_MS,
        http: requestClient(),
        assertActive: () => {
          if (active.controller.signal.aborted || !isCurrent(current, requestGeneration)) throw abortFailure('Source changed')
        }
      })
      if (!isCurrent(current, requestGeneration)) throw abortFailure('Source changed')
    } finally {
      active.finish()
    }
  }
  const resourceRoute = item => {
    const current = sourceValue.value
    assertCurrentItem(current, item)
    const origin = routeLocation?.origin || new URL(routeLocation?.href || 'http://localhost/').origin
    const url = new URL('/chat', origin)
    url.searchParams.set('outputSourceType', current.type)
    url.searchParams.set('outputSourceId', String(current.id))
    url.searchParams.set('outputId', String(item.outputId))
    url.searchParams.set('outputVersion', String(item.version))
    url.hash = ''
    return url.toString()
  }
  const handleVisibility = () => {
    cancelPoll()
    if (!isVisible() || !shouldPoll()) return
    if (loading.value) refreshAfterLoad = true
    else void load({ reason: 'visibility' })
  }

  watch(sourceKey, () => {
    clear()
    if (validSource(sourceValue.value)) void load({ reason: 'open' })
  }, { immediate: true })
  watch(syncing, (active, previous) => {
    if (active) {
      schedulePoll()
    } else if (previous && validSource(sourceValue.value)) {
      cancelPoll()
      if (loading.value) refreshAfterLoad = true
      else void load({ reason: 'complete' })
    }
  })
  visibilityDocument?.addEventListener?.('visibilitychange', handleVisibility)
  const unregisterIdentityCleanup = registerIdentityCleanup(clear)
  onBeforeUnmount(() => {
    disposed = true
    clear()
    visibilityDocument?.removeEventListener?.('visibilitychange', handleVisibility)
    unregisterIdentityCleanup()
  })

  return {
    source: sourceValue,
    requestedResource,
    lifecycleKey,
    items,
    nextCursor,
    snapshotAt,
    loading,
    error,
    listRevision,
    versions,
    versionTarget,
    versionNextCursor,
    versionSnapshotAt,
    versionsLoading,
    versionsError,
    refresh,
    loadMore,
    loadVersions,
    clearVersions,
    detail,
    downloadBlob,
    download,
    resourceRoute,
    clear
  }
}
