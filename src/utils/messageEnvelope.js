import { parseStrictJson, validRequestId, protocolError } from './apiEnvelope.js'
const required = ['protocolVersion', 'requestId', 'messageType', 'messageId', 'data']
const replyFields = ['correlationId', 'code', 'msg']
const type = value => typeof value === 'string' && /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(value)
export function validateMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw protocolError('PROTOCOL_INVALID_MESSAGE')
  const reply = replyFields.some(key => Object.hasOwn(value, key))
  const keys = reply ? [...required, ...replyFields] : required
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
      || value.protocolVersion !== 1 || !validRequestId(value.requestId) || !validRequestId(value.messageId) || !type(value.messageType)
      || reply && (!validRequestId(value.correlationId) || typeof value.code !== 'string' || !value.code.trim() || typeof value.msg !== 'string')) throw protocolError('PROTOCOL_INVALID_MESSAGE')
  return value
}
export const decodeMessage = text => validateMessage(parseStrictJson(text))
export const eventMessage = (requestId, messageType, messageId, data = null) => validateMessage({ protocolVersion: 1, requestId, messageType, messageId, data })
export const replyMessage = (original, messageType, messageId, code, msg, data = null) => {
  validateMessage(original)
  return validateMessage({ protocolVersion: 1, requestId: original.requestId, messageType, messageId, data, correlationId: original.messageId, code, msg })
}
