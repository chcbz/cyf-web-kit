import { computed, onBeforeUnmount, reactive, ref, unref, watch } from 'vue'

// One adapter for the existing help-center feedback contract. No automatic retry:
// the endpoint has no operation-query/idempotency contract for uncertain writes.
export const useHelpFeedback = ({ post, subject, identity }) => {
  const form = reactive({ title: '', content: '', name: '', phone: '', email: '' })
  const submitting = ref(false)
  const status = ref('idle')
  const error = ref('')
  let generation = 0
  let controller = null
  const resetForm = () => { for (const key of Object.keys(form)) form[key] = '' }
  const invalidate = () => {
    generation++
    controller?.abort()
    controller = null
    submitting.value = false
    status.value = 'idle'
    error.value = ''
    resetForm()
  }
  watch([() => unref(subject), () => unref(identity)], invalidate, { flush: 'sync' })
  onBeforeUnmount(invalidate)
  const canSubmit = computed(() => Boolean(form.title.trim() && form.content.trim() && !submitting.value && status.value !== 'unknown'))
  const submit = async () => {
    if (!canSubmit.value) return false
    const current = ++generation
    submitting.value = true
    status.value = 'submitting'
    error.value = ''
    controller = new AbortController()
    const payload = new FormData()
    payload.append('resourceId', 'help-center')
    payload.append('jiacn', unref(subject) || '')
    for (const [key, value] of Object.entries(form)) payload.append(key, value.trim())
    try {
      await post('/message/create', payload, { autoLoading: false, signal: controller.signal })
      if (current !== generation) return false
      resetForm()
      status.value = 'success'
      return true
    } catch (failure) {
      if (current !== generation) return false
      const httpStatus = Number(failure?.status ?? failure?.response?.status)
      // 4xx is an explicit rejection; transport/5xx may follow a committed write.
      status.value = httpStatus >= 400 && httpStatus < 500 ? 'failed' : 'unknown'
      error.value = status.value === 'unknown'
        ? '提交结果暂未确认，内容已保留。请勿重复提交；可稍后通过客服核对。'
        : '反馈未被受理，内容已保留。请核对填写内容及登录状态后再试。'
      return false
    } finally {
      if (current === generation) { submitting.value = false; controller = null }
    }
  }
  return { form, submitting, status, error, canSubmit, submit }
}
