const identityCleanupHandlers = new Set()

/**
 * Registers work that must stop when the authenticated browser identity is removed.
 * Handlers must be idempotent because a logout can race an expired-token cleanup.
 */
export function registerIdentityCleanup (handler) {
  if (typeof handler !== 'function') throw new TypeError('identity cleanup handler must be a function')
  identityCleanupHandlers.add(handler)
  return () => identityCleanupHandlers.delete(handler)
}

export function stopIdentityBoundWork () {
  for (const handler of [...identityCleanupHandlers]) {
    try {
      handler()
    } catch {
      // Cleanup is best-effort; one stale stream must not keep other identity state alive.
    }
  }
}
