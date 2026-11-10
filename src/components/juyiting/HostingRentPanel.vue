<template>
  <section class="hosting-rent-panel" aria-label="山寨安顿租约">
    <header>
      <h3>{{ persona.name || persona.personaName || persona.personaCode }} · 山寨安顿</h3>
      <button type="button" @click="$emit('close')">关闭（未确认报价不付款）</button>
    </header>
    <p>每位好汉独立租约，每期30天，余额足够时自动续费；平台托管500文/期，自行部署50文/期，不追收历史费用。</p>
    <p class="separate-fees"><strong>任务用量、技能购买、悬赏费用另计，不包含在托管租金内。</strong></p>
    <p v-if="rent.busy.value" role="status">正在查询租约…</p>
    <p v-if="rent.error.value" role="alert">{{ rent.error.value }}</p>
    <p v-if="rent.wallet.value">钱袋可用：{{ money(rent.wallet.value.available.amountMinor) }}；已预留：{{ money(rent.wallet.value.held.amountMinor) }}</p>

    <section v-if="receipt" class="hosting-receipt" role="status">
      <strong>{{ receiptTitle }}</strong>
      <p v-if="receipt.status === 'FUNDS_RESERVED'">租金已预留，尚未完成安顿。请查看下方租约进度。</p>
      <p v-else-if="receipt.operation === 'REPROVISION'">免费重整请求已接受，不表示服务已就绪；不会续租或重置到期日。</p>
      <p v-else>本次手动续租付款已确认；当前到期时间以最新租约为准。</p>
      <p>订单：{{ receipt.transactionId || receipt.requestId }}；金额 {{ money(receipt.amountWen) }}；时间 {{ timestamp(receipt.occurredAt) }}</p>
      <p v-if="rent.state.value.refreshPending"><strong>请求已确认，租约刷新待完成；请重查，不要重复付款。</strong></p>
    </section>

    <section v-if="lookup" class="hosting-lease" aria-label="最新租约">
      <p v-if="!lookup.managed">尚未开通托管。确认报价后才会收费。</p>
      <template v-else>
        <h4>{{ leaseTitle }}</h4>
        <p v-if="lookup.lease.settlementKind === 'RETAINED'">原结算记录已归档；保留身份及原租期，本次不扣费。续租按新报价以文支付。</p>
        <p v-else>租约金额 {{ money(lookup.lease.amountWen) }} / {{ period(lookup.lease.periodSeconds) }}</p>
        <p>起租 {{ timestamp(lookup.lease.paidFrom) }}；到期 {{ timestamp(lookup.lease.paidThrough) }}</p>
        <p v-if="lookup.lease.status === 'LOCKED'">余额足够时自动扣费解锁，新租期从成功扣费时开始；暂不可接新事项、发起密议或变更技能，已有事项可继续完成。</p>
        <p v-else-if="lookup.lease.status === 'FINISHING'">已停止续费，正在收尾已有事务；收尾完成前不可重新邀请。公共技能、项目仓库及 Git 历史保留。</p>
        <p v-else>到期后进入解除收尾，已有事项可继续完成；公共技能、项目仓库及 Git 历史保留。</p>
        <p v-if="lookup.intent?.reserveTransactionId">预留流水 {{ lookup.intent.reserveTransactionId }}</p>
        <p v-if="lookup.intent?.captureTransactionId">收租流水：{{ lookup.intent.captureTransactionId }}</p>
        <p v-if="lookup.intent?.refundTransactionId">原单退款流水：{{ lookup.intent.refundTransactionId }}</p>
        <p v-if="lookup.intent?.status === 'FAILED_NO_EFFECT'">安顿未成功，请核对退款状态和退款流水。</p>
        <p v-if="lookup.reprovision">免费重整：{{ lookup.reprovision.serviceReadyAt ? `服务就绪于 ${timestamp(lookup.reprovision.serviceReadyAt)}` : '结果待确认，请刷新租约' }}</p>
      </template>
    </section>

    <section v-if="rent.state.value.operation" class="hosting-recovery" role="status">
      <strong>操作结果待确认</strong>
      <p>请先查询本次操作结果，不要重复付款。</p>
      <button type="button" :disabled="rent.busy.value || !rent.ready.value" @click="acceptedAction(rent.retryUnknown)">查询结果</button>
    </section>

    <section v-if="quote" class="hosting-quote" aria-label="租金报价确认">
      <h4>{{ quote.purpose === 'INITIAL' ? '初次安顿报价' : '手动续租报价' }}</h4>
      <p><strong>本次合计：{{ money(quote.amountWen) }} / {{ period(quote.periodSeconds) }}</strong></p>
      <p>正常租费：{{ money(quote.recurringAmountWen) }} / {{ period(quote.periodSeconds) }}</p>
      <p v-if="quote.purpose === 'INITIAL'">已有技能：{{ quote.initialSkillCount }}种（含停用未卸载技能），首次费用 {{ money(quote.initialSkillAmountWen) }}；后续每期 {{ money(quote.recurringAmountWen) }}。</p>
      <p v-if="quote.purpose === 'INITIAL'">技能清单变化须重新报价；未确认不付款。</p>
      <p>报价有效至 {{ timestamp(quote.expiresAt) }}</p>
      <p>初租从服务可用时起算；续租从当前时间或原到期时间中较晚者起算。</p>
      <p v-if="rent.quoteExpired.value" role="alert">报价已过期，请取消后重新预览；不会自动换价付款。</p>
      <p v-else-if="rent.wallet.value && !rent.canConfirm.value" role="status">余额不足或当前租约/选择待核对，暂不可付款。</p>
      <button type="button" :disabled="!rent.canConfirm.value" @click="acceptedAction(rent.confirmQuote)">确认此报价并{{ quote.purpose === 'INITIAL' ? '预留租金' : '手动续租付款' }}</button>
      <button type="button" :disabled="rent.busy.value || !!rent.state.value.operation" @click="rent.cancelQuote">取消报价，不付款</button>
    </section>

    <div class="hosting-actions">
      <button v-if="!rent.ready.value" type="button" :disabled="rent.busy.value" @click="openPersona">重新核对租金预览</button>
      <button v-if="rent.canInitial.value && !quote" type="button" @click="rent.previewInitial">查看安顿报价（未确认不付款）</button>
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
import { formatWen, isCanonicalDecimalString, isEconomyPreviewBuildEnabled } from '../../utils/wenAmount.js'

const props = defineProps({ persona: { type: Object, required: true }, resolvePersona: { type: Function, required: true } })
const emit = defineEmits(['close', 'hosting-changed', 'hosting-confirmed'])
const apiStore = useApiStore()
const rent = useHostingRent({ agentApi, economyApi, loadCapability: loadEconomyPreviewCapability,
  enabled: isEconomyPreviewBuildEnabled(import.meta.env.VITE_ECONOMY_PREVIEW_ENABLED),
  resolvePersona: persona => props.resolvePersona(persona), getAuthorizationGeneration: () => apiStore.authorizationGeneration })
const quote = computed(() => rent.state.value.quote)
const lookup = computed(() => rent.state.value.lookup)
const receipt = computed(() => rent.state.value.accepted?.receipt)
const receiptTitle = computed(() => receipt.value?.operation === 'REPROVISION' ? '免费重整已受理，等待就绪' :
  receipt.value?.status === 'FUNDS_RESERVED' ? '租金已预留' : '续租付款已确认')
const leaseTitle = computed(() => {
  if (lookup.value?.lease?.status === 'REFUNDED') return lookup.value.lease.settlementKind === 'RETAINED' ? '原安顿未生效，历史退款已归档' : '安顿未生效，租金已退回'
  if (lookup.value?.lease?.status === 'LOCKED') return '欠费锁定，等待自动续费'
  if (lookup.value?.lease?.status === 'FINISHING') return '正在解除收尾，暂不可重新邀请'
  if (lookup.value?.lease?.status !== 'ACTIVE') return '安顿待确认 / 待就绪，不重复付款'
  if (lookup.value.admission === 'RENEWAL_REQUIRED' || BigInt(lookup.value.lease.paidThrough) <= BigInt(rent.clock.value)) return '租期已到，请核对余额与续费状态'
  return lookup.value.lease.settlementKind === 'RETAINED' ? '保留的托管权益' : '租约已生效'
})
const money = value => isCanonicalDecimalString(value) ? formatWen(value) : '—'
const period = value => {
  if (!isCanonicalDecimalString(value)) return '—'
  return BigInt(value) % 86400n === 0n ? `${BigInt(value) / 86400n} 天` : `${value} 秒`
}
const timestamp = value => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) return '待确认'
  return new Date(value).toLocaleString()
}
const openPersona = async () => {
  const opened = await rent.open(props.persona)
  if (opened && rent.canInitial.value && !rent.state.value.quote) await rent.previewInitial()
}
const acceptedAction = async action => {
  if (await action()) {
    const receipt = rent.state.value.accepted?.receipt
    if (receipt && !rent.state.value.operation) {
      emit('hosting-changed')
      emit('hosting-confirmed', {
        personaCode: props.persona.personaCode,
        agentId: receipt.agentId || quote.value?.agentId || ''
      })
    }
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
