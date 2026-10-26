<template>
  <section
    v-if="pending.length"
    class="workspace-write-recovery"
    aria-label="待确认的资料操作"
    aria-live="polite"
  >
    <div v-for="item in pending" :key="item.target">
      <p>{{ item.label }}：{{ item.state === 'SENDING' ? '正在提交原操作…' : item.state === 'PROCESSING' ? '服务端仍在处理，请勿重复新建。' : '提交结果尚未确认，请继续原操作核对结果，勿重复新建。' }}</p>
      <button type="button" :disabled="item.state === 'SENDING'" @click="$emit('retry', item.target)">继续原操作</button>
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
