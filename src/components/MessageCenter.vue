<template>
  <div class="message-center">
    <header class="message-header">
      <div>
        <h2>{{ $t('message.title') }}</h2>
        <p>{{ $t('message.subtitle', { total: messageStore.total }) }}</p>
      </div>
      <var-button
        size="small"
        type="primary"
        text
        :disabled="!messageStore.hasUnread"
        @click="markAllRead"
      >
        {{ $t('message.mark_all_read') }}
      </var-button>
    </header>

    <div class="message-filters">
      <var-chip
        v-for="item in filters"
        :key="item.value"
        :type="activeFilter === item.value ? 'primary' : 'default'"
        size="small"
        @click="setFilter(item.value)"
      >
        {{ item.label }}
      </var-chip>
    </div>

    <var-loading v-if="messageStore.loading" class="message-loading" />

    <var-empty
      v-else-if="!messageStore.messages.length"
      :description="messageStore.error || $t('message.empty')"
    />

    <var-list v-else class="message-list">
      <var-cell
        v-for="message in messageStore.messages"
        :key="message.id"
        class="message-cell"
        @click="openMessage(message)"
      >
        <template #title>
          <div class="message-title-row">
            <span class="message-title">{{ message.title || $t('message.untitled') }}</span>
            <span v-if="message.status === MSG_STATUS.UNREAD" class="message-unread-dot"></span>
          </div>
        </template>
        <template #description>
          <div class="message-description">
            <span>{{ message.content || $t('message.no_content') }}</span>
            <small>{{ formatDate(message.updateTime || message.createTime) }}</small>
          </div>
        </template>
        <template #extra>
          <var-button
            v-if="message.status === MSG_STATUS.UNREAD"
            text
            type="primary"
            size="small"
            @click.stop="markRead(message.id)"
          >
            {{ $t('app.read') }}
          </var-button>
          <var-button
            text
            type="danger"
            size="small"
            @click.stop="recycle(message.id)"
          >
            {{ $t('app.del') }}
          </var-button>
        </template>
      </var-cell>
    </var-list>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { Dialog } from '@varlet/ui'
import { useI18n } from 'vue-i18n'
import { useGlobalStore } from '@/stores/global'
import { useMessageStore, MSG_STATUS } from '@/stores/message'

const { t } = useI18n()
const globalStore = useGlobalStore()
const messageStore = useMessageStore()
const activeFilter = ref('all')

const filters = computed(() => [
  { value: 'all', label: t('message.filter_all') },
  { value: 'unread', label: t('message.filter_unread') },
  { value: 'read', label: t('message.filter_read') }
])

const formatDate = (time) => {
  if (!time) return ''
  return new Date(time).toLocaleString()
}

const setFilter = async (filter) => {
  activeFilter.value = filter
  await messageStore.fetchMessages({ pageNum: 1, statusFilter: filter })
}

const markRead = async (id) => {
  await messageStore.markRead(id)
  if (activeFilter.value === 'unread') {
    await messageStore.fetchMessages({ pageNum: 1, statusFilter: activeFilter.value })
  }
}

const markAllRead = async () => {
  await messageStore.markAllRead()
  await messageStore.fetchMessages({ pageNum: 1, statusFilter: activeFilter.value })
}

const recycle = async (id) => {
  await messageStore.recycle(id)
}

const openMessage = async (message) => {
  if (message.status === MSG_STATUS.UNREAD) {
    await messageStore.markRead(message.id)
  }

  Dialog({
    title: message.title || t('message.untitled'),
    message: message.content || t('message.no_content'),
    confirmButtonText: t('app.confirm')
  })
}

onMounted(async () => {
  globalStore.setTitle(t('message.title'))
  globalStore.setShowBack(false)
  globalStore.setShowMore(false)
  await messageStore.fetchMessages({ statusFilter: activeFilter.value })
  await messageStore.fetchUnreadTotal()
})
</script>

<style scoped>
.message-center {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: var(--color-body);
}

.message-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.message-header h2 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 600;
}

.message-header p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.message-filters {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.message-loading {
  min-height: 180px;
}

.message-list {
  border-radius: 8px;
  overflow: hidden;
}

.message-cell {
  cursor: pointer;
}

.message-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.message-title {
  font-weight: 600;
}

.message-unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-danger);
  flex: 0 0 auto;
}

.message-description {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--color-text-secondary);
}

.message-description span {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.message-description small {
  font-size: 12px;
}

@media (min-width: 768px) {
  .message-center {
    padding: 24px;
  }
}
</style>
