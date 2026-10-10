<template>
  <section class="private-discussion-panel discussion-panel">
    <ChatPanel
      @update:draft="$emit('update:draft', $event)"
      discussion-variant="private"
      empty-text="尚无密议记录，可先问一声眼下动静。"
      placeholder="向当前好汉传一句话"
      :show-target-picker="false"
      :subtitle="privateSubtitle"
      title="密议"
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
import { computed } from 'vue'
import ChatPanel from './ChatPanel.vue'
import { discussionPanelProps, discussionPanelEmits } from './discussionPanelContract.js'

const props = defineProps(discussionPanelProps)

defineEmits(discussionPanelEmits)

const privateSubtitle = computed(() => {
  if (props.selectedTask?.title) return `${props.targetText} / ${props.selectedTask.title}`
  return props.targetText || '当前好汉'
})

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
