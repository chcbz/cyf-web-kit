<template>
  <main class="wallet-page" aria-labelledby="wallet-title">
    <header>
      <p class="eyebrow">内测</p>
      <h2 id="wallet-title">钱袋 · 文</h2>
      <p>查看余额和收支记录。</p>
      <router-link to="/profile">返回个人中心</router-link>
    </header>

    <section v-if="loading" class="wallet-state" role="status">正在核对钱袋…</section>
    <section v-else-if="error" class="wallet-state is-error" role="alert">
      {{ error }}
      <button type="button" @click="loadWallet">重试</button>
    </section>
    <template v-else-if="wallet">
      <section class="wallet-balances" aria-label="文余额">
        <div><small>可用</small><strong>{{ format(wallet.available) }}</strong></div>
        <div><small>已预占</small><strong>{{ format(wallet.held) }}</strong></div>
      </section>

      <p class="wallet-state">已预占的文暂不能用于其他事项；验收后扣除，取消事项后退回。</p>
      <section class="wallet-ledger" aria-labelledby="ledger-title">
        <div class="section-heading">
          <h3 id="ledger-title">收支记录</h3>
          <button type="button" :disabled="refreshing" @click="loadWallet">{{ refreshing ? '刷新中…' : '刷新' }}</button>
        </div>
        <p v-if="!ledger.length" class="wallet-state">暂无收支记录。</p>
        <ol v-else>
          <li v-for="entry in ledger" :key="entry.entryId || entry.transactionId">
            <div>
              <strong>{{ transactionLabel(entry.businessType) }}</strong>
              <small>{{ entry.businessRef || entry.transactionId }}</small>
            </div>
            <div class="ledger-amount" :class="entry.direction === 'DEBIT' ? 'is-debit' : 'is-credit'">
              {{ entry.direction === 'DEBIT' ? '−' : '+' }}{{ format(entry.amount) }}
              <small>{{ formatPostedAt(entry.postedAt) }}</small>
            </div>
          </li>
        </ol>
      </section>
    </template>
  </main>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { economyApi } from '@/composables/useHttp'
import { formatWen } from '@/utils/wenAmount'
import { isEconomyPreviewCapability, loadEconomyPreviewCapability } from '@/utils/economyPreviewCapability'

import { useApiStore } from '@/stores/api'

const apiStore = useApiStore()
let requestId = 0
const transactionLabel = type => ({ ISSUE_WEN: '活动赠送', RESERVE_BOUNTY: '事项预占', CAPTURE_TASK: '事项扣款', REFUND_BOUNTY: '取消退回' })[type] || type || '文交易'
const wallet = ref(null)
const ledger = ref([])
const loading = ref(false)
const refreshing = ref(false)
const error = ref('')

const unwrap = result => result
const validMoney = value => value?.currency === 'WEN' && typeof value.amountMinor === 'string' && /^(0|[1-9][0-9]*)$/.test(value.amountMinor) && BigInt(value.amountMinor) <= 9223372036854775807n
const format = value => validMoney(value) ? formatWen(value.amountMinor) : '—'
const formatPostedAt = value => Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime())
  ? new Date(value).toLocaleString() : ''

const loadWallet = async () => {
  const request = ++requestId
  const generation = apiStore.authorizationGeneration
  const current = () => request === requestId && generation === apiStore.authorizationGeneration
  loading.value = !wallet.value
  refreshing.value = Boolean(wallet.value)
  error.value = ''
  try {
    const capability = await loadEconomyPreviewCapability()
    if (!current()) return
    if (!isEconomyPreviewCapability(capability)) {
      throw new Error('钱包暂未开放')
    }
    const [walletResult, ledgerResult] = await Promise.all([
      economyApi.get('/wallet', undefined, { autoLoading: false }),
      economyApi.get('/ledger', { pageSize: 50 }, { autoLoading: false })
    ])
    if (!current()) return
    const nextWallet = unwrap(walletResult)
    const nextLedger = unwrap(ledgerResult)
    if (!nextWallet || !validMoney(nextWallet.available) || !validMoney(nextWallet.held)) {
      throw new Error('暂未取得有效的钱袋数据，请重试')
    }
    wallet.value = nextWallet
    ledger.value = Array.isArray(nextLedger?.items) ? nextLedger.items : []
  } catch (cause) {
    if (!current()) return
    wallet.value = null
    ledger.value = []
    error.value = cause?.message || '钱包暂不可用'
  } finally {
    if (current()) {
      loading.value = false
      refreshing.value = false
    }
  }
}

watch(() => apiStore.authorizationGeneration, () => {
  wallet.value = null
  ledger.value = []
  void loadWallet()
}, { flush: 'sync' })
onBeforeUnmount(() => { requestId += 1 })
onMounted(loadWallet)
</script>

<style scoped>
.wallet-page { flex: 1; overflow: auto; padding: 20px; background: #f7f6f2; color: #242e2b; }
.wallet-page header, .wallet-balances, .wallet-ledger, .wallet-state { max-width: 720px; margin: 0 auto 16px; padding: 18px; border-radius: 12px; background: #fffefa; border: 1px solid #e3e5dc; }
.eyebrow { margin: 0; color: #923f30; font-size: 12px; font-weight: 700; }
h2, h3 { margin: 0; color: var(--color-text); }.wallet-page header p:last-child, small { color: var(--color-text-secondary); }
.wallet-balances { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }.wallet-balances div { padding: 14px; border-radius: 10px; background: #f1e8dc; }.wallet-balances small, .wallet-balances strong { display: block; }.wallet-balances strong { margin-top: 5px; color: #923f30; font-size: 20px; overflow-wrap: anywhere; }
.section-heading, .wallet-ledger li { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.section-heading button, .wallet-state button { padding: 8px 12px; border: 1px solid #923f30; border-radius: 8px; background: #923f30; color: #fff; cursor: pointer; }
ol { padding: 0; margin: 12px 0 0; list-style: none; }.wallet-ledger li { padding: 12px 0; border-top: 1px solid #f0ebe2; }.wallet-ledger strong, .wallet-ledger small { display: block; }.ledger-amount { text-align: right; font-weight: 700; }.ledger-amount.is-credit { color: #14734f; }.ledger-amount.is-debit { color: #b42318; }.wallet-state { color: var(--color-text-secondary); }.wallet-state.is-error { color: #b42318; }
@media (max-width: 480px) { .wallet-balances { grid-template-columns: 1fr; } }
h2 { font-family: "Noto Serif CJK SC", "Songti SC", serif; font-weight: 500; }
.wallet-page header a { display: inline-flex; align-items: center; min-height: 44px; color: #923f30; text-decoration: none; }
</style>
