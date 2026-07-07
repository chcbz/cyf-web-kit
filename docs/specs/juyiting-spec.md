# 聚义厅 - Agent 协作大厅规格说明书

> **文档状态**：实施版 v0.9
> **创建日期**：2025-05
> **最后更新**：2026-07-04
> **目标读者**：产品团队、前端开发、后端开发、Agent 接入开发
> **版本范围**：当前 `cyf-web-kit` 聚义厅代码实现
> **依赖关系**：基于 `app-spec.md` 扩展

---

## 1. 项目概述

### 1.1 背景

聚义厅是 `cyf-web-kit` 中面向 Agent 协作管理的游戏化大厅。它以《水浒传》聚义场景为视觉和文案灵感，用于展示当前接入平台的 Agent、调度悬赏任务、发起公共或私密议事，并把项目案卷引入对话上下文。

当前实现已经从早期 DOM/CSS 大厅升级为 `melonJS` 驱动的 2.5D 场景：`/juyiting` 路由加载 `src/components/world/JuyiHall.vue`，主舞台由 `src/components/juyiting/HallStage.vue` 挂载 `src/game/JuyitingGame.js` 管理的 `melonJS` canvas。

### 1.2 当前目标

- 将活跃 Agent 以水浒人物原型在大厅中可视化展示。
- 支持点将册查看 Agent 名册、状态、能力和当前任务。
- 支持招贤令绑定或解绑人格，并生成本地/服务端接入配置。
- 支持悬赏榜的张榜、筛选、推荐、点将、自动点将、榜文议事和归档。
- 支持厅前议事的公共、榜文、私密三种会话上下文。
- 支持通过 SSE/流式响应接收 Agent 回话，并在异常时轮询恢复。
- 支持案卷阁检索项目案卷、议事旧录和长期记忆，并把引用写入传令。
- 支持移动端横竖屏切换、缩放、平移和触摸手势。

### 1.3 非目标

- 不在前端实现 Agent 客户端运行时。
- 不实现完整 108 将角色库、复杂关系网或养成系统。
- 不实现高精度 3D 建模或骨骼动画。
- 不在前端使用本地假数据替代后端 Agent/任务主数据；接口失败时应显示空态或错误态。

---

## 2. 代码结构

### 2.1 页面与组件

| 文件 | 责任 |
| --- | --- |
| `src/components/world/JuyiHall.vue` | 聚义厅页面编排层，组合数据、会话、任务、场景反馈、音效和弹窗 |
| `src/components/juyiting/HallStage.vue` | melonJS 场景挂载层，负责 canvas、场景重试、横竖屏、键盘和触摸缩放平移 |
| `src/components/juyiting/AgentPanel.vue` | 点将册，展示 Agent 名册和状态筛选 |
| `src/components/juyiting/BountyPanel.vue` | 悬赏榜，负责任务筛选、张榜、详情、点将、自动点将、议事和归档入口 |
| `src/components/juyiting/PersonaCatalogPanel.vue` | 招贤令，人格列表、绑定/解绑和接入配置展示 |
| `src/components/juyiting/PublicDiscussionPanel.vue` | 公共厅前议事 |
| `src/components/juyiting/BountyDiscussionPanel.vue` | 榜文议事 |
| `src/components/juyiting/PrivateDiscussionPanel.vue` | 与单个 Agent 密议 |
| `src/components/juyiting/LibraryPanel.vue` | 案卷阁检索和引用 |
| `src/components/juyiting/SelectedAgentCard.vue` | 当前选中 Agent 快捷摘要 |
| `src/components/juyiting/BountyActionIcon.vue` | 悬赏榜操作图标 |

### 2.2 Composable

| 文件 | 责任 |
| --- | --- |
| `src/composables/juyiting/useHallData.js` | 加载地图 Agent、名册、人格目录、悬赏任务、状态计数和推荐结果 |
| `src/composables/juyiting/useHallConversation.js` | 聚义厅会话加载、发送、流式响应、事件流、轮询恢复和 @ 提及 |
| `src/composables/juyiting/useHallChatContext.js` | 公共、榜文、私密三种会话上下文计算 |
| `src/composables/juyiting/useHallTaskActions.js` | 张榜、点将、自动点将、归档任务动作 |
| `src/composables/juyiting/useHallScene.js` | Agent 位置、巡逻路线、热点反馈、气泡和任务/案卷场景反馈 |
| `src/composables/juyiting/useHallLibrary.js` | 案卷阁检索和引用到传令输入框 |
| `src/composables/juyiting/useHallSound.js` | 大厅操作音效开关与播放 |
| `src/composables/juyiting/useWaterMarginRoles.js` | 水浒人物原型、头像样式和角色映射 |
| `src/composables/juyiting/hallConversationMessages.js` | 会话消息、SSE 事件和流式 payload 归一化 |

### 2.3 melonJS 场景

| 文件 | 责任 |
| --- | --- |
| `src/game/JuyitingGame.js` | melonJS 实例管理、资源加载、TMX 解析、场景启动和销毁 |
| `src/game/scenes/HallScene.js` | 舞台、图层、热点、Agent 同步、深度排序、点击、拖拽、滚轮和双指缩放 |
| `src/game/entities/HallAgent.js` | Agent 精灵、行走动画、状态、气泡、命中检测和巡逻 |
| `src/game/resources.js` | Boot-only resources plus TMX-derived map resource builder; no static map image manifest |
| `public/juyiting/hall.tmx` | 2.5D map image layers, tilesets, hotspots, and prop image declarations |
| `src/game/sceneTransform.js` | 场景平移、缩放、适配视口和屏幕坐标转换 |
| `src/game/tiledMap.js` | `public/juyiting/hall.tmx` 解析 |
| `src/game/walkableArea.js` | 可行走区域和点位裁剪 |

---

## 3. 场景与视觉资产

### 3.1 场景尺寸与引擎

- 原生场景尺寸：`1672 x 941`。
- 引擎：`melonJS 15.x`。
- canvas 挂载在 `.melon-layer`，由 `HallStage.vue` 管理生命周期。
- 场景支持 `fitToViewport()`，并对平移/缩放做边界裁剪。
- 桌面端支持鼠标滚轮缩放、拖拽平移、键盘 `+`/`-` 缩放和 `0` 复位。
- 移动端支持单指平移、双指缩放、横竖屏切换；横屏按钮会尝试 fullscreen + `screen.orientation.lock('landscape')`，失败时降级为应用内横屏模式。

### 3.2 资源清单

当前场景资源位于 `public/juyiting`：

| 资源 | 用途 |
| --- | --- |
| `hall.tmx` | Tiled 地图和热点数据来源 |
| `images/liangshan-hall-base-clean-v3.png` | Runtime tile background image referenced by `hall.tmx` |
| `images/liangshan-hall-mid-occluders-v3.png` | Runtime mid-occluder image layer referenced by `hall.tmx` |
| `images/liangshan-hall-foreground-occluders-v3.png` | Runtime foreground occluder image layer referenced by `hall.tmx` |
| `images/liangshan-hall-lighting-overlay-v3.png` | Runtime lighting overlay image layer referenced by `hall.tmx` |
| `images/props/*.png` | TMX-declared collection-of-images props such as main seat, bounty board, archive shelf, and roster book |
| `liangshan-character-walksheet-v1.png` | 角色行走图集，8 列 x 6 行 |

Runtime map art is loaded from TMX-derived resources only; missing TMX-declared images are logged and skipped instead of falling back to a JS map manifest.

### 3.3 热点

| 热点 ID | 面板 | 说明 |
| --- | --- | --- |
| `mainSeat` | `chat` | 厅前议事入口 |
| `agentRoster` | `agents` | 点将册入口 |
| `bountyBoard` | `tasks` | 悬赏榜入口 |
| `personaCatalog` | `catalog` | 招贤令入口 |
| `libraryShelf` | `library` | 案卷阁入口 |

热点需要支持状态反馈文案，例如“榜文已张”“荐单已出”“正在查卷”。这些反馈由 `useHallScene.js` 写入 `sceneHotspots`，再同步给 melonJS 场景。

---

## 4. Agent 与人格

### 4.1 Agent 状态

| 状态 | 业务含义 | 场景表现 |
| --- | --- | --- |
| `online` | 在线，可接收任务 | 候命/idle |
| `busy` | 正在执行任务 | 办事/busy，显示当前任务 |
| `offline` | 离线或不可用 | 出征/offline，不进入可点将范围 |
| `error` | 状态异常 | 失联/error，禁用点将 |

地图上只展示 `/agent/map` 返回且状态为 `online` 或 `busy` 的 Agent。点将册通过 `/agent/roster` 展示完整可筛选名册。

### 4.2 Agent 数据模型

```typescript
interface HallAgent {
  id?: string
  agentId: string
  name?: string
  personaName?: string
  personaCode?: string
  title?: string
  starName?: string
  avatar?: string
  status: 'online' | 'busy' | 'offline' | 'error'
  canOperate?: boolean
  systemAgent?: boolean
  abilities: string[]
  currentTask?: {
    id: string
    title: string
  }
  currentTaskId?: string
  currentTaskTitle?: string
  stats?: {
    success?: number
    failure?: number
    totalScore?: number
  }
}
```

### 4.3 人格目录

招贤令通过 `/agent/personas/catalog` 拉取人格目录。人格可以是系统 Agent、已绑定到当前用户、已被他人绑定或可绑定状态。

绑定接口：

```http
POST /agent/personas/{personaCode}/bind
```

请求体：

```json
{
  "mode": "local"
}
```

其中 `mode` 支持：

| 模式 | 说明 |
| --- | --- |
| `server` | 服务端代管或山寨安顿 |
| `local` | 用户本地接入，需要展示 `.env`、`codex-profiles.conf` 和启动命令 |

解绑接口：

```http
DELETE /agent/personas/{personaCode}/bind
```

本地接入说明需包含 `WS_URL`、`OPENCLAW_API_KEY`、`DEFAULT_CODEX_PROFILE`、`CODEX_PROFILES_FILE` 等变量，并支持复制配置。

---

## 5. 悬赏榜

### 5.1 功能

悬赏榜用于集中展示和调度 Agent 任务，当前实现支持：

- 按状态 tab 筛选，并展示状态计数。
- 按能力标签筛选。
- 按榜号/关键词搜索。
- 张榜创建任务。
- 打开任务详情弹窗。
- 点当前选中 Agent 领令。
- 勾选多个推荐 Agent 后批量点将。
- 宋江代为自动点将。
- 对已分配榜文发起榜文议事。
- 与推荐 Agent 私密议事。
- 收入案卷/归档。

### 5.2 任务状态

| 状态 | 文案 | 说明 |
| --- | --- | --- |
| `open` | 待点将 | 未分配 Agent，可点将 |
| `assigned` | 已点将 | 已有 `assignedAgentId` 或 `assignedAgentIds` |
| `running` | 在办 | Agent 正在执行 |
| `completed` | 交令 | 任务完成 |
| `failed` | 失手 | 任务失败 |
| `archived` | 入档 | 已归档 |

### 5.3 任务数据模型

```typescript
interface BountyTask {
  id: string
  title: string
  description?: string
  status: 'open' | 'assigned' | 'running' | 'completed' | 'failed' | 'archived'
  requiredAbilities: string[]
  assignedAgentId?: string
  assignedAgentIds?: string[]
  assignedAgentName?: string
  assignees?: Array<{
    agentId: string
    agentName?: string
  }>
  reward?: number
  updatedAt?: number
}
```

### 5.4 推荐模型

推荐接口：

```http
POST /agent/tasks/{taskId}/recommend
```

推荐结果支持：

```typescript
interface AgentRecommendation {
  agent: HallAgent
  score: number
  reason?: string
  abilityScore?: number
  statusScore?: number
  successScore?: number
  loadScore?: number
  recentScore?: number
  matchedAbilities?: string[]
  capability?: object
}
```

如果服务端没有返回推荐，前端基于在线 Agent 和能力匹配度计算最多 5 个候选。

---

## 6. 厅前议事

### 6.1 会话模式

| 模式 | `conversationScopeType` | `conversationScopeKey` | 用途 |
| --- | --- | --- | --- |
| 公共议事 | `public` | `public` | 面向全厅的公共传令 |
| 榜文议事 | `bounty` | `task:{taskId}` | 围绕某个悬赏任务讨论 |
| 私密议事 | `private` | `agent:{agentId}` 或 `task:{taskId}:agent:{agentId}` | 与单个 Agent 密议 |

发送消息时必须携带：

```typescript
interface HallChatRequest {
  content: string
  conversationId?: string
  conversationType: 'juyiting'
  conversationScopeType: 'public' | 'bounty' | 'private'
  conversationScopeKey: string
  targetAgentIds: string[]
  targetAgentId?: string
  taskId?: string
  forceNewConversation: boolean
  senderType: 'user'
  senderName: string
  metadata: {
    scene: 'juyiting'
    mode: 'public' | 'bounty' | 'private'
    scopeKey: string
    selectedAgentId?: string
    mentionAgentIds?: string[]
    participantAgentIds?: string[]
    targetAgentIds?: string[]
    selectedTaskId?: string
    libraryCitationId?: string
    librarySourceType?: string
  }
}
```

### 6.2 会话接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/chat/stream` | 发送聚义厅传令，使用流式响应 |
| `POST` | `/chat/conversation/list` | 按 `conversationType` 和 scope 查询最近会话 |
| `GET` | `/chat/conversation/content` | 获取会话内容 |
| `GET` | `/chat/conversation/events?id={conversationId}` | SSE 订阅会话事件 |

事件流中断时，前端应显示“正在续上传令”，2.5 秒后尝试重连；如果 Agent 回话还未落库，前端每 2 秒轮询会话内容，直到检测到 Agent 回复。

### 6.3 消息归一化

聚义厅消息至少支持：

```typescript
interface HallMessage {
  localId: string
  sender: 'USER' | 'ASSISTANT' | 'SYSTEM'
  senderType?: 'user' | 'agent' | 'system'
  senderName?: string
  agentId?: string
  content: string
  timestamp: number
  streaming?: boolean
  metadata?: object
}
```

`hallConversationMessages.js` 负责将历史消息、`agentDelivery` 流式片段、会话事件统一为上述结构。

---

## 7. 案卷阁

案卷阁用于检索项目案卷、议事旧录和长期记忆，并将摘要引用到当前传令输入框。

检索接口：

```http
POST /chat/library/search
```

请求参数：

```json
{
  "keyword": "关键词",
  "sourceType": "project",
  "topK": 8
}
```

`sourceType` 可选：

| 值 | 文案 |
| --- | --- |
| `project` | 项目案卷 |
| `meeting` / `conversation` | 议事旧录 |
| `daily_summary` | 日录 |
| `weekly_summary` | 周录 |
| `monthly_summary` | 月录 |
| `memory` 或空 | 长记 |

引用案卷时，前端将最多 120 字摘要追加到传令输入，并写入 `metadata.libraryCitationId` 与 `metadata.librarySourceType`。

---

## 8. API 汇总

### 8.1 Agent

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/agent/map` | 获取大厅地图上展示的活跃 Agent |
| `POST` | `/agent/roster` | 获取点将册 Agent 名册 |
| `GET` | `/agent/personas/catalog` | 获取招贤令人格目录 |
| `POST` | `/agent/personas/{personaCode}/bind` | 绑定人格并生成接入配置 |
| `DELETE` | `/agent/personas/{personaCode}/bind` | 解绑当前用户绑定的人格 |

### 8.2 悬赏任务

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/agent/tasks/search` | 查询悬赏任务 |
| `POST` | `/agent/tasks/status-counts` | 查询任务状态计数 |
| `POST` | `/agent/tasks` | 创建悬赏任务 |
| `POST` | `/agent/tasks/{taskId}/recommend` | 获取推荐 Agent |
| `POST` | `/agent/tasks/{taskId}/assign` | 手动点将，可传 `agentId` 和 `agentIds` |
| `POST` | `/agent/tasks/{taskId}/auto-assign` | 自动点将 |
| `POST` | `/agent/tasks/{taskId}/archive` | 任务归档 |

### 8.3 聊天与案卷

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/chat/stream` | 发送消息并接收流式响应 |
| `POST` | `/chat/conversation/list` | 查询会话列表 |
| `GET` | `/chat/conversation/content` | 查询会话内容 |
| `GET` | `/chat/conversation/events` | SSE 会话事件 |
| `POST` | `/chat/library/search` | 案卷阁检索 |

---

## 9. 场景反馈规则

场景反馈由 `useHallScene.js` 生成，并同步给 `HallStage.vue` / `JuyitingGame`：

| 事件 | Agent 表现 | 热点反馈 |
| --- | --- | --- |
| 点将成功 | 被点 Agent 移动到悬赏榜区域，`sceneStatus=busy`，显示“领令：{title}” | `bountyBoard` 显示“榜文已点将” |
| 批量点将 | 最多 4 个 Agent 进入显著运动状态 | `bountyBoard` 显示“{n} 位已领令” |
| 自动点将 | 同手动点将；无目标时只显示热点反馈 | `bountyBoard` 显示“宋江已点将” |
| 张榜 | 不移动 Agent | `bountyBoard` 显示“榜文已张” |
| 归档 | 不移动 Agent | `bountyBoard` 显示“收入案卷” |
| 榜文议事 | 参与 Agent 移动到议事区域，`sceneStatus=discuss` | `mainSeat` 显示“议：{title}” |
| 案卷检索 | 不移动 Agent | `libraryShelf` 显示“正在查卷/检得资料/查卷未成” |
| 案卷引用 | 不移动 Agent | `libraryShelf` 显示“案卷已引用” |
| Agent 回话 | Agent 显示气泡，`sceneStatus=talk` | 无 |

气泡文案必须截断，避免遮挡场景；同屏最多优先展示 3 条。

---

## 10. 验收标准

### 10.1 基础体验

- 访问 `/juyiting` 时默认展示全屏 melonJS 聚义厅场景。
- 场景资源缺失或引擎初始化失败时，页面展示可重试错误态，不影响弹窗和主页面生命周期清理。
- 点击热点可以打开对应面板；点击 Agent 可以选中并显示快捷摘要。
- 面板打开时，场景动画暂停，关闭后恢复。
- 移动端窄屏下，面板不出现文字重叠；横屏模式下顶部工具栏压缩显示图标。

### 10.2 数据与任务

- `/agent/map` 返回空或失败时，大厅不展示假 Agent。
- `/agent/roster` 失败时点将册显示空态，不影响大厅场景。
- 悬赏榜能筛选、搜索、展示状态计数。
- 任务详情可点当前 Agent、勾选多个推荐 Agent、自动点将、开榜文议事和归档。
- `open` 以外任务不可点将；离线、异常、`canOperate=false` 或 `systemAgent=true` 的 Agent 不可点将。

### 10.3 议事与案卷

- 公共、榜文、私密议事必须生成不同的 `conversationScopeKey`。
- 发送消息时必须带 `conversationType=juyiting` 和对应 metadata。
- SSE 中断时显示恢复状态并自动重连；Agent 未回话时启用轮询兜底。
- 案卷阁检索失败时只显示案卷阁错误，不阻断大厅或传令。

### 10.4 场景交互

- 鼠标滚轮、拖拽、键盘 `+`/`-`/`0`、移动端单指平移和双指缩放均不应产生黑边。
- Agent 位置必须被裁剪到可行走区域。
- Agent 深度排序按 y 坐标递增，避免近远遮挡错误。
- Map image layers, tiles, and prop images are loaded from `hall.tmx`; JS does not maintain map layer/image manifests.

---

## 11. 测试覆盖

当前相关测试集中在：

| 测试文件 | 覆盖重点 |
| --- | --- |
| `tests/juyiting-hall-data.test.js` | Agent/任务数据加载、筛选、推荐 |
| `tests/juyiting-hall-conversation.test.js` | 会话上下文、流式消息、事件恢复 |
| `tests/juyiting-hall-chat-context.test.js` | public/bounty/private scope 计算 |
| `tests/juyiting-component-behavior.test.js` | 聚义厅组件交互行为 |
| `tests/juyiting-hall-scene.test.js` | 场景状态、热点和反馈 |
| `tests/juyiting-hall-scene-runtime.test.js` | melonJS runtime 行为 |
| `tests/juyiting-melon-hall-scene.test.js` | melonJS 大厅场景渲染和交互 |
| `tests/juyiting-hall-assets.test.js` | 分层资源和 public 资产 |
| `tests/juyiting-scene-transform.test.js` | 平移缩放边界和坐标转换 |
| `tests/juyiting-walkable-area.test.js` | 可行走区域裁剪 |
| `tests/juyiting-tiled-map.test.js` | TMX 解析 |
| `tests/juyiting-portrait-roles.test.js` | 水浒角色映射 |
| `tests/juyiting-public-beta-preflight.mjs` | 发布前接口和配置检查 |
| `tests/juyiting-public-beta-ui-smoke.mjs` | UI 冒烟 |
| `tests/juyiting-agent-online-smoke.mjs` | Agent 在线冒烟 |

提交聚义厅相关改动前至少运行：

```bash
npm run test:run
```

涉及真实浏览器、后端灰度或线上联调时补充：

```bash
npm run test:juyiting:preflight
npm run test:juyiting:ui-smoke
npm run test:juyiting:agent-smoke
```

---

## 12. 后续增强

- 把 Agent WebSocket 状态推送进一步接入 `useHallData`，减少主动轮询。
- 增强 `/agent/tasks/{taskId}/recommend` 的解释字段，展示更细粒度的推荐原因。
- 为案卷阁增加来源跳转和引用预览。
- 扩展更多水浒人物图集行和角色配置，但保持当前 8x6 图集兼容。
- 补充低端移动设备下的 canvas 性能降级策略。

---

## 13. 相关文档

- 应用规格：`docs/specs/app-spec.md`
- 变更记录：`docs/changelogs/juyiting-changelog.md`
- 场景设计历史稿：`docs/superpowers/specs/2026-07-01-juyiting-melonjs-scene-design.md`
- melonJS 迁移计划历史稿：`docs/superpowers/plans/2026-07-01-juyiting-melonjs-scene-migration.md`

---

*文档结束*


### TMX-driven map resource contract

`public/juyiting/hall.tmx` is the single source of truth for map image layers, tile layers, tilesets, hotspots, and prop image declarations. `src/game/resources.js` keeps only boot resources and derives map image resources after TMX parsing. Do not add JS map-layer/image manifests; update TMX instead. The obsolete entrance prop layer has been removed from runtime assets.
