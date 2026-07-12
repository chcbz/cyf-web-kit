import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export const classifyPanelLayout = ({ width, height, coarsePointer }) => {
  if (!coarsePointer && width >= 1024) return 'center-modal'
  return width > height ? 'right-drawer' : 'bottom-drawer'
}

export const useHallPanels = () => {
  const viewport = ref({ width: 0, height: 0, coarsePointer: false })

  const updateViewport = () => {
    viewport.value = {
      width: window.innerWidth,
      height: window.innerHeight,
      coarsePointer: Boolean(window.matchMedia?.('(pointer: coarse)').matches)
    }
  }

  onMounted(() => {
    updateViewport()
    window.addEventListener('resize', updateViewport)
  })
  onBeforeUnmount(() => window.removeEventListener('resize', updateViewport))

  return {
    panelLayout: computed(() => classifyPanelLayout(viewport.value)),
    updatePanelLayout: updateViewport
  }
}
