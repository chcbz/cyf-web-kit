import { computed, unref } from 'vue'

// Reuse the existing workspace compact-height breakpoint. A03 measured 390px
// with a fine pointer: pointer type must not force the 164px + 48px modal gutters.
export const classifyPanelLayout = ({ isMobileCoarse, viewportHeight = 0 }) => {
  const compactHeight = viewportHeight > 0 && viewportHeight <= 500
  return isMobileCoarse || compactHeight ? 'full-window' : 'center-modal'
}

const RETURN_ACTIONS = new Set(['agents', 'tasks', 'discussion', 'catalog', 'library'])
const PANEL_RETURN_ACTIONS = Object.freeze({
  agents: 'agents',
  tasks: 'tasks',
  workspace: 'tasks',
  chat: 'discussion',
  catalog: 'catalog',
  library: 'library'
})
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

const hasHiddenAncestor = element => Boolean(element?.closest?.('[hidden]'))
const hasBlockedAncestor = element => Boolean(element?.closest?.('[inert], [aria-hidden="true"]'))
const hasVisibleStyle = element => {
  const getStyle = element?.ownerDocument?.defaultView?.getComputedStyle
  if (!getStyle) return true
  let current = element
  while (current) {
    const style = getStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    current = current.parentElement
  }
  return true
}

const isProgrammaticallyFocusable = element => element?.tabIndex >= 0 || element?.hasAttribute?.('tabindex')

export const isSafePanelFocusTarget = element => Boolean(
  element?.isConnected &&
  element !== element?.ownerDocument?.body &&
  element !== element?.ownerDocument?.documentElement &&
  typeof element.focus === 'function' &&
  isProgrammaticallyFocusable(element) &&
  !element.disabled &&
  !element.hidden &&
  !hasHiddenAncestor(element) &&
  !hasBlockedAncestor(element) &&
  hasVisibleStyle(element)
)

export const isPanelTabbable = element => Boolean(
  isSafePanelFocusTarget(element) &&
  element.tabIndex >= 0
)

export const panelFocusableElements = panel => panel
  ? [...panel.querySelectorAll(FOCUSABLE_SELECTOR)].filter(isPanelTabbable)
  : []

export const focusHallPanel = panel => {
  if (!panel) return
  const focusable = panelFocusableElements(panel)
  ;(focusable[0] || panel).focus?.()
}

export const panelReturnAction = panel => PANEL_RETURN_ACTIONS[panel] || null

export const capturePanelReturnTarget = (element, panel) => {
  const domAction = element?.closest?.('[data-portrait-action]')?.getAttribute('data-portrait-action')
  const logicalAction = RETURN_ACTIONS.has(domAction) ? domAction : panelReturnAction(panel)
  return Object.freeze({
    originalElement: element || null,
    logicalAction: RETURN_ACTIONS.has(logicalAction) ? logicalAction : null
  })
}

const findLogicalTarget = (root, logicalAction) => logicalAction
  ? [...(root?.querySelectorAll?.('[data-portrait-action]') || [])]
    .find(element => element.getAttribute('data-portrait-action') === logicalAction && isSafePanelFocusTarget(element))
  : null

export const resolvePanelReturnTarget = ({ origin, root }) => {
  if (isSafePanelFocusTarget(origin?.originalElement)) return origin.originalElement
  const logicalTarget = findLogicalTarget(root, origin?.logicalAction)
  if (logicalTarget) return logicalTarget
  const hallBoard = root?.querySelector?.('.hall-board')
  if (isSafePanelFocusTarget(hallBoard)) return hallBoard
  return isSafePanelFocusTarget(root) ? root : null
}

export const restorePanelFocus = element => {
  if (isSafePanelFocusTarget(element)) element.focus()
}

export const isCurrentPanelGeneration = ({ leavingGeneration, closingGeneration, sessionGeneration, activePanel, disposed }) =>
  !disposed &&
  Number.isSafeInteger(leavingGeneration) &&
  leavingGeneration > 0 &&
  leavingGeneration === closingGeneration &&
  leavingGeneration === sessionGeneration &&
  !activePanel

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

export const useHallPanels = ({ experienceMode, isMobileCoarse, viewportHeight }) => ({
  panelLayout: computed(() => classifyPanelLayout({
    experienceMode: unref(experienceMode),
    isMobileCoarse: unref(isMobileCoarse),
    viewportHeight: unref(viewportHeight)
  }))
})

// Presentation-only chrome resolver. It deliberately receives values rather
// than refs so it cannot mutate frame, draft, reader, task, or workspace state.
export const resolveHallNavigationPresentation = ({
  isMobileCoarse = false,
  experienceMode = '',
  isOverviewHome = false,
  renderedPanel = '',
  panelReturnPanel = '',
  formalTaskRef = null,
  draftCanGoBack = false,
  bountyCanGoBack = false,
  treasureCanGoBack = false,
  libraryCanGoBack = false,
  portraitTaskDetailOpen = false,
  isKeyboardActive = false
} = {}) => {
  const isPortraitMobile = Boolean(isMobileCoarse && experienceMode === 'portrait-command')
  const isPrimarySurface = Boolean(isOverviewHome && (!renderedPanel || ['tasks', 'treasure', 'mine'].includes(renderedPanel)))
  const hasFrameParent = Boolean(panelReturnPanel)
  const selfOwnedDetail = Boolean(
    (['draft', 'item', 'formalDraft'].includes(renderedPanel) && draftCanGoBack) ||
    (renderedPanel === 'tasks' && bountyCanGoBack) ||
    (renderedPanel === 'library' && libraryCanGoBack) ||
    portraitTaskDetailOpen
  )
  const hallOwnedDetail = Boolean(
    (renderedPanel === 'tasks' && formalTaskRef) ||
    (renderedPanel === 'treasure' && treasureCanGoBack) ||
    renderedPanel === 'workspace' ||
    (!selfOwnedDetail && hasFrameParent)
  )
  const hasChildDetail = selfOwnedDetail || hallOwnedDetail
  const returnOwner = selfOwnedDetail ? 'self' : (hallOwnedDetail ? 'hall' : 'none')
  const showWorkbenchDock = Boolean(
    isOverviewHome && isPrimarySurface && !hasChildDetail && !hasFrameParent && !isKeyboardActive
  )
  const showHallReturn = returnOwner === 'hall'
  // Root workbench pages remain regions, not closeable dialogs. On mobile the
  // single leading action is either return or close, never both.
  const showHallClose = Boolean(!isPrimarySurface && (!hasChildDetail || !isPortraitMobile))
  const showPrimaryChildHeader = Boolean(isPrimarySurface && showHallReturn)

  return Object.freeze({
    isPortraitMobile,
    isPrimarySurface,
    hasChildDetail,
    hasFrameParent,
    returnOwner,
    showWorkbenchDock,
    showHallReturn,
    showHallClose,
    showPrimaryChildHeader
  })
}
