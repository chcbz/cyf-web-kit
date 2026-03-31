<template>
  <var-dialog
    v-model:show="visible"
    :title="task?.name"
    :confirm-button="false"
    :cancel-button="false"
  >
    <div v-if="task" class="task-detail-content">
      <div class="detail-section">
        <h4>任务信息</h4>
        <div class="detail-item">
          <span class="detail-label">任务类型:</span>
          <span class="detail-value">{{ typeText }}</span>
        </div>
        <div v-if="task.description" class="detail-item">
          <span class="detail-label">描述:</span>
          <span class="detail-value">{{ task.description }}</span>
        </div>
        <div v-if="task.amount > 0" class="detail-item">
          <span class="detail-label">金额:</span>
          <span class="detail-value amount">￥{{ formattedAmount }}</span>
        </div>
      </div>

      <div class="detail-section">
        <h4>时间信息</h4>
        <div class="detail-item">
          <span class="detail-label">执行时间:</span>
          <span class="detail-value">
            {{ formattedExecuteTime }}
          </span>
        </div>
        <div v-if="detailData.periodText" class="detail-item">
          <span class="detail-label">重复周期:</span>
          <span class="detail-value">{{ detailData.periodText }}</span>
        </div>
      </div>

      <div class="detail-actions">
        <var-button type="primary" block @click="closeDialog">
          关闭
        </var-button>
      </div>
    </div>
  </var-dialog>
</template>

<script setup>
import { computed } from 'vue'
import dayjs from 'dayjs'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  task: {
    type: Object,
    default: null
  },
  detailData: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:show'])
const { t } = useI18n()

// 双向绑定
const visible = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val)
})

// 常量
const periodMap = {
  0: '长期',
  1: '每年',
  2: '每月',
  3: '每周',
  5: '每日',
  11: '每小时',
  12: '每分钟',
  13: '每秒',
  6: '指定日期'
}

// 计算属性
const typeText = computed(() => {
  if (!props.task) return ''
  const typeMap = {
    1: t('task.type_notify'),
    2: t('task.type_target'),
    3: t('task.type_repayment'),
    4: t('task.type_fixed_income')
  }
  return typeMap[props.task.type] || t('task.type_notify')
})

const formattedAmount = computed(() => {
  if (!props.task?.amount) return '0.00'
  return Number(props.task.amount).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
})

const formattedExecuteTime = computed(() => {
  if (!props.task) return '时间未知'
  
  try {
    if (props.task.type > 1) {
      // 支付任务显示执行时间
      return dayjs(props.task.executeTime).format('YYYY-MM-DD HH:mm')
    } else {
      // 通知任务显示时间段
      const start = dayjs(props.detailData.startTime || props.task.executeTime)
      const end = dayjs(props.detailData.endTime || props.task.executeTime)

      return `${start.format('YYYY-MM-DD HH:mm')} ~ ${end.format('YYYY-MM-DD HH:mm')}`
    }
  } catch {
    return '时间未知'
  }
})

// 方法
const closeDialog = () => {
  visible.value = false
}

// 暴露给父组件
defineExpose({
  periodMap
})
</script>

<style scoped>
.task-detail-content {
  padding: 0 4px;
}

.detail-section {
  margin-bottom: 20px;
}

.detail-section h4 {
  margin: 0 0 12px 0;
  font-size: 15px;
  font-weight: 600;
  color: #333;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
}

.detail-item {
  display: flex;
  margin-bottom: 10px;
  font-size: 14px;
}

.detail-label {
  width: 80px;
  color: #666;
  flex-shrink: 0;
}

.detail-value {
  flex: 1;
  color: #333;
  word-break: break-word;
}

.detail-value.amount {
  font-weight: 600;
  color: #ff6b6b;
}

.detail-actions {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}
</style>
