import { protocolError } from './apiEnvelope.js'

// SM-C1, interface-standard v1.2 (2026-10-14). Byte-locked source fixtures:
// tests/fixtures/skill-management/source.json. No legacy marketplace DTO parsing.
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = v => typeof v === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)
const bool = v => typeof v === 'boolean'
export const skillId = v => text(v) && v.length > 0 && Array.from(v).length <= 100 && !Array.from(v).some(ch => /\s/u.test(ch) || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
export const skillRevision = v => text(v) && /^(0|[1-9]\d*)$/.test(v) && BigInt(v) <= 9223372036854775807n
const positive = v => skillRevision(v) && v !== '0'
const time = v => Number.isSafeInteger(v) && v >= 0
const sha = v => text(v) && /^[a-f0-9]{64}$/.test(v)
const key = v => text(v) && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v)
const version = v => text(v) && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(v)
const one = values => v => values.includes(v)
const nullable = check => v => v === null || check(v)
const list = check => v => Array.isArray(v) && v.every(check)
const unique = check => v => list(check)(v) && new Set(v).size === v.length
const shape = fields => v => object(v) && Object.keys(v).length === Object.keys(fields).length &&
  Object.entries(fields).every(([name, check]) => Object.hasOwn(v, name) && check(v[name]))
export const utf8Compare = (a, b) => {
  const encoder = new TextEncoder(); const aa = encoder.encode(a); const bb = encoder.encode(b)
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]
  return aa.length - bb.length
}
export const sortSkillPermissions = values => [...values].sort(utf8Compare)
const permissions = unique(v => text(v) && v.length > 0)
const money = shape({ amountMinor: skillRevision, currency: one(['SILVER']) })
const action = one(['INSTALL', 'UPGRADE', 'ENABLE', 'DISABLE', 'UNINSTALL'])
const allowedAction = one(['VIEW', 'INSTALL', 'UPGRADE', 'ENABLE', 'DISABLE', 'UNINSTALL', 'RETRY', 'RECONCILE'])
// Display labels only: approval, digest and wire data retain the original permission keys.
const permissionLabels = Object.freeze({ READ_AUTHORIZED_INPUT: '读取本次授权的输入', WRITE_TASK_RESULT: '生成结果并写回当前任务' })
export const formatSkillPermission = permission => Object.hasOwn(permissionLabels, permission) ? permissionLabels[permission] : permission
export const SKILL_CHANGE_LABELS = Object.freeze({ ACCEPTED: '已接纳', WAITING_AGENT: '等待连接', PREPARING: '下载与校验', PREPARED: '准备完成', ACTIVATING: '安全切换', VERIFYING: '已应用，待运行核验', SUCCEEDED: '完成', FAILED_RETRYABLE: '准备失败，可重试', FAILED_FINAL: '操作已终结', RECOVERY_REQUIRED: '结果待核对' })
export const SKILL_RUNTIME_LABELS = Object.freeze({ UNKNOWN: '运行状态未知', OFFLINE: '离线', VERIFYING: '待运行核验', READY: '运行就绪', DEPENDENCY_MISSING: '缺少运行依赖', PROVIDER_UNBOUND: '服务尚未绑定', VERSION_MISMATCH: '版本不一致', NOT_EXECUTABLE: '说明型技能，不提供执行动作' })
export const SKILL_REASON_LABELS = Object.freeze({ AGENT_OFFLINE: '好汉当前离线', RUNTIME_MAPPING_REQUIRED: '请先连接好汉', PUBLICATION_UNAVAILABLE: '批准版本暂不可用', UPGRADE_POLICY_UNSET: '平台尚未配置升级政策', UPGRADE_NOT_ALLOWED: '当前权益不允许升级', PERMISSION_REQUIRED: '需明确批准权限', SKILL_CHANGE_PENDING: '请先处理原操作', DEPENDENCY_MISSING: '缺少运行依赖', PROVIDER_UNBOUND: '服务尚未绑定', VERSION_MISMATCH: '版本不一致', NOT_EXECUTABLE: '说明型技能', RECEIPT_UNKNOWN: '操作结果待确认', PREPARATION_FAILED: '准备未通过', PACKAGE_DIGEST_MISMATCH: '安装文件校验失败', ARCHIVE_INVALID: '安装包无法读取', DOWNLOAD_FORBIDDEN: '下载未获授权', IDENTITY_CHANGED: '身份已变化', ENTITLEMENT_TERMINATED: '权益已终结', POLICY_NOT_SYNCED: '运行策略待同步', CATALOG_UNCONFIRMED: '能力目录待确认', STATE_UNAVAILABLE: '状态暂不可读取', INTEGRITY_UNPROVEN: '安装结果待确认', STATE_CHANGED: '状态已变化' })
const reason = nullable(one(Object.keys(SKILL_REASON_LABELS)))
const packageFields = { productVersionId: skillId, skillVersion: version, packageSha256: sha, manifestSha256: nullable(sha), byteLength: positive, kind: one(['EXECUTABLE', 'INSTRUCTION']) }
const kindMatches = v => v.kind === 'EXECUTABLE' ? sha(v.manifestSha256) : v.manifestSha256 === null
const packageRef = v => shape({ skillInstallationId: skillId, ...packageFields })(v) && kindMatches(v)
const details = v => shape({ ...packageFields, inputMimeTypes: list(text), requiredPermissions: permissions, requirements: list(text), changeSummary: text, executionCostDescription: nullable(text) })(v) && kindMatches(v)
const installed = shape({ skillInstallationId: skillId, version: details })
const positionSource = shape({ type: one(['POSITION']), grantId: skillId, grantRevision: positive, bindingId: positive })
const change = v => {
  if (!object(v)) return false
  const position = Object.hasOwn(v, 'authorizationSource')
  return shape({ ...(position ? { authorizationSource: positionSource } : {}), skillChangeId: skillId, agentId: skillId, skillKey: key, action,
  skillRevision: positive, changeRevision: positive, attempt: n => Number.isInteger(n) && n >= 1 && n <= 2147483647,
  source: nullable(packageRef), target: packageRef, status: one(Object.keys(SKILL_CHANGE_LABELS)), desiredEnabled: bool,
  runtimeSynced: bool, reasonCode: reason, retryAllowed: bool, orderId: nullable(skillId), fundingStatus: one(['NONE', 'HELD', 'CAPTURED', 'REFUNDED']),
  price: nullable(money), actorLabel: text, createdAt: time, updatedAt: time })(v) &&
  (v.action === 'INSTALL' ? v.source === null && (position || money(v.price) && skillId(v.orderId)) : packageRef(v.source)) &&
  (!position || (v.price === null && v.orderId === null && v.fundingStatus === 'NONE')) &&
  (!['ENABLE', 'DISABLE', 'UNINSTALL'].includes(v.action) || (v.price === null && v.orderId === null && v.fundingStatus === 'NONE')) &&
  (v.action !== 'UNINSTALL' || !v.desiredEnabled) &&
  (v.retryAllowed === (v.status === 'FAILED_RETRYABLE')) &&
  (!v.retryAllowed || ['NONE', 'HELD'].includes(v.fundingStatus)) &&
  (!(v.status === 'SUCCEEDED' && v.action !== 'DISABLE') || v.runtimeSynced)
}
const row = shape({ skillKey: key, name: text, description: text, skillRevision,
  installed: nullable(installed), candidate: nullable(details), upgradeEligibility: one(['NOT_APPLICABLE', 'COVERED', 'PAID', 'POLICY_UNSET', 'NOT_ALLOWED']),
  desiredEnabled: bool, admissionEnabled: bool, runtime: shape({ state: one(Object.keys(SKILL_RUNTIME_LABELS)), reasonCode: reason, observedAt: nullable(time), catalogRevision: nullable(skillRevision) }),
  allowedActions: unique(allowedAction), deniedActions: list(shape({ action: v => allowedAction(v) && v !== 'VIEW', reasonCode: one(Object.keys(SKILL_REASON_LABELS)) })), latestChange: nullable(change) })
const quote = v => shape({ quoteId: skillId, action: one(['INSTALL', 'UPGRADE']), agentId: skillId, skillKey: key,
  sourceSkillInstallationId: nullable(skillId), targetProductVersionId: skillId, targetSkillVersion: version, targetPackageSha256: sha,
  expectedAgentVersion: positive, expectedSkillRevision: skillRevision, approvedPermissionsSha256: sha, price: money,
  coverage: one(['PURCHASE', 'ENTITLEMENT']), entitlementId: nullable(skillId), expiresAt: time })(v) &&
  (v.action === 'INSTALL' ? v.sourceSkillInstallationId === null : skillId(v.sourceSkillInstallationId)) &&
  (v.coverage !== 'PURCHASE' || v.entitlementId === null) &&
  (v.coverage !== 'ENTITLEMENT' || (skillId(v.entitlementId) && v.price.amountMinor === '0'))
const quoteInputFields = { action: one(['INSTALL', 'UPGRADE']), agentId: skillId, skillKey: key, sourceSkillInstallationId: nullable(skillId), targetProductVersionId: skillId, expectedAgentVersion: positive, expectedSkillRevision: skillRevision, approvedPermissions: permissions }
const sourceMatches = v => v.action === 'INSTALL' ? v.sourceSkillInstallationId === null : skillId(v.sourceSkillInstallationId)
const quoteInput = v => shape(quoteInputFields)(v) && sourceMatches(v)
const createFields = Object.fromEntries(Object.entries(quoteInputFields).filter(([name]) => name !== 'agentId'))
const create = v => ['INSTALL', 'UPGRADE'].includes(v?.action)
  ? shape({ ...createFields, quoteId: skillId, expectedPrice: money })(v) && sourceMatches(v)
  : shape({ action: one(['ENABLE', 'DISABLE', 'UNINSTALL']), skillKey: key, sourceSkillInstallationId: skillId, expectedAgentVersion: positive, expectedSkillRevision: skillRevision })(v)
const checks = { SkillList: shape({ agentId: skillId, agentVersion: positive, items: list(row) }), SkillChange: change,
  ChangeList: shape({ agentId: skillId, items: list(change) }), Quote: quote, QuoteRequestData: quoteInput, CreateChangeData: create,
  ChangeActionData: shape({ expectedChangeRevision: positive }), Id: skillId }
export function parseSkillManagement (name, value) {
  if (!checks[name]?.(value)) throw protocolError('PROTOCOL_INVALID_SKILL_MANAGEMENT')
  return value
}
export const skillPathSegment = value => {
  if (!skillId(value) || (/[/\\?#]/u.test(value) || Array.from(value).some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127))) throw protocolError('PROTOCOL_INVALID_SKILL_PATH')
  return encodeURIComponent(value)
}
export const skillChangeTerminal = v => ['SUCCEEDED', 'FAILED_FINAL', 'FAILED_RETRYABLE', 'RECOVERY_REQUIRED'].includes(v?.status)
export async function skillPermissionsSha256 (values) {
  if (!permissions(values)) throw protocolError('PROTOCOL_INVALID_SKILL_PERMISSIONS')
  const bytes = new TextEncoder().encode('cyf.skill.permissions.v1\0' + JSON.stringify(sortSkillPermissions(values)))
  if (!globalThis.crypto?.subtle) throw protocolError('SECURE_CRYPTO_UNAVAILABLE')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('')
}
