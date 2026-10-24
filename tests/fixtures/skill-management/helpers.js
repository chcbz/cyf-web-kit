import { readFileSync } from 'node:fs'
import { parseStrictJson } from '../../../src/utils/apiEnvelope.js'
export const fixtures = JSON.parse(readFileSync(new URL('./management-contract-v1.examples.json', import.meta.url), 'utf8'))
export const fixture = name => structuredClone(fixtures.cases.find(c => c.name === name).value)
export const memoryStorage = () => {
  const data = new Map()
  return { get length () { return data.size }, key: i => [...data.keys()][i], getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data }
}
export const locks = { request: async (_name, _options, fn) => fn() }
export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
export const apiFixture = () => {
  let list = fixture('skill-list').data
  // Same locked fixture, varying transport facts for the specific INSTALL consumer.
  const installRow = list.items[0]
  Object.assign(installRow, { installed: null, skillRevision: '0', upgradeEligibility: 'NOT_APPLICABLE', admissionEnabled: false, allowedActions: ['VIEW', 'INSTALL'] })
  let accepted = fixture('accepted-offline-install').data
  const requests = []
  const api = {
    async get (path, _query, options) {
      requests.push({ method: 'GET', path, options })
      if (path.endsWith('/skills')) return structuredClone(list)
      if (path.endsWith('/skill-changes')) return { agentId: list.agentId, items: [] }
      return structuredClone(accepted)
    },
    async post (path, data, options) {
      requests.push({ method: 'POST', path, data: structuredClone(data), options })
      if (path === '/skill-orders/quotes') return { ...fixture(data.action === 'INSTALL' ? 'quote-install-response' : 'quote-upgrade-response').data, expiresAt: Date.now() + 60000 }
      return structuredClone(accepted)
    }
  }
  return { api, requests, installRow, get list () { return list }, set list (value) { list = value }, get accepted () { return accepted }, set accepted (value) { accepted = value } }
}
// Exact public envelope, correlation headers, integer-token parser, no bare DTO fallback.
export const wireResponse = (options, data, status = 200, code = 'E0') => {
  const requestId = options.headers['X-Request-Id']
  return new Response(JSON.stringify({ protocolVersion: 1, requestId, code, msg: code === 'E0' ? 'ok' : '拒绝', data }), { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } })
}
export const requestData = options => options.body ? parseStrictJson(options.body, { integerTokensOnly: true }).data : null
