import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { createApi } from '../useHttp'

const DECIMAL = /^(?:0|[1-9][0-9]{0,18})$/
const MAX_DECIMAL = '9223372036854775807'
const NOTE_BYTE_LIMIT = 20_000
const ANCHOR_BYTE_LIMIT = 8192
const QUESTION_STATUSES = new Set(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_FINAL'])
const QUESTION_TERMINAL = new Set(['SUCCEEDED', 'FAILED_FINAL'])
const QUESTION_STREAMING = new Set(['QUEUED', 'RUNNING'])
const SHA256_HEX = /^[0-9a-f]{64}$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/
const QUESTION_BYTE_LIMIT = 8192
const ANSWER_BYTE_LIMIT = 131072
const QUESTION_SEGMENT_LIMIT = 16
const RESPONDER = Object.freeze({ id: 'archive-clerk-v1', displayName: '案卷书吏', mode: 'fallback' })

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const unwrap = (response) => {
  const envelope = response?.data
  if (!envelope || typeof envelope !== 'object') return envelope ?? null
  const isJsonResult = hasOwn(envelope, 'data') || (
    hasOwn(envelope, 'status') && hasOwn(envelope, 'code') && hasOwn(envelope, 'msg')
  )
  return isJsonResult ? (hasOwn(envelope, 'data') ? envelope.data : null) : envelope
}
const isCanonicalDecimal = value => typeof value === 'string' && DECIMAL.test(value) &&
  (value.length < MAX_DECIMAL.length || (value.length === MAX_DECIMAL.length && value <= MAX_DECIMAL))
const lowerUuid = () => (globalThis.crypto?.randomUUID?.() ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16)
  })).toLowerCase()
const mutationHeaders = (headers = {}, idempotencyKey = lowerUuid()) => hasOwn(headers, 'Idempotency-Key')
  ? { ...headers }
  : { ...headers, 'Idempotency-Key': idempotencyKey }
const utf8ByteLength = value => new TextEncoder().encode(String(value ?? '')).byteLength
const utf8Bytes = value => new TextEncoder().encode(String(value ?? ''))
const isLowerUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
const sameResponder = value => value && value.id === RESPONDER.id && value.displayName === RESPONDER.displayName && value.mode === RESPONDER.mode
const nextDecimal = value => {
  if (!isCanonicalDecimal(value) || value === MAX_DECIMAL) return null
  const digits = value.split('')
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== '9') {
      digits[index] = String(Number(digits[index]) + 1)
      return digits.join('')
    }
    digits[index] = '0'
  }
  return `1${digits.join('')}`
}
const isAmbiguousMutationError = error => error?.status == null && error?.name !== 'AbortError'

const sha256Bytes = async (bytes) => {
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器无法校验手札锚点')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

const boundedUtf8Prefix = (value, byteLimit) => {
  const bytes = new TextEncoder().encode(String(value ?? ''))
  if (bytes.byteLength <= byteLimit) return bytes
  let endByte = byteLimit
  while (endByte > 0 && (bytes[endByte] & 0xc0) === 0x80) endByte -= 1
  return bytes.slice(0, endByte)
}

const replayAmbiguousMutation = async (send) => {
  try {
    return await send()
  } catch (error) {
    if (!isAmbiguousMutationError(error)) throw error
    return send()
  }
}

export { isCanonicalDecimal, mutationHeaders, utf8ByteLength }

export const useArchiveReader = ({ api = createApi('/archive/v1'), autoInitialize = true, saveDelay = 800 } = {}) => {
  const catalog = ref(null)
  const chapter = ref(null)
  const progress = ref(null)
  const bookmarks = ref([])
  const notes = ref([])
  const loading = ref(false)
  const chapterLoading = ref(false)
  const bookmarkPending = ref(false)
  const notePending = ref(false)
  const errorMessage = ref('')
  const saveState = ref('idle')
  const noteAnchorNotice = ref('')
  const noteConflictDraft = ref(null)
  const noteRetryNotice = ref('')
  const currentLocation = ref(null)
  const focusRequest = ref(null)
  const question = ref(null)
  const questionPending = ref(false)
  const questionError = ref('')

  let saveTimer
  let queuedProgressIntent = null
  let progressDrainPromise = null
  let loadGeneration = 0
  let initializeGeneration = 0
  let blockController = null
  let initializeController = null
  let disposed = false
  let bookmarkCreateOperation = null
  let bookmarkCreatePromise = null
  let newNoteOperation = null
  let newNotePromise = null
  const deleteBookmarkOperations = new Map()
  const noteOperations = new Map()
  const deleteNoteOperations = new Map()
  let questionGeneration = 0
  let questionController = null
  let questionMutationController = null
  let questionRecoveryController = null
  let questionStreamReader = null
  let questionReconnectTimer = null
  let questionPollTimer = null
  let questionCreateOperation = null
  let questionCreatePromise = null
  let questionRetryOperation = null
  let questionRetryPromise = null

  const edition = computed(() => catalog.value?.activeEdition || null)
  const blocks = computed(() => edition.value
    ? [edition.value.preface, ...(edition.value.chapters || [])].filter(Boolean)
    : [])
  const currentIndex = computed(() => blocks.value.findIndex(block => block.blockId === chapter.value?.blockId))
  const currentBlock = computed(() => blocks.value[currentIndex.value] || null)
  const canGoPrevious = computed(() => currentIndex.value > 0)
  const canGoNext = computed(() => currentIndex.value >= 0 && currentIndex.value < blocks.value.length - 1)
  const continueLocation = computed(() => progress.value?.location || null)

  const requireVersion = (value, label) => {
    if (!isCanonicalDecimal(value)) throw new Error(`${label} version is not a canonical decimal string`)
    return value
  }

  const clearActionError = (prefix) => {
    if (errorMessage.value.startsWith(prefix)) errorMessage.value = ''
  }

  const loadCatalog = async (signal) => {
    if (disposed || signal?.aborted) return null
    const result = await api.get('/catalog', undefined, { autoLoading: false, signal })
    if (disposed || signal?.aborted) return null
    const nextCatalog = unwrap(result)
    if (!nextCatalog?.activeEdition?.editionId) throw new Error('案卷阁目录响应不完整')
    catalog.value = nextCatalog
    return nextCatalog
  }

  const loadProgress = async (editionId = edition.value?.editionId, signal) => {
    if (!editionId || disposed || signal?.aborted) return null
    const result = await api.get(
      `/me/progress/${encodeURIComponent(editionId)}`,
      undefined,
      { autoLoading: false, signal }
    )
    if (disposed || signal?.aborted) return null
    const nextProgress = unwrap(result)
    if (nextProgress !== null) requireVersion(nextProgress?.version, '阅读进度')
    progress.value = nextProgress
    return nextProgress
  }

  const loadPage = async (path, params, label, signal) => {
    const items = []
    let cursor = null
    do {
      const requestParams = cursor === null ? params : { ...params, cursor }
      const result = await api.get(path, requestParams, { autoLoading: false, signal })
      if (disposed || signal?.aborted) return []
      const page = unwrap(result)
      if (!page || !Array.isArray(page.items) || !hasOwn(page, 'nextCursor')) {
        throw new Error(`${label} 列表响应不完整`)
      }
      items.push(...page.items)
      cursor = page.nextCursor
      if (cursor !== null) requireVersion(cursor, `${label} cursor`)
    } while (cursor !== null)
    return items.filter(item => item?.state !== 'DELETED')
  }

  const fetchBookmarks = signal => loadPage(
    '/me/bookmarks',
    { editionId: edition.value.editionId, limit: '100' },
    'bookmark',
    signal
  )

  const fetchNotes = (blockId, signal) => loadPage(
    '/me/notes',
    { editionId: edition.value.editionId, chapterId: blockId, limit: '100' },
    'note',
    signal
  )

  const validateRows = (rows, label) => {
    rows.forEach(item => requireVersion(item?.version, label))
    return rows
  }

  const loadBookmarks = async (signal) => {
    if (!edition.value?.editionId || disposed || signal?.aborted) return []
    const rows = validateRows(await fetchBookmarks(signal), 'bookmark')
    if (!disposed && !signal?.aborted) bookmarks.value = rows
    return rows
  }

  const locationFor = (block = chapter.value, paragraph = block?.paragraphs?.[0], byteOffset = 0) => {
    if (!block || !paragraph || !edition.value?.manifestSha256) return null
    if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset > paragraph.utf8ByteLength) {
      throw new Error('阅读位置字节偏移无效')
    }
    return {
      editionManifestSha256: edition.value.manifestSha256,
      blockType: block.blockType,
      blockId: block.blockId,
      paragraphId: paragraph.paragraphId,
      byteOffset,
      paragraphSha256: paragraph.sha256
    }
  }

  const resolvedLocation = (nextChapter, targetLocation) => {
    const targetParagraph = targetLocation?.blockId === nextChapter.blockId
      ? nextChapter.paragraphs.find(item => item.paragraphId === targetLocation.paragraphId)
      : null
    const paragraph = targetParagraph || nextChapter.paragraphs[0]
    const byteOffset = targetParagraph ? targetLocation.byteOffset : 0
    return locationFor(nextChapter, paragraph, byteOffset)
  }

  const anchorForLocation = async (location = currentLocation.value) => {
    noteAnchorNotice.value = ''
    if (!location) return null
    const paragraph = chapter.value?.paragraphs?.find(item => item.paragraphId === location.paragraphId)
    if (!paragraph || paragraph.sha256 !== location.paragraphSha256) {
      throw new Error('当前段落无法构造权威手札锚点')
    }
    const selectionBytes = boundedUtf8Prefix(paragraph.text, ANCHOR_BYTE_LIMIT)
    if (paragraph.utf8ByteLength > ANCHOR_BYTE_LIMIT) {
      noteAnchorNotice.value = '当前段落超过 8192 bytes，手札将使用合法的长段前缀选文锚点。'
    }
    return {
      editionManifestSha256: location.editionManifestSha256,
      blockType: location.blockType,
      blockId: location.blockId,
      segments: [{
        paragraphId: paragraph.paragraphId,
        startByte: 0,
        endByte: selectionBytes.byteLength,
        paragraphSha256: paragraph.sha256
      }],
      selectionSha256: await sha256Bytes(selectionBytes)
    }
  }

  const loadBlock = async (block, targetLocation = null, parentSignal) => {
    if (!block || !edition.value?.editionId || disposed || parentSignal?.aborted) return null
    const generation = ++loadGeneration
    if (chapter.value?.blockId !== block.blockId) closeQuestion()
    blockController?.abort()
    const controller = new AbortController()
    const abortFromParent = () => controller.abort()
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    if (parentSignal?.aborted) controller.abort()
    blockController = controller
    chapterLoading.value = true
    errorMessage.value = ''
    try {
      const path = block.blockType === 'PREFACE'
        ? `/editions/${encodeURIComponent(edition.value.editionId)}/preface`
        : `/editions/${encodeURIComponent(edition.value.editionId)}/chapters/${encodeURIComponent(block.blockId)}`
      const [blockResult, nextNotes] = await Promise.all([
        api.get(path, undefined, { autoLoading: false, signal: controller.signal }),
        fetchNotes(block.blockId, controller.signal)
      ])
      const nextChapter = unwrap(blockResult)
      if (!nextChapter?.blockId || !Array.isArray(nextChapter.paragraphs)) {
        throw new Error('章回正文响应不完整')
      }
      const nextLocation = resolvedLocation(nextChapter, targetLocation)
      validateRows(nextNotes, 'note')
      if (disposed || generation !== loadGeneration) return null
      chapter.value = nextChapter
      currentLocation.value = nextLocation
      notes.value = nextNotes
      chapterLoading.value = false
      focusRequest.value = { generation, location: nextLocation }
      return nextChapter
    } catch (error) {
      if (disposed || generation !== loadGeneration || error?.name === 'AbortError') return null
      errorMessage.value = '章回暂无法读取，请稍后重试。'
      throw error
    } finally {
      parentSignal?.removeEventListener('abort', abortFromParent)
      if (!disposed && generation === loadGeneration) chapterLoading.value = false
    }
  }

  const progressIntentFor = (location) => {
    const lastCatalogBlock = blocks.value.at(-1)
    const loadedBlock = chapter.value?.blockId === location.blockId ? chapter.value : null
    const lastParagraph = loadedBlock?.paragraphs?.at(-1)
    const markCompleted = location.blockType === 'CHAPTER' &&
      location.editionManifestSha256 === edition.value?.manifestSha256 &&
      location.blockId === lastCatalogBlock?.blockId &&
      location.paragraphId === lastParagraph?.paragraphId &&
      location.paragraphSha256 === lastParagraph?.sha256 &&
      location.byteOffset === lastParagraph?.utf8ByteLength
    return Object.freeze({
      location: Object.freeze({ ...location }),
      markCompleted
    })
  }

  const sendProgress = async (intent) => {
    saveState.value = 'saving'
    try {
      const expectedVersion = progress.value === null
        ? '0'
        : requireVersion(progress.value?.version, '阅读进度')
      const body = {
        expectedVersion,
        location: intent.location,
        markCompleted: intent.markCompleted
      }
      const idempotencyKey = lowerUuid()
      const send = () => api.put(
        `/me/progress/${encodeURIComponent(edition.value.editionId)}`,
        body,
        { autoLoading: false, headers: mutationHeaders({}, idempotencyKey) }
      )
      const result = await replayAmbiguousMutation(send)
      const saved = unwrap(result)
      requireVersion(saved?.version, '阅读进度')
      progress.value = saved
      clearActionError('阅读进度')
      return saved
    } catch (error) {
      saveState.value = 'error'
      queuedProgressIntent = null
      if (error?.status === 409) {
        try {
          await loadProgress()
          errorMessage.value = '阅读进度已在另一处更新，已刷新服务端位置。'
        } catch {
          errorMessage.value = '阅读进度发生冲突，且服务端位置刷新失败。'
        }
      } else {
        errorMessage.value = '阅读进度暂未保存。'
      }
      throw error
    }
  }

  const drainProgress = async () => {
    let saved = null
    while (queuedProgressIntent && !disposed) {
      const intent = queuedProgressIntent
      queuedProgressIntent = null
      saved = await sendProgress(intent)
    }
    if (!disposed) saveState.value = 'saved'
    return saved
  }

  const startProgressDrain = () => {
    if (progressDrainPromise) {
      saveState.value = 'pending'
      return progressDrainPromise
    }
    progressDrainPromise = drainProgress().finally(() => {
      progressDrainPromise = null
    })
    return progressDrainPromise
  }

  const saveProgress = (location = currentLocation.value) => {
    clearTimeout(saveTimer)
    if (!edition.value?.editionId || !location || disposed) return Promise.resolve(null)
    queuedProgressIntent = progressIntentFor(location)
    return startProgressDrain()
  }

  const scheduleProgressSave = (location = currentLocation.value) => {
    clearTimeout(saveTimer)
    if (!location || disposed) return
    queuedProgressIntent = progressIntentFor(location)
    saveState.value = 'pending'
    saveTimer = setTimeout(() => {
      startProgressDrain().catch(() => {})
    }, saveDelay)
  }

  const setCurrentParagraph = (paragraph, byteOffset = 0) => {
    const location = locationFor(chapter.value, paragraph, byteOffset)
    if (!location) return
    currentLocation.value = location
    scheduleProgressSave(location)
  }

  const continueReading = async (signal) => {
    const target = continueLocation.value
    const block = blocks.value.find(item => item.blockId === target?.blockId) || blocks.value[0]
    return loadBlock(block, target, signal)
  }

  const goPrevious = () => canGoPrevious.value
    ? loadBlock(blocks.value[currentIndex.value - 1])
    : Promise.resolve(null)
  const goNext = () => canGoNext.value
    ? loadBlock(blocks.value[currentIndex.value + 1])
    : Promise.resolve(null)

  const runBookmarkCreate = async () => {
    if (bookmarkCreatePromise) return bookmarkCreatePromise
    if (!bookmarkCreateOperation) {
      const bookmarkId = lowerUuid()
      bookmarkCreateOperation = {
        bookmarkId,
        body: {
          expectedVersion: '0',
          editionId: edition.value.editionId,
          location: currentLocation.value
        },
        idempotencyKey: lowerUuid()
      }
    }
    const operation = bookmarkCreateOperation
    bookmarkPending.value = true
    bookmarkCreatePromise = replayAmbiguousMutation(() => api.put(
      `/me/bookmarks/${operation.bookmarkId}`,
      operation.body,
      { autoLoading: false, headers: mutationHeaders({}, operation.idempotencyKey) }
    )).then((result) => {
      const bookmark = unwrap(result)
      requireVersion(bookmark?.version, 'bookmark')
      bookmarks.value = [bookmark, ...bookmarks.value.filter(item => item.bookmarkId !== bookmark.bookmarkId)]
      bookmarkCreateOperation = null
      clearActionError('书签')
      return bookmark
    }).catch((error) => {
      if (!isAmbiguousMutationError(error)) bookmarkCreateOperation = null
      errorMessage.value = '书签暂未保存，请重试。'
      throw error
    }).finally(() => {
      bookmarkPending.value = false
      bookmarkCreatePromise = null
    })
    return bookmarkCreatePromise
  }

  const createBookmark = () => runBookmarkCreate()

  const deleteBookmark = async (bookmark) => {
    const key = bookmark.bookmarkId
    let operation = deleteBookmarkOperations.get(key)
    if (!operation) {
      requireVersion(bookmark.version, 'bookmark')
      operation = { idempotencyKey: lowerUuid(), version: bookmark.version }
      deleteBookmarkOperations.set(key, operation)
    }
    try {
      const result = await replayAmbiguousMutation(() => api.delete(
        `/me/bookmarks/${bookmark.bookmarkId}`,
        {
          autoLoading: false,
          headers: mutationHeaders({ 'If-Match': `"v${operation.version}"` }, operation.idempotencyKey)
        }
      ))
      const deleted = unwrap(result)
      requireVersion(deleted?.version, 'bookmark')
      bookmarks.value = bookmarks.value.filter(item => item.bookmarkId !== bookmark.bookmarkId)
      deleteBookmarkOperations.delete(key)
      clearActionError('书签')
      return deleted
    } catch (error) {
      if (!isAmbiguousMutationError(error)) deleteBookmarkOperations.delete(key)
      errorMessage.value = '书签暂未删除，请重试。'
      throw error
    }
  }

  const buildNoteOperation = async ({ noteId, text, anchor, version }) => {
    requireVersion(version, 'note')
    if (utf8ByteLength(text) > NOTE_BYTE_LIMIT) throw new Error('手札不能超过 20,000 UTF-8 bytes')
    const sourceLocation = anchor === undefined && currentLocation.value
      ? { ...currentLocation.value }
      : null
    const authoritativeAnchor = anchor === undefined ? await anchorForLocation() : anchor
    const resourceId = noteId || lowerUuid()
    return {
      noteId: resourceId,
      body: {
        expectedVersion: version,
        editionId: edition.value.editionId,
        text,
        anchor: authoritativeAnchor
      },
      draft: { noteId: resourceId, text, anchor: authoritativeAnchor, version },
      idempotencyKey: lowerUuid(),
      sourceLocation
    }
  }

  const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right)
  const noteOperationMatchesInput = (operation, input) => {
    const sameResource = input.noteId == null || input.noteId === operation.noteId
    const sameAnchor = input.anchor === undefined
      ? sameValue(operation.sourceLocation, currentLocation.value)
      : sameValue(input.anchor, operation.body.anchor)
    return sameResource &&
      input.version === operation.body.expectedVersion &&
      input.text === operation.body.text &&
      sameAnchor
  }

  const noteSaveOutcome = (note, input, draftChanged) => ({
    note,
    preservedDraft: draftChanged
      ? {
        anchor: input.anchor,
        noteId: note.noteId,
        text: input.text,
        version: note.version
      }
      : null
  })

  const sendNoteOperation = async (operation) => {
    const result = await replayAmbiguousMutation(() => api.put(
      `/me/notes/${operation.noteId}`,
      operation.body,
      { autoLoading: false, headers: mutationHeaders({}, operation.idempotencyKey) }
    ))
    const note = unwrap(result)
    requireVersion(note?.version, 'note')
    const index = notes.value.findIndex(item => item.noteId === note.noteId)
    notes.value = index < 0
      ? [note, ...notes.value]
      : notes.value.map(item => item.noteId === note.noteId ? note : item)
    noteConflictDraft.value = null
    clearActionError('手札')
    return note
  }

  const saveNewNote = (input) => {
    if (newNotePromise) return newNotePromise
    let draftChanged = false
    notePending.value = true
    newNotePromise = (async () => {
      if (!newNoteOperation) newNoteOperation = await buildNoteOperation(input)
      draftChanged = !noteOperationMatchesInput(newNoteOperation, input)
      if (draftChanged) noteRetryNotice.value = '正在确认上次保存；新稿不会直接作为旧请求重放。'
      const note = await sendNoteOperation(newNoteOperation)
      return noteSaveOutcome(note, input, draftChanged)
    })().then((outcome) => {
      newNoteOperation = null
      noteRetryNotice.value = outcome.preservedDraft
        ? '上次保存已确认；新稿仍保留，请再次保存新稿。'
        : ''
      return outcome
    }).catch((error) => {
      if (error?.status === 409 && newNoteOperation) {
        noteConflictDraft.value = newNoteOperation.draft
        errorMessage.value = '手札已在另一处修改；本地草稿已保留，请人工处理后再保存。'
      } else {
        errorMessage.value = '手札暂未保存，请重试。'
      }
      if (isAmbiguousMutationError(error)) {
        noteRetryNotice.value = draftChanged
          ? '上次保存仍未确认；新稿已保留，不能直接以新稿重放。'
          : '上次保存结果不明确；请重试以确认原请求。'
      } else {
        newNoteOperation = null
        noteRetryNotice.value = ''
      }
      throw error
    }).finally(() => {
      notePending.value = false
      newNotePromise = null
    })
    return newNotePromise
  }

  const saveExistingNote = async (input) => {
    const key = input.noteId
    let operation = noteOperations.get(key)
    if (!operation) {
      operation = await buildNoteOperation(input)
      noteOperations.set(key, operation)
    }
    const draftChanged = !noteOperationMatchesInput(operation, input)
    if (draftChanged) noteRetryNotice.value = '正在确认上次保存；新稿不会直接作为旧请求重放。'
    notePending.value = true
    try {
      const note = await sendNoteOperation(operation)
      noteOperations.delete(key)
      const outcome = noteSaveOutcome(note, input, draftChanged)
      noteRetryNotice.value = outcome.preservedDraft
        ? '上次保存已确认；新稿仍保留，请再次保存新稿。'
        : ''
      return outcome
    } catch (error) {
      if (error?.status === 409) {
        noteConflictDraft.value = operation.draft
        errorMessage.value = '手札已在另一处修改；本地草稿已保留，请人工处理后再保存。'
      } else {
        errorMessage.value = '手札暂未保存，请重试。'
      }
      if (isAmbiguousMutationError(error)) {
        noteRetryNotice.value = draftChanged
          ? '上次保存仍未确认；新稿已保留，不能直接以新稿重放。'
          : '上次保存结果不明确；请重试以确认原请求。'
      } else {
        noteOperations.delete(key)
        noteRetryNotice.value = ''
      }
      throw error
    } finally {
      notePending.value = false
    }
  }

  const saveNote = input => input.noteId ? saveExistingNote(input) : saveNewNote(input)

  const deleteNote = async (note) => {
    const key = note.noteId
    let operation = deleteNoteOperations.get(key)
    if (!operation) {
      requireVersion(note.version, 'note')
      operation = { idempotencyKey: lowerUuid(), version: note.version }
      deleteNoteOperations.set(key, operation)
    }
    notePending.value = true
    try {
      const result = await replayAmbiguousMutation(() => api.delete(
        `/me/notes/${note.noteId}`,
        {
          autoLoading: false,
          headers: mutationHeaders({ 'If-Match': `"v${operation.version}"` }, operation.idempotencyKey)
        }
      ))
      const deleted = unwrap(result)
      requireVersion(deleted?.version, 'note')
      notes.value = notes.value.filter(item => item.noteId !== note.noteId)
      deleteNoteOperations.delete(key)
      noteRetryNotice.value = ''
      clearActionError('手札')
      return deleted
    } catch (error) {
      if (!isAmbiguousMutationError(error)) deleteNoteOperations.delete(key)
      errorMessage.value = '手札暂未删除，请重试。'
      throw error
    } finally {
      notePending.value = false
    }
  }

  const exactKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === expected.slice().sort().join(',')
  const isIsoInstant = value => typeof value === 'string' && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value))
  const compareDecimal = (left, right) => left.length === right.length
    ? (left === right ? 0 : left < right ? -1 : 1)
    : left.length < right.length ? -1 : 1
  const streamingStatus = status => QUESTION_STREAMING.has(status)

  const requireResponder = (value) => {
    if (!exactKeys(value, ['id', 'displayName', 'mode']) || !sameResponder(value)) {
      throw new Error('案卷书吏 responder 响应无效')
    }
    return RESPONDER
  }

  const authoritativeSelection = (anchor) => {
    const current = chapter.value
    if (!current) return null
    if (current.blockId !== anchor.blockId || current.blockType !== anchor.blockType ||
      edition.value?.manifestSha256 !== anchor.editionManifestSha256) {
      throw new Error('案卷问答锚点不属于当前权威正文')
    }
    const slices = []
    let total = 0
    let previousIndex = -1
    for (let index = 0; index < anchor.segments.length; index += 1) {
      const segment = anchor.segments[index]
      const paragraphIndex = current.paragraphs.findIndex(item => item.paragraphId === segment.paragraphId)
      const paragraph = current.paragraphs[paragraphIndex]
      if (!paragraph || (previousIndex >= 0 && paragraphIndex !== previousIndex + 1) || paragraph.sha256 !== segment.paragraphSha256) {
        throw new Error('案卷问答锚点段落无效')
      }
      const bytes = utf8Bytes(paragraph.text)
      const boundary = offset => offset >= 0 && offset <= bytes.byteLength &&
        (offset === bytes.byteLength || (bytes[offset] & 0xc0) !== 0x80)
      if (!boundary(segment.startByte) || !boundary(segment.endByte) || segment.startByte >= segment.endByte ||
        (index > 0 && index < anchor.segments.length - 1 && (segment.startByte !== 0 || segment.endByte !== bytes.byteLength))) {
        throw new Error('案卷问答锚点字节范围无效')
      }
      const slice = bytes.slice(segment.startByte, segment.endByte)
      total += slice.byteLength + (index ? 2 : 0)
      if (total > QUESTION_BYTE_LIMIT) throw new Error('案卷问答选文超过限制')
      slices.push(slice)
      previousIndex = paragraphIndex
    }
    const joined = new Uint8Array(total)
    let offset = 0
    slices.forEach((slice, index) => {
      if (index) { joined[offset++] = 10; joined[offset++] = 10 }
      joined.set(slice, offset)
      offset += slice.byteLength
    })
    return joined
  }

  const requireQuestionAnchor = async (value, selectedText) => {
    if (!exactKeys(value, ['editionManifestSha256', 'blockType', 'blockId', 'segments', 'selectionSha256']) ||
      !SHA256_HEX.test(value.editionManifestSha256) || !['PREFACE', 'CHAPTER'].includes(value.blockType) ||
      typeof value.blockId !== 'string' || !value.blockId || utf8ByteLength(value.blockId) > 128 ||
      !Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > QUESTION_SEGMENT_LIMIT ||
      !SHA256_HEX.test(value.selectionSha256)) {
      throw new Error('案卷问答锚点响应无效')
    }
    const ids = new Set()
    value.segments.forEach((segment) => {
      if (!exactKeys(segment, ['paragraphId', 'startByte', 'endByte', 'paragraphSha256']) ||
        typeof segment.paragraphId !== 'string' || !segment.paragraphId || ids.has(segment.paragraphId) ||
        !Number.isSafeInteger(segment.startByte) || !Number.isSafeInteger(segment.endByte) ||
        segment.startByte < 0 || segment.endByte <= segment.startByte || !SHA256_HEX.test(segment.paragraphSha256)) {
        throw new Error('案卷问答锚点 segment 响应无效')
      }
      ids.add(segment.paragraphId)
    })
    const selectedBytes = utf8Bytes(selectedText)
    if (!selectedBytes.byteLength || selectedBytes.byteLength > QUESTION_BYTE_LIMIT ||
      await sha256Bytes(selectedBytes) !== value.selectionSha256) {
      throw new Error('案卷问答选文摘要无效')
    }
    const authoritative = authoritativeSelection(value)
    if (authoritative && (new TextDecoder().decode(authoritative) !== selectedText || authoritative.byteLength !== selectedBytes.byteLength)) {
      throw new Error('案卷问答权威选文不匹配')
    }
    return value
  }

  const requireQuestionSnapshot = async (value, expectedId) => {
    if (!exactKeys(value, ['questionId', 'version', 'currentSequence', 'status', 'responder', 'question', 'anchor',
      'selectedText', 'answer', 'retryCount', 'lastErrorCode', 'createdAt', 'updatedAt', 'completedAt']) ||
      !isLowerUuid(value.questionId) || (expectedId && value.questionId !== expectedId) ||
      !isCanonicalDecimal(value.version) || !isCanonicalDecimal(value.currentSequence) ||
      value.version === '0' || value.currentSequence === '0' || !QUESTION_STATUSES.has(value.status) ||
      typeof value.question !== 'string' || !value.question.trim() || utf8ByteLength(value.question) > QUESTION_BYTE_LIMIT ||
      typeof value.selectedText !== 'string' || !value.selectedText || utf8ByteLength(value.selectedText) > QUESTION_BYTE_LIMIT ||
      typeof value.answer !== 'string' || utf8ByteLength(value.answer) > ANSWER_BYTE_LIMIT ||
      !Number.isInteger(value.retryCount) || value.retryCount < 0 || value.retryCount > 2 ||
      !isIsoInstant(value.createdAt) || !isIsoInstant(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      throw new Error('案卷问答快照响应无效')
    }
    requireResponder(value.responder)
    await requireQuestionAnchor(value.anchor, value.selectedText)
    const failed = value.status === 'FAILED_RETRYABLE' || value.status === 'FAILED_FINAL'
    const terminal = QUESTION_TERMINAL.has(value.status)
    if ((failed && (typeof value.lastErrorCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.lastErrorCode))) ||
      (!failed && value.lastErrorCode !== null) ||
      (terminal && !isIsoInstant(value.completedAt)) || (!terminal && value.completedAt !== null) ||
      (value.completedAt && (Date.parse(value.completedAt) < Date.parse(value.createdAt) || Date.parse(value.completedAt) < Date.parse(value.updatedAt))) ||
      (value.status === 'SUCCEEDED' ? !value.answer : value.answer !== '')) {
      throw new Error('案卷问答状态快照无效')
    }
    return { ...value, responder: RESPONDER }
  }

  const isQuestionGeneration = generation => !disposed && generation === questionGeneration
  const isQuestionCurrent = (questionId, generation) => isQuestionGeneration(generation) &&
    question.value?.questionId === questionId

  const clearQuestionTransport = () => {
    questionController?.abort()
    questionController = null
    questionStreamReader?.cancel?.()
    questionStreamReader = null
    questionRecoveryController?.abort()
    questionRecoveryController = null
    clearTimeout(questionReconnectTimer)
    clearTimeout(questionPollTimer)
    questionReconnectTimer = null
    questionPollTimer = null
  }

  const clearQuestionResources = () => {
    clearQuestionTransport()
    questionMutationController?.abort()
    questionMutationController = null
  }

  const closeQuestion = () => {
    questionGeneration += 1
    clearQuestionResources()
    questionCreateOperation = null
    questionCreatePromise = null
    questionRetryOperation = null
    questionRetryPromise = null
    question.value = null
    questionPending.value = false
    questionError.value = ''
  }

  const validateEventPayload = (type, payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('案卷问答事件 payload 无效')
    const keys = Object.keys(payload).sort().join(',')
    const requireKeys = expected => {
      if (keys !== expected.slice().sort().join(',')) throw new Error('案卷问答事件字段无效')
    }
    if (type === 'QUESTION_QUEUED' || type === 'QUESTION_RETRY_QUEUED') {
      requireKeys(['status', 'responder', 'retryCount'])
      if (payload.status !== 'QUEUED' || !exactKeys(payload.responder, ['id', 'displayName', 'mode']) ||
        !sameResponder(payload.responder) || !Number.isInteger(payload.retryCount) || payload.retryCount < 0 || payload.retryCount > 2) {
        throw new Error('案卷问答排队事件无效')
      }
    } else if (type === 'QUESTION_RUNNING') {
      requireKeys(['attempt', 'retryCount', 'status'])
      if (payload.status !== 'RUNNING' || !Number.isInteger(payload.attempt) || payload.attempt < 1 || payload.attempt > 3 ||
        !Number.isInteger(payload.retryCount) || payload.retryCount < 0 || payload.retryCount > 2) throw new Error('案卷问答运行事件无效')
    } else if (type === 'ANSWER_DELTA') {
      requireKeys(['delta'])
      if (typeof payload.delta !== 'string' || !payload.delta || utf8ByteLength(payload.delta) > 4096) throw new Error('案卷问答增量事件无效')
    } else if (type === 'QUESTION_SUCCEEDED') {
      requireKeys(['status'])
      if (payload.status !== 'SUCCEEDED') throw new Error('案卷问答完成事件无效')
    } else if (type === 'QUESTION_FAILED_RETRYABLE' || type === 'QUESTION_FAILED_FINAL') {
      requireKeys(['lastErrorCode', 'retryCount', 'status'])
      const status = type === 'QUESTION_FAILED_RETRYABLE' ? 'FAILED_RETRYABLE' : 'FAILED_FINAL'
      if (payload.status !== status || !Number.isInteger(payload.retryCount) || payload.retryCount < 0 || payload.retryCount > 2 ||
        typeof payload.lastErrorCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(payload.lastErrorCode)) {
        throw new Error('案卷问答失败事件无效')
      }
    } else {
      throw new Error('案卷问答事件类型无效')
    }
  }

  const requireQuestionEvent = (value, questionId) => {
    if (!exactKeys(value, ['schemaVersion', 'questionId', 'sequence', 'type', 'occurredAt', 'payload']) ||
      value.schemaVersion !== 1 || value.questionId !== questionId || !isCanonicalDecimal(value.sequence) ||
      typeof value.type !== 'string' || !isIsoInstant(value.occurredAt)) {
      throw new Error('案卷问答事件响应无效')
    }
    validateEventPayload(value.type, value.payload)
    return value
  }

  const replaceQuestionSnapshot = async (questionId, generation) => {
    if (!isQuestionCurrent(questionId, generation)) return null
    questionRecoveryController?.abort()
    const controller = new AbortController()
    questionRecoveryController = controller
    const result = await api.get(`/me/questions/${encodeURIComponent(questionId)}`, undefined, {
      autoLoading: false,
      signal: controller.signal
    })
    if (!isQuestionCurrent(questionId, generation) || controller.signal.aborted) return null
    const snapshot = await requireQuestionSnapshot(unwrap(result), questionId)
    if (!isQuestionCurrent(questionId, generation) || controller.signal.aborted) return null
    question.value = snapshot
    questionRecoveryController = null
    return snapshot
  }

  const recoverQuestion = (questionId, generation, delay = 0) => {
    if (!isQuestionCurrent(questionId, generation)) return
    clearQuestionTransport()
    questionPending.value = true
    questionPollTimer = setTimeout(async () => {
      if (!isQuestionCurrent(questionId, generation)) return
      try {
        const snapshot = await replaceQuestionSnapshot(questionId, generation)
        if (!snapshot || !isQuestionCurrent(questionId, generation)) return
        questionError.value = ''
        questionPending.value = false
        if (streamingStatus(snapshot.status)) openQuestionStream(questionId, generation)
      } catch (error) {
        if (error?.name === 'AbortError' || !isQuestionCurrent(questionId, generation)) return
        questionError.value = '案卷书吏状态暂无法恢复。'
        questionPending.value = true
        questionReconnectTimer = setTimeout(() => recoverQuestion(questionId, generation, 0), 1000)
      }
    }, delay)
  }

  const applyQuestionEvent = (event, questionId, generation) => {
    if (!isQuestionCurrent(questionId, generation)) return
    const current = question.value
    const expected = nextDecimal(current.currentSequence)
    if (!expected || event.sequence !== expected) {
      recoverQuestion(questionId, generation)
      return
    }
    const payload = event.payload
    const next = { ...current, currentSequence: event.sequence, updatedAt: event.occurredAt }
    if (event.type === 'QUESTION_QUEUED' || event.type === 'QUESTION_RETRY_QUEUED') {
      next.status = 'QUEUED'; next.responder = RESPONDER; next.retryCount = payload.retryCount; next.lastErrorCode = null; next.answer = ''; next.completedAt = null
    } else if (event.type === 'QUESTION_RUNNING') {
      next.status = 'RUNNING'; next.retryCount = payload.retryCount; next.lastErrorCode = null; next.answer = ''; next.completedAt = null
    } else if (event.type === 'ANSWER_DELTA') {
      next.answer = `${next.answer}${payload.delta}`
      if (utf8ByteLength(next.answer) > ANSWER_BYTE_LIMIT) { recoverQuestion(questionId, generation); return }
    } else if (event.type === 'QUESTION_SUCCEEDED') {
      next.status = 'SUCCEEDED'; next.lastErrorCode = null
    } else {
      next.status = payload.status; next.retryCount = payload.retryCount; next.lastErrorCode = payload.lastErrorCode; next.answer = ''
    }
    question.value = next
    if (event.type === 'QUESTION_SUCCEEDED' || event.type === 'QUESTION_FAILED_RETRYABLE' || event.type === 'QUESTION_FAILED_FINAL') {
      recoverQuestion(questionId, generation)
    }
  }

  const dispatchSseFrame = (frame, questionId, generation) => {
    if (!isQuestionCurrent(questionId, generation)) return
    if (!frame.data.length) {
      if (frame.invalid || frame.id !== null || frame.event !== 'message') recoverQuestion(questionId, generation)
      return
    }
    if (frame.event === 'resync_required') {
      let value
      try { value = JSON.parse(frame.data.join('\n')) } catch { recoverQuestion(questionId, generation); return }
      if (frame.invalid || (frame.id !== null && frame.id !== '') || !exactKeys(value, ['schemaVersion', 'questionId', 'type']) ||
        value.schemaVersion !== 1 || value.questionId !== questionId || value.type !== 'resync_required') {
        recoverQuestion(questionId, generation)
        return
      }
      recoverQuestion(questionId, generation)
      return
    }
    let event
    try { event = requireQuestionEvent(JSON.parse(frame.data.join('\n')), questionId) } catch { recoverQuestion(questionId, generation); return }
    if (frame.invalid || frame.event !== event.type || !isCanonicalDecimal(frame.id) || frame.id !== event.sequence) {
      recoverQuestion(questionId, generation)
      return
    }
    const current = question.value
    if (!current || !isCanonicalDecimal(current.currentSequence)) { recoverQuestion(questionId, generation); return }
    if (compareDecimal(event.sequence, current.currentSequence) <= 0) return
    applyQuestionEvent(event, questionId, generation)
  }

  const openQuestionStream = (questionId, generation) => {
    if (!isQuestionCurrent(questionId, generation) || !streamingStatus(question.value.status)) return
    const cursor = question.value.currentSequence
    if (!isCanonicalDecimal(cursor)) { recoverQuestion(questionId, generation); return }
    const controller = new AbortController()
    questionController = controller
    const isCurrentStream = () => isQuestionCurrent(questionId, generation) &&
      questionController === controller && !controller.signal.aborted
    let buffer = ''
    const newFrame = () => ({ event: 'message', eventSeen: false, id: null, idSeen: false, data: [], invalid: false })
    let frame = newFrame()
    const consumeLine = line => {
      if (!isCurrentStream()) return
      if (!line) {
        dispatchSseFrame(frame, questionId, generation)
        frame = newFrame()
        return
      }
      if (line.startsWith(':')) return
      const separator = line.indexOf(':')
      const field = separator < 0 ? line : line.slice(0, separator)
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '')
      if (field === 'event') {
        if (frame.eventSeen) frame.invalid = true
        frame.eventSeen = true
        frame.event = value
      } else if (field === 'id') {
        if (frame.idSeen) frame.invalid = true
        frame.idSeen = true
        frame.id = value
      } else if (field === 'data') frame.data.push(value)
    }
    const consume = (chunk, final = false) => {
      if (!isCurrentStream()) return
      buffer += String(chunk)
      let start = 0
      for (let index = 0; index < buffer.length; index += 1) {
        const character = buffer[index]
        if (character === '\n') {
          consumeLine(buffer.slice(start, index))
          start = index + 1
        } else if (character === '\r') {
          if (index + 1 === buffer.length && !final) break
          consumeLine(buffer.slice(start, index))
          if (buffer[index + 1] === '\n') index += 1
          start = index + 1
        }
      }
      buffer = buffer.slice(start)
    }
    api.execute({
      url: `/me/questions/${encodeURIComponent(questionId)}/events`, method: 'GET', autoLoading: false,
      headers: { 'Last-Event-ID': cursor }, responseType: 'stream', streamChunks: true, signal: controller.signal,
      onStreamOpen: handle => {
        if (isCurrentStream()) questionStreamReader = handle
        else handle.cancel?.()
      },
      onStream: chunk => consume(chunk),
      onStreamEnd: () => {
        if (!isCurrentStream()) return
        consume('', true)
        if (isCurrentStream() && streamingStatus(question.value.status)) recoverQuestion(questionId, generation)
      }
    }).catch(error => {
      if (error?.name !== 'AbortError' && isCurrentStream()) recoverQuestion(questionId, generation)
    })
  }

  const buildQuestionAnchor = async ({ startParagraphId, startOffset, endParagraphId, endOffset }) => {
    const current = chapter.value
    if (!current || !edition.value?.manifestSha256 || !Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset)) {
      throw new Error('请选择当前章回的正文段落')
    }
    const startIndex = current.paragraphs.findIndex(item => item.paragraphId === startParagraphId)
    const endIndex = current.paragraphs.findIndex(item => item.paragraphId === endParagraphId)
    if (startIndex < 0 || endIndex < startIndex || endIndex - startIndex + 1 > QUESTION_SEGMENT_LIMIT) {
      throw new Error('选文必须位于当前章回至多 16 个连续段落')
    }
    const boundary = (text, offset) => offset >= 0 && offset <= text.length && !(offset > 0 && offset < text.length &&
      /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]))
    const segments = []
    const selected = []
    let previousOrdinal = null
    let total = 0
    for (let index = startIndex; index <= endIndex; index += 1) {
      const paragraph = current.paragraphs[index]
      if (!Number.isInteger(paragraph.ordinal) || (previousOrdinal !== null && paragraph.ordinal !== previousOrdinal + 1)) {
        throw new Error('选文段落必须连续')
      }
      previousOrdinal = paragraph.ordinal
      const start = index === startIndex ? startOffset : 0
      const end = index === endIndex ? endOffset : paragraph.text.length
      if (!boundary(paragraph.text, start) || !boundary(paragraph.text, end) || end < start) {
        throw new Error('选文不能切断 UTF-8 字符边界')
      }
      const bytes = utf8Bytes(paragraph.text)
      const startByte = utf8Bytes(paragraph.text.slice(0, start)).byteLength
      const endByte = utf8Bytes(paragraph.text.slice(0, end)).byteLength
      if (endByte <= startByte) throw new Error('选文不能为空')
      const slice = bytes.slice(startByte, endByte)
      total += slice.byteLength + (selected.length ? 2 : 0)
      if (total > QUESTION_BYTE_LIMIT) throw new Error('选文不能超过 8192 UTF-8 bytes')
      segments.push({ paragraphId: paragraph.paragraphId, startByte, endByte, paragraphSha256: paragraph.sha256 })
      selected.push(slice)
    }
    const joined = new Uint8Array(total)
    let offset = 0
    selected.forEach((slice, index) => {
      if (index) { joined[offset++] = 10; joined[offset++] = 10 }
      joined.set(slice, offset)
      offset += slice.byteLength
    })
    if (!joined.byteLength) throw new Error('选文不能为空')
    return {
      anchor: {
        editionManifestSha256: edition.value.manifestSha256,
        blockType: current.blockType,
        blockId: current.blockId,
        segments,
        selectionSha256: await sha256Bytes(joined)
      },
      selectedText: new TextDecoder().decode(joined)
    }
  }

  const createQuestion = ({ question: text, selection }) => {
    if (questionCreatePromise) return questionCreatePromise
    const reused = questionCreateOperation
    const generation = ++questionGeneration
    clearQuestionResources()
    question.value = null
    questionPending.value = true
    questionError.value = ''
    const controller = new AbortController()
    questionMutationController = controller
    let operation = reused
    let mutationCompleted = false
    const promise = (async () => {
      if (!operation) {
        if (typeof text !== 'string' || !text.trim() || utf8ByteLength(text) > QUESTION_BYTE_LIMIT) {
          throw new Error('问题需为 1..8192 UTF-8 bytes')
        }
        const selectionValue = await buildQuestionAnchor(selection)
        if (!isQuestionGeneration(generation) || controller.signal.aborted) return null
        operation = { questionId: lowerUuid(), idempotencyKey: lowerUuid(), body: { question: text, anchor: selectionValue.anchor } }
        questionCreateOperation = operation
      }
      const result = await replayAmbiguousMutation(() => api.put(
        `/me/questions/${operation.questionId}`,
        operation.body,
        { autoLoading: false, headers: mutationHeaders({}, operation.idempotencyKey), signal: controller.signal }
      ))
      if (!isQuestionGeneration(generation) || controller.signal.aborted) return null
      mutationCompleted = true
      const snapshot = await requireQuestionSnapshot(unwrap(result), operation.questionId)
      if (!isQuestionGeneration(generation) || controller.signal.aborted) return null
      question.value = snapshot
      questionCreateOperation = null
      questionMutationController = null
      if (streamingStatus(snapshot.status)) openQuestionStream(snapshot.questionId, generation)
      return snapshot
    })().catch((error) => {
      if (!isQuestionGeneration(generation) || controller.signal.aborted || error?.name === 'AbortError') return null
      questionError.value = '案卷书吏暂无法受理此问。'
      if (mutationCompleted || !isAmbiguousMutationError(error)) questionCreateOperation = null
      throw error
    }).finally(() => {
      if (questionMutationController === controller) questionMutationController = null
      if (isQuestionGeneration(generation)) questionPending.value = false
      if (questionCreatePromise === promise) questionCreatePromise = null
    })
    questionCreatePromise = promise
    return promise
  }

  const retryQuestion = () => {
    const current = question.value
    if (questionRetryPromise) return questionRetryPromise
    if (!current || current.status !== 'FAILED_RETRYABLE' || questionPending.value) {
      throw new Error('当前问题不可重试')
    }
    requireVersion(current.version, '问题')
    const reused = questionRetryOperation
    const operation = reused || {
      questionId: current.questionId,
      expectedVersion: current.version,
      idempotencyKey: lowerUuid()
    }
    questionRetryOperation = operation
    const generation = ++questionGeneration
    clearQuestionResources()
    questionPending.value = true
    questionError.value = ''
    const controller = new AbortController()
    questionMutationController = controller
    let mutationCompleted = false
    const promise = replayAmbiguousMutation(() => api.post(
      `/me/questions/${operation.questionId}/retry`,
      { expectedVersion: operation.expectedVersion },
      { autoLoading: false, headers: mutationHeaders({}, operation.idempotencyKey), signal: controller.signal }
    )).then(async (result) => {
      if (!isQuestionCurrent(operation.questionId, generation) || controller.signal.aborted) return null
      mutationCompleted = true
      const snapshot = await requireQuestionSnapshot(unwrap(result), operation.questionId)
      if (!isQuestionCurrent(operation.questionId, generation) || controller.signal.aborted) return null
      question.value = snapshot
      questionRetryOperation = null
      questionMutationController = null
      if (streamingStatus(snapshot.status)) openQuestionStream(snapshot.questionId, generation)
      return snapshot
    }).catch(async (error) => {
      if (!isQuestionCurrent(operation.questionId, generation) || controller.signal.aborted || error?.name === 'AbortError') return null
      if (error?.status === 409) {
        questionRetryOperation = null
        clearQuestionTransport()
        try {
          const snapshot = await replaceQuestionSnapshot(operation.questionId, generation)
          if (!snapshot || !isQuestionCurrent(operation.questionId, generation)) return null
          questionPending.value = false
          questionError.value = '问题版本已更新，已刷新案卷书吏状态。'
          if (streamingStatus(snapshot.status)) openQuestionStream(operation.questionId, generation)
          return snapshot
        } catch (refreshError) {
          if (refreshError?.name !== 'AbortError' && isQuestionCurrent(operation.questionId, generation)) {
            questionError.value = '问题版本冲突，且状态刷新失败。'
            recoverQuestion(operation.questionId, generation, 1000)
          }
          throw error
        }
      } else {
        questionError.value = '案卷书吏重试失败。'
        if (mutationCompleted || !isAmbiguousMutationError(error)) questionRetryOperation = null
      }
      throw error
    }).finally(() => {
      if (questionMutationController === controller) questionMutationController = null
      if (isQuestionCurrent(operation.questionId, generation) && !questionRecoveryController && !questionPollTimer && !questionReconnectTimer) questionPending.value = false
      if (questionRetryPromise === promise) questionRetryPromise = null
    })
    questionRetryPromise = promise
    return promise
  }

  const initialize = async () => {
    if (disposed) return null
    const generation = ++initializeGeneration
    initializeController?.abort()
    const controller = new AbortController()
    initializeController = controller
    const isActive = () => !disposed && generation === initializeGeneration && !controller.signal.aborted
    loading.value = true
    errorMessage.value = ''
    try {
      await loadCatalog(controller.signal)
      if (!isActive()) return null
      await Promise.all([
        loadProgress(edition.value.editionId, controller.signal),
        loadBookmarks(controller.signal)
      ])
      if (!isActive()) return null
      const nextChapter = await continueReading(controller.signal)
      return isActive() ? nextChapter : null
    } catch (error) {
      if (!isActive() || error?.name === 'AbortError') return null
      errorMessage.value = '典籍暂无法读取，请稍后重试。'
      throw error
    } finally {
      if (isActive()) loading.value = false
    }
  }

  const flushProgress = () => {
    clearTimeout(saveTimer)
    if (queuedProgressIntent) {
      startProgressDrain().catch(() => {})
    } else if (saveState.value === 'pending') {
      saveProgress(currentLocation.value).catch(() => {})
    }
  }

  const lifecycleTarget = globalThis.window || globalThis

  onMounted(() => {
    if (autoInitialize) initialize().catch(() => {})
    lifecycleTarget.addEventListener?.('pagehide', flushProgress)
  })
  onBeforeUnmount(() => {
    disposed = true
    initializeGeneration += 1
    loadGeneration += 1
    initializeController?.abort()
    blockController?.abort()
    clearTimeout(saveTimer)
    queuedProgressIntent = null
    lifecycleTarget.removeEventListener?.('pagehide', flushProgress)
    closeQuestion()
  })

  return {
    anchorForLocation,
    blocks,
    bookmarkPending,
    bookmarks,
    canGoNext,
    canGoPrevious,
    catalog,
    chapter,
    chapterLoading,
    continueLocation,
    continueReading,
    createBookmark,
    currentBlock,
    currentLocation,
    deleteBookmark,
    deleteNote,
    edition,
    errorMessage,
    focusRequest,
    goNext,
    goPrevious,
    initialize,
    isCanonicalDecimal,
    loadBlock,
    loading,
    locationFor,
    noteAnchorNotice,
    noteConflictDraft,
    notePending,
    noteRetryNotice,
    buildQuestionAnchor,
    closeQuestion,
    createQuestion,
    question,
    questionError,
    questionPending,
    retryQuestion,
    notes,
    progress,
    saveNote,
    saveProgress,
    saveState,
    scheduleProgressSave,
    setCurrentParagraph
  }
}
