import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { agentApi as defaultAgentApi } from '../useHttp.js'
import { registerIdentityCleanup } from '../../utils/identityLifecycle.js'

const MAX_ID_LENGTH = 100
const MAX_TEXT_LENGTH = 16000
const MAX_INPUTS = 100
const ID = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH &&
  value === value.trim() && ![...value].some(char => char.codePointAt(0) < 32)
const TEXT = value => typeof value === 'string' && value.length <= MAX_TEXT_LENGTH
const VERSION = value => Number.isSafeInteger(value) && value >= 1 && value <= 2147483647
const REVISION = value => Number.isSafeInteger(value) && value >= 1
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const abortError = message => new DOMException(message, 'AbortError')
const randomKey = () => globalThis.crypto?.randomUUID?.() || `hall-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
const unwrap = result => {
  let value = result
  for (let index = 0; index < 2 && value && typeof value === 'object' && Object.hasOwn(value, 'data'); index += 1) value = value.data
  return value
}
const errorMessage = error => {
  if (error?.name === 'AbortError') return ''
  if ([401, 403, 404].includes(error?.status)) return '当前身份或草稿已不可访问，请返回后重新打开。'
  if (error?.status === 412 || error?.code === 'HALL_DRAFT_REVISION_CHANGED') return '草稿已被更新；本地内容未覆盖，请先重新载入再决定如何处理。'
  if (error?.status === 409) return '草稿操作与已有请求不一致，请刷新后核对。'
  if (error?.status === 422) return '所选来源或固定版本当前不可用于草稿，请重新选择。'
  if (error?.status === 503) return '草稿存储暂不可用；尚未确认保存，请稍后查询或重试。'
  return error?.message || '草稿请求未完成；尚未确认保存。'
}
const validInputs = inputs => Array.isArray(inputs) && inputs.length <= MAX_INPUTS && inputs.every(input => ID(input?.fileId) && VERSION(input?.version)) &&
  new Set(inputs.map(input => `${input.fileId}\u0000${input.version}`)).size === inputs.length
const validEditable = fields => fields && typeof fields === 'object' && !Array.isArray(fields) &&
  ['title', 'instruction', 'targetAgentId', 'outputMime', 'inputs'].every(key => Object.hasOwn(fields, key)) &&
  TEXT(fields.title) && TEXT(fields.instruction) && TEXT(fields.targetAgentId) && TEXT(fields.outputMime) && validInputs(fields.inputs)
const validSummary = value => value && typeof value === 'object' && ID(value.draftId) && REVISION(value.revision) &&
  value.state === 'EDITING' && Number.isSafeInteger(value.savedAt) && value.savedAt >= 0 &&
  ['CREATE', 'REVISION', 'TASK_CREATE', 'TASK_ACTION'].includes(value.kind) && TEXT(value.title) && TEXT(value.targetAgentId) && TEXT(value.outputMime) &&
  value.sourceSummary && typeof value.sourceSummary === 'object'
const validDraft = value => value && typeof value === 'object' && ID(value.draftId) && REVISION(value.revision) &&
  value.state === 'EDITING' && Number.isSafeInteger(value.savedAt) && value.savedAt >= 0 &&
  ['CREATE', 'REVISION', 'TASK_CREATE', 'TASK_ACTION'].includes(value.kind) && validEditable(value.editableFields) &&
  value.sourceSummary && typeof value.sourceSummary === 'object' && value.submissionRef == null
const normalizedEditable = fields => ({
  title: String(fields?.title || ''), instruction: String(fields?.instruction || ''),
  targetAgentId: String(fields?.targetAgentId || ''), outputMime: String(fields?.outputMime || ''),
  inputs: Array.isArray(fields?.inputs) ? fields.inputs.map(input => ({ fileId: input.fileId, version: input.version })) : []
})

/** DRAFT-v1 persistence only. It deliberately exposes no submit/run action. */
export function useHallDrafts ({ agentApi = defaultAgentApi, identityEpoch = 0, keyFactory = randomKey } = {}) {
  const draft = ref(null)
  const state = ref('idle')
  const error = ref('')
  const reloadRequired = ref(false)
  const summaries = ref([])
  const nextCursor = ref(null)
  const currentEpoch = computed(() => String(valueOf(identityEpoch) ?? ''))
  const controllers = new Set()
  let generation = 0
  let disposed = false

  const reset = () => {
    generation += 1
    for (const controller of controllers) controller.abort(abortError('Hall draft identity changed'))
    controllers.clear(); draft.value = null; summaries.value = []; nextCursor.value = null; state.value = 'idle'; error.value = ''; reloadRequired.value = false
  }
  const current = (snapshot, controller) => !disposed && snapshot.generation === generation && snapshot.epoch === currentEpoch.value && !controller.signal.aborted
  const request = async (options, snapshot = { generation, epoch: currentEpoch.value }) => {
    const controller = new AbortController(); controllers.add(controller)
    try {
      const response = await agentApi.execute({ ...options, autoLoading: false, needAuth: true, signal: controller.signal })
      if (!current(snapshot, controller)) throw abortError('Hall draft context changed')
      return unwrap(response)
    } finally { controllers.delete(controller) }
  }
  const apply = value => {
    if (!validDraft(value)) throw new Error('草稿回执无效，尚不能显示为已保存。')
    draft.value = value; state.value = 'ready'; error.value = ''; reloadRequired.value = false
    return value
  }
  const create = async ({ kind = 'TASK_CREATE', originRef = 'juyiting', sourceRef = null, caseId = null, taskId = null, conversationId = null, sourceOutputRef = null, ...editable } = {}) => {
    const fields = normalizedEditable(editable)
    if (!validEditable(fields) || !['CREATE', 'REVISION', 'TASK_CREATE', 'TASK_ACTION'].includes(kind) || !TEXT(originRef)) {
      state.value = 'error'; error.value = '草稿内容或固定版本无效，未发起保存。'; return null
    }
    const snapshot = { generation, epoch: currentEpoch.value }; state.value = 'creating'; error.value = ''
    try {
      return apply(await request({ url: '/hall/drafts', method: 'POST', headers: { 'Idempotency-Key': keyFactory() }, data: { kind, originRef, sourceRef, caseId, taskId, conversationId, ...fields, sourceOutputRef } }, snapshot))
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { state.value = 'error'; error.value = errorMessage(cause) }
      return null
    }
  }
  const save = async editable => {
    const currentDraft = draft.value
    const fields = normalizedEditable(editable)
    if (!validDraft(currentDraft) || !validEditable(fields)) { state.value = 'error'; error.value = '请先保存可编辑的草稿，并检查固定版本。'; return null }
    const snapshot = { generation, epoch: currentEpoch.value, draftId: currentDraft.draftId, revision: currentDraft.revision }
    state.value = 'saving'; error.value = ''
    try {
      return apply(await request({ url: `/hall/drafts/${encodeURIComponent(snapshot.draftId)}`, method: 'PUT', headers: { 'If-Match': `"${snapshot.revision}"` }, data: fields }, snapshot))
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation && draft.value?.draftId === snapshot.draftId) {
        state.value = 'error'; error.value = errorMessage(cause); reloadRequired.value = cause?.status === 412 || cause?.code === 'HALL_DRAFT_REVISION_CHANGED'
      }
      return null
    }
  }
  const list = async ({ cursor = null, append = false } = {}) => {
    if (cursor != null && (!ID(cursor) || cursor.length > 512)) return false
    const snapshot = { generation, epoch: currentEpoch.value }; state.value = append ? state.value : 'loading'; error.value = ''
    try {
      const page = await request({ url: '/hall/drafts', method: 'GET', params: cursor ? { cursor } : undefined }, snapshot)
      if (!page || !Array.isArray(page.items) || !page.items.every(validSummary) || (page.nextCursor != null && (!ID(page.nextCursor) || page.nextCursor.length > 512))) throw new Error('可恢复草稿目录返回无效。')
      summaries.value = append ? [...new Map([...summaries.value, ...page.items].map(item => [item.draftId, item])).values()] : page.items
      nextCursor.value = page.nextCursor || null; state.value = 'ready'; return true
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { state.value = 'error'; error.value = errorMessage(cause) }
      return false
    }
  }
  const loadMore = () => nextCursor.value ? list({ cursor: nextCursor.value, append: true }) : Promise.resolve(false)
  const load = async draftId => {
    if (!ID(draftId)) return null
    const snapshot = { generation, epoch: currentEpoch.value }; state.value = 'loading'; error.value = ''
    try { return apply(await request({ url: `/hall/drafts/${encodeURIComponent(draftId)}`, method: 'GET' }, snapshot)) } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { state.value = 'error'; error.value = errorMessage(cause) }
      return null
    }
  }
  const discard = async () => {
    const currentDraft = draft.value
    if (!validDraft(currentDraft)) return null
    const snapshot = { generation, epoch: currentEpoch.value, draftId: currentDraft.draftId, revision: currentDraft.revision }
    state.value = 'discarding'; error.value = ''
    try {
      const result = await request({ url: `/hall/drafts/${encodeURIComponent(snapshot.draftId)}/discard`, method: 'POST', headers: { 'Idempotency-Key': keyFactory() }, data: { expectedRevision: snapshot.revision } }, snapshot)
      if (!result || result.draftId !== snapshot.draftId || result.state !== 'DISCARDED') throw new Error('放弃草稿回执无效，尚不能确认放弃。')
      draft.value = null; state.value = 'idle'; error.value = ''; reloadRequired.value = false
      return result
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { state.value = 'error'; error.value = errorMessage(cause) }
      return null
    }
  }
  watch(currentEpoch, reset, { immediate: true, flush: 'sync' })
  const unregisterIdentityCleanup = registerIdentityCleanup(reset)
  const dispose = () => { if (!disposed) { disposed = true; unregisterIdentityCleanup(); reset() } }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { draft, summaries, nextCursor, state, error, reloadRequired, create, save, list, loadMore, load, discard, reset, dispose }
}
