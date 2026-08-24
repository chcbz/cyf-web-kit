import { initiateReauthentication } from './reauthentication.js'
import { registerIdentityCleanup } from './identityLifecycle.js'

async function fetchAuthenticatedSse ({
  apiStore,
  url,
  signal,
  fetchImpl = globalThis.fetch
}) {
  const token = await apiStore.token()
  if (!token) return null

  const identityController = new AbortController()
  const unregisterIdentityCleanup = registerIdentityCleanup(() => identityController.abort())
  const abortForCaller = () => {
    identityController.abort()
    unregisterIdentityCleanup()
  }
  signal?.addEventListener?.('abort', abortForCaller, { once: true })

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: identityController.signal
    })
    if (response.status === 401) {
      apiStore.cleanToken()
      try {
        await initiateReauthentication(apiStore)
      } catch {
        // Navigation may interrupt authorization; a 401 is still terminal for this stream attempt.
      }
      unregisterIdentityCleanup()
      return null
    }
    return response
  } catch (error) {
    unregisterIdentityCleanup()
    throw error
  }
}

export const fetchChatConversationEvents = options => fetchAuthenticatedSse(options)
export const fetchHallConversationEvents = options => fetchAuthenticatedSse(options)
