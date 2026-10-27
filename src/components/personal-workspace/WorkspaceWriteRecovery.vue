<template>
  <section
    v-if="pending.length"
    class="workspace-write-recovery"
    aria-label="待确认的资料操作"
    aria-live="polite"
  >
    <div v-for="item in pending" :key="item.target">
      <p>{{ item.label }}：{{ item.state === 'SENDING' ? '正在提交…' : item.state === 'PROCESSING' ? '正在处理，请勿重复提交。' : '结果尚未确认，请查询结果，不要重复提交。' }}</p>
      <button type="button" :disabled="item.state === 'SENDING'" @click="$emit('retry', item.target)">继续核对</button>
    </div>
    <p>请先核对这次操作，再刷新或关闭页面；刷新后将无法在此继续恢复。</p>
  </section>
</template>

<script setup>
defineProps({ pending: { type: Array, default: () => [] } })
defineEmits(['retry'])
</script>

<style scoped>
.workspace-write-recovery { padding: 12px; border: 1px solid var(--hall-border, #e3e5dc); border-radius: 4px; color: var(--hall-text, #242e2b); background: var(--hall-surface-subtle, #f3f3ed); }
.workspace-write-recovery p { margin: 0 0 8px; overflow-wrap: anywhere; }
</style>
