<template>
  <div class="user-profile">
    <section class="profile-card">
      <div class="profile-avatar">
        <img v-if="user.avatar" :src="user.avatar" :alt="displayName" />
        <var-icon v-else name="account-circle" />
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGlobalStore } from '@/stores/global'
import { useAccountSecuritySession } from '@/composables/useAccountSecuritySession'
import { useConfirmationDialog } from '@/composables/useConfirmationDialog'

const router = useRouter()
const globalStore = useGlobalStore()
const { busy, error, status, signOutCurrentDevice, signOutAllDevices } = useAccountSecuritySession({ router })
const allDevicesTrigger = ref(null)
const { cancelButton: cancelConfirmationButton, close: closeConfirmation, confirming: confirmingAllDevices, dialog, onKeydown, open: openConfirmation } = useConfirmationDialog({
  isBusy: () => busy.value
})
const user = computed(() => globalStore.user)
const displayName = computed(() => user.value.nickname || user.value.username || '微信用户')

const openAllDevicesConfirmation = () => openConfirmation(allDevicesTrigger.value)

const cancelAllDevicesConfirmation = () => closeConfirmation()

const handleCurrentDeviceSignOut = () => signOutCurrentDevice()

const handleAllDevicesSignOut = async () => {
  const completed = await signOutAllDevices()
  if (completed) closeConfirmation({ force: true })
}

onBeforeUnmount(() => {
  closeConfirmation({ force: true })
})

onMounted(() => {
  globalStore.setTitle('个人中心')
  globalStore.setShowBack(false)
  globalStore.setShowMore(false)
})
</script>

<style scoped>
.user-profile {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: var(--color-body);
}

.profile-card,
.profile-details,
.account-security {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(35, 28, 20, 0.08);
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

.account-security {
  margin-top: 16px;
}

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
