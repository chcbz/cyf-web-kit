<template>
  <div class="order-list-container">
    <var-action-sheet
      v-model:show="showOpMenu"
      :actions="opMenu"
      @select="onClickOpMenu"
    />

    <div v-if="list.length > 0" class="orders-section">
      <div class="orders-header">
        <h3>{{ $t('gift.order_list') }}</h3>
        <span class="orders-count">{{ list.length }} 个订单</span>
      </div>

      <div class="orders-list-container">
        <var-list>
          <var-cell
            v-for="item in list"
            :key="item.id"
            ripple
            @click="doShowOpMenu(item)"
          >
            <template #default>
              <div class="order-item">
                <div v-if="item.picUrl" class="order-image-container">
                  <img :src="item.picUrl" :alt="item.title" class="order-image" />
                </div>
                <div class="order-info">
                  <div class="order-title">
                    <span class="order-name">{{ item.title }}</span>
                    <span class="order-status-badge" :class="getStatusClass(item.status)">
                      {{ getStatusText(item.status) }}
                    </span>
                  </div>
                  <div class="order-description">{{ item.desc }}</div>
                  <div class="order-meta">
                    <div class="order-price-section">
                      <span class="order-price">
                        {{ item.meta.source }}
                      </span>
                      <span class="order-quantity">
                        {{ $t('gift.quantity_title', { quantity: item.quantity || 1 }) }}
                      </span>
                    </div>
                    <div class="order-date">
                      <var-icon name="calendar" size="14" />
                      <span>{{ item.meta.date }}</span>
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

    <div v-else class="empty-orders">
      <var-empty :description="$t('order.empty')" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import { Dialog } from '@varlet/ui'
import { useGlobalStore } from '@/stores/global'
// import { useApiStore } from '@/stores/api' // 预留
// import { useUtilStore } from '@/stores/util' // 预留
import { giftApi } from '@/composables/useHttp'

// 路由器
const router = useRouter()
const { t } = useI18n()

// Pinia stores
const globalStore = useGlobalStore()
// const apiStore = useApiStore() // 预留
// const utilStore = useUtilStore() // 预留

// 响应式数据
const list = ref([])
const opMenu = ref([])
const showOpMenu = ref(false)
const selectId = ref(0)

// 计算属性
const statusMap = computed(() => ({
  0: t('order.status_unpaid'),
  1: t('order.status_paid'),
  5: t('order.status_canceled')
}))

// 方法
const getStatusClass = (status) => {
  switch (status) {
    case 0: return 'status-unpaid'
    case 1: return 'status-paid'
    case 5: return 'status-canceled'
    default: return 'status-unknown'
  }
}

const getStatusText = (status) => {
  return statusMap.value[status] || t('order.status_unknown')
}

const doShowOpMenu = (item) => {
  selectId.value = item.id
  if (item.status === 1) {
    opMenu.value = [{ key: 'cancel', name: t('gift.cancel') }]
  } else if (item.status === 0 || item.status === 5) {
    opMenu.value = [{ key: 'del', name: t('gift.del') }]
  }
  showOpMenu.value = true
}

const handleDialogResponse = (data, successMessage, onSuccessCallback) => {
  if (data.code === 'E0') {
    Dialog({
      title: t('app.notify'),
      message: data.data.msg || successMessage,
      onConfirm: () => {
        if (onSuccessCallback) {
          onSuccessCallback()
        }
      }
    })
  } else {
    Dialog({
      title: t('app.alert'),
      message: data.data.msg
    })
  }
}

const onClickOpMenu = (item) => {
  if (item.key === 'del') {
    Dialog({
      title: t('gift.del_alert'),
      message: '',
      onConfirm: () => {
        giftApi.update('/usage/delete/' + selectId.value, {}, {
          onSuccess: (data) => {
            handleDialogResponse(data, t('app.notify'), () => {
              router.go(0)
            })
          }
        })
      }
    })
  } else if (item.key === 'cancel') {
    Dialog({
      title: t('gift.cancel_alert'),
      message: '',
      onConfirm: () => {
        giftApi.update('/usage/cancel/' + selectId.value, {}, {
          onSuccess: (data) => {
            handleDialogResponse(data, t('app.notify'), () => {
              router.go(0)
            })
          }
        })
      }
    })
  }
}

const fetchOrders = () => {
  const jiacn = globalStore.getJiacn
  giftApi.search('/usage/list/user/' + jiacn, {
    pageNum: 1,
    pageSize: 999,
    orderBy: 'create_time desc'
  }, {
    onSuccess: (data) => {
      list.value = []
      data.data.forEach((element) => {
        const orderItem = {
          id: element.id,
          title: element.name,
          desc: element.description,
          status: element.status,
          picUrl: element.picUrl,
          quantity: element.quantity,
          meta: {
            source: element.point ? element.point + t('gift.point') : '￥' + element.price,
            date: dayjs(element.createTime).format('YYYY-MM-DD'),
            other:
              t('gift.quantity_title', {
                quantity: element.quantity
              }) +
              '　' +
              statusMap.value[element.status]
          }
        }
        list.value.push(orderItem)
      })
    }
  })
}

// 生命周期
onMounted(() => {
  globalStore.setTitle(t('gift.order_list'))
  globalStore.setShowBack(true)
  globalStore.setShowMore(false)
  fetchOrders()
})
</script>

<style scoped>
.order-list-container {
  min-height: 100vh;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  padding: 16px;
}

.orders-section {
  background: white;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 100px);
}

.orders-header {
  padding: 20px 20px 12px;
  border-bottom: 1px solid #f0f0f0;
}

.orders-header h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.orders-count {
  font-size: 12px;
  color: #999;
}

.orders-list-container {
  flex: 1;
  overflow-y: auto;
  max-height: calc(100vh - 180px);
}

.order-item {
  display: flex;
  gap: 12px;
  padding: 12px 0;
}

.order-image-container {
  flex-shrink: 0;
  width: 80px;
  height: 80px;
  border-radius: 8px;
  overflow: hidden;
  background: #f5f5f5;
}

.order-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.order-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
}

.order-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.order-name {
  font-size: 15px;
  font-weight: 600;
  color: #333;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  flex: 1;
}

.order-status-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 500;
  flex-shrink: 0;
}

.status-unpaid {
  background: #fff7e6;
  color: #fa8c16;
  border: 1px solid #fa8c16;
}

.status-paid {
  background: #f6ffed;
  color: #52c41a;
  border: 1px solid #52c41a;
}

.status-canceled {
  background: #fff2f0;
  color: #ff4d4f;
  border: 1px solid #ff4d4f;
}

.status-unknown {
  background: #f5f5f5;
  color: #8c8c8c;
  border: 1px solid #d9d9d9;
}

.order-description {
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

.order-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
}

.order-price-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.order-price {
  font-size: 14px;
  font-weight: 600;
  color: #ff6b6b;
}

.order-quantity {
  font-size: 12px;
  color: #999;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 4px;
}

.order-date {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #999;
}

.empty-orders {
  margin: 32px 16px;
  text-align: center;
}

/* 响应式调整 */
@media (max-width: 375px) {
  .order-list-container {
    padding: 12px;
  }

  .orders-header {
    padding: 16px 16px 10px;
  }

  .orders-header h3 {
    font-size: 15px;
  }

  .order-image-container {
    width: 70px;
    height: 70px;
  }

  .order-name {
    font-size: 14px;
  }

  .order-description {
    font-size: 12px;
  }
}

@media (min-width: 376px) and (max-width: 768px) {
  .order-image-container {
    width: 90px;
    height: 90px;
  }
}

@media (min-width: 769px) {
  .order-list-container {
    max-width: 600px;
    margin: 0 auto;
    padding: 24px;
  }

  .order-image-container {
    width: 100px;
    height: 100px;
  }
}
</style>
