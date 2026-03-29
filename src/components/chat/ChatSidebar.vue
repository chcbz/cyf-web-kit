<template>
  <div :class="['chat-sidebar', { show: showSidebar }]">
    <div class="chat-sidebar-header">
      <h3>历史会话</h3>
      <div>
        <var-button
          type="primary"
          class="chat-new-conversation-btn"
          @click="emit('new-conversation')"
        >+ 新会话</var-button>
      </div>
    </div>
    <div class="chat-conversation-list">
      <div
        v-for="conv in conversations"
        :key="conv.id"
        :class="['chat-conversation-item', { active: conv.id === activeConversationId }]"
        @click="emit('select-conversation', conv.id)"
      >
        <div class="chat-conversation-content">
          <div class="chat-conversation-title">
            {{ conv.title || '新会话' }}
          </div>
          <div class="chat-conversation-date">
            {{ formatDate(conv.lastUpdated) }}
          </div>
        </div>
        <var-button
          class="chat-delete-btn"
          type="danger"
          @click.stop.prevent="emit('delete-conversation', conv.id)"
        >删除</var-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue'

const props = defineProps({
  showSidebar: {
    type: Boolean,
    default: false
  },
  conversations: {
    type: Array,
    default: () => []
  },
  activeConversationId: {
    type: String,
    default: ''
  },
  formatDate: {
    type: Function,
    default: (date) => {
      if (!date) return ''
      const d = new Date(date)
      return d.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    }
  }
})

const emit = defineEmits(['new-conversation', 'select-conversation', 'delete-conversation'])
</script>

<style scoped>
.chat-sidebar {
  background-color: #ffffff;
  width: 320px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: fixed;
  top: 0;
  right: -320px;
  height: 100vh;
  z-index: 1000;
  box-shadow: -2px 0 20px rgba(0, 0, 0, 0.1);
  border-left: 1px solid var(--color-border);
}

.chat-sidebar.show {
  right: 0;
}

.chat-sidebar-header {
  padding: 24px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--color-background);
  position: sticky;
  top: 0;
  z-index: 10;
}

.chat-sidebar-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text, #333333);
}

.chat-conversation-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}

.chat-conversation-list::-webkit-scrollbar {
  width: 4px;
}

.chat-conversation-list::-webkit-scrollbar-track {
  background: transparent;
}

.chat-conversation-list::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 2px;
}

.chat-conversation-item {
  padding: 16px;
  border-radius: 12px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  border: 1px solid transparent;
  background: var(--color-background);
}

.chat-conversation-item:hover {
  background: var(--color-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.chat-conversation-item.active {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  box-shadow: 0 2px 12px rgba(var(--color-primary-rgb), 0.15);
}

.chat-conversation-content {
  flex: 1;
  min-width: 0;
  margin-left: 48px;
}

.chat-conversation-title {
  font-weight: 500;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  color: var(--color-text, #333333);
  line-height: 1.4;
}

.chat-conversation-date {
  font-size: 12px;
  color: var(--color-text-secondary, #666666);
  line-height: 1.3;
}

.chat-delete-btn {
  padding: 6px 12px;
  font-size: 12px;
  opacity: 0;
  visibility: hidden;
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  transition: all 0.2s ease;
  border-radius: 6px;
}

.chat-conversation-item:hover .chat-delete-btn {
  opacity: 1;
  visibility: visible;
}

/* 响应式设计 */
@media (max-width: 1024px) {
  .chat-sidebar {
    width: 380px;
  }
}

@media (max-width: 768px) {
  .chat-sidebar {
    width: 340px;
  }

  .chat-sidebar-header {
    padding: 20px;
  }

  .chat-sidebar-header h3 {
    font-size: 16px;
  }

  .chat-conversation-item {
    padding: 14px;
  }
}

@media (max-width: 640px) {
  .chat-sidebar {
    width: 300px;
  }

  .chat-sidebar-header {
    padding: 20px;
  }

  .chat-sidebar-header h3 {
    font-size: 16px;
  }

  .chat-conversation-item {
    padding: 14px;
  }
}

@media (max-width: 480px) {
  .chat-sidebar {
    width: 280px;
  }

  .chat-sidebar-header {
    padding: 16px;
    flex-direction: column;
    gap: 8px;
  }

  .chat-sidebar-header h3 {
    font-size: 14px;
  }

  .chat-conversation-title {
    font-size: 13px;
  }

  .chat-conversation-date {
    font-size: 11px;
  }

  /* 移动模式下删除按钮默认显示 */
  .chat-delete-btn {
    opacity: 1;
    visibility: visible;
  }
}
</style>