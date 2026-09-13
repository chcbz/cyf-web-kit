<template>
  <section class="work-item-board" aria-labelledby="work-item-board-heading">
    <div class="work-item-board-heading">
      <div>
        <h3 id="work-item-board-heading">工作项看板</h3>
        <p>状态、承办与依赖均以当前协作快照为准；系统负责依赖解锁。</p>
      </div>
      <span class="work-item-board-count">{{ entries.length }} 项</span>
    </div>

    <p v-if="!entries.length" class="work-item-board-empty">暂无工作项。</p>
    <div v-else class="work-item-board-columns" aria-label="按状态分组的工作项看板">
      <section v-for="column in columns" :key="column.status" class="work-item-board-column">
        <header>
          <h4>{{ column.label }}</h4>
          <span>{{ column.items.length }}</span>
        </header>
        <p v-if="!column.items.length" class="work-item-board-column-empty">暂无</p>
        <ol v-else>
          <li v-for="item in column.items" :key="item.workItemId" class="work-item-board-card">
            <div class="work-item-board-card-heading">
              <strong :title="item.title">{{ item.title }}</strong>
              <span v-if="item.requiredItem" class="work-item-required">必要</span>
            </div>
            <p>{{ item.description || '未提供工作项说明。' }}</p>
            <dl>
              <div><dt>承办</dt><dd :title="item.assigneeAgentId || '未指派'">{{ item.assigneeAgentId || '未指派' }}<template v-if="item.assigneeRole"> · {{ item.assigneeRole }}</template></dd></div>
              <div><dt>类型</dt><dd :title="item.workType">{{ item.workType }}</dd></div>
              <div><dt>尝试</dt><dd>{{ item.attemptCount }} / {{ item.maxAttempts }}</dd></div>
              <div v-if="item.leaseUntil"><dt>租约至</dt><dd :title="item.leaseUntil">{{ item.leaseUntil }}</dd></div>
            </dl>
            <div class="work-item-dependencies">
              <span>依赖</span>
              <p v-if="item.dependencyState === 'none'">无前置工作项。</p>
              <p v-else-if="item.dependencyState === 'invalid'">依赖数据不可用；请以服务端状态为准。</p>
              <template v-else>
                <ul>
                  <li v-for="dependency in item.dependencyItems" :key="dependency.workItemId" :title="dependency.workItemId">
                    {{ dependency.title }}<template v-if="dependency.status">（{{ dependency.status }}）</template><template v-else>（当前快照未包含）</template>
                  </li>
                </ul>
                <p v-if="item.remainingDependencyCount">另有 {{ item.remainingDependencyCount }} 项依赖未展开。</p>
                <p>{{ item.completedDependencyCount }} / {{ item.dependencyCount }} 项依赖已完成。</p>
                <p v-if="item.missingDependencyIds.length" class="work-item-board-warning">有 {{ item.missingDependencyIds.length }} 项依赖未在当前快照中提供。</p>
              </template>
            </div>
          </li>
        </ol>
      </section>
    </div>

    <p class="work-item-board-limit" role="note">当前支持查看进度，协作操作暂未开放。</p>
  </section>
</template>

<script setup>
import { toRef } from 'vue'
import { useHallWorkItemBoard } from '@/composables/juyiting/useHallWorkItemBoard'

const props = defineProps({ workspace: { type: Object, default: () => ({ workItems: [], members: [] }) } })
const { columns, entries } = useHallWorkItemBoard({ workspace: toRef(props, 'workspace') })
</script>

<style scoped>
.work-item-board { display: grid; gap: 10px; } .work-item-board-heading { display: flex; justify-content: space-between; gap: 12px; align-items: start; } h3, h4, p { margin: 0; } .work-item-board-heading p, .work-item-board-limit, .work-item-board-column-empty { color: #6b6253; font-size: 12px; } .work-item-board-count, .work-item-required { border-radius: 999px; background: #e7eee1; color: #23483e; padding: 2px 7px; font-size: 12px; white-space: nowrap; } .work-item-board-columns { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px, 1fr); gap: 10px; overflow-x: auto; padding-bottom: 4px; } .work-item-board-column { min-height: 150px; padding: 8px; border: 1px solid #d8d0bf; border-radius: 8px; background: #f9f5eb; } .work-item-board-column > header { display: flex; justify-content: space-between; gap: 8px; } .work-item-board-column > header span { color: #6b6253; font-size: 12px; } ol, ul { margin: 8px 0 0; padding: 0; list-style: none; } .work-item-board-card { display: grid; gap: 7px; margin-top: 8px; padding: 9px; border-radius: 7px; background: #fffdf6; box-shadow: 0 1px 2px rgba(51, 39, 22, .08); } .work-item-board-card-heading { display: flex; justify-content: space-between; gap: 8px; } .work-item-board-card strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .work-item-board-card p, .work-item-board-card dd, .work-item-board-card li { overflow-wrap: anywhere; } dl { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 8px; margin: 0; font-size: 12px; } dt { color: #6b6253; } dd { margin: 1px 0 0; } .work-item-dependencies { border-top: 1px solid #eee6d6; padding-top: 6px; font-size: 12px; } .work-item-dependencies > span { color: #6b6253; } .work-item-dependencies ul { display: grid; gap: 3px; list-style: disc; padding-left: 17px; } .work-item-board-warning { color: #9d4e19; } .work-item-board-limit { padding: 8px; border-left: 3px solid #b79b52; background: #fff8e7; }
</style>
