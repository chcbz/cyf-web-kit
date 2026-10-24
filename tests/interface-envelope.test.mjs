import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parseStrictJson, encodeHttpRequest, decodeHttpResponse } from '../src/utils/apiEnvelope.js'

const bytes = readFileSync(new URL('./fixtures/interface-standard/http-envelope-fixtures.json', import.meta.url))
const fixture = JSON.parse(bytes)
const manifest = JSON.parse(readFileSync(new URL('./fixtures/interface-standard/manifest.json', import.meta.url)))
test('shared fixture digest matches the API-owned bundle', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256)
})
for (const item of fixture.cases) {
  test(item.name, () => {
    const run = () => decodeHttpResponse(item.text, {
      status: item.status, requestId: item.requestId, responseRequestId: item.requestId
    })
    if (item.valid) assert.deepEqual(run().value, JSON.parse(item.text).data)
    else assert.throws(run, error => error.code === item.errorCode && error.status === item.status)
  })
}
test('request has exactly three fields, including explicit null', () => {
  assert.deepEqual(encodeHttpRequest(undefined, 'r'), { protocolVersion: 1, requestId: 'r', data: null })
  assert.throws(() => encodeHttpRequest({}, 'x\ny'), { code: 'PROTOCOL_INVALID_ENVELOPE' })
})
test('objects cannot pollute prototypes, escaped keys are compared decoded', () => {
  const value = parseStrictJson('{"__proto__":{"polluted":true}}')
  assert.equal(Object.getPrototypeOf(value), Object.prototype)
  assert.equal({}.polluted, undefined)
  assert.equal(Object.hasOwn(value, '__proto__'), true)
})
test('strict JSON rejects incomplete and malformed tokens', () => {
  for (const text of ['[1,]', '{"a":1,}', '01', 'NaN', '1e999', 'true false', '{"a":', '"unclosed']) {
    assert.throws(() => parseStrictJson(text), { code: 'PROTOCOL_INVALID_RESPONSE' })
  }
})
test('response metadata must agree; domain data is not decoded twice', () => {
  const text = JSON.stringify({ protocolVersion: 1, requestId: 'r', code: 'E0', msg: 'ok', data: { data: 1 } })
  assert.deepEqual(decodeHttpResponse(text, { status: 200, requestId: 'r' }).value, { data: 1 })
  assert.throws(() => decodeHttpResponse(text, { status: 200, requestId: 'r', responseRequestId: 'other' }))
})

import { decodeMessage, eventMessage } from '../src/utils/messageEnvelope.js'
test('additive message metadata is ignored, never an alias or authorization source', () => {
  const request = eventMessage('r', 'agent.register', 'm', { keep: 'data' })
  assert.deepEqual(decodeMessage(JSON.stringify({ ...request, trace: 'next', type: 'another.operation', channel: 'admin', permissions: ['all'] })), request)
  const { messageType, ...missing } = request
  assert.throws(() => decodeMessage(JSON.stringify({ ...missing, type: messageType })))
  assert.throws(() => decodeMessage(JSON.stringify({ ...request, code: 'E0' })))
})
test('additive response metadata cannot turn an HTTP failure into success', () => {
  const text = JSON.stringify({ protocolVersion: 1, requestId: 'r', code: 'E403', msg: 'denied', data: null, status: 200, success: true })
  assert.throws(() => decodeHttpResponse(text, { status: 403, requestId: 'r' }), error => error.code === 'E403')
})
