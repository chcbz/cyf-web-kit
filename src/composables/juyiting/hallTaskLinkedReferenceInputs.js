import { computed, getCurrentInstance, onBeforeUnmount, ref, unref, watch } from 'vue'
import { usePersonalWorkspace } from '../usePersonalWorkspace.js'
import { usePersonalWorkspaceTaskLinks } from '../usePersonalWorkspaceTaskLinks.js'

const MAX_INT = 2147483647
const POLICIES = new Set(['EMPTY_ONLY', 'TASK_LINKED_REFERENCE'])
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png'])
const exactId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 &&
  value.trim() === value && [...value].every(char => {
  const point = char.codePointAt(0)
  return point >= 0x20 && point !== 0x7f && !(point >= 0x80 && point <= 0x9f) && !(point >= 0xd800 && point <= 0xdfff)
})
const exactVersion = value => Number.isInteger(value) && value >= 1 && value <= MAX_INT
const valueOf = value => typeof value === 'function' ? value() : unref(value)
const normalizeMime = value => typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : ''
const result = (state, reason = null, inputRefs = []) => Object.freeze({
  state,
  reason,
  inputRefs: Object.freeze(inputRefs.map(item => Object.freeze({ ...item })))
})
const stale = () => result('STALE', 'CONTEXT_CHANGED')
const blocked = reason => result('BLOCKED', reason)
const ready = inputRefs => result('READY', null, inputRefs)

/**
 * Resolves the exact owner-readable versions from a complete task-link directory.
 * Browser metadata checks are fail-closed UX checks; server assignment remains the
 * authorization and transaction boundary.
 */
export function useHallTaskLinkedReferenceInputs ({ identityEpoch = 0, taskLinksApi, workspaceApi } = {}) {
  const selectedTaskId = ref('')
  const state = ref(result('IDLE'))
  const identityKey = computed(() => String(valueOf(identityEpoch) ?? ''))
  const taskLinks = usePersonalWorkspaceTaskLinks({ api: taskLinksApi, taskId: selectedTaskId, identityEpoch })
  const workspace = usePersonalWorkspace({ api: workspaceApi, identityEpoch })
  let generation = 0
  let disposed = false

  const invalidate = () => {
    generation += 1
    selectedTaskId.value = ''
    taskLinks.reset()
    workspace.reset()
    if (!disposed) state.value = result('IDLE')
  }
  const stopIdentityWatch = watch(identityKey, invalidate, { flush: 'sync' })
  const dispose = () => {
    if (disposed) return
    disposed = true
    generation += 1
    stopIdentityWatch()
    selectedTaskId.value = ''
    taskLinks.dispose()
    workspace.dispose()
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  const resolve = async ({ taskId, inputRefsPolicy, isCurrent = () => true } = {}) => {
    if (disposed || !exactId(taskId) || !POLICIES.has(inputRefsPolicy) || typeof isCurrent !== 'function') {
      return blocked('INVALID_REQUEST')
    }
    const epoch = ++generation
    taskLinks.reset()
    workspace.reset()
    selectedTaskId.value = taskId
    state.value = result('LOADING')
    const current = () => !disposed && generation === epoch && selectedTaskId.value === taskId && isCurrent() === true

    const links = await taskLinks.loadAll()
    if (!current()) return stale()
    if (!Array.isArray(links)) {
      const failure = blocked('CATALOG_UNAVAILABLE')
      state.value = failure
      return failure
    }

    const references = links.filter(link => link.state === 'ACTIVE' && link.role === 'REFERENCE')
    if (references.length > 32) {
      const failure = blocked('TOO_MANY_REFERENCES')
      state.value = failure
      return failure
    }
    const exactReferences = new Set()
    for (const link of references) {
      const key = JSON.stringify([link.fileId, link.version])
      if (exactReferences.has(key)) {
        const failure = blocked('DUPLICATE_REFERENCE')
        state.value = failure
        return failure
      }
      exactReferences.add(key)
    }

    const details = new Map()
    for (const link of references) {
      let detail = details.get(link.fileId)
      if (!detail) {
        detail = await workspace.select(link.fileId)
        if (!current()) return stale()
        if (!detail) {
          const failure = blocked('FILE_UNAVAILABLE')
          state.value = failure
          return failure
        }
        details.set(link.fileId, detail)
      }
      if (detail.file?.fileId !== link.fileId || detail.file?.state !== 'ACTIVE' || !Array.isArray(detail.versions) ||
        detail.versions.some(version => version?.fileId !== link.fileId || !exactVersion(version?.version))) {
        const failure = blocked('FILE_DETAIL_MISMATCH')
        state.value = failure
        return failure
      }
      const versions = detail.versions.filter(version => version.version === link.version)
      if (versions.length !== 1 || !IMAGE_MIME_TYPES.has(normalizeMime(versions[0].contentMimeType))) {
        const failure = blocked(versions.length === 1 ? 'UNSUPPORTED_REFERENCE_MIME' : 'REFERENCE_VERSION_MISMATCH')
        state.value = failure
        return failure
      }
    }

    if (!current()) return stale()
    if (inputRefsPolicy === 'EMPTY_ONLY' && references.length) {
      const failure = blocked('REFERENCES_NOT_ALLOWED')
      state.value = failure
      return failure
    }
    const inputRefs = references
      .map(link => ({ fileId: link.fileId, version: link.version, purpose: 'REFERENCE' }))
      .sort((a, b) => a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : a.version - b.version)
    const success = ready(inputRefs)
    state.value = success
    return success
  }

  return Object.freeze({ state, resolve, invalidate, dispose })
}
