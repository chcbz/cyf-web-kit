<template>
  <main class="oauth-callback" aria-live="polite">
    <section class="oauth-callback__card">
      <div v-if="processing" class="oauth-callback__spinner" aria-hidden="true"></div>
      <h1>{{ processing ? '正在完成登录' : '登录未完成' }}</h1>
      <p>{{ processing ? '正在安全验证授权结果，请稍候。' : errorMessage }}</p>
      <div v-if="!processing" class="oauth-callback__actions">
        <button type="button" class="oauth-callback__primary" @click="retry">重新登录</button>
        <button type="button" class="oauth-callback__secondary" @click="goHome">返回首页</button>
      </div>
    </section>
  </main>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApiStore } from '@/stores/api'
import { oauthCallbackMessage, processOAuthCallback } from '@/utils/oauthCallback.js'

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
      replace: returnTo => router.replace(returnTo)
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
.oauth-callback {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  box-sizing: border-box;
  background: #f6f3eb;
  color: #26352f;
}

.oauth-callback__card {
  width: min(420px, 100%);
  padding: 32px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 16px 48px rgba(38, 53, 47, 0.12);
  text-align: center;
}

.oauth-callback__card h1 {
  margin: 16px 0 8px;
  font-size: 22px;
}

.oauth-callback__card p {
  margin: 0;
  color: #59645e;
  line-height: 1.6;
}

.oauth-callback__spinner {
  width: 32px;
  height: 32px;
  margin: 0 auto;
  border: 3px solid #dce5df;
  border-top-color: #2e6854;
  border-radius: 50%;
  animation: oauth-spin 0.8s linear infinite;
}

.oauth-callback__actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 24px;
}

.oauth-callback__actions button {
  border-radius: 999px;
  padding: 10px 18px;
  font-weight: 600;
  cursor: pointer;
}

.oauth-callback__primary {
  border: 1px solid #2e6854;
  background: #2e6854;
  color: #fff;
}

.oauth-callback__secondary {
  border: 1px solid #b9c5be;
  background: #fff;
  color: #26352f;
}

@keyframes oauth-spin {
  to { transform: rotate(360deg); }
}
</style>
