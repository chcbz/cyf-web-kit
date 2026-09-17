import { computed, ref } from 'vue'
import { useApiStore } from '../stores/api.js'
import {
  assessCommandObservabilityCapability,
  isAuthorizationFailure,
  normalizeAuditPage,
  normalizeDlqPage,
  safeOperationError,
  capabilityUnavailableMessage
} from '../utils/commandObservabilityPolicy.js'
import { commandObservabilityClient } from './commandObservabilityApi'

const initialPage = () => ({ items: [], cursor: '0', hasMore: false })
const initialCard = () => ({ status: 'idle', data: null, error: '', updatedAt: null, ...initialPage() })
const aborted = error => error?.name === 'AbortError'

/**
 * Owns only this route's GET requests. Responses are fenced by both auth generation
 * and the current user identity so an A -> B -> A change cannot revive A data.
 */
export function useCommandObservability ({
  client = commandObservabilityClient,
  getAuthGeneration,
  getIdentity
} = {}) {
  const apiStore = useApiStore()
  const authGeneration = () => getAuthGeneration ? getAuthGeneration() : apiStore.authorizationGeneration
  const currentIdentity = () => getIdentity ? getIdentity() : ''
  const capability = ref(null)
  const capabilityState = ref('idle')
  const capabilityError = ref('')
  const metrics = ref(initialCard())
  const dlq = ref(initialCard())
  const audit = ref(initialCard())
  let disposed = false
  let lifecycle = 0
  let capabilityController = null
  const controllers = { metrics: null, dlq: null, audit: null }
  const requests = { metrics: 0, dlq: 0, audit: 0 }

  const available = computed(() => capability.value?.available === true)
  const snapshot = () => ({ lifecycle, auth: authGeneration(), identity: currentIdentity() })
  const current = captured => !disposed && captured.lifecycle === lifecycle && captured.auth === authGeneration() && captured.identity === currentIdentity()
  const abortAll = () => {
    capabilityController?.abort(); capabilityController = null
    Object.keys(controllers).forEach(key => { controllers[key]?.abort(); controllers[key] = null })
  }
  const clearCards = () => { metrics.value = initialCard(); dlq.value = initialCard(); audit.value = initialCard() }
  const invalidate = () => { lifecycle += 1; abortAll(); capability.value = null; capabilityState.value = 'idle'; capabilityError.value = ''; clearCards() }

  const revoke = error => {
    lifecycle += 1
    abortAll()
    capability.value = null
    capabilityState.value = 'unavailable'
    capabilityError.value = safeOperationError(error)
    clearCards()
  }

  const loadMetrics = async (captured = snapshot()) => {
    const request = ++requests.metrics
    controllers.metrics?.abort()
    const controller = new AbortController(); controllers.metrics = controller
    metrics.value = { ...metrics.value, status: 'loading', error: '' }
    try {
      const data = await client.metrics({ signal: controller.signal })
      if (!current(captured) || request !== requests.metrics) return
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('看板指标响应格式无效。')
      metrics.value = { ...metrics.value, status: 'ready', data, error: '', updatedAt: Date.now() }
    } catch (error) {
      if (!current(captured) || request !== requests.metrics || aborted(error)) return
      if (isAuthorizationFailure(error)) return revoke(error)
      metrics.value = { ...metrics.value, status: metrics.value.data ? 'stale' : 'error', error: safeOperationError(error) }
    } finally { if (controllers.metrics === controller) controllers.metrics = null }
  }

  const loadPage = async (kind, { reset = false } = {}, captured = snapshot()) => {
    const target = kind === 'dlq' ? dlq : audit
    const cursorKey = kind === 'dlq' ? 'afterDeliveryId' : 'afterId'
    const normalize = kind === 'dlq' ? normalizeDlqPage : normalizeAuditPage
    const previous = target.value
    if (!reset && (previous.status === 'loading' || !previous.hasMore)) return
    const requestedCursor = reset ? '0' : previous.cursor
    const request = ++requests[kind]
    controllers[kind]?.abort()
    const controller = new AbortController(); controllers[kind] = controller
    target.value = { ...(reset ? initialCard() : previous), status: 'loading', error: '' }
    try {
      const page = normalize(await client[kind]({ [cursorKey]: requestedCursor, limit: '20' }, { signal: controller.signal }), requestedCursor)
      if (!current(captured) || request !== requests[kind]) return
      const idField = kind === 'dlq' ? 'deliveryId' : 'id'
      if (page.items.some(row => !row || typeof row !== 'object' || Array.isArray(row) || typeof row[idField] !== 'string' || row[idField].length === 0)) {
        const error = new Error('看板条目 ID 格式无效。')
        error.protocol = true
        throw error
      }
      const existing = reset ? [] : previous.items
      const seen = new Set(existing.map(row => row[idField]))
      const items = [...existing]
      for (const row of page.items) {
        const key = row[idField]
        if (!seen.has(key)) { seen.add(key); items.push(row) }
      }
      target.value = { status: 'ready', data: null, error: '', updatedAt: Date.now(), items, cursor: page.nextCursor || requestedCursor, hasMore: page.hasMore }
    } catch (error) {
      if (!current(captured) || request !== requests[kind] || aborted(error)) return
      if (isAuthorizationFailure(error)) return revoke(error)
      target.value = { ...previous, status: previous.items.length ? 'stale' : 'error', error: safeOperationError(error) }
    } finally { if (controllers[kind] === controller) controllers[kind] = null }
  }

  const refresh = async () => {
    lifecycle += 1
    abortAll()
    capability.value = null; capabilityState.value = 'loading'; capabilityError.value = ''; clearCards()
    const captured = snapshot()
    const controller = new AbortController(); capabilityController = controller
    try {
      const assessment = assessCommandObservabilityCapability(await client.capabilities({ signal: controller.signal }))
      if (!current(captured)) return
      capability.value = assessment.capability || null
      if (!assessment.available) {
        capabilityState.value = 'unavailable'; capabilityError.value = capabilityUnavailableMessage(assessment.reason); return
      }
      capabilityState.value = 'ready'
      await Promise.all([loadMetrics(captured), loadPage('dlq', { reset: true }, captured), loadPage('audit', { reset: true }, captured)])
    } catch (error) {
      if (!current(captured) || aborted(error)) return
      if (isAuthorizationFailure(error)) return revoke(error)
      capabilityState.value = 'error'; capabilityError.value = safeOperationError(error)
    } finally { if (capabilityController === controller) capabilityController = null }
  }

  const resetForIdentity = () => invalidate()
  const dispose = () => { disposed = true; invalidate() }
  return { capability, capabilityState, capabilityError, metrics, dlq, audit, available, refresh, loadMetrics, loadDlq: options => loadPage('dlq', options), loadAudit: options => loadPage('audit', options), resetForIdentity, dispose }
}
