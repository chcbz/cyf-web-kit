import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { useHallBountyFinalization } from './useHallBountyFinalization.js'
import { batchMatchesSelection, selectedOutput, selectionKey } from './hallSelectedOutputs.js'
const read = value => typeof value === 'function' ? value() : unref(value)

/** Both UI entries share one frozen selection and the existing submission/review operations. */
export function useHallSelectedOutputReview ({ api, review, taskId, conversationId, identityKey, authorizationGeneration = 0, candidates }) {
  const finalization = useHallBountyFinalization({ api, taskId, conversationId, identityKey, authorizationGeneration })
  const open = ref(false); const busy = ref(false); const error = ref(''); const selectedKeys = ref([]); const snapshot = ref(null)
  const available = ref([]); let epoch = 0
  const locked = computed(() => !!finalization.status.value.intent)
  const choices = computed(() => locked.value ? finalization.status.value.intent.body.selectedOutputs.map(item => ({ ...item,
    ...(read(candidates) || []).find(candidate => selectionKey(candidate) === selectionKey(item)) })) : available.value)
  const selected = computed(() => locked.value ? finalization.status.value.intent.body.selectedOutputs : choices.value.filter(item => selectedKeys.value.includes(selectionKey(item))).map(selectedOutput))
  const message = computed(() => error.value || finalization.status.value.message)
  const show = async item => {
    if (busy.value) return
    const version = epoch; error.value = ''
    const context = await review.refresh()
    if (version !== epoch || !context) { if (version === epoch) error.value = review.error.value; return }
    if (['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(context.taskState)) return
    snapshot.value = context
    available.value = (read(candidates) || []).map(candidate => ({ ...candidate }))
    selectedKeys.value = item ? [selectionKey(item)] : []
    open.value = true
  }
  const toggle = key => {
    if (busy.value || locked.value) return
    selectedKeys.value = selectedKeys.value.includes(key) ? selectedKeys.value.filter(value => value !== key) : [...selectedKeys.value, key]
  }
  const close = () => { if (!busy.value) { open.value = false; error.value = ''; review.close() } }
  const confirm = async () => {
    if (busy.value || !open.value || !selected.value.length || !snapshot.value) return
    const version = epoch; const set = selected.value.map(item => ({ ...item })); const initial = snapshot.value
    busy.value = true; error.value = ''
    try {
      let deliveryId = null
      if (!locked.value && batchMatchesSelection(initial.currentDelivery, set)) deliveryId = initial.currentDelivery.deliveryId
      else {
        const receipt = locked.value ? await finalization.resume() : await finalization.submit({ taskId: read(taskId), body: {
          expectedTaskVersion: initial.taskVersion, expectedAssignmentRevision: initial.assignmentRevision,
          conversationId: read(conversationId), summary: `验收用户选定的 ${set.length} 项成果`, selectedOutputs: set } })
        if (version !== epoch) return
        if (!receipt || receipt.state !== 'COMPLETED' || receipt.stage !== 'SUBMITTED') return
        deliveryId = receipt.deliveryId
      }
      if (version !== epoch) return
      // Never accept whichever batch happens to be current after the submission.
      if (!await review.openConfirmation({ deliveryId, selectedOutputs: set, assignmentRevision: initial.assignmentRevision })) {
        error.value = review.error.value || '交付状态已变化，请核对结果后再验收。'; return
      }
      if (version !== epoch) return
      const receipt = await review.confirmAcceptance()
      if (version !== epoch) return
      if (receipt?.state === 'COMMITTED') open.value = false
      else error.value = review.operation.value.message || review.error.value || '尚未确认验收成功，请核对原验收操作。'
    } catch (cause) { if (version === epoch) error.value = cause.message || '验收未完成，请核对结果。' }
    finally { if (version === epoch) busy.value = false }
  }
  const stop = watch(() => [read(taskId), read(conversationId), read(identityKey), read(authorizationGeneration)], () => {
    epoch++; open.value = false; busy.value = false; error.value = ''; selectedKeys.value = []; available.value = []; snapshot.value = null
  }, { flush: 'sync' })
  const dispose = () => { epoch++; stop(); finalization.dispose() }
  if (getCurrentInstance()) onBeforeUnmount(dispose)
  return { open, busy, error, message, choices, selected, selectedKeys, locked, finalization, show, toggle, close, confirm, dispose }
}
