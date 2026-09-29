<template>
  <aside
    v-if="presentation"
    class="bounty-deliberation-status"
    aria-live="polite"
    aria-label="悬赏议事 v2 状态"
  >
    <strong>{{ presentation.title }}</strong>
    <span>类型：{{ presentation.route }} · 状态：{{ presentation.state }}</span>
    <p>{{ presentation.phase }}</p>
    <small>{{ presentation.mediaNotice }}</small>
  </aside>
</template>

<script setup>
defineProps({ presentation: { type: Object, default: null } })
</script>

<style scoped>
.bounty-deliberation-status {
  display: grid;
  gap: 4px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(35, 72, 62, 0.16);
  background: #fff7df;
  color: #573e16;
  font-size: 12px;
  line-height: 1.45;
}
.bounty-deliberation-status strong { font-size: 13px; }
.bounty-deliberation-status p,
.bounty-deliberation-status small { margin: 0; }
.bounty-deliberation-status small { color: #765d2f; }
</style>
