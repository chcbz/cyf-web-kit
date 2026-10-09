import { computed, ref, unref, watch } from 'vue'
import { usePersonalWorkspaceTaskLinks } from '../usePersonalWorkspaceTaskLinks.js'
import { useHallDrafts } from './useHallDrafts.js'

const valueOf = value => typeof value === 'function' ? value() : unref(value)
const clean = value => [...String(value || '')].filter(char => { const code = char.codePointAt(0); return !(code < 32 && !['\n', '\r', '\t'].includes(char)) && !(code >= 127 && code <= 159) }).join('').trim()
const titleFor = request => {
  const line = clean(request).split(/\r?\n/, 1)[0].replace(/^[，。！？、；：,.!?;:\s]+|[，。！？、；：,.!?;:\s]+$/g, '')
  return [...(line || '新事项')].slice(0, 30).join('')
}
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && value === value.trim() &&
  ![...value].some(char => char.codePointAt(0) < 32)
const normalizeMaterials = values => {
  if (!Array.isArray(values)) return []
  const normalized = []
  const seen = new Set()
  for (const value of values) {
    const fileId = String(value?.fileId || '')
    const version = Number(value?.version)
    const role = value?.role === 'REFERENCE' ? 'REFERENCE' : value?.role === 'INPUT' ? 'INPUT' : ''
    if (!validId(fileId) || !Number.isSafeInteger(version) || version < 1 || version > 2147483647 || !role) continue
    const key = `${fileId}\u0000${version}\u0000${role}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({
      fileId,
      version,
      role,
      displayName: clean(value?.displayName).slice(0, 255) || `资料 ${fileId}`
    })
  }
  return normalized
}

/** One-sentence TASK_CREATE adapter. Creating or linking the task never creates an execution. */
export function useHallQuickMatter (options = {}) {
  const drafts = useHallDrafts(options)
  const state = ref('idle')
  const message = ref('')
  const requestText = ref('')
  const linkTaskId = ref('')
  const pendingMaterials = ref([])
  const identityKey = () => `${String(valueOf(options.identityEpoch) ?? '')}\u0000${String(valueOf(options.identityScope) ?? '')}`
  const materialLinks = usePersonalWorkspaceTaskLinks({
    api: options.agentApi,
    taskId: linkTaskId,
    identityEpoch: identityKey
  })
  const busy = computed(() => ['creating', 'submitting', 'loading', 'linking'].includes(state.value))

  const linkMaterials = async (task, values, operationIdentity) => {
    const materials = normalizeMaterials(values)
    const results = []
    if (!materials.length) return results
    if (!validId(task?.id) || identityKey() !== operationIdentity) return null
    linkTaskId.value = task.id
    state.value = 'linking'
    for (const material of materials) {
      if (identityKey() !== operationIdentity || linkTaskId.value !== task.id) return null
      const saved = await materialLinks.attach(material)
      if (identityKey() !== operationIdentity || linkTaskId.value !== task.id) return null
      results.push({
        ...material,
        ok: Boolean(saved),
        relationId: saved?.relationId || '',
        error: saved ? '' : (materialLinks.error.value || '任务已建立，但这份资料尚未确认关联。')
      })
    }
    return results
  }

  const successMessage = materialResults => {
    const linked = materialResults.filter(item => item.ok).length
    const failed = materialResults.length - linked
    if (failed) return `事项已建立；已关联 ${linked} 份固定版本资料，${failed} 份未关联，请在事项详情核对后重试。尚未开始执行。`
    if (linked) return `事项已建立，已关联 ${linked} 份固定版本资料。下一步可选择承办好汉，再进入议事并明确开始办理；尚未开始执行。`
    return '事项已建立。下一步可选择承办好汉，或先在事项详情补充资料，再进入议事；尚未开始执行。'
  }

  const finishTask = async ({ task, receipt, request, materials, operationIdentity }) => {
    const materialResults = await linkMaterials(task, materials, operationIdentity)
    if (materialResults == null || identityKey() !== operationIdentity) return null
    state.value = 'ready'
    message.value = successMessage(materialResults)
    pendingMaterials.value = []
    return {
      task,
      receipt,
      request,
      materialResults,
      linkedMaterials: materialResults.filter(item => item.ok),
      failedMaterials: materialResults.filter(item => !item.ok)
    }
  }

  const submit = async (raw, selectedMaterials = []) => {
    const payload = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { request: raw, materials: selectedMaterials }
    const request = clean(payload.request)
    const materials = normalizeMaterials(payload.materials)
    if (!request) { message.value = '请先说一句想办成什么事。'; state.value = 'error'; return null }
    if ([...request].length > 200) { message.value = '一句话需求最多 200 字，请先精简后再提交。'; state.value = 'error'; return null }
    if (busy.value) { message.value = '正在创建事项，请稍候。'; return null }
    if (drafts.unresolvedIntent.value) {
      if (materials.length) pendingMaterials.value = materials
      return reconcile()
    }
    const operationIdentity = identityKey()
    pendingMaterials.value = materials
    requestText.value = request
    message.value = ''
    state.value = 'creating'
    const draft = await drafts.create({
      kind: 'TASK_CREATE',
      originRef: 'juyiting-conversation-v4',
      title: titleFor(request),
      instruction: request,
      targetAgentId: null,
      outputMime: null,
      inputs: []
    })
    if (identityKey() !== operationIdentity) return null
    if (!draft) { state.value = 'error'; message.value = drafts.error.value || '事项草稿未创建，请核对后重试。'; return null }
    state.value = 'submitting'
    const receipt = await drafts.submit({ authorizationAcknowledgement: true })
    if (identityKey() !== operationIdentity) return null
    if (!receipt) {
      state.value = drafts.unresolvedIntent.value ? 'unknown' : 'error'
      message.value = drafts.error.value || '事项创建结果尚未确认，请勿重复提交。'
      return null
    }
    state.value = 'loading'
    const task = await drafts.loadFormalTask()
    if (identityKey() !== operationIdentity) return null
    if (!task) { state.value = 'error'; message.value = drafts.error.value || '事项已创建，但详情暂未读取，请到“事项”中继续。'; return null }
    return finishTask({ task, receipt, request, materials: pendingMaterials.value, operationIdentity })
  }

  const reconcile = async () => {
    if (!drafts.unresolvedIntent.value) return null
    const operationIdentity = identityKey()
    state.value = 'loading'; message.value = '正在核对原创建请求…'
    const receipt = await drafts.reconcileSubmission()
    if (identityKey() !== operationIdentity) return null
    if (!receipt) { state.value = 'unknown'; message.value = drafts.error.value || '原创建请求仍待核对，请勿重复提交。'; return null }
    const task = await drafts.loadFormalTask()
    if (identityKey() !== operationIdentity) return null
    if (!task) { state.value = 'error'; message.value = drafts.error.value || '事项已创建，但详情暂未读取。'; return null }
    return finishTask({ task, receipt, request: requestText.value, materials: pendingMaterials.value, operationIdentity })
  }

  watch(identityKey, () => {
    state.value = drafts.unresolvedIntent.value ? 'unknown' : 'idle'
    message.value = drafts.unresolvedIntent.value ? '上次事项创建结果待核对；再次点击只会查询原请求，不会重复创建。' : ''
    requestText.value = ''
    linkTaskId.value = ''
    pendingMaterials.value = []
  }, { immediate: true, flush: 'sync' })

  return { drafts, materialLinks, state, message, requestText, busy, submit, reconcile }
}
