import { computed, onScopeDispose, ref, watch } from 'vue'
import { useApiStore } from '../stores/api.js'
import { evaluateReadOnlyPreviewAction, evaluateReadOnlyPreviewResponse, assessReadOnlyPreviewCapabilities } from '../utils/economyReadOnlyPreviewPolicy.js'
import { economyReadOnlyPreviewClient, readEconomyReadOnlyPreviewPayload } from './economyReadOnlyPreviewApi.js'

const initialCard = () => ({ status: 'idle', data: null, error: '' })
const card = () => ref(initialCard())
const canonical = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
const ownRosterAgent = agent => agent?.boundToMe === true && agent?.canOperate === true && typeof agent?.agentId === 'string' && agent.agentId.length > 0
const rosterItems = payload => Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : [])
const aborted = error => error?.name === 'AbortError'

/**
 * Memory-only preview state. Every card is independently fenced by the authenticated
 * scope fingerprint, explicit agent selection (or null), auth generation, and request generation.
 */
export function useEconomyReadOnlyPreview ({ client = economyReadOnlyPreviewClient, getAuthGeneration } = {}) {
  const apiStore = useApiStore()
  const authGeneration = () => getAuthGeneration ? getAuthGeneration() : apiStore.authorizationGeneration
  const capability = ref(null)
  const capabilityError = ref('')
  const protocolError = ref('')
  const selectedAgentId = ref('')
  const agents = ref([])
  const wallet = card(); const ledger = card(); const catalog = card(); const detail = card()
  const agentSkills = card(); const hostingPlan = card(); const hostingLease = card(); const estimate = card(); const roster = card()
  let requestGeneration = 0
  let disposed = false
  let controller = new AbortController()

  const assessment = computed(() => assessReadOnlyPreviewCapabilities(capability.value))
  const enabled = computed(() => assessment.value.available && !protocolError.value)
  const features = computed(() => assessment.value.capabilities?.features || {})
  const scopeFingerprint = computed(() => assessment.value.capabilities?.principalScopeFingerprint || '')
  const selectedAgent = computed(() => agents.value.find(agent => agent.agentId === selectedAgentId.value) || null)

  const reset = () => {
    requestGeneration += 1
    controller.abort(new DOMException('Preview context cleared', 'AbortError'))
    controller = new AbortController()
    capability.value = null; capabilityError.value = ''; protocolError.value = ''
    selectedAgentId.value = ''; agents.value = []
    for (const state of [wallet, ledger, catalog, detail, agentSkills, hostingPlan, hostingLease, estimate, roster]) state.value = initialCard()
  }
  const binding = agentId => ({ scopeFingerprint: scopeFingerprint.value, agentId, requestGeneration, authGeneration: authGeneration() })
  const current = captured => !disposed && evaluateReadOnlyPreviewResponse(binding(captured.agentId), captured).accepted
  const begin = (state, agentId = null) => {
    const captured = binding(agentId)
    state.value = { status: 'loading', data: null, error: '' }
    return captured
  }
  const finish = async (state, action, agentId = null) => {
    const captured = begin(state, agentId)
    try {
      const data = await action({ signal: controller.signal })
      if (current(captured)) state.value = { status: data == null || (Array.isArray(data?.items) && data.items.length === 0) ? 'empty' : 'ready', data, error: '' }
      return data
    } catch (error) {
      if (current(captured) && !aborted(error)) state.value = { status: error?.status === 503 ? 'unavailable' : 'error', data: null, error: error?.message || '读取失败，请重试。' }
      return null
    }
  }
  const requireFeature = key => enabled.value && features.value[key] === true
  const loadCapabilities = async () => {
    // Capabilities establish the first scope fingerprint, so they are fenced by
    // auth/request generation but cannot be compared to a pre-capability scope.
    const capturedRequestGeneration = requestGeneration
    const capturedAuthGeneration = authGeneration()
    try {
      const value = await client.capabilities({ signal: controller.signal })
      if (disposed || capturedRequestGeneration !== requestGeneration || capturedAuthGeneration !== authGeneration()) return null
      const next = assessReadOnlyPreviewCapabilities(value)
      capability.value = value
      capabilityError.value = next.available || next.reason === 'PREVIEW_DISABLED' ? '' : '经济预览协议不可用。'
      if (!next.available && next.reason !== 'PREVIEW_DISABLED') protocolError.value = next.reason
      return next.capabilities
    } catch (error) {
      if (!disposed && capturedRequestGeneration === requestGeneration && capturedAuthGeneration === authGeneration() && !aborted(error)) capabilityError.value = error?.message || '无法读取经济预览能力。'
      return null
    }
  }
  const loadRoster = () => finish(roster, async options => {
    const response = await client.roster(options)
    return rosterItems(readEconomyReadOnlyPreviewPayload(response)).filter(ownRosterAgent)
  }).then(items => { if (items) { agents.value = items; if (!items.some(agent => agent.agentId === selectedAgentId.value)) selectedAgentId.value = '' } return items })
  const loadWallet = () => requireFeature('wallet') ? finish(wallet, options => client.wallet(options)) : null
  const appendPage = (state, previousItems, page, identity) => {
    if (!page || previousItems.length === 0 || state.value.status !== 'ready') return page
    const seen = new Set(previousItems.map(identity))
    const nextItems = [...previousItems, ...(page.items || []).filter(item => !seen.has(identity(item)))]
    state.value = { ...state.value, data: { ...page, items: nextItems } }
    return page
  }
  const loadLedger = (cursor = '') => {
    if (!requireFeature('ledger')) return null
    const previousItems = cursor && Array.isArray(ledger.value.data?.items) ? ledger.value.data.items : []
    return finish(ledger, options => client.ledger({ cursor, limit: '50' }, options))
      .then(page => appendPage(ledger, previousItems, page, item => `${item?.transactionId || ''}:${item?.entryId || ''}`))
  }
  const loadCatalog = (offset = '0') => {
    if (!requireFeature('catalog')) return null
    const previousItems = offset !== '0' && Array.isArray(catalog.value.data?.items) ? catalog.value.data.items : []
    return finish(catalog, options => client.catalog({ offset, limit: '50' }, options))
      .then(page => appendPage(catalog, previousItems, page, item => item?.productId || ''))
  }
  const loadDetail = productId => typeof productId === 'string' && productId ? finish(detail, options => client.product(productId, options)) : null
  const loadHostingPlan = () => requireFeature('hostingPlan') ? finish(hostingPlan, options => client.hostingPlan(options)) : null
  const loadAgentFacts = () => {
    const agentId = selectedAgentId.value
    if (!agentId || !ownRosterAgent(selectedAgent.value)) return null
    if (requireFeature('installationStatus')) void finish(agentSkills, options => client.agentSkills(agentId, options), agentId)
    if (requireFeature('hostingLease')) void finish(hostingLease, options => client.hostingLease(agentId, options), agentId)
  }
  const submitEstimate = payload => {
    const allowed = evaluateReadOnlyPreviewAction(capability.value, 'estimate')
    if (!allowed.allowed) { estimate.value = { status: 'unavailable', data: null, error: '预算试算当前不可用。' }; return Promise.resolve(null) }
    return finish(estimate, options => client.estimate(payload, options))
  }
  const refresh = async () => {
    reset()
    await loadCapabilities()
    if (!enabled.value) return
    await Promise.all([loadWallet(), loadLedger(), loadCatalog(), loadHostingPlan(), loadRoster()])
  }

  watch(selectedAgentId, () => { requestGeneration += 1; controller.abort(new DOMException('Agent changed', 'AbortError')); controller = new AbortController(); agentSkills.value = initialCard(); hostingLease.value = initialCard(); loadAgentFacts() })
  watch(() => apiStore.authorizationGeneration, () => reset())
  onScopeDispose(() => { disposed = true; controller.abort(new DOMException('Preview disposed', 'AbortError')) })

  return { capability, capabilityError, protocolError, enabled, features, scopeFingerprint, selectedAgentId, selectedAgent, agents, wallet, ledger, catalog, detail, agentSkills, hostingPlan, hostingLease, estimate, roster, refresh, loadLedger, loadCatalog, loadDetail, loadAgentFacts, submitEstimate, canonical }
}
