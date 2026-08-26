/**
 * Combines caller, timeout, and lifecycle abort signals without dropping the
 * first abort reason. Native AbortSignal.any/timeout are preferred when
 * available; the fallback removes every listener during cleanup.
 */
export function combineAbortSignals ({ signals = [], timeout } = {}) {
  const activeSignals = signals.filter(Boolean)
  let timeoutCleanup = () => {}

  if (Number.isFinite(timeout) && timeout >= 0) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      activeSignals.push(AbortSignal.timeout(timeout))
    } else {
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort(new DOMException(`Request timed out after ${timeout}ms`, 'TimeoutError'))
      }, timeout)
      timeoutCleanup = () => clearTimeout(timer)
      activeSignals.push(controller.signal)
    }
  }

  if (activeSignals.length === 0) return { signal: undefined, cleanup: timeoutCleanup }
  if (activeSignals.length === 1) return { signal: activeSignals[0], cleanup: timeoutCleanup }

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return {
      signal: AbortSignal.any(activeSignals),
      cleanup: timeoutCleanup
    }
  }

  const controller = new AbortController()
  const listeners = []
  const abort = source => {
    if (!controller.signal.aborted) controller.abort(source.reason)
  }
  for (const source of activeSignals) {
    if (source.aborted) {
      abort(source)
      break
    }
    const listener = () => abort(source)
    source.addEventListener('abort', listener, { once: true })
    listeners.push([source, listener])
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      timeoutCleanup()
      for (const [source, listener] of listeners) source.removeEventListener?.('abort', listener)
    }
  }
}

export function throwIfAborted (signal) {
  if (!signal?.aborted) return
  throw signal.reason || new DOMException('The operation was aborted', 'AbortError')
}
