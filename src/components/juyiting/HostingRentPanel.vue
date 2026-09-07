<template>
  <section class="hosting-rent-panel" aria-label="山寨安顿租约">
    <header>
      <h3>{{ persona.name || persona.personaName || persona.personaCode }} · 山寨安顿</h3>
      <button type="button" @click="$emit('close')">关闭（未确认报价不付款）</button>
    </header>
    <p>每位好汉独立租约，按期预付、仅手动续租，不自动续扣、不追收历史费用。自家接应 / 默认 local 不收托管租金。</p>
    <p class="separate-fees"><strong>任务 Token、技能购买、悬赏费用另计，不包含在托管租金内。</strong></p>
    <p v-if="rent.busy.value" role="status">正在核对服务端租金 / 租约…</p>
    <p v-if="rent.error.value" role="alert">{{ rent.error.value }}</p>
    <p v-if="rent.targetAgentId.value">明确好汉编号：{{ rent.targetAgentId.value }}</p>
    <p v-if="rent.wallet.value">钱袋可用：{{ money(rent.wallet.value.availableMicro) }}；已预留：{{ money(rent.wallet.value.heldMicro) }}（确认时服务端再次校验余额）</p>

    <section v-if="receipt" class="hosting-receipt" role="status">
      <strong>{{ receiptTitle }}</strong>
      <p v-if="receipt.status === 'FUNDS_RESERVED'">租金已预留；202 接受不等于安顿成功，服务可用与起租时间以最新租约为准。</p>
      <p v-else-if="receipt.operation === 'REPROVISION'">免费重整请求已接受，不表示服务已就绪；不会续租或重置到期日。</p>
      <p v-else>本次手动续租付款已确认；当前到期时间以最新租约为准。</p>
      <p>原始回执：{{ receipt.status }} / {{ receipt.transactionId || receipt.requestId }}；金额 {{ money(receipt.amountMicro) }}；时间 {{ timestamp(receipt.occurredAt) }}</p>
      <p v-if="rent.state.value.refreshPending"><strong>请求已确认，租约刷新待完成；请重查，不要重复付款。</strong></p>
    </section>

    <section v-if="lookup" class="hosting-lease" aria-label="服务端最新租约">
      <p v-if="!lookup.managed">该绑定尚无受管租约。不追收历史租金；只有明确确认新报价才会开始收费托管。</p>
      <template v-else>
        <h4>{{ leaseTitle }}</h4>
        <p>租约 {{ lookup.lease.leaseId }} / v{{ lookup.lease.version }}；好汉 {{ lookup.lease.agentId }}；绑定 {{ lookup.lease.bindingId }}</p>
        <p>方案 v{{ lookup.lease.planVersion }}；已付 {{ money(lookup.lease.amountMicro) }} / {{ period(lookup.lease.periodSeconds) }}</p>
        <p>起租 {{ timestamp(lookup.lease.paidFrom) }}；到期 {{ timestamp(lookup.lease.paidThrough) }}</p>
        <p>新工作准入：{{ lookup.admission }}。到期保留数据、技能及已有结果，不由页面停止在途任务。</p>
        <p v-if="lookup.intent">安顿进度：{{ lookup.intent.status }} / v{{ lookup.intent.version }}；预留流水 {{ lookup.intent.reserveTransactionId }}</p>
        <p v-if="lookup.intent?.captureTransactionId">收租流水：{{ lookup.intent.captureTransactionId }}</p>
        <p v-if="lookup.intent?.refundTransactionId">原单退款流水：{{ lookup.intent.refundTransactionId }}</p>
        <p v-if="lookup.intent?.status === 'FAILED_NO_EFFECT'">服务端已确认安顿无效果；退款完成仍以租约 REFUNDED 及退款流水为准。</p>
        <p v-if="lookup.reprovision">免费重整：{{ lookup.reprovision.status }} / {{ lookup.reprovision.requestId }} / v{{ lookup.reprovision.version }}；就绪 {{ timestamp(lookup.reprovision.serviceReadyAt) }}</p>
      </template>
    </section>

    <section v-if="rent.state.value.operation" class="hosting-recovery" role="status">
      <strong>原请求结果未知：{{ rent.state.value.operation.kind }}</strong>
      <p>仅使用此前保存的原请求、报价和幂等键核对结果；不发起替代付款。即使原报价过期也只重放原请求。</p>
      <button type="button" :disabled="rent.busy.value || !rent.ready.value" @click="acceptedAction(rent.retryUnknown)">核对原请求（不重新取价）</button>
    </section>

    <section v-if="quote" class="hosting-quote" aria-label="服务端租金报价确认">
      <h4>{{ quote.purpose === 'INITIAL' ? '初次安顿报价' : '手动续租报价' }}</h4>
      <p>好汉 {{ quote.agentId }} / {{ quote.personaCode }}；报价 {{ quote.quoteId }}</p>
      <p>服务端方案 {{ quote.planId }} / v{{ quote.planVersion }}</p>
      <p><strong>{{ money(quote.amountMicro) }} / {{ period(quote.periodSeconds) }}</strong></p>
      <p v-if="quote.leaseId">租约 {{ quote.leaseId }} / 预期版本 {{ quote.expectedLeaseVersion }}</p>
      <p>报价有效至 {{ timestamp(quote.expiresAt) }}（{{ quote.expiresAt }} ms）</p>
      <p>初租从服务可用时起算；续租从当前时刻与已付到期时间中的较晚者顺延。实际起止时间由服务端返回，本页不预设收费价格或租约到期日。</p>
      <p v-if="rent.quoteExpired.value" role="alert">报价已过期，请取消后重新预览；不会自动换价付款。</p>
      <p v-else-if="rent.wallet.value && !rent.canConfirm.value" role="status">余额不足或当前租约/选择待核对，暂不可付款。</p>
      <button type="button" :disabled="!rent.canConfirm.value" @click="acceptedAction(rent.confirmQuote)">确认此报价并{{ quote.purpose === 'INITIAL' ? '预留租金' : '手动续租付款' }}</button>
      <button type="button" :disabled="rent.busy.value || !!rent.state.value.operation" @click="rent.cancelQuote">取消报价，不付款</button>
    </section>

    <div class="hosting-actions">
      <button v-if="!rent.ready.value" type="button" :disabled="rent.busy.value" @click="openPersona">重新核对租金预览</button>
      <button v-if="rent.canInitial.value && !quote" type="button" @click="rent.previewInitial">获取服务端安顿报价（未确认不付款）</button>
      <button v-if="rent.canRenew.value && !quote" type="button" @click="rent.previewRenewal">手动续租 · 先看报价</button>
      <button v-if="rent.canReprovision.value && !quote" type="button" @click="acceptedAction(rent.reprovision)">免费重整接应（不续租，不延长到期日）</button>
      <button v-if="rent.ready.value" type="button" :disabled="rent.busy.value" @click="rent.refresh">重查租约与余额（不付款）</button>
    </div>
  </section>
</template>

<script setup>
import { computed, onUnmounted, watch } from 'vue'
import { agentApi, economyApi } from '../../composables/useHttp.js'
import { useApiStore } from '../../stores/api.js'
import { useHostingRent } from '../../composables/juyiting/useHostingRent.js'
import { loadEconomyPreviewCapability } from '../../utils/economyPreviewCapability.js'
import { formatSilverMicro, isCanonicalDecimalString, isEconomyPreviewBuildEnabled } from '../../utils/silverAmount.js'

const props = defineProps({ persona: { type: Object, required: true }, resolvePersona: { type: Function, required: true } })
const emit = defineEmits(['close', 'hosting-changed'])
const apiStore = useApiStore()
const rent = useHostingRent({ agentApi, economyApi, loadCapability: loadEconomyPreviewCapability,
  enabled: isEconomyPreviewBuildEnabled(import.meta.env.VITE_ECONOMY_PREVIEW_ENABLED),
  resolvePersona: persona => props.resolvePersona(persona), getAuthorizationGeneration: () => apiStore.authorizationGeneration })
const quote = computed(() => rent.state.value.quote)
const lookup = computed(() => rent.state.value.lookup)
const receipt = computed(() => rent.state.value.accepted?.receipt)
const receiptTitle = computed(() => receipt.value?.operation === 'REPROVISION' ? '免费重整已接受（非就绪回执）' :
  receipt.value?.status === 'FUNDS_RESERVED' ? '原租金预留已确认' : '原手动续租已确认')
const leaseTitle = computed(() => {
  if (lookup.value?.lease?.status === 'REFUNDED') return '安顿未生效，租金已退回'
  if (lookup.value?.lease?.status !== 'ACTIVE') return '安顿待确认 / 待就绪，不重复付款'
  if (lookup.value.admission === 'RENEWAL_REQUIRED' || BigInt(lookup.value.lease.paidThrough) <= BigInt(rent.clock.value)) return '租期已到，待手动续租'
  return '租约已生效'
})
const money = value => isCanonicalDecimalString(value) ? formatSilverMicro(value) : '—'
const period = value => {
  if (!isCanonicalDecimalString(value)) return '—'
  return BigInt(value) % 86400n === 0n ? `${BigInt(value) / 86400n} 固定天（${value} 秒）` : `${value} 秒`
}
const timestamp = value => {
  if (!isCanonicalDecimalString(value) || BigInt(value) > 8640000000000000n) return '待服务端确认'
  return new Date(Number(value)).toLocaleString()
}
const openPersona = async () => {
  const opened = await rent.open(props.persona)
  if (opened && rent.canInitial.value && !rent.state.value.quote) await rent.previewInitial()
}
const acceptedAction = async action => {
  if (await action()) {
    if (rent.state.value.accepted && !rent.state.value.operation) emit('hosting-changed')
  }
}
watch(() => [props.persona.personaCode, props.persona.agentId, props.persona.boundToMe, props.persona.bound,
  props.persona.canBind, props.persona.systemAgent, props.persona.version], openPersona, { immediate: true })
watch(() => apiStore.authorizationGeneration, rent.invalidate, { flush: 'sync' })
const clockTimer = setInterval(rent.tick, 1000)
onUnmounted(() => { clearInterval(clockTimer); rent.dispose() })
</script>

<style scoped>
.hosting-rent-panel { flex: 0 0 auto; max-height: 65vh; overflow: auto; margin: 0 12px 12px; padding: 14px; border: 1px solid #9b7139; border-radius: 8px; color: #533817; background: #fff8e7; overflow-wrap: anywhere; }
header, .hosting-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; justify-content: space-between; }
h3, h4 { margin: 0 0 8px; } p { margin: 8px 0; font-size: 13px; }
.hosting-quote, .hosting-receipt, .hosting-lease, .hosting-recovery { margin: 12px 0; padding: 12px; border: 1px solid #d4bd97; border-radius: 6px; }
.hosting-quote { background: #fff0c5; }.separate-fees, [role="alert"] { color: #842b13; }
button { padding: 8px 10px; margin: 3px; border: 1px solid #987039; border-radius: 6px; background: #fff; color: #533817; cursor: pointer; } button:disabled { cursor: not-allowed; opacity: .55; }
</style>
