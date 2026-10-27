import { readFileSync } from 'node:fs'

// Deliberately reuse the real Hall computed and navigation markup. A fixture with an
// always-visible dock cannot detect onboarding being classified as a business modal.
export const buildNavigationHostSource = () => {
  const source = readFileSync(new URL('../../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
  const computed = source.match(/const navigationPresentation = computed\([\s\S]*?\nconst hallRootRef/)[0].replace(/\nconst hallRootRef$/, '')
  const sidebar = source.match(/    <aside v-show="isOverviewHome"[\s\S]*?<\/aside>/)[0]
  const dock = source.match(/    <nav v-show="showWorkbenchDock[^\n]+\n[\s\S]*?<\/nav>/)[0]
  const root = source.match(/  <div ref="hallRootRef"[^\n]+/)[0]
  return `<template>${root}${sidebar}<form data-tour="workbench-request" @submit.prevent><textarea aria-label="需求"></textarea><button>开始办事</button></form>${dock}</div></template>
<script setup>
import { computed, ref } from 'vue'
import { resolveHallNavigationPresentation } from '../../src/composables/juyiting/useHallPanels.js'
const props = defineProps({ onboardingVisible: Boolean })
const emit = defineEmits(['open-onboarding', 'navigate'])
const isMobileCoarse = ref(true), experienceMode = ref('landscape-map'), isOverviewHome = ref(true)
const renderedPanel = ref(''), activePanel = ref(''), panelReturnPanel = ref(''), formalTaskRef = ref(null)
const bountyPanelRef = ref(null), treasurePanelRef = ref(null), libraryPanelRef = ref(null)
const portraitTaskDetailOpen = ref(false), hallKeyboardActive = ref(false)
const activeDraftEditor = () => null
const voiceInteractionLocked = ref(false), isPanelSessionActive = computed(() => Boolean(renderedPanel.value))
const workbenchPrimaryPanelSet = new Set(['tasks','treasure','mine'])
const workbenchMobileTabs = [{panel:'overview',label:'办事'}, {panel:'tasks',label:'事项'}, {panel:'treasure',label:'资料'}, {panel:'mine',label:'我的'}]
const workbenchPrimaryTabs = workbenchMobileTabs, workbenchCurrentPage = ref('overview')
const openWorkbenchPage = panel => emit('navigate', panel), openWorkbenchMap = () => emit('navigate','map'), openProfile = () => emit('navigate','profile')
const accountEntryDisabled = ref(false), accountAvatar = '', accountDisplayName = '测试用户'
const hallRootRef = ref(null), hallViewportStyle = {}, isImmersiveMap = ref(false), isVirtualLandscape = ref(false), homeMode = ref('overview')
${computed}
defineExpose({ renderedPanel, activePanel, hallKeyboardActive, bountyPanelRef, formalTaskRef, panelReturnPanel, isOverviewHome, navigationPresentation })
</script>`
}
