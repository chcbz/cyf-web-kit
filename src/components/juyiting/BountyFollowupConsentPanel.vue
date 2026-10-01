<template>
  <section v-if="enabled && visible" class="bounty-followup-consent" aria-label="受控图像办理确认">
    <template v-if="state.status === 'PREVIEWED'">
      <strong>核对本次受控图像办理</strong>
      <p>服务端预览：{{ state.preview.operation }} · {{ state.preview.modelId }} · {{ state.preview.custody }} · 策略 {{ state.preview.operatorPolicyRevision }}。</p>
      <p>本次将使用受控外部账户，最多一次外发请求；服务器会在签发与办理时重新核对模型、策略、来源和授权。</p>
      <label><input v-model="acknowledged" type="checkbox" /> 我明确确认本次单次受控图像请求</label>
      <div class="consent-actions">
        <button type="button" :disabled="!acknowledged || busy" @click="confirm">明确确认并办理</button>
        <button type="button" :disabled="busy" @click="$emit('check-original', state.record?.finalKey)">仅核对原办理</button>
      </div>
    </template>
    <template v-else>
      <strong>{{ statusLabel }}</strong>
      <p v-if="state.error" role="alert">{{ state.error }}</p>
      <button v-if="state.record?.finalKey && !busy" type="button" @click="$emit('check-original', state.record.finalKey)">仅核对原办理</button>
    </template>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { followupProviderAcknowledgement } from '../../composables/juyiting/useHallBountyFollowup.js'

const props = defineProps({ enabled: { type: Boolean, default: false }, state: { type: Object, default: () => ({ status: 'IDLE' }) }, busy: { type: Boolean, default: false } })
const emit = defineEmits(['confirm', 'check-original'])
const acknowledged = ref(false)
const visible = computed(() => ['PREVIEWED', 'ISSUING', 'ISSUED', 'ADMITTING', 'ADMITTED', 'UNKNOWN', 'REJECTED'].includes(props.state?.status))
const statusLabel = computed(() => ({ ISSUING: '正在签发本轮明确同意…', ISSUED: '本轮同意已签发，等待原办理核对。', ADMITTING: '正在办理本轮请求…', ADMITTED: '本轮办理已受理。', UNKNOWN: '本轮办理结果待核对。', REJECTED: '本轮办理未获确认。' }[props.state?.status] || '受控图像办理'))
const confirm = () => { if (acknowledged.value && !props.busy) emit('confirm', followupProviderAcknowledgement) }
watch(() => [props.state?.record?.finalKey, props.state?.status], () => { acknowledged.value = false }, { flush: 'sync' })
</script>

<style scoped>
.bounty-followup-consent { display: grid; gap: 7px; padding: 10px 14px; border-bottom: 1px solid rgba(127, 74, 34, .22); background: #fff3de; color: #4e3018; }
.bounty-followup-consent p { margin: 0; font-size: 13px; }
.consent-actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
