<template>
  <var-dialog v-model:show="visible" :title="product?.name || product?.skillKey || '购买技能'" :confirm-button="false" :cancel-button="false">
    <div v-if="product" class="purchase-dialog">
      <p class="price">报价：{{ formatMoney(quote?.priceMicro ?? product.priceMicro) }}</p>
      <p class="target">目标 Agent：{{ targetAgent?.name || targetAgent?.agentId || targetAgent?.id || '未选择' }}</p>
      <p v-if="!previewEnabled" class="reason">预览购买功能未启用。</p>
      <p v-else-if="product.canPurchase !== true" class="reason">{{ product.canPurchaseReason || product.purchaseReason || product.reason || '服务端未允许购买。' }}</p>
      <template v-else>
        <p class="section-title">逐项批准权限</p>
        <label v-for="permission in permissions" :key="permission" class="permission">
          <input :checked="approvedPermissions.includes(permission)" type="checkbox" @change="toggle(permission, $event.target.checked)">
          <span>{{ permission }}</span>
        </label>
        <p v-if="quote" class="quote-note">报价已生成；切换目标 Agent 或批准权限会使报价失效。</p>
      </template>
      <div class="actions">
        <var-button type="default" @click="visible = false">取消</var-button>
        <var-button type="primary" :loading="quoteLoading" :disabled="!canQuote" @click="$emit('quote')">获取报价</var-button>
        <var-button type="primary" :loading="purchaseLoading" :disabled="!canPurchase" @click="$emit('purchase')">确认购买</var-button>
      </div>
    </div>
  </var-dialog>
</template>

<script setup>
import { computed } from 'vue'
import { formatSilverMicro } from '@/composables/useSkillMarket.js'

const props = defineProps({
  show: { type: Boolean, default: false },
  product: { type: Object, default: null },
  targetAgent: { type: Object, default: null },
  previewEnabled: { type: Boolean, default: false },
  approvedPermissions: { type: Array, default: () => [] },
  quote: { type: Object, default: null },
  canQuote: { type: Boolean, default: false },
  canPurchase: { type: Boolean, default: false },
  quoteLoading: { type: Boolean, default: false },
  purchaseLoading: { type: Boolean, default: false },
  moneyFormatter: { type: Function, default: null }
})
const emit = defineEmits(['update:show', 'update:approved-permissions', 'quote', 'purchase'])
const visible = computed({ get: () => props.show, set: value => emit('update:show', value) })
const permissions = computed(() => [...new Set((props.product?.permissions || []).map(item => String(item || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
const formatMoney = (amount) => props.moneyFormatter ? props.moneyFormatter(amount) : formatSilverMicro(amount)
const toggle = (permission, checked) => {
  const next = new Set(props.approvedPermissions)
  if (checked) next.add(permission)
  else next.delete(permission)
  emit('update:approved-permissions', [...next].map(item => String(item).trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)))
}
</script>

<style scoped>
.purchase-dialog { display: grid; gap: 12px; min-width: min(420px, 78vw); } p { margin: 0; } .price { color: #167553; font-size: 17px; font-weight: 700; } .target, .quote-note { color: #5d6c80; font-size: 13px; } .section-title { color: #334b67; font-weight: 700; } .permission { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid #e1e9f2; border-radius: 8px; } .reason { color: #a65a35; } .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
