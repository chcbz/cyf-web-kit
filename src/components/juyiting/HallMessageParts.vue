<template>
  <div v-if="parts?.length" class="message-parts" aria-label="会话多媒体内容">
    <section
      v-for="part in parts"
      :key="part.partId"
      class="message-part"
      :data-part-id="part.partId"
    >
      <p v-if="part.kind === 'text'" class="part-text">{{ part.text }}</p>
      <template v-else>
        <span class="part-title">{{ part.filename || (part.kind === 'image' ? '图片' : part.kind === 'audio' ? '音频' : '文件') }}</span>
        <span v-if="part.state === 'processing'">正在准备内容…</span>
        <span v-else-if="part.state === 'failed'" role="alert">这份内容未能生成，请在会话中继续说明。</span>
        <template v-else-if="part.state === 'ready'">
          <HallMessageMedia :part="part" :conversation-id="conversationId" :identity-key="identityKey" />
        </template>
      </template>
      <div v-if="canSaveToWorkspace(part)" class="part-archive">
        <button
          type="button"
          class="part-save-button"
          :disabled="archiveStatus(part).busy || archiveStatus(part).state === 'saved'"
          @click="saveToWorkspace(part)"
        >{{ archiveStatus(part).state === 'saved' ? '已保存到工作空间' : archiveStatus(part).busy ? '正在确认保存…' : ['pending', 'saving', 'unknown', 'partial_failed'].includes(archiveStatus(part).state) ? '继续原保存' : '保存到工作空间' }}</button>
        <p v-if="archiveStatus(part).message" :class="{ 'part-archive-error': ['error', 'unknown', 'partial_failed'].includes(archiveStatus(part).state) }" :role="['error', 'unknown', 'partial_failed'].includes(archiveStatus(part).state) ? 'alert' : 'status'">{{ archiveStatus(part).message }}</p>
        <button
          v-if="archiveStatus(part).operationId && ['pending', 'saving', 'unknown', 'error', 'partial_failed'].includes(archiveStatus(part).state) && !archiveStatus(part).busy"
          type="button"
          class="part-archive-refresh"
          @click="refreshArchiveStatus(part)"
        >查询保存状态</button>
      </div>
    </section>
  </div>
</template>
<script setup>
import HallMessageMedia from './HallMessageMedia.vue'
import { useHallConversationArchive } from '../../composables/juyiting/useHallConversationArchive.js'
import { revisionOf } from '../../composables/juyiting/hallMessageParts.js'

const props = defineProps({ parts: { type: Array, default: () => [] }, conversationId: { type: String, default: '' }, identityKey: { type: String, default: '' }, identityScope: { type: String, default: '' } })
const archives = useHallConversationArchive({ conversationId: () => props.conversationId, identityEpoch: () => props.identityKey, identityScope: () => props.identityScope })
const canSaveToWorkspace = part => part?.state === 'ready' && typeof part?.assetId === 'string' && part.assetId.length > 0 && Boolean(revisionOf(part?.revision))
const archiveStatus = part => archives.statusFor(part)
const saveToWorkspace = part => { void archives.save(part) }
const refreshArchiveStatus = part => { void archives.check(part) }
</script>
<style scoped>
.message-parts { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0; }
.message-part { display: flex; flex-direction: column; gap: 6px; min-width: 135px; max-width: 100%; padding: 8px; border: 1px solid #c9d9d2; border-radius: 8px; background: #f7fbf7; overflow-wrap: anywhere; }
.part-text { white-space: pre-wrap; margin: 0; }
.part-title { font-weight: 600; }
.part-archive { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.part-archive button { min-height: 34px; padding: 5px 9px; border: 1px solid #547567; border-radius: 6px; background: #fffefa; color: #315746; cursor: pointer; }
.part-archive button:disabled { opacity: .65; cursor: not-allowed; }
.part-archive p { flex-basis: 100%; margin: 0; color: #597067; font-size: 12px; line-height: 1.45; }
.part-archive .part-archive-error { color: #9e372c; }
</style>
