const ISO_CONTROL = /[\u0000-\u001F\u007F-\u009F]/g
const HAS_ISO_CONTROL = /[\u0000-\u001F\u007F-\u009F]/
const PERCENT_UTF8_LEAD = /%(?:[cC][2-9a-fA-F]|[dD][0-9a-fA-F]|[eE][0-9a-fA-F]|[fF][0-4])(?=%[89aAbB][0-9a-fA-F])/u

const latin1Bytes = (value) => {
  const bytes = Array.from(value, character => character.codePointAt(0))
  return bytes.every(byte => byte <= 0xff) ? bytes : null
}

const hasUtf8LeadAndContinuation = (bytes) => bytes.some((byte, index) => {
  const continuationCount = byte >= 0xc2 && byte <= 0xdf ? 1
    : byte >= 0xe0 && byte <= 0xef ? 2
      : byte >= 0xf0 && byte <= 0xf4 ? 3 : 0
  return continuationCount > 0 && bytes.slice(index + 1, index + 1 + continuationCount)
    .every(nextByte => nextByte >= 0x80 && nextByte <= 0xbf)
})

const isLegacyIrreversibleFragment = (value) => {
  const bytes = latin1Bytes(value)
  if (!bytes) return false
  const leadCount = bytes.filter(byte => byte >= 0xc2 && byte <= 0xf4).length
  const continuationCount = bytes.filter(byte => byte >= 0x80 && byte <= 0xbf).length
  return leadCount >= 2 && continuationCount >= 1
}

const repairRawLatin1Mojibake = (value) => {
  const bytes = latin1Bytes(value)
  const Decoder = globalThis.TextDecoder
  const Encoder = globalThis.TextEncoder
  if (!bytes || !Decoder || !Encoder || !hasUtf8LeadAndContinuation(bytes)) return value

  try {
    const decoded = new Decoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
    const roundTrip = Array.from(new Encoder().encode(decoded))
    const matches = roundTrip.length === bytes.length && roundTrip.every((byte, index) => byte === bytes[index])
    return matches && decoded && !HAS_ISO_CONTROL.test(decoded) ? decoded : value
  } catch {
    return value
  }
}

/**
 * Compatibility-only rendering policy for legacy account and chat display values.
 * It deliberately repairs only byte-exact, fatal UTF-8 round trips.
 */
export const normalizeDisplayName = (value) => {
  if (typeof value !== 'string') return ''
  let normalized = value
  if (PERCENT_UTF8_LEAD.test(normalized)) {
    try {
      normalized = decodeURIComponent(normalized)
    } catch {
      // Keep malformed percent input and safely clean it below.
    }
  }
  normalized = repairRawLatin1Mojibake(normalized)
  return normalized.replace(ISO_CONTROL, '').trim()
}

export const resolveDisplayName = (value, fallback = '') => {
  const normalized = normalizeDisplayName(value)
  if (normalized && !isLegacyIrreversibleFragment(normalized)) return normalized
  return normalizeDisplayName(fallback)
}

export const resolveAccountDisplayName = (user, fallback = '用户') => {
  return resolveDisplayName(user?.nickname) || resolveDisplayName(user?.username) || resolveDisplayName(fallback) || '用户'
}

const currentJiacn = (identity) => {
  if (typeof identity === 'string') return identity
  return identity?.jiacn || identity?.ownerJiacn || ''
}

/**
 * Only a stable server identity establishes historical ownership. Optimistic rows
 * retain their explicit isSelf marker until the server-backed history replaces them.
 */
export const isOwnMessage = (message, identity) => {
  if (message?.isSelf === true) return true
  const jiacn = currentJiacn(identity)
  if (typeof jiacn !== 'string' || !jiacn) return false
  const owner = typeof message?.owner === 'string' ? message.owner : message?.owner?.jiacn
  return [message?.jiacn, message?.ownerJiacn, owner].some(candidate =>
    typeof candidate === 'string' && candidate === jiacn)
}
