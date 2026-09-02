import { computed, ref, watch } from 'vue'
import { agentApi as defaultAgentApi } from './useHttp.js'

export const SKILL_ORDER_STATUSES = Object.freeze({
  FUNDS_HELD: 'FUNDS_HELD',
  INSTALLING: 'INSTALLING',
  ACTIVE: 'ACTIVE',
  REFUNDED: 'REFUNDED'
})

const MICRO_PER_SILVER = 1000000n
const PURCHASE_IDEMPOTENCY_STORAGE_KEY = 'cyf.skill-market.purchase-idempotency.v1'
const TERMINAL_ORDER_STATUSES = new Set([
  SKILL_ORDER_STATUSES.ACTIVE,
  SKILL_ORDER_STATUSES.REFUNDED
])

const asArray = (value) => Array.isArray(value) ? value : []
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

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
  const targetAgentId = String(agent?.agentId || agent?.id || '').trim()
  const expectedAgentVersion = agent?.expectedAgentVersion ?? agent?.agentVersion ?? agent?.version
  return {
    targetAgentId,
    expectedAgentVersion: expectedAgentVersion === undefined || expectedAgentVersion === null
      ? ''
      : String(expectedAgentVersion)
  }
}

const orderStatus = (value) => String(value?.status || value || '').toUpperCase()
const isTerminalOrder = (value) => TERMINAL_ORDER_STATUSES.has(orderStatus(value))
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

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
  const skillKey = String(skill?.skillKey || skill?.name || '').trim()
  const skillVersion = String(skill?.skillVersion || skill?.installedVersion || skill?.version || '').trim()
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

export function useSkillMarket ({
  agentApi = defaultAgentApi,
  enabled = ref(false),
  createIdempotencyKey = idempotencyKey,
  purchaseIdempotencyStorage = browserStorage(),
  wait = delay
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
  let quoteGeneration = 0
  let orderPollGeneration = 0
  let inMemoryPurchaseRecord = null

  const previewEnabled = computed(() => Boolean(enabled?.value ?? enabled))
  const target = computed(() => explicitAgent(targetAgent.value))
  const productVersionId = computed(() => String(
    selectedProduct.value?.productVersionId || selectedProduct.value?.currentVersion?.productVersionId || ''
  ).trim())
  const permissionKey = computed(() => normalizeApprovedPermissions(approvedPermissions.value).join('\u0000'))
  const quoteRequestFingerprint = computed(() => JSON.stringify({
    productVersionId: productVersionId.value,
    targetAgentId: target.value.targetAgentId,
    expectedAgentVersion: target.value.expectedAgentVersion,
    approvedPermissions: normalizeApprovedPermissions(approvedPermissions.value)
  }))
  const canRequestQuote = computed(() => previewEnabled.value && !quoteLoading.value &&
    selectedProduct.value?.canPurchase === true && Boolean(productVersionId.value) &&
    Boolean(target.value.targetAgentId) && Boolean(target.value.expectedAgentVersion))
  const canPurchase = computed(() => canRequestQuote.value && !purchaseLoading.value &&
    Boolean(quote.value?.quoteId) && quoteBinding.value === quoteRequestFingerprint.value)

  const clearQuote = () => {
    quoteGeneration += 1
    quote.value = null
    quoteBinding.value = ''
    quoteLoading.value = false
  }

  const stopOrderPolling = () => {
    orderPollGeneration += 1
    orderPolling.value = false
  }

  const setTargetAgent = (agent) => {
    clearQuote()
    stopOrderPolling()
    targetAgent.value = agent || null
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
    const id = String(productId || '').trim()
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

  const requestQuote = async () => {
    if (!canRequestQuote.value) return null
    const generation = ++quoteGeneration
    const requestFingerprint = quoteRequestFingerprint.value
    quote.value = null
    quoteBinding.value = ''
    quoteLoading.value = true
    error.value = ''
    try {
      const response = await agentApi.post('/skill-orders/quotes', {
        productVersionId: productVersionId.value,
        targetAgentId: target.value.targetAgentId,
        expectedAgentVersion: target.value.expectedAgentVersion
      }, {
        autoLoading: false,
        headers: { 'Idempotency-Key': createIdempotencyKey() }
      })
      const payload = readSkillApiPayload(response) || null
      if (generation !== quoteGeneration || requestFingerprint !== quoteRequestFingerprint.value) return null
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
    if (!currentQuote) return null
    return {
      quoteId: currentQuote.quoteId,
      productVersionId: productVersionId.value,
      targetAgentId: target.value.targetAgentId,
      expectedPriceMicro: String(currentQuote.priceMicro),
      expectedAgentVersion: target.value.expectedAgentVersion,
      approvedPermissions: normalizeApprovedPermissions(approvedPermissions.value)
    }
  }

  const readPurchaseRecord = () => {
    try {
      const stored = purchaseIdempotencyStorage?.getItem(PURCHASE_IDEMPOTENCY_STORAGE_KEY)
      return stored ? JSON.parse(stored) : inMemoryPurchaseRecord
    } catch {
      return inMemoryPurchaseRecord
    }
  }

  const persistPurchaseRecord = (record) => {
    inMemoryPurchaseRecord = record
    try { purchaseIdempotencyStorage?.setItem(PURCHASE_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(record)) } catch {}
  }

  const clearPurchaseRecord = (fingerprint) => {
    const current = readPurchaseRecord()
    if (current?.fingerprint !== fingerprint) return
    inMemoryPurchaseRecord = null
    purchaseIdempotencyKey.value = ''
    try { purchaseIdempotencyStorage?.removeItem(PURCHASE_IDEMPOTENCY_STORAGE_KEY) } catch {}
  }

  const acquirePurchaseIdempotencyKey = (fingerprint) => {
    const persisted = readPurchaseRecord()
    const record = persisted?.fingerprint === fingerprint && persisted?.key
      ? persisted
      : { fingerprint, key: createIdempotencyKey() }
    persistPurchaseRecord(record)
    purchaseIdempotencyKey.value = record.key
    return record.key
  }

  const loadEntitlements = async (agentId = target.value.targetAgentId) => {
    const id = String(agentId || '').trim()
    if (!id) {
      entitlements.value = []
      return entitlements.value
    }
    try {
      const response = await agentApi.get(`/${encodeURIComponent(id)}/skill-entitlements`, {}, { autoLoading: false })
      entitlements.value = entitlementList(readSkillApiPayload(response))
      return entitlements.value
    } catch (failure) {
      error.value = failure?.message || '技能权益加载失败'
      throw failure
    }
  }

  const refreshTerminalEntitlements = async (currentOrder) => {
    if (!isTerminalOrder(currentOrder)) return
    const agentId = currentOrder?.targetAgentId || target.value.targetAgentId
    await loadEntitlements(agentId)
  }

  const purchase = async () => {
    if (!canPurchase.value) return null
    const request = purchaseRequest()
    const currentQuote = quote.value
    const quoteTarget = String(currentQuote?.targetAgentId || request.targetAgentId).trim()
    const quoteVersion = String(currentQuote?.productVersionId || request.productVersionId).trim()
    if (quoteTarget !== request.targetAgentId || quoteVersion !== request.productVersionId ||
      quoteBinding.value !== quoteRequestFingerprint.value) {
      clearQuote()
      return null
    }

    stopOrderPolling()
    const requestFingerprint = JSON.stringify(request)
    const persistedKey = acquirePurchaseIdempotencyKey(requestFingerprint)
    purchaseLoading.value = true
    error.value = ''
    try {
      const response = await agentApi.post('/skill-orders', request, {
        autoLoading: false,
        headers: { 'Idempotency-Key': persistedKey }
      })
      order.value = readSkillApiPayload(response) || null
      clearPurchaseRecord(requestFingerprint)
      clearQuote()
      await refreshTerminalEntitlements(order.value)
      return order.value
    } catch (failure) {
      error.value = failure?.message || '技能购买失败'
      throw failure
    } finally {
      purchaseLoading.value = false
    }
  }

  const loadOrder = async (orderId = order.value?.orderId) => {
    const id = String(orderId || '').trim()
    if (!id) return null
    orderLoading.value = true
    error.value = ''
    try {
      const response = await agentApi.get(`/skill-orders/${encodeURIComponent(id)}`, {}, { autoLoading: false })
      order.value = readSkillApiPayload(response) || null
      await refreshTerminalEntitlements(order.value)
      return order.value
    } catch (failure) {
      error.value = failure?.message || '订单状态加载失败'
      throw failure
    } finally {
      orderLoading.value = false
    }
  }

  const pollOrder = async ({ maxAttempts = 6, intervalMs = 1500 } = {}) => {
    const id = String(order.value?.orderId || '').trim()
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
