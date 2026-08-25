export const TASK_EVENT_VERSION_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/
export const TASK_EVENT_LONG_MAX = 9223372036854775807n

export function parseTaskEventVersion (value) {
  if (typeof value !== 'string' || !TASK_EVENT_VERSION_PATTERN.test(value)) return null
  try {
    return BigInt(value) <= TASK_EVENT_LONG_MAX ? value : null
  } catch {
    return null
  }
}

export function requireTaskEventVersion (value) {
  const version = parseTaskEventVersion(value)
  if (version == null) throw new TypeError('Task event version must be a canonical Java Long decimal string')
  return version
}

export function compareTaskEventVersions (left, right) {
  return BigInt(requireTaskEventVersion(left)) < BigInt(requireTaskEventVersion(right))
    ? -1
    : BigInt(left) > BigInt(right)
      ? 1
      : 0
}

export function nextTaskEventVersion (value) {
  const next = BigInt(requireTaskEventVersion(value)) + 1n
  if (next > TASK_EVENT_LONG_MAX) return null
  return next.toString()
}
