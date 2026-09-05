<template>
  <div class="juyi-hall-entry">
    <div ref="juyiHallContainer" class="juyi-hall-background">
      <JuyiHall @open-onboarding="reopen" />
    </div>

    <HallOnboarding
      v-model="onboardingState.visible"
      :template="templateId"
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
.juyi-hall-entry { position: relative; height: 100%; min-height: 100%; }
.juyi-hall-background { height: 100%; min-height: 100%; }
</style>
