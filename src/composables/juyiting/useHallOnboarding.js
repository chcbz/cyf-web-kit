export const HALL_ONBOARDING_VERSION = 'v1'
export const HALL_ONBOARDING_STORAGE_PREFIX = 'cyf:juyiting:onboarding'

const validStatuses = new Set(['skipped', 'completed'])
const controlCharacterPattern = /[\u0000-\u001f\u007f]/
const SHA_256_INITIAL_HASHES = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
])
const SHA_256_ROUND_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

function hasUnpairedSurrogate (value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1)
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) return true
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }
  return false
}

// Keep identity input byte-for-byte exact. `trim()` is used only to reject blank values.
function validStringSubject (value) {
  return typeof value === 'string' && value.trim() !== '' && !controlCharacterPattern.test(value) && !hasUnpairedSurrogate(value)
}

function validSubject (value) {
  return validStringSubject(value) || (typeof value === 'number' && Number.isSafeInteger(value))
}

function subjectInput (value) {
  if (validStringSubject(value)) return `string:${value}`
  if (typeof value === 'number' && Number.isSafeInteger(value)) return `number:${String(value)}`
  return null
}

function nonblankString (value) {
  return validStringSubject(value) ? value : null
}

function safeRead (storage, key) {
  if (!storage?.getItem) return null
  try {
    const value = storage.getItem(key)
    if (!value) return null
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function safeWrite (storage, key, value) {
  if (!storage?.setItem) return false
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function rotateRight (value, bits) {
  return (value >>> bits) | (value << (32 - bits))
}

function utf8Bytes (value) {
  // Match JavaScript's standard UTF-8 encoding: each lone surrogate becomes U+FFFD.
  const bytes = []
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index)
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1)
      if (trailing >= 0xdc00 && trailing <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + trailing - 0xdc00
        index += 1
      } else {
        codePoint = 0xfffd
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd
    }

    if (codePoint <= 0x7f) bytes.push(codePoint)
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f))
    else if (codePoint <= 0xffff) bytes.push(0xe0 | (codePoint >>> 12), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
    else bytes.push(0xf0 | (codePoint >>> 18), 0x80 | ((codePoint >>> 12) & 0x3f), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
  }
  return bytes
}

// Synchronous SHA-256 avoids exposing the subject and avoids the 32-bit FNV collision domain.
export function sha256Hex (value) {
  const bytes = utf8Bytes(value)
  const bitLength = bytes.length * 8
  bytes.push(0x80)
  while ((bytes.length % 64) !== 56) bytes.push(0)
  const high = Math.floor(bitLength / 0x100000000)
  const low = bitLength >>> 0
  for (const word of [high, low]) {
    bytes.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff)
  }

  const hashes = [...SHA_256_INITIAL_HASHES]
  const schedule = new Uint32Array(64)
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4
      schedule[index] = ((bytes[start] << 24) | (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3]) >>> 0
    }
    for (let index = 16; index < 64; index += 1) {
      const smallSigma0 = rotateRight(schedule[index - 15], 7) ^ rotateRight(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3)
      const smallSigma1 = rotateRight(schedule[index - 2], 17) ^ rotateRight(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10)
      schedule[index] = (schedule[index - 16] + smallSigma0 + schedule[index - 7] + smallSigma1) >>> 0
    }

    let [a, b, c, d, e, f, g, h] = hashes
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temp1 = (h + bigSigma1 + choose + SHA_256_ROUND_CONSTANTS[index] + schedule[index]) >>> 0
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (bigSigma0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    hashes[0] = (hashes[0] + a) >>> 0
    hashes[1] = (hashes[1] + b) >>> 0
    hashes[2] = (hashes[2] + c) >>> 0
    hashes[3] = (hashes[3] + d) >>> 0
    hashes[4] = (hashes[4] + e) >>> 0
    hashes[5] = (hashes[5] + f) >>> 0
    hashes[6] = (hashes[6] + g) >>> 0
    hashes[7] = (hashes[7] + h) >>> 0
  }

  return hashes.map(hash => hash.toString(16).padStart(8, '0')).join('')
}

export function hallOnboardingSubject (globalStore) {
  const jiacn = globalStore?.getJiacn
  if (validStringSubject(jiacn)) return jiacn

  const openid = globalStore?.getOpenid
  if (validStringSubject(openid)) return openid

  const userId = globalStore?.getUserId
  return validSubject(userId) ? userId : null
}

// The first 128 bits of SHA-256 give a deterministic, non-secret browser key with a negligible collision risk.
export function encodeHallOnboardingSubject (subject) {
  const exactTypedInput = subjectInput(subject)
  return exactTypedInput ? `u${sha256Hex(exactTypedInput).slice(0, 32)}` : 'anonymous'
}

export function hallOnboardingStorageKey (subject, version = HALL_ONBOARDING_VERSION) {
  return `${HALL_ONBOARDING_STORAGE_PREFIX}:${version}:${encodeHallOnboardingSubject(subject)}`
}

export function hallOnboardingSessionKey (subject, version = HALL_ONBOARDING_VERSION) {
  return `${hallOnboardingStorageKey(subject, version)}:session`
}

export function validateGuestDemoTemplate (value, templates) {
  if (Array.isArray(value) || typeof value !== 'string' || value.length === 0 || value.length > 32 || controlCharacterPattern.test(value)) {
    return null
  }

  const allowedIds = new Set((Array.isArray(templates) ? templates : []).map(template => template?.id))
  return allowedIds.has(value) ? value : null
}

export function consumeGuestDemoTemplateQuery (query, templates) {
  const source = query && typeof query === 'object' && !Array.isArray(query) ? query : {}
  const consumed = Object.prototype.hasOwnProperty.call(source, 'template')
  const { template, ...remainingQuery } = source

  return {
    templateId: validateGuestDemoTemplate(template, templates),
    query: remainingQuery,
    consumed
  }
}

export function createHallOnboarding (options = {}) {
  const version = nonblankString(options.version) || HALL_ONBOARDING_VERSION
  const subject = validSubject(options.subject) ? options.subject : null
  const persistentStorage = subjectInput(subject) ? options.localStorage : options.sessionStorage
  const persistentKey = hallOnboardingStorageKey(subject, version)
  const sessionKey = hallOnboardingSessionKey(subject, version)
  const persistentStatus = safeRead(persistentStorage, persistentKey)?.status
  let status = validStatuses.has(persistentStatus) ? persistentStatus : null
  let snoozed = safeRead(options.sessionStorage, sessionKey)?.snoozed === true
  let visible = !status && !snoozed

  const snapshot = () => Object.freeze({ visible, status, snoozed, subjectKey: encodeHallOnboardingSubject(subject), version })

  return Object.freeze({
    snapshot,
    open () {
      visible = true
      return snapshot()
    },
    snooze () {
      snoozed = true
      safeWrite(options.sessionStorage, sessionKey, { snoozed: true })
      visible = false
      return snapshot()
    },
    skip () {
      status = 'skipped'
      safeWrite(persistentStorage, persistentKey, { status })
      visible = false
      return snapshot()
    },
    complete () {
      status = 'completed'
      safeWrite(persistentStorage, persistentKey, { status })
      visible = false
      return snapshot()
    }
  })
}
