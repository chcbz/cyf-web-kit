const JAVA_LONG_MAX = 9223372036854775807n
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)

export const canonicalSceneVersion = (value) => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null
  }
  if (typeof value === 'bigint') {
    return value >= 0n && value <= JAVA_LONG_MAX ? value.toString() : null
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  try {
    const version = BigInt(value)
    return version <= JAVA_LONG_MAX ? version.toString() : null
  } catch {
    return null
  }
}

export const compareSceneVersions = (left, right) => {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

export const publishSceneVersion = (value) => {
  const version = BigInt(value)
  return version <= MAX_SAFE_INTEGER ? Number(version) : value
}
