<template>
  <div class="library-panel">
    <div
      v-show="!readerHasBack"
      class="library-tabs"
      role="tablist"
      aria-label="典籍阁入口"
    >
      <button
        id="library-reader-tab"
        ref="readerTab"
        type="button"
        role="tab"
        :tabindex="activeTab === 'reader' ? 0 : -1"
        :aria-selected="activeTab === 'reader'"
        aria-controls="library-reader-panel"
        :class="{ active: activeTab === 'reader' }"
        @click="activeTab = 'reader'"
        @keydown="handleTabKeydown($event, 'reader')"
      >
        典籍阅读
      </button>
      <button
        id="library-search-tab"
        ref="searchTab"
        type="button"
        role="tab"
        :tabindex="activeTab === 'search' ? 0 : -1"
        :aria-selected="activeTab === 'search'"
        aria-controls="library-search-panel"
        :class="{ active: activeTab === 'search' }"
        @click="activeTab = 'search'"
        @keydown="handleTabKeydown($event, 'search')"
      >
        案卷检索
      </button>
      <button id="library-maintenance-tab" ref="maintenanceTab" type="button" role="tab"
        :tabindex="activeTab === 'maintenance' ? 0 : -1"
        :aria-selected="activeTab === 'maintenance'" aria-controls="library-maintenance-panel"
        :class="{ active: activeTab === 'maintenance' }"
        @click="activeTab = 'maintenance'" @keydown="handleTabKeydown($event, 'maintenance')">
        任职与维护
      </button>
    </div>

    <ArchiveReader
      v-show="activeTab === 'reader'"
      id="library-reader-panel"
      ref="readerRef"
      :embedded="embedded"
      :detail-allowed="detailAllowed"
      :active="active && activeTab === 'reader'"
      :inert="activeTab !== 'reader' ? '' : null"
      :aria-hidden="activeTab !== 'reader' ? 'true' : null"
      role="tabpanel"
      aria-labelledby="library-reader-tab"
      :virtual-landscape="virtualLandscape"
      @navigation-state="readerHasBack = $event"
      @start-draft="$emit('start-draft', $event)"
    />

    <ArchiveMaintenancePanel v-if="activeTab === 'maintenance'" id="library-maintenance-panel" ref="maintenancePanelRef" :gateway="archiveGateway"
      role="tabpanel" aria-labelledby="library-maintenance-tab" @open-maintenance-entry="$emit('open-maintenance-entry', $event)" @open-edition="openVerifiedEdition" />

    <div
      v-show="activeTab === 'search'"
      id="library-search-panel"
      role="tabpanel"
      aria-labelledby="library-search-tab"
      class="library-search-tab"
    >
      <form
        class="library-search"
        @submit.prevent="$emit('search-library')"
      >
        <input
          :value="keyword"
          aria-label="案卷检索关键词"
          placeholder="查项目案卷、议事旧录、往日回报"
          @input="$emit('update:keyword', $event.target.value)"
        />
        <select
          :value="sourceType"
          aria-label="案卷来源"
          @change="$emit('update:sourceType', $event.target.value)"
        >
          <option value="">全部案卷</option>
          <option value="project">项目案卷</option>
          <option value="meeting">议事旧录</option>
          <option value="memory">长记</option>
        </select>
        <button :disabled="loading || !keyword.trim()">
          <var-icon name="magnify" />
          <span>查卷</span>
        </button>
      </form>

      <div class="library-hint">
        <span>藏书查卷</span>
        <span>得 {{ results.length }} 条</span>
      </div>

      <div class="result-list">
        <article
          v-for="item in results"
          :key="item.id || item.conversationId || item.content"
          class="result-card"
        >
          <div class="result-head">
            <strong>{{ item.title || sourceText(item.summaryType || item.sourceType) }}</strong>
            <small>{{ scoreText(item.score) }}</small>
          </div>
          <p>{{ item.content }}</p>
          <div class="result-meta">
            <span>{{ sourceText(item.summaryType || item.sourceType) }}</span>
            <span v-if="item.conversationId">话头 {{ item.conversationId }}</span>
            <span v-if="item.timestamp">{{ formatTime(item.timestamp) }}</span>
          </div>
          <button
            type="button"
            @click="$emit('cite-library', item)"
          >
            引入传令
          </button>
        </article>
        <div
          v-if="errorMessage"
          class="empty-list error-list"
        >
          {{ errorMessage }}
        </div>
        <div
          v-else-if="!results.length"
          class="empty-list"
        >
          {{ hasSearched ? '暂未查得案卷' : '输入关键词后查阅案卷阁。' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import ArchiveReader from './archive/ArchiveReader.vue'
import ArchiveMaintenancePanel from './archive/ArchiveMaintenancePanel.vue'

const activeTab = ref('reader')
const readerRef = ref(null)
const maintenancePanelRef = ref(null)
const readerHasBack = ref(false)
const canGoBack = computed(() => activeTab.value === 'reader' && readerHasBack.value)
const back = () => canGoBack.value ? readerRef.value?.back() : false
const openVerifiedEdition = async payload => { activeTab.value = 'reader'; await nextTick(); return readerRef.value?.openEdition?.(payload) }
const openMaintenanceJob = async ({ jobId } = {}) => {
  const exactJobId = typeof jobId === 'string' ? jobId.trim() : ''
  if (!exactJobId) return false
  activeTab.value = 'maintenance'
  await nextTick()
  return Boolean(await maintenancePanelRef.value?.openJobById?.(exactJobId))
}
defineExpose({ canGoBack, back, openMaintenanceJob, openVerifiedEdition })
const readerTab = ref(null)
const searchTab = ref(null)
const maintenanceTab = ref(null)
const tabOrder = ['reader', 'search', 'maintenance']

const focusTab = async (tab) => {
  activeTab.value = tab
  await nextTick()
  const element = tab === 'reader' ? readerTab.value : tab === 'search' ? searchTab.value : maintenanceTab.value
  element?.focus()
}

const handleTabKeydown = (event, currentTab) => {
  const currentIndex = tabOrder.indexOf(currentTab)
  let nextTab = null
  if (event.key === 'ArrowRight') nextTab = tabOrder[(currentIndex + 1) % tabOrder.length]
  if (event.key === 'ArrowLeft') nextTab = tabOrder[(currentIndex - 1 + tabOrder.length) % tabOrder.length]
  if (event.key === 'Home') nextTab = tabOrder[0]
  if (event.key === 'End') nextTab = tabOrder.at(-1)
  if (!nextTab) return
  event.preventDefault()
  focusTab(nextTab)
}

defineProps({
  embedded: { type: Boolean, default: false },
  archiveGateway: { type: Object, default: null },
  detailAllowed: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
  errorMessage: { type: String, default: '' },
  formatTime: { type: Function, required: true },
  hasSearched: { type: Boolean, default: false },
  keyword: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  results: { type: Array, default: () => [] },
  sourceType: { type: String, default: '' },
  virtualLandscape: Boolean
})

defineEmits(['start-draft', 'cite-library', 'open-maintenance-entry', 'search-library', 'update:keyword', 'update:sourceType'])

const sourceText = (type = '') => {
  if (type === 'project') return '项目案卷'
  if (type === 'meeting') return '议事旧录'
  if (type === 'conversation') return '议事旧录'
  if (type === 'daily_summary') return '日录'
  if (type === 'weekly_summary') return '周录'
  if (type === 'monthly_summary') return '月录'
  return '长记'
}

const scoreText = (score) => {
  if (score === undefined || score === null) return '相合'
  return `${Math.round(Number(score) * 100)}%`
}
</script>

<style scoped>
.library-panel { --library-ground: var(--work-ground, #f3f3ed); --library-paper: var(--work-paper, #fffefa); --library-ink: var(--work-ink, #242e2b); --library-muted: var(--work-muted, #68716b); --library-line: var(--work-line, #d8d8ce); --library-brand: var(--work-brand, #923f30); container-type: inline-size; display:flex; min-height:0; flex:1; flex-direction:column; gap:14px; padding:16px; overflow:hidden; background:var(--library-ground); color:var(--library-ink); }
button,input,select { font:inherit; } button { cursor:pointer; } button:disabled { cursor:not-allowed; opacity:.5; }
.library-tabs { display:flex; flex:0 0 auto; gap:0; min-height:44px; overflow-x:auto; border-bottom:1px solid var(--library-line); }
.library-tabs button { flex:none; min-height:44px; padding:0 12px; border:0; border-bottom:2px solid transparent; border-radius:0; background:transparent; color:var(--library-muted); white-space:nowrap; }
.library-tabs button.active { border-bottom-color:var(--library-brand); background:transparent; color:var(--library-brand); font-weight:500; }
.library-search-tab { display:flex; min-height:0; flex:1; flex-direction:column; gap:12px; }
.library-search { display:grid; grid-template-columns:minmax(180px,1fr) 132px auto; gap:10px; padding:12px; border:1px solid var(--library-line); border-radius:10px; background:var(--library-paper); }
.library-search input,.library-search select { min-width:0; height:44px; padding:0 12px; border:1px solid var(--library-line); border-radius:7px; outline:none; background:var(--library-paper); color:var(--library-ink); }
.library-search button,.result-card button { display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:0 14px; gap:6px; border:1px solid var(--library-brand); border-radius:7px; background:var(--library-brand); color:var(--library-paper); }
.library-hint { display:flex; justify-content:space-between; padding:0 2px; color:var(--library-muted); font-size:13px; }
.result-list { min-height:0; flex:1; overflow:auto; overscroll-behavior:contain; }
.result-card { margin-bottom:10px; padding:14px; border:1px solid var(--library-line); border-radius:10px; background:var(--library-paper); color:var(--library-ink); box-shadow:0 1px 2px rgba(36,46,43,.04); }
.result-head,.result-meta { display:flex; align-items:center; justify-content:space-between; gap:10px; }.result-head small,.result-meta { color:var(--library-muted); font-size:12px; }.result-card p { margin:8px 0; color:var(--library-ink); line-height:1.6; }.result-meta { justify-content:flex-start; margin-bottom:10px; flex-wrap:wrap; }
.empty-list { padding:24px; border:1px dashed var(--library-line); border-radius:10px; background:var(--library-paper); color:var(--library-muted); text-align:center; }.error-list { color:#9b2f26; }
@container (max-width:520px) { .library-panel { padding:12px 16px 16px; } .library-search { grid-template-columns:1fr; } .library-search button { width:100%; } }
</style>
