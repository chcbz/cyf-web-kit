import { useUtilStore } from '../stores/util.js'

export function redirectLoggedInHome (to) {
  try {
    const token = useUtilStore().getLocalStorage('api_token')
    if (typeof token !== 'string' || !token.trim()) return undefined

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
