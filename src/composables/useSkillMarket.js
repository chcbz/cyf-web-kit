import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import { agentApi as defaultAgentApi } from './useHttp.js'
import { formatSilverMicro as formatCanonicalSilverMicro, isCanonicalMicroAmount } from '../utils/silverAmount.js'

export const SKILL_ORDER_STATUSES = Object.freeze({
  FUNDS_HELD: 'FUNDS_HELD',
  INSTALLING: 'INSTALLING',
  ACTIVE: 'ACTIVE',
  REFUNDED: 'REFUNDED'
})

const PURCHASE_JOURNAL_STORAGE_KEY_PREFIX = 'cyf.skill-market.purchase-journal.v3'
const PURCHASE_JOURNAL_SCHEMA_VERSION = 3
const PURCHASE_OPERATION_LOCK_PREFIX = 'cyf.skill-market.purchase-operation.v1'
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
const canonicalDecimalString = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? value : ''
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
    // Versions are Java Long/CAS values on the wire: numbers would lose precision.
    expectedAgentVersion: canonicalDecimalString(expectedAgentVersion)
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
  const raw = typeof value === 'string' ? value : ''
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : null
}
const validPriceMicro = isCanonicalMicroAmount
const validVersion = canonicalDecimalString

/** Formats canonical decimal-string micro-silver without Number conversion. */
export const formatSilverMicro = value => {
  try { return formatCanonicalSilverMicro(value) } catch { return '—' }
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

const operationLockError = () => {
  const failure = new Error('当前浏览器不支持安全的跨标签购买锁；购买操作已禁用。')
  failure.code = 'PURCHASE_MULTITAB_LOCK_UNAVAILABLE'
  return failure
}

const isAmbiguousTransportFailure = (failure) => !failure?.businessFailure && !failure?.response &&
  !failure?.status && !failure?.statusCode && !failure?.httpStatus
const DEFINITIVE_NO_ORDER_FAILURE_CODES = new Set([
  'PRICE_CHANGED', 'STALE_AGENT', 'PERMISSION_DENIED', 'ALREADY_ENTITLED', 'IDEMPOTENCY_CONFLICT'
])
const isDefinitiveNoOrderFailure = failure => DEFINITIVE_NO_ORDER_FAILURE_CODES.has(failure?.code)

const storageError = () => {
  const failure = new Error('购买恢复记录无法安全保存或读取；请检查浏览器存储权限和可用空间后重试。')
  failure.code = 'PURCHASE_RECOVERY_STORAGE_UNAVAILABLE'
  return failure
}

const scopedJournalStorageKey = (actorScopeKey) => {
  const scope = requiredString(actorScopeKey)
  return scope ? `${PURCHASE_JOURNAL_STORAGE_KEY_PREFIX}.${encodeURIComponent(scope)}` : ''
}

const validJournalRecord = (record) => {
  const purchase = record?.purchaseRequest
  const quoted = record?.quoteRequest
  const quoteKey = requiredString(record?.quoteIdempotencyKey)
  const orderKey = requiredString(record?.orderIdempotencyKey)
  const common = record && typeof record === 'object' && Boolean(requiredString(record.intentFingerprint)) &&
    Boolean(requiredString(record.productVersionId)) && Boolean(requiredString(record.targetAgentId)) &&
    Boolean(validVersion(record.expectedAgentVersion)) && Boolean(requiredString(quoted?.productVersionId)) &&
    Boolean(requiredString(quoted?.targetAgentId)) && Boolean(validVersion(quoted?.expectedAgentVersion)) &&
    Array.isArray(record.approvedPermissions)
  if (!common || !sameString(record.productVersionId, quoted.productVersionId) ||
    !sameString(record.targetAgentId, quoted.targetAgentId) ||
    !sameString(record.expectedAgentVersion, quoted.expectedAgentVersion)) return false
  if (record.phase === 'QUOTE') return Boolean(quoteKey) && !purchase && !orderKey
  return record.phase === 'ORDER' && Boolean(quoteKey) && Boolean(orderKey) && purchase &&
    Boolean(requiredString(purchase.quoteId)) && Boolean(requiredString(purchase.productVersionId)) &&
    Boolean(requiredString(purchase.targetAgentId)) && Boolean(validVersion(purchase.expectedAgentVersion)) &&
    validPriceMicro(purchase.expectedPriceMicro) && Array.isArray(purchase.approvedPermissions) &&
    sameString(purchase.productVersionId, record.productVersionId) &&
    sameString(purchase.targetAgentId, record.targetAgentId) &&
    sameString(purchase.expectedAgentVersion, record.expectedAgentVersion) &&
    JSON.stringify(normalizeApprovedPermissions(purchase.approvedPermissions)) === JSON.stringify(record.approvedPermissions)
}

const journalRecords = (stored) => {
  if (!stored || typeof stored !== 'object') return []
  if (stored.schemaVersion !== PURCHASE_JOURNAL_SCHEMA_VERSION || !Array.isArray(stored.records)) return []
  return stored.records.filter(validJournalRecord).slice(0, MAX_UNRESOLVED_PURCHASES)
}

export function useSkillMarket ({
  agentApi = defaultAgentApi,
  enabled = ref(false),
  createIdempotencyKey = idempotencyKey,
  purchaseIdempotencyStorage = browserStorage(),
  /** Required opaque tenant/client/principal fingerprint from authenticated app state. */
  actorScopeKey = '',
  wait = delay,
  now = () => Date.now(),
  /** Web Locks API injection is only for isolated tests; production uses navigator.locks. */
  operationLocks = typeof navigator !== 'undefined' ? navigator.locks : null,
  recoveryPollOptions = { maxAttempts: 6, intervalMs: 1500 }
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
  let productRequestGeneration = 0
  let purchaseGeneration = 0
  let orderPollGeneration = 0
  let orderRequestGeneration = 0
  let entitlementGeneration = 0
  let activeOrderIdentity = null
  let disposed = false
  let operationAbortController = new AbortController()

  const previewEnabled = computed(() => Boolean(enabled?.value ?? enabled))
  const actorScopeFingerprint = computed(() => requiredString(actorScopeKey?.value ?? actorScopeKey))
  const journalStorageKey = computed(() => scopedJournalStorageKey(actorScopeFingerprint.value))
  const storageAvailable = ref(false)
  const operationLockAvailable = computed(() => Boolean(operationLocks && typeof operationLocks.request === 'function'))
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
  const basePurchaseIntentReady = computed(() => previewEnabled.value && storageAvailable.value && operationLockAvailable.value &&
    selectedProduct.value?.canPurchase === true && Boolean(productVersionId.value) &&
    Boolean(target.value.targetAgentId) && Boolean(target.value.expectedAgentVersion))
  const unresolvedPurchase = computed(() => purchaseJournal.value.find(record => record.intentFingerprint === intentFingerprint.value) || null)
  const hasUnresolvedOperation = computed(() => purchaseJournal.value.length > 0)
  const hasUnresolvedOtherOperation = computed(() => purchaseJournal.value.some(record => record.intentFingerprint !== intentFingerprint.value))
  const unresolvedOperations = computed(() => purchaseJournal.value)
  const quoteIsUsable = computed(() => {
    const currentQuote = quote.value
    const expiresAt = decimalEpochMilliseconds(currentQuote?.expiresAt)
    return Boolean(requiredString(currentQuote?.quoteId)) && validPriceMicro(currentQuote?.priceMicro) && expiresAt !== null && now() < expiresAt &&
      sameString(currentQuote?.productVersionId, productVersionId.value) &&
      sameString(currentQuote?.targetAgentId, target.value.targetAgentId) &&
      sameString(currentQuote?.expectedAgentVersion, target.value.expectedAgentVersion) &&
      quoteBinding.value === quoteRequestFingerprint.value
  })
  // An uncertain request may already have reached the server. Scope-wide blocking prevents a second
  // intent from being persisted or dispatched until the exact operation is explicitly resumed/checked.
  const canRequestQuote = computed(() => basePurchaseIntentReady.value && !quoteLoading.value && !hasUnresolvedOperation.value)
  const canPurchase = computed(() => basePurchaseIntentReady.value && !purchaseLoading.value && !hasUnresolvedOtherOperation.value &&
    (Boolean(unresolvedPurchase.value?.phase === 'ORDER') || quoteIsUsable.value))

  const readPurchaseJournal = () => {
    const key = journalStorageKey.value
    if (!key || !purchaseIdempotencyStorage) {
      storageAvailable.value = false
      return []
    }
    try {
      const stored = purchaseIdempotencyStorage.getItem(key)
      const records = stored === null ? [] : journalRecords(JSON.parse(stored))
      // A malformed scoped journal cannot safely be treated as empty.
      if (stored !== null && (!Array.isArray(JSON.parse(stored)?.records) || records.length !== JSON.parse(stored).records.length)) throw storageError()
      storageAvailable.value = true
      return records
    } catch (failure) {
      storageAvailable.value = false
      error.value = storageError().message
      return []
    }
  }

  const operationLockName = () => {
    const scope = actorScopeFingerprint.value
    return scope ? `${PURCHASE_OPERATION_LOCK_PREFIX}.${encodeURIComponent(scope)}` : ''
  }

  const awaitAbortable = (promise) => {
    const signal = operationAbortController.signal
    if (signal.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'))
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve(promise).then(
        value => { signal.removeEventListener('abort', onAbort); resolve(value) },
        failure => { signal.removeEventListener('abort', onAbort); reject(failure) }
      )
    })
  }

  const cancelScopeOperations = () => {
    quoteGeneration += 1
    productRequestGeneration += 1
    purchaseGeneration += 1
    orderPollGeneration += 1
    orderRequestGeneration += 1
    entitlementGeneration += 1
    operationAbortController.abort(new DOMException('Market scope changed', 'AbortError'))
    if (!disposed) operationAbortController = new AbortController()
    quoteLoading.value = false
    purchaseLoading.value = false
    orderLoading.value = false
    orderPolling.value = false
  }

  const withOperationLock = async (operation) => {
    const name = operationLockName()
    if (!name || !operationLockAvailable.value || disposed) {
      error.value = operationLockError().message
      throw operationLockError()
    }
    try {
      return await operationLocks.request(name, { mode: 'exclusive', signal: operationAbortController.signal }, async (lock) => {
        if (!lock || disposed) throw operationLockError()
        return operation()
      })
    } catch (failure) {
      if (failure?.name === 'AbortError' || disposed) throw failure
      throw failure
    }
  }

  const persistPurchaseJournal = (records) => {
    const key = journalStorageKey.value
    const bounded = records.slice(0, MAX_UNRESOLVED_PURCHASES)
    if (!key || !purchaseIdempotencyStorage) {
      storageAvailable.value = false
      error.value = '缺少已认证的购买范围，购买已禁用。'
      throw storageError()
    }
    try {
      if (!bounded.length) {
        purchaseIdempotencyStorage.removeItem(key)
        if (purchaseIdempotencyStorage.getItem(key) !== null) throw storageError()
      } else {
        const serialized = JSON.stringify({ schemaVersion: PURCHASE_JOURNAL_SCHEMA_VERSION, records: bounded })
        purchaseIdempotencyStorage.setItem(key, serialized)
        if (purchaseIdempotencyStorage.getItem(key) !== serialized) throw storageError()
      }
      purchaseJournal.value = bounded
      storageAvailable.value = true
      return bounded
    } catch (failure) {
      storageAvailable.value = false
      error.value = storageError().message
      throw storageError()
    }
  }

  watch(journalStorageKey, () => {
    quote.value = null
    quoteBinding.value = ''
    purchaseJournal.value = readPurchaseJournal()
  }, { immediate: true })

  watch(actorScopeFingerprint, (next, previous) => {
    if (previous === undefined || next === previous) return
    cancelScopeOperations()
    quote.value = null
    quoteBinding.value = ''
    order.value = null
    activeOrderIdentity = null
    entitlements.value = []
  })

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
      const response = await awaitAbortable(agentApi.get('/skill-products', {}, { autoLoading: false, signal: operationAbortController.signal }))
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
    const generation = ++productRequestGeneration
    try {
      const response = await awaitAbortable(agentApi.get(`/skill-products/${encodeURIComponent(id)}`, {}, { autoLoading: false, signal: operationAbortController.signal }))
      const detail = readSkillApiPayload(response)
      if (generation !== productRequestGeneration) return null
      clearQuote()
      if (isTerminalOrder(order.value) && !sameString(order.value?.productVersionId, productIdentity(detail).productVersionId)) {
        order.value = null
        activeOrderIdentity = null
      }
      selectedProduct.value = detail || null
      approvedPermissions.value = []
      return selectedProduct.value
    } catch (failure) {
      if (generation === productRequestGeneration) error.value = failure?.message || '技能详情加载失败'
      throw failure
    }
  }

  const selectProduct = (product) => {
    productRequestGeneration += 1
    clearQuote()
    if (isTerminalOrder(order.value) && !sameString(order.value?.productVersionId, productIdentity(product).productVersionId)) {
      order.value = null
      activeOrderIdentity = null
    }
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
      validVersion(candidate?.expectedAgentVersion) &&
      sameString(candidate?.expectedAgentVersion, request.expectedAgentVersion)
  }

  const recordFingerprint = (request, permissions) => JSON.stringify({
    productVersionId: requiredString(request?.productVersionId),
    targetAgentId: requiredString(request?.targetAgentId),
    expectedAgentVersion: validVersion(request?.expectedAgentVersion),
    approvedPermissions: normalizeApprovedPermissions(permissions)
  })

  const createQuoteRecord = () => {
    const request = quoteRequest()
    const permissions = normalizeApprovedPermissions(approvedPermissions.value)
    const fingerprint = recordFingerprint(request, permissions)
    const current = readPurchaseJournal()
    const existing = current.find(record => record.intentFingerprint === fingerprint)
    if (existing) return existing
    if (current.length >= MAX_UNRESOLVED_PURCHASES) {
      const failure = new Error('未解决购买请求过多，请先恢复已有购买')
      failure.code = 'PURCHASE_RECOVERY_JOURNAL_FULL'
      throw failure
    }
    const record = {
      phase: 'QUOTE',
      intentFingerprint: fingerprint,
      productVersionId: request.productVersionId,
      targetAgentId: request.targetAgentId,
      expectedAgentVersion: request.expectedAgentVersion,
      approvedPermissions: permissions,
      quoteRequest: { ...request },
      quoteIdempotencyKey: createIdempotencyKey(),
      purchaseRequest: null,
      orderIdempotencyKey: '',
      orderId: ''
    }
    persistPurchaseJournal([...current, record])
    return record
  }

  const updatePurchaseRecord = (record, changes) => {
    const current = readPurchaseJournal()
    const updated = { ...record, ...changes }
    if (!current.some(item => item.intentFingerprint === record.intentFingerprint)) throw storageError()
    persistPurchaseJournal(current.map(item => item.intentFingerprint === record.intentFingerprint ? updated : item))
    return updated
  }

  const clearQuotePurchaseRecord = (record) => {
    const current = readPurchaseJournal()
    if (!current.some(item => item.intentFingerprint === record?.intentFingerprint && item.phase === 'QUOTE')) return
    persistPurchaseJournal(current.filter(item => item.intentFingerprint !== record.intentFingerprint))
  }

  const createOrderRecord = (record) => {
    const currentQuote = quote.value
    if (!currentQuote || !quoteIsUsable.value || record?.phase !== 'QUOTE') return null
    const purchaseRequest = {
      quoteId: currentQuote.quoteId,
      productVersionId: record.productVersionId,
      targetAgentId: record.targetAgentId,
      expectedPriceMicro: currentQuote.priceMicro,
      expectedAgentVersion: record.expectedAgentVersion,
      approvedPermissions: [...record.approvedPermissions]
    }
    return updatePurchaseRecord(record, {
      phase: 'ORDER',
      purchaseRequest,
      orderIdempotencyKey: createIdempotencyKey()
    })
  }

  const restoreOperation = (record) => {
    if (!validJournalRecord(record)) return null
    const matchingProduct = products.value.find(product => sameString(productIdentity(product).productVersionId, record.productVersionId))
    productRequestGeneration += 1
    clearQuote()
    selectedProduct.value = matchingProduct || {
      productVersionId: record.productVersionId,
      canPurchase: true,
      recoveryOnly: true
    }
    targetAgent.value = { agentId: record.targetAgentId, version: record.expectedAgentVersion }
    approvedPermissions.value = [...record.approvedPermissions]
    return record
  }

  const sendQuoteRecord = async (record) => {
    if (!validJournalRecord(record) || record.phase !== 'QUOTE') return null
    const generation = ++quoteGeneration
    const request = { ...record.quoteRequest }
    quote.value = null
    quoteBinding.value = ''
    quoteLoading.value = true
    error.value = ''
    try {
      const response = await awaitAbortable(agentApi.post('/skill-orders/quotes', request, {
        autoLoading: false,
        signal: operationAbortController.signal,
        headers: { 'Idempotency-Key': record.quoteIdempotencyKey }
      }))
      const payload = readSkillApiPayload(response) || null
      if (!quoteMatchesIntent(payload, request)) {
        clearQuotePurchaseRecord(record)
        if (generation === quoteGeneration) error.value = '报价无效、身份不匹配或已过期；可重新获取报价'
        return null
      }
      if (generation !== quoteGeneration || !sameString(target.value.targetAgentId, request.targetAgentId) ||
        !sameString(target.value.expectedAgentVersion, request.expectedAgentVersion)) return null
      quote.value = payload
      quoteBinding.value = record.intentFingerprint
      return payload
    } catch (failure) {
      // A business/HTTP outcome is definitive: it cannot be replayed as an uncertain mutation.
      if (!isAmbiguousTransportFailure(failure)) clearQuotePurchaseRecord(record)
      if (generation === quoteGeneration) error.value = failure?.message || (isAmbiguousTransportFailure(failure) ? '报价获取失败；可使用恢复操作重放原请求' : '报价请求被拒绝；可重新获取报价')
      throw failure
    } finally {
      if (generation === quoteGeneration) quoteLoading.value = false
    }
  }

  const requestQuote = async () => {
    if (!operationLockAvailable.value) {
      error.value = operationLockError().message
      return null
    }
    if (!canRequestQuote.value) {
      if (hasUnresolvedOperation.value && !error.value) error.value = '已有未解决购买请求，请先使用恢复操作检查或重放原请求'
      return null
    }
    return withOperationLock(async () => {
      // Re-read under the actor-wide exclusive lock: another tab may have persisted an uncertain intent.
      const current = readPurchaseJournal()
      purchaseJournal.value = current
      if (current.length) {
        error.value = '已有未解决购买请求，请先使用恢复操作检查或重放原请求'
        return null
      }
      const record = createQuoteRecord()
      const quoted = await sendQuoteRecord(record)
      if (!quoted && !error.value) error.value = '报价无效、身份不匹配或已过期；可重新获取报价'
      return quoted
    })
  }

  const matchesIntent = (request, fingerprint) => recordFingerprint(request, request?.approvedPermissions) === fingerprint

  const clearTerminalPurchaseRecord = async (candidate, insideOperationLock = false) => {
    if (!isTerminalOrder(candidate)) return
    const clear = () => {
      const current = readPurchaseJournal()
      const matching = current.find(record => record.phase === 'ORDER' && requiredString(record.orderId) === requiredString(candidate?.orderId) &&
        matchesIntent(record.purchaseRequest, record.intentFingerprint) &&
        sameString(record.purchaseRequest.targetAgentId, candidate?.targetAgentId) &&
        sameString(record.purchaseRequest.productVersionId, candidate?.productVersionId) &&
        sameString(record.purchaseRequest.expectedAgentVersion, candidate?.expectedAgentVersion))
      if (!matching) return
      persistPurchaseJournal(current.filter(record => record.intentFingerprint !== matching.intentFingerprint))
      if (purchaseIdempotencyKey.value === matching.orderIdempotencyKey) purchaseIdempotencyKey.value = ''
    }
    if (insideOperationLock) return clear()
    return withOperationLock(clear)
  }

  const loadEntitlements = async (agentId = target.value.targetAgentId) => {
    const id = requiredString(agentId)
    if (!id) {
      entitlements.value = []
      return entitlements.value
    }
    const generation = ++entitlementGeneration
    try {
      const response = await awaitAbortable(agentApi.get(`/${encodeURIComponent(id)}/skill-entitlements`, {}, { autoLoading: false, signal: operationAbortController.signal }))
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
    expectedAgentVersion: validVersion(currentOrder?.expectedAgentVersion)
  })

  const matchingOrderResponse = (candidate, expected) => Boolean(requiredString(candidate?.orderId)) &&
    Boolean(validVersion(candidate?.expectedAgentVersion)) && Boolean(validVersion(expected?.expectedAgentVersion)) &&
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

  const acceptOrder = async (candidate, expected, insideOperationLock = false) => {
    const sameOrder = sameString(order.value?.orderId, candidate?.orderId)
    if (!matchingOrderResponse(candidate, expected) || (sameOrder && !canAdvanceOrder(order.value, candidate))) return null
    order.value = candidate
    activeOrderIdentity = identityFromOrder(candidate)
    await clearTerminalPurchaseRecord(candidate, insideOperationLock)
    await refreshTerminalEntitlements(candidate)
    return candidate
  }

  const sendOrderRecord = async (record) => {
    const request = record?.purchaseRequest
    if (!validJournalRecord(record) || record.phase !== 'ORDER' || !request ||
      !matchesIntent(request, record.intentFingerprint)) return null
    const generation = ++purchaseGeneration
    stopOrderPolling()
    purchaseIdempotencyKey.value = record.orderIdempotencyKey
    purchaseLoading.value = true
    error.value = ''
    try {
      const response = await awaitAbortable(agentApi.post('/skill-orders', { ...request, approvedPermissions: [...request.approvedPermissions] }, {
        autoLoading: false,
        signal: operationAbortController.signal,
        headers: { 'Idempotency-Key': record.orderIdempotencyKey }
      }))
      const payload = readSkillApiPayload(response) || null
      const expected = {
        orderId: requiredString(payload?.orderId),
        targetAgentId: request.targetAgentId,
        productVersionId: request.productVersionId,
        expectedAgentVersion: request.expectedAgentVersion
      }
      if (generation !== purchaseGeneration || !sameString(target.value.targetAgentId, request.targetAgentId) ||
        !sameString(target.value.expectedAgentVersion, request.expectedAgentVersion) || !matchingOrderResponse(payload, expected)) return null
      const updated = updatePurchaseRecord(record, { orderId: payload.orderId })
      const accepted = await acceptOrder(payload, expected, true)
      if (!accepted) return null
      clearQuote()
      return accepted
    } catch (failure) {
      // Only frozen, definitive no-order outcomes may release this persisted intent.
      // Unknown HTTP/transport outcomes retain its idempotency key for exact replay.
      if (isDefinitiveNoOrderFailure(failure)) {
        const current = readPurchaseJournal()
        if (current.some(item => item.intentFingerprint === record.intentFingerprint)) {
          persistPurchaseJournal(current.filter(item => item.intentFingerprint !== record.intentFingerprint))
        }
      }
      if (generation === purchaseGeneration) error.value = failure?.message || '技能购买失败；可使用恢复操作重放原请求'
      throw failure
    } finally {
      if (generation === purchaseGeneration) purchaseLoading.value = false
    }
  }

  const purchase = async () => {
    if (!operationLockAvailable.value) {
      error.value = operationLockError().message
      return null
    }
    if (!canPurchase.value) return null
    return withOperationLock(async () => {
      const current = readPurchaseJournal()
      purchaseJournal.value = current
      const record = current.find(item => item.intentFingerprint === intentFingerprint.value) || null
      if (!record || current.some(item => item.intentFingerprint !== record.intentFingerprint)) {
        error.value = '已有未解决购买请求，请先使用恢复操作检查或重放原请求'
        return null
      }
      const next = record.phase === 'QUOTE' ? createOrderRecord(record) : record
      return next?.phase === 'ORDER' ? sendOrderRecord(next) : null
    })
  }

  const resumeOperation = async (candidate) => {
    const record = purchaseJournal.value.find(item => item.intentFingerprint === candidate?.intentFingerprint)
    if (!record) return null
    restoreOperation(record)
    if (record.orderId) {
      order.value = {
        orderId: record.orderId,
        targetAgentId: record.targetAgentId,
        productVersionId: record.productVersionId,
        expectedAgentVersion: record.expectedAgentVersion,
        status: SKILL_ORDER_STATUSES.FUNDS_HELD
      }
      activeOrderIdentity = identityFromOrder(order.value)
      const recovered = await loadOrder(record.orderId)
      if (recovered && !isTerminalOrder(recovered)) pollOrder(recoveryPollOptions).catch(() => {})
      return recovered
    }
    if (!operationLockAvailable.value) {
      error.value = operationLockError().message
      return null
    }
    return withOperationLock(async () => {
      const current = readPurchaseJournal()
      purchaseJournal.value = current
      const persisted = current.find(item => item.intentFingerprint === record.intentFingerprint)
      if (!persisted) return null
      return persisted.phase === 'QUOTE' ? sendQuoteRecord(persisted) : sendOrderRecord(persisted)
    })
  }

  const loadOrderUnlocked = async (orderId = order.value?.orderId) => {
    const id = requiredString(orderId)
    const expected = activeOrderIdentity || identityFromOrder(order.value)
    if (!id || !expected.orderId || !sameString(id, expected.orderId)) return null
    const generation = ++orderRequestGeneration
    orderLoading.value = true
    error.value = ''
    try {
      const response = await awaitAbortable(agentApi.get(`/skill-orders/${encodeURIComponent(id)}`, {}, { autoLoading: false, signal: operationAbortController.signal }))
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

  // Order reads are deliberately not serialized: response fencing permits concurrent refreshes.
  // The exclusive lock is reserved for persisted quote/order intent mutations and dispatch.
  const loadOrder = async (orderId = order.value?.orderId) => loadOrderUnlocked(orderId)

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

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      cancelScopeOperations()
    })
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
    actorScopeFingerprint,
    storageAvailable,
    operationLockAvailable,
    target,
    productVersionId,
    canRequestQuote,
    canPurchase,
    purchaseIdempotencyKey,
    purchaseJournal,
    unresolvedPurchase,
    unresolvedOperations,
    clearQuote,
    setTargetAgent,
    setApprovedPermissions,
    togglePermission,
    loadProducts,
    loadProduct,
    selectProduct,
    requestQuote,
    purchase,
    resumeOperation,
    loadOrder,
    pollOrder,
    stopOrderPolling,
    dispose: () => {
      if (!disposed) {
        disposed = true
        cancelScopeOperations()
      }
    },
    loadEntitlements
  }
}
