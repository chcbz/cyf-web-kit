// CYF interface-standard 1.2, protocolVersion 1. No legacy-wire fallbacks.
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => own(value, key))
export const validRequestId = value => typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)

export function protocolError (code = 'PROTOCOL_INVALID_RESPONSE', details = {}) {
  return Object.assign(new Error(code), { code, failureClass: 'protocol', ...details })
}

/** Parses JSON with duplicate-member and unsafe-number detection BEFORE information is lost. */
export function parseStrictJson (text) {
  if (typeof text !== 'string') throw protocolError()
  let offset = 0
  const bad = () => { throw protocolError() }
  const space = () => { while (/[\x20\t\n\r]/u.test(text[offset] ?? '\0')) offset++ }
  const string = () => {
    const start = offset++
    while (offset < text.length) {
      const ch = text[offset++]
      if (ch === '"') {
        try { return JSON.parse(text.slice(start, offset)) } catch { return bad() }
      }
      if (ch === '\\') offset++
    }
    return bad()
  }
  const value = () => {
    space()
    const ch = text[offset]
    if (ch === '"') return string()
    if (ch === '{') {
      offset++
      space()
      const result = {}
      if (text[offset] === '}') { offset++; return result }
      while (offset < text.length) {
        space()
        if (text[offset] !== '"') return bad()
        const key = string()
        if (own(result, key)) return bad()
        space()
        if (text[offset++] !== ':') return bad()
        Object.defineProperty(result, key, { value: value(), enumerable: true, writable: true, configurable: true })
        space()
        const next = text[offset++]
        if (next === '}') return result
        if (next !== ',') return bad()
      }
      return bad()
    }
    if (ch === '[') {
      offset++
      space()
      const result = []
      if (text[offset] === ']') { offset++; return result }
      while (offset < text.length) {
        result.push(value())
        space()
        const next = text[offset++]
        if (next === ']') return result
        if (next !== ',') return bad()
      }
      return bad()
    }
    for (const [literal, parsed] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return parsed }
    }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(text.slice(offset))
    if (!match) return bad()
    offset += match[0].length
    const number = Number(match[0])
    if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) return bad()
    return number
  }
  try {
    const result = value()
    space()
    if (offset !== text.length) return bad()
    return result
  } catch (error) {
    if (error?.code === 'PROTOCOL_INVALID_RESPONSE') throw error
    throw protocolError()
  }
}

export function encodeHttpRequest (data, requestId) {
  if (!validRequestId(requestId)) throw protocolError('PROTOCOL_INVALID_ENVELOPE')
  return { protocolVersion: 1, requestId, data: data === undefined ? null : data }
}

export function decodeHttpResponse (text, { status, requestId, responseRequestId } = {}) {
  const details = { status, requestId }
  let result
  try { result = parseStrictJson(text) } catch { throw protocolError('PROTOCOL_INVALID_RESPONSE', details) }
  if (!Number.isInteger(status) || !exactKeys(result, ['protocolVersion', 'requestId', 'code', 'msg', 'data']) ||
      result.protocolVersion !== 1 || !validRequestId(result.requestId) || typeof result.code !== 'string' ||
      !result.code || typeof result.msg !== 'string' ||
      (requestId !== undefined && result.requestId !== requestId) ||
      (responseRequestId !== undefined && result.requestId !== responseRequestId)) {
    throw protocolError('PROTOCOL_INVALID_RESPONSE', details)
  }
  const success = status >= 200 && status < 300
  if (success !== (result.code === 'E0')) throw protocolError('PROTOCOL_INVALID_RESPONSE', details)
  if (!success) {
    throw Object.assign(new Error(result.msg), {
      code: result.code, status, requestId: result.requestId, failureClass: 'http', data: result.data
    })
  }
  return { value: result.data, requestId: result.requestId }
}
