<template>
  <section class="public-discussion-panel discussion-panel">
    <ChatPanel
      @update:draft="$emit('update:draft', $event)"
      discussion-variant="public"
      empty-text="厅前暂无话头，先发一句请众好汉接话。"
      placeholder="向众好汉传话，或 @某位好汉"
      subtitle="厅前公议"
      title="厅前公议"
      v-bind="props"
      @cancel-deliberation="$emit('cancel-deliberation', $event)"
      @clear-target="$emit('clear-target', $event)"
      @delete-conversation="$emit('delete-conversation', $event)"
      @load-history="$emit('load-history')"
      @load-more-history="$emit('load-more-history')"
      @load-messages="$emit('load-messages')"
      @mention-agent="$emit('mention-agent', $event)"
      @new-conversation="$emit('new-conversation')"
      @open-workspace="$emit('open-workspace')"
      @retry-conversation="$emit('retry-conversation')"
      @select-conversation="$emit('select-conversation', $event)"
      @send-message="$emit('send-message')"
      @voice-apply="$emit('voice-apply', $event)"
    />
  </section>
</template>

<script setup>
import ChatPanel from './ChatPanel.vue'
import { discussionPanelProps, discussionPanelEmits } from './discussionPanelContract.js'

const props = defineProps({
  ...discussionPanelProps,
  scopeHint: { type: String, default: 'public' },
  targetText: { type: String, default: '众好汉' }
})

defineEmits(discussionPanelEmits)

</script>

<style scoped>
.discussion-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: #fffaf0;
}

</style>
