import { ref } from 'vue'

const isInstallable = ref(false)
const hasUpdate = ref(false)
const isOfflineReady = ref(false)

let deferredPrompt = null
let serviceWorkerRegistration = null
let updateDismissTimer = null

const isPwaSupported = () => {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  return 'serviceWorker' in navigator && (window.isSecureContext || isLocalhost)
}

export const dismissOfflineReady = () => {
  isOfflineReady.value = false
}

export const promptInstall = async () => {
  if (!deferredPrompt) {
    return false
  }

  deferredPrompt.prompt()
  const { outcome } = await deferredPrompt.userChoice
  deferredPrompt = null
  isInstallable.value = false
  return outcome === 'accepted'
}

export const applyAppUpdate = () => {
  if (serviceWorkerRegistration?.waiting) {
    serviceWorkerRegistration.waiting.postMessage({ type: 'SKIP_WAITING' })
    return
  }

  window.location.reload()
}

const bindWaitingWorker = worker => {
  if (!worker) {
    return
  }

  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      hasUpdate.value = true
    }
  })
}

export const registerPwa = async () => {
  if (!isPwaSupported()) {
    return null
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    deferredPrompt = event
    isInstallable.value = true
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    isInstallable.value = false
  })

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload()
  })

  const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js`
  const registration = await navigator.serviceWorker.register(serviceWorkerUrl)
  serviceWorkerRegistration = registration

  if (registration.waiting) {
    hasUpdate.value = true
  }

  bindWaitingWorker(registration.installing)

  registration.addEventListener('updatefound', () => {
    bindWaitingWorker(registration.installing)
  })

  // 不再自动弹出“已启用离线缓存”提示

  window.setInterval(() => {
    registration.update().catch(() => {})
  }, 5 * 60 * 1000)

  return registration
}

export const usePwaState = () => ({
  hasUpdate,
  isInstallable,
  isOfflineReady
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (updateDismissTimer) {
      window.clearTimeout(updateDismissTimer)
    }
  })
}
