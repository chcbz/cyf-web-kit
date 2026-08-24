import { ref } from 'vue'
import { useApiStore } from '../stores/api.js'

const revokedCredential = error => error?.status === 401 ||
  (error?.status === 409 && error?.code === 'SESSION_EPOCH_CONFLICT')

function retryMessage (error) {
  if (error?.status === 409 && error?.code === 'AUTH_EPOCH_EXHAUSTED') {
    return '当前会话无法完成全部退出，请稍后重试。'
  }
  if (!error?.status || error.status >= 500 || error.status === 409) {
    return '退出所有设备失败，请检查网络后重试。'
  }
  return '退出所有设备失败，请稍后重试。'
}

export function useAccountSecuritySession ({ router, apiStore = useApiStore(), messageStore } = {}) {
  const busy = ref(false)
  const error = ref('')
  const status = ref('')

  const clearAndReturnHome = async (message) => {
    apiStore.clearIdentity()
    const activeMessageStore = messageStore || (await import('../stores/message.js')).useMessageStore()
    activeMessageStore.clearMessageState()
    status.value = message
    await router.replace('/')
  }

  const signOutCurrentDevice = async () => {
    if (busy.value) return false
    busy.value = true
    error.value = ''
    try {
      await clearAndReturnHome('已退出当前设备。')
      return true
    } finally {
      busy.value = false
    }
  }

  const signOutAllDevices = async () => {
    if (busy.value) return false
    busy.value = true
    error.value = ''
    try {
      await apiStore.revokeAllSessions()
      await clearAndReturnHome('已退出所有网页登录会话。')
      return true
    } catch (requestError) {
      if (revokedCredential(requestError)) {
        await clearAndReturnHome('当前会话已失效，已退出此设备。')
        return true
      }
      error.value = retryMessage(requestError)
      return false
    } finally {
      busy.value = false
    }
  }

  return { busy, error, status, signOutCurrentDevice, signOutAllDevices }
}
