<template>
  <section class="task-timeline" aria-labelledby="task-timeline-heading">
    <div class="task-section-heading">
      <h3 id="task-timeline-heading">协作时间线</h3>
      <span v-if="truncated" class="task-truncation" role="status">仅显示最近 100 条事件</span>
    </div>

    <p v-if="!events.length" class="task-empty-state">尚无可展示的协作事件。</p>

    <ol v-else class="task-timeline-list" aria-label="按发生顺序排列的协作记录">
      <li v-for="event in events" :key="event.version" class="task-timeline-item">
        <template v-if="event.redacted">
          <span class="task-redacted-event">此记录的部分内容不可查看。</span>
        </template>
        <template v-else>
          <span class="task-event-type">{{ eventLabel(event.eventType) }}</span>
          <time class="task-event-time" :datetime="event.occurredAt">{{ event.occurredAt }}</time>
        </template>
      </li>
    </ol>
  </section>
</template>

<script setup>
defineProps({
  events: { type: Array, default: () => [] },
  truncated: { type: Boolean, default: false }
})

const eventLabel = type => ({ TASK_STARTED: '事项已开始', TASK_CREATED: '事项已创建', TASK_COMPLETED: '事项已完成', TASK_CANCELLED: '事项已取消', PROGRESS_REPORTED: '进度已更新', WORK_ITEM_LEASE_RELEASED: '工作项已释放', WORK_ITEM_CREATED: '已新增工作项', WORK_ITEM_COMPLETED: '工作项已完成', ARTIFACT_SUBMITTED: '已提交成果' })[type] || '协作记录已更新'
</script>

<style scoped>
.task-timeline {
  min-width: 0;
}

.task-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.task-section-heading h3 {
  margin: 0;
  color: #213d34;
  font-size: 15px;
}

.task-truncation {
  color: #76624b;
  font-size: 12px;
}

.task-empty-state {
  margin: 10px 0 0;
  color: #6c6258;
}

.task-timeline-list {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.task-timeline-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 10px;
  padding: 10px;
  border: 1px solid rgba(55, 79, 67, 0.16);
  border-radius: 8px;
  background: #fffdf7;
}

.task-event-version,
.task-event-type,
.task-event-summary,
.task-event-time,
.task-redacted-event {
  min-width: 0;
  overflow-wrap: anywhere;
}

.task-event-version {
  color: #315d4e;
  font-size: 12px;
}

.task-event-type {
  color: #4d4235;
  font-size: 12px;
  font-weight: 700;
}

.task-event-summary,
.task-event-time,
.task-redacted-event {
  grid-column: 1 / -1;
  color: #6c6258;
  font-size: 12px;
}

.task-redacted-event {
  color: #76503d;
}
</style>

<style scoped>
@media (max-width: 640px) {
  .task-section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .task-timeline-item {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-timeline-list {
    scroll-behavior: auto;
  }
}
</style>
