# cyf-web-kit 应用程序规格说明书

> **文档状态**：实施版 v1.1
> **创建日期**：2025年5月
> **最后更新**：2026-07-04
> **目标读者**：开发团队、产品团队
> **版本**：当前代码实现

---

## 1. 项目概述

### 1.1 项目背景

cyf-web-kit 是一个基于 Vue 3 的应用工具集，提供聚义厅 Agent 协作大厅、聊天、任务管理、投票、短链接、礼品、消息中心和帮助中心等功能模块。应用主要面向微信生态和浏览器用户，提供轻量级工具服务与 Agent 协作入口。

### 1.2 核心功能

| 模块 | 功能描述 |
|------|----------|
| **聊天 (Chat)** | AI 对话助手，支持流式响应、会话管理 |
| **聚义厅 (JuyiHall)** | Agent 协作大厅，支持 melonJS 2.5D 场景、点将册、悬赏榜、招贤令、厅前议事和案卷阁 |
| **任务 (Task)** | 日历式任务管理，支持定期任务执行 |
| **短语 (Phrase)** | 每日金句/语录展示，支持点赞打赏 |
| **投票 (Vote)** | 有奖答题功能，答对获得积分 |
| **礼品 (Gift)** | 礼品商城，支持积分和微信支付 |
| **短链接 (ShortLink)** | 长链接缩短与还原，支持二维码生成 |
| **消息中心 (MessageCenter)** | 应用消息查看入口 |
| **帮助中心 (HelpCenter)** | 帮助内容与说明入口 |

### 1.3 技术栈

| 层级 | 技术选型 |
|------|----------|
| 前端框架 | Vue 3 (Composition API) |
| 状态管理 | Pinia |
| 路由 | Vue Router 4 |
| 国际化 | Vue I18n 9 |
| UI 组件库 | @varlet/ui 3.x |
| HTTP 请求 | 原生 Fetch API (支持流式响应) |
| 游戏/场景 | melonJS 15.x |
| 构建工具 | Vite 6 |
| 测试框架 | Mocha + Chai + Testing Library |

---

## 2. 功能需求

### 2.1 聊天模块 (Chat)

#### 2.1.1 功能说明

AI 对话助手，支持与 AI 进行自然语言交互，采用流式响应技术提供实时回答体验。

#### 2.1.2 核心功能

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 消息发送 | 用户输入消息并发送给 AI | P0 |
| 流式响应 | 支持 SSE 流式输出，实时显示 AI 回复 | P0 |
| 取消请求 | 支持中断正在进行的 AI 回复 | P1 |
| 会话管理 | 创建新会话、加载历史会话、删除会话 | P1 |
| 标题更新 | AI 根据对话内容自动生成会话标题 | P1 |
| 随机短语 | 首页展示随机语录/金句 | P2 |

#### 2.1.3 消息类型

| 类型 | 发送方 | 描述 |
|------|--------|------|
| `USER` | 用户 | 用户发送的消息 |
| `ASSISTANT` | AI | AI 的回复消息 |
| `SYSTEM` | 系统 | 系统提示（如错误信息、取消提示） |

#### 2.1.4 组件结构

```
chat/
├── Chat.vue                 # 主容器组件
├── ChatMessageList.vue      # 消息列表组件
├── ChatMessage.vue          # 单条消息组件
├── ChatMessageTime.vue      # 消息时间组件
├── ChatInput.vue            # 输入框组件
├── ChatSidebar.vue          # 侧边栏（会话列表）
├── ChatCapabilities.vue     # AI 能力展示
└── ChatEmptyState.vue       # 空状态组件
```

#### 2.1.5 API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/chat/stream` | 流式聊天接口 |
| GET | `/chat/conversation/list` | 获取会话列表 |
| GET | `/chat/conversation/content` | 获取会话内容 |
| DELETE | `/chat/conversation/delete` | 删除会话 |
| POST | `/chat/conversation/update` | 更新会话标题 |

### 2.1A 聚义厅模块 (JuyiHall)

#### 2.1A.1 功能说明

聚义厅是 Agent 协作大厅，默认作为首页入口。当前实现使用 `melonJS` 渲染梁山聚义厅 2.5D 场景，支持 Agent 展示、人格绑定、悬赏任务调度、公共/榜文/私密议事和案卷阁检索。

#### 2.1A.2 核心功能

| 功能 | 描述 | 优先级 |
|------|------|--------|
| melonJS 大厅 | 2.5D 分层图片、角色精灵、热点、平移缩放和横竖屏适配 | P0 |
| 点将册 | Agent 名册、状态筛选、能力展示、选中 Agent | P0 |
| 悬赏榜 | 张榜、筛选、推荐、手动/自动点将、榜文议事、归档 | P0 |
| 厅前议事 | 支持 public、bounty、private 三类会话 scope | P0 |
| SSE 回话 | `/chat/conversation/events` 实时消息，失败后重连和轮询兜底 | P0 |
| 招贤令 | 人格目录、绑定/解绑、本地接入配置生成 | P1 |
| 案卷阁 | 搜索项目案卷、议事旧录、长记，并引用到传令 | P1 |
| 场景反馈 | 任务、议事、案卷和 Agent 回话驱动热点反馈和气泡 | P1 |

#### 2.1A.3 关键文件

| 文件 | 描述 |
|------|------|
| `src/components/world/JuyiHall.vue` | 聚义厅页面编排 |
| `src/components/juyiting/HallStage.vue` | melonJS canvas 挂载与交互层 |
| `src/game/JuyitingGame.js` | melonJS 实例管理 |
| `src/game/scenes/HallScene.js` | 大厅场景、图层、热点和 Agent 同步 |
| `src/game/entities/HallAgent.js` | Agent 精灵 |
| `src/composables/juyiting/useHallData.js` | Agent、人格和悬赏数据 |
| `src/composables/juyiting/useHallConversation.js` | 聚义厅会话和流式消息 |

#### 2.1A.4 API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/agent/map` | 获取大厅地图 Agent |
| POST | `/agent/roster` | 获取点将册名册 |
| GET | `/agent/personas/catalog` | 获取人格目录 |
| POST | `/agent/personas/{personaCode}/bind` | 绑定人格 |
| DELETE | `/agent/personas/{personaCode}/bind` | 解绑人格 |
| POST | `/agent/tasks/search` | 查询悬赏任务 |
| POST | `/agent/tasks/status-counts` | 查询任务状态计数 |
| POST | `/agent/tasks` | 创建悬赏任务 |
| POST | `/agent/tasks/{id}/recommend` | 推荐可点 Agent |
| POST | `/agent/tasks/{id}/assign` | 手动点将 |
| POST | `/agent/tasks/{id}/auto-assign` | 自动点将 |
| POST | `/agent/tasks/{id}/archive` | 归档悬赏 |
| GET | `/chat/conversation/events` | 聚义厅会话事件流 |
| POST | `/chat/library/search` | 案卷阁检索 |

### 2.2 任务模块 (Task)

#### 2.2.1 功能说明

日历式任务管理模块，支持一次性任务和周期性任务的创建与管理。

#### 2.2.2 核心功能

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 日历视图 | 月份日历展示当天任务数量 | P0 |
| 任务列表 | 按日期筛选并展示任务 | P0 |
| 任务详情 | 查看任务详细信息 | P1 |
| 任务创建 | 创建新任务（含周期设置） | P1 |
| 任务历史 | 查看已完成任务的历史记录 | P2 |

#### 2.2.3 周期类型

| 周期值 | 描述 |
|--------|------|
| 0 | 长期任务 |
| 1 | 每年 |
| 2 | 每月 |
| 3 | 每周 |
| 5 | 每日 |
| 6 | 指定日期一次性任务 |
| 11 | 每小时 |
| 12 | 每分钟 |
| 13 | 每秒 |

#### 2.2.4 组件结构

```
task/
├── CalendarPanel.vue       # 日历面板组件
├── TaskListPanel.vue       # 任务列表面板
└── TaskDetailDialog.vue    # 任务详情弹窗
```

#### 2.2.5 API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/task/item/search` | 搜索任务列表 |
| GET | `/task/get` | 获取任务详情 |
| POST | `/task/create` | 创建任务 |
| PUT | `/task/update` | 更新任务 |
| DELETE | `/task/delete` | 删除任务 |

### 2.3 短语模块 (Phrase)

#### 2.3.1 功能说明

每日金句/语录展示模块，提供随机语录查看、点赞、打赏等功能。

#### 2.3.2 核心功能

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 随机语录 | 展示随机一条语录内容 | P0 |
| 点赞/踩 | 对语录进行正负评价 | P1 |
| 打赏 | 微信支付小额打赏作者 | P1 |
| 反馈 | 对语录内容提交反馈 | P1 |
| 添加 | 用户提交新语录 | P2 |
| 复制 | 一键复制语录内容 | P1 |

#### 2.3.3 组件结构

```
phrase/
├── PhraseAddDialog.vue         # 添加语录弹窗
└── PhraseFeedbackDialog.vue   # 反馈弹窗
```

#### 2.3.4 API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/phrase/get/random` | 获取随机语录 |
| GET | `/phrase/read` | 更新阅读计数 |
| POST | `/phrase/vote` | 点赞/踩操作 |
| POST | `/phrase/add` | 添加新语录 |
| POST | `/phrase/feedback` | 提交反馈 |

### 2.4 投票模块 (Vote)

#### 2.4.1 功能说明

有奖答题功能模块，随机展示一道选择题，答对可获得积分奖励。

#### 2.4.2 核心功能

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 题目展示 | 显示随机题目及选项 | P0 |
| 答题 | 用户选择答案并提交 | P0 |
| 结果反馈 | 答对/答错提示及积分奖励 | P1 |
| 统计信息 | 显示总参与人数和答对人数 | P1 |

#### 2.4.3 API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/vote/get/random` | 获取随机题目 |
| POST | `/vote/tick` | 提交答案 |

### 2.5 礼品模块 (Gift)

#### 2.5.1 功能说明

礼品商城模块，展示可兑换的礼品列表，支持积分和微信支付。

#### 2.5.2 核心功能

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 礼品列表 | 展示所有可用礼品 | P0 |
| 礼品详情 | 查看礼品图片、价格、库存 | P1 |
| 积分支付 | 使用积分兑换虚拟礼品 | P1 |
| 微信支付 | 微信支付购买实物礼品 | P1 |
| 订单查询 | 查看历史订单 | P2 |

#### 2.5.3 组件结构

| 组件 | 描述 |
|------|------|
| `GiftList.vue` | 礼品列表页 |
| `GiftPay.vue` | 礼品支付页 |
| `OrderList.vue` | 订单列表页 |

#### 2.5.4 API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/gift/list` | 获取礼品列表 |
| POST | `/gift/pay` | 创建支付订单 |
| GET | `/order/list` | 获取订单列表 |
| POST | `/tip/create` | 创建打赏订单 |
| GET | `/wx/pay/createOrder` | 创建微信支付订单 |

### 2.6 短链接模块 (ShortLink)

#### 2.6.1 功能说明

长链接缩短与还原服务，同时支持生成二维码方便分享。

#### 2.6.2 核心功能

| 功能 | 描述 | 优先级 |
|------|------|--------|
| 链接缩短 | 将长 URL 转换为短链接 | P0 |
| 链接还原 | 根据短链接还原原始 URL | P0 |
| 二维码生成 | 为短链接生成可扫描二维码 | P1 |
| 有效期设置 | 支持设置一年或长期有效 | P1 |

#### 2.6.3 API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/dwz/gen` | 生成短链接 |
| GET | `/dwz/restore` | 还原长链接 |

---

## 3. 认证与授权

### 3.1 OAuth2 PKCE 流程

应用使用 OAuth2 + PKCE 实现用户认证：

```
┌──────────┐     ┌─────────────┐     ┌─────────────┐
│  浏览器   │────▶│   前端应用   │────▶│  认证服务器  │
└──────────┘     └─────────────┘     └─────────────┘
                    │                      │
                    │   1. 发起授权请求    │
                    │   (含 code_challenge) │
                    │─────────────────────▶│
                    │                      │
                    │   2. 返回授权码       │
                    │◀─────────────────────│
                    │                      │
                    │   3. 交换令牌         │
                    │   (含 code_verifier) │
                    │─────────────────────▶│
                    │                      │
                    │   4. 返回 access_token│
                    │◀─────────────────────│
```

### 3.2 认证相关 API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/oauth2/authorize` | OAuth2 授权入口 |
| POST | `/oauth2/token` | 交换令牌 |
| GET | `/user/my` | 获取当前用户信息 |

### 3.3 微信 JS-SDK

应用支持微信 JS-SDK 签名获取：

```
GET /wx/mp/jsapi/signature?appid={appid}&url={url}
```

---

## 4. 数据模型

### 4.1 会话 (Conversation)

```typescript
interface Conversation {
  id: string              // 会话 ID
  title: string           // 会话标题
  updateTime: number      // 最后更新时间
  jiacn: string           // 用户标识
  conversationType?: string // 会话类型，如 juyiting
  conversationScopeType?: string // 会话范围类型
  conversationScopeKey?: string  // 会话范围键
}
```

### 4.2 消息 (Message)

```typescript
interface Message {
  sender: 'USER' | 'ASSISTANT' | 'SYSTEM'  // 发送者类型
  content: string         // 消息内容
  timestamp: number       // 时间戳
  conversationId?: string // 所属会话 ID
  isError?: boolean       // 是否为错误消息
  isInfo?: boolean        // 是否为提示消息
}
```

### 4.3 任务 (Task)

```typescript
interface Task {
  id: string              // 任务 ID
  planId: string          // 计划 ID
  title: string           // 任务标题
  content: string         // 任务内容
  executeTime: number     // 执行时间
  period: number          // 周期类型
  crond: string           // Cron 表达式
  status: number          // 状态
  jiacn: string           // 用户标识
}
```

### 4.4 短语 (Phrase)

```typescript
interface Phrase {
  id: string              // 短语 ID
  content: string         // 内容
  author: string          // 作者
  jiacn: string           // 发布者
  pv: number              // 阅读数
  up: number              // 点赞数
  down: number            // 点踩数
  createTime: number      // 创建时间
}
```

### 4.5 礼品 (Gift)

```typescript
interface Gift {
  id: string              // 礼品 ID
  name: string            // 礼品名称
  description: string     // 描述
  picUrl: string          // 图片 URL
  price: number           // 价格（分）
  point: number           // 所需积分
  quantity: number         // 库存
  virtual: number         // 是否虚拟（1=虚拟）
  status: number          // 状态
}
```

### 4.6 短链接 (ShortLink)

```typescript
interface ShortLink {
  uri: string             // 短链接标识
  orig: string            // 原始 URL
  expireTime: number      // 过期时间
  jiacn: string           // 用户标识
}
```

---

## 5. 组件清单

### 5.1 布局组件

| 组件名 | 文件 | 描述 |
|--------|------|------|
| `App.vue` | `src/App.vue` | 根组件，布局框架 |
| `SideMenu.vue` | `src/components/SideMenu.vue` | 侧边栏菜单 |

### 5.2 功能组件

| 组件名 | 文件 | 所属模块 |
|--------|------|----------|
| `Chat.vue` | `src/components/chat/Chat.vue` | 聊天 |
| `JuyiHall.vue` | `src/components/world/JuyiHall.vue` | 聚义厅 |
| `TaskIndex.vue` | `src/components/TaskIndex.vue` | 任务 |
| `TaskList.vue` | `src/components/TaskList.vue` | 任务 |
| `TaskAdd.vue` | `src/components/TaskAdd.vue` | 任务 |
| `TaskHistory.vue` | `src/components/TaskHistory.vue` | 任务 |
| `Phrase.vue` | `src/components/Phrase.vue` | 短语 |
| `VoteTick.vue` | `src/components/VoteTick.vue` | 投票 |
| `GiftList.vue` | `src/components/GiftList.vue` | 礼品 |
| `GiftPay.vue` | `src/components/GiftPay.vue` | 礼品 |
| `OrderList.vue` | `src/components/OrderList.vue` | 礼品 |
| `ShortLink.vue` | `src/components/ShortLink.vue` | 短链接 |
| `MessageCenter.vue` | `src/components/MessageCenter.vue` | 消息中心 |
| `HelpCenter.vue` | `src/components/HelpCenter.vue` | 帮助中心 |

### 5.3 子组件

| 组件名 | 文件 | 描述 |
|--------|------|------|
| `ChatMessageList` | `src/components/chat/ChatMessageList.vue` | 消息列表 |
| `ChatMessage` | `src/components/chat/ChatMessage.vue` | 单条消息 |
| `ChatInput` | `src/components/chat/ChatInput.vue` | 输入框 |
| `ChatSidebar` | `src/components/chat/ChatSidebar.vue` | 会话侧栏 |
| `CalendarPanel` | `src/components/task/CalendarPanel.vue` | 日历 |
| `TaskListPanel` | `src/components/task/TaskListPanel.vue` | 任务列表 |
| `TaskDetailDialog` | `src/components/task/TaskDetailDialog.vue` | 任务详情 |
| `PhraseAddDialog` | `src/components/phrase/PhraseAddDialog.vue` | 添加短语 |
| `PhraseFeedbackDialog` | `src/components/phrase/PhraseFeedbackDialog.vue` | 反馈 |
| `HallStage` | `src/components/juyiting/HallStage.vue` | 聚义厅 melonJS 舞台 |
| `BountyPanel` | `src/components/juyiting/BountyPanel.vue` | 悬赏榜 |
| `PersonaCatalogPanel` | `src/components/juyiting/PersonaCatalogPanel.vue` | 招贤令 |
| `LibraryPanel` | `src/components/juyiting/LibraryPanel.vue` | 案卷阁 |

---

## 6. 路由配置

| 路径 | 名称 | 组件 | 菜单显示 | 菜单顺序 |
|------|------|------|----------|----------|
| `/juyiting` | JuyiHall | `world/JuyiHall.vue` | ✓ | 0 |
| `/` | - | 重定向到 `/juyiting` | ✗ | - |
| `/chat` | Chat | `Chat.vue` | ✓ | 1 |
| `/task` | TaskIndex | `TaskIndex.vue` | ✓ | 3 |
| `/list` | TaskList | `TaskList.vue` | ✗ | - |
| `/history` | TaskHistory | `TaskHistory.vue` | ✗ | - |
| `/add` | TaskAdd | `TaskAdd.vue` | ✗ | - |
| `/gift` | GiftList | `GiftList.vue` | ✓ | 4 |
| `/pay` | GiftPay | `GiftPay.vue` | ✗ | - |
| `/order/list` | OrderList | `OrderList.vue` | ✗ | - |
| `/messages` | MessageCenter | `MessageCenter.vue` | ✓ | 5 |
| `/help` | HelpCenter | `HelpCenter.vue` | ✓ | 6 |
| `/vote` | VoteTick | `VoteTick.vue` | ✓ | 7 |
| `/phrase` | Phrase | `Phrase.vue` | ✓ | 8 |
| `/dwz` | ShortLink | `ShortLink.vue` | ✓ | 9 |
| `/oauth2/callback` | OAuthCallback | 内联组件 | ✗ | - |

---

## 7. 状态管理

### 7.1 Store 列表

| Store | 文件 | 描述 |
|-------|------|------|
| `api` | `src/stores/api.js` | API 认证、OAuth 流程 |
| `global` | `src/stores/global.js` | 全局状态（用户、标题、UI） |
| `util` | `src/stores/util.js` | 工具函数（存储、时间处理） |
| `i18n` | `src/stores/i18n.js` | 国际化配置 |
| `agent` | `src/stores/agent.js` | Agent 名册、悬赏任务和本地兼容数据 |
| `message` | `src/stores/message.js` | 消息中心状态 |

### 7.2 Global Store 状态

```typescript
interface GlobalState {
  user: {
    appid: string          // 微信 AppID
    openid: string | null  // 微信 OpenID
    jiacn: string | null   // 用户标识
    wxToken: string | null // 微信 Token
  }
  menu: object             // 菜单配置
  title: string            // 页面标题
  showBack: boolean        // 显示返回按钮
  showMore: boolean        // 显示更多按钮
  showSideMenu: boolean    // 显示侧边栏
  showRightSidebar: boolean // 显示右侧边栏
  copyright: string        // 版权信息
  copyrightLink: string    // 版权链接
}
```

---

## 8. HTTP 请求封装

### 8.1 useHttp 组合式函数

核心的 HTTP 请求封装，提供以下功能：

- 自动加载状态管理
- 自动认证 Token 获取
- 支持普通请求和流式响应
- 超时处理
- 错误重试机制
- 401 自动清理 token 并重试

### 8.2 API 端点工厂函数

预定义的 API 端点：

| API | 基础路径 |
|-----|----------|
| `taskApi` | `/task` |
| `phraseApi` | `/phrase` |
| `kefuApi` | `/kefu` |
| `userApi` | `/user` |
| `voteApi` | `/vote` |
| `tipApi` | `/tip` |
| `chatApi` | `/chat` |
| `agentApi` | `/agent` |
| `dwzApi` | `/dwz` |
| `giftApi` | `/gift` |
| `wxApi` | `/wx` |

---

## 9. 环境配置

### 9.1 环境变量

| 变量名 | 描述 |
|--------|------|
| `VITE_API_BASE_URL` | API 基础地址 |
| `VITE_DWZ_DOMAIN` | 短链接域名 |
| `VITE_OAUTH_CLIENT_ID` | OAuth 客户端 ID |
| `VITE_WXMP_APPID` | 微信小程序 AppID |
| `VITE_APP_TITLE` | 应用标题 |
| `VITE_COPYRIGHT` | 版权信息 |
| `VITE_COPYRIGHT_LINK` | 版权链接 |
| `VITE_HTTP_TIMEOUT` | HTTP 请求超时时间（毫秒） |

### 9.2 静态资源

| 路径 | 描述 |
|------|------|
| `public/juyiting/hall.tmx` | Juyiting Tiled runtime map; single source for map images, tiles, and prop art |
| `public/juyiting/images/` | 聚义厅 2.5D 背景、遮挡、灯光图层 |
| `public/juyiting/images/props/` | TMX-declared collection-of-images prop assets |
| `public/juyiting/liangshan-character-walksheet-v1.png` | Agent 行走图集 |

---

## 10. 非功能需求

### 10.1 性能需求

- 首屏加载时间不超过 3 秒
- HTTP 请求默认超时 60 秒
- 流式响应超时 30 分钟（1800000ms）
- 页面滚动流畅，无明显卡顿

### 10.2 兼容性需求

- 支持现代浏览器（Chrome, Firefox, Safari, Edge）
- 移动端响应式适配
- 兼容不支持 `AbortSignal.timeout()` 的浏览器

### 10.3 安全需求

- 所有需要认证的请求携带 Bearer Token
- PKCE 流程保护 OAuth 授权安全
- 敏感信息存储于 localStorage 时设置过期时间

---

## 11. 目录结构

```
src/
├── App.vue                    # 根组件
├── main.js                    # 应用入口
├── auto-imports.d.ts          # 自动导入类型
├── components.d.ts            # 组件类型声明
├── components/                # 组件目录
│   ├── agent/                 # Agent 卡片、详情、列表
│   ├── chat/                  # 聊天模块
│   ├── juyiting/              # 聚义厅面板和舞台组件
│   ├── phrase/                # 短语模块
│   ├── task/                  # 任务模块
│   ├── world/                 # 世界模块
│   └── *.vue                  # 其他组件
├── composables/               # 组合式函数
│   ├── juyiting/              # 聚义厅数据、会话、场景和任务逻辑
│   ├── useHttp.js             # HTTP 请求封装
│   └── README.md
├── constants/                 # 常量配置
│   ├── juyiting.js
│   └── juyitingScene.js
├── game/                      # melonJS 聚义厅场景
│   ├── JuyitingGame.js
│   ├── scenes/
│   ├── entities/
│   └── *.js
├── i18n/                      # 国际化
├── router/                    # 路由配置
│   └── index.js
├── stores/                    # 状态管理
│   ├── api.js                 # API 认证
│   ├── agent.js               # Agent 状态
│   ├── global.js              # 全局状态
│   ├── i18n.js                # 国际化状态
│   ├── message.js             # 消息中心状态
│   └── util.js                # 工具函数
├── styles/                    # 样式文件
└── utils/                     # 工具函数
    └── logger.js              # 日志工具
```

---

## 12. 变更记录

| 版本 | 日期 | 修改内容 | 作者 |
|------|------|----------|------|
| v1.0 | 2025-05-04 | 初始版本，根据项目代码生成 | AI |
| v1.1 | 2026-07-04 | 根据当前代码补充聚义厅、melonJS、Agent API、目录结构和状态管理 | AI |

---

*文档结束*
