<template>
  <section aria-label="正式成果办理">
    <p v-if="!source">返工前请进入本榜文议事，并明确选定已指派好汉；不会使用私人会话或其他榜文成果。</p>
    <button v-if="!source" type="button" @click="$emit('discuss-task')">进入本榜文议事</button>
    <p v-else>返工承办人：{{ executionContext.targetAgentId }} · 使用本榜文议事中的固定成果版本。</p>
    <p v-if="source && ['unavailable', 'forbidden', 'syncing'].includes(outputs.state.value)" role="status">{{ outputs.message.value }}</p>
    <FormalDeliveryList
      :key="`${taskId}:${identityFingerprint}:${source?.id || ''}:${selectedAgentId}`"
      :task-id="taskId"
      :identity-fingerprint="identityFingerprint"
      :focus-delivery-id="focusDeliveryId"
      :conversation-id="source?.id || ''"
      :target-agent-id="source ? executionContext.targetAgentId : ''"
      :outputs="source ? outputs.items.value : []"
      :adapter="deliveryAdapter"
      @refreshed="outputs.refresh()"
      @rework-created="$emit('rework-created', $event)"
    />
  </section>
</template>

<script setup>
import { computed } from 'vue'
import FormalDeliveryList from './FormalDeliveryList.vue'
import { useOutputs } from '../../composables/useOutputs.js'

const props = defineProps({
  taskId: { type: String, required: true },
  identityFingerprint: { type: String, required: true },
  focusDeliveryId: { type: String, default: '' },
  executionContext: { type: Object, default: () => ({}) },
  selectedAgentId: { type: String, default: '' },
  outputAdapter: { type: Object, default: undefined },
  deliveryAdapter: { type: Object, default: undefined }
})
defineEmits(['discuss-task', 'rework-created'])
// The Hall proves the task/conversation/assignment relationship. Viewing a
// delivery alone must never choose an actor or borrow an unrelated conversation.
const source = computed(() => {
  const scope = props.executionContext
  return props.identityFingerprint && scope.taskId === props.taskId && scope.conversationConfirmed === true &&
    scope.conversationId && scope.targetAgentId && scope.targetAgentId === props.selectedAgentId
    ? { type: 'conversation', id: scope.conversationId } : null
})
const outputs = useOutputs({
  source, taskId: () => props.taskId, identityFingerprint: () => props.identityFingerprint,
  adapter: props.outputAdapter, pageSize: 100
})
</script>
