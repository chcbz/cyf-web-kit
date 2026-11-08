<template>
  <div class="user-profile">
    <header class="profile-page-header">
      <div class="profile-page-heading">
        <p class="profile-eyebrow">聚义厅 · 我的</p>
        <h1>个人中心</h1>
        <p class="profile-intro">管好钱袋，安心办事。</p>
      </div>
      <button class="return-to-hall" type="button" @click="returnToHall">
        <var-icon name="chevron-left" aria-hidden="true" />
        <span>返回聚义厅</span>
      </button>
    </header>

    <p v-if="navigationFailure" class="navigation-notice" role="alert">{{ navigationFailure }}</p>

    <p v-if="identityLoading" role="status">正在读取当前用户资料…</p>
    <div v-else-if="identityError" role="alert">
      <p>{{ identityError }}</p>
      <button type="button" class="profile-identity-retry" @click="loadCurrentIdentity">重试读取资料</button>
    </div>

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
        <p>{{ accountName || '暂未设置账号' }}</p>
      </div>
      <span class="profile-seal" aria-hidden="true">聚义</span>
    </section>

    <section class="economy-discovery profile-wallet" aria-labelledby="wallet-entry-title">
      <h3 id="wallet-entry-title">我的钱袋</h3>
      <p class="wallet-headline">每一文，都有来处。</p>
      <p>查看可用文、事项预占和收支记录。</p>
      <div class="discovery-links"><router-link to="/wallet">查看钱袋（文）<span aria-hidden="true"> →</span></router-link></div>
    </section>

    <section class="profile-details">
      <h3>基本资料</h3>
      <dl>
        <div>
          <dt>昵称</dt>
          <dd>{{ nickname || '暂未设置' }}</dd>
        </div>
        <div>
          <dt>账号</dt>
          <dd>{{ accountName || '暂未设置' }}</dd>
        </div>
        <div>
          <dt>用户编号</dt>
          <dd>{{ user.id || '暂未同步' }}</dd>
        </div>
      </dl>
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
    <details v-if="skillMarketplaceAvailable || economyReadOnlyPreviewBuildEnabled || commandObservabilityState === 'ready' || commandObservabilityState === 'error'" class="profile-tools">
      <summary>更多功能</summary>
    <section v-if="commandObservabilityState === 'ready' || commandObservabilityState === 'error'" class="economy-discovery command-observability-discovery" aria-labelledby="command-observability-title">
      <h3 id="command-observability-title">协作运行看板</h3>
      <p>仅内部只读查看投递、死信和已有操作审计；命令投递不等同于 Agent 任务完成。</p>
      <p v-if="commandObservabilityState === 'loading'" class="capability-status" role="status">正在确认协作运行看板是否可用…</p>
      <p v-else-if="commandObservabilityState === 'error' || commandObservabilityState === 'unavailable'" class="capability-error" role="alert">{{ commandObservabilityError }}</p>
      <div class="discovery-links">
        <button v-if="commandObservabilityState === 'error'" type="button" @click="loadCommandObservabilityCapability">重试</button>
        <router-link v-else-if="commandObservabilityState === 'ready'" :to="commandObservabilityTarget()">进入协作运行看板</router-link>
      </div>
    </section>

    <section v-if="economyReadOnlyPreviewBuildEnabled" class="economy-discovery" aria-labelledby="economy-readonly-preview-title">
      <h3 id="economy-readonly-preview-title">经济预览</h3>
      <p>仅供查看，不会产生费用。</p>
      <p v-if="readOnlyPreviewState === 'loading'" class="capability-status" role="status">正在确认经济预览是否可用…</p>
      <p v-else-if="readOnlyPreviewError" class="capability-error" role="alert">{{ readOnlyPreviewError }}</p>
      <div class="discovery-links">
        <button v-if="readOnlyPreviewError" type="button" @click="loadReadOnlyPreviewCapability">重试</button>
        <router-link v-else-if="readOnlyPreviewState === 'ready'" :to="economyPreviewTarget()">进入经济预览</router-link>
      </div>
    </section>

    <section v-if="skillMarketplaceAvailable" class="economy-discovery" aria-labelledby="economy-discovery-title">
      <h3 id="economy-discovery-title">技能市场</h3>

      <div class="discovery-links">
        <router-link v-if="skillMarketplaceAvailable" to="/skill-market">发现技能市场</router-link>
      </div>
    </section>

    </details>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGlobalStore } from '@/stores/global'
import { useAccountSecuritySession } from '@/composables/useAccountSecuritySession'
import { useConfirmationDialog } from '@/composables/useConfirmationDialog'
import { isSkillMarketplaceCapability, loadEconomyPreviewCapability as fetchEconomyPreviewCapability } from '@/utils/economyPreviewCapability'
import { assessReadOnlyPreviewCapabilities } from '@/utils/economyReadOnlyPreviewPolicy'
import { economyReadOnlyPreviewClient } from '@/composables/economyReadOnlyPreviewApi'
import { commandObservabilityClient } from '@/composables/commandObservabilityApi'
import { assessCommandObservabilityCapability, capabilityUnavailableMessage } from '@/utils/commandObservabilityPolicy'
import { commandObservabilityTarget, economyPreviewTarget, previewFailureFromRoute, previewFailureMessage, returnToJuyiHall } from '@/utils/profileNavigation'
import { useApiStore } from '@/stores/api'
import { resolveAccountDisplayName, resolveDisplayName } from '@/utils/displayName'

const router = useRouter()
const route = useRoute()
const apiStore = useApiStore()
const economyReadOnlyPreviewBuildEnabled = import.meta.env.VITE_ECONOMY_READONLY_PREVIEW_ENABLED === 'true'
const skillMarketplaceAvailable = ref(false)
const avatarFailed = ref(false)
const identityLoading = ref(false)
const identityError = ref('')
let identityRequest = null
const readOnlyPreviewState = ref('idle')
const readOnlyPreviewError = ref('')
let economyPreviewRequest = 0
let readOnlyPreviewRequest = 0
const commandObservabilityState = ref('idle')
const commandObservabilityError = ref('')
let commandObservabilityRequest = 0
let commandObservabilityController = null
let profileMounted = false
let disposed = false
const globalStore = useGlobalStore()
const { busy, error, status, signOutCurrentDevice, signOutAllDevices } = useAccountSecuritySession({ router })
const allDevicesTrigger = ref(null)
const { cancelButton: cancelConfirmationButton, close: closeConfirmation, confirming: confirmingAllDevices, dialog, onKeydown, open: openConfirmation } = useConfirmationDialog({
  isBusy: () => busy.value
})
const user = computed(() => globalStore.user)

const nickname = computed(() => resolveDisplayName(user.value.nickname))
const accountName = computed(() => resolveDisplayName(user.value.username))
const displayName = computed(() => resolveAccountDisplayName(user.value, '个人中心'))
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
  skillMarketplaceAvailable.value = false
  readOnlyPreviewRequest += 1
  readOnlyPreviewState.value = 'idle'
  readOnlyPreviewError.value = ''
  commandObservabilityRequest += 1
  commandObservabilityController?.abort()
  commandObservabilityController = null
  commandObservabilityState.value = 'idle'
  commandObservabilityError.value = ''
}

const hasCurrentProfileIdentity = () => Boolean(user.value.id || user.value.username || user.value.openid)

// A persisted access token survives refresh; the in-memory profile does not.
// Use the auth store's generation-fenced request, never trust cached profile IDs.
const loadCurrentIdentity = async () => {
  if (disposed || identityRequest || hasCurrentProfileIdentity()) return
  const controller = new AbortController()
  const generation = apiStore.authorizationGeneration
  identityRequest = controller
  identityLoading.value = true
  identityError.value = ''
  try {
    await apiStore.getUserInfo({ signal: controller.signal })
    if (!disposed && generation === apiStore.authorizationGeneration && !hasCurrentProfileIdentity()) {
      identityError.value = '当前用户资料暂未同步，请重试。'
    }
  } catch {
    if (!disposed && !controller.signal.aborted && generation === apiStore.authorizationGeneration) {
      identityError.value = '当前用户资料暂时无法读取，请重试或重新登录。'
    }
  } finally {
    if (identityRequest === controller) {
      identityRequest = null
      identityLoading.value = false
    }
  }
}

const reloadPreviewCapabilities = () => {
  resetPreviewCapabilityState()
  if (!profileMounted || !hasCurrentProfileIdentity()) return
  void loadEconomyPreviewCapability()
  if (economyReadOnlyPreviewBuildEnabled) void loadReadOnlyPreviewCapability()
  void loadCommandObservabilityCapability()
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

const loadCommandObservabilityCapability = async () => {
  const request = ++commandObservabilityRequest
  const authGeneration = apiStore.authorizationGeneration
  commandObservabilityController?.abort()
  const controller = new AbortController()
  commandObservabilityController = controller
  commandObservabilityState.value = 'loading'
  commandObservabilityError.value = ''
  try {
    const assessment = assessCommandObservabilityCapability(await commandObservabilityClient.capabilities({ signal: controller.signal }))
    if (disposed || request !== commandObservabilityRequest || authGeneration !== apiStore.authorizationGeneration) return
    if (assessment.available) {
      commandObservabilityState.value = 'ready'
      return
    }
    // FORBIDDEN/DISABLED are normal server-computed states. Do not expose a usable link.
    commandObservabilityState.value = 'unavailable'
    commandObservabilityError.value = capabilityUnavailableMessage(assessment.reason)
  } catch {
    if (disposed || controller.signal.aborted || request !== commandObservabilityRequest || authGeneration !== apiStore.authorizationGeneration) return
    commandObservabilityState.value = 'error'
    commandObservabilityError.value = '暂时无法确认协作运行看板是否可用，请稍后重试。'
  } finally {
    if (commandObservabilityController === controller) commandObservabilityController = null
  }
}

const loadEconomyPreviewCapability = async () => {
  const request = ++economyPreviewRequest
  const authGeneration = apiStore.authorizationGeneration
  try {
    const capability = await fetchEconomyPreviewCapability()
    if (disposed || request !== economyPreviewRequest || authGeneration !== apiStore.authorizationGeneration) return
    skillMarketplaceAvailable.value = isSkillMarketplaceCapability(capability)
  } catch {
    if (disposed || request !== economyPreviewRequest || authGeneration !== apiStore.authorizationGeneration) return
    skillMarketplaceAvailable.value = false
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

watch(() => apiStore.authorizationGeneration, () => {
  identityRequest?.abort()
  identityRequest = null
  identityLoading.value = false
  identityError.value = ''
  if (profileMounted) void loadCurrentIdentity()
}, { flush: 'post' })

onBeforeUnmount(() => {
  disposed = true
  identityRequest?.abort()
  resetPreviewCapabilityState()
  closeConfirmation({ force: true })
})

onMounted(() => {
  globalStore.setTitle('个人中心')
  globalStore.setShowBack(false)
  globalStore.setShowMore(false)
  profileMounted = true
  reloadPreviewCapabilities()
  void loadCurrentIdentity()
})
</script>

<style scoped>
.user-profile { --profile-paper: #fffefa; --profile-ink: #242e2b; --profile-muted: #68716b; --profile-accent: #923f30; flex: 1; overflow: auto; padding: 32px max(20px, calc((100% - 840px) / 2)); background: #f7f6f2; color: var(--profile-ink); }
.user-profile *, .user-profile *::before, .user-profile *::after { box-sizing: border-box; }
.profile-page-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.profile-page-heading { min-width: 0; }.profile-page-header h1 { font: 500 28px/1.5 "Noto Serif CJK SC", "Songti SC", serif; margin: 4px 0; }
.profile-eyebrow { color: var(--profile-accent); font-size: 12px; letter-spacing: .12em; margin: 0; }.profile-intro { color: var(--profile-muted); margin: 6px 0; font-size: 14px; }
.return-to-hall { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }
.user-profile button { min-height: 44px; padding: 10px 14px; border: 1px solid #d9dcd3; border-radius: 8px; color: var(--profile-accent); background: var(--profile-paper); cursor: pointer; font: inherit; }
.user-profile button:disabled { opacity: .6; cursor: not-allowed; }.user-profile :is(button,a,summary):focus-visible { outline: 2px solid var(--profile-accent); outline-offset: 3px; }
.profile-card { display: flex; align-items: center; gap: 16px; padding: 16px 0 24px; }.profile-avatar { width: 64px; height: 64px; flex: 0 0 64px; background: #eee6d5; color: var(--profile-accent); border-radius: 14px; overflow: hidden; display: grid; place-items: center; }.profile-avatar img { width: 100%; height: 100%; object-fit: cover; }.profile-avatar .var-icon { font-size: 40px; }
.profile-summary { min-width: 0; }.profile-summary h2 { font-size: 20px; margin: 0; overflow-wrap: anywhere; }.profile-summary p { color: var(--profile-muted); margin: 6px 0 0; overflow-wrap: anywhere; }.profile-seal { margin-left: auto; border: 1px solid var(--profile-accent); color: var(--profile-accent); padding: 6px; flex-shrink: 0; font-family: serif; }
.profile-details, .account-security, .profile-tools { background: var(--profile-paper); border: 1px solid #e3e5dc; border-radius: 12px; padding: 24px; margin-top: 20px; }.user-profile h3 { font-size: 17px; margin: 0 0 12px; }.user-profile p { line-height: 1.7; }.account-security p, .economy-discovery p { color: var(--profile-muted); font-size: 14px; }
.profile-wallet { position: relative; padding: 24px; border: 1px solid #ded2c2; border-radius: 14px; background: #f1e8dc; }.profile-wallet h3 { font-size: 13px; font-weight: 500; }.profile-wallet .wallet-headline { color: var(--profile-ink); font: 500 23px/1.5 "Noto Serif CJK SC", "Songti SC", serif; margin: 8px 0; }.discovery-links { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }.discovery-links a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 16px; border: 1px solid #e3e5dc; border-radius: 8px; color: var(--profile-accent); background: var(--profile-paper); text-decoration: none; }.profile-wallet .discovery-links a { border-color: var(--profile-accent); background: var(--profile-accent); color: var(--profile-paper); gap: 16px; }
.profile-details dl { margin: 0; }.profile-details dl div { display: flex; justify-content: space-between; gap: 20px; padding: 14px 0; border-bottom: 1px solid #eeeee6; }.profile-details dl div:last-child { border: 0; }.profile-details dt { color: var(--profile-muted); flex-shrink: 0; }.profile-details dd { margin: 0; text-align: right; overflow-wrap: anywhere; min-width: 0; }
.all-devices, .confirmation { margin-top: 20px; padding-top: 18px; border-top: 1px solid #e3e5dc; }.confirmation { border-color: #dbbdb5; }.confirmation h4 { margin: 0; }.confirmation-actions { display: flex; flex-wrap: wrap; gap: 12px; }.security-button.danger { border-color: #dbbdb5; color: #923f30; }.confirmation-actions .security-button.danger { color: #fffefa; background: #923f30; }.security-error, .capability-error, .navigation-notice { color: #923f30 !important; }.security-status:empty, .security-error:empty { display: none; }.profile-tools summary { min-height: 24px; cursor: pointer; color: var(--profile-muted); }.profile-tools .economy-discovery { padding-top: 20px; margin-top: 16px; border-top: 1px solid #e3e5dc; }
@media (min-width: 760px) { .profile-wallet { padding-right: 240px; }.profile-wallet .discovery-links { position: absolute; right: 24px; top: 50%; transform: translateY(-50%); margin: 0; } }
@media (max-width: 600px) { .user-profile { padding: 22px 16px; }.profile-page-header { align-items: flex-start; }.profile-page-header h1 { font-size: 25px; }.return-to-hall { padding: 8px !important; font-size: 13px !important; }.profile-details, .account-security, .profile-tools, .profile-wallet { padding: 20px; }.profile-wallet .discovery-links a { width: 100%; justify-content: space-between; }.confirmation-actions button { flex: 1; }.profile-tools summary { min-height: 28px; } }
</style>
