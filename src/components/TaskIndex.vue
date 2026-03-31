<template>
  <var-action-sheet
    v-model:show="showActionSheet"
    :actions="actionSheetActions"
    @select="handleActionSelect"
    @update:show="onActionSheetShowChange"
  />

  <!-- 日历面板 -->
  <CalendarPanel
    v-model="selectedDate"
    :month-tasks="monthTasks"
    @month-change="onMonthChange"
  />

  <!-- 任务列表 -->
  <TaskListPanel
    :tasks="listPlan"
    :selected-date="selectedDate"
    :task-detail-data="taskDetailData"
    @select="doShowDetail"
  />

  <!-- 任务详情弹窗 -->
  <TaskDetailDialog
    v-model:show="taskDetailShow"
    :task="currentTask"
    :detail-data="taskDetailData"
  />
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import { useGlobalStore } from '../stores/global'
import { taskApi } from '../composables/useHttp'
import { log } from '@/utils/logger'
import CalendarPanel from './task/CalendarPanel.vue'
import TaskListPanel from './task/TaskListPanel.vue'
import TaskDetailDialog from './task/TaskDetailDialog.vue'

const router = useRouter()
const { t } = useI18n()
const globalStore = useGlobalStore()

// 响应式数据
const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const monthTasks = ref([])
const listPlan = ref([])
const currentTask = ref(null)
const taskDetailShow = ref(false)
const taskDetailData = ref({})
const showActionSheet = ref(false)

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

const actionSheetActions = ref([
  { name: t('task.add'), key: 'add' },
  { name: t('app.task_list'), key: 'list' },
  { name: t('app.task_history'), key: 'history' }
])

// 方法
const getTasksForDate = (dateStr) => {
  return monthTasks.value.filter(task => {
    try {
      return dayjs(task.executeTime).format('YYYY-MM-DD') === dateStr
    } catch (_error) {
      log.warn('日期解析错误:', task.executeTime, _error)
      return false
    }
  })
}

const fetchTasks = async () => {
  try {
    const firstDay = dayjs().startOf('month')
    const lastDay = dayjs().endOf('month')
    const jiacn = globalStore.getJiacn

    taskApi.search('/item/search', {
      search: {
        jiacn,
        timeStart: firstDay.valueOf(),
        timeEnd: lastDay.valueOf()
      }
    }, {
      onSuccess: (data) => {
        monthTasks.value = Array.isArray(data.data) ? data.data : []

        // 更新选中日期的任务列表
        const dayTasks = getTasksForDate(selectedDate.value)
        listPlan.value = dayTasks
      },
      onError: (_error) => {
        log.error('获取任务失败:', _error)
        monthTasks.value = []
        listPlan.value = []
      }
    })
  } catch (_error) {
    log.error('任务请求异常:', _error)
  }
}

const onMonthChange = (newDate) => {
  // 月份变化时重新获取任务
  const firstDay = newDate.startOf('month')
  const lastDay = newDate.endOf('month')
  const jiacn = globalStore.getJiacn

  taskApi.search('/item/search', {
    search: {
      jiacn,
      timeStart: firstDay.valueOf(),
      timeEnd: lastDay.valueOf()
    }
  }, {
    onSuccess: (data) => {
      monthTasks.value = Array.isArray(data.data) ? data.data : []
      const dayTasks = getTasksForDate(selectedDate.value)
      listPlan.value = dayTasks
    },
    onError: (_error) => {
      log.error('获取任务失败:', _error)
      monthTasks.value = []
      listPlan.value = []
    }
  })
}

const doShowDetail = async (item) => {
  currentTask.value = item

  try {
    const data = await taskApi.getById('/get', item.planId)
    if (data?.data) {
      taskDetailData.value = {
        periodText: item.crond || periodMap[item.period] || '一次性任务',
        startTime: data.data.startTime,
        endTime: data.data.endTime
      }
    }
  } catch (_error) {
    log.warn('获取任务详情失败:', _error)
    taskDetailData.value = {
      periodText: item.crond || periodMap[item.period] || '一次性任务'
    }
  }

  taskDetailShow.value = true
}

// ActionSheet 处理
const handleActionSelect = (action) => {
  switch (action.key) {
    case 'add':
      router.push({ name: 'TaskAdd' })
      break
    case 'list':
      router.push({ name: 'TaskList' })
      break
    case 'history':
      router.push({ name: 'TaskHistory' })
      break
  }
}

const onActionSheetShowChange = (show) => {
  // 当 action sheet 隐藏且右侧边栏当前显示时，触发 toggleRightSidebar
  if (!show && globalStore.showRightSidebar) {
    globalStore.toggleRightSidebar()
  }
}

// 监听选中日期变化
watch(selectedDate, (newDate) => {
  const dayTasks = getTasksForDate(newDate)
  listPlan.value = dayTasks
})

// 监听右侧边栏显示状态
watch(
  () => globalStore.showRightSidebar,
  (newValue) => {
    showActionSheet.value = newValue
  }
)

// 生命周期
onMounted(() => {
  globalStore.setTitle(t('app.title'))
  globalStore.setShowBack(false)
  globalStore.setShowMore(true)

  fetchTasks()
})
</script>
