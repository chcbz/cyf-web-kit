import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { agentApi as defaultAgentApi } from '../useHttp.js'
import { registerIdentityCleanup } from '../../utils/identityLifecycle.js'
import { validPersonalWorkspaceExecutionCapabilities } from '../usePersonalWorkspaceExecution.js'

const MAX_ID_LENGTH = 100
const MAX_TEXT_LENGTH = 16000
const MAX_INPUTS = 100
const MAX_CURSOR_LENGTH = 300
const RECOVERY_PREFIX = 'cyf.hall.submission-recovery.v1'
const BROWSER_KEY = `${RECOVERY_PREFIX}.browser`

const ID = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH &&
  value === value.trim() && ![...value].some(char => char.codePointAt(0) < 32)
const TEXT = value => typeof value === 'string' && value.length <= MAX_TEXT_LENGTH
const ISO_CONTROL = code => code < 32 || (code >= 127 && code <= 159)
const FIELD_TEXT = (value, max) => value === null || (typeof value === 'string' && [...value].length <= max &&
  ![...value].some(char => ISO_CONTROL(char.codePointAt(0)) && !['\n', '\r', '\t'].includes(char)))
const OPTIONAL_EXACT = (value, max) => value === null || (typeof value === 'string' && value.length > 0 &&
  value === value.trim() && [...value].length <= max && ![...value].some(char => ISO_CONTROL(char.codePointAt(0))))
export const hallDraftFieldError = fields => {
  if (!FIELD_TEXT(fields?.title, 200)) return '交办名目最多200字，且不能包含控制字符；原输入已保留。'
  if (!FIELD_TEXT(fields?.instruction, 20000)) return '具体交代最多20000字，且不能包含控制字符；原输入已保留。'
  if (!OPTIONAL_EXACT(fields?.targetAgentId, 100)) return '请明确选择可用的受托好汉；原选择已保留。'
  if (!OPTIONAL_EXACT(fields?.outputMime, 160)) return '期望格式标识最多160字，且须完整匹配支持的格式；原值已保留。'
  return ''
}
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
const sameScope = value => typeof value === 'string' && value.trim() && value.length <= 256 ? value.trim() : ''
const validInputs = inputs => Array.isArray(inputs) && inputs.length <= MAX_INPUTS &&
  inputs.every(input => ID(input?.fileId) && VERSION(input?.version)) &&
  new Set(inputs.map(input => `${input.fileId}\u0000${input.version}`)).size === inputs.length
const validEditable = fields => fields && typeof fields === 'object' && !Array.isArray(fields) &&
  ['title', 'instruction', 'targetAgentId', 'outputMime', 'inputs'].every(key => Object.hasOwn(fields, key)) &&
  !hallDraftFieldError(fields) && validInputs(fields.inputs)
const validSummary = value => value && typeof value === 'object' && ID(value.draftId) && REVISION(value.revision) &&
  value.state === 'EDITING' && Number.isSafeInteger(value.savedAt) && value.savedAt >= 0 &&
  ['CREATE', 'REVISION', 'TASK_CREATE', 'TASK_ACTION'].includes(value.kind) && FIELD_TEXT(value.title, 200) &&
  OPTIONAL_EXACT(value.targetAgentId, 100) && OPTIONAL_EXACT(value.outputMime, 160) && value.sourceSummary && typeof value.sourceSummary === 'object'
const validDraft = value => value && typeof value === 'object' && ID(value.draftId) && REVISION(value.revision) &&
  ['EDITING', 'SUBMITTED'].includes(value.state) && Number.isSafeInteger(value.savedAt) && value.savedAt >= 0 &&
  ['CREATE', 'REVISION', 'TASK_CREATE', 'TASK_ACTION'].includes(value.kind) && validEditable(value.editableFields) &&
  value.sourceSummary && typeof value.sourceSummary === 'object' && (value.submissionRef == null || typeof value.submissionRef === 'string')
const editableDraft = value => validDraft(value) && value.state === 'EDITING'
const validRef = value => value && typeof value === 'object' && ['PRIVATE_CASE', 'TASK'].includes(value.sourceType) && ID(value.sourceId)
const validExecution = value => value && typeof value === 'object' && ID(value.executionId) && ID(value.targetAgentId) &&
  ['QUEUED', 'INPUTS_REVOKED', 'OUTPUT_COMMITTED', 'FAILED'].includes(value.state)
// SUBMISSION-v1: TASK_ACTION runs an execution; TASK_CREATE creates only a formal task.
const validReceipt = (value, kind = null) => {
  if (!value || typeof value !== 'object' || !validRef(value.ref) ||
    !Number.isSafeInteger(value.submittedAt) || value.submittedAt < 0) return false
  const taskCreate = value.ref.sourceType === 'TASK' && value.execution === null &&
    ID(value.task?.taskId) && value.task.taskId === value.ref.sourceId &&
    typeof value.task.taskVersion === 'string' && value.task.taskVersion.length > 0
  const execution = validExecution(value.execution) && value.task === null
  if (kind === 'TASK_CREATE') return taskCreate
  if (kind === 'TASK_ACTION') return execution && value.ref.sourceType === 'TASK'
  if (['CREATE', 'REVISION'].includes(kind)) return execution && value.ref.sourceType === 'PRIVATE_CASE'
  return taskCreate || execution
}
const validResultItem = value => value && typeof value === 'object' && ID(value.outputId) && ID(value.fileId) &&
  VERSION(value.fileVersion) && typeof value.mime === 'string' && value.mime.length > 0 && TEXT(value.filename) &&
  Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 && typeof value.sha256 === 'string' &&
  /^[a-f0-9]{64}$/i.test(value.sha256) && ['AVAILABLE', 'UNAVAILABLE'].includes(value.availability)
const validResults = value => value && typeof value === 'object' && ID(value.executionId) &&
  ['QUEUED', 'INPUTS_REVOKED', 'OUTPUT_COMMITTED', 'FAILED'].includes(value.state) &&
  Array.isArray(value.items) && value.items.every(validResultItem) &&
  Array.isArray(value.allowedActions) && value.allowedActions.every(action => ['VIEW', 'CREATE_REVISION'].includes(action)) &&
  (value.state === 'OUTPUT_COMMITTED'
    ? ID(value.manifestId) && value.items.length > 0 && value.allowedActions.includes('VIEW')
    : value.manifestId == null && value.items.length === 0)
const validCase = value => value && typeof value === 'object' && ID(value.caseId) && TEXT(value.title) &&
  Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.executions) &&
  Array.isArray(value.allowedActions) && value.sourceRef && typeof value.sourceRef === 'object' &&
  value.executions.every(item => item && typeof item === 'object' && Number.isSafeInteger(item.revisionNo) &&
    item.revisionNo >= 1 && validExecution(item.execution))
const normalizedEditable = fields => ({
  title: String(fields?.title || ''),
  instruction: String(fields?.instruction || ''),
  targetAgentId: fields?.targetAgentId === '' || fields?.targetAgentId == null ? null : fields.targetAgentId,
  outputMime: fields?.outputMime === '' || fields?.outputMime == null ? null : fields.outputMime,
  inputs: Array.isArray(fields?.inputs) ? fields.inputs.map(input => ({ fileId: input.fileId, version: input.version })) : []
})
const errorMessage = error => {
  if (error?.name === 'AbortError') return ''
  if (error?.status === 404 && error?.code === 'HALL_RESOURCE_NOT_FOUND') return '尚未查到原交办请求；它仍可能稍后被服务端确认，请继续核对，勿重复交办。'
  if ([401, 403, 404].includes(error?.status)) return '当前身份或事项已不可访问，请返回后重新打开。'
  if (error?.status === 412 || error?.code === 'HALL_DRAFT_REVISION_CHANGED') return '草稿已被更新；本地内容未覆盖，请先重新载入再决定如何处理。'
  if (error?.code === 'HALL_SUBMISSION_KIND_UNAVAILABLE') return '该草稿类型当前不能由聚义厅交办；正式张榜或返工请继续使用原正式入口。'
  if (error?.status === 409) return '交办请求与已有请求不一致，请刷新后核对。'
  if (error?.status === 422) return '所选来源、固定版本或当前交办类型不可用；未创建执行。'
  if (error?.status === 503) return '交办存储暂不可用；请核对原请求，不要重复交办。'
  return error?.message || '交办请求未完成；请核对原请求。'
}
const uncertainFailure = error => error?.name !== 'AbortError' && (error?.status == null || error?.status >= 500)

/** Stores only a scope-isolated key and opaque refs; no editable body is persisted. */
export function createHallSubmissionRecoveryStore ({ storage = globalThis.localStorage || globalThis.window?.localStorage, scopeKey, keyFactory = randomKey } = {}) {
  const scope = () => sameScope(valueOf(scopeKey))
  const browserId = () => {
    if (!storage) return ''
    try {
      const old = storage.getItem(BROWSER_KEY)
      if (ID(old)) return old
      const next = keyFactory()
      if (!ID(next)) return ''
      storage.setItem(BROWSER_KEY, next)
      return storage.getItem(BROWSER_KEY) === next ? next : ''
    } catch { return '' }
  }
  const key = override => {
    const owner = sameScope(override == null ? scope() : override)
    if (!owner) return ''
    const browser = browserId()
    return browser ? `${RECOVERY_PREFIX}.${encodeURIComponent(owner)}.${encodeURIComponent(browser)}` : ''
  }
  const valid = value => value && typeof value === 'object' && ID(value.idempotencyKey) && ID(value.draftId) &&
    (value.ref == null || validRef(value.ref)) && (value.executionId == null || ID(value.executionId)) &&
    (value.uncertain == null || typeof value.uncertain === 'boolean') &&
    (value.kind == null || ['CREATE', 'REVISION', 'TASK_CREATE', 'TASK_ACTION'].includes(value.kind))
  return {
    read () {
      const storageKey = key()
      if (!storageKey || !storage) return null
      try {
        const value = JSON.parse(storage.getItem(storageKey) || 'null')
        return valid(value) ? { idempotencyKey: value.idempotencyKey, draftId: value.draftId, ref: value.ref || null, executionId: value.executionId || null, uncertain: value.uncertain === true, kind: value.kind || null } : null
      } catch { return null }
    },
    save (value) {
      const storageKey = key()
      if (!storageKey || !storage || !valid(value)) return false
      const encoded = JSON.stringify({ idempotencyKey: value.idempotencyKey, draftId: value.draftId, ref: value.ref || null, executionId: value.executionId || null, uncertain: value.uncertain === true, kind: value.kind || null })
      try { storage.setItem(storageKey, encoded); return storage.getItem(storageKey) === encoded } catch { return false }
    },
    clear (override = null) {
      const storageKey = key(override)
      if (!storageKey || !storage) return false
      try { storage.removeItem(storageKey); return true } catch { return false }
    }
  }
}

/** DRAFT-v1 plus frozen submit/reconciliation contracts; unknown POSTs are never replayed. */
export function useHallDrafts ({ agentApi = defaultAgentApi, identityEpoch = 0, identityScope = '', storage = globalThis.localStorage || globalThis.window?.localStorage, keyFactory = randomKey } = {}) {
  const capabilityState = ref('idle')
  const capabilityError = ref('')
  const allowedMimeTypes = ref([])
  const generationEnabled = ref(false)
  const draft = ref(null)
  const state = ref('idle')
  const error = ref('')
  const reloadRequired = ref(false)
  const summaries = ref([])
  const nextCursor = ref(null)
  const receipt = ref(null)
  const submissionState = ref('idle')
  const caseView = ref(null)
  const executionView = ref(null)
  const submissionRecovery = ref(null)
  const unresolvedIntent = ref(null)
  const executionResults = ref(null)
  const resultsState = ref('idle')
  const resultsError = ref('')
  const currentEpoch = computed(() => String(valueOf(identityEpoch) ?? ''))
  const currentScope = computed(() => sameScope(valueOf(identityScope)))
  const recoveryStore = createHallSubmissionRecoveryStore({ storage, scopeKey: currentScope, keyFactory })
  const controllers = new Set()
  let generation = 0
  let disposed = false

  const reset = ({ restoreRecovery = true } = {}) => {
    generation += 1
    for (const controller of controllers) controller.abort(abortError('Hall draft identity changed'))
    controllers.clear()
    capabilityState.value = 'idle'
    capabilityError.value = ''
    allowedMimeTypes.value = []
    generationEnabled.value = false
    draft.value = null
    summaries.value = []
    nextCursor.value = null
    state.value = 'idle'
    error.value = ''
    reloadRequired.value = false
    receipt.value = null
    submissionState.value = 'idle'
    caseView.value = null
    executionView.value = null
    executionResults.value = null
    resultsState.value = 'idle'
    resultsError.value = ''
    submissionRecovery.value = restoreRecovery ? recoveryStore.read() : null
    unresolvedIntent.value = submissionRecovery.value?.uncertain ? submissionRecovery.value : null
  }
  const snapshotNow = () => ({ generation, epoch: currentEpoch.value, scope: currentScope.value })
  const current = (snapshot, controller) => !disposed && snapshot.generation === generation &&
    snapshot.epoch === currentEpoch.value && snapshot.scope === currentScope.value && !controller.signal.aborted
  const request = async (options, snapshot = snapshotNow()) => {
    const controller = new AbortController()
    controllers.add(controller)
    try {
      const response = await agentApi.execute({ ...options, autoLoading: false, needAuth: true, signal: controller.signal })
      if (!current(snapshot, controller)) throw abortError('Hall draft context changed')
      return unwrap(response)
    } finally { controllers.delete(controller) }
  }
  const apply = value => {
    if (!validDraft(value)) throw new Error('草稿回执无效，尚不能显示为已保存。')
    draft.value = value
    state.value = 'ready'
    error.value = ''
    reloadRequired.value = false
    return value
  }
  const loadCapabilities = async () => {
    if (!currentScope.value || capabilityState.value === 'loading') return null
    const snapshot = snapshotNow()
    capabilityState.value = 'loading'
    capabilityError.value = ''
    allowedMimeTypes.value = []
    generationEnabled.value = false
    try {
      const value = await request({ url: '/personal-workspace/executions/capabilities', method: 'GET' }, snapshot)
      if (!validPersonalWorkspaceExecutionCapabilities(value)) throw new Error('执行格式返回无效')
      allowedMimeTypes.value = [...value.allowedMimeTypes]
      generationEnabled.value = value.generationEnabled
      capabilityState.value = value.allowedMimeTypes.length ? 'ready' : 'empty'
      return value
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) {
        capabilityState.value = 'error'
        capabilityError.value = '暂未读到可用交付格式，草稿和原格式仍保留；请重新读取后再交办。'
      }
      return null
    }
  }
  const create = async ({ kind = 'CREATE', originRef = 'juyiting', sourceRef = null, caseId = null, taskId = null, conversationId = null, sourceOutputRef = null, ...editable } = {}) => {
    const fields = normalizedEditable(editable)
    if (!validEditable(fields) || !['CREATE', 'REVISION', 'TASK_CREATE', 'TASK_ACTION'].includes(kind) || !TEXT(originRef)) {
      state.value = 'error'; error.value = hallDraftFieldError(fields) || '草稿内容或固定版本无效，未发起保存。'; return null
    }
    const snapshot = snapshotNow()
    state.value = 'creating'; error.value = ''
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
    if (!editableDraft(currentDraft) || !validEditable(fields)) { state.value = 'error'; error.value = hallDraftFieldError(fields) || '请先保存可编辑的草稿，并检查固定版本。'; return null }
    const snapshot = { ...snapshotNow(), draftId: currentDraft.draftId, revision: currentDraft.revision }
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
    if (cursor != null && (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > MAX_CURSOR_LENGTH)) return false
    const snapshot = snapshotNow()
    state.value = append ? state.value : 'loading'; error.value = ''
    try {
      const page = await request({ url: '/hall/drafts', method: 'GET', params: cursor ? { cursor } : undefined }, snapshot)
      if (!page || !Array.isArray(page.items) || !page.items.every(validSummary) || (page.nextCursor != null && (typeof page.nextCursor !== 'string' || page.nextCursor.length < 1 || page.nextCursor.length > MAX_CURSOR_LENGTH))) throw new Error('可恢复草稿目录返回无效。')
      summaries.value = append ? [...new Map([...summaries.value, ...page.items].map(item => [item.draftId, item])).values()] : page.items
      nextCursor.value = page.nextCursor || null
      state.value = 'ready'
      return true
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { state.value = 'error'; error.value = errorMessage(cause) }
      return false
    }
  }
  const loadMore = () => nextCursor.value ? list({ cursor: nextCursor.value, append: true }) : Promise.resolve(false)
  const load = async draftId => {
    if (!ID(draftId)) return null
    const snapshot = snapshotNow()
    state.value = 'loading'; error.value = ''
    try {
      const value = await request({ url: `/hall/drafts/${encodeURIComponent(draftId)}`, method: 'GET' }, snapshot)
      if (value?.draftId !== draftId) throw new Error('原草稿尚未核对，未用其他草稿代替。')
      return apply(value)
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) { state.value = 'error'; error.value = errorMessage(cause) }
      return null
    }
  }
  const discard = async () => {
    const currentDraft = draft.value
    if (!editableDraft(currentDraft)) return null
    const snapshot = { ...snapshotNow(), draftId: currentDraft.draftId, revision: currentDraft.revision }
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
  const retainUnknown = intent => {
    const stored = recoveryStore.read()
    if (stored && stored.idempotencyKey !== intent.idempotencyKey) {
      submissionRecovery.value = stored
      unresolvedIntent.value = stored.uncertain ? stored : null
      submissionState.value = stored.uncertain ? 'unknown' : 'idle'
      return
    }
    unresolvedIntent.value = { ...intent, uncertain: true }
    recoveryStore.save(unresolvedIntent.value)
    submissionRecovery.value = unresolvedIntent.value
    submissionState.value = 'unknown'
  }
  const releaseRejected = () => {
    recoveryStore.clear()
    submissionRecovery.value = null
    unresolvedIntent.value = null
    submissionState.value = 'idle'
  }
  const applyReceipt = (value, intent) => {
    const kind = intent.kind || (draft.value?.draftId === intent.draftId ? draft.value.kind : null)
    if (!validReceipt(value, kind)) throw new Error('交办回执无效，尚不能显示为已受理。')
    caseView.value = null
    executionView.value = null
    executionResults.value = null
    resultsState.value = 'idle'
    resultsError.value = ''
    receipt.value = value
    submissionState.value = 'acknowledged'
    unresolvedIntent.value = null
    const saved = { idempotencyKey: intent.idempotencyKey, draftId: intent.draftId, ref: value.ref, executionId: value.execution?.executionId || null, uncertain: false, kind }
    const stored = recoveryStore.read()
    if (!stored || stored.idempotencyKey === intent.idempotencyKey) {
      if (recoveryStore.save(saved)) submissionRecovery.value = saved
    } else {
      // A late read of an earlier acknowledged request cannot erase a newer pane's unknown POST.
      submissionRecovery.value = stored
      unresolvedIntent.value = stored.uncertain ? stored : null
      if (stored.uncertain) submissionState.value = 'unknown'
    }
    if (draft.value?.draftId === intent.draftId && editableDraft(draft.value)) {
      draft.value = { ...draft.value, state: 'SUBMITTED', submissionRef: `${value.ref.sourceType}:${value.ref.sourceId}` }
    }
    return value
  }
  const submit = async ({ authorizationAcknowledgement = false } = {}) => {
    const currentDraft = draft.value
    if (!currentScope.value) { error.value = '当前身份隔离标识不可用，未发送交办。'; return null }
    if (!editableDraft(currentDraft) || authorizationAcknowledgement !== true || unresolvedIntent.value || submissionState.value === 'submitting') {
      error.value = unresolvedIntent.value || submissionState.value === 'submitting' ? '原交办结果仍待确认；请核对原请求，勿重复交办。' : '请先保存草稿并明确确认授权。'
      return null
    }
    // Another retained Hall pane can have submitted since this model last read recovery.
    const storedIntent = recoveryStore.read()
    if (storedIntent?.uncertain || storedIntent?.draftId === currentDraft.draftId) {
      submissionRecovery.value = storedIntent
      if (storedIntent.uncertain) retainUnknown(storedIntent)
      error.value = '原交办已有记录；请核对原请求，勿重复交办。'
      return null
    }
    const key = keyFactory()
    const intent = { idempotencyKey: key, draftId: currentDraft.draftId, kind: currentDraft.kind, uncertain: true }
    if (!ID(key) || !recoveryStore.save(intent)) { error.value = '无法安全保存原交办标识，未发送交办。'; return null }
    const snapshot = { ...snapshotNow(), draftId: currentDraft.draftId, revision: currentDraft.revision }
    unresolvedIntent.value = intent; submissionRecovery.value = intent; submissionState.value = 'submitting'; error.value = ''
    try {
      const value = applyReceipt(await request({ url: `/hall/drafts/${encodeURIComponent(snapshot.draftId)}/submit`, method: 'POST', headers: { 'Idempotency-Key': key }, data: { expectedRevision: snapshot.revision, authorizationAcknowledgement: true } }, snapshot), intent)
      if (value.ref.sourceType === 'PRIVATE_CASE') void loadCase(value.ref.sourceId)
      return value
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) {
        if (uncertainFailure(cause)) retainUnknown(intent)
        else releaseRejected()
        error.value = errorMessage(cause)
      }
      return null
    }
  }
  const reconcileSubmission = async () => {
    const intent = recoveryStore.read()
    if (!intent || !currentScope.value) return null
    const snapshot = snapshotNow()
    submissionState.value = 'reconciling'; error.value = ''
    try {
      const value = applyReceipt(await request({ url: '/hall/submissions/request', method: 'GET', headers: { 'Idempotency-Key': intent.idempotencyKey } }, snapshot), intent)
      if (value.ref.sourceType === 'PRIVATE_CASE') void loadCase(value.ref.sourceId)
      return value
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) {
        // A rejected read never proves the earlier POST was rejected. Keep its exact key locked.
        retainUnknown(intent)
        error.value = errorMessage(cause)
      }
      return null
    }
  }
  const loadFormalTask = async () => {
    const ref = receipt.value?.ref
    if (ref?.sourceType !== 'TASK') return null
    const snapshot = snapshotNow()
    state.value = 'loading'
    error.value = ''
    try {
      const task = await request({ url: `/tasks/${encodeURIComponent(ref.sourceId)}`, method: 'GET' }, snapshot)
      if (task?.id !== ref.sourceId || typeof task.status !== 'string') throw new Error('正式事项尚未核对，未用交办回执代替事项详情。')
      state.value = 'ready'
      return task
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) {
        state.value = 'error'
        error.value = errorMessage(cause)
      }
      return null
    }
  }

  const loadResults = async executionId => {
    if (!ID(executionId)) return null
    const snapshot = snapshotNow()
    executionResults.value = null
    resultsState.value = 'loading'
    resultsError.value = ''
    try {
      const value = await request({ url: `/hall/executions/${encodeURIComponent(executionId)}/results`, method: 'GET' }, snapshot)
      if (!validResults(value) || value.executionId !== executionId) throw new Error('成果回执无效，未展示可能不完整的成果。')
      executionResults.value = value
      resultsState.value = value.items.length ? 'ready' : 'empty'
      return value
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) {
        executionResults.value = null
        resultsState.value = 'error'
        resultsError.value = errorMessage(cause)
      }
      return null
    }
  }

  const loadCase = async caseId => {
    if (!ID(caseId)) return null
    const snapshot = snapshotNow()
    caseView.value = null
    error.value = ''
    try {
      const value = await request({ url: `/hall/cases/${encodeURIComponent(caseId)}`, method: 'GET' }, snapshot)
      if (!validCase(value) || value.caseId !== caseId) throw new Error('事项进展回执无效，未展示可能不完整的进展。')
      caseView.value = value
      return value
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) error.value = errorMessage(cause)
      return null
    }
  }

  const loadExecution = async executionId => {
    if (!ID(executionId)) return null
    const snapshot = snapshotNow()
    executionView.value = null
    error.value = ''
    try {
      const value = await request({ url: `/personal-workspace/executions/${encodeURIComponent(executionId)}`, method: 'GET' }, snapshot)
      if (!validExecution(value) || value.executionId !== executionId) throw new Error('原交办进展未能确认，请重新读取。')
      executionView.value = value
      return value
    } catch (cause) {
      if (cause?.name !== 'AbortError' && snapshot.generation === generation) error.value = errorMessage(cause)
      return null
    }
  }

  watch([currentEpoch, currentScope], () => {
    reset()
  }, { immediate: true, flush: 'sync' })
  const unregisterIdentityCleanup = registerIdentityCleanup(() => {
    // Auth expiry rejects a read, not the original POST. Retain only the scope-keyed intent.
    reset({ restoreRecovery: false })
  })
  const dispose = () => { if (!disposed) { disposed = true; unregisterIdentityCleanup(); reset() } }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { capabilityState, capabilityError, allowedMimeTypes, generationEnabled, loadCapabilities, draft, summaries, nextCursor, state, error, reloadRequired, receipt, submissionState, caseView, executionView, submissionRecovery, unresolvedIntent, executionResults, resultsState, resultsError, create, save, list, loadMore, load, discard, submit, reconcileSubmission, loadFormalTask, loadCase, loadExecution, loadResults, reset, dispose }
}
