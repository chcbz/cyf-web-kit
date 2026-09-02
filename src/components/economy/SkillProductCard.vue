<template>
  <article class="skill-product-card">
    <div class="product-heading">
      <div>
        <h3>{{ product.name || product.skillKey || '未命名技能' }}</h3>
        <p>{{ product.skillKey || product.productId }}</p>
      </div>
      <strong>{{ formatMoney(product.priceMicro) }}</strong>
    </div>
    <p class="description">{{ product.description || '平台自营技能' }}</p>
    <p v-if="product.creatorName || product.creatorAgentName" class="creator">
      创作者：{{ product.creatorName || product.creatorAgentName }}
    </p>
    <div class="chips">
      <span v-for="permission in product.permissions || []" :key="permission" class="chip">{{ permission }}</span>
    </div>
    <p v-if="!previewEnabled" class="reason">预览功能未启用</p>
    <p v-else-if="product.canPurchase !== true" class="reason">{{ product.canPurchaseReason || product.purchaseReason || product.reason || '当前不可购买' }}</p>
    <var-button
      type="primary"
      size="small"
      :disabled="!previewEnabled || product.canPurchase !== true"
      @click="$emit('select', product)"
    >
      查看并购买
    </var-button>
  </article>
</template>

<script setup>
import { formatSilverMicro } from '@/composables/useSkillMarket.js'

const props = defineProps({
  product: { type: Object, required: true },
  previewEnabled: { type: Boolean, default: false },
  moneyFormatter: { type: Function, default: null }
})

defineEmits(['select'])
const formatMoney = (amount) => props.moneyFormatter ? props.moneyFormatter(amount) : formatSilverMicro(amount)
</script>

<style scoped>
.skill-product-card { display: grid; gap: 10px; padding: 16px; border: 1px solid #d9e3ee; border-radius: 12px; background: #fff; }
.product-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
h3, p { margin: 0; } h3 { color: #263d58; } .product-heading p, .creator { color: #748197; font-size: 12px; } strong { color: #167553; white-space: nowrap; } .description { color: #4f5f73; line-height: 1.5; } .chips { display: flex; flex-wrap: wrap; gap: 6px; min-height: 18px; } .chip { padding: 3px 7px; border-radius: 999px; background: #eef5ff; color: #3c6695; font-size: 12px; } .reason { color: #a65a35; font-size: 12px; }
</style>
