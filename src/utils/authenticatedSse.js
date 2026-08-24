import { initiateReauthentication } from './reauthentication.js'
import { registerIdentityCleanup } from './identityLifecycle.js'
import { combineAbortSignals, throwIfAborted } from './abortSignals.js'

function responseWithCleanup (response, signal, cleanup) {
  if (!response.body) {
    cleanup()
    return response
  }

  const reader = response.body.getReader()
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    signal?.removeEventListener?.('abort', onAbort)
    cleanup()
  }
  let cancelPromise = null
  const cancelReader = reason => {
    if (cancelPromise) return cancelPromise
    cancelPromise = (async () => {
      try {
        await reader.cancel(reason)
      } catch {
        // Cancellation is best-effort; lifecycle cleanup must still complete.
      } finally {
        finish()
      }
    })()
    return cancelPromise
  }
  const onAbort = () => { void cancelReader(signal.reason) }
  signal?.addEventListener?.('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()

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
    cancel: cancelReader
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
  const authorizationGeneration = apiStore.authorizationGeneration
  const token = await apiStore.token()
  throwIfAborted(signal)
  if (!token) return null

  const identityController = new AbortController()
  const combined = combineAbortSignals({ signals: [signal, identityController.signal] })
  const unregisterIdentityCleanup = registerIdentityCleanup(() => {
    identityController.abort(new DOMException('Identity cleared', 'AbortError'))
  })
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
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
      throwIfAborted(combined.signal)
      if (authorizationGeneration === apiStore.authorizationGeneration) {
        apiStore.cleanToken()
        if (!combined.signal.aborted && authorizationGeneration === apiStore.authorizationGeneration) {
          try {
            await initiateReauthentication(apiStore)
          } catch {
            // Navigation may interrupt authorization; a 401 is terminal for this stream attempt.
          }
        }
      }
      cleanup()
      return null
    }
    return responseWithCleanup(response, combined.signal, cleanup)
  } catch (error) {
    cleanup()
    throw error
  }
}

export const fetchChatConversationEvents = options => fetchAuthenticatedSse(options)
export const fetchHallConversationEvents = options => fetchAuthenticatedSse(options)
