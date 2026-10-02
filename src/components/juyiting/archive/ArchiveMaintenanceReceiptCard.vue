<template>
  <section v-if="receipt" class="archive-maintenance-receipt" aria-label="典籍维护回执">
    <strong>典籍维护回执（以服务器当前授权事实为准）</strong>
    <template v-if="receipt.jobId">
      <p>作业引用 {{ receipt.jobId }}；消息本身不授予访问、发布或阅读权限。</p>
      <button type="button" :disabled="loading" @click="reauthorize">重新核验作业</button>
      <template v-if="facts">
        <h5>{{ handlingTitle }}</h5>
        <p>典籍集 {{ collectionLabel }}；来源 {{ sourceLabel }}</p>
        <p>当前办理：{{ stageLabel }}<template v-if="blockerLabel"> · 阻塞 {{ blockerLabel }}</template>；发布方式 {{ publicationModeLabel }}</p>
        <p>实际章节进度：{{ progressLabel }}</p>
        <p>当前任职：<template v-if="currentAssignee">{{ currentAssignee.assignedAgentId }} · {{ currentAssignee.permissionProfile }}</template><template v-else>{{ assignmentLabel }}</template></p>
        <p v-if="assignmentSnapshot">历史任职快照：{{ assignmentSnapshot.assignedAgentId || '未提供' }} · {{ assignmentSnapshot.permissionProfile || '未提供' }}（{{ assignmentSnapshot.appointmentId || '无任职引用' }} @ {{ assignmentSnapshot.appointmentRevision || '无版本' }}）</p>
        <p>当前发布：{{ publicationLabel }}</p>
        <div class="receipt-actions">
          <button type="button" :disabled="loading" @click="openMaintenance">查看维护单</button>
          <button v-if="readerTarget" type="button" :disabled="loading" @click="openReader">打开典籍</button>
        </div>
      </template>
      <p v-else-if="!loading && !error" role="status">正在重新核验当前授权事实；未核验前不会显示办理、任职或阅读信息。</p>
    </template>
    <p v-else role="status">此回执尚未包含可核验的作业引用（UNCONFIRMED）。请从典籍维护面板读取权威状态；消息中的状态或发布信息不作为事实。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createApi } from '@/composables/useHttp.js'
import { registerIdentityCleanup } from '@/utils/identityLifecycle.js'
import { createIdentityFence, unwrapAdminResult } from '@/composables/juyiting/useArchiveMaintenance.js'

const props = defineProps({ content: { type: String, default: '' }, api: { type: Object, default: null } })
const emit = defineEmits(['open-maintenance', 'open-edition'])
const api = props.api || createApi('/archive/admin/v1')
const loading = ref(false), error = ref(''), current = ref(null), fence = createIdentityFence()
let sequence = 0
const receipt = computed(() => {
  try {
    const parsed = JSON.parse(props.content)
    const value = parsed?.type === 'archive_maintenance_receipt' ? parsed.archiveMaintenance : null
    if (!value || typeof value !== 'object') return null
    return { jobId: typeof value.jobId === 'string' ? value.jobId.trim() : '' }
  } catch { return null }
})
const text = value => typeof value === 'string' ? value.trim() : ''
const decimal = value => /^(?:0|[1-9][0-9]*)$/.test(text(value))
const positiveDecimal = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
const sha = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value))
const passedVerification = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.state === 'PASSED' && positiveDecimal(value.revision) && sha(value.verificationDigest) && Array.isArray(value.findings) && value.findings.every(item => typeof item === 'string') && instant(value.checkedAt))
const assignmentStatuses = new Set(['ACTIVE', 'REVOKED', 'BINDING_CHANGED', 'UNASSIGNED', 'UNVERIFIED'])
const validFacts = value => {
  const handling = value?.handling
  if (!handling || typeof handling !== 'object' || Array.isArray(handling)) return null
  if (!assignmentStatuses.has(handling.assignmentStatus)) return null
  const activeAssignment = handling.assignmentStatus === 'ACTIVE'
  if (activeAssignment !== Boolean(text(handling.assignedAgentId) && text(handling.permissionProfile))) return null
  if (!activeAssignment && (handling.assignedAgentId !== null || handling.permissionProfile !== null)) return null
  if (['REVOKED', 'BINDING_CHANGED'].includes(handling.assignmentStatus) && handling.blocker !== 'REASSIGNMENT_REQUIRED') return null
  const progress = handling.progress
  if (!progress || typeof progress !== 'object' || !decimal(progress.completedChapters) || typeof progress.totalKnown !== 'boolean') return null
  if (progress.totalKnown !== (decimal(progress.totalChapters))) return null
  if (!progress.totalKnown && progress.totalChapters !== null) return null
  const source = handling.source
  if (source != null && (typeof source !== 'object' || Array.isArray(source))) return null
  return handling
}
const facts = computed(() => validFacts(current.value))
const assignmentSnapshot = computed(() => facts.value?.assignmentSnapshot && typeof facts.value.assignmentSnapshot === 'object' ? facts.value.assignmentSnapshot : null)
const currentAssignee = computed(() => facts.value?.assignmentStatus === 'ACTIVE' && text(facts.value.assignedAgentId) && text(facts.value.permissionProfile)
  ? { assignedAgentId: text(facts.value.assignedAgentId), permissionProfile: text(facts.value.permissionProfile) } : null)
const assignmentLabel = computed(() => {
  const state = facts.value?.assignmentStatus
  if (state === 'REVOKED' || state === 'BINDING_CHANGED') return '当前任职已失效，需要重新改派'
  if (state === 'UNASSIGNED') return '当前未任职'
  return '当前任职未获服务器验证'
})
const handlingTitle = computed(() => text(facts.value?.title) || '未命名维护单')
const collectionLabel = computed(() => text(facts.value?.collectionId) || '未提供')
const stageLabel = computed(() => text(facts.value?.stage) || '未提供')
const blockerLabel = computed(() => text(facts.value?.blocker))
const publicationModeLabel = computed(() => text(facts.value?.publicationMode) || '未提供')
const sourceLabel = computed(() => {
  const source = facts.value?.source
  return source ? `${text(source.sourceName) || '未命名来源'} ${text(source.sourceVersion) || '无版本'}（${text(source.sourceId) || '无来源引用'}）` : '无当前来源引用'
})
const progressLabel = computed(() => {
  const progress = facts.value?.progress
  if (!progress) return '未知'
  return progress.totalKnown ? `${progress.completedChapters} / ${progress.totalChapters}` : `${progress.completedChapters} 章完成；总章数未知`
})
const verifiedPublication = computed(() => {
  const publication = facts.value?.currentPublication
  const target = publication?.readerTarget, immutable = publication?.receipt, verification = publication?.verification
  if (!publication || publication.state !== 'PUBLISHED' || !target || !immutable || !passedVerification(verification)) return null
  if (!text(target.workId) || !text(target.editionId) || immutable.jobId !== receipt.value?.jobId || immutable.workId !== target.workId || immutable.editionId !== target.editionId) return null
  if (!text(immutable.publicationId) || !positiveDecimal(immutable.draftRevision) || !sha(immutable.manifestSha256) || !sha(immutable.sourceSha256)) return null
  return { workId: target.workId, editionId: target.editionId }
})
const readerTarget = computed(() => verifiedPublication.value)
const publicationLabel = computed(() => {
  const publication = facts.value?.currentPublication
  if (!publication) return '无当前发布事实'
  if (readerTarget.value) return `PUBLISHED · 当前核验 PASSED · ${readerTarget.value.editionId}`
  return `${text(publication.state) || '未提供'} · 当前核验 ${text(publication.verification?.state) || '未提供'}；不可打开阅读`
})
const reset = () => { fence.invalidate(); sequence += 1; loading.value = false; error.value = ''; current.value = null }
const reauthorize = async () => {
  const jobId = receipt.value?.jobId
  if (!jobId || loading.value) return null
  const epoch = fence.current(), request = ++sequence
  loading.value = true; error.value = ''; current.value = null
  try {
    const result = unwrapAdminResult(await api.get(`/jobs/${encodeURIComponent(jobId)}`, null, { autoLoading: false, rum: false }))
    if (!fence.isCurrent(epoch) || request !== sequence || receipt.value?.jobId !== jobId) return null
    if (result?.jobId !== jobId || !validFacts(result)) {
      error.value = '服务器未返回此维护单可安全展示的当前办理事实。'
      return null
    }
    current.value = result
    return result
  } catch (failure) {
    if (fence.isCurrent(epoch) && request === sequence && receipt.value?.jobId === jobId) {
      current.value = null
      error.value = [401, 403, 404].includes(failure?.status) ? '当前身份无权读取此作业，卡片不授予访问权限。' : (failure?.message || '作业状态无法读取。')
    }
    return null
  } finally {
    if (fence.isCurrent(epoch) && request === sequence && receipt.value?.jobId === jobId) loading.value = false
  }
}
const openMaintenance = async () => {
  const result = await reauthorize()
  if (result?.jobId === receipt.value?.jobId) emit('open-maintenance', { jobId: result.jobId })
}
const openReader = async () => {
  const result = await reauthorize()
  const target = result && validFacts(result) ? verifiedPublication.value : null
  if (target && result.jobId === receipt.value?.jobId) emit('open-edition', { ...target })
}
watch(() => receipt.value?.jobId || '', () => { reset(); if (receipt.value?.jobId) void reauthorize() }, { immediate: true })
const unregister = registerIdentityCleanup(reset)
onBeforeUnmount(() => { unregister(); reset() })
</script>
<style scoped>
.archive-maintenance-receipt{margin:8px 0;padding:10px;border:1px solid #d8d8ce;border-radius:7px;background:#fffefa}.archive-maintenance-receipt p{margin:6px 0}.archive-maintenance-receipt button{min-height:36px}.receipt-actions{display:flex;gap:8px;flex-wrap:wrap}.error{color:#9b2f26}
</style>
