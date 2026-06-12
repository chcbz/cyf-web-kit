<template>
  <div class="library-panel">
    <form class="library-search" @submit.prevent="$emit('search-library')">
      <input
        :value="keyword"
        placeholder="查项目资料、议事纪要、历史回报"
        @input="$emit('update:keyword', $event.target.value)"
      />
      <select :value="sourceType" @change="$emit('update:sourceType', $event.target.value)">
        <option value="">全部资料</option>
        <option value="project">项目资料</option>
        <option value="meeting">议事纪要</option>
        <option value="memory">长期记忆</option>
      </select>
      <button :disabled="loading || !keyword.trim()">
        <var-icon name="magnify" />
        <span>检索</span>
      </button>
    </form>

    <div class="library-hint">
      <span>向量检索</span>
      <span>命中 {{ results.length }} 条</span>
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
          <span v-if="item.conversationId">会话 {{ item.conversationId }}</span>
          <span v-if="item.timestamp">{{ formatTime(item.timestamp) }}</span>
        </div>
        <button type="button" @click="$emit('cite-library', item)">引用到传令</button>
      </article>
      <div v-if="!results.length" class="empty-list">
        输入关键词后检索藏经阁资料。
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  formatTime: { type: Function, required: true },
  keyword: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  results: { type: Array, default: () => [] },
  sourceType: { type: String, default: '' }
})

defineEmits(['cite-library', 'search-library', 'update:keyword', 'update:sourceType'])

const sourceText = (type = '') => {
  if (type === 'project') return '项目资料'
  if (type === 'meeting') return '议事纪要'
  if (type === 'conversation') return '议事纪要'
  if (type === 'daily_summary') return '日汇总'
  if (type === 'weekly_summary') return '周汇总'
  if (type === 'monthly_summary') return '月汇总'
  return '长期记忆'
}

const scoreText = (score) => {
  if (score === undefined || score === null) return '相关'
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

@media (max-width: 720px) {
  .library-search {
    grid-template-columns: 1fr;
  }
}
</style>
