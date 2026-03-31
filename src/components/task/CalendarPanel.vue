<template>
  <div class="calendar-container">
    <div class="calendar-header">
      <var-button text @click="prevMonth">
        <var-icon name="chevron-left" />
      </var-button>
      <h2>{{ currentMonth }}</h2>
      <var-button text @click="nextMonth">
        <var-icon name="chevron-right" />
      </var-button>
    </div>

    <div class="calendar-grid">
      <div class="calendar-weekdays">
        <div v-for="day in weekdays" :key="day" class="weekday">
          {{ day }}
        </div>
      </div>

      <div class="calendar-days">
        <div
          v-for="day in calendarDays"
          :key="day.date"
          :class="[
            'day',
            {
              today: day.isToday,
              'current-month': day.isCurrentMonth,
              'has-tasks': day.taskCount > 0,
              'selected': selectedDate === day.date && day.isCurrentMonth
            }
          ]"
          @click="selectCalendarDay(day)"
        >
          <div class="day-number">{{ day.day }}</div>
          <div v-if="day.taskCount > 0" class="task-indicator">
            <div v-if="day.taskCount > 0" class="task-type-dots">
              <span
                v-if="day.typeCounts.notify > 0"
                class="type-dot type-notify"
                :style="{ opacity: Math.min(day.typeCounts.notify / 3, 1) }"
              ></span>
              <span
                v-if="day.typeCounts.target > 0"
                class="type-dot type-target"
                :style="{ opacity: Math.min(day.typeCounts.target / 3, 1) }"
              ></span>
              <span
                v-if="day.typeCounts.repayment > 0"
                class="type-dot type-repayment"
                :style="{ opacity: Math.min(day.typeCounts.repayment / 3, 1) }"
              ></span>
              <span
                v-if="day.typeCounts.income > 0"
                class="type-dot type-income"
                :style="{ opacity: Math.min(day.typeCounts.income / 3, 1) }"
              ></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import dayjs from 'dayjs'

const props = defineProps({
  monthTasks: {
    type: Array,
    default: () => []
  },
  modelValue: {
    type: String,
    default: dayjs().format('YYYY-MM-DD')
  }
})

const emit = defineEmits(['update:modelValue', 'monthChange'])

// 响应式数据
const currentDate = ref(dayjs())

// 常量
const weekdays = ['日', '一', '二', '三', '四', '五', '六']

// 计算属性
const currentMonth = computed(() => {
  return currentDate.value.format('YYYY年MM月')
})

const selectedDate = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const calendarDays = computed(() => {
  const startOfMonth = currentDate.value.startOf('month')
  const endOfMonth = currentDate.value.endOf('month')
  const startDay = startOfMonth.day()
  const daysInMonth = endOfMonth.date()

  const daysArray = []
  const today = dayjs().format('YYYY-MM-DD')

  // 上个月的最后几天
  const prevMonthDays = startDay
  for (let i = prevMonthDays - 1; i >= 0; i--) {
    const date = startOfMonth.subtract(i + 1, 'day')
    const dateStr = date.format('YYYY-MM-DD')
    const dayTasks = getTasksForDate(dateStr)
    daysArray.push(createDayObject(date, dateStr, today, dayTasks, false))
  }

  // 当前月的天数
  for (let i = 1; i <= daysInMonth; i++) {
    const date = startOfMonth.date(i)
    const dateStr = date.format('YYYY-MM-DD')
    const dayTasks = getTasksForDate(dateStr)
    daysArray.push(createDayObject(date, dateStr, today, dayTasks, true))
  }

  // 下个月的前几天
  const remainingCells = 42 - daysArray.length
  for (let i = 1; i <= remainingCells; i++) {
    const date = endOfMonth.add(i, 'day')
    const dateStr = date.format('YYYY-MM-DD')
    const dayTasks = getTasksForDate(dateStr)
    daysArray.push(createDayObject(date, dateStr, today, dayTasks, false))
  }

  return daysArray
})

// 方法
const createDayObject = (date, dateStr, today, dayTasks, isCurrentMonth) => {
  // 统计各种类型的任务数量
  const typeCounts = {
    notify: dayTasks.filter(task => task.type === 1).length,
    target: dayTasks.filter(task => task.type === 2).length,
    repayment: dayTasks.filter(task => task.type === 3).length,
    income: dayTasks.filter(task => task.type === 4).length
  }

  // 向后兼容：payCount 和 notifyCount
  const payCount = typeCounts.target + typeCounts.repayment + typeCounts.income
  const notifyCount = typeCounts.notify

  return {
    date: dateStr,
    day: date.date(),
    isCurrentMonth,
    isToday: dateStr === today,
    taskCount: dayTasks.length,
    payCount,
    notifyCount,
    typeCounts
  }
}

const getTasksForDate = (dateStr) => {
  return props.monthTasks.filter(task => {
    try {
      return dayjs(task.executeTime).format('YYYY-MM-DD') === dateStr
    } catch (_error) {
      return false
    }
  })
}

const prevMonth = () => {
  currentDate.value = currentDate.value.subtract(1, 'month')
  emit('monthChange', currentDate.value)
}

const nextMonth = () => {
  currentDate.value = currentDate.value.add(1, 'month')
  emit('monthChange', currentDate.value)
}

const selectCalendarDay = (day) => {
  if (!day.isCurrentMonth) {
    // 点击非当前月日期，切换到该月
    currentDate.value = dayjs(day.date)
    selectedDate.value = day.date
    emit('monthChange', currentDate.value)
    return
  }

  selectedDate.value = day.date
}

// 暴露方法供父组件调用
defineExpose({
  currentDate
})
</script>

<style scoped>
.calendar-container {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 16px;
  padding: 20px;
  margin: 16px;
  margin-bottom: 24px;
  color: white;
  box-shadow: 0 8px 32px rgba(102, 126, 234, 0.2);
}

.calendar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.calendar-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: white;
}

.calendar-header .var-button {
  color: white;
}

.calendar-grid {
  display: flex;
  flex-direction: column;
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  margin-bottom: 12px;
  font-weight: 500;
  opacity: 0.9;
}

.calendar-days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
}

.day {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  cursor: pointer;
  position: relative;
  transition: all 0.3s ease;
  padding: 4px;
}

.day:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateY(-2px);
}

.day.current-month {
  background: rgba(255, 255, 255, 0.05);
}

.day.today {
  background: rgba(255, 255, 255, 0.2);
  font-weight: bold;
}

.day.selected {
  background: rgba(255, 255, 255, 0.3);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.day-number {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 2px;
}

.day:not(.current-month) .day-number {
  opacity: 0.5;
}

.task-indicator {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.task-type-dots {
  display: flex;
  gap: 2px;
  justify-content: center;
}

.type-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.type-dot.type-notify {
  background: #4dabf7;
}

.type-dot.type-target {
  background: #fa8c16;
}

.type-dot.type-repayment {
  background: #f5222d;
}

.type-dot.type-income {
  background: #52c41a;
}

/* 响应式调整 */
@media (max-width: 375px) {
  .calendar-container {
    margin: 12px;
    padding: 16px;
  }

  .calendar-days {
    gap: 6px;
  }

  .day-number {
    font-size: 13px;
  }
}
</style>
