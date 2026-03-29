<template>
  <div class="chat-capabilities">
    <h3>我可以帮您</h3>
    <div class="capabilities-grid">
      <div class="capability-item">
        <div class="capability-icon">🚂</div>
        <div class="capability-content">
          <h4>查火车票</h4>
          <p>查询余票、中转票、列车信息</p>
        </div>
      </div>
      <div class="capability-item">
        <div class="capability-icon">🗺️</div>
        <div class="capability-content">
          <h4>地图导航</h4>
          <p>地址解析、路线规划、周边搜索、天气查询</p>
        </div>
      </div>
      <div class="capability-item">
        <div class="capability-icon">📁</div>
        <div class="capability-content">
          <h4>文件操作</h4>
          <p>读写文件、管理目录、搜索文件</p>
        </div>
      </div>
      <div class="capability-item">
        <div class="capability-icon">🗄️</div>
        <div class="capability-content">
          <h4>数据库操作</h4>
          <p>查询数据、查看表结构</p>
        </div>
      </div>
      <div class="capability-item">
        <div class="capability-icon">🔍</div>
        <div class="capability-content">
          <h4>网络搜索</h4>
          <p>使用多种搜索引擎查找信息</p>
        </div>
      </div>
      <div class="capability-item">
        <div class="capability-icon">⏰</div>
        <div class="capability-content">
          <h4>时间服务</h4>
          <p>获取当前时间、时区转换</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// 这是一个纯展示组件，不需要逻辑
</script>

<style scoped>
.chat-capabilities {
  margin: 16px 0;
  text-align: left;
}

.chat-capabilities h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text, #333333);
  margin-bottom: 12px;
  text-align: center;
}

.capabilities-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}

.capability-item {
  display: flex;
  align-items: flex-start;
  padding: 10px;
  background: var(--color-card, #f8fafc);
  border-radius: 8px;
  border: 1px solid var(--color-border, #e5e7eb);
  transition: all 0.2s ease;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.capability-item:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  border-color: var(--color-primary);
}

.capability-icon {
  font-size: 18px;
  margin-right: 10px;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background);
  border-radius: 6px;
  border: 1px solid var(--color-border);
}

.capability-content {
  flex: 1;
}

.capability-content h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text, #333333);
  margin: 0 0 4px 0;
  line-height: 1.3;
}

.capability-content p {
  font-size: 12px;
  color: var(--color-text-secondary, #666666);
  margin: 0;
  line-height: 1.4;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .chat-capabilities {
    margin: 12px 0;
  }

  .chat-capabilities h3 {
    font-size: 15px;
    margin-bottom: 10px;
  }

  .capabilities-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin-bottom: 12px;
  }

  .capability-item {
    padding: 8px;
  }

  .capability-icon {
    font-size: 16px;
    width: 28px;
    height: 28px;
    margin-right: 8px;
  }

  .capability-content h4 {
    font-size: 13px;
  }

  .capability-content p {
    font-size: 11px;
  }
}

@media (max-width: 480px) {
  .chat-capabilities {
    margin: 10px 0;
  }

  .chat-capabilities h3 {
    font-size: 14px;
    margin-bottom: 8px;
  }

  .capabilities-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
    margin-bottom: 10px;
  }

  .capability-item {
    padding: 6px;
    border-radius: 6px;
  }

  .capability-icon {
    font-size: 14px;
    width: 24px;
    height: 24px;
    margin-right: 6px;
    border-radius: 4px;
  }

  .capability-content h4 {
    font-size: 12px;
    margin-bottom: 2px;
  }

  .capability-content p {
    font-size: 10px;
    line-height: 1.3;
  }
}

@media (max-width: 360px) {
  .capabilities-grid {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .capability-item {
    padding: 8px;
  }

  .capability-icon {
    font-size: 16px;
    width: 28px;
    height: 28px;
    margin-right: 10px;
  }

  .capability-content h4 {
    font-size: 13px;
  }

  .capability-content p {
    font-size: 11px;
  }
}
</style>