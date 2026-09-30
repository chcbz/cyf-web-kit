import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { usePersonalWorkspace } from '../usePersonalWorkspace.js'
import { registerIdentityCleanup } from '../../utils/identityLifecycle.js'

export const HALL_REFERENCE_MAX_ITEMS = 32
export const HALL_REFERENCE_PURPOSE = 'REFERENCE'
export const HALL_REFERENCE_IMAGE_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png'])
export const JAVA_INT_MAX = 2147483647

const IMAGE_MIME_TYPES = new Set(HALL_REFERENCE_IMAGE_MIME_TYPES)
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 &&
  !/^\s|\s$/.test(value) && ![...value].some(char => char.codePointAt(0) < 32)
const normalizeMime = value => typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : ''
const referenceKey = (fileId, version) => `${fileId}\u0000${version}`
const abortError = message => new DOMException(message, 'AbortError')

export function normalizeHallReferenceVersion (value) {
  return Number.isInteger(value) && value >= 1 && value <= JAVA_INT_MAX ? value : null
}

export function toHallDraftReference (value) {
  const version = normalizeHallReferenceVersion(value?.version)
  if (!validId(value?.fileId) || version == null || value?.purpose !== HALL_REFERENCE_PURPOSE) return null
  return Object.freeze({ fileId: value.fileId, version, purpose: HALL_REFERENCE_PURPOSE })
}

/**
 * Validates the owner-scoped detail returned by usePersonalWorkspace.select().
 * The selected version remains explicit even if a later refresh reports a newer latestVersion.
 */
export function validateHallReferenceDetail (detail, expectedFileId) {
  if (!validId(expectedFileId) || !detail || typeof detail !== 'object' || Array.isArray(detail)) {
    throw new Error('参考图片详情无效。')
  }
  const file = detail.file
  if (!file || file.fileId !== expectedFileId || file.state !== 'ACTIVE') {
    throw new Error('该文件不属于当前可读的有效工作空间图片。')
  }
  const latestVersion = normalizeHallReferenceVersion(file.latestVersion)
  if (latestVersion == null || !detail.latestVersion || detail.latestVersion.fileId !== expectedFileId ||
    normalizeHallReferenceVersion(detail.latestVersion.version) !== latestVersion) {
    throw new Error('文件最新版本信息不一致，请刷新后重试。')
  }
  if (!Array.isArray(detail.versions) || !detail.versions.length) throw new Error('文件没有可选择的明确版本。')

  const seen = new Set()
  const versions = detail.versions.map(item => {
    const version = normalizeHallReferenceVersion(item?.version)
    const contentMimeType = normalizeMime(item?.contentMimeType)
    if (!item || item.fileId !== expectedFileId || version == null) throw new Error('文件版本归属或编号无效。')
    if (seen.has(version)) throw new Error('文件版本信息存在歧义，不能选择。')
    seen.add(version)
    return Object.freeze({
      fileId: expectedFileId,
      version,
      originalFilename: String(item.originalFilename || file.displayName || ''),
      contentMimeType,
      supported: IMAGE_MIME_TYPES.has(contentMimeType),
      byteLength: item.byteLength
    })
  }).sort((left, right) => right.version - left.version)

  if (!seen.has(latestVersion)) throw new Error('文件详情缺少最新版本，请刷新后重试。')
  return Object.freeze({
    fileId: expectedFileId,
    displayName: String(file.displayName || detail.latestVersion.originalFilename || ''),
    latestVersion,
    versions
  })
}

const previewUrlFrom = preview => {
  if (preview?.kind === 'image' && typeof preview.url === 'string' && preview.url) return preview.url
  if (preview?.kind === 'parts' && Array.isArray(preview.parts)) {
    const image = preview.parts.find(part => part?.kind === 'image' && typeof part.url === 'string' && part.url)
    return image?.url || ''
  }
  return ''
}

/**
 * Read-only requirement-draft selector. It only reads through the existing JWT-scoped
 * personal workspace adapter and never creates tasks, links, grants, executions, or Provider work.
 */
export function useHallReferenceImageSelection ({
  api,
  identityEpoch = 0,
  urlApi = globalThis.URL
} = {}) {
  const catalog = usePersonalWorkspace({ api, identityEpoch, urlApi })
  const currentDetail = ref(null)
  const selected = ref([])
  const state = ref('idle')
  const error = ref('')
  const currentEpoch = computed(() => String(valueOf(identityEpoch) ?? ''))
  const sessions = new Map()
  const pendingSessions = new Set()
  const pendingKeys = new Set()
  let generation = 0
  let detailRequest = 0
  let disposed = false

  const draftReferences = computed(() => selected.value.map(item => Object.freeze({
    fileId: item.fileId,
    version: item.version,
    purpose: HALL_REFERENCE_PURPOSE
  })))

  const disposeSession = session => {
    if (!session) return
    pendingSessions.delete(session)
    session.dispose?.()
  }
  const revokeSelected = () => {
    for (const session of sessions.values()) disposeSession(session)
    sessions.clear()
    selected.value = []
  }
  const clear = ({ resetCatalog = false } = {}) => {
    generation += 1
    detailRequest += 1
    for (const session of [...pendingSessions]) disposeSession(session)
    pendingSessions.clear()
    pendingKeys.clear()
    revokeSelected()
    currentDetail.value = null
    state.value = 'idle'
    error.value = ''
    if (resetCatalog) catalog.reset?.()
    else catalog.revokePreview?.()
  }
  const setError = message => {
    error.value = message
    state.value = 'error'
    return null
  }
  const stillCurrent = snapshot => !disposed && snapshot.generation === generation && snapshot.epoch === currentEpoch.value

  const refresh = async () => {
    const snapshot = { generation, epoch: currentEpoch.value }
    state.value = 'loading-list'
    error.value = ''
    const ok = await catalog.refresh({ mediaFamily: 'IMAGE', state: 'ACTIVE' })
    if (!stillCurrent(snapshot)) return false
    if (!ok) return setError(catalog.error?.value || '工作空间图片读取失败。') !== null
    state.value = 'ready'
    return true
  }

  const openFile = async fileId => {
    if (!validId(fileId)) return setError('文件标识无效。')
    const request = ++detailRequest
    const snapshot = { generation, epoch: currentEpoch.value }
    currentDetail.value = null
    state.value = 'loading-detail'
    error.value = ''
    const detail = await catalog.select(fileId)
    if (!stillCurrent(snapshot) || request !== detailRequest) return null
    if (!detail) return setError(catalog.error?.value || '文件详情读取失败。')
    try {
      currentDetail.value = validateHallReferenceDetail(detail, fileId)
      state.value = 'detail-ready'
      return currentDetail.value
    } catch (cause) {
      return setError(cause.message)
    }
  }

  const addReference = async (fileId, requestedVersion) => {
    const version = normalizeHallReferenceVersion(requestedVersion)
    if (!validId(fileId) || version == null) return setError('请选择明确的图片版本。')
    const detail = currentDetail.value
    if (!detail || detail.fileId !== fileId) return setError('请先读取当前文件的精确版本详情。')
    const versionInfo = detail.versions.filter(item => item.version === version)
    if (versionInfo.length !== 1) return setError('文件版本信息存在歧义，不能选择。')
    if (!versionInfo[0].supported) return setError('参考图仅支持 JPEG 或 PNG。')

    const key = referenceKey(fileId, version)
    if (sessions.has(key) || pendingKeys.has(key)) return setError('该文件版本已选择，不能重复加入。')
    if (selected.value.length + pendingKeys.size >= HALL_REFERENCE_MAX_ITEMS) return setError('参考图最多选择 32 项。')

    const snapshot = { generation, epoch: currentEpoch.value }
    const previewSession = usePersonalWorkspace({ api, identityEpoch, urlApi })
    pendingSessions.add(previewSession)
    pendingKeys.add(key)
    state.value = 'loading-preview'
    error.value = ''
    try {
      const fresh = await previewSession.select(fileId)
      if (!stillCurrent(snapshot)) throw abortError('Reference identity changed')
      const verified = validateHallReferenceDetail(fresh, fileId)
      const exactVersions = verified.versions.filter(item => item.version === version)
      if (exactVersions.length !== 1) throw new Error('所选精确版本已不可读取。')
      if (!exactVersions[0].supported) throw new Error('参考图仅支持 JPEG 或 PNG。')

      const preview = await previewSession.previewVersion(version)
      if (!stillCurrent(snapshot)) throw abortError('Reference identity changed')
      const previewUrl = previewUrlFrom(preview)
      if (!previewUrl) throw new Error('该精确版本没有可用的授权图片预览。')
      if (sessions.has(key)) throw new Error('该文件版本已选择，不能重复加入。')

      sessions.set(key, previewSession)
      pendingSessions.delete(previewSession)
      selected.value = [...selected.value, Object.freeze({
        fileId,
        version,
        purpose: HALL_REFERENCE_PURPOSE,
        displayName: verified.displayName,
        originalFilename: exactVersions[0].originalFilename,
        contentMimeType: exactVersions[0].contentMimeType,
        previewUrl
      })]
      state.value = 'ready'
      return toHallDraftReference(selected.value[selected.value.length - 1])
    } catch (cause) {
      disposeSession(previewSession)
      if (cause?.name === 'AbortError' || !stillCurrent(snapshot)) return null
      return setError(cause?.message || '参考图预览读取失败。')
    } finally {
      pendingKeys.delete(key)
      pendingSessions.delete(previewSession)
    }
  }

  const replaceReferences = async references => {
    if (!Array.isArray(references) || references.length > HALL_REFERENCE_MAX_ITEMS) {
      clear({ resetCatalog: true })
      return setError('参考图草稿必须是 0 到 32 项的明确版本列表。')
    }
    const normalized = []
    const keys = new Set()
    for (const candidate of references) {
      const reference = toHallDraftReference(candidate)
      if (!reference) {
        clear({ resetCatalog: true })
        return setError('参考图草稿包含无效的文件、版本或用途。')
      }
      const key = referenceKey(reference.fileId, reference.version)
      if (keys.has(key)) {
        clear({ resetCatalog: true })
        return setError('参考图草稿不能包含重复的精确版本。')
      }
      keys.add(key)
      normalized.push(reference)
    }

    clear({ resetCatalog: true })
    if (!normalized.length) {
      state.value = 'ready'
      return []
    }
    for (const reference of normalized) {
      const detail = await openFile(reference.fileId)
      if (!detail) {
        const message = error.value
        clear({ resetCatalog: true })
        return setError(message || '参考图草稿验证失败。')
      }
      const added = await addReference(reference.fileId, reference.version)
      if (!added) {
        const message = error.value
        clear({ resetCatalog: true })
        return setError(message || '参考图草稿验证失败。')
      }
    }
    return draftReferences.value
  }

  const removeReference = (fileId, requestedVersion) => {
    const version = normalizeHallReferenceVersion(requestedVersion)
    if (!validId(fileId) || version == null) return false
    const key = referenceKey(fileId, version)
    const session = sessions.get(key)
    if (!session) return false
    sessions.delete(key)
    disposeSession(session)
    selected.value = selected.value.filter(item => !(item.fileId === fileId && item.version === version))
    error.value = ''
    state.value = 'ready'
    return true
  }

  const close = () => clear({ resetCatalog: true })
  const unregisterIdentityCleanup = registerIdentityCleanup(() => clear({ resetCatalog: true }))
  watch(currentEpoch, () => clear({ resetCatalog: true }), { flush: 'sync' })

  const dispose = () => {
    if (disposed) return
    disposed = true
    unregisterIdentityCleanup()
    clear({ resetCatalog: true })
    catalog.dispose?.()
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return {
    items: catalog.items,
    listState: catalog.listState,
    loading: catalog.loading,
    currentDetail,
    selected,
    draftReferences,
    state,
    error,
    refresh,
    openFile,
    addReference,
    replaceReferences,
    removeReference,
    clear,
    close,
    dispose
  }
}
