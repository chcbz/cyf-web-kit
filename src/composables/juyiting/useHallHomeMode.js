import { computed, ref } from 'vue'

export const HALL_HOME_MODES = Object.freeze(['map', 'overview'])

export const normalizeHallHomeMode = mode => HALL_HOME_MODES.includes(mode) ? mode : 'map'

// Home content preference is deliberately independent from physical/presented
// orientation. It owns no viewport listeners, engine lifecycle, or panel state.
export const useHallHomeMode = (initialMode = 'overview') => {
  const homeMode = ref(normalizeHallHomeMode(initialMode))
  const isMapHome = computed(() => homeMode.value === 'map')
  const isOverviewHome = computed(() => homeMode.value === 'overview')

  const setHomeMode = mode => {
    const next = normalizeHallHomeMode(mode)
    if (next === homeMode.value) return false
    homeMode.value = next
    return true
  }

  return { homeMode, isMapHome, isOverviewHome, setHomeMode }
}
