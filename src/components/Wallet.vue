<template>
  <main class="wallet-page" aria-labelledby="wallet-title">
    <header>
      <p class="eyebrow">开发预览</p>
      <h2 id="wallet-title">SILVER 钱袋</h2>
      <p>余额和流水仅在服务端经济预览能力开启后显示。</p>
    </header>

    <section v-if="!previewBuildEnabled" class="wallet-state" role="status">
      经济预览当前未启用。
    </section>
    <section v-else-if="loading" class="wallet-state" role="status">正在核对钱袋…</section>
    <section v-else-if="error" class="wallet-state is-error" role="alert">
      {{ error }}
      <button type="button" @click="loadWallet">重试</button>
    </section>
    <template v-else-if="wallet">
      <section class="wallet-balances" aria-label="SILVER 余额">
        <div><small>可用</small><strong>{{ format(wallet.availableMicro) }}</strong></div>
        <div><small>已托管</small><strong>{{ format(wallet.heldMicro) }}</strong></div>
      </section>

      <section class="wallet-ledger" aria-labelledby="ledger-title">
        <div class="section-heading">
          <h3 id="ledger-title">不可变流水</h3>
          <button type="button" :disabled="refreshing" @click="loadWallet">{{ refreshing ? '刷新中…' : '刷新' }}</button>
        </div>
        <p v-if="!ledger.length" class="wallet-state">暂无流水。</p>
        <ol v-else>
          <li v-for="entry in ledger" :key="entry.entryId || entry.transactionId">
            <div>
              <strong>{{ entry.businessType || 'SILVER 交易' }}</strong>
              <small>{{ entry.businessRef || entry.transactionId }}</small>
            </div>
            <div class="ledger-amount" :class="entry.direction === 'DEBIT' ? 'is-debit' : 'is-credit'">
              {{ entry.direction === 'DEBIT' ? '−' : '+' }}{{ format(entry.amountMicro) }}
              <small>{{ formatPostedAt(entry.postedAt) }}</small>
            </div>
          </li>
        </ol>
      </section>
    </template>
  </main>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { economyApi } from '@/composables/useHttp'
import { formatSilverMicro, isEconomyPreviewBuildEnabled } from '@/utils/silverAmount'

const previewBuildEnabled = isEconomyPreviewBuildEnabled(import.meta.env.VITE_ECONOMY_PREVIEW_ENABLED)
const wallet = ref(null)
const ledger = ref([])
const loading = ref(false)
const refreshing = ref(false)
const error = ref('')

const unwrap = result => result?.data?.data ?? result?.data ?? result
const format = value => formatSilverMicro(typeof value === 'string' ? value : '0')
const formatPostedAt = value => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

const loadWallet = async () => {
  if (!previewBuildEnabled) return
  loading.value = !wallet.value
  refreshing.value = Boolean(wallet.value)
  error.value = ''
  try {
    const [walletResult, ledgerResult] = await Promise.all([
      economyApi.get('/wallet', undefined, { autoLoading: false }),
      economyApi.get('/ledger', { limit: '50' }, { autoLoading: false })
    ])
    const nextWallet = unwrap(walletResult)
    const nextLedger = unwrap(ledgerResult)
    if (!nextWallet || typeof nextWallet.availableMicro !== 'string' || typeof nextWallet.heldMicro !== 'string') {
      throw new Error('经济预览能力未提供钱包数据')
    }
    wallet.value = nextWallet
    ledger.value = Array.isArray(nextLedger?.items) ? nextLedger.items : []
  } catch (cause) {
    error.value = cause?.message || '钱包暂不可用'
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

onMounted(loadWallet)
</script>

<style scoped>
.wallet-page { flex: 1; overflow: auto; padding: 20px; background: var(--color-body); }
.wallet-page header, .wallet-balances, .wallet-ledger, .wallet-state { max-width: 720px; margin: 0 auto 16px; padding: 18px; border-radius: 12px; background: #fff; box-shadow: 0 4px 16px rgba(35, 28, 20, .08); }
.eyebrow { margin: 0; color: #8b5e16; font-size: 12px; font-weight: 700; }
h2, h3 { margin: 0; color: var(--color-text); }.wallet-page header p:last-child, small { color: var(--color-text-secondary); }
.wallet-balances { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }.wallet-balances div { padding: 14px; border-radius: 10px; background: #fff7e6; }.wallet-balances small, .wallet-balances strong { display: block; }.wallet-balances strong { margin-top: 5px; color: #75430b; font-size: 20px; overflow-wrap: anywhere; }
.section-heading, .wallet-ledger li { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.section-heading button, .wallet-state button { padding: 8px 12px; border: 1px solid #8b5e16; border-radius: 8px; background: #8b5e16; color: #fff; cursor: pointer; }
ol { padding: 0; margin: 12px 0 0; list-style: none; }.wallet-ledger li { padding: 12px 0; border-top: 1px solid #f0ebe2; }.wallet-ledger strong, .wallet-ledger small { display: block; }.ledger-amount { text-align: right; font-weight: 700; }.ledger-amount.is-credit { color: #14734f; }.ledger-amount.is-debit { color: #b42318; }.wallet-state { color: var(--color-text-secondary); }.wallet-state.is-error { color: #b42318; }
@media (max-width: 480px) { .wallet-balances { grid-template-columns: 1fr; } }
</style>
