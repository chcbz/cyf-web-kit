<template>
  <span class="material-thumbnail" aria-hidden="true">
    <img
      v-if="imageUrl"
      :src="imageUrl"
      alt=""
      @error="imageFailed = true"
    />
    <svg
      v-else
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
    ><path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6" /></svg>
  </span>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { usePersonalWorkspace } from '@/composables/usePersonalWorkspace'

const props = defineProps({
  fileId: { type: String, required: true },
  version: { type: String, required: true },
  identityKey: { type: String, required: true }
})
// Each card owns its preview URLs: opening the full preview must not revoke thumbnails.
const context = computed(() => `${props.identityKey}\u0000${props.fileId}\u0000${props.version}`)
const workspace = usePersonalWorkspace({ identityEpoch: context })
const imageFailed = ref(false)
const imageUrl = computed(() => !imageFailed.value && workspace.preview.value?.kind === 'image' ? workspace.preview.value.url : '')
watch(context, async key => {
  imageFailed.value = false
  const detail = await workspace.select(props.fileId)
  if (key !== context.value) return
  const version = detail?.versions?.find(item => item.version === props.version)
  if (version?.contentMimeType?.startsWith('image/')) await workspace.previewVersion(props.version)
}, { immediate: true })
</script>

<style scoped>
.material-thumbnail { display: flex; align-items: center; justify-content: center; flex: 0 0 40px; width: 40px; height: 40px; background: var(--hall-surface-muted, #f5f4f0); border-radius: 6px; }
.material-thumbnail img { width: 100%; height: 100%; object-fit: contain; }
.material-thumbnail svg { width: 24px; height: 24px; }
</style>
