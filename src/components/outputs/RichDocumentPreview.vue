<template>
  <section class="rich-document-preview">
    <p class="rich-document-note">静态文档预览：脚本、链接跳转和外部资源已禁用；可下载原文件查看完整内容。</p>
    <p v-if="!text" role="status">文件内容为空。</p>
    <iframe
      v-else
      :title="title || '文档预览'"
      :srcdoc="source"
      sandbox=""
      referrerpolicy="no-referrer"
    ></iframe>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { richDocumentSource } from '../../utils/richDocumentPreview.js'
const props = defineProps({ text: { type: String, default: '' }, kind: { type: String, required: true }, title: { type: String, default: '' } })
const source = computed(() => richDocumentSource(props.text, props.kind))
</script>

<style scoped>
.rich-document-preview { width: 100%; min-width: 0; }
.rich-document-preview iframe { display: block; width: 100%; height: 360px; border: 1px solid var(--hall-line, #deddd6); border-radius: 6px; background: white; box-sizing: border-box; }
.rich-document-note { color: var(--hall-muted, #69756d); font-size: 12px; margin: 0 0 8px; }
</style>
