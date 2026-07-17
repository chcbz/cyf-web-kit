<template>
  <div>
    <!-- 蒙层 -->
    <div v-if="showSideMenu && isMobile" class="menu-overlay" @click="handleOverlayClick"></div>

    <var-menu
      v-model="showSideMenu"
      :placement="menuPlacement"
      :offset-x="menuOffsetX"
      :offset-y="menuOffsetY"
    >
      <template #default>
        <div class="side-menu" :data-show="showSideMenu">
          <div class="menu-header">
            <div style="display: flex; align-items: center">
              <var-icon name="chevron-left" class="close-icon" @click="close" />
            </div>
          </div>

          <div class="menu-items">
            <router-link
              v-for="route in menuRoutes"
              :key="route.path"
              :to="route.path"
              class="menu-item"
              :style="menuItemStyle(route)"
              @click="close"
            >
              <span class="menu-icon-wrap">
                <var-icon :name="route.meta.icon || 'menu'" />
              </span>
              <span>{{ $t(route.meta.title) }}</span>
              <span
                v-if="route.name === 'MessageCenter' && messageStore.unreadTotal"
                class="menu-badge"
              >
                {{ formatUnreadTotal(messageStore.unreadTotal) }}
              </span>
            </router-link>
          </div>
        </div>
      </template>
    </var-menu>
  </div>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWindowSize } from '@vueuse/core'
import { useGlobalStore } from '@/stores/global'
import { useMessageStore } from '@/stores/message'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'close'])

const router = useRouter()
const { width } = useWindowSize()
const globalStore = useGlobalStore()
const messageStore = useMessageStore()

const isMobile = computed(() => width.value < 768)
const menuPlacement = computed(() => (isMobile.value ? 'bottom' : 'right'))
const menuOffsetX = computed(() => (isMobile.value ? 0 : -16))
const menuOffsetY = computed(() => (isMobile.value ? 0 : 56))
const personalMenuRouteNames = new Set(['UserProfile', 'MessageCenter', 'HelpCenter'])

const menuRoutes = computed(() => {
  return router
    .getRoutes()
    .filter(
      (route) =>
        route.meta?.title &&
        route.meta?.showInMenu !== false &&
        personalMenuRouteNames.has(route.name)
    )
    .sort((a, b) => {
      const orderA = a.meta?.menuOrder ?? 999
      const orderB = b.meta?.menuOrder ?? 999
      return orderA - orderB
    })
})

const menuItemStyle = (route) => ({
  '--menu-icon-color': route.meta?.iconColor || '#475569'
})

const close = () => {
  globalStore.toggleSideMenu()
  emit('update:modelValue', false)
  emit('close')
}

const handleOverlayClick = (event) => {
  // 确保点击的是蒙层本身，而不是子元素
  if (event.target.classList.contains('menu-overlay')) {
    close()
  }
}

const formatUnreadTotal = (total) => total > 99 ? '99+' : total

watch(
  () => props.modelValue,
  (newVal) => {
    globalStore.showSideMenu = newVal
    if (!newVal) {
      emit('close')
    }
  }
)

const showSideMenu = computed({
  get() {
    return globalStore.showSideMenu
  },
  set(value) {
    globalStore.showSideMenu = value
  }
})

onMounted(() => {
  messageStore.fetchUnreadTotal()
})
</script>

<style scoped>
.menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.5);
  z-index: 999;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.side-menu {
  width: 250px;
  height: 100vh;
  background: linear-gradient(180deg, #fffdf8 0%, var(--color-body) 100%);
  box-shadow: 0 10px 30px rgba(35, 28, 20, 0.14);
  transform: translateX(-100%);
  transition: transform 0.3s ease;
  position: fixed;
  top: 0;
  z-index: 1000;
}

.side-menu[data-show='true'] {
  transform: translateX(0);
}

.menu-header {
  padding: 16px 16px 8px;
  display: flex;
  justify-content: flex-end;
}

.close-icon {
  font-size: 24px;
  cursor: pointer;
  margin-right: 8px;
}

.collapse-text {
  font-size: 14px;
  color: var(--color-text);
}

.menu-items {
  padding: 8px 10px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 8px 10px;
  color: var(--color-text);
  text-decoration: none;
  transition: all 0.2s ease;
  border-radius: 8px;
  margin: 0 0 8px;
}

.menu-item:hover {
  background: color-mix(in srgb, var(--menu-icon-color) 12%, transparent);
  transform: translateX(4px);
  box-shadow: 0 4px 14px rgba(35, 28, 20, 0.1);
}

.menu-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--menu-icon-color) 14%, #ffffff);
  color: var(--menu-icon-color);
  transition: transform 0.2s ease;
}

.menu-item:hover .menu-icon-wrap {
  transform: scale(1.1);
}

.menu-item.router-link-active {
  color: var(--menu-icon-color);
  background: color-mix(in srgb, var(--menu-icon-color) 16%, #ffffff);
  font-weight: 600;
}

.menu-item.router-link-active .menu-icon-wrap {
  background: var(--menu-icon-color);
  color: #ffffff;
}

.menu-icon-wrap i {
  font-size: 20px;
}

.menu-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin-left: auto;
  border-radius: 999px;
  background: var(--color-danger);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

@media (max-width: 768px) {
  .side-menu {
    width: 60%;
    height: 100vh;
    border-radius: 0;
    top: 0;
    left: 0;
  }
}
</style>
