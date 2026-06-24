<template>
  <div class="library-panel">
    <form class="library-search" @submit.prevent="$emit('search-library')">
      <input
        :value="keyword"
        placeholder="查项目案卷、议事旧录、往日回报"
        @input="$emit('update:keyword', $event.target.value)"
      />
      <select :value="sourceType" @change="$emit('update:sourceType', $event.target.value)">
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
      <article v-for="item in results" :key="item.id || item.conversationId || item.content" class="result-card">
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
        <button type="button" @click="$emit('cite-library', item)">引入传令</button>
      </article>
      <div v-if="errorMessage" class="empty-list error-list">
        {{ errorMessage }}
      </div>
      <div v-else-if="!results.length" class="empty-list">
        {{ hasSearched ? '暂未查得案卷' : '输入关键词后查阅藏书阁。' }}
      </div>
    </div>
  </div>
</template>

<script setup>
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
  display: flex;
  flex: 1;
  min-height: 0;
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
  background: #fffdf6;
  color: #3f2815;
  outline: none;
}

.library-search button,
.result-card button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 12px;
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
  flex: 1;
  min-height: 0;
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

@media (max-width: 720px) {
  .library-search {
    grid-template-columns: 1fr;
  }
}
</style>
