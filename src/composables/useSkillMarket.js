import { computed, ref, watch } from 'vue'
import { agentApi as defaultAgentApi } from './useHttp.js'

export const SKILL_ORDER_STATUSES = Object.freeze({
  FUNDS_HELD: 'FUNDS_HELD',
  INSTALLING: 'INSTALLING',
  ACTIVE: 'ACTIVE',
  REFUNDED: 'REFUNDED'
})

const MICRO_PER_SILVER = 1000000n

const unwrap = (result) => {
  const body = result?.data ?? result
  return body && typeof body === 'object' && 'data' in body ? body.data : body
}

const asArray = (value) => Array.isArray(value) ? value : []

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

export const normalizeApprovedPermissions = (permissions) => [...new Set(
  asArray(permissions)
    .map(permission => String(permission || '').trim())
    .filter(Boolean)
)].sort((left, right) => left.localeCompare(right))

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

export const orderStatusLabel = (status) => ({
  [SKILL_ORDER_STATUSES.FUNDS_HELD]: '资金已托管，等待安装',
  [SKILL_ORDER_STATUSES.INSTALLING]: '正在安装',
  [SKILL_ORDER_STATUSES.ACTIVE]: '已激活',
  [SKILL_ORDER_STATUSES.REFUNDED]: '安装失败，已退款'
}[String(status || '').toUpperCase()] || '状态未知')

export function useSkillMarket ({
  agentApi = defaultAgentApi,
  enabled = ref(false),
  createIdempotencyKey = idempotencyKey
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
  const error = ref('')

  const previewEnabled = computed(() => Boolean(enabled?.value ?? enabled))
  const target = computed(() => explicitAgent(targetAgent.value))
  const productVersionId = computed(() => String(
    selectedProduct.value?.productVersionId || selectedProduct.value?.currentVersion?.productVersionId || ''
  ).trim())
  const permissionKey = computed(() => normalizeApprovedPermissions(approvedPermissions.value).join('\u0000'))
  const canRequestQuote = computed(() => previewEnabled.value &&
    selectedProduct.value?.canPurchase === true && Boolean(productVersionId.value) &&
    Boolean(target.value.targetAgentId) && Boolean(target.value.expectedAgentVersion))
  const canPurchase = computed(() => canRequestQuote.value && Boolean(quote.value?.quoteId))

  const clearQuote = () => { quote.value = null }

  const setTargetAgent = (agent) => {
    clearQuote()
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

  watch([() => target.value.targetAgentId, () => target.value.expectedAgentVersion, permissionKey, productVersionId], clearQuote)

  const loadProducts = async () => {
    loading.value = true
    error.value = ''
    try {
      const response = await agentApi.get('/skill-products', {}, { autoLoading: false })
      products.value = productList(unwrap(response))
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
    const response = await agentApi.get(`/skill-products/${encodeURIComponent(id)}`, {}, { autoLoading: false })
    const detail = unwrap(response)
    clearQuote()
    selectedProduct.value = detail || null
    approvedPermissions.value = []
    return selectedProduct.value
  }

  const selectProduct = (product) => {
    clearQuote()
    selectedProduct.value = product || null
    approvedPermissions.value = []
  }

  const requestQuote = async () => {
    if (!canRequestQuote.value) return null
    quoteLoading.value = true
    error.value = ''
    clearQuote()
    try {
      const response = await agentApi.post('/skill-orders/quotes', {
        productVersionId: productVersionId.value,
        targetAgentId: target.value.targetAgentId,
        expectedAgentVersion: target.value.expectedAgentVersion
      }, {
        autoLoading: false,
        headers: { 'Idempotency-Key': createIdempotencyKey() }
      })
      quote.value = unwrap(response) || null
      return quote.value
    } catch (failure) {
      error.value = failure?.message || '报价获取失败'
      throw failure
    } finally {
      quoteLoading.value = false
    }
  }

  const purchase = async () => {
    if (!canPurchase.value) return null
    const currentQuote = quote.value
    const quoteTarget = String(currentQuote?.targetAgentId || target.value.targetAgentId).trim()
    const quoteVersion = String(currentQuote?.productVersionId || productVersionId.value).trim()
    if (quoteTarget !== target.value.targetAgentId || quoteVersion !== productVersionId.value) {
      clearQuote()
      return null
    }

    purchaseLoading.value = true
    error.value = ''
    try {
      const response = await agentApi.post('/skill-orders', {
        quoteId: currentQuote.quoteId,
        productVersionId: productVersionId.value,
        targetAgentId: target.value.targetAgentId,
        expectedPriceMicro: String(currentQuote.priceMicro),
        expectedAgentVersion: target.value.expectedAgentVersion,
        approvedPermissions: normalizeApprovedPermissions(approvedPermissions.value)
      }, {
        autoLoading: false,
        headers: { 'Idempotency-Key': createIdempotencyKey() }
      })
      order.value = unwrap(response) || null
      clearQuote()
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
    const response = await agentApi.get(`/skill-orders/${encodeURIComponent(id)}`, {}, { autoLoading: false })
    order.value = unwrap(response) || null
    return order.value
  }

  const loadEntitlements = async (agentId = target.value.targetAgentId) => {
    const id = String(agentId || '').trim()
    if (!id) {
      entitlements.value = []
      return entitlements.value
    }
    const response = await agentApi.get(`/${encodeURIComponent(id)}/skill-entitlements`, {}, { autoLoading: false })
    entitlements.value = entitlementList(unwrap(response))
    return entitlements.value
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
    error,
    previewEnabled,
    target,
    productVersionId,
    canRequestQuote,
    canPurchase,
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
    loadEntitlements
  }
}
