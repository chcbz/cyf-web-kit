<template>
  <div class="library-panel">
    <div
      class="library-tabs"
      role="tablist"
      aria-label="案卷阁入口"
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
    </div>

    <ArchiveReader
      v-if="activeTab === 'reader'"
      id="library-reader-panel"
      role="tabpanel"
      aria-labelledby="library-reader-tab"
    />

    <div
      v-else
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
import { nextTick, ref } from 'vue'
import ArchiveReader from './archive/ArchiveReader.vue'

const activeTab = ref('reader')
const readerTab = ref(null)
const searchTab = ref(null)
const tabOrder = ['reader', 'search']

const focusTab = async (tab) => {
  activeTab.value = tab
  await nextTick()
  const element = tab === 'reader' ? readerTab.value : searchTab.value
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
  errorMessage: { type: String, default: '' },
  formatTime: { type: Function, required: true },
  hasSearched: { type: Boolean, default: false },
  keyword: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  results: { type: Array, default: () => [] },
  sourceType: { type: String, default: '' }
})

defineEmits(['cite-library', 'search-library', 'update:keyword', 'update:sourceType'])

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
.library-panel {
  container-type: inline-size;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}

button,
input,
select {
  font: inherit;
}

button {
  border: 0;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.library-tabs {
  display: flex;
  gap: 8px;
}

.library-tabs button {
  padding: 7px 10px;
  border-radius: 7px;
  background: #eadabb;
  color: #3f2815;
}

.library-tabs button.active {
  background: #23483e;
  color: #fff8e8;
}

.library-search-tab {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
}

.library-search {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 132px auto;
  gap: 8px;
}

.library-search input,
.library-search select {
  min-width: 0;
  height: 38px;
  padding: 0 10px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  outline: none;
  background: #fffdf6;
  color: #3f2815;
}

.library-search button,
.result-card button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 12px;
  gap: 6px;
  border-radius: 8px;
  background: #23483e;
  color: #fff8e8;
}

.library-hint {
  display: flex;
  justify-content: space-between;
  color: #765f40;
  font-size: 13px;
}

.result-list {
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.result-card {
  margin-bottom: 10px;
  padding: 12px;
  border-radius: 8px;
  background: #fff8e8;
  color: #3f2815;
}

.result-head,
.result-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.result-head small,
.result-meta {
  color: #8a6f4b;
  font-size: 12px;
}

.result-card p {
  margin: 8px 0;
  color: #4a3423;
  line-height: 1.6;
}

.result-meta {
  justify-content: flex-start;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.empty-list {
  padding: 24px;
  border-radius: 8px;
  background: #fff8e8;
  color: #8a6f4b;
  text-align: center;
}

.error-list {
  color: #9b2f26;
}

@container (max-width: 520px) {
  .library-search {
    grid-template-columns: 1fr;
  }
}
</style>
