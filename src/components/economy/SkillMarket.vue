<template>
  <section class="skill-market" aria-label="技能集市">
    <header class="market-header">
      <div><h2>技能集市</h2><p>平台自营技能仅在预览能力开启后可购买。</p></div>
      <var-button text type="primary" :loading="market.loading" @click="refresh">刷新目录</var-button>
    </header>
    <p v-if="!market.previewEnabled" class="disabled-notice">预览功能当前未启用；购买操作已禁用。</p>
    <p v-if="market.error" class="error">{{ market.error }}</p>
    <var-loading v-if="market.loading" />
    <var-empty v-else-if="!market.products.length" description="暂无技能商品" />
    <div v-else class="product-grid">
      <SkillProductCard
        v-for="product in market.products"
        :key="product.productId || product.id || product.skillKey"
        :product="product"
        :preview-enabled="market.previewEnabled"
        :money-formatter="moneyFormatter"
        @select="openPurchase"
      />
    </div>

    <section v-if="targetAgent" class="facts" aria-label="技能事实">
      <h3>{{ targetAgent.name || targetAgent.agentId || targetAgent.id }} 的技能事实</h3>
      <p>权益（服务端授权）：{{ entitlementText }}</p>
      <p>运行时已安装（独立运行时快照）：{{ installedText }}</p>
      <p>运行时能力（自由文本）：{{ runtimeAbilityText }}</p>
    </section>
    <section v-if="market.order" class="order-status" aria-live="polite">
      <div class="order-status-heading">
        <strong>订单状态：{{ orderStatusLabel(market.order.status) }}</strong>
        <var-button
          text
          type="primary"
          size="small"
          :loading="market.orderLoading"
          :disabled="market.orderPolling"
          @click="refreshOrder"
        >
          刷新订单
        </var-button>
      </div>
      <span v-if="market.orderPolling">正在跟踪安装状态（{{ market.orderPollAttempts }}/6）</span>
      <span v-if="market.order.status === 'REFUNDED'">安装未激活，资金已退款。</span>
    </section>

    <SkillPurchaseDialog
      v-model:show="purchaseVisible"
      :product="market.selectedProduct"
      :target-agent="targetAgent"
      :preview-enabled="market.previewEnabled"
      :approved-permissions="market.approvedPermissions"
      :quote="market.quote"
      :can-quote="market.canRequestQuote"
      :can-purchase="market.canPurchase"
      :quote-loading="market.quoteLoading"
      :purchase-loading="market.purchaseLoading"
      :money-formatter="moneyFormatter"
      @update:approved-permissions="market.setApprovedPermissions"
      @quote="market.requestQuote"
      @purchase="completePurchase"
    />
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SkillProductCard from './SkillProductCard.vue'
import SkillPurchaseDialog from './SkillPurchaseDialog.vue'
import { formatEntitlementSkillFact, formatInstalledSkillFact, orderStatusLabel, useSkillMarket } from '@/composables/useSkillMarket.js'

const props = defineProps({
  /** Must come from the API capability response; default false fails closed. */
  previewEnabled: { type: Boolean, default: false },
  targetAgent: { type: Object, default: null },
  installedSkills: { type: Array, default: () => [] },
  runtimeAbilities: { type: [Array, String], default: () => [] },
  moneyFormatter: { type: Function, default: null },
  agentApi: { type: Object, default: null }
})
const purchaseVisible = ref(false)
const market = useSkillMarket({ agentApi: props.agentApi || undefined, enabled: computed(() => props.previewEnabled) })
const entitlementText = computed(() => market.entitlements.value.filter(item => String(item.status || '').toUpperCase() === 'ACTIVE').map(formatEntitlementSkillFact).filter(Boolean).join('、') || '无有效权益')
const installedText = computed(() => props.installedSkills.map(formatInstalledSkillFact).filter(Boolean).join('、') || '未报告已安装技能')
const runtimeAbilityText = computed(() => Array.isArray(props.runtimeAbilities) ? props.runtimeAbilities.join('、') || '未报告运行时能力' : props.runtimeAbilities || '未报告运行时能力')

const refresh = async () => {
  try { return await market.loadProducts() } catch { return null }
}
const openPurchase = async (product) => {
  market.selectProduct(product)
  const id = product?.productId || product?.id
  if (id) {
    try { await market.loadProduct(id) } catch { return }
  }
  purchaseVisible.value = true
}
const completePurchase = async () => {
  let order
  try { order = await market.purchase() } catch { return }
  if (order) {
    purchaseVisible.value = false
    market.pollOrder({ maxAttempts: 6, intervalMs: 1500 }).catch(() => {})
  }
}
const refreshOrder = async () => {
  try { return await market.loadOrder() } catch { return null }
}

watch(() => props.targetAgent, async (agent) => {
  market.setTargetAgent(agent)
  try { await market.loadEntitlements(agent?.agentId || agent?.id) } catch {}
}, { immediate: true })
onMounted(refresh)
onBeforeUnmount(market.stopOrderPolling)
</script>

<style scoped>
.skill-market { display: grid; gap: 16px; padding: 18px; color: #31445c; } .market-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; } h2, h3, p { margin: 0; } h2 { color: #263d58; } .market-header p { margin-top: 5px; color: #748197; } .disabled-notice, .error { padding: 10px 12px; border-radius: 8px; } .disabled-notice { background: #fff7e8; color: #93611c; } .error { background: #fff0f0; color: #a33f3f; } .product-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(235px, 1fr)); gap: 12px; } .facts, .order-status { display: grid; gap: 6px; padding: 14px; border: 1px solid #d9e3ee; border-radius: 10px; background: #f9fbfd; } .facts p, .order-status span { color: #5d6c80; font-size: 13px; } .order-status-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; } @media (max-width: 640px) { .market-header { flex-direction: column; } }
</style>
