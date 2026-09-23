import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { createApi } from './useHttp.js'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'

const MAX_ID_LENGTH = 100
const MAX_CURSOR_LENGTH = 512
const MAX_INT = 2147483647
const LINK_FIELDS = new Set(['relationId', 'taskId', 'fileId', 'version', 'role', 'state', 'relationRevision', 'createdAt'])
const LIST_FIELDS = new Set(['items', 'nextCursor'])
const DETACH_FIELDS = new Set(['link', 'executionSnapshotsPreserved'])
const ID = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH &&
  !/^\s|\s$/u.test(value) && ![...value].some(char => char.codePointAt(0) < 32)
const CURSOR = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_CURSOR_LENGTH &&
  ![...value].some(char => char.codePointAt(0) < 32)
const VERSION = value => Number.isInteger(value) && value >= 1 && value <= MAX_INT
const REVISION = value => Number.isSafeInteger(value) && value >= 1
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const abortError = message => new DOMException(message, 'AbortError')
const randomKey = () => globalThis.crypto?.randomUUID?.() || `pws-task-link-${Date.now()}-${Math.random().toString(36).slice(2)}`

const unwrap = result => {
  let value = result
  for (let index = 0; index < 2 && value && typeof value === 'object' && Object.hasOwn(value, 'data'); index += 1) value = value.data
  return value
}
const responseHeaders = response => response?.headers && typeof response.headers === 'object' ? response.headers : {}
const header = (headers, name) => {
  if (typeof headers?.get === 'function') return headers.get(name) || ''
  return Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || ''
}
const exactKeys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.size && Object.keys(value).every(key => fields.has(key))
const validLink = (value, taskId) => exactKeys(value, LINK_FIELDS) && value.taskId === taskId &&
  ID(value.relationId) && ID(value.fileId) && VERSION(value.version) && ['INPUT', 'REFERENCE', 'OUTPUT'].includes(value.role) &&
  ['ACTIVE', 'DETACHED'].includes(value.state) && REVISION(value.relationRevision) &&
  Number.isSafeInteger(value.createdAt) && value.createdAt >= 0
const etagFor = link => validLink(link, link?.taskId) ? `"${link.relationId}:${link.relationRevision}"` : ''
const validEtag = (value, link) => typeof value === 'string' && value === etagFor(link)
const validList = (value, taskId) => exactKeys(value, LIST_FIELDS) && Array.isArray(value.items) &&
  value.items.length <= 50 && value.items.every(item => validLink(item, taskId)) &&
  (value.nextCursor == null || CURSOR(value.nextCursor)) &&
  new Set(value.items.map(item => item.relationId)).size === value.items.length
const validDetach = (value, taskId) => exactKeys(value, DETACH_FIELDS) && validLink(value.link, taskId) &&
  value.link.state === 'DETACHED' && value.executionSnapshotsPreserved === true
const errorMessage = error => {
  if (error?.name === 'AbortError') return ''
  if ([401, 403, 404].includes(error?.status)) return '当前身份或任务资料已不可访问，请刷新后重新选择。'
  if (error?.code === 'IDEMPOTENCY_CONFLICT') return '本次关联请求与已有操作不一致，请刷新后确认关联记录。'
  if (error?.code === 'OUTPUT_LINK_MANAGED_BY_EXECUTION') return '任务成果由执行流程管理，不能在资料关联中修改。'
  if (error?.code === 'TASK_FILE_LINK_CHANGED' || error?.status === 412) return '关联已变化，请刷新后再解除。'
  if (error?.code === 'PRECONDITION_REQUIRED' || error?.status === 428) return '关联版本前提缺失，请刷新后再解除。'
  if (error?.status === 400) return '关联请求格式无效，请检查文件版本和资料用途。'
  if (error?.status === 503) return '任务资料关联暂不可用，请稍后刷新确认，不要重复提交。'
  return error?.message || '任务资料关联请求未完成，请刷新确认。'
}

/**
 * JWT-scoped task material directory. taskId is only a resource selector: authorization
 * remains exclusively server-side, and this adapter never derives it from a route or Agent.
 */
export function usePersonalWorkspaceTaskLinks ({ api = createApi('/agent'), taskId = null, identityEpoch = 0 } = {}) {
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
  }
  const stillCurrent = (snapshot, controller) => !disposed && snapshot.generation === generation &&
    snapshot.contextKey === contextKey.value && !controller.signal.aborted
  const request = async (options, snapshot = { generation, contextKey: contextKey.value }) => {
    const controller = new AbortController()
    controllers.add(controller)
    try {
      const response = await api.execute({ ...options, autoLoading: false, needAuth: true, signal: controller.signal })
      if (!stillCurrent(snapshot, controller)) throw abortError('Task link context changed')
      return { data: unwrap(response), headers: responseHeaders(response) }
    } finally {
      controllers.delete(controller)
    }
  }
  const replace = link => {
    const index = links.value.findIndex(item => item.relationId === link.relationId)
    links.value = index < 0
      ? [link, ...links.value]
      : links.value.map(item => item.relationId === link.relationId ? link : item)
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
  // Cross-origin deployments may not expose ETag to fetch even when the server sets it.
  // In that case verify the committed revision through an authenticated, read-only GET;
  // never issue a second POST/DELETE to recover an uncertain write.
  const confirmWithoutExposedEtag = async (link, selectedTaskId, snapshot) => {
    const { data } = await request({
      url: `/tasks/${encodeURIComponent(selectedTaskId)}/file-links`, method: 'GET'
    }, snapshot)
    if (!validList(data, selectedTaskId)) return false
    return data.items.some(item => Object.keys(link).every(key => item[key] === link[key]))
  }
  const attach = async ({ fileId, version, role } = {}) => {
    const selectedTaskId = currentTaskId.value
    if (!ID(selectedTaskId) || !ID(fileId) || !VERSION(version) || !['INPUT', 'REFERENCE'].includes(role)) {
      error.value = '请选择明确的文件版本，并指定输入资料或参考资料。'
      actionState.value = 'error'
      return null
    }
    const snapshot = { generation, contextKey: contextKey.value }
    actionState.value = 'saving'; error.value = ''
    try {
      const { data, headers } = await request({
        url: `/tasks/${encodeURIComponent(selectedTaskId)}/file-links`, method: 'POST',
        data: { fileId, version, role }, headers: { 'Idempotency-Key': randomKey() }
      }, snapshot)
      const exposedEtag = header(headers, 'etag')
      if (!validLink(data, selectedTaskId) || data.state !== 'ACTIVE' ||
          data.fileId !== fileId || data.version !== version || data.role !== role ||
          (exposedEtag ? !validEtag(exposedEtag, data) :
            !(await confirmWithoutExposedEtag(data, selectedTaskId, snapshot)))) {
        throw new Error('任务资料关联回执无效，请刷新核对原关联；不要重复提交。')
      }
      replace(data)
      actionState.value = 'ready'
      return data
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation && snapshot.contextKey === contextKey.value) {
        error.value = errorMessage(cause); actionState.value = 'error'
      }
      return null
    }
  }
  const detach = async link => {
    const selectedTaskId = currentTaskId.value
    if (!ID(selectedTaskId) || !validLink(link, selectedTaskId) || link.state !== 'ACTIVE') {
      error.value = '请先刷新并选择一个当前关联。'
      actionState.value = 'error'
      return null
    }
    const ifMatch = etagFor(link)
    const snapshot = { generation, contextKey: contextKey.value }
    actionState.value = 'removing'; error.value = ''
    try {
      const { data, headers } = await request({
        url: `/tasks/${encodeURIComponent(selectedTaskId)}/file-links/${encodeURIComponent(link.relationId)}`,
        method: 'DELETE', headers: { 'Idempotency-Key': randomKey(), 'If-Match': ifMatch }
      }, snapshot)
      const exposedEtag = header(headers, 'etag')
      if (!validDetach(data, selectedTaskId) || data.link.relationId !== link.relationId ||
          (exposedEtag ? !validEtag(exposedEtag, data.link) :
            !(await confirmWithoutExposedEtag(data.link, selectedTaskId, snapshot)))) {
        throw new Error('解除任务资料关联回执无效，请刷新核对原关联；不要重复提交。')
      }
      replace(data.link)
      actionState.value = 'ready'
      return data
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation && snapshot.contextKey === contextKey.value) {
        error.value = errorMessage(cause); actionState.value = 'error'
      }
      return null
    }
  }

  watch(contextKey, reset, { immediate: true, flush: 'sync' })
  const unregisterIdentityCleanup = registerIdentityCleanup(reset)
  const dispose = () => {
    if (disposed) return
    disposed = true
    unregisterIdentityCleanup()
    reset()
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return { links, nextCursor, listState, loading, actionState, error, currentTaskId, load, loadMore, attach, detach, etagFor, reset, dispose }
}
