import { computed, ref } from 'vue'
import { isCanonicalDecimalString as decimal } from '../../utils/silverAmount.js'
import { registerIdentityCleanup } from '../../utils/identityLifecycle.js'
import { definitiveHostingFailure, hostingPayload, hostingRequest, lookupNotOlder, matchingHostingReceipt,
  text, validLookup, validOperation, validQuote } from './hostingRentContract.js'

const browserStorage = () => { try { return globalThis.sessionStorage } catch { return null } }
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value))
const empty = () => ({ quote: null, operation: null, accepted: null, lookup: null, refreshPending: false })
const ownedAgentId = persona => persona?.boundToMe === true && text(persona.agentId) ? persona.agentId : null
const targetSignature = persona => JSON.stringify([persona?.personaCode, ownedAgentId(persona), persona?.boundToMe === true,
  persona?.bound === true, persona?.systemAgent === true, persona?.canBind === true, persona?.version ?? null])

export function useHostingRent({ agentApi, economyApi, loadCapability, enabled = false, resolvePersona = persona => persona,
  getAuthorizationGeneration = () => 0, now = () => Date.now(), createKey = () => globalThis.crypto.randomUUID(),
  storage = browserStorage() } = {}) {
  const target = ref(null)
  const state = ref(empty())
  const wallet = ref(null)
  const busy = ref(false)
  const error = ref('')
  const ready = ref(false)
  const clock = ref(now())
  let scope = ''
  let generation = 0
  let controller = null
  let disposed = false
  let signature = ''
  let authGeneration
  const scopeKey = () => `cyf-hosting-rent-v1:${encodeURIComponent(scope)}:${encodeURIComponent(target.value.personaCode)}`
  const context = () => ({ generation, auth: authGeneration, signal: controller.signal, personaCode: target.value?.personaCode })
  const current = ctx => !disposed && ctx.generation === generation && ctx.auth === getAuthorizationGeneration() && !ctx.signal.aborted
  const selected = () => target.value && targetSignature(resolvePersona(target.value)) === signature
  const targetAgentId = computed(() => state.value.operation?.agentId || state.value.accepted?.receipt.agentId ||
    state.value.lookup?.lease?.agentId || state.value.quote?.agentId || ownedAgentId(target.value))
  const writable = computed(() => ready.value && !busy.value && !state.value.operation && !state.value.refreshPending)
  const canInitial = computed(() => writable.value && ((!ownedAgentId(target.value) && !state.value.accepted && !state.value.lookup?.managed) ||
    ['NOT_MANAGED', 'INITIAL_REQUIRED'].includes(state.value.lookup?.admission)))
  const canRenew = computed(() => writable.value && state.value.lookup?.lease?.status === 'ACTIVE' &&
    ['ALLOWED', 'RENEWAL_REQUIRED'].includes(state.value.lookup?.admission))
  const canReprovision = computed(() => canRenew.value && state.value.lookup.admission === 'ALLOWED' &&
    BigInt(state.value.lookup.lease.paidThrough) > BigInt(clock.value) &&
    !['ACCEPTED', 'PROVISIONING_UNKNOWN'].includes(state.value.lookup.reprovision?.status))
  const quoteExpired = computed(() => !state.value.quote || BigInt(state.value.quote.expiresAt) <= BigInt(clock.value))
  const canConfirm = computed(() => Boolean(writable.value && state.value.quote && !quoteExpired.value && wallet.value &&
    BigInt(wallet.value.availableMicro) >= BigInt(state.value.quote.amountMicro)))

  const save = (required = false) => {
    try {
      if (!storage) throw new Error('missing storage')
      storage.setItem(scopeKey(), JSON.stringify({ scope, personaCode: target.value.personaCode, ...state.value }))
      return true
    } catch {
      error.value = required ? '恢复存储不可用，未提交租金请求。请保留此页。' : '结果已保留在本页；恢复存储不可用，请勿关闭页面。'
      return false
    }
  }
  const invalidate = () => {
    generation += 1
    controller?.abort()
    ready.value = false
    busy.value = false
    scope = ''
    wallet.value = null
    state.value = empty()
    error.value = '会话或选择已变化，请重新打开山寨安顿核对。'
  }
  const unregister = registerIdentityCleanup(invalidate)
  const dispose = () => { invalidate(); disposed = true; unregister() }
  const tick = () => { clock.value = now() }
  const requestOptions = ctx => ({ autoLoading: false, signal: ctx.signal })

  const readWallet = async ctx => {
    const result = hostingPayload(await economyApi.get('/wallet', undefined, requestOptions(ctx)))
    if (!current(ctx)) return false
    if (result?.currency !== 'SILVER' || !decimal(result.availableMicro) || !decimal(result.heldMicro)) throw new Error('钱袋金额不是规范服务端数据，暂不可确认租金。')
    wallet.value = result
    return true
  }
  const readLease = async ctx => {
    const agentId = targetAgentId.value
    if (!agentId) return false
    const next = hostingPayload(await agentApi.get(`/${encodeURIComponent(agentId)}/hosting-lease`, undefined, requestOptions(ctx)))
    if (!current(ctx)) return false
    if (targetAgentId.value !== agentId || !validLookup(next, agentId, ctx.personaCode)) throw new Error('租约身份或规范版本不匹配，请重查。')
    const accepted = state.value.accepted
    if (accepted && state.value.refreshPending) {
      const { receipt, operation } = accepted
      if (!next.managed || next.lease.leaseId !== receipt.leaseId ||
        (operation.kind === 'INITIAL' && next.lease.status !== 'ACTIVE' && next.intent?.intentId !== receipt.intentId) ||
        (operation.kind !== 'INITIAL' && BigInt(next.lease.version) <= BigInt(operation.lease.version)) ||
        (operation.kind === 'REPROVISION' && next.reprovision?.requestId !== receipt.requestId)) throw new Error('请求已确认；最新租约尚未同步。')
    }
    const previous = state.value.lookup
    const newAcceptedLease = accepted && accepted.receipt.leaseId === next.lease?.leaseId && previous?.lease?.leaseId !== next.lease?.leaseId
    if (!newAcceptedLease && !lookupNotOlder(next, previous)) throw new Error('忽略延迟的旧租约快照，请重查。')
    state.value.lookup = copy(next)
    state.value.refreshPending = false
    save()
    return true
  }

  const refresh = async () => {
    if (!ready.value || busy.value) return false
    const ctx = context()
    busy.value = true
    error.value = ''
    try {
      const refreshed = await readLease(ctx)
      if (current(ctx)) await readWallet(ctx)
      return current(ctx) && refreshed
    } catch (cause) {
      if (current(ctx)) error.value = state.value.accepted ? `请求已确认，不要重复付款；${cause.message}` : cause.message
      return false
    } finally { if (current(ctx)) busy.value = false }
  }

  const restore = () => {
    const raw = storage?.getItem(scopeKey())
    if (!raw) return
    const saved = JSON.parse(raw)
    const code = target.value.personaCode
    if (saved.scope !== scope || saved.personaCode !== code) throw new Error('恢复记录 scope 不匹配。')
    if (saved.operation && !validOperation(saved.operation, code)) throw new Error('原请求恢复记录不完整，已停止新付款。')
    if (saved.accepted && (!validOperation(saved.accepted.operation, code) || !matchingHostingReceipt(saved.accepted.receipt, saved.accepted.operation))) throw new Error('原回执恢复记录不完整，已停止新付款。')
    const agentId = saved.operation?.agentId || saved.accepted?.receipt.agentId || saved.lookup?.lease?.agentId || saved.quote?.agentId || ownedAgentId(target.value)
    if (ownedAgentId(target.value) && agentId && ownedAgentId(target.value) !== agentId) throw new Error('原请求属于另一绑定 Agent，禁止移用付款记录。')
    if (saved.lookup && !validLookup(saved.lookup, agentId, code)) throw new Error('原租约恢复记录不完整。')
    // A refreshed lease can make an unconfirmed preview stale. Discard only that
    // preview; an unresolved mutation retains its independently validated exact terms.
    const preview = saved.operation?.quote || (saved.quote && validQuote(saved.quote, saved.quote.purpose, code, agentId, saved.lookup?.lease) ? saved.quote : null)
    state.value = { quote: preview, operation: saved.operation || null, accepted: saved.accepted || null,
      lookup: saved.lookup || null, refreshPending: Boolean(saved.refreshPending) }
  }

  const open = async persona => {
    invalidate()
    if (disposed) return false
    target.value = copy(persona)
    signature = targetSignature(persona)
    authGeneration = getAuthorizationGeneration()
    controller = new AbortController()
    const ctx = context()
    error.value = ''
    if (!enabled || !text(persona?.personaCode) || persona.systemAgent || (persona.bound && !persona.boundToMe) ||
      (persona.boundToMe && !ownedAgentId(persona)) || (!persona.boundToMe && !persona.canBind)) {
      error.value = '当前未启用租金预览，或缺少明确的可操作好汉。自家接应不收托管租金。'
      return false
    }
    busy.value = true
    try {
      const capability = await loadCapability({ signal: ctx.signal })
      if (!current(ctx) || !selected()) return false
      if (capability?.economyPreviewEnabled !== true || !text(capability.principalScopeFingerprint)) throw new Error('服务端未提供已启用的预览及明确 scope；不会改走免费 server 接口。')
      scope = capability.principalScopeFingerprint
      restore()
      ready.value = true
      await readWallet(ctx)
      if (!current(ctx)) return false
      if (ownedAgentId(target.value) || state.value.accepted || state.value.lookup?.managed ||
        (state.value.operation && !state.value.operation.kind.endsWith('_QUOTE'))) await readLease(ctx)
      return current(ctx)
    } catch (cause) {
      if (current(ctx)) error.value = state.value.accepted ? `原请求已确认；读取待完成：${cause.message}` : cause.message
      return false
    } finally { if (current(ctx)) busy.value = false }
  }

  const sendOperation = async (operation, ctx) => {
    const [path, body] = hostingRequest(operation, ctx.personaCode)
    const result = hostingPayload(await agentApi.create(path, body, { ...requestOptions(ctx), headers: { 'Idempotency-Key': operation.key } }))
    if (!current(ctx)) return false
    if (operation.kind.endsWith('_QUOTE')) {
      const purpose = operation.kind === 'INITIAL_QUOTE' ? 'INITIAL' : 'RENEWAL'
      if (!validQuote(result, purpose, ctx.personaCode, operation.agentId, operation.lease)) throw new Error('服务端报价与原好汉/租约不一致；请核对原请求。')
      state.value.operation = null
      state.value.quote = copy(result)
      save()
      return true
    }
    if (!matchingHostingReceipt(result, operation)) throw new Error('回执与原请求不匹配；结果未知，请只核对原请求。')
    state.value.accepted = { receipt: copy(result), operation: copy(operation) }
    state.value.operation = null
    state.value.quote = null
    state.value.refreshPending = true
    save()
    // Acceptance is durable knowledge. Readback or wallet failures never turn it
    // into failed payment, and no immutable receipt is copied into a lease DTO.
    try {
      await readLease(ctx)
      if (current(ctx)) await readWallet(ctx)
    } catch (cause) {
      if (current(ctx)) error.value = `请求已确认，不要重复付款；读取待完成：${cause.message}`
    }
    return true
  }

  const perform = async (operation, recovery = false) => {
    if (!ready.value || busy.value || !selected() || authGeneration !== getAuthorizationGeneration()) return false
    if (!validOperation(operation, target.value.personaCode)) { error.value = '请求缺少规范 UUID、报价或租约版本。'; return false }
    if (!recovery && state.value.operation) return false
    const ctx = context()
    busy.value = true
    error.value = ''
    state.value.operation = copy(operation)
    if (!save(true)) { busy.value = false; return false }
    try {
      return await sendOperation(operation, ctx)
    } catch (cause) {
      if (current(ctx)) {
        if (definitiveHostingFailure(cause)) {
          state.value.operation = null
          state.value.quote = null
          // A rejected CAS/expiry needs a new canonical lookup, not a blind retry.
          if (targetAgentId.value) state.value.refreshPending = true
          save()
        }
        error.value = state.value.operation ? `结果未知，请只核对原请求（不重新取价/扣款）：${cause.message}` : `${cause.code || ''} ${cause.message}`
      }
      return false
    } finally { if (current(ctx)) busy.value = false }
  }

  const requestKey = () => { try { return createKey() } catch { return '' } }
  const previewInitial = () => {
    tick()
    if (!canInitial.value || !selected()) return Promise.resolve(false)
    state.value.quote = null
    return perform({ kind: 'INITIAL_QUOTE', key: requestKey(), agentId: ownedAgentId(target.value) })
  }
  const previewRenewal = () => {
    tick()
    if (!canRenew.value || !selected()) return Promise.resolve(false)
    state.value.quote = null
    return perform({ kind: 'RENEWAL_QUOTE', key: requestKey(), agentId: targetAgentId.value, lease: copy(state.value.lookup.lease) })
  }
  const cancelQuote = () => {
    if (busy.value || state.value.operation) return false
    state.value.quote = null
    if (ready.value) save()
    return true
  }
  const confirmQuote = () => {
    tick()
    const quote = state.value.quote
    if (!canConfirm.value || !selected()) { error.value = '报价已过期、余额不足或好汉已变化；未提交，请重新核对。'; return Promise.resolve(false) }
    const lease = state.value.lookup?.lease
    if (!validQuote(quote, quote.purpose, target.value.personaCode, ownedAgentId(target.value), lease) ||
      (quote.purpose === 'INITIAL' ? !canInitial.value : !canRenew.value)) {
      error.value = '报价与最新租约版本不一致，请取消后重新预览；未提交付款。'
      return Promise.resolve(false)
    }
    return perform({ kind: quote.purpose, key: requestKey(), agentId: quote.agentId, quote: copy(quote), ...(quote.purpose === 'RENEWAL' ? { lease: copy(lease) } : {}) })
  }
  const reprovision = () => {
    tick()
    if (!canReprovision.value || !selected() || state.value.quote) return Promise.resolve(false)
    return perform({ kind: 'REPROVISION', key: requestKey(), agentId: targetAgentId.value, lease: copy(state.value.lookup.lease) })
  }
  const retryUnknown = () => state.value.operation ? perform(copy(state.value.operation), true) : Promise.resolve(false)

  return { target, state, wallet, busy, ready, error, clock, targetAgentId, canInitial, canRenew, canReprovision, canConfirm, quoteExpired,
    open, refresh, previewInitial, previewRenewal, confirmQuote, cancelQuote, reprovision, retryUnknown, tick, invalidate, dispose }
}
