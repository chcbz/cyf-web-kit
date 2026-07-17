export type InteractionLock = {
  lock(reason: string): void
  unlock(reason: string): void
  isLocked(): boolean
  reasons(): readonly string[]
}

const normalizedReason = (reason: string): string => typeof reason === 'string' ? reason.trim() : ''

export const createInteractionLock = (): InteractionLock => {
  const counts = new Map<string, number>()
  return {
    lock(reason) {
      const normalized = normalizedReason(reason)
      if (normalized === '') return
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    },
    unlock(reason) {
      const normalized = normalizedReason(reason)
      if (normalized === '') return
      const count = counts.get(normalized) ?? 0
      if (count <= 1) counts.delete(normalized)
      else counts.set(normalized, count - 1)
    },
    isLocked: () => counts.size > 0,
    reasons: () => Object.freeze([...counts.keys()].sort())
  }
}
