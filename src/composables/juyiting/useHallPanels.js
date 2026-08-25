import { computed, unref } from 'vue'

export const classifyPanelLayout = ({ isMobileCoarse, experienceMode }) => {
  if (!isMobileCoarse) return 'center-modal'
  return experienceMode === 'landscape-map' ? 'right-drawer' : 'bottom-drawer'
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

export const useHallPanels = ({ experienceMode, isMobileCoarse }) => ({
  panelLayout: computed(() => classifyPanelLayout({
    experienceMode: unref(experienceMode),
    isMobileCoarse: unref(isMobileCoarse)
  }))
})
