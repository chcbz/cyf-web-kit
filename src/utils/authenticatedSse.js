import { initiateReauthentication } from './reauthentication.js'

async function fetchAuthenticatedSse ({
  apiStore,
  url,
  signal,
  fetchImpl = globalThis.fetch
}) {
  const token = await apiStore.token()
  if (!token) return null

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal
  })
  if (response.status === 401) {
    apiStore.cleanToken()
    try {
      await initiateReauthentication(apiStore)
    } catch {
      // Navigation may interrupt authorization; a 401 is still terminal for this stream attempt.
    }
    return null
  }
  return response
}

export const fetchChatConversationEvents = options => fetchAuthenticatedSse(options)
export const fetchHallConversationEvents = options => fetchAuthenticatedSse(options)
