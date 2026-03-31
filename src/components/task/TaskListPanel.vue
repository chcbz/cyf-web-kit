<template>
  <!-- 任务列表区域 -->
  <div v-if="tasks.length > 0" class="tasks-section">
    <div class="tasks-header">
      <h3>{{ formattedDate }}</h3>
      <span class="tasks-count">{{ tasks.length }} 个任务</span>
    </div>
    <!-- 添加滚动容器 -->
    <var-list class="tasks-list">
      <var-cell
        v-for="item in tasks"
        :key="item.id"
        ripple
        @click="$emit('select', item)"
      >
        <template #default>
          <div class="task-title">
            <span class="task-type-badge" :class="getTaskTypeClass(item.type)">
              {{ typeDict(item.type) }}
            </span>
            <span class="task-name">{{ item.name }}</span>
          </div>
        </template>
        <template #description>
          <div class="task-description">
            <span class="task-time">
              {{ formatTaskTime(item) }}
            </span>
            <span v-if="item.description" class="task-desc-text">{{ item.description }}</span>
          </div>
        </template>
        <template #extra>
          <div class="task-extra">
            <span v-if="item.amount > 0" class="task-amount">
              ￥{{ formatAmount(item.amount) }}
            </span>
            <var-icon name="chevron-right" size="16" />
          </div>
        </template>
      </var-cell>
    </var-list>
  </div>

  <div v-else class="empty-tasks">
    <var-empty description="暂无任务" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import dayjs from 'dayjs'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  tasks: {
    type: Array,
    default: () => []
  },
  selectedDate: {
    type: String,
    default: dayjs().format('YYYY-MM-DD')
  },
  taskDetailData: {
    type: Object,
    default: () => ({})
  }
})

defineEmits(['select'])

const { t } = useI18n()

// 计算属性
const formattedDate = computed(() => {
  const date = dayjs(props.selectedDate)
  const today = dayjs()
  if (date.isSame(today, 'day')) {
    return `今天 (${date.format('MM月DD日')})`
  }
  return date.format('MM月DD日 dddd')
})

// 方法
const typeDict = (type) => {
  const typeMap = {
    1: t('task.type_notify'),
    2: t('task.type_target'),
    3: t('task.type_repayment'),
    4: t('task.type_fixed_income')
  }
  return typeMap[type] || t('task.type_notify')
}

const getTaskTypeClass = (type) => {
  const classMap = {
    1: 'type-notify',
    2: 'type-target',
    3: 'type-repayment',
    4: 'type-income'
  }
  return classMap[type] || 'type-notify'
}

const formatTaskTime = (task) => {
  try {
    if (task.type > 1) {
      // 支付任务显示执行时间
      return dayjs(task.executeTime).format('HH:mm')
    } else {
      // 通知任务显示时间段
      const start = dayjs(props.taskDetailData.startTime || task.executeTime)
      const end = dayjs(props.taskDetailData.endTime || task.executeTime)

      return `${start.format('HH:mm')}~${end.format('HH:mm')}`
    }
  } catch {
    return '时间未知'
  }
}

const formatAmount = (amount) => {
  return Number(amount).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}
</script>

<style scoped>
/* 任务列表样式 */
.tasks-section {
  margin: 0 16px 16px;
  background: white;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  /* 使用 flex 布局填充剩余空间 */
  flex: 1 1 auto;
  min-height: 160px;
  max-height: none;
}

.tasks-header {
  padding: 20px 20px 12px;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0; /* 防止头部被压缩 */
}

.tasks-header h3 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.tasks-count {
  font-size: 12px;
  color: #999;
}

.tasks-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
}

/* 任务单元格样式 */
.task-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-type-badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
  flex-shrink: 0;
}

.task-type-badge.type-notify {
  background: #f0f9ff;
  color: #4dabf7;
}

.task-type-badge.type-target {
  background: #fff7e6;
  color: #fa8c16;
}

.task-type-badge.type-repayment {
  background: #fff2f0;
  color: #f5222d;
}

.task-type-badge.type-income {
  background: #f6ffed;
  color: #52c41a;
}

.task-name {
  flex: 1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-description {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.task-desc-text {
  font-size: 13px;
  color: #666;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.task-time {
  font-size: 12px;
  color: #999;
  flex-shrink: 0;
}

.task-extra {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-amount {
  font-weight: 600;
  color: #ff6b6b;
  font-size: 14px;
}

.empty-tasks {
  margin: 32px 16px;
  text-align: center;
}

/* 滚动条样式 */
.tasks-list::-webkit-scrollbar {
  width: 6px;
}

.tasks-list::-webkit-scrollbar-track {
  background: #f5f5f5;
  border-radius: 3px;
}

.tasks-list::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
  transition: background 0.3s;
}

.tasks-list::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

/* Firefox 滚动条样式 */
.tasks-list {
  scrollbar-width: thin;
  scrollbar-color: #c1c1c1 #f5f5f5;
}

/* VarList 单元格样式调整 */
.tasks-list :deep(.var-cell) {
  padding: 12px 16px;
  min-height: 60px;
}

.tasks-list :deep(.var-cell__title) {
  flex: 1;
  min-width: 0;
}

/* 响应式调整 */
@media (max-width: 375px) {
  .tasks-section {
    min-height: 160px;
  }

  .tasks-header {
    padding: 16px 16px 12px;
  }
}
</style>
