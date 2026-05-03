<template>
  <div :class="['chat-sidebar', { show: showSidebar }]" @keyup.esc="handleEscKey">
    <div class="chat-sidebar-header">
      <div class="chat-sidebar-title-row">
        <div class="chat-sidebar-left">
          <h3>历史会话</h3>
          <span class="chat-conversation-count">{{ conversations.length }} 个会话</span>
        </div>
        <div class="chat-sidebar-right" @click.stop @keyup.stop>
          <var-input
            v-model="searchQuery"
            placeholder="搜索..."
            size="small"
            class="chat-search-input"
            clearable
          >
            <template #prefix>
              <var-icon name="magnify" size="16px" />
            </template>
          </var-input>
        </div>
      </div>
      <var-button
        type="primary"
        block
        class="chat-new-conversation-btn"
        @click="emit('new-conversation')"
      >
        <var-icon name="plus" size="16px" />
        新会话
      </var-button>
    </div>


    <div class="chat-conversation-list" ref="listRef">
      <!-- 空状态 -->
      <div v-if="sortedAndFilteredConversations.length === 0" class="chat-empty-state">
        <var-icon name="chat-outline" size="64px" class="chat-empty-icon" />
        <p v-if="searchQuery">未找到匹配的会话</p>
        <p v-else>暂无历史会话</p>
        <p class="chat-empty-hint">开始一个新会话吧！</p>
      </div>

      <div
        v-for="conv in sortedAndFilteredConversations"
        :key="conv.id"
        :class="['chat-conversation-item', { active: conv.id === activeConversationId }]"
        @click.stop="handleItemClick(conv.id)"
      >
        <div class="chat-conversation-icon">
          <var-icon :name="conv.id === activeConversationId ? 'chat-processing' : 'chat'" size="24px" />
        </div>
        <div class="chat-conversation-content" @click.stop="handleItemClick(conv.id)">
        <div class="chat-conversation-title" @click.stop="startEdit(conv)">
            <span v-if="editingId !== conv.id" class="title-text">
              {{ conv.title || '新会话' }}
              <var-icon v-if="editingId !== conv.id" name="pencil" size="12px" class="edit-hint" />
            </span>
            <var-input
              v-else
              v-model="editingTitle"
              size="small"
              autofocus
              @click.stop
              @keyup.stop
              @keydown.stop
              @blur.stop="handleBlur"
            />
          </div>
          <div class="chat-conversation-date">
            <var-icon name="clock-outline" size="12px" />
            {{ formatDate(conv.lastUpdated) }}
          </div>
        </div>
        <div class="chat-conversation-actions">
          <var-tooltip content="编辑标题" placement="top">
            <var-button
              v-if="editingId !== conv.id"
              class="chat-action-btn"
              type="primary"
              text
              @click.stop.prevent="startEdit(conv)"
            >
              <var-icon name="pencil" size="16px" />
            </var-button>
          </var-tooltip>
          <var-tooltip content="保存" placement="top">
            <var-button
              v-if="editingId === conv.id"
              class="chat-action-btn save"
              type="success"
              text
              @click.stop.prevent="saveTitle(conv.id)"
            >
              <var-icon name="check" size="16px" />
            </var-button>
          </var-tooltip>
          <var-tooltip content="删除会话" placement="top">
            <var-button
              class="chat-action-btn delete"
              type="danger"
              text
              @click.stop.prevent="confirmDelete(conv)"
            >
              <var-icon name="delete" size="16px" />
            </var-button>
          </var-tooltip>
        </div>
      </div>
    </div>

    <div class="chat-sidebar-footer">
      <span class="chat-shortcut-hint">按 ESC 关闭</span>
    </div>

    <!-- 删除确认对话框 -->
    <var-dialog
      v-model:show="showDeleteDialog"
      :title="deleteDialogTitle"
      :message="deleteDialogMessage"
      confirm-button
      :confirm-button-text="deleteDialogType === 'all' ? '清空' : '删除'"
      :confirm-button-text-type="deleteDialogType === 'all' ? 'danger' : 'primary'"
      cancel-button
      cancel-button-text="取消"
      @confirm="handleConfirmDelete"
    />
  </div>
</template>

<script setup>
import { ref, computed, defineProps, defineEmits, watch, nextTick, onUnmounted } from 'vue'

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

const emit = defineEmits(['new-conversation', 'select-conversation', 'delete-conversation', 'update-title'])

// 搜索
const searchQuery = ref('')
const listRef = ref(null)

// 编辑状态
const editingId = ref(null)
const editingTitle = ref('')

// 删除确认对话框
const showDeleteDialog = ref(false)
const deleteDialogTitle = ref('')
const deleteDialogMessage = ref('')
const deleteDialogType = ref('single') // 'single' | 'all'
const pendingDeleteId = ref(null)

// 处理会话项点击
const handleItemClick = (id) => {
  // 如果正在编辑，则不触发选择
  if (editingId.value) {
    return
  }
  emit('select-conversation', id)
}

// 计算属性：过滤的会话列表
const sortedAndFilteredConversations = computed(() => {
  let result = [...props.conversations]
  
  // 搜索过滤
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(conv => 
      (conv.title || '新会话').toLowerCase().includes(query)
    )
  }
  
  // 按时间排序（默认）
  result.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
  
  return result
})

// 开始编辑标题
const startEdit = (conv) => {
  editingId.value = conv.id
  editingTitle.value = conv.title || '新会话'
}

// 保存标题
const saveTitle = (id) => {
  if (editingTitle.value.trim()) {
    emit('update-title', id, editingTitle.value.trim())
  }
  editingId.value = null
  editingTitle.value = ''
}

// 处理失焦事件
const handleBlur = (e) => {
  // 检查是否点击了保存按钮，如果是则不阻止默认行为
  const relatedTarget = e.relatedTarget
  if (relatedTarget && relatedTarget.closest('.chat-action-btn.save')) {
    return
  }
  // 否则阻止失焦导致的事件冒泡，并保存标题
  e.stopPropagation()
  if (editingId.value) {
    saveTitle(editingId.value)
  }
}

// 确认删除单个会话
const confirmDelete = (conv) => {
  deleteDialogType.value = 'single'
  deleteDialogTitle.value = '确认删除'
  deleteDialogMessage.value = `确定要删除会话"${conv.title || '新会话'}"吗？删除后无法恢复。`
  pendingDeleteId.value = conv.id
  showDeleteDialog.value = true
}

// 处理删除确认
const handleConfirmDelete = () => {
  if (pendingDeleteId.value) {
    emit('delete-conversation', pendingDeleteId.value)
  }
  showDeleteDialog.value = false
  pendingDeleteId.value = null
}

// ESC 键关闭侧边栏
const handleEscKey = () => {
  if (props.showSidebar) {
    emit('close-sidebar')
  }
}

// 监听侧边栏显示状态，添加键盘监听
watch(() => props.showSidebar, (isShow) => {
  if (isShow) {
    nextTick(() => {
      document.addEventListener('keyup', handleEscKey)
    })
  } else {
    document.removeEventListener('keyup', handleEscKey)
  }
})

// 清理
onUnmounted(() => {
  document.removeEventListener('keyup', handleEscKey)
})
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
  padding: 20px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
  position: sticky;
  top: 0;
  z-index: 10;
}

.chat-sidebar-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  gap: 12px;
}

.chat-sidebar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.chat-sidebar-left h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text, #333333);
}

.chat-sidebar-right {
  flex-shrink: 0;
}

.chat-conversation-count {
  font-size: 12px;
  color: var(--color-text-secondary, #666666);
  background: var(--color-hover);
  padding: 2px 8px;
  border-radius: 10px;
}

.chat-search-input {
  width: 120px;
}

.chat-new-conversation-btn {
  width: 100%;
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

.chat-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.chat-empty-icon {
  color: var(--color-text-secondary, #ccc);
  margin-bottom: 16px;
  opacity: 0.5;
}

.chat-empty-state p {
  margin: 0;
  color: var(--color-text-secondary, #666);
  font-size: 14px;
}

.chat-empty-hint {
  margin-top: 8px !important;
  font-size: 12px !important;
  color: var(--color-text-secondary, #999) !important;
}

.chat-conversation-item {
  padding: 14px;
  border-radius: 12px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  border: 1px solid transparent;
  background: var(--color-background);
  display: flex;
  align-items: flex-start;
}

.chat-conversation-item:hover {
  background: var(--color-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.chat-conversation-item.active {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  box-shadow: 0 2px 12px rgba(var(--color-primary-rgb), 0.15);
}

.chat-conversation-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--color-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  flex-shrink: 0;
  color: var(--color-primary);
}

.chat-conversation-item.active .chat-conversation-icon {
  background: var(--color-primary);
  color: white;
}

.chat-conversation-content {
  flex: 1;
  min-width: 0;
}

.chat-conversation-title {
  font-weight: 500;
  margin-bottom: 4px;
  font-size: 14px;
  color: var(--color-text, #333333);
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-conversation-title .title-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
}

.chat-conversation-title .edit-hint {
  opacity: 0;
  color: var(--color-text-secondary);
  transition: opacity 0.2s;
  flex-shrink: 0;
}

.chat-conversation-item:hover .edit-hint {
  opacity: 0.6;
}

.chat-conversation-date {
  font-size: 12px;
  color: var(--color-text-secondary, #666666);
  display: flex;
  align-items: center;
  gap: 4px;
}

.chat-conversation-actions {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s ease;
  display: flex;
  gap: 2px;
  background: white;
  border-radius: 8px;
  padding: 2px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.chat-conversation-item:hover .chat-conversation-actions {
  opacity: 1;
  visibility: visible;
}

.chat-action-btn {
  padding: 6px;
  border-radius: 6px;
}

.chat-action-btn :deep(.var-icon) {
  display: block;
}

.chat-sidebar-footer {
  padding: 16px 20px;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--color-background);
}

.chat-shortcut-hint {
  font-size: 12px;
  color: var(--color-text-secondary, #999);
}

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
    padding: 16px;
  }

  .chat-sidebar-header h3 {
    font-size: 16px;
  }

  .chat-conversation-item {
    padding: 12px;
  }
}

@media (max-width: 640px) {
  .chat-sidebar {
    width: 300px;
  }
}

@media (max-width: 480px) {
  .chat-sidebar {
    width: 280px;
  }

  .chat-sidebar-title-row {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }

  .chat-sidebar-left {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .chat-sidebar-left h3 {
    font-size: 16px;
  }

  .chat-search-input {
    width: 100px;
  }

  .chat-sidebar-footer {
    flex-direction: column;
    gap: 8px;
  }
}
</style>
