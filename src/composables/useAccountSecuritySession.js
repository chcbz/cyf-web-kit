import { getCurrentScope, onScopeDispose, ref } from 'vue'
import { useApiStore } from '../stores/api.js'

const revokedCredential = error => error?.status === 401 ||
  (error?.status === 409 && error?.code === 'SESSION_EPOCH_CONFLICT')

const abortedRequest = error => error?.name === 'AbortError' || error?.name === 'TimeoutError'

function retryMessage (error) {
  if (error?.status === 409 && error?.code === 'AUTH_EPOCH_EXHAUSTED') {
    return '当前会话无法完成全部退出，请稍后重试。'
  }
  if (!error?.status || error.status >= 500 || error.status === 409) {
    return '退出所有设备失败，请检查网络后重试。'
  }
  return '退出所有设备失败，请稍后重试。'
}

export function useAccountSecuritySession ({ router, apiStore = useApiStore() } = {}) {
  const busy = ref(false)
  const error = ref('')
  const status = ref('')
  let disposed = false
  let revokeController = null

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      revokeController?.abort(new DOMException('Account security view disposed', 'AbortError'))
    })
  }

  const clearAndReturnHome = async (message) => {
    await apiStore.clearIdentity()
    if (disposed) return
    status.value = message
    try {
      await router.replace('/')
    } catch {
      // Local security completion is authoritative; navigation failure is not a revoke failure.
    }
  }

  const signOutCurrentDevice = async () => {
    if (busy.value || disposed) return false
    busy.value = true
    error.value = ''
    try {
      await clearAndReturnHome('已退出当前设备。')
      return true
    } finally {
      if (!disposed) busy.value = false
    }
  }

  const signOutAllDevices = async () => {
    if (busy.value || disposed) return false
    busy.value = true
    error.value = ''
    revokeController = new AbortController()
    try {
      await apiStore.revokeAllSessions({ signal: revokeController.signal, timeout: 15_000 })
      await clearAndReturnHome('已退出所有网页登录会话。')
      return true
    } catch (requestError) {
      if (revokedCredential(requestError)) {
        await clearAndReturnHome('当前会话已失效，已退出此设备。')
        return true
      }
      if (!disposed && !abortedRequest(requestError)) error.value = retryMessage(requestError)
      return false
    } finally {
      revokeController = null
      if (!disposed) busy.value = false
    }
  }

  return { busy, error, status, signOutCurrentDevice, signOutAllDevices }
}
