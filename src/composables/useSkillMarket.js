import { computed, getCurrentScope, onScopeDispose, ref, unref, watch } from 'vue'
import { agentApi as defaultAgentApi } from './useHttp.js'
import { registerIdentityCleanup } from '../utils/identityLifecycle.js'
import { formatSilverMoney } from '../utils/silverAmount.js'
import { parseStrictJson, protocolError } from '../utils/apiEnvelope.js'
import { parseSkillManagement as parse, skillChangeTerminal, skillId, skillPathSegment, skillPermissionsSha256, sortSkillPermissions, utf8Compare } from '../utils/skillManagementContract.js'

export const codeUnitCompare = utf8Compare
export const normalizeApprovedPermissions = permissions => sortSkillPermissions([...new Set(permissions)])
export const formatSkillMoney = value => { try { return formatSilverMoney(value) } catch { return '—' } }
export const formatInstalledSkillFact = skill => typeof skill === 'string' ? skill : `${skill?.skillKey || '未报告技能'}@${skill?.skillVersion || '版本未报告'}`
export const formatSkillProductIdentity = p => `${p?.skillKey || '未报告技能'}@${p?.skillVersion || p?.currentVersion?.skillVersion || '版本未报告'}/${p?.productVersionId || p?.currentVersion?.productVersionId || '商品版本未报告'}`
export const formatEntitlementSkillFact = formatSkillProductIdentity
const read = value => typeof value === 'function' ? value() : unref(value)
const clone = value => JSON.parse(JSON.stringify(value))
const storageDefault = () => { try { return globalThis.window?.localStorage || null } catch { return null } }
const uuid = () => {
  if (!globalThis.crypto?.randomUUID) throw new Error('无法生成安全请求标识，未提交。')
  return globalThis.crypto.randomUUID()
}
const canonical = v => JSON.stringify(v, (_, value) => value && !Array.isArray(value) && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort(utf8Compare).map(key => [key, value[key]])) : value)
const PREFIX = 'cyf.skill-management.v1:'
const definiteRejection = e => e.failureClass === 'http' && [400, 403, 410, 422].includes(e.status) ||
  (e.failureClass === 'http' && e.status === 409 && ['SKILL_QUOTE_EXPIRED', 'SKILL_QUOTE_MISMATCH', 'SKILL_PERMISSIONS_MISMATCH'].includes(e.code))

/** The only skill write state machine, shared by AgentPanel and the existing market consumer.
 * Authority: authenticated actor scope + stable agent ID, NOT roster object identity.
 * Closing a dialog stops observation, not an accepted operation or an in-flight write.
 */
export function useSkillMarket ({ agentApi = defaultAgentApi, enabled = true, actorScopeKey = '', identityKey = null, targetAgent = null,
  purchaseIdempotencyStorage: storage = storageDefault(), createIdempotencyKey = uuid,
  operationLocks = globalThis.navigator?.locks, now = () => Date.now(), onChanged = () => {} } = {}) {
  const catalog = ref(null); const changes = ref([]); const drafts = ref({}); const pending = ref({})
  const loading = ref(false); const error = ref(''); const recordsError = ref(''); const storageError = ref('')
  const busy = ref({}); const queryUnknown = ref({}); const identityRevoked = ref(false)
  const agentId = computed(() => read(targetAgent)?.agentId || '')
  const scope = computed(() => read(actorScopeKey))
  const identity = computed(() => read(identityKey) || scope.value)
  const available = computed(() => Boolean(!identityRevoked.value && read(enabled) && typeof scope.value === 'string' && scope.value && skillId(agentId.value)))
  const basePath = () => `/${skillPathSegment(agentId.value)}`
  const prefix = () => `${PREFIX}${encodeURIComponent(scope.value)}:${skillPathSegment(agentId.value)}:`
  const slot = skillKey => prefix() + skillKey
  const items = computed(() => catalog.value?.items || [])
  const rowFor = skillKey => items.value.find(row => row.skillKey === skillKey)
  let epoch = 0; let readEpoch = 0; let disposed = false; let polling = false; let timer = null; let observerEpoch = 0
  const controllers = new Set()
  const capture = () => { const c = new AbortController(); controllers.add(c); return { c, epoch, scope: scope.value, identity: identity.value, agentId: agentId.value } }
  const current = token => !disposed && token.epoch === epoch && token.scope === scope.value && token.identity === identity.value && token.agentId === agentId.value && !token.c.signal.aborted
  const options = (token, status = 200) => ({ autoLoading: false, signal: token.c.signal, strictJsonIntegers: true, onSuccess: (_data, meta) => { if (meta.status !== status) throw protocolError('PROTOCOL_SKILL_HTTP_STATUS') } })
  const storageFailure = () => new Error('无法可靠保存或读取原操作，请检查站点存储；不会发送新的写请求。')
  const persist = (skillKey, record) => {
    if (!storage || !available.value) throw storageFailure()
    const raw = JSON.stringify(record); storage.setItem(slot(skillKey), raw)
    if (storage.getItem(slot(skillKey)) !== raw) throw storageFailure()
    pending.value = { ...pending.value, [skillKey]: record }
  }
  const remove = (skillKey, record) => {
    // Never remove a different tab's newer intent.
    if (storage.getItem(slot(skillKey)) !== JSON.stringify(record)) throw storageFailure()
    storage.removeItem(slot(skillKey))
    if (storage.getItem(slot(skillKey)) !== null) throw storageFailure()
    const next = { ...pending.value }; delete next[skillKey]; pending.value = next
  }
  const validRecord = record => {
    if (!record || typeof record.skillKey !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.skillKey) || Object.keys(record).sort().join(',') !== ['schemaVersion', 'kind', 'agentId', 'skillKey', 'path', 'key', 'requestId', 'data', 'skillChangeId', 'accepted'].sort().join(',') || record.schemaVersion !== 1 || record.agentId !== agentId.value || !skillId(record.key) || !skillId(record.requestId) ||
      !['QUOTE', 'CREATE', 'RETRY', 'RECONCILE'].includes(record.kind) || typeof record.accepted !== 'boolean') return false
    try {
      parse(record.kind === 'QUOTE' ? 'QuoteRequestData' : record.kind === 'CREATE' ? 'CreateChangeData' : 'ChangeActionData', record.data)
      if (record.kind === 'QUOTE') return record.path === '/skill-orders/quotes' && record.data.agentId === agentId.value && record.data.skillKey === record.skillKey && record.skillChangeId === null && !record.accepted
      if (record.skillChangeId !== null) skillPathSegment(record.skillChangeId)
      if (record.accepted && record.skillChangeId === null) return false
      if (record.kind === 'CREATE' && !record.accepted && record.skillChangeId !== null) return false
      return record.kind === 'CREATE' ? record.data.skillKey === record.skillKey && record.path === `${basePath()}/skill-changes`
        : record.path === `${basePath()}/skill-changes/${skillPathSegment(record.skillChangeId)}/${record.kind.toLowerCase()}`
    } catch { return false }
  }
  const recover = () => {
    storageError.value = ''
    try {
      if (!storage) throw storageFailure()
      const records = {}
      for (let i = 0; i < storage.length; i++) {
        const name = storage.key(i)
        if (!name?.startsWith(prefix())) continue
        const record = parseStrictJson(storage.getItem(name), { integerTokensOnly: true })
        if (!validRecord(record) || name !== slot(record.skillKey)) throw storageFailure()
        records[record.skillKey] = record
      }
      pending.value = records
    } catch (cause) { storageError.value = cause.message || storageFailure().message }
  }
  const contextFingerprint = row => canonical([catalog.value?.agentVersion, row?.skillRevision, row?.installed, row?.candidate, row?.upgradeEligibility])
  const invalidateDraft = (skillKey, message = '') => {
    const draft = drafts.value[skillKey]
    if (draft) drafts.value = { ...drafts.value, [skillKey]: { ...draft, quote: null, quoteIntent: null, quoteBusy: false, generation: draft.generation + 1, message } }
  }
  const acceptChange = change => {
    parse('SkillChange', change)
    if (change.agentId !== agentId.value) throw protocolError('PROTOCOL_SKILL_IDENTITY_MISMATCH')
    const prior = changes.value.find(item => item.skillChangeId === change.skillChangeId)
    if (prior && BigInt(prior.changeRevision) > BigInt(change.changeRevision)) return prior
    if (prior) {
      for (const field of ['agentId', 'skillKey', 'action', 'source', 'orderId', 'price', 'createdAt', 'desiredEnabled']) if (canonical(prior[field]) !== canonical(change[field])) throw protocolError('PROTOCOL_SKILL_INTENT_CONFLICT')
      for (const field of ['productVersionId', 'skillVersion', 'packageSha256', 'manifestSha256', 'byteLength', 'kind']) if (prior.target[field] !== change.target[field]) throw protocolError('PROTOCOL_SKILL_TARGET_CONFLICT')
      if (change.target.skillInstallationId !== prior.target.skillInstallationId && (!['INSTALL', 'UPGRADE'].includes(change.action) || change.attempt === prior.attempt)) throw protocolError('PROTOCOL_SKILL_TARGET_CONFLICT')
      if (change.attempt === prior.attempt && change.skillRevision !== prior.skillRevision) throw protocolError('PROTOCOL_SKILL_VERSION_REGRESSION')
      if (change.attempt > prior.attempt && BigInt(change.skillRevision) <= BigInt(prior.skillRevision)) throw protocolError('PROTOCOL_SKILL_VERSION_REGRESSION')
      if (change.attempt < prior.attempt || BigInt(change.skillRevision) < BigInt(prior.skillRevision)) throw protocolError('PROTOCOL_SKILL_VERSION_REGRESSION')
    }
    if (prior && prior.changeRevision === change.changeRevision && canonical(prior) !== canonical(change)) throw protocolError('PROTOCOL_SKILL_REVISION_CONFLICT')
    if (prior && ['SUCCEEDED', 'FAILED_FINAL'].includes(prior.status) && change.status !== prior.status) throw protocolError('PROTOCOL_SKILL_TERMINAL_REGRESSION')
    changes.value = [...changes.value.filter(item => item.skillChangeId !== change.skillChangeId), change]
      .sort((a, b) => b.createdAt - a.createdAt || utf8Compare(b.skillChangeId, a.skillChangeId))
    return change
  }
  const latestChange = row => {
    const next = changes.value.filter(change => change.skillKey === row.skillKey).sort((a, b) => {
      const aa = BigInt(a.skillRevision); const bb = BigInt(b.skillRevision)
      return aa === bb ? 0 : aa > bb ? -1 : 1
    })[0]
    return next || row.latestChange
  }
  const refresh = async () => {
    if (!available.value || disposed) return null
    const token = capture(); const serial = ++readEpoch; loading.value = true; error.value = ''
    try {
      const raw = await agentApi.get(`${basePath()}/skills`, {}, options(token))
      if (!current(token) || serial !== readEpoch) return null
      const next = parse('SkillList', raw)
      if (next.agentId !== token.agentId || new Set(next.items.map(row => row.skillKey)).size !== next.items.length) throw protocolError('PROTOCOL_SKILL_IDENTITY_MISMATCH')
      if (catalog.value && BigInt(next.agentVersion) < BigInt(catalog.value.agentVersion)) throw protocolError('PROTOCOL_SKILL_VERSION_REGRESSION')
      for (const row of next.items) {
        const old = rowFor(row.skillKey)
        if (old && BigInt(row.skillRevision) < BigInt(old.skillRevision)) throw protocolError('PROTOCOL_SKILL_VERSION_REGRESSION')
        const draft = drafts.value[row.skillKey]
        // Object replacement/projection补齐 is not an identity change. Only actual contract input changes invalidate preparation.
        if (draft && draft.context !== canonical([next.agentVersion, row.skillRevision, row.installed, row.candidate, row.upgradeEligibility])) invalidateDraft(row.skillKey, '版本、权限或状态已变化，请重新核对并获取报价。')
        if (row.latestChange) {
          if (row.latestChange.skillKey !== row.skillKey) throw protocolError('PROTOCOL_SKILL_IDENTITY_MISMATCH')
          acceptChange(row.latestChange)
        }
      }
      for (const skillKey of Object.keys(drafts.value)) if (!next.items.some(row => row.skillKey === skillKey)) invalidateDraft(skillKey, '该技能已不在当前列表中。')
      catalog.value = next
      return next
    } catch (cause) { if (current(token) && serial === readEpoch) error.value = cause.message || '技能读取失败，请重试。'; return null }
    finally { controllers.delete(token.c); if (current(token) && serial === readEpoch) loading.value = false }
  }
  const refreshChanges = async () => {
    if (!available.value || disposed) return null
    const token = capture(); recordsError.value = ''
    try {
      const raw = await agentApi.get(`${basePath()}/skill-changes`, {}, options(token))
      if (!current(token)) return null
      const next = parse('ChangeList', raw)
      if (next.agentId !== token.agentId) throw protocolError('PROTOCOL_SKILL_IDENTITY_MISMATCH')
      for (const change of next.items) acceptChange(change)
      return next
    } catch (cause) { if (current(token)) recordsError.value = cause.message || '操作记录读取失败。'; return null }
    finally { controllers.delete(token.c) }
  }
  const checkOriginal = async skillKey => {
    const record = pending.value[skillKey]
    const row = rowFor(skillKey)
    const id = record?.skillChangeId || (row && latestChange(row)?.skillChangeId)
    if (!available.value || !id || busy.value[skillKey]) return null
    const token = capture()
    try {
      const raw = await agentApi.get(`${basePath()}/skill-changes/${skillPathSegment(id)}`, {}, options(token))
      if (!current(token)) return null
      const change = parse('SkillChange', raw)
      if (change.skillChangeId !== id || change.skillKey !== skillKey) throw protocolError('PROTOCOL_SKILL_IDENTITY_MISMATCH')
      const next = acceptChange(change)
      queryUnknown.value = { ...queryUnknown.value, [skillKey]: '' }
      if (record?.accepted && skillChangeTerminal(next) && next.status !== 'RECOVERY_REQUIRED') remove(skillKey, record)
      await refresh()
      if (current(token) && next.status === 'SUCCEEDED') onChanged(next)
      return next
    } catch { if (current(token)) queryUnknown.value = { ...queryUnknown.value, [skillKey]: '读取结果未确认，请核对原操作，不要再次购买。' }; return null }
    finally { controllers.delete(token.c) }
  }
  const prepare = (row, actionName) => {
    if (!row.allowedActions.includes(actionName) || pending.value[row.skillKey]) return null
    const existing = drafts.value[row.skillKey]
    const context = contextFingerprint(row)
    if (existing?.action === actionName && existing.context === context) return existing
    const draft = { action: actionName, permissions: [], quote: null, quoteIntent: null, quoteBusy: false, generation: (existing?.generation || 0) + 1, context, message: '' }
    drafts.value = { ...drafts.value, [row.skillKey]: draft }
    return draft
  }
  const setApprovedPermissions = (skillKey, values) => {
    const row = rowFor(skillKey); const draft = drafts.value[skillKey]
    if (!row?.candidate || !draft || busy.value[skillKey]) return
    if (new Set(values).size !== values.length || !values.every(value => row.candidate.requiredPermissions.includes(value))) throw protocolError('PROTOCOL_INVALID_SKILL_PERMISSIONS')
    invalidateDraft(skillKey)
    drafts.value = { ...drafts.value, [skillKey]: { ...drafts.value[skillKey], permissions: sortSkillPermissions(values), context: contextFingerprint(row) } }
  }
  const canPrepare = skillKey => {
    const row = rowFor(skillKey); const draft = drafts.value[skillKey]
    return Boolean(available.value && !storageError.value && !error.value && !loading.value && row?.candidate && draft && row.allowedActions.includes(draft.action) &&
      (!pending.value[skillKey] || pending.value[skillKey].kind === 'QUOTE') && !busy.value[skillKey] && !draft.quoteBusy &&
      JSON.stringify(sortSkillPermissions(draft.permissions)) === JSON.stringify(sortSkillPermissions(row.candidate.requiredPermissions)))
  }
  const quoteSend = async (skillKey, record, token, generation, context) => {
    const data = record.data; let savedBeforeSend = false
    const stillCurrent = () => current(token) && drafts.value[skillKey]?.generation === generation && contextFingerprint(rowFor(skillKey)) === context
    try {
      persist(skillKey, record); savedBeforeSend = true
      const raw = await agentApi.post(record.path, clone(data), { ...options(token), headers: { 'Idempotency-Key': record.key, 'X-Request-Id': record.requestId } })
      if (!current(token)) return null
      const next = parse('Quote', raw)
      const digest = await skillPermissionsSha256(data.approvedPermissions)
      if (!current(token)) return null
      for (const field of ['action', 'agentId', 'skillKey', 'sourceSkillInstallationId', 'targetProductVersionId', 'expectedAgentVersion', 'expectedSkillRevision']) if (next[field] !== data[field]) throw protocolError('PROTOCOL_SKILL_QUOTE_MISMATCH')
      if (next.approvedPermissionsSha256 !== digest) throw protocolError('PROTOCOL_SKILL_QUOTE_MISMATCH')
      const candidate = rowFor(skillKey)?.candidate
      if (candidate?.productVersionId === data.targetProductVersionId && (next.targetPackageSha256 !== candidate.packageSha256 || next.targetSkillVersion !== candidate.skillVersion)) throw protocolError('PROTOCOL_SKILL_QUOTE_MISMATCH')
      // A quote has no purchase side effect. Once its original result is known, a changed
      // preparation may discard it, but must not turn that result into automatic approval.
      remove(skillKey, record)
      queryUnknown.value = { ...queryUnknown.value, [skillKey]: '' }
      if (!stillCurrent()) return null
      const row = rowFor(skillKey)
      if (!row?.candidate || next.expectedAgentVersion !== catalog.value.agentVersion || next.expectedSkillRevision !== row.skillRevision ||
          next.sourceSkillInstallationId !== (data.action === 'INSTALL' ? null : row.installed?.skillInstallationId) ||
          next.targetProductVersionId !== row.candidate.productVersionId || next.targetPackageSha256 !== row.candidate.packageSha256 || next.targetSkillVersion !== row.candidate.skillVersion ||
          canonical(sortSkillPermissions(data.approvedPermissions)) !== canonical(sortSkillPermissions(row.candidate.requiredPermissions))) throw Object.assign(new Error('版本或权限已变化，原报价不可提交；请重新准备。'), { quoteInvalid: true })
      if (data.action === 'UPGRADE' && (row.upgradeEligibility === 'COVERED' ? next.coverage !== 'ENTITLEMENT' : row.upgradeEligibility !== 'PAID' || next.coverage !== 'PURCHASE')) throw Object.assign(new Error('升级政策已变化，请重新读取技能并获取报价。'), { quoteInvalid: true })
      if (next.expiresAt <= now()) throw Object.assign(new Error('报价已过期，请重新获取报价。'), { quoteInvalid: true })
      drafts.value = { ...drafts.value, [skillKey]: { ...drafts.value[skillKey], quote: next, quoteIntent: null, message: '' } }
      return next
    } catch (cause) {
      if (current(token)) {
        if (!savedBeforeSend) storageError.value = cause.message || storageFailure().message
        else if (definiteRejection(cause) && pending.value[skillKey]) remove(skillKey, record)
        if (stillCurrent()) drafts.value = { ...drafts.value, [skillKey]: { ...drafts.value[skillKey], message: cause.message || '报价结果未确认，可沿原请求重试。', quoteIntent: pending.value[skillKey] || null } }
        if (pending.value[skillKey]) queryUnknown.value = { ...queryUnknown.value, [skillKey]: '原报价结果未确认；只显式重放原报价，不会自动安装。' }
      }
      return null
    } finally { if (stillCurrent()) drafts.value = { ...drafts.value, [skillKey]: { ...drafts.value[skillKey], quoteBusy: false } } }
  }
  const requestQuote = async skillKey => {
    if (!canPrepare(skillKey)) return null
    const row = rowFor(skillKey); const draft = drafts.value[skillKey]; const token = capture(); const generation = draft.generation
    const data = parse('QuoteRequestData', { action: draft.action, agentId: agentId.value, skillKey,
      sourceSkillInstallationId: draft.action === 'INSTALL' ? null : row.installed?.skillInstallationId,
      targetProductVersionId: row.candidate.productVersionId, expectedAgentVersion: catalog.value.agentVersion,
      expectedSkillRevision: row.skillRevision, approvedPermissions: [...draft.permissions] })
    drafts.value = { ...drafts.value, [skillKey]: { ...draft, quoteBusy: true, quote: null, message: '' } }
    try {
      return await withLock(skillKey, () => {
        if (!current(token) || drafts.value[skillKey]?.generation !== generation) return null
        const prior = pending.value[skillKey]
        if (prior && (prior.kind !== 'QUOTE' || canonical(prior.data) !== canonical(data))) throw new Error('已有原请求，请先核对；未发送新报价。')
        const record = prior || { schemaVersion: 1, kind: 'QUOTE', agentId: agentId.value, skillKey, path: '/skill-orders/quotes', key: createIdempotencyKey(), requestId: createIdempotencyKey(), data, skillChangeId: null, accepted: false }
        return quoteSend(skillKey, record, token, generation, draft.context)
      })
    } catch (cause) {
      if (current(token) && drafts.value[skillKey]?.generation === generation) drafts.value = { ...drafts.value, [skillKey]: { ...drafts.value[skillKey], message: cause.message } }
      return null
    }
    finally { controllers.delete(token.c); if (current(token) && drafts.value[skillKey]?.generation === generation) drafts.value = { ...drafts.value, [skillKey]: { ...drafts.value[skillKey], quoteBusy: false } } }
  }
  const withLock = async (skillKey, callback) => {
    if (!operationLocks?.request) throw new Error('当前浏览器不支持安全的跨标签操作锁，写操作未发送。')
    const token = capture()
    try {
      return await operationLocks.request(slot(skillKey), { mode: 'exclusive', signal: token.c.signal }, async () => {
        if (!current(token)) return null
        recover()
        if (storageError.value) throw storageFailure()
        return callback()
      })
    } finally { controllers.delete(token.c) }
  }
  const send = async record => {
    const token = capture(); const skillKey = record.skillKey; let savedBeforeSend = false
    try {
      persist(skillKey, record); savedBeforeSend = true
      const raw = await agentApi.post(record.path, clone(record.data), { ...options(token, 202), headers: { 'Idempotency-Key': record.key, 'X-Request-Id': record.requestId } })
      if (!current(token)) return null
      const change = parse('SkillChange', raw)
      if (change.agentId !== token.agentId || change.skillKey !== skillKey || (record.skillChangeId && change.skillChangeId !== record.skillChangeId) ||
          (record.kind === 'CREATE' && (change.action !== record.data.action || (record.data.targetProductVersionId && change.target.productVersionId !== record.data.targetProductVersionId)))) throw protocolError('PROTOCOL_SKILL_IDENTITY_MISMATCH')
      if (record.kind === 'CREATE') {
        if (record.data.sourceSkillInstallationId !== (change.source?.skillInstallationId || null)) throw protocolError('PROTOCOL_SKILL_SOURCE_MISMATCH')
        if (['ENABLE', 'DISABLE', 'UNINSTALL'].includes(record.data.action) && canonical(change.target) !== canonical(change.source)) throw protocolError('PROTOCOL_SKILL_TARGET_CONFLICT')
        const candidate = rowFor(skillKey)?.candidate
        if (['INSTALL', 'UPGRADE'].includes(record.data.action) && candidate?.productVersionId === record.data.targetProductVersionId) for (const field of ['packageSha256', 'manifestSha256', 'byteLength', 'kind']) if (change.target[field] !== candidate[field]) throw protocolError('PROTOCOL_SKILL_TARGET_CONFLICT')
        if (record.data.expectedPrice && canonical(change.price) !== canonical(record.data.expectedPrice)) throw protocolError('PROTOCOL_SKILL_PRICE_MISMATCH')
        const target = drafts.value[skillKey]?.quote
        if (target && (change.target.packageSha256 !== target.targetPackageSha256 || change.target.skillVersion !== target.targetSkillVersion)) throw protocolError('PROTOCOL_SKILL_TARGET_CONFLICT')
      }
      const next = acceptChange(change)
      const saved = { ...record, skillChangeId: change.skillChangeId, accepted: true }
      persist(skillKey, saved)
      queryUnknown.value = { ...queryUnknown.value, [skillKey]: '' }
      invalidateDraft(skillKey)
      if (skillChangeTerminal(next) && next.status !== 'RECOVERY_REQUIRED') remove(skillKey, saved)
      await refresh()
      if (current(token)) onChanged(next)
      return next
    } catch (cause) {
      if (current(token)) {
        if (!savedBeforeSend) { storageError.value = cause.message || storageFailure().message }
        else if (definiteRejection(cause)) { remove(skillKey, record); invalidateDraft(skillKey, cause.message); error.value = cause.message }
        else queryUnknown.value = { ...queryUnknown.value, [skillKey]: `${cause.message || '原请求结果未确认'}；保留原请求，只查询或原键重放。` }
      }
      return null
    } finally { controllers.delete(token.c) }
  }
  const perform = async (skillKey, callback) => {
    if (!available.value || busy.value[skillKey] || storageError.value) return null
    const origin = epoch; busy.value = { ...busy.value, [skillKey]: true }
    try { return await withLock(skillKey, callback) }
    catch (cause) { if (origin === epoch) error.value = cause.message || '写操作未发送。'; return null }
    finally { if (origin === epoch) busy.value = { ...busy.value, [skillKey]: false } }
  }
  const submit = skillKey => perform(skillKey, async () => {
    if (pending.value[skillKey]) { queryUnknown.value = { ...queryUnknown.value, [skillKey]: '已有原操作，请先查询或原键重放。' }; return null }
    const row = rowFor(skillKey); const draft = drafts.value[skillKey]
    if (!row || !draft || !row.allowedActions.includes(draft.action) || draft.context !== contextFingerprint(row) || loading.value || error.value) return null
    const data = { action: draft.action, skillKey, sourceSkillInstallationId: row.installed?.skillInstallationId || null, expectedAgentVersion: catalog.value.agentVersion, expectedSkillRevision: row.skillRevision }
    if (['INSTALL', 'UPGRADE'].includes(draft.action)) {
      if (!draft.quote || draft.quote.expiresAt <= now()) { invalidateDraft(skillKey, '报价已过期，请重新获取并确认。'); return null }
      Object.assign(data, { targetProductVersionId: draft.quote.targetProductVersionId, quoteId: draft.quote.quoteId, approvedPermissions: [...draft.permissions], expectedPrice: clone(draft.quote.price) })
    }
    parse('CreateChangeData', data)
    return send({ schemaVersion: 1, kind: 'CREATE', agentId: agentId.value, skillKey, path: `${basePath()}/skill-changes`, key: createIdempotencyKey(), requestId: createIdempotencyKey(), data, skillChangeId: null, accepted: false })
  })
  const resumeOriginal = skillKey => perform(skillKey, async () => {
    const record = pending.value[skillKey]
    if (!record) return null
    if (record.kind !== 'QUOTE') return send(record)
    const row = rowFor(skillKey); const generation = (drafts.value[skillKey]?.generation || 0) + 1; const context = contextFingerprint(row)
    // Restoring approval is allowed only through this explicit original-request action.
    drafts.value = { ...drafts.value, [skillKey]: { action: record.data.action, permissions: [...record.data.approvedPermissions], quote: null, quoteIntent: record, quoteBusy: true, generation, context, message: '' } }
    const token = capture()
    try { return await quoteSend(skillKey, record, token, generation, context) }
    finally { controllers.delete(token.c) }
  })
  const abandonQuote = skillKey => perform(skillKey, () => {
    const record = pending.value[skillKey]
    if (record?.kind !== 'QUOTE') return null
    remove(skillKey, record); invalidateDraft(skillKey, '已放弃未提交的报价；安装操作不会被取消。')
    queryUnknown.value = { ...queryUnknown.value, [skillKey]: '' }
    return true
  })
  const changeAction = (skillKey, kind) => perform(skillKey, () => {
    if (pending.value[skillKey] && !pending.value[skillKey].accepted) return null
    const row = rowFor(skillKey); const change = row && latestChange(row)
    if (!change || !row.allowedActions.includes(kind) || (kind === 'RETRY' && (!change.retryAllowed || change.status !== 'FAILED_RETRYABLE'))) return null
    return send({ schemaVersion: 1, kind, agentId: agentId.value, skillKey, path: `${basePath()}/skill-changes/${skillPathSegment(change.skillChangeId)}/${kind.toLowerCase()}`,
      key: createIdempotencyKey(), requestId: createIdempotencyKey(), data: { expectedChangeRevision: change.changeRevision }, skillChangeId: change.skillChangeId, accepted: false })
  })
  const observe = async (run = observerEpoch) => {
    if (run !== observerEpoch || !polling || !available.value || disposed) return
    clearTimeout(timer); timer = null
    const origin = epoch
    const observing = () => run === observerEpoch && origin === epoch && polling && !disposed
    for (const record of Object.values(pending.value)) {
      if (!observing()) return
      if (record.skillChangeId) await checkOriginal(record.skillKey)
    }
    if (!observing()) return
    await refresh()
    if (!observing()) return
    await refreshChanges()
    for (const row of items.value) {
      if (!observing()) return
      if (pending.value[row.skillKey]?.skillChangeId || (latestChange(row) && !skillChangeTerminal(latestChange(row)))) await checkOriginal(row.skillKey)
    }
    // Network observation only; never simulates progress or resubmits a write.
    if (observing() && available.value) timer = setTimeout(() => observe(run), 2500)
  }
  const setPolling = value => {
    if (polling === value) return
    polling = value; observerEpoch++; clearTimeout(timer); timer = null
    if (value) void observe()
  }
  const reset = () => {
    epoch++; readEpoch++; observerEpoch++; clearTimeout(timer); timer = null
    for (const c of controllers) c.abort(); controllers.clear()
    catalog.value = null; changes.value = []; drafts.value = {}; pending.value = {}; queryUnknown.value = {}; busy.value = {}
    loading.value = false; error.value = ''; recordsError.value = ''; storageError.value = ''
    if (available.value && !disposed) { recover(); if (polling) void observe() }
  }
  const stop = watch([scope, identity, agentId, () => read(enabled)], (value, prior) => {
    if (!prior || value[0] !== prior[0] || value[1] !== prior[1]) identityRevoked.value = false
    reset()
  }, { immediate: true, flush: 'sync' })
  const unregister = registerIdentityCleanup(() => { identityRevoked.value = true; reset() })
  const dispose = () => { disposed = true; polling = false; stop(); unregister(); reset() }
  if (getCurrentScope()) onScopeDispose(dispose)
  return { catalog, items, changes, drafts, pending, busy, queryUnknown, loading, error, recordsError, storageError, available,
    prepare, setApprovedPermissions, canPrepare, requestQuote, submit, retry: key => changeAction(key, 'RETRY'), reconcile: key => changeAction(key, 'RECONCILE'),
    latestChange, checkOriginal, resumeOriginal, abandonQuote, refresh, refreshChanges, setPolling, dispose }
}
