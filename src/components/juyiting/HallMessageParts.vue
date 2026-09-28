<template>
  <div v-if="parts?.length" class="message-parts" aria-label="会话多媒体内容">
    <section v-for="part in parts" :key="part.partId" class="message-part" :data-part-id="part.partId">
      <p v-if="part.kind === 'text'" class="part-text">{{ part.text }}</p>
      <template v-else>
        <span class="part-title">{{ part.filename || (part.kind === 'image' ? '图片' : part.kind === 'audio' ? '音频' : '文件') }}</span>
        <span v-if="part.state === 'processing'">正在准备内容…</span>
        <span v-else-if="part.state === 'failed'" role="alert">这份内容未能生成，可继续议事或重试办理。</span>
        <template v-else-if="part.state === 'ready'">
          <HallMessageMedia :part="part" :conversation-id="conversationId" :identity-key="identityKey" />
        </template>
      </template>
    </section>
  </div>
</template>
<script setup>
import HallMessageMedia from './HallMessageMedia.vue'
defineProps({ parts: { type: Array, default: () => [] }, conversationId: { type: String, default: '' }, identityKey: { type: String, default: '' } })
</script>
<style scoped>
.message-parts { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0; }
.message-part { display: flex; flex-direction: column; gap: 6px; min-width: 135px; max-width: 100%; padding: 8px; border: 1px solid #c9d9d2; border-radius: 8px; background: #f7fbf7; overflow-wrap: anywhere; }
.part-text { white-space: pre-wrap; margin: 0; }
.part-title { font-weight: 600; }
</style>
