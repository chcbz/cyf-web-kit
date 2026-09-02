import { computed, ref, watch } from 'vue'
import { agentApi as defaultAgentApi } from './useHttp.js'

export const SKILL_ORDER_STATUSES = Object.freeze({
  FUNDS_HELD: 'FUNDS_HELD',
  INSTALLING: 'INSTALLING',
  ACTIVE: 'ACTIVE',
  REFUNDED: 'REFUNDED'
})

const MICRO_PER_SILVER = 1000000n
const PURCHASE_JOURNAL_STORAGE_KEY = 'cyf.skill-market.purchase-journal.v2'
const PURCHASE_JOURNAL_SCHEMA_VERSION = 2
const MAX_UNRESOLVED_PURCHASES = 12
const TERMINAL_ORDER_STATUSES = new Set([
  SKILL_ORDER_STATUSES.ACTIVE,
  SKILL_ORDER_STATUSES.REFUNDED
])
const ORDER_STATUS_RANK = Object.freeze({
  [SKILL_ORDER_STATUSES.FUNDS_HELD]: 1,
  [SKILL_ORDER_STATUSES.INSTALLING]: 2,
  [SKILL_ORDER_STATUSES.ACTIVE]: 3,
  [SKILL_ORDER_STATUSES.REFUNDED]: 3
})

const asArray = (value) => Array.isArray(value) ? value : []
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const requiredString = value => String(value ?? '').trim()
const sameString = (left, right) => requiredString(left) === requiredString(right)

export const codeUnitCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0

export const normalizeApprovedPermissions = (permissions) => [...new Set(
  asArray(permissions)
    .map(permission => String(permission || '').trim())
    .filter(Boolean)
)].sort(codeUnitCompare)

export const readSkillApiPayload = (result) => {
  const body = result?.data ?? result
  if (body && typeof body === 'object' && hasOwn(body, 'code')) {
    if (body.code !== 'E0') {
      const error = new Error(body.msg || body.message || `技能市场请求失败：${body.code}`)
      error.code = body.code
      error.businessFailure = true
      throw error
    }
    return body.data
  }
  return body && typeof body === 'object' && hasOwn(body, 'data') ? body.data : body
}

const productList = (payload) => {
  if (Array.isArray(payload)) return payload
  return asArray(payload?.items || payload?.list || payload?.records || payload?.products)
}

const entitlementList = (payload) => {
  if (Array.isArray(payload)) return payload
  return asArray(payload?.items || payload?.entitlements || payload?.list || payload?.records)
}

const idempotencyKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `skill-order-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const browserStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

const explicitAgent = (agent) => {
  const targetAgentId = requiredString(agent?.agentId || agent?.id)
  const expectedAgentVersion = agent?.expectedAgentVersion ?? agent?.agentVersion ?? agent?.version
  return {
    targetAgentId,
    expectedAgentVersion: expectedAgentVersion === undefined || expectedAgentVersion === null
      ? ''
      : String(expectedAgentVersion)
  }
}

const productIdentity = (product) => ({
  skillKey: requiredString(product?.skillKey),
  skillVersion: requiredString(product?.skillVersion ?? product?.currentVersion?.skillVersion),
  productVersionId: requiredString(product?.productVersionId ?? product?.currentVersion?.productVersionId)
})

export const formatSkillProductIdentity = (product) => {
  const identity = productIdentity(product)
  return `${identity.skillKey || '未报告技能'}@${identity.skillVersion || '版本未报告'}/${identity.productVersionId || '商品版本未报告'}`
}

export const formatEntitlementSkillFact = (entitlement) => formatSkillProductIdentity(entitlement)

const orderStatus = (value) => requiredString(value?.status || value).toUpperCase()
const isTerminalOrder = (value) => TERMINAL_ORDER_STATUSES.has(orderStatus(value))
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const decimalEpochMilliseconds = (value) => {
  const raw = requiredString(value)
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : null
}
const validPriceMicro = value => /^(0|[1-9]\d*)$/.test(requiredString(value))

/** Formats decimal-string micro-silver without converting money through Number. */
export const formatSilverMicro = (amountMicro) => {
  try {
    const amount = BigInt(String(amountMicro ?? '0'))
    const sign = amount < 0n ? '-' : ''
    const absolute = amount < 0n ? -amount : amount
    const whole = absolute / MICRO_PER_SILVER
    const fraction = (absolute % MICRO_PER_SILVER).toString().padStart(6, '0').replace(/0+$/, '')
    return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ''} SILVER`
  } catch {
    return '—'
  }
}

export const formatInstalledSkillFact = (skill) => {
  if (typeof skill === 'string') return skill.trim()
  const skillKey = requiredString(skill?.skillKey || skill?.name)
  // `version` is a generic CAS/version field, never an installed skill version.
  const skillVersion = requiredString(skill?.skillVersion ?? skill?.installedVersion)
  if (skillKey && skillVersion) return `${skillKey}@${skillVersion}`
  if (skillKey) return `${skillKey}@版本未报告`
  return skillVersion ? `未报告技能@${skillVersion}` : ''
}

export const orderStatusLabel = (status) => ({
  [SKILL_ORDER_STATUSES.FUNDS_HELD]: '资金已托管，等待安装',
  [SKILL_ORDER_STATUSES.INSTALLING]: '正在安装',
  [SKILL_ORDER_STATUSES.ACTIVE]: '已激活',
  [SKILL_ORDER_STATUSES.REFUNDED]: '安装失败，已退款'
}[orderStatus(status)] || '状态未知')

const validJournalRecord = (record) => {
  const purchase = record?.purchaseRequest
  const quoted = record?.quoteRequest
  return record && typeof record === 'object' && Boolean(requiredString(record.intentFingerprint)) &&
    Boolean(requiredString(record.idempotencyKey)) && Boolean(requiredString(purchase?.quoteId)) &&
    Boolean(requiredString(purchase?.productVersionId)) && Boolean(requiredString(purchase?.targetAgentId)) &&
    Boolean(requiredString(purchase?.expectedAgentVersion)) && validPriceMicro(purchase?.expectedPriceMicro) &&
    Boolean(requiredString(quoted?.productVersionId)) && Boolean(requiredString(quoted?.targetAgentId)) &&
    Boolean(requiredString(quoted?.expectedAgentVersion)) && Array.isArray(purchase?.approvedPermissions)
}

const journalRecords = (stored) => {
  if (!stored || typeof stored !== 'object') return []
  if (stored.schemaVersion !== PURCHASE_JOURNAL_SCHEMA_VERSION || !Array.isArray(stored.records)) return []
  return stored.records.filter(validJournalRecord)
}

export function useSkillMarket ({
  agentApi = defaultAgentApi,
  enabled = ref(false),
  createIdempotencyKey = idempotencyKey,
  purchaseIdempotencyStorage = browserStorage(),
  wait = delay,
  now = () => Date.now()
} = {}) {
  const products = ref([])
  const selectedProduct = ref(null)
  const targetAgent = ref(null)
  const approvedPermissions = ref([])
  const quote = ref(null)
  const order = ref(null)
  const entitlements = ref([])
  const loading = ref(false)
  const quoteLoading = ref(false)
  const purchaseLoading = ref(false)
  const orderLoading = ref(false)
  const orderPolling = ref(false)
  const orderPollAttempts = ref(0)
  const error = ref('')
  const quoteBinding = ref('')
  const purchaseIdempotencyKey = ref('')
  const purchaseJournal = ref([])
  let quoteGeneration = 0
  let purchaseGeneration = 0
  let orderPollGeneration = 0
  let orderRequestGeneration = 0
  let entitlementGeneration = 0
  let activeOrderIdentity = null

  const previewEnabled = computed(() => Boolean(enabled?.value ?? enabled))
  const target = computed(() => explicitAgent(targetAgent.value))
  const selectedIdentity = computed(() => productIdentity(selectedProduct.value))
  const productVersionId = computed(() => selectedIdentity.value.productVersionId)
  const permissionKey = computed(() => normalizeApprovedPermissions(approvedPermissions.value).join('\u0000'))
  const intentFingerprint = computed(() => JSON.stringify({
    productVersionId: productVersionId.value,
    targetAgentId: target.value.targetAgentId,
    expectedAgentVersion: target.value.expectedAgentVersion,
    approvedPermissions: normalizeApprovedPermissions(approvedPermissions.value)
  }))
  const quoteRequestFingerprint = computed(() => JSON.stringify({
    productVersionId: productVersionId.value,
    targetAgentId: target.value.targetAgentId,
    expectedAgentVersion: target.value.expectedAgentVersion,
    approvedPermissions: normalizeApprovedPermissions(approvedPermissions.value)
  }))
  const basePurchaseIntentReady = computed(() => previewEnabled.value &&
    selectedProduct.value?.canPurchase === true && Boolean(productVersionId.value) &&
    Boolean(target.value.targetAgentId) && Boolean(target.value.expectedAgentVersion))
  const unresolvedPurchase = computed(() => purchaseJournal.value.find(record => record.intentFingerprint === intentFingerprint.value) || null)
  const quoteIsUsable = computed(() => {
    const currentQuote = quote.value
    const expiresAt = decimalEpochMilliseconds(currentQuote?.expiresAt)
    return Boolean(currentQuote?.quoteId) && validPriceMicro(currentQuote?.priceMicro) && expiresAt !== null && now() < expiresAt &&
      sameString(currentQuote?.productVersionId, productVersionId.value) &&
      sameString(currentQuote?.targetAgentId, target.value.targetAgentId) &&
      sameString(currentQuote?.expectedAgentVersion, target.value.expectedAgentVersion) &&
      quoteBinding.value === quoteRequestFingerprint.value
  })
  const canRequestQuote = computed(() => basePurchaseIntentReady.value && !quoteLoading.value && !unresolvedPurchase.value)
  const canPurchase = computed(() => basePurchaseIntentReady.value && !purchaseLoading.value &&
    (Boolean(unresolvedPurchase.value) || quoteIsUsable.value))

  const readPurchaseJournal = () => {
    try {
      const stored = purchaseIdempotencyStorage?.getItem(PURCHASE_JOURNAL_STORAGE_KEY)
      return journalRecords(stored ? JSON.parse(stored) : null)
    } catch {
      return purchaseJournal.value
    }
  }

  const persistPurchaseJournal = (records) => {
    const bounded = records.slice(0, MAX_UNRESOLVED_PURCHASES)
    purchaseJournal.value = bounded
    try {
      if (!bounded.length) purchaseIdempotencyStorage?.removeItem(PURCHASE_JOURNAL_STORAGE_KEY)
      else purchaseIdempotencyStorage?.setItem(PURCHASE_JOURNAL_STORAGE_KEY, JSON.stringify({
        schemaVersion: PURCHASE_JOURNAL_SCHEMA_VERSION,
        records: bounded
      }))
    } catch {}
  }

  purchaseJournal.value = readPurchaseJournal()

  const clearQuote = () => {
    quoteGeneration += 1
    quote.value = null
    quoteBinding.value = ''
    quoteLoading.value = false
  }

  const stopOrderPolling = () => {
    orderPollGeneration += 1
    orderRequestGeneration += 1
    orderPolling.value = false
  }

  const setTargetAgent = (agent) => {
    clearQuote()
    stopOrderPolling()
    entitlementGeneration += 1
    targetAgent.value = agent || null
    if (order.value && !sameString(order.value.targetAgentId, explicitAgent(agent).targetAgentId)) {
      order.value = null
      activeOrderIdentity = null
    }
  }
  const setApprovedPermissions = (permissions) => {
    clearQuote()
    approvedPermissions.value = normalizeApprovedPermissions(permissions)
  }
  const togglePermission = (permission, approved) => {
    const next = new Set(normalizeApprovedPermissions(approvedPermissions.value))
    if (approved) next.add(permission)
    else next.delete(permission)
    setApprovedPermissions([...next])
  }

  watch([() => target.value.targetAgentId, () => target.value.expectedAgentVersion, permissionKey, productVersionId], clearQuote, { flush: 'sync' })

  const loadProducts = async () => {
    loading.value = true
    error.value = ''
    try {
      const response = await agentApi.get('/skill-products', {}, { autoLoading: false })
      products.value = productList(readSkillApiPayload(response))
      return products.value
    } catch (failure) {
      error.value = failure?.message || '技能目录加载失败'
      throw failure
    } finally {
      loading.value = false
    }
  }

  const loadProduct = async (productId) => {
    const id = requiredString(productId)
    if (!id) return null
    try {
      const response = await agentApi.get(`/skill-products/${encodeURIComponent(id)}`, {}, { autoLoading: false })
      const detail = readSkillApiPayload(response)
      clearQuote()
      selectedProduct.value = detail || null
      approvedPermissions.value = []
      return selectedProduct.value
    } catch (failure) {
      error.value = failure?.message || '技能详情加载失败'
      throw failure
    }
  }

  const selectProduct = (product) => {
    clearQuote()
    selectedProduct.value = product || null
    approvedPermissions.value = []
  }

  const quoteRequest = () => ({
    productVersionId: productVersionId.value,
    targetAgentId: target.value.targetAgentId,
    expectedAgentVersion: target.value.expectedAgentVersion
  })

  const quoteMatchesIntent = (candidate, request) => {
    const expiresAt = decimalEpochMilliseconds(candidate?.expiresAt)
    return Boolean(requiredString(candidate?.quoteId)) && validPriceMicro(candidate?.priceMicro) && expiresAt !== null && now() < expiresAt &&
      sameString(candidate?.productVersionId, request.productVersionId) &&
      sameString(candidate?.targetAgentId, request.targetAgentId) &&
      sameString(candidate?.expectedAgentVersion, request.expectedAgentVersion)
  }

  const requestQuote = async () => {
    if (!canRequestQuote.value) return null
    const generation = ++quoteGeneration
    const requestFingerprint = quoteRequestFingerprint.value
    const request = quoteRequest()
    quote.value = null
    quoteBinding.value = ''
    quoteLoading.value = true
    error.value = ''
    try {
      const response = await agentApi.post('/skill-orders/quotes', request, {
        autoLoading: false,
        headers: { 'Idempotency-Key': createIdempotencyKey() }
      })
      const payload = readSkillApiPayload(response) || null
      if (generation !== quoteGeneration || requestFingerprint !== quoteRequestFingerprint.value) return null
      if (!quoteMatchesIntent(payload, request)) {
        error.value = '报价无效、身份不匹配或已过期，请重新获取报价'
        return null
      }
      quote.value = payload
      quoteBinding.value = requestFingerprint
      return quote.value
    } catch (failure) {
      if (generation === quoteGeneration) error.value = failure?.message || '报价获取失败'
      throw failure
    } finally {
      if (generation === quoteGeneration) quoteLoading.value = false
    }
  }

  const purchaseRequest = () => {
    const currentQuote = quote.value
    if (!currentQuote || !quoteIsUsable.value) return null
    return {
      quoteId: currentQuote.quoteId,
      productVersionId: productVersionId.value,
      targetAgentId: target.value.targetAgentId,
      expectedPriceMicro: String(currentQuote.priceMicro),
      expectedAgentVersion: target.value.expectedAgentVersion,
      approvedPermissions: normalizeApprovedPermissions(approvedPermissions.value)
    }
  }

  const matchesIntent = (request, fingerprint = intentFingerprint.value) => JSON.stringify({
    productVersionId: requiredString(request?.productVersionId),
    targetAgentId: requiredString(request?.targetAgentId),
    expectedAgentVersion: requiredString(request?.expectedAgentVersion),
    approvedPermissions: normalizeApprovedPermissions(request?.approvedPermissions)
  }) === fingerprint

  const createPurchaseRecord = (request) => {
    const current = readPurchaseJournal()
    const existing = current.find(record => record.intentFingerprint === intentFingerprint.value)
    if (existing) return existing
    if (current.length >= MAX_UNRESOLVED_PURCHASES) {
      const failure = new Error('未解决购买请求过多，请先恢复已有购买')
      failure.code = 'PURCHASE_RECOVERY_JOURNAL_FULL'
      throw failure
    }
    const record = {
      intentFingerprint: intentFingerprint.value,
      quoteRequest: quoteRequest(),
      purchaseRequest: { ...request, approvedPermissions: [...request.approvedPermissions] },
      idempotencyKey: createIdempotencyKey(),
      orderId: ''
    }
    persistPurchaseJournal([...current, record])
    return record
  }

  const updatePurchaseRecord = (record, changes) => {
    const current = readPurchaseJournal()
    const updated = { ...record, ...changes }
    persistPurchaseJournal(current.map(item => item.intentFingerprint === record.intentFingerprint ? updated : item))
    return updated
  }

  const clearTerminalPurchaseRecord = (candidate) => {
    if (!isTerminalOrder(candidate)) return
    const current = readPurchaseJournal()
    const matching = current.find(record => requiredString(record.orderId) === requiredString(candidate?.orderId) &&
      matchesIntent(record.purchaseRequest, record.intentFingerprint) &&
      sameString(record.purchaseRequest.targetAgentId, candidate?.targetAgentId) &&
      sameString(record.purchaseRequest.productVersionId, candidate?.productVersionId) &&
      sameString(record.purchaseRequest.expectedAgentVersion, candidate?.expectedAgentVersion))
    if (!matching) return
    persistPurchaseJournal(current.filter(record => record.intentFingerprint !== matching.intentFingerprint))
    if (purchaseIdempotencyKey.value === matching.idempotencyKey) purchaseIdempotencyKey.value = ''
  }

  const loadEntitlements = async (agentId = target.value.targetAgentId) => {
    const id = requiredString(agentId)
    if (!id) {
      entitlements.value = []
      return entitlements.value
    }
    const generation = ++entitlementGeneration
    try {
      const response = await agentApi.get(`/${encodeURIComponent(id)}/skill-entitlements`, {}, { autoLoading: false })
      const payload = entitlementList(readSkillApiPayload(response))
      if (generation !== entitlementGeneration || !sameString(target.value.targetAgentId, id)) return null
      entitlements.value = payload
      return entitlements.value
    } catch (failure) {
      if (generation === entitlementGeneration && sameString(target.value.targetAgentId, id)) error.value = failure?.message || '技能权益加载失败'
      throw failure
    }
  }

  const refreshTerminalEntitlements = async (currentOrder) => {
    if (!isTerminalOrder(currentOrder) || !sameString(currentOrder?.targetAgentId, target.value.targetAgentId)) return
    await loadEntitlements(currentOrder.targetAgentId)
  }

  const identityFromOrder = (currentOrder) => ({
    orderId: requiredString(currentOrder?.orderId),
    targetAgentId: requiredString(currentOrder?.targetAgentId),
    productVersionId: requiredString(currentOrder?.productVersionId),
    expectedAgentVersion: requiredString(currentOrder?.expectedAgentVersion)
  })

  const matchingOrderResponse = (candidate, expected) => Boolean(requiredString(candidate?.orderId)) &&
    sameString(candidate?.orderId, expected.orderId) &&
    sameString(candidate?.targetAgentId, expected.targetAgentId) &&
    sameString(candidate?.productVersionId, expected.productVersionId) &&
    sameString(candidate?.expectedAgentVersion, expected.expectedAgentVersion) &&
    Boolean(ORDER_STATUS_RANK[orderStatus(candidate)])

  const canAdvanceOrder = (current, candidate) => {
    if (!current) return true
    const currentStatus = orderStatus(current)
    const candidateStatus = orderStatus(candidate)
    if (isTerminalOrder(current)) return currentStatus === candidateStatus
    if (isTerminalOrder(candidate)) return true
    return (ORDER_STATUS_RANK[candidateStatus] || 0) >= (ORDER_STATUS_RANK[currentStatus] || 0)
  }

  const acceptOrder = async (candidate, expected) => {
    if (!matchingOrderResponse(candidate, expected) || !canAdvanceOrder(order.value, candidate)) return null
    order.value = candidate
    activeOrderIdentity = identityFromOrder(candidate)
    clearTerminalPurchaseRecord(candidate)
    await refreshTerminalEntitlements(candidate)
    return candidate
  }

  const purchase = async () => {
    if (!canPurchase.value) return null
    const generation = ++purchaseGeneration
    const replay = unresolvedPurchase.value
    const record = replay || createPurchaseRecord(purchaseRequest())
    const request = record?.purchaseRequest
    if (!request || !matchesIntent(request, record.intentFingerprint) || !matchesIntent(request)) return null

    stopOrderPolling()
    purchaseIdempotencyKey.value = record.idempotencyKey
    purchaseLoading.value = true
    error.value = ''
    try {
      const response = await agentApi.post('/skill-orders', request, {
        autoLoading: false,
        headers: { 'Idempotency-Key': record.idempotencyKey }
      })
      const payload = readSkillApiPayload(response) || null
      const expected = {
        orderId: requiredString(payload?.orderId),
        targetAgentId: request.targetAgentId,
        productVersionId: request.productVersionId,
        expectedAgentVersion: request.expectedAgentVersion
      }
      if (generation !== purchaseGeneration || !sameString(target.value.targetAgentId, request.targetAgentId) ||
        !matchingOrderResponse(payload, expected)) return null
      updatePurchaseRecord(record, { orderId: payload.orderId })
      const accepted = await acceptOrder(payload, expected)
      if (!accepted) return null
      clearQuote()
      return accepted
    } catch (failure) {
      if (generation === purchaseGeneration) error.value = failure?.message || '技能购买失败'
      throw failure
    } finally {
      if (generation === purchaseGeneration) purchaseLoading.value = false
    }
  }

  const loadOrder = async (orderId = order.value?.orderId) => {
    const id = requiredString(orderId)
    const expected = activeOrderIdentity || identityFromOrder(order.value)
    if (!id || !expected.orderId || !sameString(id, expected.orderId)) return null
    const generation = ++orderRequestGeneration
    orderLoading.value = true
    error.value = ''
    try {
      const response = await agentApi.get(`/skill-orders/${encodeURIComponent(id)}`, {}, { autoLoading: false })
      const payload = readSkillApiPayload(response) || null
      if (generation !== orderRequestGeneration || !sameString(order.value?.orderId, id) ||
        !sameString(target.value.targetAgentId, expected.targetAgentId)) return null
      return await acceptOrder(payload, expected)
    } catch (failure) {
      if (generation === orderRequestGeneration) error.value = failure?.message || '订单状态加载失败'
      throw failure
    } finally {
      if (generation === orderRequestGeneration) orderLoading.value = false
    }
  }

  const pollOrder = async ({ maxAttempts = 6, intervalMs = 1500 } = {}) => {
    const id = requiredString(order.value?.orderId)
    const boundedAttempts = Math.max(0, Math.min(Number(maxAttempts) || 0, 20))
    if (!id || isTerminalOrder(order.value) || boundedAttempts === 0) {
      await refreshTerminalEntitlements(order.value)
      return order.value
    }
    const generation = ++orderPollGeneration
    orderPolling.value = true
    orderPollAttempts.value = 0
    try {
      for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
        await wait(Math.max(0, Number(intervalMs) || 0))
        if (generation !== orderPollGeneration) return order.value
        orderPollAttempts.value = attempt
        const currentOrder = await loadOrder(id)
        if (generation !== orderPollGeneration || isTerminalOrder(currentOrder)) return currentOrder
      }
      return order.value
    } finally {
      if (generation === orderPollGeneration) orderPolling.value = false
    }
  }

  return {
    products,
    selectedProduct,
    targetAgent,
    approvedPermissions,
    quote,
    order,
    entitlements,
    loading,
    quoteLoading,
    purchaseLoading,
    orderLoading,
    orderPolling,
    orderPollAttempts,
    error,
    previewEnabled,
    target,
    productVersionId,
    canRequestQuote,
    canPurchase,
    purchaseIdempotencyKey,
    purchaseJournal,
    unresolvedPurchase,
    clearQuote,
    setTargetAgent,
    setApprovedPermissions,
    togglePermission,
    loadProducts,
    loadProduct,
    selectProduct,
    requestQuote,
    purchase,
    loadOrder,
    pollOrder,
    stopOrderPolling,
    loadEntitlements
  }
}
