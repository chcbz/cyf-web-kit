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
      正在展开《水滸傳》…
    </div>
    <div
      v-else-if="reader.errorMessage && !reader.chapter"
      class="archive-state archive-error"
      role="alert"
    >
      <p>{{ reader.errorMessage }}</p>
      <button
        type="button"
        @click="runAction(reader.initialize, '典籍重试失败。')"
      >
        重试
      </button>
    </div>
    <template v-else>
      <header class="reader-header">
        <div>
          <p class="reader-kicker">固定典籍</p>
          <h3>{{ reader.catalog?.title || '水滸傳' }}</h3>
        </div>
        <p
          class="save-state"
          role="status"
        >
          {{ saveLabel }}
        </p>
      </header>

      <div class="reader-layout">
        <nav
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
        class="archive-error"
        role="alert"
      >
        {{ actionMessage || reader.errorMessage }}
      </p>
    </template>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onUpdated, proxyRefs, ref } from 'vue'
import { useArchiveReader, utf8ByteLength } from '@/composables/juyiting/useArchiveReader'

const readerState = useArchiveReader()
const reader = proxyRefs(readerState)
const contentRef = ref(null)
const noteText = ref('')
const questionText = ref('')
const editingNote = ref(null)
const actionMessage = ref('')
const NEW_NOTE_TARGET = Symbol('new-note-target')
const noteBytes = computed(() => utf8ByteLength(noteText.value))
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

const runAction = async (action, fallbackMessage) => {
  actionMessage.value = ''
  try {
    return await action()
  } catch {
    actionMessage.value = reader.errorMessage || fallbackMessage
    return null
  }
}

const openBlock = block => runAction(
  () => reader.loadBlock(block),
  '章回暂无法读取。'
)
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

const onScroll = (event) => {
  const container = event.currentTarget
  const focusGeneration = reader.focusRequest?.generation
  if (programmaticScrollGeneration && programmaticScrollGeneration === focusGeneration) {
    clearTimeout(scrollTimer)
    suppressProgrammaticScroll(programmaticScrollGeneration)
    return
  }
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => {
    const visible = visibleParagraph(container)
    if (!visible) return
    const paragraph = reader.chapter?.paragraphs?.find(
      item => item.paragraphId === visible.element.dataset.paragraphId
    )
    if (!paragraph) return
    const atEnd = container.scrollTop + container.clientHeight >= container.scrollHeight - 4
    const isLast = paragraph.paragraphId === reader.chapter?.paragraphs?.at(-1)?.paragraphId
    reader.setCurrentParagraph(paragraph, atEnd && isLast ? paragraph.utf8ByteLength : 0)
  }, 180)
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

onBeforeUnmount(() => {
  clearTimeout(scrollTimer)
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
  gap: 10px;
  color: #3f2815;
}

.reader-header,
.reader-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.reader-header h3,
.reader-header p,
.reader-notes h4 {
  margin: 0;
}

.reader-kicker,
.save-state {
  color: #765f40;
  font-size: 12px;
}

.reader-layout {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(150px, 0.65fr) minmax(280px, 1.8fr) minmax(190px, 0.8fr);
  gap: 10px;
}

.reader-catalog,
.reader-content,
.reader-notes {
  min-height: 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid #dcc9a9;
  border-radius: 8px;
  background: #fffaf0;
}

.reader-catalog {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reader-catalog button,
.reader-notes button,
.reader-actions button,
.archive-state button {
  padding: 7px 9px;
  border: 0;
  border-radius: 6px;
  background: #eadabb;
  color: #3f2815;
  cursor: pointer;
  text-align: left;
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

.reader-content h4 {
  margin: 14px 0;
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

.archive-question-selection {
  color: #765f40;
  font-size: 12px;
}

.reader-paragraph {
  line-height: 1.9;
  outline-offset: 3px;
  cursor: text;
}

.reader-paragraph:focus {
  outline: 2px solid #b07835;
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

.archive-notice {
  color: #765f40;
  font-size: 12px;
}

@container (max-width: 760px) {
  .reader-layout {
    grid-template-columns: 1fr;
  }

  .reader-catalog {
    max-height: 180px;
  }

  .reader-content {
    min-height: 320px;
  }

  .reader-notes {
    max-height: 300px;
  }
}
</style>
