<template>
  <div class="gift-pay-container">
    <var-action-sheet
      v-model:show="showActionSheet"
      :actions="actionSheetActions"
      @select="handleActionSelect"
      @update:show="onActionSheetShowChange"
    />

    <var-card class="gift-card">
      <template #image>
        <img :src="picUrl" class="gift-image" />
      </template>
      <template #default>
        <p class="gift-name">{{ name }}</p>
      </template>
      <template #description>
        <p class="gift-description">{{ description }}</p>
      </template>
    </var-card>

    <var-tabs v-model:active="index" class="pay-tabs">
      <var-tab>{{ $t('gift.pay') }}</var-tab>
      <var-tab>{{ $t('gift.qrcode') }}</var-tab>
    </var-tabs>

    <var-tabs-items v-model:active="index" class="pay-tabs-items">
      <var-tab-item>
        <div class="payment-section">
          <div class="payment-options">
            <var-radio-group v-model="payMoney">
              <var-radio :checked-value="0" class="payment-option">
                {{ point }}{{ $t('gift.point') }}
              </var-radio>
              <var-radio :checked-value="price" class="payment-option">
                ￥{{ price }}
              </var-radio>
            </var-radio-group>
          </div>

          <div class="address-form">
            <var-input
              v-model="consignee"
              :label="$t('gift.consignee')"
              :placeholder="$t('gift.consignee_tips')"
              :rules="[(v) => !!v || $t('gift.consignee_tips')]"
              class="form-input"
            >
              <template #extra>
                <var-button
                  type="primary"
                  size="small"
                  class="address-button"
                  @click="wxAddress"
                >
                  {{ $t('app.select') }}
                </var-button>
              </template>
            </var-input>

            <var-input
              v-model="phone"
              :label="$t('gift.phone')"
              type="tel"
              :placeholder="$t('gift.phone_tips')"
              :rules="[(v) => !!v || $t('gift.phone_tips')]"
              class="form-input"
            />

            <var-input
              v-if="virtual != 1"
              v-model="address"
              type="textarea"
              :label="$t('gift.address')"
              :placeholder="$t('gift.address_tips')"
              :rows="2"
              :rules="[(v) => !!v || $t('gift.address_tips')]"
              class="form-input"
            />
          </div>
          <var-button
            block
            type="primary"
            class="submit-button"
            @click="toPay"
          >
            {{ $t('app.submit') }}
          </var-button>
        </div>
      </var-tab-item>

      <var-tab-item>
        <div class="qrcode-section">
          <div class="price-display">
            ￥<span class="price-amount">{{ price }}</span>
          </div>
          <div class="qrcode-container">
            <img v-if="qrcodeImage" :src="qrcodeImage" class="qrcode-image" />
            <div v-else class="qrcode-loading">生成二维码中...</div>
          </div>
          <p class="qrcode-tip">{{ $t('gift.qrcode_tip') }}</p>
        </div>
      </var-tab-item>
    </var-tabs-items>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import QRCode from 'qrcode'
import { Dialog } from '@varlet/ui'
import { useGlobalStore } from '@/stores/global'
// import { useApiStore } from '@/stores/api' // 预留
import { giftApi, wxApi } from '@/composables/useHttp'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const globalStore = useGlobalStore()
// const apiStore = useApiStore() // 预留

// 响应式数据
const showActionSheet = ref(false)
const actionSheetActions = ref([
  { name: t('gift.order_list'), key: 'list' }
])
const index = ref(0)
const picUrl = ref('')
const name = ref('')
const description = ref('')
const point = ref(999)
const price = ref(999)
const quantity = ref(0)
const qrcodeUrl = ref('')
const qrcodeImage = ref('')
const consignee = ref('')
const phone = ref('')
const address = ref('')
const virtual = ref(1)
const payMoney = ref(0)
const giftId = ref(null)

// 方法
const generateQRCode = async (text) => {
  if (!text) return ''
  try {
    return await QRCode.toDataURL(text, { width: 200 })
  } catch (error) {
    console.error('生成二维码失败:', error)
    return ''
  }
}

const generateQRCodeImage = async () => {
  if (qrcodeUrl.value) {
    qrcodeImage.value = await generateQRCode(qrcodeUrl.value)
  }
}

const handleActionSelect = (action) => {
  switch (action.key) {
    case 'list':
      router.push({ name: 'OrderList' })
      break
  }
}

const onActionSheetShowChange = (show) => {
  // 当 action sheet 隐藏且右侧边栏当前显示时，触发 toggleRightSidebar
  if (!show && globalStore.showRightSidebar) {
    globalStore.toggleRightSidebar()
  }
}

const toPay = () => {
  const jiacn = globalStore.getJiacn
  const appid = globalStore.user?.appid

  if (!jiacn) {
    Dialog({
      title: t('app.notify'),
      message: t('gift.subscribe_notify'),
      onConfirm: () => {
        window.location.href =
          'https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=MzU2OTU3Njk5MQ==&scene=110#wechat_redirect'
      }
    })
    return
  }

  giftApi.create('/usage/add', {
    jiacn,
    giftId: giftId.value,
    quantity: 1,
    price: payMoney.value * 100,
    consignee: consignee.value,
    phone: phone.value,
    address: address.value,
    status: 1
  }, {
    onSuccess: (data) => {
      if (data.code === 'E0') {
        if (payMoney.value === 0) {
          Dialog({
            title: t('app.notify'),
            message: t('gift.pay_notify'),
            onConfirm: () => {
              router.go(0)
            }
          })
        } else {
          // 使用 wxApi 调用微信支付 API
          wxApi.get('/pay/createOrder', {
            outTradeNo: 'GIF' + (Array(7).join('0') + data.data.data.id).slice(-7),
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
            },
            onError: (_errorMessage, _error) => {
              // 错误处理
            }
          })
        }
      } else {
        Dialog({
          title: t('app.alert'),
          message: data.msg
        })
      }
    }
  })
}

const wxAddress = () => {
  if (window.$wechat && window.$wechat.openAddress) {
    window.$wechat.openAddress({
      success(res) {
        consignee.value = res.userName
        phone.value = res.telNumber
        address.value = res.provinceName + res.cityName + res.countryName + res.detailInfo
      },
      cancel(_res) {
        console.log('cancel weixin address selecting')
      }
    })
  } else {
    Dialog({
      title: t('app.alert'),
      message: t('gift.wechat_not_available')
    })
  }
}

const weixinPay = (data) => {
  if (typeof WeixinJSBridge === 'undefined') {
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
  WeixinJSBridge.invoke(
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
          message: t('gift.pay_notify'),
          onConfirm: () => {
            router.go(0)
          }
        })
      } else {
        Dialog({
          title: t('app.alert'),
          message: t('gift.pay_cancel')
        })
      }
    }
  )
}

// 监听右侧边栏显示状态
watch(
  () => globalStore.showRightSidebar,
  (newValue) => {
    showActionSheet.value = newValue
  }
)

// 监听二维码URL变化并生成二维码
watch(
  () => qrcodeUrl.value,
  async (newValue) => {
    if (newValue) {
      await generateQRCodeImage()
    }
  },
  { immediate: true }
)

// 生命周期
onMounted(() => {
  globalStore.setTitle(t('gift.title'))
  globalStore.setShowBack(true)
  globalStore.setShowMore(true)

  const appid = globalStore.user?.appid

  // 获取礼品详情
  giftApi.getById('/get', route.query.id, {
    onSuccess: (data) => {
      const giftData = data.data
      giftId.value = giftData.id
      picUrl.value = giftData.picUrl
      name.value = giftData.name
      description.value = giftData.description
      point.value = giftData.point
      price.value = giftData.price / 100
      quantity.value = giftData.quantity
      virtual.value = giftData.virtual
      document.title = name.value + ' - ' + globalStore.title
    }
  })

  // 生成二维码
  wxApi.get('/pay/scanPay/qrcodeLink', {
    productId: 'GIF' + (Array(7).join('0') + route.query.id).slice(-7),
    appid
  }, {
    responseType: 'text',
    onSuccess: (data) => {
      qrcodeUrl.value = data
    }
  })
})
</script>

<style scoped>
.gift-pay-container {
  background-color: #ffffff;
  min-height: calc(100vh - 56px); /* Account for app bar height */
  padding: 16px;
  padding-bottom: 32px; /* Extra bottom padding for button */
  overflow-y: auto;
  box-sizing: border-box;
}

.gift-card {
  margin-bottom: 20px;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.gift-image {
  width: 100%;
  height: 180px;
  object-fit: cover;
}

.gift-name {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  color: #333;
  margin: 8px 0 4px;
}

.gift-description {
  color: #666;
  font-size: 13px;
  line-height: 1.4;
  margin: 0;
}

.pay-tabs {
  margin-bottom: 20px;
}

.pay-tabs-items {
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.payment-section {
  padding: 20px;
  min-height: auto;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.payment-options {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin-bottom: 24px;
}

.payment-option {
  flex: 1;
  max-width: 160px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 2px solid #e0e0e0;
  background-color: #fff;
  transition: all 0.3s ease;
  font-weight: 500;
}

.payment-option:hover {
  border-color: #4dabf7;
}

.payment-option.var-radio--checked {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-color: #667eea;
  color: white;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.address-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
}

.form-input {
  border-radius: 8px;
}

.address-button {
  border-radius: 6px;
}

.submit-button {
  margin-top: 24px;
  margin-bottom: 16px;
  height: 48px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  flex-shrink: 0;
}

.qrcode-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 20px;
}

.price-display {
  font-size: 24px;
  font-weight: 600;
  color: #333;
  margin-bottom: 24px;
}

.price-amount {
  font-size: 32px;
  color: #ff6b6b;
}

.qrcode-container {
  background: white;
  padding: 16px;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  margin-bottom: 16px;
}

.qrcode-image {
  width: 200px;
  height: 200px;
  border-radius: 8px;
}

.qrcode-tip {
  color: #666;
  font-size: 14px;
  text-align: center;
  margin-top: 12px;
}

.qrcode-loading {
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 14px;
  background-color: #f5f5f5;
  border-radius: 8px;
}

/* 响应式调整 */
@media (max-width: 375px) {
  .gift-pay-container {
    padding: 12px;
    padding-bottom: 40px; /* Increased bottom padding for very small screens */
    min-height: calc(100vh - 48px); /* Smaller adjustment for small screens */
  }

  .gift-image {
    height: 160px;
  }

  .payment-options {
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .payment-option {
    max-width: 100%;
    width: 100%;
  }

  .qrcode-image {
    width: 180px;
    height: 180px;
  }

  .submit-button {
    margin-bottom: 32px; /* Increased bottom margin */
  }
}

@media (min-width: 376px) and (max-width: 768px) {
  .gift-image {
    height: 200px;
  }
}

@media (min-width: 769px) {
  .gift-pay-container {
    max-width: 480px;
    margin: 0 auto;
    padding: 24px;
  }

  .gift-image {
    height: 240px;
  }
}

</style>
