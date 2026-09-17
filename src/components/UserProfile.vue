<template>
  <div class="user-profile">
    <header class="profile-page-header">
      <h1>个人中心</h1>
      <button type="button" @click="returnToHall">返回聚义厅</button>
    </header>

    <p v-if="navigationFailure" class="navigation-notice" role="alert">{{ navigationFailure }}</p>

    <section class="profile-card">
      <div class="profile-avatar">
        <img
          v-if="user.avatar && !avatarFailed"
          :key="avatarKey"
          :src="user.avatar"
          :alt="displayName"
          @error="avatarFailed = true"
        />
        <var-icon v-else name="account-circle" aria-label="默认账号头像" />
      </div>

      <div class="profile-summary">
        <h2>{{ displayName }}</h2>
        <p>{{ user.username || '暂未设置账号' }}</p>
      </div>
    </section>

    <section class="profile-details">
      <h3>基本资料</h3>
      <dl>
        <div>
          <dt>昵称</dt>
          <dd>{{ user.nickname || '暂未设置' }}</dd>
        </div>
        <div>
          <dt>账号</dt>
          <dd>{{ user.username || '暂未设置' }}</dd>
        </div>
        <div>
          <dt>用户编号</dt>
          <dd>{{ user.id || '暂未同步' }}</dd>
        </div>
      </dl>
    </section>

    <section v-if="economyReadOnlyPreviewBuildEnabled" class="economy-discovery" aria-labelledby="economy-readonly-preview-title">
      <h3 id="economy-readonly-preview-title">经济预览</h3>
      <p>只读，不扣款、不下单、不安装、不启用托管；实际可读能力由服务端认证后确认。</p>
      <p v-if="readOnlyPreviewState === 'loading'" class="capability-status" role="status">正在确认经济预览是否可用…</p>
      <p v-else-if="readOnlyPreviewError" class="capability-error" role="alert">{{ readOnlyPreviewError }}</p>
      <div class="discovery-links">
        <button v-if="readOnlyPreviewError" type="button" @click="loadReadOnlyPreviewCapability">重试</button>
        <router-link v-else-if="readOnlyPreviewState === 'ready'" :to="economyPreviewTarget()">进入经济预览</router-link>
      </div>
    </section>

    <section v-if="economyPreviewAvailable" class="economy-discovery" aria-labelledby="economy-discovery-title">
      <h3 id="economy-discovery-title">开发预览</h3>
      <p>经济预览由服务端能力决定；未开启时不会显示可操作的钱包或市场功能。</p>
      <div class="discovery-links">
        <router-link to="/wallet">查看 SILVER 钱袋</router-link>
        <router-link to="/skill-market">发现技能市场</router-link>
      </div>
    </section>

    <section class="account-security" aria-labelledby="account-security-title">
      <h3 id="account-security-title">登录与安全</h3>
      <p>退出当前设备只会清除此浏览器的登录状态。</p>
      <button
        class="security-button"
        type="button"
        :disabled="busy"
        @click="handleCurrentDeviceSignOut"
      >
        {{ busy ? '正在处理…' : '退出当前设备' }}
      </button>

      <div class="all-devices">
        <p>退出所有设备会使所有网页登录会话失效；不会停用 Agent/API Key，也不是注销账号。</p>
        <button
          ref="allDevicesTrigger"
          class="security-button danger"
          type="button"
          :disabled="busy"
          @click="openAllDevicesConfirmation"
        >
          退出所有设备
        </button>
      </div>

      <div
        v-if="confirmingAllDevices"
        ref="dialog"
        class="confirmation"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="revoke-all-title"
        @keydown="onKeydown"
      >
        <h4 id="revoke-all-title">确认退出所有设备？</h4>
        <p>所有网页登录会话将失效。Agent/API Key 不会被停用，账号也不会被注销。</p>
        <div class="confirmation-actions">
          <button
            ref="cancelConfirmationButton"
            type="button"
            :disabled="busy"
            @click="cancelAllDevicesConfirmation"
          >取消</button>
          <button
            class="security-button danger"
            type="button"
            :disabled="busy"
            @click="handleAllDevicesSignOut"
          >
            {{ busy ? '正在退出…' : '确认退出所有设备' }}
          </button>
        </div>
      </div>

      <p class="security-status" aria-live="polite" role="status">
        {{ status }}
      </p>
      <p
        v-if="error"
        class="security-error"
        aria-live="assertive"
        role="alert"
      >{{ error }}</p>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGlobalStore } from '@/stores/global'
import { useAccountSecuritySession } from '@/composables/useAccountSecuritySession'
import { useConfirmationDialog } from '@/composables/useConfirmationDialog'
import { isEconomyPreviewBuildEnabled } from '@/utils/silverAmount'
import { isEconomyPreviewCapability, loadEconomyPreviewCapability as fetchEconomyPreviewCapability } from '@/utils/economyPreviewCapability'
import { assessReadOnlyPreviewCapabilities } from '@/utils/economyReadOnlyPreviewPolicy'
import { economyReadOnlyPreviewClient } from '@/composables/economyReadOnlyPreviewApi'
import { economyPreviewTarget, previewFailureFromRoute, previewFailureMessage, returnToJuyiHall } from '@/utils/profileNavigation'
import { useApiStore } from '@/stores/api'

const router = useRouter()
const route = useRoute()
const apiStore = useApiStore()
const economyReadOnlyPreviewBuildEnabled = import.meta.env.VITE_ECONOMY_READONLY_PREVIEW_ENABLED === 'true'
const economyPreviewBuildEnabled = isEconomyPreviewBuildEnabled(import.meta.env.VITE_ECONOMY_PREVIEW_ENABLED)
const economyPreviewAvailable = ref(false)
const avatarFailed = ref(false)
const readOnlyPreviewState = ref('idle')
const readOnlyPreviewError = ref('')
let economyPreviewRequest = 0
let readOnlyPreviewRequest = 0
let profileMounted = false
let disposed = false
const globalStore = useGlobalStore()
const { busy, error, status, signOutCurrentDevice, signOutAllDevices } = useAccountSecuritySession({ router })
const allDevicesTrigger = ref(null)
const { cancelButton: cancelConfirmationButton, close: closeConfirmation, confirming: confirmingAllDevices, dialog, onKeydown, open: openConfirmation } = useConfirmationDialog({
  isBusy: () => busy.value
})
const user = computed(() => globalStore.user)
const displayName = computed(() => user.value.nickname || user.value.username || '个人中心')
const avatarKey = computed(() => `${user.value.id || 'anonymous'}:${user.value.avatar || ''}`)
const navigationFailure = computed(() => {
  const reason = previewFailureFromRoute(route)
  return reason ? previewFailureMessage(reason) : ''
})

const openAllDevicesConfirmation = () => openConfirmation(allDevicesTrigger.value)

const cancelAllDevicesConfirmation = () => closeConfirmation()

const handleCurrentDeviceSignOut = () => signOutCurrentDevice()

const handleAllDevicesSignOut = async () => {
  const completed = await signOutAllDevices()
  if (completed) closeConfirmation({ force: true })
}

const returnToHall = () => returnToJuyiHall(router)

const clearPreviewFailureQuery = () => {
  if (previewFailureFromRoute(route)) void router.replace({ name: 'UserProfile' })
}

const resetPreviewCapabilityState = () => {
  economyPreviewRequest += 1
  economyPreviewAvailable.value = false
  readOnlyPreviewRequest += 1
  readOnlyPreviewState.value = 'idle'
  readOnlyPreviewError.value = ''
}

const hasCurrentProfileIdentity = () => Boolean(user.value.id || user.value.username || user.value.openid)

const reloadPreviewCapabilities = () => {
  resetPreviewCapabilityState()
  if (!profileMounted || !hasCurrentProfileIdentity()) return
  void loadEconomyPreviewCapability()
  if (economyReadOnlyPreviewBuildEnabled) void loadReadOnlyPreviewCapability()
}

const loadReadOnlyPreviewCapability = async () => {
  const request = ++readOnlyPreviewRequest
  const authGeneration = apiStore.authorizationGeneration
  readOnlyPreviewState.value = 'loading'
  readOnlyPreviewError.value = ''
  try {
    const assessment = assessReadOnlyPreviewCapabilities(await economyReadOnlyPreviewClient.capabilities())
    if (disposed || request !== readOnlyPreviewRequest || authGeneration !== apiStore.authorizationGeneration) return
    if (assessment.available) {
      readOnlyPreviewState.value = 'ready'
      clearPreviewFailureQuery()
      return
    }
    readOnlyPreviewState.value = 'unavailable'
    readOnlyPreviewError.value = previewFailureMessage(assessment.reason)
  } catch {
    if (disposed || request !== readOnlyPreviewRequest || authGeneration !== apiStore.authorizationGeneration) return
    readOnlyPreviewState.value = 'unavailable'
    readOnlyPreviewError.value = previewFailureMessage('PREVIEW_UNAVAILABLE')
  }
}

const loadEconomyPreviewCapability = async () => {
  if (!economyPreviewBuildEnabled) return
  const request = ++economyPreviewRequest
  const authGeneration = apiStore.authorizationGeneration
  try {
    const available = isEconomyPreviewCapability(await fetchEconomyPreviewCapability())
    if (disposed || request !== economyPreviewRequest || authGeneration !== apiStore.authorizationGeneration) return
    economyPreviewAvailable.value = available
  } catch {
    if (disposed || request !== economyPreviewRequest || authGeneration !== apiStore.authorizationGeneration) return
    economyPreviewAvailable.value = false
  }
}

watch(() => user.value.avatar, () => { avatarFailed.value = false })
watch(
  () => [user.value.id, user.value.username, user.value.openid, apiStore.authorizationGeneration],
  () => {
    avatarFailed.value = false
    clearPreviewFailureQuery()
    reloadPreviewCapabilities()
  },
  { flush: 'sync' }
)

onBeforeUnmount(() => {
  disposed = true
  resetPreviewCapabilityState()
  closeConfirmation({ force: true })
})

onMounted(() => {
  globalStore.setTitle('个人中心')
  globalStore.setShowBack(false)
  globalStore.setShowMore(false)
  profileMounted = true
  reloadPreviewCapabilities()
})
</script>

<style scoped>
.user-profile {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: var(--color-body);
}

.profile-page-header,
.profile-card,
.profile-details,
.economy-discovery,
.account-security {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(35, 28, 20, 0.08);
}

.profile-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.profile-page-header h1 {
  margin: 0;
  color: var(--color-text);
  font-size: 22px;
}

.profile-page-header button,
.discovery-links button {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid #4f46e5;
  border-radius: 8px;
  background: #fff;
  color: #4338ca;
  cursor: pointer;
}

.navigation-notice,
.capability-status,
.capability-error {
  margin: 0 0 16px;
  padding: 12px;
  border-radius: 8px;
}

.navigation-notice,
.capability-error {
  background: #fff0f0;
  color: #a32d2d;
}

.capability-status {
  background: #fff7df;
  color: #855d12;
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px;
  margin-bottom: 16px;
}

.profile-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  overflow: hidden;
  flex: 0 0 72px;
  border-radius: 50%;
  background: #e0e7ff;
  color: #4f46e5;
  font-size: 72px;
}

.profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-summary h2,
.profile-details h3,
.account-security h3 {
  margin: 0;
  color: var(--color-text);
}

.profile-summary p,
.account-security p {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
}

.profile-details,
.economy-discovery,
.account-security {
  padding: 20px;
}

.profile-details h3,
.account-security h3 {
  font-size: 17px;
}

.profile-details dl {
  margin: 12px 0 0;
}

.profile-details dl div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid #f1f5f9;
}

.profile-details dl div:last-child {
  border-bottom: 0;
}

.profile-details dt {
  color: var(--color-text-secondary);
}

.profile-details dd {
  margin: 0;
  color: var(--color-text);
  text-align: right;
  word-break: break-all;
}

.economy-discovery,
.account-security {
  margin-top: 16px;
}

.economy-discovery {
  padding: 20px;
}

.economy-discovery h3 { margin: 0; color: var(--color-text); font-size: 17px; }

.economy-discovery p { color: var(--color-text-secondary); }

.discovery-links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }

.discovery-links a { padding: 9px 12px; border-radius: 8px; background: #fff3cc; color: #75430b; text-decoration: none; }

.all-devices,
.confirmation {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid #f1f5f9;
}

.security-button,
.confirmation-actions button {
  min-height: 42px;
  margin-top: 14px;
  padding: 0 16px;
  border: 1px solid #4f46e5;
  border-radius: 8px;
  background: #4f46e5;
  color: #fff;
  cursor: pointer;
}

.security-button:disabled,
.confirmation-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.security-button.danger {
  border-color: #b42318;
  background: #b42318;
}

.confirmation {
  border-color: #fecaca;
}

.confirmation h4 {
  margin: 0;
  color: var(--color-text);
}

.confirmation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.confirmation-actions button {
  margin-top: 0;
}

.security-status,
.security-error {
  min-height: 1.4em;
  margin-top: 16px !important;
}

.security-error {
  color: #b42318 !important;
}
</style>
