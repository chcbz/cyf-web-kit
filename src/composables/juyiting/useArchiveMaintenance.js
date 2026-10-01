import { createApi } from '../useHttp.js'

export const ARCHIVE_COLLECTION_ID = 'platform-classics'
export const ARCHIVE_SKILL = Object.freeze({ key: 'archive-maintainer' })
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)
export const unwrapAdminResult = response => { const envelope = response?.data; return envelope && typeof envelope === 'object' && hasOwn(envelope, 'data') ? envelope.data : envelope ?? null }
export const newOperationKey = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).toLowerCase()
const isAmbiguous = failure => failure?.status == null || failure?.status === 404 || failure?.status >= 500
const etag = revision => `"v${String(revision)}"`
// Browser mutations are JSON contracts. This intentionally converts Vue reactive DTOs into immutable wire data.
const wireClone = value => value == null ? value : JSON.parse(JSON.stringify(value))
const fingerprint = (method, path, body, revision) => JSON.stringify([method, path, body, revision])
export const createIdentityFence = () => { let epoch = 0; return Object.freeze({ current: () => epoch, invalidate: () => ++epoch, isCurrent: candidate => candidate === epoch }) }

export const createArchiveMaintenanceGateway = ({ adminApi = createApi('/archive/admin/v1'), readerApi = createApi('/archive/v1'), platformApi = createApi('/agent/platform-skills'), operationKey = newOperationKey } = {}) => {
  const intents = new Map()
  const release = (intent, retained) => { if (intents.get(intent) === retained) intents.delete(intent) }
  const retainedCopy = retained => retained ? wireClone(retained) : null
  const adminGet = (path, params = null, options = {}) => adminApi.get(path, params, { autoLoading: false, rum: false, ...options }).then(unwrapAdminResult)
  const readerGet = path => readerApi.get(path, null, { autoLoading: false, rum: false }).then(unwrapAdminResult)
  const mutation = async ({ intent, method = 'post', path, body = {}, revision = null, raw = false }) => {
    const immutableBody = wireClone(body); const exact = fingerprint(method, path, immutableBody, revision)
    let retained = intents.get(intent)
    if (retained && retained.fingerprint !== exact) { const error = new Error('此前请求结果未明确；请先核对或明确确认旧请求，再变更正文或版本。'); error.code = 'ARCHIVE_UNKNOWN_OPERATION'; error.retained = retainedCopy(retained); throw error }
    if (!retained) { retained = { fingerprint: exact, key: operationKey(), method, path, body: immutableBody, revision, ambiguous: false, operationId: null }; intents.set(intent, retained) }
    const headers = { 'Idempotency-Key': retained.key, ...(revision == null ? {} : { 'If-Match': etag(revision) }) }
    try {
      const target = raw ? platformApi : adminApi
      const response = method === 'execute'
        ? await target.execute({ url: path, method: 'PATCH', data: retained.body, headers, autoLoading: false, rum: false })
        : await target[method](path, retained.body, { headers, autoLoading: false, rum: false })
      const result = raw ? response?.data ?? null : unwrapAdminResult(response)
      // A 202 is not a completed mutation: preserve the exact replay key/body until GET operation
      // (or by-key) authoritatively confirms COMMITTED. A later read failure is therefore replay-safe.
      if (result?.operationId || result?.state === 'PENDING') {
        retained.operationId = result?.operationId || retained.operationId
        retained.acceptedState = result?.state || retained.acceptedState
        retained.acceptedJobId = result?.jobId || retained.acceptedJobId
        retained.ambiguous = true
      } else release(intent, retained)
      return result
    } catch (failure) { if (isAmbiguous(failure)) retained.ambiguous = true; else release(intent, retained); throw failure }
  }
  const operationForRetained = async retained => {
    if (!retained?.operationId) return null
    try {
      const operation = await adminGet(`/operations/${encodeURIComponent(retained.operationId)}`)
      return operation?.state === 'COMMITTED' ? { state: 'COMMITTED', operation } : { state: 'UNKNOWN', operation: operation || null }
    } catch (failure) {
      if (isAmbiguous(failure)) return { state: 'UNKNOWN', operation: null }
      throw failure
    }
  }
  return {
    clear: () => intents.clear(),
    retainedIntent: intent => retainedCopy(intents.get(intent)),
    retainedIntents: () => [...intents.entries()].map(([intent, value]) => ({ intent, ...retainedCopy(value) })),
    acknowledgeRetainedIntent: intent => intents.delete(intent),
    operationByKey: async intent => {
      const retained = intents.get(intent)
      if (!retained || retained.path === '/installations') return { state: 'UNSUPPORTED', retained: retainedCopy(retained) }
      const direct = await operationForRetained(retained)
      if (direct?.state === 'COMMITTED') return { ...direct, retained: retainedCopy(retained) }
      try {
        const operation = await adminGet('/operations/by-key', null, { headers: { 'Idempotency-Key': retained.key } })
        return operation?.state === 'COMMITTED'
          ? { state: 'COMMITTED', operation: wireClone(operation), retained: retainedCopy(retained) }
          : { state: 'UNKNOWN', operation: direct?.operation || wireClone(operation), retained: retainedCopy(retained) }
      } catch (failure) {
        if (isAmbiguous(failure)) return { state: 'UNKNOWN', operation: direct?.operation || null, retained: retainedCopy(retained) }
        throw failure
      }
    },
    capabilities: () => adminGet(`/collections/${ARCHIVE_COLLECTION_ID}/capabilities`), slot: () => adminGet(`/collections/${ARCHIVE_COLLECTION_ID}/slot`), appointments: () => adminGet(`/collections/${ARCHIVE_COLLECTION_ID}/appointments`), jobs: () => adminGet(`/collections/${ARCHIVE_COLLECTION_ID}/jobs`, { limit: 50 }), job: id => adminGet(`/jobs/${encodeURIComponent(id)}`), events: (id, after = '0') => adminGet(`/jobs/${encodeURIComponent(id)}/events`, { after, limit: 50 }), works: () => adminGet(`/collections/${ARCHIVE_COLLECTION_ID}/works`, { limit: 100 }), editionHistory: id => adminGet(`/works/${encodeURIComponent(id)}/editions`), edition: (workId, id) => adminGet(`/works/${encodeURIComponent(workId)}/editions/${encodeURIComponent(id)}`), operation: id => adminGet(`/operations/${encodeURIComponent(id)}`), source: id => adminGet(`/source-snapshots/${encodeURIComponent(id)}`), draft: id => adminGet(`/jobs/${encodeURIComponent(id)}/draft`), validation: id => adminGet(`/drafts/${encodeURIComponent(id)}/validation`), recoveryContext: id => adminGet(`/jobs/${encodeURIComponent(id)}/recovery-context`), workState: id => adminGet(`/collections/${ARCHIVE_COLLECTION_ID}/works/${encodeURIComponent(id)}/state`),
    readerCatalog: editionId => readerGet(`/editions/${encodeURIComponent(editionId)}/catalog`), readerBlock: (editionId, block) => readerGet(block?.blockType === 'PREFACE' ? `/editions/${encodeURIComponent(editionId)}/preface` : `/editions/${encodeURIComponent(editionId)}/chapters/${encodeURIComponent(block?.blockId || '')}`),
    catalog: () => platformApi.get('/catalog', null, { autoLoading: false, rum: false }).then(x => Array.isArray(x?.data) ? x.data : []), install: body => mutation({ intent: 'skill-install', path: '/installations', body, raw: true }), installation: id => platformApi.get(`/installations/${encodeURIComponent(id)}`, null, { autoLoading: false, rum: false }).then(x => x?.data ?? null),
    appoint: (body, revision) => mutation({ intent: 'appointment', path: `/collections/${ARCHIVE_COLLECTION_ID}/appointments`, body, revision }), revoke: (id, body, revision) => mutation({ intent: `revoke:${id}`, path: `/appointments/${encodeURIComponent(id)}/revoke`, body, revision }), prepareSource: body => mutation({ intent: 'prepare-source', path: `/collections/${ARCHIVE_COLLECTION_ID}/source-snapshots`, body }), resolveInput: (id, body, revision) => mutation({ intent: `resolve-input:${id}`, path: `/jobs/${encodeURIComponent(id)}/resolve-input`, body, revision }), draftBlock: (draftId, blockId) => adminGet(`/drafts/${encodeURIComponent(draftId)}/blocks/${encodeURIComponent(blockId)}`), putDraftBlock: (draftId, blockId, body, revision) => mutation({ intent: `block:${draftId}:${blockId}`, method: 'put', path: `/drafts/${encodeURIComponent(draftId)}/blocks/${encodeURIComponent(blockId)}`, body, revision }), patchDraft: (draftId, body, revision) => mutation({ intent: `draft-patch:${draftId}`, method: 'execute', path: `/drafts/${encodeURIComponent(draftId)}`, body, revision }), validateDraft: (draftId, revision) => mutation({ intent: `draft-validate:${draftId}`, path: `/drafts/${encodeURIComponent(draftId)}/validate`, revision }), publishDraft: (draftId, body, revision) => mutation({ intent: `draft-publish:${draftId}`, path: `/drafts/${encodeURIComponent(draftId)}/publish`, body, revision }), withdraw: (workId, editionId, body, revision) => mutation({ intent: `withdraw:${workId}:${editionId}`, path: `/works/${encodeURIComponent(workId)}/editions/${encodeURIComponent(editionId)}/withdraw`, body, revision }), confirm: body => mutation({ intent: 'maintenance-request', path: `/collections/${ARCHIVE_COLLECTION_ID}/requests`, body }), saveDraft: (id, body, revision) => mutation({ intent: `draft:${id}`, method: 'put', path: `/jobs/${encodeURIComponent(id)}/draft`, body, revision }), validate: (id, revision) => mutation({ intent: `validate:${id}`, path: `/jobs/${encodeURIComponent(id)}/validate`, revision }), publish: (id, body, revision) => mutation({ intent: `publish:${id}`, path: `/jobs/${encodeURIComponent(id)}/publish`, body, revision }), cancel: (id, body, revision) => mutation({ intent: `cancel:${id}`, path: `/jobs/${encodeURIComponent(id)}/cancel`, body, revision }), execute: (id, revision) => mutation({ intent: `execute:${id}`, path: `/jobs/${encodeURIComponent(id)}/execute`, revision }), resume: (id, body, revision) => mutation({ intent: `resume:${id}`, path: `/jobs/${encodeURIComponent(id)}/resume`, body, revision }), reassign: (id, body, revision) => mutation({ intent: `reassign:${id}`, path: `/jobs/${encodeURIComponent(id)}/reassign`, body, revision })
  }
}
