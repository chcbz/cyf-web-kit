import { computed, getCurrentInstance, onUnmounted, ref, unref, watch } from 'vue'
import { createApi } from '../useHttp.js'

export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024
export const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
const MAX_INT = 2147483647
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/
const hasControl = value => Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
const ID = value => typeof value === 'string' && value.length > 0 && value.length <= 100 &&
  !/^[\s]|[\s]$/.test(value) && !hasControl(value)
const TEXT = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum &&
  !/^[\s]|[\s]$/.test(value) && !hasControl(value)
const ALLOWED_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf',
  'image/png', 'image/jpeg', 'application/zip'
])

const resolveValue = value => typeof value === 'function' ? value() : unref(value)
const unwrap = result => {
  let value = result
  for (let index = 0; index < 3 && value && typeof value === 'object' && Object.hasOwn(value, 'data'); index += 1) value = value.data
  return value
}
const positiveInteger = value => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_INT) return value
  if (typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed <= MAX_INT ? parsed : null
  }
  return null
}
const previousInteger = value => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_INT) return value
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed < MAX_INT ? parsed : null
  }
  return null
}
const failureMessage = error => {
  if ([401, 403, 404].includes(error?.status)) return '当前身份或任务已不可访问；已清除本次传输选择。'
  if (error?.status === 409) return '成果版本已变化。请先手动刷新协作状态，再明确填写新版本；未自动重试。'
  if (error?.status === 503) return '成果存储暂不可用（默认未启用时会返回此状态）。'
  if (error?.requestErrorClass === 'network' || error instanceof TypeError) return '网络结果不明确，尚不能确认已保存；请先刷新确认，未自动重试。'
  return error?.message || '传输未完成；尚不能确认已保存。'
}
const responseMatchesPublish = (value, body, size) => value && Object.keys(value).length === 6 &&
  value.artifactId === body.artifactId && value.artifactVersion === body.artifactVersion &&
  typeof value.contentHash === 'string' && /^[0-9a-f]{64}$/.test(value.contentHash) &&
  value.contentByteLength === size && value.contentMimeType === body.contentMimeType &&
  Number.isInteger(value.createdAt) && value.createdAt >= 0
const safeMime = value => typeof value === 'string' && MIME.test(value.toLowerCase()) ? value.toLowerCase() : null
const initialDraft = () => ({ artifactId: '', workItemId: '', artifactType: 'evidence', title: '', contentMimeType: 'text/plain', artifactVersion: 1, expectedPreviousVersion: 0, visibility: 'task_members' })
const b64 = bytes => {
  let result = ''
  const block = 0x8000
  for (let index = 0; index < bytes.length; index += block) result += String.fromCharCode(...bytes.subarray(index, index + block))
  return btoa(result)
}

/** Explicit F02 transfer boundary. It only uses createApi/useHttp, never infers an actor, and never retries publication. */
export const useHallArtifactTransfer = ({ api = createApi('/agent'), subject, workspace, identityEpoch = 0,
  documentRef = globalThis.document, urlApi = globalThis.URL } = {}) => {
  const file = ref(null)
  const draft = ref(initialDraft())
  const download = ref({ artifactId: '', artifactVersion: '' })
  const state = ref('idle')
  const message = ref('')
  const receipt = ref(null)
  const conflict = ref(false)
  const activeUrls = new Set()
  const controllers = new Set()
  let generation = 0
  let activeOperation = null

  const currentSubject = computed(() => resolveValue(subject) || null)
  const currentWorkspace = computed(() => resolveValue(workspace) || null)
  const currentEpoch = computed(() => resolveValue(identityEpoch))
  const taskId = computed(() => currentSubject.value?.taskId || '')
  const actorAgentId = computed(() => currentSubject.value?.actorAgentId || '')
  const operable = computed(() => ID(taskId.value) && ID(actorAgentId.value))
  const artifacts = computed(() => Array.isArray(currentWorkspace.value?.recentArtifacts)
    ? currentWorkspace.value.recentArtifacts.filter(item => ID(item?.artifactId) && positiveInteger(item?.artifactVersion)) : [])
  const scope = computed(() => `${taskId.value}\u0000${actorAgentId.value}\u0000${String(currentEpoch.value)}`)

  const revokeObjectUrls = () => {
    for (const url of activeUrls) urlApi?.revokeObjectURL?.(url)
    activeUrls.clear()
  }
  const clearAccessState = () => {
    file.value = null
    draft.value = initialDraft()
    receipt.value = null
    download.value = { artifactId: '', artifactVersion: '' }
    revokeObjectUrls()
  }
  const reset = () => {
    generation += 1
    for (const controller of controllers) controller.abort()
    controllers.clear()
    activeOperation = null
    clearAccessState()
    state.value = 'idle'; message.value = ''; conflict.value = false
  }
  watch(scope, reset, { immediate: true, flush: 'sync' })

  const setFile = candidate => {
    receipt.value = null; conflict.value = false; message.value = ''
    if (!candidate) { file.value = null; return false }
    const mime = safeMime(candidate.type)
    if (!Number.isFinite(candidate.size) || candidate.size < 0 || candidate.size > MAX_UPLOAD_BYTES) {
      file.value = null; state.value = 'error'; message.value = '文件超过 16 MiB 上传上限或大小无效。'; return false
    }
    if (!mime || !ALLOWED_MIME_TYPES.has(mime)) {
      file.value = null; state.value = 'error'; message.value = '仅支持文本、JSON、PDF、PNG、JPEG 或 ZIP 文件。'; return false
    }
    file.value = candidate
    draft.value = { ...draft.value, contentMimeType: mime }
    state.value = 'idle'
    return true
  }

  const prepareNextVersion = artifact => {
    const previous = positiveInteger(artifact?.artifactVersion)
    if (!ID(artifact?.artifactId) || !previous || previous >= MAX_INT) return false
    draft.value = { ...draft.value, artifactId: artifact.artifactId, artifactVersion: previous + 1, expectedPreviousVersion: previous }
    return true
  }
  const selectDownload = artifact => {
    const version = positiveInteger(artifact?.artifactVersion)
    if (!ID(artifact?.artifactId) || !version) return false
    download.value = { artifactId: artifact.artifactId, artifactVersion: String(version) }
    return true
  }
  const request = (options, controller) => api.execute({ ...options, autoLoading: false, needAuth: true, signal: controller.signal })
  const capturedCurrent = (captured, capturedTask, capturedActor, capturedEpoch, controller) =>
    captured === generation && !controller.signal.aborted && capturedTask === taskId.value &&
    capturedActor === actorAgentId.value && capturedEpoch === currentEpoch.value
  const uploadInput = (snapshot, chosen, capturedTask, capturedActor) => {
    const artifactVersion = positiveInteger(snapshot.artifactVersion)
    const expectedPreviousVersion = previousInteger(snapshot.expectedPreviousVersion)
    const mime = safeMime(snapshot.contentMimeType)
    if (!ID(capturedTask) || !ID(capturedActor)) throw new Error('未取得当前任务与明确好汉身份，不能传输成果。')
    if (!chosen) throw new Error('请先明确选择要上传的文件。')
    if (!ID(snapshot.artifactId) || !TEXT(snapshot.artifactType, 30) || !TEXT(snapshot.title, 255)) throw new Error('请填写有效的成果标识、类型和标题。')
    if (!mime || !ALLOWED_MIME_TYPES.has(mime) || !Number.isFinite(chosen.size) || chosen.size < 0 || chosen.size > MAX_UPLOAD_BYTES) throw new Error('文件类型或大小不符合上传边界。')
    if (!artifactVersion || expectedPreviousVersion == null || artifactVersion !== expectedPreviousVersion + 1) throw new Error('成果版本必须是前一版本加一的精确整数。')
    return { artifactVersion, expectedPreviousVersion, mime }
  }
  const publish = async () => {
    if (activeOperation) return null
    const captured = ++generation
    const capturedTask = taskId.value; const capturedActor = actorAgentId.value; const capturedEpoch = currentEpoch.value
    const snapshot = { ...draft.value }
    const chosen = file.value
    let input
    try { input = uploadInput(snapshot, chosen, capturedTask, capturedActor) } catch (error) { state.value = 'error'; message.value = error.message; return null }
    const controller = new AbortController(); controllers.add(controller); activeOperation = controller
    state.value = 'publishing'; message.value = ''; receipt.value = null; conflict.value = false
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer())
      if (!capturedCurrent(captured, capturedTask, capturedActor, capturedEpoch, controller)) return null
      if (bytes.byteLength !== chosen.size || bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error('读取的文件大小不符合上传边界。')
      const body = {
        artifactId: snapshot.artifactId, workItemId: snapshot.workItemId || null,
        artifactType: snapshot.artifactType, title: snapshot.title, contentBytes: b64(bytes), contentMimeType: input.mime,
        artifactVersion: input.artifactVersion, expectedPreviousVersion: input.expectedPreviousVersion, visibility: snapshot.visibility, metadata: {}
      }
      // Do not acquire a current identity token or dispatch a mutation after a scope/cancel fence.
      if (!capturedCurrent(captured, capturedTask, capturedActor, capturedEpoch, controller)) return null
      const result = unwrap(await request({ url: `/tasks/${encodeURIComponent(capturedTask)}/artifacts`, method: 'POST', data: body, params: { actorAgentId: capturedActor } }, controller))
      if (!capturedCurrent(captured, capturedTask, capturedActor, capturedEpoch, controller)) return null
      if (!responseMatchesPublish(result, body, chosen.size)) throw new Error('服务回执与本次成果不匹配，未确认保存。')
      receipt.value = result; state.value = 'published'; message.value = '服务已确认保存该精确成果版本。'
      return result
    } catch (error) {
      if (!capturedCurrent(captured, capturedTask, capturedActor, capturedEpoch, controller) || error?.name === 'AbortError') return null
      if ([401, 403, 404].includes(error?.status)) clearAccessState()
      conflict.value = error?.status === 409
      state.value = error?.status === 409 ? 'conflict' : error?.status === 503 ? 'unavailable' : error?.requestErrorClass === 'network' || error instanceof TypeError ? 'unknown' : 'error'
      message.value = failureMessage(error)
      return null
    } finally { controllers.delete(controller); if (activeOperation === controller) activeOperation = null }
  }
  const downloadExact = async () => {
    if (activeOperation) return null
    const artifactId = download.value.artifactId
    const artifactVersion = positiveInteger(download.value.artifactVersion)
    if (!operable.value || !ID(artifactId) || !artifactVersion) { state.value = 'error'; message.value = '请明确当前任务、好汉、成果标识与精确版本。'; return null }
    const captured = ++generation
    const capturedTask = taskId.value; const capturedActor = actorAgentId.value; const capturedEpoch = currentEpoch.value
    const controller = new AbortController(); controllers.add(controller); activeOperation = controller
    const chunks = []; let received = 0; let response = null
    state.value = 'downloading'; message.value = ''; conflict.value = false
    try {
      await request({ url: `/tasks/${encodeURIComponent(capturedTask)}/artifacts/${encodeURIComponent(artifactId)}/versions/${artifactVersion}/content`, method: 'GET', params: { actorAgentId: capturedActor }, responseType: 'stream', onStreamOpen: (handle, openedResponse) => {
        response = openedResponse
        const read = handle.reader.read.bind(handle.reader)
        handle.reader.read = async () => {
          const part = await read()
          if (!part.done) {
            const bytes = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value)
            if (received + bytes.byteLength > MAX_DOWNLOAD_BYTES) { const failure = new Error('下载内容超过 64 MiB 边界。'); failure.code = 'ARTIFACT_DOWNLOAD_TOO_LARGE'; throw failure }
            received += bytes.byteLength; chunks.push(bytes.slice())
          }
          return part
        }
      } }, controller)
      if (!capturedCurrent(captured, capturedTask, capturedActor, capturedEpoch, controller)) return null
      const declared = Number(response?.headers?.get?.('content-length'))
      if (!response || !Number.isInteger(declared) || declared < 0 || declared > MAX_DOWNLOAD_BYTES || declared !== received) throw new Error('下载响应长度无效，未创建文件。')
      const mime = safeMime((response.headers.get('content-type') || '').split(';', 1)[0]) || 'application/octet-stream'
      const blob = new Blob(chunks, { type: mime })
      const url = urlApi?.createObjectURL?.(blob)
      if (!url) throw new Error('当前浏览器不能安全创建下载文件。')
      activeUrls.add(url)
      const anchor = documentRef?.createElement?.('a')
      if (!anchor) throw new Error('当前环境不能安全发起下载。')
      anchor.href = url; anchor.download = `artifact-v${artifactVersion}.bin`; anchor.rel = 'noopener'; anchor.click()
      activeUrls.delete(url); urlApi.revokeObjectURL?.(url)
      state.value = 'downloaded'; message.value = '已按指定成果版本创建本地下载。'
      return { blob, url }
    } catch (error) {
      if (!capturedCurrent(captured, capturedTask, capturedActor, capturedEpoch, controller) || error?.name === 'AbortError') return null
      if ([401, 403, 404].includes(error?.status)) clearAccessState()
      conflict.value = error?.status === 409
      state.value = error?.status === 409 ? 'conflict' : error?.status === 503 ? 'unavailable' : error?.requestErrorClass === 'network' || error instanceof TypeError ? 'unknown' : 'error'
      message.value = failureMessage(error)
      return null
    } finally { controllers.delete(controller); if (activeOperation === controller) activeOperation = null }
  }
  const cancel = () => {
    if (!activeOperation) return false
    generation += 1
    activeOperation.abort(); controllers.delete(activeOperation); activeOperation = null
    state.value = 'cancelled'; message.value = '传输已取消。'
    return true
  }
  const dispose = () => { reset(); revokeObjectUrls() }
  if (getCurrentInstance()) onUnmounted(dispose)

  return { MAX_UPLOAD_BYTES, MAX_DOWNLOAD_BYTES, ALLOWED_MIME_TYPES, file, draft, download, state, message, receipt, conflict, operable, artifacts, setFile, prepareNextVersion, selectDownload, publish, downloadExact, cancel, reset, revokeObjectUrls, dispose }
}
