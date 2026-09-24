import { computed, ref, unref, watch } from 'vue'
import { useHallDrafts } from './useHallDrafts.js'

const valueOf = value => typeof value === 'function' ? value() : unref(value)
const clean = value => [...String(value || '')].filter(char => { const code = char.codePointAt(0); return !(code < 32 && !['\n', '\r', '\t'].includes(char)) && !(code >= 127 && code <= 159) }).join('').trim()
const titleFor = request => {
  const line = clean(request).split(/\r?\n/, 1)[0].replace(/^[，。！？、；：,.!?;:\s]+|[，。！？、；：,.!?;:\s]+$/g, '')
  return [...(line || '新事项')].slice(0, 30).join('')
}

/** One-sentence TASK_CREATE adapter. Creating the task never creates an execution. */
export function useHallQuickMatter (options = {}) {
  const drafts = useHallDrafts(options)
  const state = ref('idle')
  const message = ref('')
  const requestText = ref('')
  const busy = computed(() => ['creating', 'submitting', 'loading'].includes(state.value))

  const submit = async raw => {
    const request = clean(raw)
    if (!request) { message.value = '请先说一句想办成什么事。'; state.value = 'error'; return null }
    if ([...request].length > 200) { message.value = '一句话需求最多 200 字，请先精简后再提交。'; state.value = 'error'; return null }
    if (busy.value) { message.value = '正在创建事项，请稍候。'; return null }
    if (drafts.unresolvedIntent.value) return reconcile()
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
    if (!draft) { state.value = 'error'; message.value = drafts.error.value || '事项草稿未创建，请核对后重试。'; return null }
    state.value = 'submitting'
    const receipt = await drafts.submit({ authorizationAcknowledgement: true })
    if (!receipt) {
      state.value = drafts.unresolvedIntent.value ? 'unknown' : 'error'
      message.value = drafts.error.value || '事项创建结果尚未确认，请勿重复提交。'
      return null
    }
    state.value = 'loading'
    const task = await drafts.loadFormalTask()
    if (!task) { state.value = 'error'; message.value = drafts.error.value || '事项已创建，但详情暂未读取，请到“事项”中继续。'; return null }
    state.value = 'ready'
    message.value = '事项已建立；尚未调用 Agent。'
    return { task, receipt, request }
  }

  const reconcile = async () => {
    if (!drafts.unresolvedIntent.value) return null
    state.value = 'loading'; message.value = '正在核对原创建请求…'
    const receipt = await drafts.reconcileSubmission()
    if (!receipt) { state.value = 'unknown'; message.value = drafts.error.value || '原创建请求仍待核对，请勿重复提交。'; return null }
    const task = await drafts.loadFormalTask()
    if (!task) { state.value = 'error'; message.value = drafts.error.value || '事项已创建，但详情暂未读取。'; return null }
    state.value = 'ready'; message.value = '已核对原事项；尚未调用 Agent。'
    return { task, receipt, request: requestText.value }
  }


  watch(() => `${String(valueOf(options.identityEpoch) ?? '')}\u0000${String(valueOf(options.identityScope) ?? '')}`, () => {
    state.value = drafts.unresolvedIntent.value ? 'unknown' : 'idle'
    message.value = drafts.unresolvedIntent.value ? '上次事项创建结果待核对；再次点击只会查询原请求，不会重复创建。' : ''
    requestText.value = ''
  }, { immediate: true, flush: 'sync' })

  return { drafts, state, message, requestText, busy, submit, reconcile }
}
