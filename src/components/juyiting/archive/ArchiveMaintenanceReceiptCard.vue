<template>
  <section v-if="receipt" class="archive-maintenance-receipt" aria-label="典籍维护回执">
    <strong>典籍维护回执（未核验）</strong>
    <template v-if="receipt.jobId">
      <p>作业引用 {{ receipt.jobId }}；此消息不授予访问权限，也不证明发布或终态。</p>
      <button type="button" :disabled="loading" @click="reauthorize">重新核验作业</button>
    </template>
    <p v-else role="status">此回执尚未包含可核验的作业引用（UNCONFIRMED）。请从典籍维护面板读取权威状态；消息中的状态或发布信息不作为事实。</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="current" role="status">当前：{{ current.state }} · {{ current.waitReason || '无等待原因' }} · 发布 {{ current.publicationId || '未发布' }}</p>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createApi } from '@/composables/useHttp.js'
import { registerIdentityCleanup } from '@/utils/identityLifecycle.js'
import { createIdentityFence, unwrapAdminResult } from '@/composables/juyiting/useArchiveMaintenance.js'
const props = defineProps({ content: { type: String, default: '' }, api: { type: Object, default: null } })
const api = props.api || createApi('/archive/admin/v1')
const loading=ref(false), error=ref(''), current=ref(null), fence=createIdentityFence(); let sequence=0
const receipt=computed(()=>{try{const parsed=JSON.parse(props.content);const value=parsed?.type==='archive_maintenance_receipt'?parsed.archiveMaintenance:null;if(!value||typeof value!=='object')return null;return { jobId:typeof value.jobId==='string'?value.jobId.trim():'' }}catch{return null}})
const reset=()=>{fence.invalidate();sequence++;loading.value=false;error.value='';current.value=null}
watch(()=>props.content,reset)
const reauthorize=async()=>{const jobId=receipt.value?.jobId;if(!jobId||loading.value)return;const epoch=fence.current(), request=++sequence;loading.value=true;error.value='';current.value=null;try{const result=unwrapAdminResult(await api.get(`/jobs/${encodeURIComponent(jobId)}`,null,{autoLoading:false,rum:false}));if(fence.isCurrent(epoch)&&request===sequence&&receipt.value?.jobId===jobId)current.value=result}catch(failure){if(fence.isCurrent(epoch)&&request===sequence&&receipt.value?.jobId===jobId)error.value=failure?.status===403||failure?.status===404?'当前身份无权读取此作业，卡片不授予访问权限。':(failure?.message||'作业状态无法读取。')}finally{if(fence.isCurrent(epoch)&&request===sequence&&receipt.value?.jobId===jobId)loading.value=false}}
const unregister=registerIdentityCleanup(reset)
onBeforeUnmount(()=>{unregister();reset()})
</script><style scoped>.archive-maintenance-receipt{margin:8px 0;padding:10px;border:1px solid #d8d8ce;border-radius:7px;background:#fffefa}.archive-maintenance-receipt p{margin:6px 0}.archive-maintenance-receipt button{min-height:36px}.error{color:#9b2f26}</style>
