<template>
  <section class="bounty-acceptance-panel" aria-label="本次成果与验收">
    <header class="acceptance-heading">
      <h3>{{ taskCompleted ? '事项成果' : '本次成果' }}</h3>
      <button v-if="reviewContext?.currentDelivery?.allowedActions.includes('ACCEPT')" type="button" :disabled="reviewBusy" @click="$emit('review-delivery')">查看成果并验收</button>
    </header>
    <p v-if="reviewLoading" role="status">正在核对正式交付…</p>
    <p v-if="reviewError" role="alert">{{ reviewError }} <button type="button" @click="$emit('refresh-review')">重新读取</button></p>
    <section v-if="reviewContext?.currentDelivery" aria-label="当前正式交付">
      <p>{{ reviewContext.currentDelivery.summary }}</p>
      <ul><li v-for="item in reviewContext.currentDelivery.items.filter(value => value.displayRole === 'RESULT')" :key="`${item.artifactId}:${item.artifactVersion}`">
        <span>{{ item.purpose }} · 版本 {{ item.artifactVersion }}</span>
        <button type="button" :disabled="!!item.unavailableReason" @click="$emit('preview-output', item)">预览</button>
        <small v-if="item.unavailableReason">原成果来源暂不可用。</small>
      </li></ul>
    </section>
    <p v-else-if="reviewContext && !reviewLoading" role="status">暂无当前正式交付；议事中的普通答复不代表已提交成果。</p>
    <details v-if="reviewContext" @toggle="$event.target.open && $emit('open-history')"><summary>历史交付（已加载 {{ reviewContext.history.length }} 批）</summary>
      <section v-for="batch in reviewContext.history" :key="batch.deliveryId"><p>{{ batch.summary }} · {{ batch.state }}</p>
        <ul><li v-for="item in batch.items.filter(value => value.displayRole === 'RESULT')" :key="`${item.artifactId}:${item.artifactVersion}`">
          <span>{{ item.purpose }} · 版本 {{ item.artifactVersion }}</span><button type="button" :disabled="!!item.unavailableReason" @click="$emit('preview-output', item)">预览</button>
        </li></ul>
      </section>
      <p v-if="historyLoading" role="status">正在读取历史交付…</p>
      <p v-if="historyError" role="alert">{{ historyError }}</p>
      <button
        v-if="historyError || !historyLoaded || historyHasMore"
        type="button"
        :disabled="historyLoading || reviewLoading"
        @click="$emit('load-history')"
      >{{ historyError ? '重试当前页' : historyLoaded ? '加载更多历史交付' : '读取历史交付' }}</button>
      <p v-else-if="!reviewContext.history.length" role="status">没有其他历史交付。</p>
    </details>
    <p role="status">此处只展示正式交付；未提交的成果和修改记录请回原议事查看。</p>
    <p v-if="source.loading.value" role="status">正在确认原议事入口…</p>
    <p v-else-if="source.error.value" role="alert">{{ source.error.value }} <button type="button" @click="source.refresh">重新读取</button></p>
    <slot name="preview" />
    <button type="button" @click="$emit('continue-modification', source.scope.value)">{{ taskCompleted ? '查看议事记录' : '继续议事' }}</button>
  </section>
</template>
<script setup>
import { createApi } from '../../composables/useHttp.js'
import { useHallBountyAcceptance } from '../../composables/juyiting/useHallBountyAcceptance.js'
const props = defineProps({
  historyLoaded: { type: Boolean, default: true }, historyLoading: { type: Boolean, default: false },
  historyHasMore: { type: Boolean, default: false }, historyError: { type: String, default: '' },
  reviewContext: { type: Object, default: null }, reviewBusy: { type: Boolean, default: false },
  reviewLoading: { type: Boolean, default: false }, reviewError: { type: String, default: '' },
  enabled: { type: Boolean, default: true }, taskId: { type: String, required: true }, identityKey: { type: String, required: true }, taskCompleted: { type: Boolean, default: false },
  taskVersion: { type: [Number, String], default: '' }, conversationId: { type: String, default: '' } })
defineEmits(['open-history', 'load-history', 'continue-modification', 'review-delivery', 'refresh-review', 'preview-output'])
const source = useHallBountyAcceptance({ api: createApi('/chat'), taskId: () => props.taskId,
  // The parent owns formal review facts; only discover the original conversation here.
  loadRequests: false,
  identityKey: () => props.identityKey, conversationId: () => props.conversationId, enabled: () => props.enabled,
  taskCompleted: () => props.taskCompleted })
</script>
<style scoped>
.bounty-acceptance-panel { flex: 1; min-height: 0; overflow: auto; padding: 12px; background: var(--hall-surface, #fffefa); color: var(--hall-text, #242e2b); }
.acceptance-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--hall-border-strong, #ccd2c5); border-radius: 7px; background: transparent; color: inherit; font: inherit; }
button:focus-visible { outline: 3px solid var(--hall-focus-ring, #923f3052); outline-offset: 2px; }
ul { padding: 0; list-style: none; }
li { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
li span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
</style>
