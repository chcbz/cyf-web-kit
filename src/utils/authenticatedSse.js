import { initiateReauthentication } from './reauthentication.js'
import { registerIdentityCleanup } from './identityLifecycle.js'
import { combineAbortSignals, throwIfAborted } from './abortSignals.js'

function responseWithCleanup (response, cleanup) {
  if (!response.body) {
    cleanup()
    return response
  }

  const reader = response.body.getReader()
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    cleanup()
  }
  const body = new ReadableStream({
    async pull (controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          finish()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        finish()
        controller.error(error)
      }
    },
    async cancel (reason) {
      try {
        await reader.cancel(reason)
      } finally {
        finish()
      }
    }
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

async function fetchAuthenticatedSse ({
  apiStore,
  url,
  signal,
  fetchImpl = fetch
}) {
  throwIfAborted(signal)
  const token = await apiStore.token()
  throwIfAborted(signal)
  if (!token) return null

  const identityController = new AbortController()
  const combined = combineAbortSignals({ signals: [signal, identityController.signal] })
  const unregisterIdentityCleanup = registerIdentityCleanup(() => {
    identityController.abort(new DOMException('Identity cleared', 'AbortError'))
  })
  const cleanup = () => {
    unregisterIdentityCleanup()
    combined.cleanup()
  }

  try {
    throwIfAborted(combined.signal)
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: combined.signal
    })
    if (response.status === 401) {
      apiStore.cleanToken()
      if (!combined.signal.aborted) {
        try {
          await initiateReauthentication(apiStore)
        } catch {
          // Navigation may interrupt authorization; a 401 is terminal for this stream attempt.
        }
      }
      cleanup()
      return null
    }
    return responseWithCleanup(response, cleanup)
  } catch (error) {
    cleanup()
    throw error
  }
}

export const fetchChatConversationEvents = options => fetchAuthenticatedSse(options)
export const fetchHallConversationEvents = options => fetchAuthenticatedSse(options)
