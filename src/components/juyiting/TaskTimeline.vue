<template>
  <section class="task-timeline" aria-labelledby="task-timeline-heading">
    <div class="task-section-heading">
      <h3 id="task-timeline-heading">协作时间线</h3>
      <span v-if="truncated" class="task-truncation" role="status">仅显示最近 100 条事件</span>
    </div>

    <p v-if="!events.length" class="task-empty-state">尚无可展示的协作事件。</p>

    <ol v-else class="task-timeline-list" aria-label="按事件版本升序的协作时间线">
      <li v-for="event in events" :key="event.version" class="task-timeline-item">
        <template v-if="event.redacted">
          <strong class="task-event-version">版本 {{ event.version }}</strong>
          <span class="task-redacted-event">此事件内容已脱敏。</span>
        </template>
        <template v-else>
          <strong class="task-event-version">版本 {{ event.version }}</strong>
          <span class="task-event-type" :title="event.eventType">{{ event.eventType }}</span>
          <span class="task-event-summary" :title="eventSummary(event)">{{ eventSummary(event) }}</span>
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

const eventSummary = event => {
  const actor = event.actorId ? `${event.actorType}:${event.actorId}` : event.actorType
  return `${actor} · ${event.aggregateType}:${event.aggregateId}`
}
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
