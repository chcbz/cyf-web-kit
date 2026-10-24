import { ref, watch } from 'vue'

const requiredKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && keys.every(key => Object.hasOwn(value, key))
const text = value => typeof value === 'string' && value.trim().length > 0
const safeTime = value => Number.isSafeInteger(value) && value >= 0
const reasonCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value)

/** Required, browser-safe fields only; additive metadata is ignored; the HTTP client has already decoded the common envelope. */
export const agentProfileCapabilitiesProjection = (raw, expectedAgentId) => {
  if (!requiredKeys(raw, ['agentId', 'observedAt', 'abilities', 'lastSeenAt', 'skills']) || raw.agentId !== expectedAgentId || !safeTime(raw.observedAt) || !(raw.lastSeenAt === null || safeTime(raw.lastSeenAt)) || !Array.isArray(raw.abilities) || !raw.abilities.every(text)) return null
  const directory = raw.skills
  if (!requiredKeys(directory, ['status', 'catalogRevision', 'reasonCode', 'items']) || !Array.isArray(directory.items)) return null
  if (directory.catalogRevision !== null && !(typeof directory.catalogRevision === 'string' && /^(0|[1-9][0-9]*)$/.test(directory.catalogRevision))) return null
  if (directory.status === 'UNAVAILABLE') {
    if (directory.reasonCode !== 'SKILL_DESCRIPTOR_SOURCE_UNAVAILABLE' || directory.items.length || directory.catalogRevision !== null) return null
  } else if (directory.status !== 'AVAILABLE' || directory.reasonCode !== null) return null
  const identities = new Set()
  const items = []
  for (const item of directory.items) {
    if (!requiredKeys(item, ['skillKey', 'skillVersion', 'title', 'installationVerified', 'runtimeState', 'reasonCode']) || !text(item.skillKey) || !text(item.skillVersion) || !text(item.title) || typeof item.installationVerified !== 'boolean') return null
    if (item.runtimeState === 'RUNTIME_READY') {
      if (!item.installationVerified || item.reasonCode !== null) return null
    } else if (item.runtimeState !== 'UNAVAILABLE' || !reasonCode(item.reasonCode)) return null
    const key = JSON.stringify([item.skillKey, item.skillVersion])
    if (identities.has(key)) return null
    identities.add(key)
    items.push(Object.freeze({ skillKey: item.skillKey, skillVersion: item.skillVersion, title: item.title, installationVerified: item.installationVerified, runtimeState: item.runtimeState, reasonCode: item.reasonCode }))
  }
  return Object.freeze({ agentId: raw.agentId, observedAt: raw.observedAt, lastSeenAt: raw.lastSeenAt, abilities: Object.freeze([...raw.abilities]), skills: Object.freeze({ status: directory.status, catalogRevision: directory.catalogRevision, reasonCode: directory.reasonCode, items: Object.freeze(items) }) })
}

const reasons = {
  SKILL_RUNTIME_UNAVAILABLE: '运行状态待核验',
  SKILL_RUNTIME_DISCONNECTED: 'Runtime已断开',
  SKILL_RUNTIME_NOT_DECLARED: '当前Runtime尚未报告此技能',
  SKILL_RUNTIME_INVALID_DECLARATION: '运行能力声明未通过核验',
  SKILL_RUNTIME_EVIDENCE_INVALID: '运行能力声明未通过核验',
  SKILL_RUNTIME_BINDING_MISMATCH: '技能与当前运行实例不匹配',
  SKILL_RUNTIME_CHANGED: '运行会话变化，请刷新',
  SKILL_RUNTIME_FENCED: '运行会话变化，请刷新',
  SKILL_RUNTIME_AMBIGUOUS: '运行会话不唯一，请刷新',
  SKILL_NOT_EXECUTABLE: '非可执行技能包',
  SKILL_NOT_INSTALLED: '无有效安装权益',
  SKILL_INSTALLATION_EVIDENCE_INVALID: '安装证据未通过核验',
  SKILL_INSTALLATION_RECEIPT_MISSING: '安装回执尚未核验',
  SKILL_INSTALLATION_BINDING_INVALID: '安装绑定未通过核验',
  SKILL_INSTALLATION_CHANGED: '安装记录变化，请刷新',
  SKILL_INSTALLATION_AMBIGUOUS: '安装记录不唯一，请刷新'
}
export const agentProfileReasonText = reason => reasons[reason] || (reasonCode(reason) ? `暂不可用（${reason}）` : '暂不可用')

/** Latest-wins and identity fenced. A profile read never grants, installs or dispatches. */
export const useHallAgentProfileCapabilities = ({ api, getAgent, identityKey, enabled = () => false }) => {
  const projection = ref(null)
  const loading = ref(false)
  const error = ref('')
  let epoch = 0
  let controller = null
  let disposed = false
  const fingerprint = () => {
    const agent = getAgent()
    return JSON.stringify([identityKey(), enabled(), agent?.agentId, agent?.boundToMe, agent?.systemAgent])
  }
  const allowed = () => enabled() && Boolean(identityKey()) && text(getAgent()?.agentId) && getAgent()?.boundToMe === true && getAgent()?.systemAgent !== true
  const reset = () => {
    epoch++
    controller?.abort()
    controller = null
    projection.value = null
    error.value = ''
    loading.value = false
  }
  const refresh = async () => {
    reset()
    if (disposed || !allowed()) return false
    const generation = epoch
    const scope = fingerprint()
    const agentId = getAgent().agentId
    const own = new AbortController()
    controller = own
    loading.value = true
    const current = () => !disposed && generation === epoch && !own.signal.aborted && scope === fingerprint()
    try {
      const raw = await api.get(`/${encodeURIComponent(agentId)}/profile-capabilities`, {}, { autoLoading: false, needAuth: true, signal: own.signal })
      if (!current()) return false
      const value = agentProfileCapabilitiesProjection(raw, agentId)
      if (!value) throw new Error('Untrusted profile response')
      projection.value = value
      return true
    } catch (cause) {
      if (current()) error.value = cause?.status === 401 ? '请重新登录后查看' : cause?.status === 404 ? '当前Agent不可访问，请刷新点将册' : '技能与本领读取失败，请重试'
      return false
    } finally {
      if (current()) { loading.value = false; controller = null }
    }
  }
  const stop = watch(fingerprint, () => { reset(); if (allowed()) void refresh() }, { immediate: true, flush: 'sync' })
  return { projection, loading, error, refresh, reset, dispose: () => { disposed = true; reset(); stop() } }
}
