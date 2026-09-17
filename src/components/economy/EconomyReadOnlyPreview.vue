<template>
  <main class="economy-preview" aria-label="经济只读预览">
    <header class="page-header">
      <div><h1>经济预览</h1><p>只读预览：本次操作不扣款、不下单、不安装、不启用托管。</p></div>
      <button type="button" :disabled="refreshing" @click="refresh">{{ refreshing ? '正在刷新…' : '刷新全部' }}</button>
    </header>
    <p v-if="preview.capabilityError" class="card-error" role="alert">{{ preview.capabilityError }}</p>
    <p v-else-if="!preview.enabled" class="notice" role="status">经济只读预览当前未启用。</p>

    <template v-if="preview.enabled">
      <section class="preview-card" aria-labelledby="wallet-title">
        <header><h2 id="wallet-title">钱包</h2><button type="button" @click="preview.refresh">重试</button></header>
        <p v-if="preview.wallet.status === 'loading'" role="status">正在读取钱包…</p>
        <p v-else-if="preview.wallet.status === 'error' || preview.wallet.status === 'unavailable'" class="card-error" role="alert">{{ preview.wallet.error }}</p>
        <template v-else-if="preview.wallet.status === 'ready' || preview.wallet.status === 'empty'">
          <div class="money-grid"><p>可用 <strong>{{ money(preview.wallet.data?.availableMicro) }}</strong></p><p>冻结 <strong>{{ money(preview.wallet.data?.heldMicro) }}</strong></p></div>
          <p class="muted">币种：{{ preview.wallet.data?.currency || '未报告' }}；钱包版本：{{ preview.wallet.data?.version || '未报告' }}。无账户成功读取时显示 0，不代表接口失败。</p>
          <h3>流水</h3>
          <p v-if="preview.ledger.status === 'loading'" role="status">正在读取流水…</p>
          <p v-else-if="preview.ledger.status === 'error' || preview.ledger.status === 'unavailable'" class="card-error" role="alert">{{ preview.ledger.error }}</p>
          <p v-else-if="preview.ledger.status === 'empty'" role="status">暂无历史流水。</p>
          <ul v-else class="rows"><li v-for="item in preview.ledger.data?.items || []" :key="`${item.transactionId}-${item.entryId}`"><span>{{ item.businessType || '未报告业务' }} · {{ item.direction || '未报告方向' }}</span><strong>{{ money(item.amountMicro) }}</strong><small>{{ item.status || '状态未知' }} · {{ item.businessRef || '无业务引用' }} · {{ timestamp(item.postedAt) }}</small></li></ul>
          <button v-if="preview.ledger.data?.nextCursor" type="button" @click="preview.loadLedger(preview.ledger.data.nextCursor)">加载更多流水</button>
        </template>
      </section>

      <section class="preview-card" aria-labelledby="estimate-title">
        <header><h2 id="estimate-title">悬赏预算试算</h2><span class="pill">示例价表</span></header>
        <p class="muted">仅纯计算，不创建任务、报价、资金冻结或订单。</p>
        <form class="estimate-form" @submit.prevent="estimate">
          <label>悬赏预算（micro-SILVER）<input v-model="form.grossBountyAmountMicro" inputmode="numeric" /></label>
          <label>最低预期收益（micro-SILVER）<input v-model="form.minimumAcceptedPayoutMicro" inputmode="numeric" /></label>
          <div class="token-grid"><div v-for="kind in tokenKinds" :key="kind"><label>预计 {{ tokenLabel(kind) }}<input v-model="form.estimatedTokens[kind]" inputmode="numeric" /></label><label>最坏 {{ tokenLabel(kind) }}<input v-model="form.worstTokens[kind]" inputmode="numeric" /></label></div></div>
          <p v-if="estimateInputError" class="card-error" role="alert">{{ estimateInputError }}</p>
          <button type="submit" :disabled="preview.estimate.status === 'loading'">{{ preview.estimate.status === 'loading' ? '正在试算…' : '重新试算（不扣款）' }}</button>
        </form>
        <p v-if="preview.estimate.status === 'error' || preview.estimate.status === 'unavailable'" class="card-error" role="alert">{{ preview.estimate.error }}</p>
        <dl v-if="preview.estimate.status === 'ready'" class="result-grid"><div><dt>预计计算费用</dt><dd>{{ money(preview.estimate.data.estimatedComputeMicro) }}</dd></div><div><dt>最坏计算费用</dt><dd>{{ money(preview.estimate.data.worstComputeMicro) }}</dd></div><div><dt>平台费</dt><dd>{{ money(preview.estimate.data.platformFeeMicro) }}</dd></div><div><dt>预计 Agent 收益</dt><dd>{{ money(preview.estimate.data.estimatedAgentPayoutMicro) }}</dd></div><div><dt>最坏 Agent 收益</dt><dd>{{ money(preview.estimate.data.worstAgentPayoutMicro) }}</dd></div><div><dt>预算余量</dt><dd>{{ money(preview.estimate.data.budgetHeadroomMicro) }}</dd></div></dl>
        <p v-if="preview.estimate.status === 'ready'" class="muted">{{ preview.estimate.data.budgetCovered ? '预算覆盖试算结果。' : '预算不足以覆盖试算结果。' }} {{ preview.estimate.data.rateProvenance }} / {{ preview.estimate.data.priceBookVersion }}</p>
      </section>

      <section class="preview-card" aria-labelledby="catalog-title">
        <header><h2 id="catalog-title">技能目录</h2><button type="button" @click="preview.loadCatalog('0')">刷新目录</button></header>
        <p v-if="preview.catalog.status === 'loading'" role="status">正在读取技能目录…</p>
        <p v-else-if="preview.catalog.status === 'error' || preview.catalog.status === 'unavailable'" class="card-error" role="alert">{{ preview.catalog.error }}</p>
        <p v-else-if="preview.catalog.status === 'empty'" role="status">当前 scope 暂无已发布技能商品。</p>
        <div v-else class="catalog-grid"><article v-for="product in preview.catalog.data?.items || []" :key="product.productId"><h3>{{ product.name }}</h3><p>{{ product.skillKey }}@{{ product.skillVersion }} / {{ product.productVersionId }}</p><p>{{ product.description || '暂无说明' }}</p><p>{{ money(product.priceMicro) }} · {{ product.priceSource }}</p><p>权限：{{ list(product.permissions) }}；部署：{{ product.deploymentRestriction || '未报告' }}</p><button type="button" @click="preview.loadDetail(product.productId)">查看详情</button></article></div>
        <button v-if="preview.catalog.data?.nextOffset" type="button" @click="preview.loadCatalog(preview.catalog.data.nextOffset)">加载更多目录</button>
        <aside
          v-if="preview.detail.status === 'ready'"
          class="detail"
          role="dialog"
          aria-label="技能详情"
        ><button type="button" @click="preview.detail = { status: 'idle', data: null, error: '' }">关闭详情</button><h3>{{ preview.detail.data.name }}</h3><p>{{ preview.detail.data.description || '暂无说明' }}</p><p>权限：{{ list(preview.detail.data.permissions) }}</p><p>仅供查看；购买、下载与安装均未提供。</p></aside>
      </section>

      <section class="preview-card" aria-labelledby="agent-title">
        <header><h2 id="agent-title">Agent 权益与安装证据</h2><button type="button" @click="preview.loadAgentFacts">重查所选 Agent</button></header>
        <label>选择自己的 Agent<select v-model="preview.selectedAgentId"><option value="">请选择 Agent</option><option v-for="agent in preview.agents" :key="agent.agentId" :value="agent.agentId">{{ agent.name || agent.personaName || agent.agentId }}</option></select></label>
        <p v-if="preview.roster.status === 'loading'" role="status">正在读取可操作 Agent…</p><p v-else-if="preview.roster.status === 'error'" class="card-error" role="alert">{{ preview.roster.error }}</p><p v-else-if="!preview.agents.length" role="status">没有可读取权益的自有 Agent。</p>
        <template v-if="preview.selectedAgentId"><div class="two-columns"><section><h3>权益状态</h3><p v-if="preview.agentSkills.status === 'loading'" role="status">正在核对权益…</p><p v-else-if="preview.agentSkills.status === 'error' || preview.agentSkills.status === 'unavailable'" class="card-error" role="alert">{{ preview.agentSkills.error }}</p><p v-else-if="!(preview.agentSkills.data?.entitlements || []).length">无有效权益记录。</p><ul v-else class="rows"><li v-for="item in preview.agentSkills.data.entitlements" :key="`${item.skillKey}-${item.skillVersion}`">{{ item.skillKey }}@{{ item.skillVersion }} · {{ item.status || '未知' }}</li></ul></section><section><h3>安装证据</h3><p>权益 ACTIVE 不等于已安装；自由文本能力不作为安装证明。</p><p v-if="preview.agentSkills.status === 'ready' && !(preview.agentSkills.data?.installationEvidence || []).length">未确认：没有可验证安装证据。</p><p v-if="preview.agentSkills.data?.observedAt" class="muted">观察时间：{{ timestamp(preview.agentSkills.data.observedAt) }}</p><ul v-if="preview.agentSkills.data?.installationEvidence?.length" class="rows"><li v-for="item in preview.agentSkills.data.installationEvidence" :key="item.installationId || `${item.skillKey}-${item.skillVersion}`">{{ item.installationId || '未报告安装编号' }} · {{ item.skillKey }}@{{ item.skillVersion }} · {{ evidence(item) }}（{{ item.evidenceKind || '未报告证据类型' }}）· {{ timestamp(item.verifiedAt) }}</li></ul></section></div></template>
      </section>

      <section class="preview-card" aria-labelledby="hosting-title">
        <header><h2 id="hosting-title">托管说明与租约</h2><button type="button" @click="preview.loadAgentFacts">重查</button></header>
        <p v-if="preview.hostingPlan.status === 'loading'" role="status">正在读取托管参考方案…</p><p v-else-if="preview.hostingPlan.status === 'error' || preview.hostingPlan.status === 'unavailable'" class="card-error" role="alert">{{ preview.hostingPlan.error }}</p><template v-else-if="preview.hostingPlan.data"><p v-if="preview.hostingPlan.data.source === 'local'">local：不适用 / 不收租。</p><p v-else>参考方案 {{ preview.hostingPlan.data.planVersion }}：{{ money(preview.hostingPlan.data.amountMicro) }} / {{ period(preview.hostingPlan.data.periodSeconds) }} / {{ preview.hostingPlan.data.currency || '未报告币种' }}。仅说明，不能开通或续费。</p></template><p v-if="preview.selectedAgentId && preview.hostingLease.status === 'loading'" role="status">正在读取已有租约…</p><p v-else-if="preview.hostingLease.status === 'error' || preview.hostingLease.status === 'unavailable'" class="card-error" role="alert">{{ preview.hostingLease.error }}</p><p v-else-if="preview.hostingLease.data?.applicability === 'NOT_APPLICABLE'">该 Agent 为 local，不适用托管租约。</p><p v-else-if="preview.selectedAgentId && !preview.hostingLease.data?.lease">该 Agent 暂无已有租约，未开通。</p><p v-else-if="preview.hostingLease.data?.lease">租约 {{ preview.hostingLease.data.lease.leaseId }} / v{{ preview.hostingLease.data.lease.version }} · {{ preview.hostingLease.data.lease.status }}；方案 {{ preview.hostingLease.data.lease.planVersion }}，已付 {{ money(preview.hostingLease.data.lease.amountMicro) }} / {{ period(preview.hostingLease.data.lease.periodSeconds) }}，{{ timestamp(preview.hostingLease.data.lease.paidFrom) }} 至 {{ timestamp(preview.hostingLease.data.lease.paidThrough) }}。</p>
      </section>
    </template>
  </main>
</template>

<script setup>
import { onMounted, proxyRefs, reactive, ref } from 'vue'
import { useGlobalStore } from '@/stores/global.js'
import { formatSilverMicro } from '@/utils/silverAmount.js'
import { useEconomyReadOnlyPreview } from '@/composables/useEconomyReadOnlyPreview.js'

const preview = proxyRefs(useEconomyReadOnlyPreview())
const refreshing = ref(false)
const tokenKinds = ['input', 'cachedInput', 'output', 'reasoning']
const form = reactive({ grossBountyAmountMicro: '0', minimumAcceptedPayoutMicro: '0', estimatedTokens: { input: '0', cachedInput: '0', output: '0', reasoning: '0' }, worstTokens: { input: '0', cachedInput: '0', output: '0', reasoning: '0' } })
const estimateInputError = ref('')
const money = value => { try { return formatSilverMicro(value) } catch { return '未报告金额' } }
const list = value => Array.isArray(value) && value.length ? value.join('、') : '未报告'
const tokenLabel = key => ({ input: '输入 Token', cachedInput: '缓存输入 Token', output: '输出 Token', reasoning: '推理 Token' }[key])
const timestamp = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) ? new Date(Number(value)).toLocaleString() : '未报告时间'
const period = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? `${value} 秒` : '未报告周期'
const evidence = item => item?.status === 'VERIFIED_INSTALLED' && item?.evidenceKind ? '已验证安装' : '未确认'
const refresh = async () => { refreshing.value = true; try { await preview.refresh() } finally { refreshing.value = false } }
const estimate = async () => { estimateInputError.value = ''; const values = [form.grossBountyAmountMicro, form.minimumAcceptedPayoutMicro, ...tokenKinds.flatMap(key => [form.estimatedTokens[key], form.worstTokens[key]])]; if (!values.every(preview.canonical)) { estimateInputError.value = '所有金额和 Token 必须是规范非负十进制字符串。'; return }; if (tokenKinds.some(key => BigInt(form.estimatedTokens[key]) > BigInt(form.worstTokens[key]))) { estimateInputError.value = '每类预计 Token 不得大于最坏 Token。'; return }; await preview.submitEstimate(JSON.parse(JSON.stringify(form))) }
onMounted(() => { const store = useGlobalStore(); store.setTitle('经济预览'); store.setShowBack(true); store.setShowMore(false); void refresh() })
</script>

<style scoped>
.economy-preview { flex: 1; min-width: 0; overflow: auto; padding: 16px; color: #27364a; background: #f4f7fb; } .page-header, .preview-card header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; } .page-header { margin-bottom: 16px; } h1,h2,h3,p { margin: 0; } h1 { font-size: 24px; } .page-header p,.muted { margin-top: 6px; color: #64748b; } .preview-card { display: grid; gap: 12px; margin-bottom: 16px; padding: 16px; border-radius: 12px; background: #fff; box-shadow: 0 4px 14px rgba(30,41,59,.08); overflow-wrap: anywhere; } button { min-height: 36px; padding: 7px 12px; border: 1px solid #355d99; border-radius: 8px; background: #fff; color: #244b83; cursor: pointer; } button:disabled { opacity: .6; cursor: not-allowed; } .notice,.card-error { padding: 12px; border-radius: 8px; } .notice { background: #fff7df; color: #855d12; } .card-error { background: #fff0f0; color: #a32d2d; } .money-grid,.result-grid,.two-columns { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; } .money-grid p,.result-grid div,.catalog-grid article,.two-columns section,.detail { padding: 12px; border: 1px solid #dbe5f0; border-radius: 8px; } .money-grid strong { display: block; margin-top: 5px; font-size: 18px; } .rows { display: grid; gap: 7px; padding: 0; margin: 0; list-style: none; } .rows li { display: grid; gap: 3px; padding: 9px 0; border-bottom: 1px solid #edf2f7; } small { color:#64748b; } .estimate-form { display: grid; gap: 10px; } label { display: grid; gap: 5px; color: #40556d; } input,select { min-width: 0; min-height: 38px; box-sizing: border-box; padding: 7px; border: 1px solid #b8c7d8; border-radius: 7px; background: #fff; } .token-grid,.catalog-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 10px; } .token-grid > div { display: grid; gap: 8px; } .result-grid dt { color:#64748b; font-size: 13px; } .result-grid dd { margin: 4px 0 0; font-weight: 700; } .catalog-grid article { display: grid; gap: 8px; } .catalog-grid h3 { font-size: 16px; } .pill { padding: 4px 8px; border-radius: 999px; background: #e8f0ff; color:#315a96; font-size: 12px; } .detail { background:#f8fbff; } @media (max-width: 640px) { .economy-preview { padding: 12px; } .page-header,.preview-card header { flex-direction: column; } .money-grid,.result-grid,.two-columns { grid-template-columns: 1fr; } }
</style>
