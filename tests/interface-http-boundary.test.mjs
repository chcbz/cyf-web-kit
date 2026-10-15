import test from 'node:test'
import assert from 'node:assert/strict'
import { useHttp } from '../src/composables/useHttp.js'

const reply = (value, id, status = 200, code = 'E0') => new Response(JSON.stringify({
  protocolVersion: 1, requestId: id, code, msg: status === 200 ? 'ok' : 'Rejected', data: value
}), { status, headers: { 'content-type': 'application/json', 'x-request-id': id, etag: `"${id}"` } })
const run = (options) => useHttp({ url: '/agent/test', needAuth: false, rum: false, ...options })

test('useHttp sends Q once and returns only business DTO with per-request metadata', async () => {
  const original = globalThis.fetch
  try {
    let meta
    globalThis.fetch = async (url, config) => {
      const q = JSON.parse(config.body)
      assert.deepEqual(Object.keys(q).sort(), ['data', 'protocolVersion', 'requestId'])
      assert.deepEqual(q.data, { instruction: 'read image' })
      assert.equal(q.requestId, config.headers['X-Request-Id'])
      return reply({ data: 'domain-field', version: '9007199254740993' }, q.requestId)
    }
    const http = run({ method: 'POST', data: { instruction: 'read image' }, onSuccess: (_value, metadata) => { meta = metadata } })
    const result = await http.execute()
    assert.deepEqual(result, { data: 'domain-field', version: '9007199254740993' })
    assert.deepEqual(http.data.value, result)
    assert.ok(http.response.value instanceof Response)
    assert.equal(meta.headers.etag, `"${meta.requestId}"`)
  } finally { globalThis.fetch = original }
})

test('GET has no body; null response is not an absent envelope', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (_url, config) => {
      assert.equal(config.body, undefined)
      return reply(null, config.headers['X-Request-Id'])
    }
    assert.equal(await run({ data: { ignored: true } }).execute(), null)
  } finally { globalThis.fetch = original }
})

test('HTTP rejection and gateway HTML preserve true status without success callbacks', async () => {
  const original = globalThis.fetch
  try {
    let success = false
    globalThis.fetch = async (_url, config) => reply(null, config.headers['X-Request-Id'], 403, 'E403')
    await assert.rejects(run({ onSuccess: () => { success = true } }).execute(), error => error.status === 403 && error.code === 'E403')
    globalThis.fetch = async () => new Response('<html>Bad Gateway</html>', { status: 502 })
    await assert.rejects(run().execute(), error => error.status === 502 && error.code === 'PROTOCOL_INVALID_RESPONSE')
    assert.equal(success, false)
  } finally { globalThis.fetch = original }
})

test('bodyless and binary modes do not parse the JSON envelope', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(null, { status: 204 })
    assert.equal(await run().execute(), null)
    globalThis.fetch = async () => new Response(new Uint8Array([0, 255, 1]), { headers: { 'content-type': 'image/png' } })
    const blob = await run({ responseType: 'blob' }).execute()
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([0, 255, 1]))
  } finally { globalThis.fetch = original }
})

test('concurrent metadata does not use a shared last-response slot', async () => {
  const original = globalThis.fetch
  try {
    const observed = []
    globalThis.fetch = async (_url, config) => {
      const id = config.headers['X-Request-Id']
      if (id === 'first') await new Promise(resolve => setTimeout(resolve, 5))
      return reply(id, id)
    }
    const http = run()
    await Promise.all(['first', 'second'].map(id => http.execute({ headers: { 'X-Request-Id': id },
      onSuccess: (value, metadata) => observed.push([value, metadata.requestId, metadata.headers.etag])
    })))
    assert.deepEqual(observed, [['second', 'second', '"second"'], ['first', 'first', '"first"']])
  } finally { globalThis.fetch = original }
})
