import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { agentApi as defaultApi } from '../useHttp.js'
import { registerIdentityCleanup } from '../../utils/identityLifecycle.js'

export const HALL_SOURCES = Object.freeze(['private', 'task', 'draft'])
export const HALL_VIEWS = Object.freeze(['recent', 'needsAction'])
const sourceTypes = { private: ['PRIVATE_CASE', 'LEGACY_EXECUTION'], task: ['TASK'], draft: ['DRAFT'] }
const actions = { PRIVATE_CASE: 'OPEN_CASE', LEGACY_EXECUTION: 'OPEN_EXECUTION', TASK: 'OPEN_TASK', DRAFT: 'EDIT_DRAFT' }
const statuses = ['complete', 'partial', 'error']
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const timestamp = value => Number.isSafeInteger(value) && value >= 0
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && value === value.trim() && ![...value].some(char => char.codePointAt(0) < 32)
const text = value => typeof value === 'string' && value.length > 0
const unwrap = response => response?.data?.data ?? response?.data ?? response
const abort = () => new DOMException('Hall read context changed', 'AbortError')
const partition = (status = 'idle', errorCode = null) => ({ items: [], status, nextCursor: null, count: null, errorCode, loading: false, readError: '', asOf: null })
const section = (status = 'idle', errorCode = null) => ({ status, partitions: Object.fromEntries(HALL_SOURCES.map(source => [source, partition(status, errorCode)])) })
const sectionsFor = (status, code) => Object.fromEntries(HALL_VIEWS.map(view => [view, section(status, code)]))
const aggregate = partitions => {
  const values = Object.values(partitions)
  return values.every(item => item.status === 'complete') ? 'complete' : values.every(item => item.status === 'error') ? 'error' : 'partial'
}
export const canOpenHallItem = item => Boolean(actions[item?.ref?.sourceType] === item?.nextAction && item?.allowedActions?.includes(item.nextAction))

const validItem = (item, source) => item && sourceTypes[source].includes(item.ref?.sourceType) && id(item.ref.sourceId) &&
  (item.title === null || typeof item.title === 'string') && text(item.status?.code) && text(item.status?.evidenceSource) &&
  timestamp(item.status.observedAt) && (item.targetAgent === null || id(item.targetAgent?.agentId)) &&
  item.nextAction === actions[item.ref.sourceType] && Array.isArray(item.allowedActions) && item.allowedActions.every(text) && timestamp(item.updatedAt)

const readPartition = (value, source, sourceStatus, asOf) => {
  if (!value || !statuses.includes(value.status) || value.count !== null || !Array.isArray(value.items) ||
    !value.items.every(item => validItem(item, source)) ||
    (value.nextCursor !== null && (typeof value.nextCursor !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value.nextCursor))) ||
    (value.errorCode !== null && !text(value.errorCode)) || sourceStatus?.status !== value.status || sourceStatus?.errorCode !== value.errorCode) {
    return { ...partition('error', 'INVALID_RESPONSE'), asOf }
  }
  const keys = value.items.map(item => `${item.ref.sourceType}:${item.ref.sourceId}`)
  if (new Set(keys).size !== keys.length) return { ...partition('error', 'INVALID_RESPONSE'), asOf }
  return { ...value, loading: false, readError: '', asOf }
}

/** Read-only independent partitions. No task-board filters, global totals or browser persistence. */
export function useHallOverview ({ api = defaultApi, identityEpoch = 0, identityScope = '' } = {}) {
  const sections = ref(sectionsFor())
  const queries = ref({ recent: '', needsAction: '' })
  const state = ref('idle')
  const openingRef = ref(null)
  const openError = ref('')
  const scope = computed(() => typeof valueOf(identityScope) === 'string' ? valueOf(identityScope).trim() : '')
  const controllers = new Set()
  const sequences = new Map()
  let generation = 0
  let disposed = false
  let openingSequence = 0
  const reset = () => {
    generation += 1
    for (const controller of controllers) controller.abort(abort())
    controllers.clear()
    sequences.clear()
    sections.value = sectionsFor()
    queries.value = { recent: '', needsAction: '' }
    state.value = 'idle'
    openingRef.value = null
    openError.value = ''
  }
  const request = async (options, key) => {
    if (disposed || !scope.value) throw abort()
    const capturedGeneration = generation
    const sequence = (sequences.get(key) || 0) + 1
    sequences.set(key, sequence)
    const controller = new AbortController()
    controllers.add(controller)
    try {
      const response = await api.execute({ ...options, method: 'GET', needAuth: true, autoLoading: false, signal: controller.signal })
      if (disposed || controller.signal.aborted || capturedGeneration !== generation || sequence !== sequences.get(key)) throw abort()
      return unwrap(response)
    } catch (error) {
      if (disposed || controller.signal.aborted || capturedGeneration !== generation || sequence !== sequences.get(key)) throw abort()
      if ([401, 403].includes(error?.status)) {
        reset()
        sections.value = sectionsFor('error', 'ACCESS_UNAVAILABLE')
        state.value = 'error'
        openError.value = '当前身份无法访问，请重新授权后再打开。'
      }
      throw error
    } finally {
      controllers.delete(controller)
    }
  }
  const decode = (value, sources, sourceStatus, asOf) => {
    if (!value || !statuses.includes(value.status) || !timestamp(asOf)) throw new Error('INVALID_RESPONSE')
    return Object.fromEntries(sources.map(source => [source, readPartition(value.partitions?.[source], source, sourceStatus?.[source], asOf)]))
  }
  const refresh = async () => {
    reset()
    if (!scope.value || disposed) return false
    state.value = 'loading'
    sections.value = sectionsFor('loading')
    try {
      // /overview explicitly forbids all query parameters.
      const result = await request({ url: '/hall/overview' }, 'overview')
      if (result?.schemaVersion !== 1) throw new Error('INVALID_RESPONSE')
      const next = {}
      for (const view of HALL_VIEWS) {
        const partitions = decode(result.sections?.[view], HALL_SOURCES, result.sourceStatus?.[view], result.asOf)
        next[view] = { status: aggregate(partitions), partitions }
      }
      sections.value = next
      state.value = 'ready'
      return true
    } catch (error) {
      if (error?.name !== 'AbortError' && ![401, 403].includes(error?.status)) {
        sections.value = sectionsFor('error', 'READ_UNAVAILABLE')
        state.value = 'error'
      }
      return false
    }
  }
  const loadPartition = async (view, source, { append = false } = {}) => {
    if (!HALL_VIEWS.includes(view) || !HALL_SOURCES.includes(source) || !scope.value || state.value === 'loading') return false
    const previous = sections.value[view].partitions[source]
    if (previous.loading || (append && !previous.nextCursor)) return false
    previous.loading = true
    previous.readError = ''
    const q = queries.value[view]
    const params = { kind: source, view, q }
    if (append) params.cursor = previous.nextCursor
    try {
      const result = await request({ url: '/hall/items', params }, `${view}:${source}`)
      if (result?.schemaVersion !== 1 || result.kind !== source || result.view !== view || result.q !== q) throw new Error('INVALID_RESPONSE')
      const decoded = decode(result.section, [source], result.sourceStatus, result.asOf)[source]
      if (decoded.status === 'error') throw new Error(decoded.errorCode || 'READ_UNAVAILABLE')
      if (append) {
        const seen = new Set(previous.items.map(item => `${item.ref.sourceType}:${item.ref.sourceId}`))
        decoded.items = [...previous.items, ...decoded.items.filter(item => !seen.has(`${item.ref.sourceType}:${item.ref.sourceId}`))]
        if (decoded.nextCursor === previous.nextCursor) throw new Error('INVALID_RESPONSE')
      }
      sections.value[view].partitions[source] = decoded
      sections.value[view].status = aggregate(sections.value[view].partitions)
      return true
    } catch (error) {
      if (error?.name !== 'AbortError' && ![401, 403].includes(error?.status)) {
        previous.readError = '本次读取未成功；已有记录不是最新确认结果。请重试此来源。'
        previous.status = previous.items.length ? 'partial' : 'error'
        previous.errorCode = 'READ_UNAVAILABLE'
        sections.value[view].status = aggregate(sections.value[view].partitions)
      }
      return false
    } finally {
      previous.loading = false
    }
  }
  const loadTask = async item => {
    if (!canOpenHallItem(item) || item.ref.sourceType !== 'TASK' || !id(item.ref.sourceId)) return null
    const sequence = ++openingSequence
    openingRef.value = item.ref
    openError.value = ''
    try {
      const task = await request({ url: `/tasks/${encodeURIComponent(item.ref.sourceId)}` }, 'open-task')
      if (task?.id !== item.ref.sourceId || typeof task.status !== 'string') throw new Error('INVALID_RESPONSE')
      return task
    } catch (error) {
      if (error?.name !== 'AbortError') openError.value = '该事项暂不可访问；未使用摘要代替正式事项。请重新打开。'
      return null
    } finally {
      if (sequence === openingSequence) openingRef.value = null
    }
  }
  watch([scope, () => valueOf(identityEpoch)], reset, { flush: 'sync' })
  const unregister = registerIdentityCleanup(reset)
  const dispose = () => { disposed = true; unregister(); reset() }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { sections, queries, state, openingRef, openError, refresh, loadPartition, loadTask, reset, dispose }
}
