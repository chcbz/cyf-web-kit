import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export const classifyPanelLayout = ({ width, height, coarsePointer, orientationLandscape }) => {
  if (!coarsePointer && width >= 1024) return 'center-modal'
  return (typeof orientationLandscape === 'boolean' ? orientationLandscape : width > height)
    ? 'right-drawer'
    : 'bottom-drawer'
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

export const panelFocusableElements = panel => panel
  ? [...panel.querySelectorAll(FOCUSABLE_SELECTOR)].filter(element => !element.hidden)
  : []

export const focusHallPanel = panel => {
  if (!panel) return
  const focusable = panelFocusableElements(panel)
  ;(focusable[0] || panel).focus?.()
}

export const restorePanelFocus = element => {
  if (element?.isConnected) element.focus?.()
}

export const trapPanelFocus = (event, panel) => {
  if (event.key !== 'Tab' || !panel) return false
  const focusable = panelFocusableElements(panel)
  if (!focusable.length) {
    event.preventDefault()
    panel.focus?.()
    return true
  }
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
    return true
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
    return true
  }
  return false
}

export const useHallPanels = () => {
  const viewport = ref({ width: 0, height: 0, coarsePointer: false })
  let orientationMedia = null
  let coarseMedia = null

  const updateViewport = () => {
    viewport.value = {
      width: window.innerWidth,
      height: window.innerHeight,
      coarsePointer: Boolean(coarseMedia?.matches),
      orientationLandscape: typeof orientationMedia?.matches === 'boolean'
        ? orientationMedia.matches
        : window.innerWidth > window.innerHeight
    }
  }

  onMounted(() => {
    orientationMedia = window.matchMedia?.('(orientation: landscape)') || null
    coarseMedia = window.matchMedia?.('(pointer: coarse)') || null
    updateViewport()
    window.addEventListener('resize', updateViewport)
    orientationMedia?.addEventListener?.('change', updateViewport)
    coarseMedia?.addEventListener?.('change', updateViewport)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', updateViewport)
    orientationMedia?.removeEventListener?.('change', updateViewport)
    coarseMedia?.removeEventListener?.('change', updateViewport)
  })

  return {
    panelLayout: computed(() => classifyPanelLayout(viewport.value)),
    updatePanelLayout: updateViewport
  }
}
