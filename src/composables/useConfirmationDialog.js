import { nextTick, ref } from 'vue'

export function useConfirmationDialog ({ isBusy = () => false } = {}) {
  const confirming = ref(false)
  const dialog = ref(null)
  const cancelButton = ref(null)
  let returnFocus = null

  const open = async (trigger) => {
    if (confirming.value || isBusy()) return false
    returnFocus = trigger || document.activeElement
    confirming.value = true
    await nextTick()
    cancelButton.value?.focus()
    return true
  }

  const close = ({ force = false } = {}) => {
    if (!confirming.value || (!force && isBusy())) return false
    confirming.value = false
    const focusTarget = returnFocus
    returnFocus = null
    nextTick(() => focusTarget?.focus?.())
    return true
  }

  const onKeydown = event => {
    if (!confirming.value) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(dialog.value?.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) || [])].filter(element => !element.hidden)
    if (!focusable.length) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return { cancelButton, close, confirming, dialog, onKeydown, open }
}
