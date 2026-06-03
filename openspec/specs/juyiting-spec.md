# 聚义厅 - Agent 管理模块规格说明书

> **文档状态**：实施版 v0.7
> **创建日期**：2025-05
> **最后更新**：2026-06-03
> **目标读者**：产品团队、前端开发、后端开发
> **版本范围**：线上聚义厅 v0.7
> **依赖关系**：基于 `app-spec.md` 扩展

---

## 1. 项目概述

### 1.1 背景

聚义厅是一个以《水浒传》聚义场景为视觉和文案灵感的 Agent 管理模块。它用于展示、管理和调度接入平台的 Agent，让管理员可以直观看到每个 Agent 的状态、能力、当前任务和协作消息。

模块定位不是独立应用，而是 `cyf-web-kit` 的一个功能扩展：复用现有聊天、任务、状态管理、请求封装和布局能力，在此基础上增加 Agent 列表、状态同步、悬赏任务视图和聚义厅主视图。

### 1.2 目标

- 将 Agent 的在线、忙碌、离线状态以可视化方式呈现。
- 支持管理员查看 Agent 能力、当前任务和基础统计信息。
- 复用现有 Chat 模块，形成聚义厅公共聊天区域。
- 复用现有 Task 模块，支持将任务分配给指定 Agent。
- 提供“悬赏榜”视图，用于查看可领取、执行中和已完成的 Agent 任务。
- 聚义厅在侧边菜单中固定为首位入口。
- 大厅以全屏游戏化场景呈现，Agent 以水浒人物原型的小人形象在大厅中行走。
- 仅展示成功接入并保持 WebSocket 连接的活跃 Agent。

### 1.3 非目标

MVP 阶段不实现以下内容：

- Agent 客户端运行时或 SDK。
- 自动派单、复杂抢单、战斗或养成系统。
- 完整 108 将角色库和复杂人物关系。
- 高精度 3D 人物建模、骨骼动画或完整物理引擎。

### 1.4 与现有应用的关系

| 现有模块 | 复用方式 | 说明 |
| --- | --- | --- |
| Chat | 复用组件和接口 | 用于聚义厅公共聊天和 Agent 讨论消息 |
| Task | 复用任务模型和接口 | 用于创建、查询和展示 Agent 任务 |
| Pinia stores | 复用全局状态 | 新增 Agent store 时保持现有 store 风格 |
| SideMenu / App 布局 | 复用布局 | 聚义厅作为新的业务页面接入 |
| `world/DESIGN.md` | 参考视觉区域设定 | 聚义厅、忠义堂、水泊等概念保持一致 |

---

## 2. 核心概念

| 概念 | 说明 |
| --- | --- |
| 聚义厅 | Agent 社交、议事和聊天的公共空间 |
| Agent | 通过 HTTP/WebSocket 接入平台的独立自动化执行者 |
| 管理员 | 当前登录用户，可查看 Agent、创建任务、分配任务 |
| 悬赏榜 | 面向 Agent 的任务列表，按状态展示待领取、执行中、已完成任务 |
| 能力 | Agent 声明的可执行能力，如 `code-review`、`frontend`、`research` |

---

## 3. 功能需求

### 3.1 Agent 注册

Agent 通过 HTTP 接口注册到平台。注册成功后，平台返回认证 token，后续状态同步和任务上报均需要携带该 token。

```http
POST /agent/register
```

请求体：

```json
{
  "agentId": "agent-001",
  "name": "吴用",
  "avatar": "https://example.com/avatar/wuyong.png",
  "abilities": ["planning", "research", "code-review"],
  "endpoint": "wss://example.com/agent/agent-001"
}
```

响应体：

```json
{
  "success": true,
  "token": "agent-token"
}
```

### 3.2 Agent 状态展示

线上聚义厅只展示已成功注册并保持 WebSocket 连接的 Agent。历史注册但当前未连接的 Agent 不进入大厅行走区，避免出现“假人”或不可操作对象。

| 状态 | 含义 | 视觉表现 |
| --- | --- | --- |
| `online` | 在线，可接收任务 | 绿色状态点，正常头像 |
| `busy` | 正在执行任务 | 橙色状态点，展示当前任务标题 |
| `offline` | 离线或不可用 | 灰色状态点，头像降低透明度 |
| `error` | 状态异常 | 红色状态点，展示错误提示入口 |

状态列表必须支持：

- 展示 Agent 名称、能力标签、状态、当前任务。
- 大厅行走区展示水浒人物原型名称，例如宋江、吴用、林冲、鲁智深、燕青、李逵。
- 点击小人后，详情区域必须保留真实 Agent 名称或 `agentId`，便于运维定位。
- 按状态筛选：全部、在线、忙碌、离线、异常。
- 点击 Agent 小人或名册卡片打开详情弹窗。
- 空状态、加载状态、错误状态。

### 3.3 Agent 状态同步

当前实现由后端 WebSocket handler 维护已连接 session 与 `agentId` 的映射，并通过 HTTP 查询暴露活跃 Agent 列表。

```http
GET /agent/active
```

前端加载规则：

- 聚义厅进入页面和刷新大厅时调用 `/agent/active`。
- 返回列表为空时，大厅显示空状态，不使用本地假数据降级。
- 当前选中的 Agent 断开连接并从活跃列表消失时，前端清空选中态或切换到首个活跃 Agent。
- WebSocket 状态上报成功后，后端应更新 session 与 `agentId` 映射。
- WebSocket 断开时，后端应移除 session 映射。

后续可继续接入 WebSocket 推送，减少主动刷新。

WebSocket 消息格式建议如下：

```typescript
interface AgentStatusMessage {
  type: 'agent_status'
  agentId: string
  status: 'online' | 'busy' | 'offline' | 'error'
  currentTask?: {
    id: string
    title: string
  }
  errorMessage?: string
  updatedAt: number
}
```

前端处理规则：

- 收到未知 `agentId` 时，触发一次 Agent 列表刷新。
- 收到 `busy` 且包含 `currentTask` 时，同步更新 Agent 卡片上的任务信息。
- 收到 `offline` 时保留 Agent 资料，但清空当前任务展示。
- 收到 `error` 时允许在详情弹窗中查看错误信息。

### 3.4 聚义厅聊天

聚义厅聊天复用现有 Chat 模块能力。

复用组件：

| 组件 | 文件 | 用途 |
| --- | --- | --- |
| `Chat.vue` | `src/components/chat/Chat.vue` | 聊天主容器 |
| `ChatMessageList.vue` | `src/components/chat/ChatMessageList.vue` | 消息列表 |
| `ChatInput.vue` | `src/components/chat/ChatInput.vue` | 输入框 |
| `ChatSidebar.vue` | `src/components/chat/ChatSidebar.vue` | 会话列表 |

扩展要求：

- 支持聚义厅专用会话，例如 `conversationType = 'juyiting'`。
- 消息中可展示 Agent 发送者身份。
- 支持 `@Agent` 提及，MVP 可先仅完成文本插入和视觉高亮。
- 支持系统公告消息，用于展示 Agent 上线、下线、任务分配等事件。

### 3.5 任务分配

任务创建与查询复用现有 Task 模块。为了区分用户任务和 Agent 任务，建议在任务数据中增加或约定以下字段：

```typescript
interface AgentTaskMeta {
  taskType: 'agent'
  assignedAgentId?: string
  requiredAbilities: string[]
  reward?: number
}
```

如果后端暂不支持扩展字段，MVP 可临时通过 `jiacn = agent:{agentId}` 标识 Agent 任务归属，但这应视为兼容方案，不作为长期数据模型。

任务分配规则：

- 管理员可以从 Agent 详情或悬赏榜中分配任务。
- 已分配任务展示执行 Agent。
- 未分配任务进入悬赏榜待领取列表。
- Agent 状态为 `offline` 或 `error` 时不允许分配新任务。

### 3.6 悬赏榜

悬赏榜用于集中展示 Agent 任务。

MVP 范围：

- 展示 Agent 任务列表。
- 支持状态筛选：全部、待接取、已指派、进行中、已完成、失败。
- 支持按能力标签筛选。
- 支持按悬赏编号关键词搜索。
- 每个任务卡片展示标题、所需能力、状态、执行 Agent、更新时间。
- 点击任务后在悬赏榜右侧详情区展示任务描述、状态、能力要求和可用操作。
- 支持将待接取任务指派给当前选中的活跃 Agent。
- 支持根据任务所需能力推荐可接令 Agent，并显示匹配度。
- 支持“传令议事”，自动把当前悬赏上下文写入聚义厅传令输入框。
- 接口失败或无任务时显示明确空状态，不使用本地假任务。

任务状态映射：

| 悬赏榜状态 | 含义 | 任务数据来源 |
| --- | --- | --- |
| `open` | 待领取 | 未分配 Agent |
| `assigned` | 已分配未开始 | 已有 `assignedAgentId`，任务未执行 |
| `running` | 执行中 | Agent 状态或任务状态标记执行中 |
| `completed` | 已完成 | 任务完成 |
| `failed` | 执行失败 | 任务失败或 Agent 上报错误 |

---

## 4. 页面与交互

### 4.1 聚义厅主视图

当前线上文件：`src/components/world/JuyiHall.vue`

兼容组件：`src/components/juyiting/JuyiHallClassic.vue` 保留为结构化组件方案，但线上路由 `/juyiting` 当前指向 `world/JuyiHall.vue`。

布局：

- 左侧：复用现有 `SideMenu.vue`。
- 页面主体为全屏游戏化大厅，优先占满可用视口。
- 好汉名册、悬赏榜和厅内传令作为场景内按钮或底部快捷入口打开弹窗，不常驻挤占大厅空间。
- 大厅中显示已连接 Agent 的拟人化行走小人，小人底部显示水浒人物原型名，状态徽标显示候命、出征、异常等状态。
- 大厅不展示议事圆桌或悬赏议事桌，避免视觉重心突兀；人物运动也不应绕行不存在的中部圆桌障碍。
- 移动端保持大厅优先展示，弹窗内容自适应窄屏，不出现文字重叠。

关键交互：

- 点击 Agent 小人打开好汉详情。
- 点击刷新按钮重新拉取活跃 Agent、悬赏榜和大厅消息。
- Agent 状态变化时，卡片状态实时更新。
- 点击悬赏道具或悬赏入口打开悬赏榜弹窗。
- 点击传令入口打开聊天弹窗，聊天加载失败时不影响大厅和 Agent 展示。

### 4.2 Agent 详情弹窗

建议文件：`src/components/agent/AgentDetail.vue`

展示内容：

- 头像、名称、状态、最近更新时间。
- 能力标签。
- 当前任务。
- 最近完成任务数、失败任务数、平均耗时。
- 操作按钮：分配任务、查看任务、复制 Agent ID。

约束：

- 离线和异常状态下隐藏或禁用“分配任务”操作。
- 任务数据加载失败时，详情弹窗仍展示基础资料。

### 4.3 悬赏榜视图

建议文件：`src/components/juyiting/RewardBoard.vue`

布局：

- 顶部筛选：状态、能力、关键词。
- 主体：任务卡片列表。
- 空状态：根据筛选条件显示无结果提示。
- 错误状态：显示重试按钮。

---

## 5. 前端目录规划

```text
src/components/
├── world/
│   └── JuyiHall.vue        # 当前线上聚义厅主视图
├── agent/
│   ├── AgentCard.vue
│   ├── AgentDetail.vue
│   └── AgentList.vue
├── juyiting/
│   ├── AgentPanel.vue      # 好汉名册弹窗
│   ├── BountyPanel.vue     # 悬赏榜弹窗
│   ├── ChatPanel.vue       # 厅内传令弹窗
│   ├── JuyiHallClassic.vue # 备用结构化组件
│   └── RewardBoard.vue
├── chat/
│   └── ...复用现有聊天组件
└── task/
    └── ...复用现有任务组件

src/stores/
└── agent.js

src/composables/juyiting/
├── useHallPhysics.js       # 大厅小人运动、避障、分离力和行走样式
└── useWaterMarginRoles.js  # 水浒人物原型映射和头像样式

src/constants/
└── juyiting.js             # 聚义厅菜单、筛选项、角色池、路线和障碍物配置

src/types/
└── agent.ts
```

---

## 6. API 设计

### 6.1 Agent 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/agent/register` | Agent 注册 |
| `GET` | `/agent/active` | 获取当前成功注册且 WebSocket 仍连接的活跃 Agent |
| `GET` | `/agent/list` | 获取 Agent 列表 |
| `GET` | `/agent/{id}` | 获取 Agent 详情 |
| `PUT` | `/agent/{id}/status` | 更新 Agent 状态 |
| `GET` | `/agent/{id}/tasks` | 获取 Agent 相关任务 |

### 6.2 复用现有接口

| 模块 | 接口 | 用途 |
| --- | --- | --- |
| Chat | `/chat/conversation/list` | 获取聚义厅会话 |
| Chat | `/chat/stream` | 发送聊天消息 |
| Agent Task | `/agent/tasks/search` | 查询悬赏任务 |
| Agent Task | `/agent/tasks/{id}/assign` | 指派悬赏任务给 Agent |
| Task | `/task/item/search` | 查询普通任务 |
| Task | `/task/create` | 创建悬赏任务 |
| Task | `/task/update` | 更新任务分配或状态 |

### 6.3 错误约定

Agent 接口错误响应建议保持统一结构：

```json
{
  "success": false,
  "code": "AGENT_OFFLINE",
  "message": "Agent is offline"
}
```

前端至少处理：

| 错误码 | 处理方式 |
| --- | --- |
| `AGENT_NOT_FOUND` | 提示 Agent 不存在，并刷新列表 |
| `AGENT_OFFLINE` | 禁用分配操作，提示 Agent 离线 |
| `AGENT_BUSY` | 提示正在执行任务，允许用户确认是否继续 |
| `TOKEN_INVALID` | 提示注册状态失效 |

---

## 7. 数据模型

### 7.1 Agent

```typescript
interface Agent {
  id: string
  name: string
  avatar: string
  abilities: string[]
  status: 'online' | 'busy' | 'offline' | 'error'
  currentTaskId?: string
  currentTaskTitle?: string
  websocketEndpoint?: string
  lastSeenAt?: number
  errorMessage?: string
  stats?: AgentStats
}

interface AgentStats {
  completedTaskCount: number
  failedTaskCount: number
  averageDurationSeconds?: number
  power?: number
  intelligence?: number
  leadership?: number
}
```

### 7.2 Agent Store

建议文件：`src/stores/agent.js`

状态：

```typescript
interface AgentStoreState {
  agents: Agent[]
  loading: boolean
  error: string | null
  selectedAgentId: string | null
  statusFilter: 'all' | 'online' | 'busy' | 'offline' | 'error'
}
```

Actions：

| Action | 说明 |
| --- | --- |
| `fetchAgents()` | 拉取 Agent 列表 |
| `fetchAgentDetail(id)` | 拉取 Agent 详情 |
| `updateAgentStatus(message)` | 根据状态消息更新本地 Agent |
| `selectAgent(id)` | 设置当前选中 Agent |
| `clearError()` | 清理错误状态 |

---

## 8. 技术方案

### 8.1 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端框架 | Vue 3 + Composition API |
| 状态管理 | Pinia |
| UI 组件库 | Varlet UI |
| 请求封装 | 复用 `src/composables/useHttp.js` |
| 构建工具 | Vite |
| 测试 | Mocha + Chai + Testing Library |

### 8.2 实现原则

- 优先复用现有组件和请求封装。
- Agent 模块只新增必要组件，不复制 Chat 或 Task 的完整实现。
- 数据模型中 Agent 专属字段应集中在 Agent store 或任务 meta 中。
- MVP 默认使用 HTTP 拉取状态；WebSocket 作为后续增强点。
- 文案风格可以有水浒氛围，但功能按钮和错误提示必须保持清晰直接。

---

## 9. MVP 范围与验收标准

### 9.1 必须实现

- [x] 新增聚义厅路由和菜单入口。
- [x] 聚义厅在侧边菜单中固定为首位入口。
- [x] 新增 Agent 列表页面，支持加载、空、错误状态。
- [x] 新增 Agent 卡片，展示头像、名称、状态、能力、当前任务。
- [x] 新增 Agent 详情弹窗。
- [x] 新增 Agent store，支持列表拉取、筛选和状态更新。
- [x] 聚义厅主视图整合活跃 Agent、大厅行走动画、悬赏榜和传令弹窗。
- [x] 悬赏榜展示 Agent 任务列表，并支持状态筛选、能力筛选、关键词搜索、详情操作和指派。
- [x] 只展示成功连接 WebSocket 的活跃 Agent，不展示本地假人或离线历史 Agent。
- [x] 使用水浒人物原型作为大厅小人的显示名和视觉特征。
- [x] 移除大厅中部议事圆桌，避免视觉突兀和隐藏避障。
- [~] 复用现有 Chat 组件完成聚义厅聊天基础能力：MVP 已提供携带 `conversationType=juyiting` 的会话入口，Chat 内部按会话类型筛选和 sender metadata 渲染留作下一阶段。

### 9.2 验收标准

- 管理员进入聚义厅后，默认看到全屏大厅和活跃 Agent 小人。
- Agent 列表接口失败时，页面显示错误和重试入口。
- Agent 状态切换后，卡片状态和当前任务展示同步变化。
- 点击 Agent 小人或名册卡片可以查看详情，不阻塞主页面操作。
- 悬赏榜能按状态、能力和关键词筛选任务，筛选结果为空时有明确空状态。
- 悬赏榜详情区可以指派当前好汉，并能生成带任务上下文的传令内容。
- 移动端宽度下，大厅、详情弹窗、悬赏榜和聊天区域不出现内容重叠。

### 9.3 暂不实现

- [ ] Agent 自动领取任务。
- [ ] Agent 对话气泡。
- [ ] 复杂 Agent 协作流程编排。
- [ ] 完整 108 将水浒角色库配置。
- [ ] 高精度 3D 人物建模和骨骼动画。

---

## 10. 风格与文案

水浒风格用于增强模块识别度，不应影响操作清晰度。

推荐使用：

- 页面名：聚义厅、悬赏榜。
- 状态文案：在线、执行中、离线、异常。
- 任务文案：发布悬赏、分配任务、查看详情。

示例闲置台词可作为后续增强内容，不进入 MVP 必需范围：

```javascript
const waterMarginDialogues = {
  宋江: [
    '各位兄弟，有何高见？',
    '但凡山寨有事，须从长计议。',
    '今日聚义厅中，正好议事。'
  ],
  吴用: [
    '此事可先分派人手，再看回报。',
    '容我筹划一二。',
    '若要稳妥，先看各位头领本事。'
  ],
  李逵: [
    '哥哥吩咐便是！',
    '这差事交给俺便好。',
    '莫要耽搁，快快派活！'
  ],
  武松: [
    '有事尽管吩咐。',
    '此事不难，待我去办。',
    '先看清来路，再下手不迟。'
  ],
  鲁智深: [
    '洒家看这事不复杂。',
    '路见不平，自当出手。',
    '安排妥当，便可开做。'
  ]
}
```

---

## 10.1 2026-05-30 前端实施状态

已实施：

- 新增 `/juyiting` 路由与侧边菜单入口。
- 新增 `src/stores/agent.js`，对接 `/agent/list`、`/agent/{id}`、`/agent/tasks/search`、`/agent/tasks/assign`。
- Agent store 兼容 `JsonResult.data`、`list`、`records`、`rows` 等列表/分页结构。
- 新增 Agent 列表、Agent 卡片、Agent 详情弹窗、悬赏榜和聚义厅主页面。
- 支持按状态和能力筛选 Agent，支持任务搜索、任务状态筛选和分配在线 Agent。
- 支持 `agent_status` 类事件的 store 更新入口；未知 Agent 会触发列表刷新。
- 聚义厅会话入口跳转到现有 Chat 路由，并携带 `conversationType=juyiting` 查询参数。
- 未登录或后端 Agent 接口未就绪时，页面显示空状态或错误提示，不再使用本地示例 Agent 降级展示。

## 10.2 2026-06-03 聚义厅线上实现状态

已实施：

- `/juyiting` 当前路由指向 `src/components/world/JuyiHall.vue`。
- 聚义厅在 `SideMenu.vue` 菜单排序中固定首位，路由 `meta.menuOrder = 0`。
- 大厅主界面采用全屏游戏化布局，名册、悬赏榜、传令作为弹窗或场景入口打开。
- Agent 小人使用水浒人物原型展示，主界面显示宋江、吴用、林冲、鲁智深、燕青、李逵等人物名；详情保留真实 Agent 名称和 `agentId`。
- 大厅只展示 `/agent/active` 返回的活跃 WebSocket Agent，不再展示假数据。
- Agent 移动使用前端物理近似：目标点行走、边界约束、Agent 间分离、场景障碍规避。
- 已删除中部议事圆桌及对应中部避障点。
- 悬赏榜支持状态 tabs、悬赏编号搜索、能力筛选、任务详情、适配 Agent 推荐、匹配度展示、指派当前好汉和传令议事。
- 后端已新增 `/agent/active`，由 WebSocket handler 跟踪 session 与 `agentId` 映射，并在断连时移除。

当前约束：

- 水浒人物原型目前是有限角色池，不覆盖 108 将。
- 大厅人物为 CSS/图片组合和前端物理近似，不是 3D 模型。
- `/agent/active` 需要登录态或有效授权；未登录直接访问会被安全配置拒绝。

## 10.3 2026-06-03 前端结构优化状态

已实施：

- 将聚义厅常量配置抽到 `src/constants/juyiting.js`，包括菜单控制、快捷操作、状态筛选、任务筛选、水浒角色池、路线和障碍物。
- 将水浒人物原型匹配、头像图集定位和角色 class 计算抽到 `src/composables/juyiting/useWaterMarginRoles.js`。
- 将大厅小人运动、目标路线、边界约束、障碍规避、Agent 间分离力和行走样式计算抽到 `src/composables/juyiting/useHallPhysics.js`。
- 将备用结构化聚义厅组件改名为 `JuyiHallClassic.vue`，消除和线上 `world/JuyiHall.vue` 的自动组件注册同名冲突。

后续拆分建议：

- 拆 `AgentPanel.vue`、`BountyPanel.vue`、`ChatPanel.vue`，把三个弹窗的模板和交互继续从页面容器中移出。
- 拆 `HallStage.vue` 和 `AgentToken.vue`，但需要同步迁移 scoped CSS，避免父组件样式无法作用到子组件内部。

## 10.4 2026-06-03 面板组件化状态

已实施：

- 将好汉名册弹窗拆为 `src/components/juyiting/AgentPanel.vue`。
- 将悬赏榜弹窗拆为 `src/components/juyiting/BountyPanel.vue`。
- 将厅内传令弹窗拆为 `src/components/juyiting/ChatPanel.vue`，消息滚动逻辑随组件迁移。
- 父页面 `src/components/world/JuyiHall.vue` 只保留弹窗容器、数据编排和业务动作入口。
- 已清理父页面中被迁移的面板死样式，降低 scoped CSS 误用风险。

后续拆分建议：

- 继续拆 `HallStage.vue`、`AgentToken.vue` 和 `SelectedAgentCard.vue`。
- 若继续拆大厅地图，应优先把人物外观和地图样式迁入对应组件，避免父 scoped CSS 无法穿透子组件。

后续增强：

- Chat 组件继续消费 `conversationType=juyiting`，并在消息 DTO 或 metadata 中区分 `user/agent/system` 发送者。
- 在现有 `/agent/active` 基础上补充 WebSocket 推送事件，减少前端主动刷新。
- 能力评估 API（`/agent/evaluate`、`/agent/compare`、`/agent/evaluation/*`）可扩展为 Agent 详情内的评分报告和对比视图。

---

## 11. 变更记录

| 版本 | 日期 | 修改内容 | 作者 |
| --- | --- | --- | --- |
| v0.1 | 2025-05 | 初始版本 | - |
| v0.2 | 2025-05-04 | 明确 MVP 范围，补充与 `app-spec.md` 的关系 | AI |
| v0.3 | 2026-05-23 | 修复乱码，重构规格结构，补充功能边界、API、数据模型和验收标准 | AI |
| v0.4 | 2026-05-30 | 记录 `cyf-web-kit` 聚义厅 MVP 前端实施状态、接口兼容策略和后续增强项 | AI |
| v0.5 | 2026-06-03 | 同步线上聚义厅实现：菜单首位、活跃 WebSocket Agent、游戏化大厅、水浒人物小人、悬赏榜操作、移除议事圆桌和 `/agent/active` 接口 | AI |
| v0.6 | 2026-06-03 | 记录前端结构优化：抽离常量、水浒角色映射和大厅物理运动 composable，备用组件改名消除同名冲突 | AI |
| v0.7 | 2026-06-03 | 记录面板组件化：拆出好汉名册、悬赏榜和厅内传令面板，清理父页面面板死样式 | AI |

---

*文档结束*
