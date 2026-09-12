<template>
  <article class="output-card" :class="{ 'is-targeted': highlighted }">
    <div class="output-card-heading">
      <div>
        <strong>{{ item.title || item.name || '未命名成果' }}</strong>
        <small>{{ item.name || item.mime || '成果文件' }}</small>
      </div>
      <span class="output-state" :class="`state-${String(item.state || '').toLowerCase()}`">{{ stateText }}</span>
    </div>
    <p>{{ publicationText }} · 版本 {{ item.version }}</p>
    <p>{{ sizeText }}<template v-if="createdText"> · {{ createdText }}</template></p>
    <p v-if="item.producerName">产出：{{ item.producerName }}</p>
    <p v-if="stateHint" class="state-hint">{{ stateHint }}</p>
    <div class="output-actions">
      <button
        v-if="item.previewKind !== 'NONE'"
        type="button"
        :disabled="item.state !== 'AVAILABLE'"
        @click="$emit('preview', item)"
      >预览</button>
      <button type="button" :disabled="downloadDisabled" @click="$emit('download', item)">下载</button>
      <button v-if="showHistory" type="button" @click="$emit('versions', item)">历史版本</button>
      <button v-if="showResourceRoute" type="button" @click="$emit('resource-route', item)">复制取件地址</button>
    </div>
  </article>
</template>
<script setup>
import { computed } from 'vue'

const props = defineProps({
  item: { type: Object, required: true },
  highlighted: { type: Boolean, default: false },
  showHistory: { type: Boolean, default: true },
  showResourceRoute: { type: Boolean, default: false }
})
defineEmits(['preview', 'download', 'versions', 'resource-route'])

const stateLabels = {
  AVAILABLE: '可下载',
  EXPIRED: '已过期',
  UNAVAILABLE: '暂不可用',
  EXTERNAL_UNVERIFIED: '外部文件未验证'
}
const stateHints = {
  EXPIRED: '文件已过期，无法下载。',
  UNAVAILABLE: '文件暂不可用，请稍后刷新。',
  EXTERNAL_UNVERIFIED: '外部文件尚未完成验证，暂不提供下载。'
}
const publicationText = computed(() => props.item.publicationKind === 'OWNER_SHARE' ? '已分享，未正式验收' : '会话共享成果')
const stateText = computed(() => stateLabels[props.item.state] || '状态未知')
const stateHint = computed(() => stateHints[props.item.state] || '')
const downloadDisabled = computed(() => props.item.state !== 'AVAILABLE' || props.item.canDownload !== true)
const sizeText = computed(() => {
  const bytes = Number(props.item.size)
  if (!Number.isFinite(bytes) || bytes < 0) return '大小未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`
})
const createdText = computed(() => {
  const raw = props.item.createdAt
  const millis = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw)
  if (!Number.isFinite(millis)) return ''
  return new Date(millis).toLocaleString('zh-CN', { hour12: false })
})
</script>
<style scoped>
.output-card { padding: 9px; border: 1px solid #e4d8c7; border-radius: 7px; background: #fffdf8; }
.output-card + .output-card { margin-top: 7px; }
.output-card.is-targeted { border-color: #9b642e; box-shadow: 0 0 0 2px rgba(155, 100, 46, .14); }
.output-card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.output-card strong,.output-card small { display:block; }
.output-card small,.output-card p { margin:3px 0; color:#765f40; font-size:12px; }
.output-state { flex: 0 0 auto; color: #5b482f; font-size: 12px; }
.state-expired,.state-unavailable,.state-external_unverified,.state-hint { color: #9b3a28; }
.output-actions { display:flex; flex-wrap: wrap; gap:6px; }
.output-actions button { margin: 0; padding:3px 8px; border:1px solid #b99862; border-radius:4px; background:#fff8eb; }
</style>
