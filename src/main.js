import { createApp } from 'vue'
import App from './App.vue'
import routes from './router/index'
import './assets/icon/iconfont.css'
import Varlet from '@varlet/ui'
import '@varlet/ui/es/style'
import { registerPwa } from './utils/pwa'
import { pinia } from './stores/pinia'

// 创建应用实例
const app = createApp(App)
app.use(Varlet)

app.use(pinia)

// 全局配置
app.config.productionTip = false
app.config.devtools = true

if (/no-background-color=true/.test(location.href)) {
  document.body.style['background-color'] = '#fff'
}

// 路由配置
import { createRouter, createWebHistory } from 'vue-router'
const router = createRouter({
  history: createWebHistory(),
  routes
})

// i18n配置
import { i18n } from './stores/i18n'
app.use(i18n)

app.use(router)

// Wait for the initial route so public-route metadata is available before App renders.
router.isReady().then(() => {
  app.mount('#app')

  registerPwa().catch(error => {
    console.warn('PWA registration failed:', error)
  })
})
