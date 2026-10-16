import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from './useHttp.js'
import { usePersonalWorkspaceWriteIntent } from './usePersonalWorkspaceWriteIntent.js'
import { workspaceRevisionTag } from '../utils/personalWorkspaceProtocol.js'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'

const MAX_ID_LENGTH = 100
const MAX_CURSOR_LENGTH = 512
const MAX_INT = 2147483647
const LINK_FIELDS = new Set(['relationId', 'taskId', 'fileId', 'version', 'role', 'state', 'relationRevision', 'createdAt'])
const LIST_FIELDS = new Set(['items', 'nextCursor', 'hasMore'])
const DETACH_FIELDS = new Set(['link', 'executionSnapshotsPreserved'])
const ID = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH &&
  !/^\s|\s$/u.test(value) && ![...value].some(char => char.codePointAt(0) < 32)
const CURSOR = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_CURSOR_LENGTH &&
  ![...value].some(char => char.codePointAt(0) < 32)
const DECIMAL = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 9223372036854775807n
const VERSION = value => DECIMAL(value) && BigInt(value) >= 1n && BigInt(value) <= BigInt(MAX_INT)
const REVISION = value => DECIMAL(value) && BigInt(value) >= 1n
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const abortError = message => new DOMException(message, 'AbortError')

const exactKeys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.size && Object.keys(value).every(key => fields.has(key))
const validLink = (value, taskId) => exactKeys(value, LINK_FIELDS) && value.taskId === taskId &&
  ID(value.relationId) && ID(value.fileId) && VERSION(value.version) && ['INPUT', 'REFERENCE', 'OUTPUT'].includes(value.role) &&
  ['ACTIVE', 'DETACHED'].includes(value.state) && REVISION(value.relationRevision) &&
  Number.isSafeInteger(value.createdAt) && value.createdAt >= 0
const etagFor = link => validLink(link, link?.taskId) ? workspaceRevisionTag(link.relationId, link.relationRevision) : ''
const validList = (value, taskId) => exactKeys(value, LIST_FIELDS) && typeof value.hasMore === 'boolean' && value.hasMore === (value.nextCursor !== null) && Array.isArray(value.items) &&
  value.items.length <= 50 && value.items.every(item => validLink(item, taskId)) &&
  (value.nextCursor == null || CURSOR(value.nextCursor)) &&
  new Set(value.items.map(item => item.relationId)).size === value.items.length
const validDetach = (value, taskId) => exactKeys(value, DETACH_FIELDS) && validLink(value.link, taskId) &&
  value.executionSnapshotsPreserved === true
const errorMessage = error => {
  if (error?.name === 'AbortError') return ''
  if ([401, 403, 404].includes(error?.status)) return '当前身份或任务资料已不可访问，请刷新后重新选择。'
  if (error?.code === 'IDEMPOTENCY_CONFLICT') return '本次关联请求与已有操作不一致，请刷新后确认关联记录。'
  if (error?.code === 'OUTPUT_LINK_MANAGED_BY_EXECUTION') return '任务成果由执行流程管理，不能在资料关联中修改。'
  if (error?.code === 'TASK_FILE_LINK_CHANGED' || error?.status === 412) return '关联已变化，请刷新后再解除。'
  if (error?.code === 'PRECONDITION_REQUIRED' || error?.status === 428) return '关联版本前提缺失，请刷新后再解除。'
  if (error?.status === 400) return '关联请求格式无效，请检查文件版本和资料用途。'
  if (error?.status === 503) return '任务资料关联暂不可用；写入结果未确认时，请重试原操作，不要重复新建。'
  return error?.message || '任务资料关联请求未完成，请刷新确认。'
}

/**
 * JWT-scoped task material directory. taskId is only a resource selector: authorization
 * remains exclusively server-side, and this adapter never derives it from a route or Agent.
 */
export function usePersonalWorkspaceTaskLinks ({ api = createApi('/agent'), taskId = null, identityEpoch = 0 } = {}) {
  const writes = usePersonalWorkspaceWriteIntent()
  const writeNotice = ref('')
  const links = ref([])
  const nextCursor = ref(null)
  const listState = ref('idle')
  const loading = ref(false)
  const actionState = ref('idle')
  const error = ref('')
  const currentTaskId = computed(() => valueOf(taskId))
  const currentEpoch = computed(() => String(valueOf(identityEpoch) ?? ''))
  const contextKey = computed(() => ID(currentTaskId.value) ? `${currentEpoch.value}\u0000${currentTaskId.value}` : '')
  const controllers = new Set()
  let generation = 0
  let disposed = false

  const reset = () => {
    generation += 1
    for (const controller of controllers) controller.abort(abortError('Task link context changed'))
    controllers.clear()
    links.value = []
    nextCursor.value = null
    listState.value = 'idle'
    loading.value = false
    actionState.value = 'idle'
    error.value = ''
    writeNotice.value = ''
  }
  const stillCurrent = (snapshot, controller) => !disposed && snapshot.generation === generation &&
    snapshot.contextKey === contextKey.value && !controller.signal.aborted
  const request = async (options, snapshot = { generation, contextKey: contextKey.value }) => {
    const controller = new AbortController()
    if (!stillCurrent(snapshot, controller)) throw abortError('Link context changed')
    controllers.add(controller)
    try {
      let metadata
      const response = await api.execute({
        ...options, autoLoading: false, needAuth: true, signal: controller.signal,
        onSuccess: (value, currentMetadata) => {
          metadata = currentMetadata
          options.onSuccess?.(value, currentMetadata)
        }
      })
      if (!stillCurrent(snapshot, controller)) throw abortError('Task link context changed')
      return { data: response, headers: metadata?.headers || {} }
    } finally {
      controllers.delete(controller)
    }
  }
  const replace = link => {
    const index = links.value.findIndex(item => item.relationId === link.relationId)
    links.value = index < 0
      ? [link, ...links.value]
      : links.value.map(item => item.relationId === link.relationId && BigInt(link.relationRevision) >= BigInt(item.relationRevision) ? link : item)
  }
  const load = async ({ cursor = null, append = false } = {}) => {
    const selectedTaskId = currentTaskId.value
    const snapshot = { generation, contextKey: contextKey.value }
    if (!ID(selectedTaskId) || !snapshot.contextKey || loading.value || (cursor != null && !CURSOR(cursor))) return false
    loading.value = true
    if (!append) { listState.value = 'loading'; error.value = '' }
    try {
      const { data } = await request({
        url: `/tasks/${encodeURIComponent(selectedTaskId)}/file-links`, method: 'GET',
        params: cursor ? { cursor } : undefined
      }, snapshot)
      if (!validList(data, selectedTaskId)) throw new Error('任务资料关联目录返回格式无效，未展示可能不完整的数据。')
      if (append) {
        const combined = new Map([...links.value, ...data.items].map(item => [item.relationId, item]))
        links.value = [...combined.values()]
      } else links.value = data.items
      nextCursor.value = data.nextCursor || null
      listState.value = links.value.length ? 'ready' : 'empty'
      return true
    } catch (cause) {
      if (cause?.name !== 'AbortError' && !disposed && snapshot.generation === generation && snapshot.contextKey === contextKey.value) {
        error.value = errorMessage(cause)
        listState.value = 'error'
      }
      return false
    } finally {
      if (snapshot.generation === generation && snapshot.contextKey === contextKey.value) loading.value = false
    }
  }
  const loadMore = () => nextCursor.value ? load({ cursor: nextCursor.value, append: true }) : Promise.resolve(false)
  /**
   * Reads one complete immutable directory observation for authorization-sensitive
   * consumers. Partial pages are never published as a complete result.
   */
  const loadAll = async () => {
    const selectedTaskId = currentTaskId.value
    const snapshot = { generation, contextKey: contextKey.value }
    if (!ID(selectedTaskId) || !snapshot.contextKey || loading.value) return null
    loading.value = true
    listState.value = 'loading'
    error.value = ''
    links.value = []
    nextCursor.value = null
    const observedRelations = new Set()
    const observedCursors = new Set()
    const complete = []
    let cursor = null
    try {
      do {
        if (cursor != null) {
          if (observedCursors.has(cursor)) throw new Error('任务资料关联目录游标重复，未接受不完整目录。')
          observedCursors.add(cursor)
        }
        const { data } = await request({
          url: `/tasks/${encodeURIComponent(selectedTaskId)}/file-links`, method: 'GET',
          params: cursor ? { cursor } : undefined
        }, snapshot)
        if (!validList(data, selectedTaskId)) throw new Error('任务资料关联目录返回格式无效，未接受不完整目录。')
        for (const item of data.items) {
          if (observedRelations.has(item.relationId)) throw new Error('任务资料关联目录含跨页重复关联，未接受不完整目录。')
          observedRelations.add(item.relationId)
          complete.push({ ...item })
        }
        cursor = data.nextCursor || null
      } while (cursor != null)
      if (disposed || snapshot.generation !== generation || snapshot.contextKey !== contextKey.value) throw abortError('Task link context changed')
      links.value = complete
      nextCursor.value = null
      listState.value = complete.length ? 'ready' : 'empty'
      return complete.map(item => ({ ...item }))
    } catch (cause) {
      if (cause?.name !== 'AbortError' && !disposed && snapshot.generation === generation && snapshot.contextKey === contextKey.value) {
        links.value = []
        nextCursor.value = null
        error.value = errorMessage(cause)
        listState.value = 'error'
      }
      return null
    } finally {
      if (snapshot.generation === generation && snapshot.contextKey === contextKey.value) loading.value = false
    }
  }
  const retryWrite = async target => {
    const originalParent = JSON.parse(target)[0]
    if (originalParent !== currentTaskId.value) {
      error.value = '请返回原任务后重试原操作。'
      return null
    }
    const context = contextKey.value
    try { return await writes.retry(target) } catch (cause) {
      if (context === contextKey.value && !disposed) { error.value = errorMessage(cause); actionState.value = 'error' }
      return null
    }
  }
  const attach = async ({ fileId, version, role } = {}) => {
    const selectedTaskId = currentTaskId.value
    if (!ID(selectedTaskId) || !ID(fileId) || !VERSION(version) || !['INPUT', 'REFERENCE'].includes(role)) {
      error.value = '请选择明确的文件版本，并指定输入资料或参考资料。'
      actionState.value = 'error'
      return null
    }
    const originalContext = contextKey.value
    actionState.value = 'saving'; error.value = ''; writeNotice.value = ''
    try {
      return await writes.run({
        target: JSON.stringify([selectedTaskId, fileId]), input: ['CREATE', version, role], label: `关联任务资料（${selectedTaskId} / ${fileId}）`,
        execute: async (key, replay) => {
          const { data } = await request({
            url: `/tasks/${encodeURIComponent(selectedTaskId)}/file-links`, method: 'POST',
            data: { fileId, version, role }, headers: { 'Idempotency-Key': key }
          }, { generation, contextKey: originalContext })
          if (!validLink(data, selectedTaskId) || (!replay && data.state !== 'ACTIVE') ||
              data.fileId !== fileId || data.version !== version || data.role !== role) {
            throw new Error('任务资料关联回执无效，请重试原操作核对。')
          }
          return data
        },
        committed: data => {
          if (originalContext !== contextKey.value || disposed) return
          replace(data)
          actionState.value = 'ready'
          writeNotice.value = data.state === 'ACTIVE' ? '原关联操作已提交。' : '原关联操作已提交，但当前关联已解除。'
        }
      })
    } catch (cause) {
      if (cause?.name !== 'AbortError' && originalContext === contextKey.value && !disposed) {
        error.value = errorMessage(cause); actionState.value = 'error'
      }
      return null
    }
  }
  const detach = async link => {
    const selectedTaskId = currentTaskId.value
    if (!ID(selectedTaskId) || !validLink(link, selectedTaskId) || link.state !== 'ACTIVE') {
      error.value = '请先刷新并选择一个当前关联。'; actionState.value = 'error'; return null
    }
    // Never read a later reactive row when retrying the original destructive operation.
    const original = { ...link }
    const ifMatch = etagFor(original)
    const originalContext = contextKey.value
    actionState.value = 'removing'; error.value = ''; writeNotice.value = ''
    try {
      return await writes.run({
        target: JSON.stringify([selectedTaskId, original.fileId]), input: ['DELETE', original.relationId, ifMatch], label: `解除任务资料关联（${selectedTaskId} / ${original.fileId}）`,
        execute: async (key, replay) => {
          const { data } = await request({
            url: `/tasks/${encodeURIComponent(selectedTaskId)}/file-links/${encodeURIComponent(original.relationId)}`,
            method: 'DELETE', headers: { 'Idempotency-Key': key, 'If-Match': ifMatch }
          }, { generation, contextKey: originalContext })
          if (!validDetach(data, selectedTaskId) || (!replay && data.link.state !== 'DETACHED') ||
              data.link.relationId !== original.relationId || data.link.fileId !== original.fileId ||
              data.link.version !== original.version || data.link.role !== original.role) {
            throw new Error('解除任务资料关联回执无效，请重试原操作核对。')
          }
          return data
        },
        committed: data => {
          if (originalContext !== contextKey.value || disposed) return
          replace(data.link)
          actionState.value = 'ready'
          writeNotice.value = data.link.state === 'DETACHED' ? '原解除操作已提交。' : '原解除操作已提交，但当前资料已重新关联。'
        }
      })
    } catch (cause) {
      if (cause?.name !== 'AbortError' && originalContext === contextKey.value && !disposed) {
        error.value = errorMessage(cause); actionState.value = 'error'
      }
      return null
    }
  }

  watch(contextKey, reset, { immediate: true, flush: 'sync' })
  watch(currentEpoch, () => writes.clear(), { flush: 'sync' })
  const unregisterIdentityCleanup = registerIdentityCleanup(() => { writes.clear(); reset() })
  const dispose = () => {
    if (disposed) return
    disposed = true
    writes.clear()
    unregisterIdentityCleanup()
    reset()
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return { pendingWrites: writes.pending, retryWrite, writeNotice, links, nextCursor, listState, loading, actionState, error, currentTaskId, load, loadMore, loadAll, attach, detach, etagFor, reset, dispose }
}
