<template>
  <div class="app-container">
    <var-app-bar v-if="showAppBar && !isPublicEntry" :title="title">
      <template #left>
        <var-icon
          v-if="leftOptions.showBack"
          name="chevron-left"
          class="back-icon"
          @click.stop="$router.back()"
        />
        <var-icon
          v-if="!leftOptions.showBack"
          name="menu"
          class="menu-icon"
          @click.stop="toggleMenu"
        />
      </template>
      <template #right>
        <button
          v-if="isInstallable"
          class="pwa-action"
          type="button"
          @click="handleInstall"
        >
          安装
        </button>
        <button
          v-if="hasUpdate"
          class="pwa-action pwa-action-update"
          type="button"
          @click="handleUpdate"
        >
          更新
        </button>
        <var-icon
          v-if="showMore"
          name="dots-vertical"
          class="more-icon"
          @click.stop="handleMoreClick"
        />
      </template>
    </var-app-bar>

    <side-menu v-if="!isPublicEntry" v-model="showSideMenu" style="height: 0px;" />

    <div class="app-content" :class="{ 'show-menu': showSideMenu, 'public-entry': isPublicEntry }">
      <router-view />
    </div>

    <div v-if="!isPublicEntry && (isOfflineReady || hasUpdate)" class="pwa-banner">
      <span>{{ hasUpdate ? '发现新版本，可立即刷新更新。' : '已启用离线缓存，可作为桌面应用安装。' }}</span>
      <div class="pwa-banner-actions">
        <button
          v-if="hasUpdate"
          class="pwa-banner-button"
          type="button"
          @click="handleUpdate"
        >
          立即更新
        </button>
        <button
          v-else-if="isInstallable"
          class="pwa-banner-button"
          type="button"
          @click="handleInstall"
        >
          立即安装
        </button>
        <button
          v-else
          class="pwa-banner-button pwa-banner-button-secondary"
          type="button"
          @click="dismissBanner"
        >
          知道了
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useGlobalStore } from '@/stores/global'
import { applyAppUpdate, dismissOfflineReady, promptInstall, usePwaState } from '@/utils/pwa'

const SideMenu = defineAsyncComponent(() => import('@/components/SideMenu'))
const globalStore = useGlobalStore()
const route = useRoute()
const { hasUpdate, isInstallable, isOfflineReady } = usePwaState()

// Action Sheet 相关状态 (预留功能)
// const showActionMenu = ref(false)
// const actionMenu = ref([])

const toggleMenu = () => {
  globalStore.toggleSideMenu()
}

// const isLoading = computed(() => utilStore.isLoading)
const leftOptions = computed(() => ({
  showBack: globalStore.showBack
}))
const title = computed(() => globalStore.title)
const showSideMenu = computed({
  get: () => globalStore.showSideMenu,
  set: (value) => { globalStore.showSideMenu = value }
})
const showMore = computed(() => globalStore.showMore)
const showAppBar = computed(() => globalStore.showAppBar)
const isPublicEntry = computed(() => route.meta?.publicEntry === true)

const handleMoreClick = () => {
  // 同时更新右侧边栏状态
  globalStore.showRightSidebar = true
}

const handleInstall = async () => {
  await promptInstall()
}

const handleUpdate = () => {
  applyAppUpdate()
}

const dismissBanner = () => {
  dismissOfflineReady()
}

// 监听全局标题变化，自动更新 document.title
watch(() => globalStore.title, (newTitle) => {
  if (newTitle) {
    document.title = newTitle + ' - ' + import.meta.env.VITE_APP_TITLE
  }
})
</script>

<style>
html, body {
  height: 100%;
  width: 100%;
  margin: 0;
  overflow-x: hidden;
  font-family: var(--font-family);
  color: var(--color-text);
  background-color: var(--color-body);
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: relative;
}

.app-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  transition: margin-left 0.3s;
}

.app-content.public-entry {
  overflow: auto;
}

.app-content.public-entry > * {
  width: 100%;
  min-width: 0;
}

.menu-icon {
  margin-right: 12px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.back-icon {
  margin-right: 12px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.more-icon {
  margin-left: 12px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.pwa-action {
  border: 0;
  border-radius: 999px;
  padding: 6px 12px;
  margin-left: 8px;
  background: rgba(139, 30, 30, 0.12);
  color: #8b1e1e;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.pwa-action-update {
  background: rgba(27, 94, 32, 0.14);
  color: #1b5e20;
}

.menu-icon:hover,
.back-icon:hover,
.more-icon:hover {
  transform: scale(1.1);
}

.pwa-banner {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: 16px;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(39, 27, 20, 0.92);
  color: #f8efe2;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
}

.pwa-banner span {
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
}

.pwa-banner-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pwa-banner-button {
  border: 0;
  border-radius: 999px;
  padding: 8px 14px;
  background: #f4c84c;
  color: #472b00;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.pwa-banner-button-secondary {
  background: rgba(255, 255, 255, 0.14);
  color: #f8efe2;
}

@media (max-width: 767px) {
  .pwa-banner {
    flex-direction: column;
    align-items: stretch;
  }

  .pwa-banner-actions {
    justify-content: flex-end;
  }
}

@media (min-width: 768px) {
  .app-content {
    transition: margin-left 0.3s;
  }

  .app-content.show-menu {
    margin-left: 250px;
  }
}
</style>