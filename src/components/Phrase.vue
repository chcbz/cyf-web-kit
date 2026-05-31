<template>
  <div class="phrase-container">
    <!-- 添加内容弹窗 -->
    <PhraseAddDialog v-model:show="addDialogShow" @success="refreshPage" />

    <!-- 反馈弹窗 -->
    <PhraseFeedbackDialog v-model:show="fbDialogShow" />

    <div class="phrase-content">
      <h2 id="content" class="phrase-text">{{ phrase.content }}</h2>
    </div>
    <div class="phrase-meta">
      <span class="meta-text">
        阅读{{ phrase.pv }} {{ author }}
        <a :href="globalStore.copyrightLink" class="copyright-link">{{ globalStore.copyright }}</a>
        发布于{{ formatTime(phrase.createTime) }}
      </span>
    </div>

    <div class="action-grid">
      <div class="action-item" @click="payTips">
        <var-icon name="heart" size="26px" class="action-icon" />
        <div class="action-label">{{ $t('phrase.tips') }}</div>
      </div>
      <div
        ref="upvote"
        class="action-item"
        :class="{ voted: upVoted }"
        @click="toTick(1)"
      >
        <var-icon name="thumb-up" size="26px" class="action-icon" />
        <div class="action-label">{{ $t('phrase.up') }}{{ phrase.up }}</div>
      </div>
      <div
        ref="downvote"
        class="action-item"
        :class="{ voted: downVoted }"
        @click="toTick(0)"
      >
        <var-icon name="thumb-down" size="26px" class="action-icon" />
        <div class="action-label">{{ $t('phrase.down') }}{{ phrase.down }}</div>
      </div>
      <div class="action-item" @click="fbDialogShow = true">
        <var-icon name="chat-processing" size="26px" class="action-icon" />
        <div class="action-label">{{ $t('phrase.say') }}</div>
      </div>
    </div>

    <div class="section-title">
      <h5>{{ $t('phrase.others') }}</h5>
    </div>

    <div class="action-grid">
      <div id="copyBtn" class="action-item" @click="copyContent">
        <var-icon name="content-copy" size="26px" class="action-icon" />
        <div class="action-label">{{ $t('phrase.copy') }}</div>
      </div>
      <div class="action-item" @click="refreshPage">
        <var-icon name="refresh" size="26px" class="action-icon" />
        <div class="action-label">{{ $t('phrase.next') }}</div>
      </div>
      <div class="action-item" @click="addDialogShow = true">
        <var-icon name="plus" size="26px" class="action-icon" />
        <div class="action-label">{{ $t('phrase.add') }}</div>
      </div>
      <div class="action-item" @click="closeWindow">
        <var-icon name="close" size="26px" class="action-icon" />
        <div class="action-label">{{ $t('phrase.close') }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Clipboard from 'clipboard'
import { Dialog } from '@varlet/ui'
import { useGlobalStore } from '../stores/global'
import { useUtilStore } from '../stores/util'
import { phraseApi, userApi, tipApi, wxApi } from '../composables/useHttp'
import PhraseAddDialog from './phrase/PhraseAddDialog.vue'
import PhraseFeedbackDialog from './phrase/PhraseFeedbackDialog.vue'

const { t } = useI18n()
const globalStore = useGlobalStore()
const utilStore = useUtilStore()

// 响应式数据
const phrase = ref({})
const author = ref('')
const hasTick = ref(false)
const upVoted = ref(false)
const downVoted = ref(false)
const addDialogShow = ref(false)
const fbDialogShow = ref(false)
const upvote = ref(null)
const downvote = ref(null)

// 方法
const formatTime = (timestamp) => {
  return utilStore.fromTimeStamp(timestamp, 'YYYY-MM-DD')
}

const refreshPage = () => {
  window.history.go(0)
}

const closeWindow = () => {
  utilStore.closeWindow()
}

const copyContent = () => {
  const clipboard = new Clipboard('#copyBtn')
  clipboard.on('success', (e) => {
    Dialog({
      title: t('app.notify'),
      message: t('phrase.copy_success')
    })
    e.clearSelection()
  })
}

const checkLogin = () => {
  const jiacn = globalStore.getJiacn
  if (!jiacn) {
    Dialog({
      title: t('app.notify'),
      message: t('phrase.subscribe_notify'),
      onConfirm: () => {
        window.location.href =
          'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=MzU2OTU3Njk5MQ==&scene=110#wechat_redirect'
      }
    })
    return false
  }
  return true
}

const toTick = (opt) => {
  if (hasTick.value) return
  if (!checkLogin()) return

  const jiacn = globalStore.getJiacn

  phraseApi.list('/vote', {
    jiacn,
    phraseId: phrase.value.id,
    vote: opt
  }, {
    onSuccess: (data) => {
      if (data.code === 'E0') {
        hasTick.value = true
        if (opt === 1) {
          phrase.value.up++
          upVoted.value = true
        } else {
          phrase.value.down++
          downVoted.value = true
        }
      }
    }
  })
}

const payTips = () => {
  if (!checkLogin()) return

  const jiacn = globalStore.getJiacn
  const appid = globalStore.user.appid

  tipApi.post('/create', {
    type: 1,
    entityId: phrase.value.id,
    price: 100,
    jiacn,
    status: 0
  }, {
    onSuccess: (data) => {
      if (data.code === 'E0') {
        wxApi.get('/pay/createOrder', {
          outTradeNo: 'TIP' + (Array(7).join('0') + data.data.id).slice(-7),
          tradeType: 'JSAPI',
          appid
        }, {
          onSuccess: (wxData) => {
            if (wxData.data) {
              weixinPay(wxData.data)
            } else {
              Dialog({
                title: t('app.alert'),
                message: wxData.msg
              })
            }
          }
        })
      } else {
        Dialog({
          title: t('app.alert'),
          message: data.msg
        })
      }
    }
  })
}

const weixinPay = (data) => {
  if (typeof window.WeixinJSBridge === 'undefined') {
    if (document.addEventListener) {
      document.addEventListener('WeixinJSBridgeReady', () => onBridgeReady(data), false)
    } else if (document.attachEvent) {
      document.attachEvent('WeixinJSBridgeReady', () => onBridgeReady(data))
      document.attachEvent('onWeixinJSBridgeReady', () => onBridgeReady(data))
    }
  } else {
    onBridgeReady(data)
  }
}

const onBridgeReady = (data) => {
  window.WeixinJSBridge.invoke(
    'getBrandWCPayRequest',
    {
      debug: true,
      appId: data.appId,
      timeStamp: data.timeStamp,
      nonceStr: data.nonceStr,
      package: data.packageValue,
      signType: data.signType,
      paySign: data.paySign,
      jsApiList: ['chooseWXPay']
    },
    (res) => {
      if (res.err_msg === 'get_brand_wcpay_request:ok') {
        Dialog({
          title: t('app.notify'),
          message: t('phrase.pay_notify')
        })
      } else {
        Dialog({
          title: t('app.alert'),
          message: t('phrase.pay_cancel')
        })
      }
    }
  )
}

// 生命周期
onMounted(() => {
  globalStore.setTitle(t('phrase.title'))
  document.title = t('phrase.title_sub')
  globalStore.setShowBack(false)
  globalStore.setShowMore(false)

  const jiacn = globalStore.getJiacn

  phraseApi.list('/get/random', {
    jiacn
  }, {
    onSuccess: (data) => {
      phrase.value = data.data
      // 阅读计数
      phraseApi.getById('/read', data.data.id, {
        onSuccess: () => {
          phrase.value.pv++
        }
      })
      if (data.data.jiacn) {
        // 获取作者信息
        userApi.get('/get', {
          type: 'cn',
          key: data.data.jiacn
        }, {
          onSuccess: (userData) => {
            if (userData.code === 'E0') {
              author.value = userData.data.nickname
            }
          }
        })
      }
    }
  })
})
</script>

<style scoped>
.phrase-container {
  padding: 20px 0;
  background: #ffffff;
  overflow-y: auto;
}

.phrase-content {
  margin: 0 25px;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  padding: 30px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  margin-bottom: 20px;
  transition: transform 0.2s ease;
  backdrop-filter: blur(10px);
}

.phrase-content:hover {
  transform: translateY(-2px);
}

.phrase-text {
  text-align: center;
  font-size: 1.8rem;
  line-height: 1.6;
  color: #2c3e50;
  font-weight: 500;
  margin: 0;
  word-break: break-word;
}

.phrase-meta {
  margin: 0 25px 25px;
  text-align: center;
}

.meta-text {
  color: #6c757d;
  font-size: 0.9rem;
  display: inline-block;
  padding: 8px 16px;
  border-radius: 20px;
  backdrop-filter: blur(10px);
}

.copyright-link {
  color: #ff9900 !important;
  text-decoration: none;
  transition: color 0.2s ease;
}

.copyright-link:hover {
  color: #e67e22 !important;
  text-decoration: underline;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin: 0 25px 15px;
}

.action-item {
  cursor: pointer;
  padding: 15px 10px;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  transition: all 0.3s ease;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  backdrop-filter: blur(10px);
}

.action-item:hover {
  transform: translateY(-3px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  background: #fff8e6;
}

.action-icon {
  color: #ff9900;
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.action-item:hover .action-icon {
  transform: scale(1.1);
}

.action-label {
  font-size: 0.85rem;
  color: #495057;
  font-weight: 500;
}

.section-title {
  margin: 30px 25px 20px;
  text-align: center;
}

.section-title h5 {
  color: #6c757d;
  font-weight: 600;
  font-size: 1.1rem;
  margin: 0;
  position: relative;
  display: inline-block;
}

.section-title h5::before,
.section-title h5::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 40px;
  height: 1px;
}

.section-title h5::before {
  right: 100%;
  margin-right: 15px;
}

.section-title h5::after {
  left: 100%;
  margin-left: 15px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .phrase-content {
    margin: 0 15px;
    padding: 20px;
  }

  .phrase-text {
    font-size: 1.4rem;
  }

  .action-grid {
    grid-template-columns: repeat(4, 1fr);
    margin: 0 15px 20px;
    gap: 8px;
  }

  .action-item {
    padding: 2px 8px;
    margin-bottom: 0;
  }

  .action-label {
    font-size: 0.8rem;
  }
}

@media (max-width: 480px) {
  .phrase-text {
    font-size: 1.2rem;
  }

  .action-grid {
    grid-template-columns: repeat(4, 1fr);
    margin: 0 10px 15px;
    gap: 6px;
  }

  .action-icon {
    font-size: 22px;
  }

  .action-label {
    font-size: 0.75rem;
  }
}

/* 动画效果 */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.phrase-content,
.action-item {
  animation: fadeInUp 0.6s ease-out;
}

.action-item:nth-child(1) {
  animation-delay: 0.1s;
}
.action-item:nth-child(2) {
  animation-delay: 0.2s;
}
.action-item:nth-child(3) {
  animation-delay: 0.3s;
}
.action-item:nth-child(4) {
  animation-delay: 0.4s;
}

/* 投票后的样式 */
.action-item.voted .action-icon {
  color: #ff4757 !important;
}

.action-item.voted .action-label {
  color: #ff4757 !important;
  font-weight: 600;
}
</style>
