<template>
  <section class="artifact-transfer-panel" aria-labelledby="artifact-transfer-heading">
    <header><span>成果传输</span><h3 id="artifact-transfer-heading">上传或下载精确成果版本</h3></header>
    <p class="artifact-transfer-note">仅使用当前任务与明确好汉身份。上传上限 16 MiB，下载上限 64 MiB；不会自动重试或代为确认保存。</p>
    <p v-if="transfer.message" class="artifact-transfer-status" :class="`is-${transfer.state}`" role="status" aria-live="polite">{{ transfer.message }}</p>
    <p v-if="transfer.conflict" class="artifact-transfer-conflict" role="alert">版本冲突后请先手动刷新协作状态，再重新填写版本。</p>

    <form class="artifact-upload-form" @submit.prevent="transfer.publish">
      <h4>明确上传</h4>
      <label>成果标识 <input v-model.trim="transfer.draft.artifactId" maxlength="100" required></label>
      <label>成果类型 <input v-model.trim="transfer.draft.artifactType" maxlength="30" required></label>
      <label>标题 <input v-model.trim="transfer.draft.title" maxlength="255" required></label>
      <label>工作项（可选） <input v-model.trim="transfer.draft.workItemId" maxlength="100"></label>
      <label>前一版本 <input v-model.number="transfer.draft.expectedPreviousVersion" type="number" min="0" max="2147483646" step="1" required></label>
      <label>本次版本 <input v-model.number="transfer.draft.artifactVersion" type="number" min="1" max="2147483647" step="1" required></label>
      <label>可见范围
        <select v-model="transfer.draft.visibility"><option value="task_members">任务成员</option><option value="reviewer">审阅者</option><option value="private">私有</option></select>
      </label>
      <label>文件
        <input type="file" accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.zip,text/plain,text/markdown,text/csv,application/json,application/pdf,image/png,image/jpeg,application/zip" @change="onFile">
      </label>
      <p v-if="transfer.file">已选择：{{ transfer.file.name }}（{{ transfer.file.size }} bytes）</p>
      <div class="artifact-transfer-actions"><button type="submit" :disabled="!transfer.operable || ['publishing', 'downloading'].includes(transfer.state)">明确上传</button><button v-if="transfer.state === 'publishing'" type="button" @click="transfer.cancel">取消</button></div>
    </form>

    <section class="artifact-download-form" aria-labelledby="artifact-download-heading">
      <h4 id="artifact-download-heading">精确下载</h4>
      <label>成果标识 <input v-model.trim="transfer.download.artifactId" maxlength="100"></label>
      <label>成果版本 <input v-model.trim="transfer.download.artifactVersion" inputmode="numeric" pattern="[1-9][0-9]*"></label>
      <div class="artifact-transfer-actions"><button type="button" :disabled="!transfer.operable || ['publishing', 'downloading'].includes(transfer.state)" @click="transfer.downloadExact">下载指定版本</button><button v-if="transfer.state === 'downloading'" type="button" @click="transfer.cancel">取消</button></div>
      <ul v-if="transfer.artifacts.length" class="artifact-transfer-recent" aria-label="可见成果版本">
        <li v-for="artifact in transfer.artifacts" :key="`${artifact.artifactId}:${artifact.artifactVersion}`"><span>{{ artifact.title }} · v{{ artifact.artifactVersion }}</span><button type="button" @click="transfer.selectDownload(artifact)">填入下载</button><button type="button" @click="transfer.prepareNextVersion(artifact)">填入下一版</button></li>
      </ul>
    </section>
  </section>
</template>
<script setup>
import { onBeforeUnmount, reactive } from 'vue'
import { useHallArtifactTransfer } from '@/composables/juyiting/useHallArtifactTransfer'
const props = defineProps({ subject: { type: Object, default: null }, workspace: { type: Object, default: null }, identityEpoch: { type: [Number, String], default: 0 }, api: { type: Object, default: null } })
// reactive unwraps the composable's top-level refs for this plain return object.
const transfer = reactive(useHallArtifactTransfer({ api: props.api || undefined, subject: () => props.subject, workspace: () => props.workspace, identityEpoch: () => props.identityEpoch }))
const onFile = event => transfer.setFile(event.target?.files?.[0] || null)
onBeforeUnmount(() => transfer.dispose())
</script>
<style scoped>
.artifact-transfer-panel{display:grid;gap:12px;padding:16px;border-top:1px solid #ded3bf;color:#3d332a;background:#fffdf7}.artifact-transfer-panel header h3,.artifact-transfer-panel header span,.artifact-transfer-panel h4,.artifact-transfer-panel p{margin:0}.artifact-transfer-panel header span{font-size:12px;color:#6c6258}.artifact-transfer-panel h3{font-size:18px;color:#213d34}.artifact-transfer-note{color:#6c6258;font-size:13px}.artifact-transfer-status{padding:8px;border-radius:6px;background:#e8f2ed}.artifact-transfer-status.is-error,.artifact-transfer-status.is-conflict,.artifact-transfer-status.is-unknown,.artifact-transfer-conflict{color:#7a3026;background:#fae7e1}.artifact-transfer-status.is-unavailable{color:#765d2d;background:#f7edcf}.artifact-upload-form,.artifact-download-form{display:grid;gap:8px;padding:12px;border:1px solid #ded3bf;border-radius:8px}.artifact-upload-form label,.artifact-download-form label{display:grid;gap:4px;font-size:13px}.artifact-upload-form input,.artifact-upload-form select,.artifact-download-form input{min-width:0;padding:6px;border:1px solid #b8aa94;border-radius:4px}.artifact-transfer-actions{display:flex;flex-wrap:wrap;gap:8px}.artifact-transfer-actions button,.artifact-transfer-recent button{border:1px solid #315d4e;border-radius:4px;padding:6px 10px;color:#fff;background:#315d4e}.artifact-transfer-actions button[disabled]{opacity:.55}.artifact-transfer-recent{display:grid;gap:6px;margin:0;padding:0;list-style:none}.artifact-transfer-recent li{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.artifact-transfer-recent span{margin-right:auto;overflow-wrap:anywhere}.artifact-transfer-recent button{font-size:12px}
</style>
