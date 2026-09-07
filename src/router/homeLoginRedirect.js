import { useUtilStore } from '../stores/util.js'

function getValidLocalToken () {
  const rawToken = localStorage.getItem('api_token')
  if (!rawToken) return undefined

  const envelope = JSON.parse(rawToken)
  if (!envelope || Array.isArray(envelope) ||
    typeof envelope.data !== 'string' || !envelope.data.trim() ||
    typeof envelope.expTime !== 'number' || !Number.isFinite(envelope.expTime)) {
    return undefined
  }

  const utilStore = useUtilStore()
  if (envelope.expTime <= Date.now()) {
    utilStore.removeLocalStorage('api_token')
    return undefined
  }

  const token = utilStore.getLocalStorage('api_token')
  return typeof token === 'string' && token.trim() ? token : undefined
}

export function redirectLoggedInHome (to) {
  try {
    if (!getValidLocalToken()) return undefined

    return {
      path: '/juyiting',
      query: to.query,
      hash: to.hash,
      replace: true
    }
  } catch {
    return undefined
  }
}
