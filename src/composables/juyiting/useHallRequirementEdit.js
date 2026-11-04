import { computed, onScopeDispose, ref, watch } from 'vue'
import { validMaterialVersion } from './materialVersion.js'
import { pointAndStartLong } from './hallPointAndStartIntent.js'

// The shared workspace picker uses canonical strings; the edit wire uses int32 numbers.
export const requirementPickerMaterials = attachments => attachments.map(a => ({ ...a, version: String(a.version), displayName: `资料 ${a.fileId}` }))
const editAttachments = attachments => attachments.map(({ fileId, version }) => {
  if (!validMaterialVersion(String(version))) throw new Error('资料版本无效，请重新选择固定版本。')
  return { fileId, version: Number(version) }
})

const attachmentsKey = refs => JSON.stringify(refs.map(({ fileId, version }) => [fileId, version]).sort())
const validView = (value, taskId) => value?.taskId === taskId && pointAndStartLong(value.taskVersion, true) &&
  pointAndStartLong(value.requirementRevision) && typeof value.title === 'string' &&
  (value.description === null || typeof value.description === 'string') && Array.isArray(value.attachments) &&
  value.attachments.every(a => typeof a?.fileId === 'string' && Number.isInteger(a.version) && a.version > 0)

// Persistence and recommendation are separate outcomes: only an authoritative save emits saved.
export function useHallRequirementEdit({ agentApi, task, identity, enabled, onSaved }) {
  const snapshot = ref(null), busy = ref(false), error = ref(''), pending = ref(null)
  let generation = 0, controller = null
  const reset = () => { generation++; controller?.abort(); controller = null; snapshot.value = null; busy.value = false; error.value = ''; pending.value = null }
  const stop = watch(() => [identity(), task()?.id], reset, { flush: 'sync' })
  onScopeDispose(() => { stop(); reset() })
  const run = async action => {
    if (busy.value || !enabled() || !task()?.id) return false
    const id = task().id, owner = identity(), epoch = ++generation
    const own = new AbortController(); controller = own; busy.value = true; error.value = ''
    const current = () => epoch === generation && owner === identity() && task()?.id === id
    try { return await action(id, { autoLoading: false, needAuth: true, signal: own.signal }, current) }
    catch (cause) {
      if (current()) error.value = pending.value ? '保存结果待核对，请查询结果或继续原保存操作，不要重复编辑。' : cause?.message || '需求暂不可读取，请重试。'
      return false
    } finally { if (current()) { busy.value = false; controller = null } }
  }
  const load = () => run(async (id, options, current) => {
    if (pending.value) return false
    const value = await agentApi.get(`/tasks/${encodeURIComponent(id)}/requirements/edit`, undefined, options)
    if (!current()) return false
    if (!enabled() || !validView(value, id) || (pointAndStartLong(task()?.taskVersion, true) && BigInt(value.taskVersion) < BigInt(task().taskVersion))) throw new Error('事项需求已变化，请重新读取。')
    snapshot.value = value
    return true
  })
  const accept = (value, id) => {
    const command = pending.value?.body
    if (!enabled() || (pointAndStartLong(value?.taskVersion, true) && pointAndStartLong(task()?.taskVersion, true) && BigInt(value.taskVersion) < BigInt(task().taskVersion))) { pending.value = null; error.value = '事项已变化，请重新查看当前需求。'; return false }
    if (!validView(value, id) || !command) return false
    const delta = BigInt(value.taskVersion) - BigInt(command.expectedTaskVersion)
    if (![0n, 1n].includes(delta) || BigInt(value.requirementRevision) !== BigInt(command.expectedRequirementRevision) + delta ||
      value.title !== command.title || value.description !== command.description ||
      attachmentsKey(value.attachments) !== attachmentsKey(command.attachments)) return false
    snapshot.value = value; pending.value = null; error.value = ''; onSaved(delta === 0n ? { ...value, changed: false } : value)
    return true
  }
  const save = values => run(async (id, options, current) => {
    if (!pending.value) {
      if (!snapshot.value || snapshot.value.taskId !== id) throw new Error('请先读取当前事项需求。')
      const body = { expectedTaskVersion: snapshot.value.taskVersion, expectedRequirementRevision: snapshot.value.requirementRevision,
        title: values.title.trim(), description: values.description.trim(), attachments: editAttachments(values.attachments) }
      if (!body.title || !body.description) throw new Error('请填写事项标题和需求描述。')
      pending.value = { key: crypto.randomUUID(), body }
    }
    const intent = pending.value
    try {
      const value = await agentApi.put(`/tasks/${encodeURIComponent(id)}/requirements/edit`, intent.body, {
        ...options, headers: { 'Idempotency-Key': intent.key }
      })
      if (!current()) return false
      if (!accept(value, id)) throw new Error('保存响应尚未核对。')
      return true
    } catch (cause) {
      if (current() && [400, 401, 403, 404, 409].includes(Number(cause?.status))) {
        pending.value = null
        error.value = Number(cause.status) === 409 ? '事项状态或需求已变化，本次保存未提交；请关闭后重新读取。' : '保存被拒绝，请核对权限及所选资料后重试。'
        return false
      }
      throw cause
    }
  })
  const check = () => run(async (id, options, current) => {
    if (!pending.value) return false
    const value = await agentApi.get(`/tasks/${encodeURIComponent(id)}/requirements/edit`, undefined, {
      ...options, headers: { 'Idempotency-Key': pending.value.key }
    })
    if (!current()) return false
    if (accept(value, id)) return true
    error.value = '尚未确认本次修改。可继续原保存操作；若事项已被他人修改，请关闭后重新读取。'
    return false
  })
  return { snapshot, busy, error, pending, blocked: computed(() => busy.value || !!pending.value), load, save, check }
}
