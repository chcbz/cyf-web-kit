<template>
  <div class="gift-list-container">
    <var-action-sheet
      v-model:show="showActionSheet"
      :actions="actionSheetActions"
      @select="handleActionSelect"
    />

    <div v-if="giftList.length > 0" class="gifts-section">
      <div class="gifts-header">
        <h3>{{ $t('gift.title') }}</h3>
        <span class="gifts-count">{{ giftList.length }} 个礼品</span>
      </div>

      <div class="gifts-list-container">
        <var-list>
          <var-cell
            v-for="gift in giftList"
            :key="gift.id"
            ripple
            @click="goToGiftPay(gift)"
          >
            <template #default>
              <div class="gift-item">
                <div class="gift-image-container">
                  <img :src="gift.picUrl" :alt="gift.name" class="gift-image" />
                </div>
                <div class="gift-info">
                  <div class="gift-title">
                    <span class="gift-name">{{ gift.name }}</span>
                    <span v-if="gift.virtual === 1" class="virtual-badge">虚拟</span>
                  </div>
                  <div class="gift-description">{{ gift.description }}</div>
                  <div class="gift-meta">
                    <div class="gift-price-section">
                      <span v-if="gift.point > 0" class="gift-point">
                        {{ gift.point }}{{ $t('gift.point') }}
                      </span>
                      <span v-if="gift.price > 0" class="gift-price">
                        ￥{{ formatPrice(gift.price) }}
                      </span>
                    </div>
                    <div class="gift-stock">
                      <span v-if="gift.quantity > 0" class="in-stock">库存: {{ gift.quantity }}</span>
                      <span v-else class="out-of-stock">已售罄</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </var-cell>
        </var-list>
        <var-back-top :duration="300" />
      </div>
    </div>

    <div v-else class="empty-gifts">
      <var-empty description="暂无礼品" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useGlobalStore } from '@/stores/global'
import { giftApi } from '@/composables/useHttp'
import { Dialog } from '@varlet/ui'

const router = useRouter()
const { t } = useI18n()
const globalStore = useGlobalStore()

// 响应式数据
const giftList = ref([])
const showActionSheet = ref(false)
const actionSheetActions = ref([
  { name: t('gift.order_list'), key: 'order_list' }
])

// 方法
const formatPrice = (price) => {
  // price 是分，转换为元
  return (price / 100).toFixed(2)
}

const goToGiftPay = (gift) => {
  router.push({
    name: 'GiftPay',
    query: { id: gift.id }
  })
}

const handleActionSelect = (action) => {
  switch (action.key) {
    case 'order_list':
      router.push({ name: 'OrderList' })
      break
  }
}

// 监听右侧边栏显示状态
watch(
  () => globalStore.showRightSidebar,
  (newValue) => {
    showActionSheet.value = newValue
  }
)

const fetchGiftList = () => {
  const jiacn = globalStore.getJiacn

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

  giftApi.search('/list', {
    search: {
      status: 1
    }
  }, {
    onSuccess: (data) => {
      if (data.code === 'E0') {
        giftList.value = Array.isArray(data.data) ? data.data : []
      } else {
        Dialog({
          title: t('app.alert'),
          message: data.msg
        })
        giftList.value = []
      }
    },
    onError: (error) => {
      console.error('获取礼品列表失败:', error)
      Dialog({
        title: t('app.error'),
        message: t('app.network_error')
      })
      giftList.value = []
    }
  })
}

// 生命周期
onMounted(() => {
  globalStore.setTitle(t('gift.title'))
  globalStore.setShowBack(false)
  globalStore.setShowMore(true)

  fetchGiftList()
})
</script>

<style scoped>
.gift-list-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  padding: 16px;
}

.gifts-section {
  background: white;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 100px);
}

.gifts-header {
  padding: 20px 20px 12px;
  border-bottom: 1px solid #f0f0f0;
}

.gifts-header h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.gifts-count {
  font-size: 12px;
  color: #999;
}

.gifts-list-container {
  flex: 1;
  overflow-y: auto;
  max-height: calc(100vh - 180px);
}

.gift-item {
  display: flex;
  gap: 12px;
  padding: 8px 0;
}

.gift-image-container {
  flex-shrink: 0;
  width: 80px;
  height: 80px;
  border-radius: 8px;
  overflow: hidden;
  background: #f5f5f5;
}

.gift-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gift-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0; /* 防止内容溢出 */
}

.gift-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.gift-name {
  font-size: 15px;
  font-weight: 600;
  color: #333;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.virtual-badge {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: #f0f9ff;
  color: #4dabf7;
  border: 1px solid #4dabf7;
  flex-shrink: 0;
}

.gift-description {
  font-size: 13px;
  color: #666;
  line-height: 1.4;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.gift-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
}

.gift-price-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gift-point {
  font-size: 13px;
  font-weight: 600;
  color: #ff6b6b;
  background: #fff5f5;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid #ff6b6b;
}

.gift-price {
  font-size: 14px;
  font-weight: 600;
  color: #ff6b6b;
}

.gift-stock {
  font-size: 12px;
}

.in-stock {
  color: #52c41a;
}

.out-of-stock {
  color: #999;
}

.empty-gifts {
  margin: 32px 16px;
  text-align: center;
}

/* 响应式调整 */
@media (max-width: 375px) {
  .gift-list-container {
    padding: 12px;
  }

  .gifts-header {
    padding: 16px 16px 10px;
  }

  .gifts-header h3 {
    font-size: 15px;
  }

  .gift-image-container {
    width: 70px;
    height: 70px;
  }

  .gift-name {
    font-size: 14px;
  }

  .gift-description {
    font-size: 12px;
  }
}

@media (min-width: 376px) and (max-width: 768px) {
  .gift-image-container {
    width: 90px;
    height: 90px;
  }
}

@media (min-width: 769px) {
  .gift-list-container {
    max-width: 600px;
    margin: 0 auto;
    padding: 24px;
  }

  .gift-image-container {
    width: 100px;
    height: 100px;
  }
}
</style>
