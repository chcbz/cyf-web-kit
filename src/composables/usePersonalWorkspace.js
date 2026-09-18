import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from './useHttp.js'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'

export const PERSONAL_WORKSPACE_MIME_TYPES = Object.freeze([
  'image/png', 'image/jpeg', 'text/plain', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
])

const ALLOWED_MIME_TYPES = new Set(PERSONAL_WORKSPACE_MIME_TYPES)
const EXTENSION_MIME = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
})
const MAX_INT = 2147483647
const ID = value => typeof value === 'string' && value.length > 0 && value.length <= 100 &&
  !/^\s|\s$/.test(value) && ![...value].some(char => char.codePointAt(0) < 32)
const TEXT = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum &&
  !/^\s|\s$/.test(value) && ![...value].some(char => char.codePointAt(0) < 32)
const VERSION = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= MAX_INT
const abortError = message => new DOMException(message, 'AbortError')
const valueOf = value => typeof value === 'function' ? value() : unref(value)

const unwrap = result => {
  let value = result
  for (let index = 0; index < 2 && value && typeof value === 'object' && Object.hasOwn(value, 'data'); index += 1) value = value.data
  return value
}
const responseHeaders = response => response?.headers && typeof response.headers === 'object' ? response.headers : {}
const getHeader = (headers, name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || ''
const normalizeMime = value => typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : ''
const extensionFor = filename => {
  const match = typeof filename === 'string' ? /\.([^.]+)$/.exec(filename.trim()) : null
  return match ? match[1].toLowerCase() : ''
}
const inferredMime = file => ALLOWED_MIME_TYPES.has(normalizeMime(file?.type))
  ? normalizeMime(file.type) : EXTENSION_MIME[extensionFor(file?.name)] || ''
const fileNameMatchesMime = (name, mime) => EXTENSION_MIME[extensionFor(name)] === mime
const randomKey = () => {
  const value = globalThis.crypto?.randomUUID?.()
  return typeof value === 'string' && value ? value : `pws-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
const safeDownloadFilename = value => {
  const cleaned = String(value || 'workspace-file').replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').replace(/^\.+/, '').trim()
  return (cleaned || 'workspace-file').slice(0, 180)
}
const errorMessage = error => {
  if (error?.name === 'AbortError') return ''
  if ([401, 403, 404].includes(error?.status)) return '当前身份或文件已不可访问，请刷新后重试。'
  if (error?.code === 'FILE_TYPE_UNSUPPORTED' || error?.status === 415) return '仅支持 PNG、JPEG、纯文本、PDF、DOCX、XLSX 或 PPTX。'
  if (error?.code === 'METADATA_CHANGED' || error?.status === 412) return '文件信息已变化，请刷新后再操作。'
  if (error?.code === 'FILE_VERSION_CONFLICT' || error?.status === 409) return '文件版本已变化，请刷新后明确选择要追加的版本。'
  if (error?.code === 'OPERATION_PROCESSING' || error?.status === 202) return '上一次操作仍在确认中，请使用原操作标识查询后再重试。'
  if (error?.status === 503) return '工作空间存储暂不可用，请稍后重试。'
  return error?.message || '工作空间请求未完成，请刷新确认。'
}
const isPreviewable = mime => ['image/png', 'image/jpeg', 'text/plain'].includes(normalizeMime(mime))
const validFile = file => file && typeof file.name === 'string' && TEXT(file.name, 255) && Number.isFinite(file.size) && file.size >= 0
const validFileView = value => value && typeof value === 'object' && ID(value.fileId) && TEXT(value.displayName, 255) &&
  ['ACTIVE', 'TRASHED'].includes(value.state) && VERSION(value.latestVersion) && Number.isSafeInteger(value.metadataRevision) && value.metadataRevision >= 1
const validVersion = value => value && typeof value === 'object' && ID(value.fileId) && VERSION(value.version) &&
  TEXT(value.originalFilename, 255) && ALLOWED_MIME_TYPES.has(normalizeMime(value.contentMimeType)) &&
  Number.isSafeInteger(value.byteLength) && value.byteLength >= 0

/**
 * Browser adapter for the 1.10 owner-scoped upload-only workspace API. It deliberately
 * contains no task selector, Actor ID, artifact projection, or Agent execution call.
 */
export function usePersonalWorkspace ({ api = createApi('/agent'), identityEpoch = 0, urlApi = globalThis.URL } = {}) {
  const items = ref([])
  const nextCursor = ref(null)
  const listState = ref('idle')
  const loading = ref(false)
  const actionState = ref('idle')
  const error = ref('')
  const detail = ref(null)
  const preview = ref({ kind: 'none', message: '' })
  const lastOperation = ref(null)
  const currentEpoch = computed(() => String(valueOf(identityEpoch) ?? ''))
  const controllers = new Set()
  const activeUrls = new Set()
  let generation = 0
  let disposed = false

  const revokePreview = () => {
    for (const url of activeUrls) urlApi?.revokeObjectURL?.(url)
    activeUrls.clear()
    preview.value = { kind: 'none', message: '' }
  }
  const reset = () => {
    generation += 1
    for (const controller of controllers) controller.abort(abortError('Workspace identity changed'))
    controllers.clear()
    items.value = []
    nextCursor.value = null
    listState.value = 'idle'
    loading.value = false
    actionState.value = 'idle'
    error.value = ''
    detail.value = null
    lastOperation.value = null
    revokePreview()
  }
  const stillCurrent = (snapshot, controller) => !disposed && snapshot === generation &&
    !controller.signal.aborted && currentEpoch.value === snapshot.epoch
  const request = async (options, snapshot = { generation, epoch: currentEpoch.value }) => {
    const controller = new AbortController()
    controllers.add(controller)
    try {
      const response = await api.execute({ ...options, autoLoading: false, needAuth: true, signal: controller.signal })
      if (!stillCurrent(snapshot, controller)) throw abortError('Workspace context changed')
      return { data: unwrap(response), headers: responseHeaders(response) }
    } finally {
      controllers.delete(controller)
    }
  }
  const replaceFile = file => {
    if (!validFileView(file)) return
    items.value = items.value.map(item => item.fileId === file.fileId ? file : item)
    if (detail.value?.file?.fileId === file.fileId) detail.value = { ...detail.value, file }
  }
  const refresh = async ({ q, mediaFamily, state = 'ACTIVE', cursor = null, append = false } = {}) => {
    const snapshot = { generation, epoch: currentEpoch.value }
    if (loading.value) return false
    loading.value = true
    listState.value = append ? listState.value : 'loading'
    error.value = ''
    const params = {}
    if (TEXT(q, 100)) params.q = q
    if (['IMAGE', 'TEXT', 'DOCUMENT', 'SPREADSHEET', 'PRESENTATION', 'PDF'].includes(mediaFamily)) params.mediaFamily = mediaFamily
    if (['ACTIVE', 'TRASHED'].includes(state)) params.state = state
    if (cursor) params.cursor = cursor
    try {
      const { data } = await request({ url: '/personal-workspace/files', method: 'GET', params }, snapshot)
      if (!data || !Array.isArray(data.items) || !data.items.every(validFileView) || (data.nextCursor != null && !ID(data.nextCursor))) {
        throw new Error('工作空间目录返回格式无效，未展示可能不完整的数据。')
      }
      if (append) {
        const combined = new Map([...items.value, ...data.items].map(file => [file.fileId, file]))
        items.value = [...combined.values()]
      } else items.value = data.items
      nextCursor.value = data.nextCursor || null
      listState.value = items.value.length ? 'ready' : 'empty'
      return true
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) {
        error.value = errorMessage(cause)
        listState.value = 'error'
      }
      return false
    } finally {
      if (snapshot.generation === generation) loading.value = false
    }
  }
  const loadMore = options => nextCursor.value ? refresh({ ...options, cursor: nextCursor.value, append: true }) : false
  const select = async fileId => {
    if (!ID(fileId)) return null
    const snapshot = { generation, epoch: currentEpoch.value }
    actionState.value = 'loading-detail'; error.value = ''; revokePreview()
    try {
      const response = await request({ url: `/personal-workspace/files/${encodeURIComponent(fileId)}`, method: 'GET' }, snapshot)
      const data = response.data
      if (!data || !validFileView(data.file) || !validVersion(data.latestVersion) || !Array.isArray(data.versions) || !data.versions.every(validVersion)) {
        throw new Error('文件详情返回格式无效。')
      }
      detail.value = { ...data, etag: getHeader(response.headers, 'etag') || `"${data.file.fileId}:${data.file.metadataRevision}"` }
      replaceFile(data.file)
      actionState.value = 'ready'
      return detail.value
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { error.value = errorMessage(cause); actionState.value = 'error' }
      return null
    }
  }
  const normalizedFile = candidate => {
    if (!validFile(candidate)) throw new Error('请选择一个有效文件。')
    const mime = inferredMime(candidate)
    if (!mime || !fileNameMatchesMime(candidate.name, mime)) throw new Error('文件扩展名或格式不受支持。')
    if (typeof File === 'function' && normalizeMime(candidate.type) !== mime) {
      return { file: new File([candidate], candidate.name, { type: mime, lastModified: candidate.lastModified || Date.now() }), mime }
    }
    return { file: candidate, mime }
  }
  const upload = async (candidate, displayName = '') => {
    const snapshot = { generation, epoch: currentEpoch.value }
    let input
    try { input = normalizedFile(candidate) } catch (cause) { error.value = cause.message; actionState.value = 'error'; return null }
    const name = String(displayName || '').trim()
    if (name && !TEXT(name, 255)) { error.value = '文件显示名无效。'; actionState.value = 'error'; return null }
    const body = new FormData()
    body.append('file', input.file, input.file.name)
    if (name) body.append('displayName', name)
    actionState.value = 'uploading'; error.value = ''
    try {
      const { data } = await request({ url: '/personal-workspace/files', method: 'POST', data: body, headers: { 'Idempotency-Key': randomKey() } }, snapshot)
      if (!data?.operation || !validFileView(data.file) || !validVersion(data.version)) throw new Error('上传回执无效，尚不能确认保存。')
      lastOperation.value = data.operation
      replaceFile(data.file)
      await select(data.file.fileId)
      actionState.value = 'ready'
      return data
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { error.value = errorMessage(cause); actionState.value = 'error' }
      return null
    }
  }
  const appendVersion = async candidate => {
    const file = detail.value?.file
    if (!validFileView(file)) { error.value = '请先选择一个当前可用文件。'; return null }
    const snapshot = { generation, epoch: currentEpoch.value }
    let input
    try { input = normalizedFile(candidate) } catch (cause) { error.value = cause.message; actionState.value = 'error'; return null }
    const body = new FormData()
    body.append('file', input.file, input.file.name)
    body.append('expectedPreviousVersion', String(file.latestVersion))
    actionState.value = 'appending-version'; error.value = ''
    try {
      const { data } = await request({
        url: `/personal-workspace/files/${encodeURIComponent(file.fileId)}/versions`, method: 'POST', data: body,
        headers: { 'Idempotency-Key': randomKey() }
      }, snapshot)
      if (!data?.operation || !validFileView(data.file) || !validVersion(data.version)) throw new Error('版本追加回执无效，尚不能确认保存。')
      lastOperation.value = data.operation
      await select(file.fileId)
      actionState.value = 'ready'
      return data
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { error.value = errorMessage(cause); actionState.value = 'error' }
      return null
    }
  }
  const mutate = async (path, body, { method = 'POST' } = {}) => {
    const file = detail.value?.file
    if (!validFileView(file) || !detail.value?.etag) { error.value = '请先刷新并选择一个文件。'; return null }
    const snapshot = { generation, epoch: currentEpoch.value }
    actionState.value = 'saving'; error.value = ''
    try {
      const { data, headers } = await request({ url: path, method, data: body, headers: { 'Idempotency-Key': randomKey(), 'If-Match': detail.value.etag } }, snapshot)
      if (!validFileView(data)) throw new Error('文件操作回执无效，尚不能确认保存。')
      replaceFile(data)
      detail.value = { ...detail.value, file: data, etag: getHeader(headers, 'etag') || `"${data.fileId}:${data.metadataRevision}"` }
      actionState.value = 'ready'
      return data
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { error.value = errorMessage(cause); actionState.value = 'error' }
      return null
    }
  }
  const rename = displayName => {
    const name = String(displayName || '').trim()
    if (!TEXT(name, 255)) { error.value = '文件显示名无效。'; return Promise.resolve(null) }
    const file = detail.value?.file
    return validFileView(file)
      ? mutate(`/personal-workspace/files/${encodeURIComponent(file.fileId)}`, { displayName: name }, { method: 'PATCH' })
      : Promise.resolve(null)
  }
  const usage = async () => {
    const file = detail.value?.file
    if (!validFileView(file)) return null
    const snapshot = { generation, epoch: currentEpoch.value }
    try {
      const { data } = await request({ url: `/personal-workspace/files/${encodeURIComponent(file.fileId)}/usage`, method: 'GET' }, snapshot)
      if (!data || !Number.isSafeInteger(data.impactRevision) || !Array.isArray(data.taskReferences) || !Array.isArray(data.activeExecutions)) throw new Error('文件引用信息返回无效。')
      return data
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) error.value = errorMessage(cause)
      return null
    }
  }
  const trash = async (usageView) => {
    const file = detail.value?.file
    if (!validFileView(file) || !usageView || !Number.isSafeInteger(usageView.impactRevision)) return null
    return mutate(`/personal-workspace/files/${encodeURIComponent(file.fileId)}/trash`, {
      impactRevision: usageView.impactRevision, acknowledgeExistingReferences: true
    })
  }
  const restore = async () => {
    const file = detail.value?.file
    return validFileView(file) ? mutate(`/personal-workspace/files/${encodeURIComponent(file.fileId)}/restore`, {}) : null
  }
  const readBlob = async (fileId, version, suffix = 'content') => {
    if (!ID(fileId) || !VERSION(version)) throw new Error('文件版本无效。')
    const snapshot = { generation, epoch: currentEpoch.value }
    const { data, headers } = await request({
      url: `/personal-workspace/files/${encodeURIComponent(fileId)}/versions/${Number(version)}/${suffix}`,
      method: 'GET', responseType: 'blob'
    }, snapshot)
    if (!(data instanceof Blob)) throw new Error('文件内容响应无效。')
    return { blob: data, headers }
  }
  const download = async (version = detail.value?.latestVersion) => {
    const file = detail.value?.file
    if (!validFileView(file) || !VERSION(version)) return null
    const versionInfo = detail.value?.versions?.find(item => Number(item.version) === Number(version)) || detail.value?.latestVersion
    try {
      const content = await readBlob(file.fileId, version)
      return { ...content, filename: safeDownloadFilename(versionInfo?.originalFilename || file.displayName) }
    } catch (cause) {
      if (cause?.name !== 'AbortError') error.value = errorMessage(cause)
      return null
    }
  }
  const previewVersion = async (version = detail.value?.latestVersion) => {
    const file = detail.value?.file
    if (!validFileView(file) || !VERSION(version)) return null
    const snapshot = { generation, epoch: currentEpoch.value }
    revokePreview(); actionState.value = 'loading-preview'; error.value = ''
    try {
      const { data } = await request({
        url: `/personal-workspace/files/${encodeURIComponent(file.fileId)}/versions/${Number(version)}/preview`, method: 'GET'
      }, snapshot)
      const versionInfo = detail.value?.versions?.find(item => Number(item.version) === Number(version)) || detail.value?.latestVersion
      if (data?.state !== 'READY' || !isPreviewable(versionInfo?.contentMimeType)) {
        preview.value = { kind: 'unsupported', message: '此文件可下载，预览和 Agent 编辑尚未开放。' }
        actionState.value = 'ready'
        return preview.value
      }
      const content = await readBlob(file.fileId, version, 'preview/parts/content')
      if (normalizeMime(versionInfo.contentMimeType) === 'text/plain') {
        preview.value = { kind: 'text', text: await content.blob.text(), message: '' }
      } else {
        const url = urlApi?.createObjectURL?.(content.blob)
        if (!url) throw new Error('当前浏览器不能安全创建预览。')
        activeUrls.add(url)
        preview.value = { kind: 'image', url, message: '' }
      }
      actionState.value = 'ready'
      return preview.value
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) {
        error.value = errorMessage(cause)
        preview.value = { kind: 'error', message: error.value }
        actionState.value = 'error'
      }
      return null
    }
  }
  const operation = async operationId => {
    if (!ID(operationId)) return null
    const snapshot = { generation, epoch: currentEpoch.value }
    try {
      const { data } = await request({ url: `/personal-workspace/operations/${encodeURIComponent(operationId)}`, method: 'GET' }, snapshot)
      if (!data || !ID(data.operationId) || !TEXT(data.state, 32)) throw new Error('操作回执返回无效。')
      lastOperation.value = data
      return data
    } catch (cause) {
      if (cause?.name !== 'AbortError') error.value = errorMessage(cause)
      return null
    }
  }

  watch(currentEpoch, reset, { immediate: true, flush: 'sync' })
  const unregisterIdentityCleanup = registerIdentityCleanup(reset)
  const dispose = () => {
    if (disposed) return
    disposed = true
    unregisterIdentityCleanup()
    reset()
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return {
    items, nextCursor, listState, loading, actionState, error, detail, preview, lastOperation,
    refresh, loadMore, select, upload, appendVersion, rename, usage, trash, restore,
    download, previewVersion, operation, revokePreview, reset, dispose
  }
}

export function savePersonalWorkspaceBlob ({ blob, filename, documentRef = globalThis.document, urlApi = globalThis.URL } = {}) {
  if (!(blob instanceof Blob)) throw new TypeError('A Blob is required for download')
  const href = urlApi?.createObjectURL?.(blob)
  const anchor = documentRef?.createElement?.('a')
  if (!href || !anchor) throw new Error('当前浏览器不能创建安全下载。')
  try {
    anchor.href = href
    anchor.download = safeDownloadFilename(filename)
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    documentRef.body?.appendChild(anchor)
    anchor.click()
  } finally {
    anchor.remove?.()
    urlApi.revokeObjectURL?.(href)
  }
}
