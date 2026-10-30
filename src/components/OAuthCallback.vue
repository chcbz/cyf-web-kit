<template>
  <main class="oauth-callback">
    <header class="oauth-brand"><span class="oauth-brand__seal" aria-hidden="true">聚</span><span>聚义厅<small>安全登录</small></span></header>
    <div class="oauth-main">
      <section class="oauth-callback__card" role="status" aria-live="polite" aria-labelledby="oauth-title" aria-describedby="oauth-description" :aria-busy="processing">
        <div class="oauth-emblem" aria-hidden="true">
          <span v-if="processing" class="oauth-callback__spinner"></span>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false">
            <template v-if="processing"><path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6Z"/><path d="m8 12 3 3 5-6"/></template>
            <template v-else><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></template>
          </svg>
        </div>
        <p class="oauth-eyebrow">{{ processing ? '安全验证中' : '需要重新授权' }}</p>
        <h1 id="oauth-title">{{ processing ? '正在完成登录' : '登录未完成' }}</h1>
        <p id="oauth-description">{{ processing ? '正在安全验证授权结果，完成后将自动返回。' : errorMessage }}</p>
        <p v-if="processing" class="oauth-patience">请稍候，无需重复点击或刷新。</p>
        <div v-else class="oauth-callback__actions">
          <button type="button" class="oauth-callback__primary" @click="retry">重新登录</button>
          <button type="button" class="oauth-callback__secondary" @click="goHome">返回首页</button>
        </div>
      </section>
    </div>
    <footer class="oauth-footer">聚义厅 · 一起，把事情办成。</footer>
  </main>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApiStore } from '@/stores/api'
import { oauthCallbackMessage, processOAuthCallback } from '@/utils/oauthCallback.js'
import { completeOAuthNavigation } from '@/utils/oauthNavigationHistory.js'

const route = useRoute()
const router = useRouter()
const apiStore = useApiStore()
const processing = ref(true)
const errorMessage = ref('')

onMounted(async () => {
  const query = { ...route.query }
  try {
    await processOAuthCallback({
      query,
      scrubQuery: () => router.replace({ path: route.path, query: {}, hash: '' }),
      transactionConfig: apiStore.oauthRuntimeConfig(),
      exchangeCodeForToken: (code, transaction) => apiStore.exchangeCodeForToken(code, transaction),
      loadUserInfo: () => apiStore.getUserInfo(),
      replace: returnTo => completeOAuthNavigation(query.state, returnTo, {
        replace: path => router.replace(path)
      })
    })
  } catch (error) {
    errorMessage.value = oauthCallbackMessage(error)
    processing.value = false
  }
})

const retry = () => apiStore.beginAuthorization('/')
const goHome = () => router.replace('/')
</script>

<style scoped>
.oauth-callback { box-sizing: border-box; min-height: 100vh; min-height: 100svh; display: grid; grid-template-rows: auto 1fr auto; padding: 32px 48px 24px; background: radial-gradient(ellipse at 50% 40%, #fffefa, #f5f4f0 66%); color: #242e2b; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.oauth-brand { display: flex; align-items: center; gap: 12px; font-size: 17px; font-weight: 600; }
.oauth-brand__seal { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: #923f30; color: #fffefa; font-family: serif; font-size: 23px; }
.oauth-brand > span:last-child { display: flex; align-items: center; gap: 14px; }
.oauth-brand small { padding-left: 14px; border-left: 1px solid #ccd2c5; color: #68716b; font-size: 13px; font-weight: 400; }
.oauth-main { display: grid; place-items: center; padding: 48px 0 64px; }
.oauth-callback__card { width: min(100%, 440px); min-width: 0; text-align: center; }
.oauth-emblem { position: relative; display: grid; place-items: center; width: 88px; height: 88px; margin: 0 auto 28px; border-radius: 50%; background: #f6eee8; color: #923f30; }
.oauth-callback__spinner { position: absolute; inset: -9px; border: 1px solid #e3e5dc; border-top: 2px solid #923f30; border-radius: 50%; animation: oauth-spin 1.8s linear infinite; }
.oauth-eyebrow { margin: 0 0 12px; color: #875e50; font-size: 12px; letter-spacing: 2px; }
.oauth-callback__card h1 { margin: 0; font-size: 28px; font-weight: 600; line-height: 1.5; }
#oauth-description { margin: 14px 0 0; color: #68716b; font-size: 14px; line-height: 1.8; overflow-wrap: anywhere; }
.oauth-patience { margin: 32px 0 0; font-size: 12px; color: #68716b; }
.oauth-callback__actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.oauth-callback__actions button { box-sizing: border-box; min-height: 44px; padding: 10px 20px; border-radius: 8px; font: inherit; font-size: 14px; cursor: pointer; }
.oauth-callback__primary { border: 1px solid #923f30; background: #923f30; color: #fffefa; }
.oauth-callback__primary:hover { background: #793326; }
.oauth-callback__secondary { border: 1px solid #ccd2c5; background: transparent; color: #242e2b; }
.oauth-callback__actions button:focus-visible { outline: 2px solid #923f30; outline-offset: 3px; }
.oauth-footer { color: #68716b; font-size: 12px; }
@keyframes oauth-spin { to { transform: rotate(360deg); } }
@media (max-width: 600px) {
  .oauth-callback { padding: 24px 24px max(16px, env(safe-area-inset-bottom)); }
  .oauth-main { padding: 60px 0 64px; }
  .oauth-callback__card h1 { font-size: 24px; }
  .oauth-emblem { width: 76px; height: 76px; }
  .oauth-footer { text-align: center; }
}
@media (max-height: 500px) { .oauth-main { padding: 32px 0; } .oauth-emblem { width: 56px; height: 56px; margin-bottom: 20px; } }
@media (prefers-reduced-motion: reduce) { .oauth-callback__spinner { animation: none; } }
</style>
