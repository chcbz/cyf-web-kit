<template>
  <div class="juyi-hall-entry">
    <div ref="juyiHallContainer" class="juyi-hall-background">
      <JuyiHall />
    </div>

    <button ref="reopenTriggerRef" class="onboarding-reopen" type="button" @click="reopen">新手引导</button>
    <HallOnboarding
      v-model="onboardingState.visible"
      :template="templateId"
      :return-focus-target="reopenTriggerRef"
      @later="snooze"
      @skip="skip"
      @complete="complete"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGlobalStore } from '@/stores/global'
import { guestDemoTemplates } from '@/constants/publicBetaDemo'
import JuyiHall from './JuyiHall.vue'
import HallOnboarding from '@/components/juyiting/HallOnboarding.vue'
import {
  consumeGuestDemoTemplateQuery,
  createHallOnboarding,
  hallOnboardingSubject
} from '@/composables/juyiting/useHallOnboarding'

const route = useRoute()
const router = useRouter()
const globalStore = useGlobalStore()
const onboardingState = reactive({ visible: false, status: null, snoozed: false })
const templateId = ref(null)
const juyiHallContainer = ref(null)
const reopenTriggerRef = ref(null)
let onboarding = null

const currentSubject = computed(() => hallOnboardingSubject(globalStore))

const browserStorage = name => {
  try {
    return window[name]
  } catch {
    return null
  }
}

const syncOnboarding = () => {
  onboarding = createHallOnboarding({
    subject: currentSubject.value,
    localStorage: browserStorage('localStorage'),
    sessionStorage: browserStorage('sessionStorage')
  })
  Object.assign(onboardingState, onboarding.snapshot())
}

const updateOnboarding = action => {
  if (!onboarding) syncOnboarding()
  Object.assign(onboardingState, onboarding[action]())
}

const reopen = () => updateOnboarding('open')
const snooze = () => updateOnboarding('snooze')
const skip = () => updateOnboarding('skip')
const complete = () => updateOnboarding('complete')

onMounted(async () => {
  const handoff = consumeGuestDemoTemplateQuery(route.query, guestDemoTemplates)
  templateId.value = handoff.templateId
  try {
    if (handoff.consumed) {
      await router.replace({ path: route.path, query: handoff.query, hash: route.hash })
    }
  } catch {
    // Query cleanup is best effort. Onboarding must still be initialized.
  } finally {
    syncOnboarding()
  }
})

watch(currentSubject, (subject, previousSubject) => {
  if (subject !== previousSubject) syncOnboarding()
})
</script>

<style scoped>
.juyi-hall-entry { position: relative; min-height: 100%; }
.juyi-hall-background { min-height: 100%; }
.onboarding-reopen { position: fixed; right: 16px; bottom: 16px; z-index: 210; min-height: 34px; padding: 0 12px; border: 1px solid rgba(255, 255, 255, 0.55); border-radius: 999px; color: #f6f3e8; font-size: 13px; font-weight: 750; background: rgba(23, 57, 54, 0.78); box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18); cursor: pointer; }
.onboarding-reopen:hover, .onboarding-reopen:focus-visible { background: #285a50; }
</style>
