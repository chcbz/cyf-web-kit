<template>
  <div
    ref="root"
    class="history-window"
    @toggle.capture="schedule"
    @focusin="schedule"
    @focusout="schedule"
    @pointerup="schedule"
    @keyup="schedule"
    @select.capture="schedule"
  >
    <template v-if="pages.length">
      <template v-for="segment in segments" :key="segment.key">
        <div v-if="segment.spacer" aria-hidden="true" :style="{ height: `${segment.height}px` }"></div>
        <div
          v-else
          :ref="element => bindPage(segment.key, element)"
          :data-history-page="segment.key"
          class="history-window-page"
        >
          <template v-if="segment.page.loaded">
            <p v-if="emptyPageText && !rowsFor(segment.page).length" class="history-empty-page">{{ emptyPageText }}</p>
            <div v-for="message in rowsFor(segment.page)" :key="message.localId" :data-history-row="message.localId">
              <slot :message="message"></slot>
            </div>
          </template>
          <div
            v-else
            class="history-window-placeholder"
            :style="{ minHeight: `${segment.height}px` }"
            role="status"
          >
            <span>{{ errors[segment.key] || (segment.page.gap && !loading.has(segment.key) ? '这段消息尚未加载。' : '正在读取这一页消息…') }}</span>
            <button v-if="errors[segment.key] || (segment.page.gap && !loading.has(segment.key))" type="button" @click="$emit('load', segment.key)">{{ errors[segment.key] ? '重试' : '读取这段消息' }}</button>
          </div>
        </div>
      </template>
      <div v-for="message in transient" :key="message.localId" :data-history-row="message.localId"><slot :message="message"></slot></div>
    </template>
    <template v-else><slot v-for="message in messages" :key="message.localId || message.timestamp" :message="message"></slot></template>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { historyWindowSegments, historyWindowAnchor, historyWindowAnchorTop } from '../../composables/juyiting/hallHistoryWindow.js'

const props = defineProps({
  pages: { type: Array, default: () => [] }, messages: { type: Array, default: () => [] },
  pinnedIds: { type: Array, default: () => [] },
  emptyPageText: { type: String, default: '' },
  scroller: { type: Object, default: null }, scope: { type: String, default: '' },
  loading: { type: Object, default: () => new Set() }, errors: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['retain', 'load'])
const root = ref(null), view = ref({ top: 0, height: 1, pinned: new Set() }), heights = ref({})
const nodes = new Map()
let observer = null, frame = 0, savedAnchor = null, retentionSignature = '', disposed = false
const descriptors = computed(() => props.pages.map(page => ({ ...page, height: heights.value[page.key] || 0 })))
const settlingAnchor = shallowRef(null)
const segments = computed(() => historyWindowSegments(descriptors.value, { ...view.value,
  pinned: new Set([...view.value.pinned, ...(settlingAnchor.value ? [settlingAnchor.value.key] : [])]) }))
const knownIds = computed(() => new Set(props.pages.flatMap(page => page.ids)))
const transient = computed(() => props.messages.filter(message => !knownIds.value.has(String(message.localId))))
const rowsFor = page => props.messages.filter(message => page.ids.includes(String(message.localId)))
const captureAnchor = () => {
  if (!props.scroller || !root.value) return null
  const box = props.scroller, bounds = box.getBoundingClientRect()
  const row = [...root.value.querySelectorAll('[data-history-row]')].find(node => {
    const rect = node.getBoundingClientRect()
    return rect.bottom > bounds.top && rect.top < bounds.bottom
  })
  if (row) return { id: row.dataset.historyRow, key: row.closest('[data-history-page]')?.dataset.historyPage, top: row.getBoundingClientRect().top }
  // When an evicted page is being reloaded there is no row DOM to anchor yet.
  const origin = root.value.getBoundingClientRect().top - bounds.top + box.scrollTop
  const page = historyWindowAnchor(descriptors.value, box.scrollTop - origin, box.clientHeight)
  return page ? { key: page.key, page } : null
}
const restoreAnchor = () => {
  if (!savedAnchor || !props.scroller || !root.value) return
  const box = props.scroller
  if (savedAnchor.page) {
    const offset = historyWindowAnchorTop(descriptors.value, savedAnchor.page, box.clientHeight)
    const origin = root.value.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
    if (offset !== null) box.scrollTop = origin + offset
    return
  }
  const row = [...root.value.querySelectorAll('[data-history-row]')].find(node => node.dataset.historyRow === savedAnchor.id)
  if (row) box.scrollTop += row.getBoundingClientRect().top - savedAnchor.top
}
const publish = async () => {
  if (settlingAnchor.value || disposed || !props.scroller || !root.value || !props.pages.length) return
  const box = props.scroller, height = Math.max(1, box.clientHeight)
  const origin = root.value.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop
  const pinned = new Set(props.pages.filter(page => page.ids.some(id => props.pinnedIds.includes(id))).map(page => page.key))
  const selection = globalThis.getSelection?.()
  for (const [key, node] of nodes) {
    if (node.querySelector('details[open], dialog[open], .is-streaming, [data-history-pin]') || node.contains(document.activeElement) ||
      (selection && !selection.isCollapsed && (node.contains(selection.anchorNode) || node.contains(selection.focusNode)))) pinned.add(key)
  }
  view.value = { top: Math.max(0, box.scrollTop - origin), height, pinned }
  const retained = new Set(segments.value.filter(segment => !segment.spacer).map(segment => segment.key))
  // Grouped child answers are owned by their page even while displayed under a parent.
  const linkedIds = new Set(segments.value.filter(segment => !segment.spacer).flatMap(segment => rowsFor(segment.page)
    .flatMap(message => (message.turnDeliveries || []).map(row => String(row.localId)))))
  for (const page of props.pages) if (page.ids.some(id => linkedIds.has(id))) retained.add(page.key)
  const signature = [...retained].sort().join('|')
  if (signature !== retentionSignature || props.pages.some(page => page.loaded && !retained.has(page.key))) { retentionSignature = signature; emit('retain', [...retained]) }
  for (const key of retained) {
    const page = props.pages.find(page => page.key === key)
    if (page && !page.gap && !page.loaded && !props.loading.has(key) && !props.errors[key]) emit('load', key)
  }
  await nextTick()
  if (!disposed) savedAnchor = captureAnchor()
}
const schedule = () => {
  if (frame || disposed || !props.pages.length) return
  frame = requestAnimationFrame(() => { frame = 0; void publish() })
}
const onScroll = () => { if (!settlingAnchor.value) savedAnchor = captureAnchor(); schedule() }
const measure = async () => {
  const next = { ...heights.value }
  let changed = false
  for (const [key, node] of nodes) {
    if (!props.pages.find(page => page.key === key)?.loaded) continue
    const height = Math.max(1, node.getBoundingClientRect().height)
    if (next[key] !== height) { next[key] = height; changed = true }
  }
  if (!changed) return
  heights.value = next
  await nextTick()
  restoreAnchor(); schedule()
}
const bindPage = (key, node) => {
  const previous = nodes.get(key)
  if (previous === node) return
  if (previous) observer?.unobserve(previous)
  if (node) { nodes.set(key, node); observer?.observe(node) } else nodes.delete(key)
}
watch(() => props.scroller, (box, previous) => {
  previous?.removeEventListener('scroll', onScroll)
  observer?.disconnect()
  observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { void measure(); schedule() }) : null
  if (box) { box.addEventListener('scroll', onScroll, { passive: true }); observer?.observe(box) }
  for (const node of nodes.values()) observer?.observe(node)
  schedule()
}, { flush: 'post' })
watch(() => props.pinnedIds, schedule)
// Capture against the old DOM before a prepend/reload changes page geometry.
// Keep that page mounted until scroll restoration; retention must not evict it first.
watch(() => props.pages.map(page => `${page.key}:${page.loaded}`).join('|'), async () => {
  const anchor = captureAnchor()
  settlingAnchor.value = anchor
  savedAnchor = anchor
  await nextTick()
  await measure()
  if (disposed || settlingAnchor.value !== anchor) return
  restoreAnchor()
  settlingAnchor.value = null
  await publish()
}, { flush: 'pre' })
watch(() => props.scope, () => {
  settlingAnchor.value = null; savedAnchor = null; retentionSignature = ''; heights.value = {}; view.value = { top: 0, height: 1, pinned: new Set() }
  schedule()
})
onBeforeUnmount(() => {
  disposed = true; if (frame) cancelAnimationFrame(frame)
  observer?.disconnect(); props.scroller?.removeEventListener('scroll', onScroll); nodes.clear()
})
</script>

<style scoped>
.history-window, .history-window-page { display: flow-root; overflow-anchor: none; }
.history-empty-page { min-height: 3em; color: #765f40; }
.history-window-placeholder { box-sizing: border-box; padding: 16px; color: #765f40; }
</style>
