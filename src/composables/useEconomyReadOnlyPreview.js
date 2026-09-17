import { computed, onScopeDispose, ref, watch } from 'vue'
import { useApiStore } from '../stores/api.js'
import { evaluateReadOnlyPreviewAction, evaluateReadOnlyPreviewResponse, assessReadOnlyPreviewCapabilities } from '../utils/economyReadOnlyPreviewPolicy.js'
import { economyReadOnlyPreviewClient, readEconomyReadOnlyPreviewPayload } from './economyReadOnlyPreviewApi.js'

const initialCard = () => ({ status: 'idle', data: null, error: '' })
const canonical = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
const ownRosterAgent = agent => agent?.boundToMe === true && agent?.canOperate === true && typeof agent?.agentId === 'string' && agent.agentId.length > 0
const rosterItems = payload => Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload?.list) ? payload.list : []))
const aborted = error => error?.name === 'AbortError'

function newCard () {
  return { state: ref(initialCard()), generation: 0, controller: null }
}

/** Memory-only read state with an independent request fence for every card. */
export function useEconomyReadOnlyPreview ({ client = economyReadOnlyPreviewClient, getAuthGeneration } = {}) {
  const apiStore = useApiStore()
  const authGeneration = () => getAuthGeneration ? getAuthGeneration() : apiStore.authorizationGeneration
  const capability = ref(null)
  const capabilityError = ref('')
  const protocolError = ref('')
  const selectedAgentId = ref('')
  const agents = ref([])
  const cards = {
    capabilities: newCard(), wallet: newCard(), ledger: newCard(), catalog: newCard(), detail: newCard(),
    agentSkills: newCard(), hostingPlan: newCard(), hostingLease: newCard(), estimate: newCard(), roster: newCard()
  }
  let disposed = false

  const assessment = computed(() => assessReadOnlyPreviewCapabilities(capability.value))
  const enabled = computed(() => assessment.value.available && !protocolError.value)
  const features = computed(() => assessment.value.capabilities?.features || {})
  const scopeFingerprint = computed(() => assessment.value.capabilities?.principalScopeFingerprint || '')
  const selectedAgent = computed(() => agents.value.find(agent => agent.agentId === selectedAgentId.value) || null)
  const binding = (entry, agentId) => ({ scopeFingerprint: scopeFingerprint.value, agentId, requestGeneration: entry.generation, authGeneration: authGeneration() })
  const current = (entry, captured) => !disposed && evaluateReadOnlyPreviewResponse(binding(entry, captured.agentId), captured).accepted
  const invalidate = (entry, clear = true) => {
    entry.generation += 1
    entry.controller?.abort(new DOMException('Preview request superseded', 'AbortError'))
    entry.controller = null
    if (clear) entry.state.value = initialCard()
  }
  const begin = (entry, agentId = null, preserveData = null) => {
    invalidate(entry, false)
    const captured = binding(entry, agentId)
    entry.controller = new AbortController()
    entry.state.value = { status: 'loading', data: preserveData, error: '' }
    return captured
  }
  const finish = async (entry, action, { agentId = null, preserveData = null } = {}) => {
    const captured = begin(entry, agentId, preserveData)
    try {
      const data = await action({ signal: entry.controller.signal })
      if (!current(entry, captured)) return { accepted: false, data: null }
      entry.state.value = { status: data == null || (Array.isArray(data?.items) && data.items.length === 0) ? 'empty' : 'ready', data, error: '' }
      return { accepted: true, data }
    } catch (error) {
      if (!current(entry, captured)) return { accepted: false, data: null }
      if (!aborted(error)) entry.state.value = { status: error?.status === 503 ? 'unavailable' : 'error', data: null, error: error?.message || '读取失败，请重试。' }
      return { accepted: false, data: null }
    }
  }
  const reset = () => {
    for (const entry of Object.values(cards)) invalidate(entry)
    capability.value = null; capabilityError.value = ''; protocolError.value = ''
    selectedAgentId.value = ''; agents.value = []
  }
  const requireFeature = key => enabled.value && features.value[key] === true
  const loadCapabilities = async () => {
    const entry = cards.capabilities
    const captured = begin(entry)
    try {
      const value = await client.capabilities({ signal: entry.controller.signal })
      // Capabilities establish the scope; only card/auth generation can be compared here.
      if (disposed || entry.generation !== captured.requestGeneration || authGeneration() !== captured.authGeneration) return null
      const next = assessReadOnlyPreviewCapabilities(value)
      capability.value = value
      capabilityError.value = next.available || next.reason === 'PREVIEW_DISABLED' ? '' : '经济预览协议不可用。'
      protocolError.value = next.available || next.reason === 'PREVIEW_DISABLED' ? '' : next.reason
      entry.state.value = { status: next.available ? 'ready' : 'unavailable', data: value, error: capabilityError.value }
      return next.capabilities
    } catch (error) {
      if (!disposed && entry.generation === captured.requestGeneration && authGeneration() === captured.authGeneration && !aborted(error)) capabilityError.value = error?.message || '无法读取经济预览能力。'
      return null
    }
  }
  const loadRoster = () => finish(cards.roster, async options => {
    const response = await client.roster(options)
    return rosterItems(readEconomyReadOnlyPreviewPayload(response)).filter(ownRosterAgent)
  }).then(result => {
    if (!result.accepted) return null
    agents.value = result.data
    if (!result.data.some(agent => agent.agentId === selectedAgentId.value)) selectedAgentId.value = ''
    return result.data
  })
  const loadWallet = () => requireFeature('wallet') ? finish(cards.wallet, options => client.wallet(options)) : null
  const appendPage = (entry, previousItems, result, identity) => {
    if (!result.accepted) return null
    if (previousItems.length === 0) return result.data
    const seen = new Set(previousItems.map(identity))
    const items = [...previousItems, ...(result.data.items || []).filter(item => !seen.has(identity(item)))]
    entry.state.value = { ...entry.state.value, data: { ...result.data, items } }
    return entry.state.value.data
  }
  const loadLedger = (cursor = '') => {
    if (!requireFeature('ledger')) return null
    const prior = cursor && Array.isArray(cards.ledger.state.value.data?.items) ? cards.ledger.state.value.data.items : []
    return finish(cards.ledger, options => client.ledger({ cursor, limit: '50' }, options), { preserveData: prior.length ? cards.ledger.state.value.data : null })
      .then(result => appendPage(cards.ledger, prior, result, item => `${item?.transactionId || ''}:${item?.entryId || ''}`))
  }
  const loadCatalog = (offset = '0') => {
    if (!requireFeature('catalog')) return null
    const prior = offset !== '0' && Array.isArray(cards.catalog.state.value.data?.items) ? cards.catalog.state.value.data.items : []
    return finish(cards.catalog, options => client.catalog({ offset, limit: '50' }, options), { preserveData: prior.length ? cards.catalog.state.value.data : null })
      .then(result => appendPage(cards.catalog, prior, result, item => item?.productId || ''))
  }
  const loadDetail = productId => typeof productId === 'string' && productId ? finish(cards.detail, options => client.product(productId, options)) : null
  const loadHostingPlan = () => requireFeature('hostingPlan') ? finish(cards.hostingPlan, options => client.hostingPlan(options)) : null
  const loadAgentFacts = () => {
    const agentId = selectedAgentId.value
    if (!agentId || !ownRosterAgent(selectedAgent.value)) return null
    if (requireFeature('installationStatus')) void finish(cards.agentSkills, options => client.agentSkills(agentId, options), { agentId })
    if (requireFeature('hostingLease')) void finish(cards.hostingLease, options => client.hostingLease(agentId, options), { agentId })
    return true
  }
  const submitEstimate = payload => {
    const allowed = evaluateReadOnlyPreviewAction(capability.value, 'estimate')
    if (!allowed.allowed) { cards.estimate.state.value = { status: 'unavailable', data: null, error: '预算试算当前不可用。' }; return Promise.resolve(null) }
    return finish(cards.estimate, options => client.estimate(payload, options))
  }
  const refresh = async () => {
    reset()
    await loadCapabilities()
    if (!enabled.value) return
    await Promise.all([loadWallet(), loadLedger(), loadCatalog(), loadHostingPlan(), loadRoster()])
  }

  watch(selectedAgentId, () => {
    // Agent selection never aborts unbound wallet/catalog/estimate work.
    invalidate(cards.agentSkills); invalidate(cards.hostingLease)
    void loadAgentFacts()
  }, { flush: 'sync' })
  watch(() => apiStore.authorizationGeneration, () => reset(), { flush: 'sync' })
  onScopeDispose(() => { disposed = true; reset() })

  return { capability, capabilityError, protocolError, enabled, features, scopeFingerprint, selectedAgentId, selectedAgent, agents,
    wallet: cards.wallet.state, ledger: cards.ledger.state, catalog: cards.catalog.state, detail: cards.detail.state,
    agentSkills: cards.agentSkills.state, hostingPlan: cards.hostingPlan.state, hostingLease: cards.hostingLease.state,
    estimate: cards.estimate.state, roster: cards.roster.state, refresh, loadLedger, loadCatalog, loadDetail, loadAgentFacts, submitEstimate, canonical }
}
