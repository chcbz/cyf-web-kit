<template>
  <section
    class="archive-reader"
    aria-label="典籍阅读"
  >
    <div
      v-if="reader.loading"
      class="archive-state"
      role="status"
    >
      正在整理阁中典籍…
    </div>
    <div
      v-else-if="reader.errorMessage && !reader.chapter"
      class="archive-state archive-error"
      role="alert"
    >
      <p>{{ reader.errorMessage }}</p>
      <button
        type="button"
        @click="retryCatalog"
      >
        重试
      </button>
    </div>
    <template v-else>
      <div
        v-if="!readingOpen"
        class="archive-shelf"
      >
        <header class="archive-shelf-header">
          <div>
            <p class="reader-kicker">典籍阅读</p>
            <h3>阁中典籍</h3>
            <p>先择一部典籍，再进入沉浸翻阅。</p>
          </div>
          <span class="archive-shelf-count">共 {{ reader.catalog ? 1 : 0 }} 部</span>
        </header>

        <article class="archive-book-card">
          <div class="archive-book-cover" aria-hidden="true">
            <span>古典</span>
            <strong>{{ reader.catalog?.title || '水滸傳' }}</strong>
            <small>一百二十回</small>
          </div>
          <div class="archive-book-info">
            <p class="reader-kicker">已收录典籍</p>
            <h4>{{ reader.catalog?.title || '水滸傳' }}</h4>
            <p>含引首与 {{ chapterCount }} 回正文，可记录阅读进度、书签及私人手札。</p>
            <button
              type="button"
              class="archive-book-open"
              @click="enterReading"
            >
              进入翻阅
            </button>
          </div>
        </article>
      </div>

      <Teleport to="body" :disabled="disableTeleport">
        <section
          v-if="readingOpen"
          ref="dialogRef"
          class="archive-reader-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-reader-title"
          tabindex="-1"
        >
          <header class="reader-header">
            <div>
              <p class="reader-kicker">固定典籍</p>
              <h3 id="archive-reader-title">{{ reader.catalog?.title || '水滸傳' }}</h3>
            </div>
            <div class="reader-header-actions">
              <p
                class="save-state"
                role="status"
              >
                {{ saveLabel }}
              </p>
              <button
                type="button"
                class="reader-header-button"
                :aria-expanded="catalogOpen"
                aria-controls="archive-reader-catalog"
                @click="catalogOpen = !catalogOpen"
              >
                {{ catalogOpen ? '收起目录' : '目录' }}
              </button>
              <button
                type="button"
                class="reader-header-button reader-exit"
                @click="closeReading"
              >
                返回典籍列表
              </button>
            </div>
          </header>

          <div class="reader-layout" :class="{ 'catalog-open': catalogOpen }">
            <nav
              v-if="catalogOpen"
              id="archive-reader-catalog"
              class="reader-catalog"
              aria-label="《水滸傳》目录"
            >
              <button
                v-for="block in reader.blocks"
                :key="block.blockId"
                type="button"
                :class="{ active: block.blockId === reader.chapter?.blockId }"
                :aria-current="block.blockId === reader.chapter?.blockId ? 'page' : undefined"
                @click="openBlock(block)"
              >
                {{ block.number == null ? '引首' : `第${block.number}回` }} {{ block.title }}
              </button>
            </nav>

            <article
              ref="contentRef"
              class="reader-content"
              tabindex="0"
              @scroll.passive="onScroll"
            >
              <div class="reader-actions">
                <button
                  type="button"
                  :disabled="!reader.continueLocation || reader.chapterLoading"
                  @click="continueReading"
                >
                  继续阅读
                </button>
                <button
                  type="button"
                  :disabled="!reader.canGoPrevious || reader.chapterLoading"
                  aria-label="上一回"
                  @click="runAction(reader.goPrevious, '上一回暂无法读取。')"
                >
                  上一回
                </button>
                <button
                  type="button"
                  :disabled="!reader.canGoNext || reader.chapterLoading"
                  aria-label="下一回"
                  @click="runAction(reader.goNext, '下一回暂无法读取。')"
                >
                  下一回
                </button>
                <button
                  type="button"
                  class="bookmark-create"
                  :disabled="!reader.currentLocation || reader.bookmarkPending"
                  @click="createBookmark"
                >
                  {{ reader.bookmarkPending ? '保存中…' : '书签' }}
                </button>
              </div>

              <div
                v-if="reader.chapterLoading"
                class="archive-state"
                role="status"
              >
                正在打开章回…
              </div>
              <template v-else-if="reader.chapter">
                <h4>
                  {{ reader.chapter.number == null ? '引首' : `第${reader.chapter.number}回` }}
                  {{ reader.chapter.title }}
                </h4>
                <p
                  v-for="paragraph in reader.chapter.paragraphs"
                  :id="paragraph.paragraphId"
                  :key="paragraph.paragraphId"
                  :data-paragraph-id="paragraph.paragraphId"
                  tabindex="0"
                  class="reader-paragraph"
                  @focus="handleParagraphFocus(paragraph)"
                  @click="reader.setCurrentParagraph(paragraph)"
                >
                  {{ paragraph.text }}
                </p>
              </template>
              <div
                v-else
                class="archive-state"
              >
                目录中暂未找到正文。
              </div>
            </article>

            <aside
              class="reader-notes"
              aria-label="私人手札与书签"
            >
              <h4>私人手札</h4>
              <textarea
                v-model="noteText"
                aria-label="当前段落私人手札"
                aria-describedby="note-byte-hint"
                placeholder="记录此处所思；仅自己可见。"
              ></textarea>
              <p
                id="note-byte-hint"
                :class="{ 'archive-error': noteBytes > 20000 }"
              >
                {{ noteBytes }} / 20,000 UTF-8 bytes
              </p>
              <button
                type="button"
                class="note-save"
                :disabled="!noteText.trim() || !reader.currentLocation || noteBytes > 20000 || reader.notePending"
                @click="saveNote"
              >
                {{ reader.notePending ? '保存中…' : '保存手札' }}
              </button>
              <p
                v-if="reader.noteAnchorNotice"
                class="archive-notice"
                role="status"
              >
                {{ reader.noteAnchorNotice }}
              </p>
              <p
                v-if="reader.noteRetryNotice"
                class="archive-notice"
                role="status"
              >
                {{ reader.noteRetryNotice }}
              </p>
              <p
                v-if="reader.noteConflictDraft"
                class="archive-error"
                role="alert"
              >
                本地草稿已保留，需人工处理冲突。
              </p>
              <ul>
                <li
                  v-for="note in reader.notes"
                  :key="note.noteId"
                >
                  <p>{{ note.text }}</p>
                  <button
                    type="button"
                    class="note-edit"
                    :disabled="reader.notePending"
                    @click="editNote(note)"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    class="note-delete"
                    :disabled="reader.notePending"
                    @click="removeNote(note)"
                  >
                    删除
                  </button>
                </li>
              </ul>

              <section
                class="archive-question"
                aria-label="选文问案卷书吏"
              >
                <h4>选文问案卷书吏</h4>
                <p class="archive-notice">Responder：archive-clerk-v1 · 案卷书吏（fallback）</p>
                <textarea
                  v-model="questionText"
                  aria-label="向案卷书吏提问"
                  placeholder="先在当前章回正文中选取连续段落，再提出问题。"
                ></textarea>
                <button
                  type="button"
                  class="question-create"
                  :disabled="!questionText.trim() || reader.questionPending"
                  @click="askSelectedText"
                >
                  {{ reader.questionPending ? '递交中…' : '向案卷书吏提问' }}
                </button>
                <article
                  v-if="reader.question"
                  class="archive-question-result"
                  aria-live="polite"
                >
                  <p><strong>案卷书吏</strong> · {{ reader.question.status }}</p>
                  <p class="archive-question-selection">{{ reader.question.selectedText }}</p>
                  <p v-if="reader.question.answer">{{ reader.question.answer }}</p>
                  <p v-if="reader.question.lastErrorCode" class="archive-error">{{ reader.question.lastErrorCode }}</p>
                  <button
                    v-if="reader.question.status === 'FAILED_RETRYABLE'"
                    type="button"
                    class="question-retry"
                    :disabled="reader.questionPending"
                    @click="retryQuestion"
                  >
                    重试
                  </button>
                  <button
                    v-if="reader.question.status === 'SUCCEEDED' || reader.question.status === 'FAILED_FINAL'"
                    type="button"
                    @click="reader.closeQuestion"
                  >
                    关闭问答
                  </button>
                </article>
                <p v-if="reader.questionError" class="archive-error" role="alert">{{ reader.questionError }}</p>
              </section>

              <h4>书签</h4>
              <ul>
                <li
                  v-for="bookmark in reader.bookmarks"
                  :key="bookmark.bookmarkId"
                >
                  <button
                    type="button"
                    @click="openBookmark(bookmark)"
                  >
                    {{ bookmark.location?.paragraphId || bookmark.location?.blockId }}
                  </button>
                  <button
                    type="button"
                    class="bookmark-delete"
                    aria-label="删除书签"
                    @click="removeBookmark(bookmark)"
                  >
                    删除
                  </button>
                </li>
              </ul>
            </aside>
          </div>

          <p
            v-if="actionMessage || reader.errorMessage"
            class="archive-error reader-global-error"
            role="alert"
          >
            {{ actionMessage || reader.errorMessage }}
          </p>
        </section>
      </Teleport>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, proxyRefs, ref } from 'vue'
import { useArchiveReader, utf8ByteLength } from '@/composables/juyiting/useArchiveReader'
import { registerIdentityCleanup } from '@/utils/identityLifecycle.js'

const { disableTeleport, initialView } = defineProps({
  disableTeleport: { type: Boolean, default: false },
  initialView: {
    type: String,
    default: 'catalog',
    validator: value => ['catalog', 'reader'].includes(value)
  }
})

const readerState = useArchiveReader({ autoInitialize: false })
const reader = proxyRefs(readerState)
const readingOpen = ref(initialView === 'reader')
const catalogOpen = ref(false)
const dialogRef = ref(null)
const contentRef = ref(null)
const noteText = ref('')
const questionText = ref('')
const editingNote = ref(null)
const actionMessage = ref('')
const NEW_NOTE_TARGET = Symbol('new-note-target')
const noteBytes = computed(() => utf8ByteLength(noteText.value))
const chapterCount = computed(() => reader.catalog?.activeEdition?.chapters?.length || 0)
const saveLabel = computed(() => ({
  error: '未保存',
  idle: '阅读进度未保存',
  pending: '等待保存…',
  saved: '已保存',
  saving: '正在保存…'
})[reader.saveState])
const PROGRAMMATIC_SCROLL_SETTLE_MS = 180
let scrollTimer
let programmaticScrollTimer
let programmaticFocusId = ''
let programmaticScrollGeneration = 0
let editorRevision = 0
let returnFocusElement = null
let unregisterEditorIdentityCleanup = null

const runAction = async (action, fallbackMessage) => {
  actionMessage.value = ''
  try {
    return await action()
  } catch {
    actionMessage.value = reader.errorMessage || fallbackMessage
    return null
  }
}

const openBlock = async (block) => {
  const opened = await runAction(
    () => reader.loadBlock(block),
    '章回暂无法读取。'
  )
  if (opened) catalogOpen.value = false
  return opened
}

const retryCatalog = () => runAction(
  () => reader.initialize({ openChapter: false }),
  '典籍重试失败。'
)

const enterReading = async (event) => {
  returnFocusElement = typeof event?.currentTarget?.focus === 'function'
    ? event.currentTarget
    : document.activeElement
  const opened = reader.chapter
    || await runAction(reader.initialize, '典籍暂无法读取，请稍后重试。')
  if (!opened && !reader.chapter) return
  catalogOpen.value = false
  readingOpen.value = true
  document.body?.classList.add('archive-reading-open')
  await nextTick()
  dialogRef.value?.focus()
}

const closeReading = async () => {
  reader.cancelBlockLoad()
  void flushReadingPosition()
  reader.closeQuestion()
  readingOpen.value = false
  catalogOpen.value = false
  document.body?.classList.remove('archive-reading-open')
  await nextTick()
  const focusTarget = returnFocusElement?.isConnected
    ? returnFocusElement
    : document.querySelector('.archive-reader .archive-book-open')
  focusTarget?.focus()
  returnFocusElement = null
}

const focusableElements = () => [...(dialogRef.value?.querySelectorAll(
  'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
) || [])].filter(element => !element.hasAttribute('hidden'))

const handleReaderKeydown = (event) => {
  if (!readingOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeReading()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = focusableElements()
  if (!focusable.length) {
    event.preventDefault()
    dialogRef.value?.focus()
    return
  }
  const first = focusable[0]
  const last = focusable.at(-1)
  const activeElement = document.activeElement
  const focusOutsideContent = activeElement === dialogRef.value || !dialogRef.value?.contains(activeElement)
  if (event.shiftKey && (activeElement === first || focusOutsideContent)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (activeElement === last || focusOutsideContent)) {
    event.preventDefault()
    first.focus()
  }
}
const continueReading = () => runAction(
  reader.continueReading,
  '继续阅读位置暂无法读取。'
)
const createBookmark = () => runAction(
  reader.createBookmark,
  '书签暂未保存。'
)
const removeBookmark = bookmark => runAction(
  () => reader.deleteBookmark(bookmark),
  '书签暂未删除。'
)
const removeNote = (note) => {
  if (reader.notePending) return Promise.resolve(null)
  return runAction(
    () => reader.deleteNote(note),
    '手札暂未删除。'
  )
}

const paragraphForSelectionNode = node => {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  const paragraph = element?.closest?.('.reader-paragraph')
  return paragraph && contentRef.value?.contains(paragraph) ? paragraph : null
}

const offsetWithinParagraph = (paragraph, node, offset) => {
  const range = document.createRange()
  range.selectNodeContents(paragraph)
  range.setEnd(node, offset)
  return range.toString().length
}

const selectionDescriptor = () => {
  const selection = window.getSelection?.()
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) throw new Error('请先在当前章回正文中选择文字。')
  const range = selection.getRangeAt(0)
  const start = paragraphForSelectionNode(range.startContainer)
  const end = paragraphForSelectionNode(range.endContainer)
  if (!start || !end || !reader.chapter) throw new Error('选文必须位于当前章回正文段落。')
  const paragraphs = [...contentRef.value.querySelectorAll('.reader-paragraph')]
  const startIndex = paragraphs.indexOf(start)
  const endIndex = paragraphs.indexOf(end)
  if (startIndex < 0 || endIndex < startIndex) throw new Error('选文必须是当前章回的连续正文段落。')
  const authoritative = reader.chapter.paragraphs
  const selectedParagraphs = paragraphs.slice(startIndex, endIndex + 1)
  const selectedAuthoritative = selectedParagraphs.map(element =>
    authoritative.find(item => item.paragraphId === element.dataset.paragraphId)
  )
  const authoritativeStartIndex = authoritative.indexOf(selectedAuthoritative[0])
  if (authoritativeStartIndex < 0 || selectedAuthoritative.some((item, index) =>
    !item || item !== authoritative[authoritativeStartIndex + index] || selectedParagraphs[index].textContent !== item.text
  )) {
    throw new Error('当前正文与权威段落不一致，无法提交选文。')
  }
  const [startItem] = selectedAuthoritative
  const endItem = selectedAuthoritative.at(-1)
  return {
    startParagraphId: startItem.paragraphId,
    startOffset: offsetWithinParagraph(start, range.startContainer, range.startOffset),
    endParagraphId: endItem.paragraphId,
    endOffset: offsetWithinParagraph(end, range.endContainer, range.endOffset)
  }
}

const askSelectedText = async () => {
  actionMessage.value = ''
  try {
    await reader.createQuestion({ question: questionText.value, selection: selectionDescriptor() })
    questionText.value = ''
    window.getSelection?.()?.removeAllRanges()
  } catch (error) {
    actionMessage.value = error?.message || reader.questionError || '案卷书吏暂无法受理此问。'
  }
}

const retryQuestion = () => runAction(reader.retryQuestion, '案卷书吏重试失败。')

const saveNote = async () => {
  if (noteBytes.value > 20_000) return
  const note = editingNote.value
  const submittedTarget = note?.noteId || NEW_NOTE_TARGET
  const submittedRevision = editorRevision
  const submittedText = noteText.value
  const saved = await runAction(
    () => reader.saveNote({
      noteId: note?.noteId,
      text: submittedText,
      anchor: note?.anchor,
      version: note?.version || '0'
    }),
    '手札暂未保存。'
  )
  if (!saved) return
  const currentTarget = editingNote.value?.noteId || NEW_NOTE_TARGET
  if (currentTarget !== submittedTarget || editorRevision !== submittedRevision) return
  const editorChangedWhileSaving = noteText.value !== submittedText
  if (saved.preservedDraft || editorChangedWhileSaving) {
    if (!editorChangedWhileSaving) noteText.value = saved.preservedDraft.text
    editingNote.value = {
      ...saved.note,
      anchor: saved.preservedDraft ? saved.preservedDraft.anchor : saved.note.anchor,
      version: saved.note.version
    }
    editorRevision += 1
    return
  }
  noteText.value = ''
  editingNote.value = null
  editorRevision += 1
}

const editNote = (note) => {
  if (reader.notePending) return
  editingNote.value = note
  noteText.value = note.text
  editorRevision += 1
}

const openBookmark = bookmark => runAction(
  () => {
    const block = reader.blocks.find(item => item.blockId === bookmark.location?.blockId)
    return reader.loadBlock(block, bookmark.location)
  },
  '书签位置暂无法读取。'
)

const visibleParagraph = (container) => {
  const containerRect = container.getBoundingClientRect()
  const candidates = [...container.querySelectorAll('.reader-paragraph')]
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top)
      )
      return { element, rect, visibleHeight }
    })
    .filter(candidate => candidate.visibleHeight > 0)
    .sort((left, right) => right.visibleHeight - left.visibleHeight)
  return candidates[0] || null
}

const handleParagraphFocus = (paragraph) => {
  if (programmaticFocusId === paragraph.paragraphId) {
    programmaticFocusId = ''
    return
  }
  reader.setCurrentParagraph(paragraph)
}

const clearProgrammaticScroll = (generation) => {
  if (programmaticScrollGeneration === generation) programmaticScrollGeneration = 0
}

const suppressProgrammaticScroll = (generation) => {
  programmaticScrollGeneration = generation
  clearTimeout(programmaticScrollTimer)
  programmaticScrollTimer = setTimeout(
    () => clearProgrammaticScroll(generation),
    PROGRAMMATIC_SCROLL_SETTLE_MS
  )
}

const captureVisibleParagraph = (container) => {
  const visible = container && visibleParagraph(container)
  if (!visible) return
  const paragraph = reader.chapter?.paragraphs?.find(
    item => item.paragraphId === visible.element.dataset.paragraphId
  )
  if (!paragraph) return
  const atEnd = container.scrollTop + container.clientHeight >= container.scrollHeight - 4
  const isLast = paragraph.paragraphId === reader.chapter?.paragraphs?.at(-1)?.paragraphId
  reader.setCurrentParagraph(paragraph, atEnd && isLast ? paragraph.utf8ByteLength : 0)
}

const flushReadingPosition = () => {
  clearTimeout(scrollTimer)
  const focusGeneration = reader.focusRequest?.generation
  if (!programmaticScrollGeneration || programmaticScrollGeneration !== focusGeneration) {
    captureVisibleParagraph(contentRef.value)
  }
  return reader.flushProgress()
}

const onScroll = (event) => {
  const container = event.currentTarget
  const focusGeneration = reader.focusRequest?.generation
  if (programmaticScrollGeneration && programmaticScrollGeneration === focusGeneration) {
    clearTimeout(scrollTimer)
    suppressProgrammaticScroll(programmaticScrollGeneration)
    return
  }
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => captureVisibleParagraph(container), 180)
}

let focusedGeneration = 0
const focusRequestedLocation = () => {
  const request = reader.focusRequest
  if (!request?.location || request.generation === focusedGeneration) return
  const target = [...(contentRef.value?.querySelectorAll('.reader-paragraph') || [])]
    .find(element => element.dataset.paragraphId === request.location.paragraphId)
  if (!target) return
  focusedGeneration = request.generation
  programmaticFocusId = request.location.paragraphId
  target.focus({ preventScroll: true })
  programmaticFocusId = ''
  if (target.scrollIntoView) {
    suppressProgrammaticScroll(request.generation)
    target.scrollIntoView({ block: 'center' })
  }
}

onUpdated(focusRequestedLocation)

onMounted(() => {
  unregisterEditorIdentityCleanup = registerIdentityCleanup(() => {
    noteText.value = ''
    editingNote.value = null
    editorRevision += 1
  })
  window.addEventListener('keydown', handleReaderKeydown)
  if (readingOpen.value) document.body?.classList.add('archive-reading-open')
  reader.initialize({ openChapter: readingOpen.value }).catch(() => {})
})

onBeforeUnmount(() => {
  unregisterEditorIdentityCleanup?.()
  unregisterEditorIdentityCleanup = null
  window.removeEventListener('keydown', handleReaderKeydown)
  document.body?.classList.remove('archive-reading-open')
  void flushReadingPosition()
  clearTimeout(programmaticScrollTimer)
  programmaticScrollGeneration = 0
})
</script>

<style scoped>
.archive-reader {
  container-type: inline-size;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  color: #3f2815;
}

.archive-shelf {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 18px;
}

.archive-shelf-header,
.reader-header,
.reader-actions,
.reader-header-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.archive-shelf-header h3,
.archive-shelf-header p,
.reader-header h3,
.reader-header p,
.reader-notes h4,
.archive-book-info h4,
.archive-book-info p {
  margin: 0;
}

.archive-shelf-header h3 {
  margin: 2px 0 5px;
  font-size: clamp(22px, 3vw, 30px);
}

.archive-shelf-header > div > p:last-child,
.archive-book-info > p:not(.reader-kicker) {
  color: #765f40;
  line-height: 1.7;
}

.archive-shelf-count {
  padding: 6px 10px;
  border: 1px solid #dcc9a9;
  border-radius: 999px;
  background: rgba(255, 250, 240, 0.8);
  color: #765f40;
  font-size: 12px;
}

.archive-book-card {
  display: grid;
  grid-template-columns: minmax(128px, 180px) minmax(0, 1fr);
  align-items: stretch;
  gap: clamp(18px, 4vw, 34px);
  max-width: 680px;
  padding: clamp(18px, 4vw, 30px);
  border: 1px solid #d8c09a;
  border-radius: 16px;
  background:
    linear-gradient(90deg, rgba(116, 74, 35, 0.05) 1px, transparent 1px) 0 0 / 22px 100%,
    linear-gradient(145deg, #fffaf0, #f3e3c4);
  box-shadow: 0 16px 34px rgba(71, 44, 23, 0.12);
}

.archive-book-cover {
  position: relative;
  display: flex;
  min-height: 218px;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 18px 14px;
  border: 5px double rgba(255, 232, 173, 0.68);
  border-radius: 7px 13px 13px 7px;
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.14), transparent 12%),
    linear-gradient(145deg, #6f1f19, #9c3327);
  color: #fff1c1;
  box-shadow: 7px 10px 18px rgba(65, 29, 17, 0.24);
  text-align: center;
}

.archive-book-cover::after {
  content: '';
  position: absolute;
  inset: 9px;
  border: 1px solid rgba(255, 232, 173, 0.4);
  pointer-events: none;
}

.archive-book-cover span,
.archive-book-cover small {
  position: relative;
  z-index: 1;
  font-size: 12px;
  letter-spacing: 0.28em;
}

.archive-book-cover strong {
  position: relative;
  z-index: 1;
  font-family: serif;
  font-size: clamp(25px, 4vw, 34px);
  letter-spacing: 0.24em;
  writing-mode: vertical-rl;
}

.archive-book-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 10px;
}

.archive-book-info h4 {
  font-family: serif;
  font-size: clamp(24px, 4vw, 34px);
}

.archive-book-open,
.reader-header-button,
.reader-catalog button,
.reader-notes button,
.reader-actions button,
.archive-state button {
  padding: 8px 11px;
  border: 0;
  border-radius: 7px;
  background: #eadabb;
  color: #3f2815;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.archive-book-open {
  min-width: 120px;
  margin-top: 6px;
  padding: 11px 18px;
  background: #23483e;
  color: #fff8e8;
  text-align: center;
  font-weight: 700;
}

.archive-reader-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 10000;
  box-sizing: border-box;
  display: flex;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  padding: clamp(12px, 2vw, 24px);
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 0, rgba(214, 180, 119, 0.2), transparent 42%),
    #f4ead6;
  color: #3f2815;
}

.reader-header {
  flex: 0 0 auto;
  padding: 2px 4px 10px;
  border-bottom: 1px solid rgba(98, 66, 34, 0.18);
}

.reader-kicker,
.save-state {
  color: #765f40;
  font-size: 12px;
}

.reader-header-actions {
  justify-content: flex-end;
}

.reader-header-button {
  background: #d8c29d;
}

.reader-header-button.reader-exit {
  background: #23483e;
  color: #fff8e8;
}

.reader-layout {
  position: relative;
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) minmax(230px, 0.32fr);
  gap: 12px;
}

.reader-layout.catalog-open {
  grid-template-columns: minmax(190px, 0.28fr) minmax(0, 1fr) minmax(230px, 0.32fr);
}

.reader-catalog,
.reader-content,
.reader-notes {
  min-height: 0;
  padding: clamp(12px, 2vw, 22px);
  overflow: auto;
  border: 1px solid #dcc9a9;
  border-radius: 12px;
  background: rgba(255, 250, 240, 0.94);
  box-shadow: 0 8px 24px rgba(71, 44, 23, 0.08);
}

.reader-catalog {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.reader-catalog button.active,
.reader-actions button {
  background: #23483e;
  color: #fff8e8;
}

.reader-actions button:disabled,
.reader-notes button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.reader-content {
  scroll-behavior: smooth;
}

.reader-content h4 {
  margin: 18px 0 24px;
  font-family: serif;
  font-size: clamp(22px, 2.5vw, 30px);
  text-align: center;
}

.reader-paragraph {
  max-width: 50em;
  margin: 0 auto 1.05em;
  font-family: serif;
  font-size: clamp(16px, 1.35vw, 20px);
  line-height: 2;
  outline-offset: 3px;
  cursor: text;
  text-align: justify;
}

.reader-paragraph:focus {
  outline: 2px solid #b07835;
}

.archive-question {
  display: grid;
  gap: 7px;
  margin: 16px 0;
  padding-top: 12px;
  border-top: 1px solid #dcc9a9;
}

.archive-question textarea {
  min-height: 72px;
  resize: vertical;
}

.archive-question-result {
  padding: 8px;
  border-radius: 6px;
  background: #f5ead4;
}

.archive-question-result p {
  margin: 0 0 6px;
  white-space: pre-wrap;
}

.archive-question-selection,
.archive-notice {
  color: #765f40;
  font-size: 12px;
}

.reader-notes textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 88px;
  margin: 0 0 7px;
  font: inherit;
}

.reader-notes ul {
  padding: 0;
  list-style: none;
}

.reader-notes li {
  padding: 8px 0;
  border-top: 1px solid #eadabb;
}

.reader-notes li p {
  margin: 0 0 6px;
  white-space: pre-wrap;
}

.reader-notes li button + button {
  margin-left: 6px;
}

.archive-state {
  padding: 22px;
  border-radius: 8px;
  background: #fff8e8;
  text-align: center;
}

.archive-error {
  color: #9b2f26;
}

.reader-global-error {
  flex: 0 0 auto;
  margin: 0;
  text-align: center;
}

:global(body.archive-reading-open) {
  overflow: hidden;
}

@media (max-width: 900px) {
  .archive-reader-fullscreen {
    padding: 8px;
  }

  .reader-layout,
  .reader-layout.catalog-open {
    grid-template-columns: minmax(0, 1fr);
  }

  .reader-catalog {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 4;
    width: min(82vw, 330px);
    box-sizing: border-box;
    box-shadow: 12px 0 30px rgba(45, 27, 16, 0.24);
  }

  .reader-notes {
    max-height: 34vh;
  }

  .reader-header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .save-state {
    margin-right: auto;
  }
}

@container (max-width: 520px) {
  .archive-book-card {
    grid-template-columns: 108px minmax(0, 1fr);
    gap: 14px;
    padding: 14px;
  }

  .archive-book-cover {
    min-height: 174px;
    padding: 12px 8px;
  }

  .archive-book-cover strong {
    font-size: 23px;
  }
}
</style>
