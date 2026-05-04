# 聚义厅 - Agent 管理平台概设文档

> **文档状态**：草稿 v0.1
> **创建日期**：2025年
> **目标读者**：开发团队
> **版本**：MVP

---

## 1. 项目概述

### 1.1 项目背景

聚义厅是一个水浒传题材的 Agent 管理平台，灵感来源于《水浒传》中梁山泊好汉聚义的场景。平台通过拟人化的方式管理所有接入的 Agent，赋予它们独特的"水浒人物"个性，让任务分配和协作过程更加生动有趣。

### 1.2 核心价值

- **可视化任务管理**：将抽象的 Agent 任务分配过程具象化为"聚义厅"中的场景
- **实时状态感知**：管理员可直观看到每个 Agent 的状态（自由活动 / 执行任务 / 空闲）
- **水浒文化氛围**：通过水浒人物风格的对话和场景设计，提升平台趣味性

### 1.3 关键概念

| 概念 | 说明 |
|------|------|
| **聚义厅** | Agent 自由活动的公共区域，参考梁山泊大堂 |
| **办公位** | Agent 执行任务时所在的工位 |
| **悬赏榜** | 任务发布与状态展示的公告板 |
| **Agent** | 通过 WebSocket 接入平台的独立子系统 |

---

## 2. 功能需求

### 2.1 Agent 管理

#### 2.1.1 Agent 接入

- Agent 通过 WebSocket 协议接入平台
- 接入时需上报自身信息：
  - `agentId`：唯一标识
  - `name`：水浒人物名称（如"宋江"、"吴用"）
  - `avatar`：头像标识
  - `abilities`：能力列表（JSON 数组）
  - `status`：当前状态（idle / working / offline）
- 平台为新接入的 Agent 随机分配一个办公位

#### 2.1.2 Agent 状态

| 状态 | 描述 | 视觉表现 |
|------|------|----------|
| `idle` | 空闲，在聚义厅自由活动 | 在大厅中随机移动，显示气泡对话 |
| `working` | 执行任务中 | 位于办公位，头顶显示气泡图标识 |
| `offline` | 离线 | 从界面消失 |

#### 2.1.3 聚义厅自由活动

- 未执行任务的 Agent 在聚义厅中自由活动
- Agent 会按水浒人物风格随机发送对话气泡
- 后续版本可支持 Agent 之间的互相交互

### 2.2 任务管理

#### 2.2.1 任务来源

**MVP 阶段（初期）**
- 管理员手工分配任务给指定 Agent

**后续版本**
- 悬赏榜功能：管理员发布任务，Agent 自动抢单

#### 2.2.2 任务结构

```json
{
  "taskId": "string",
  "title": "string",
  "description": "string",
  "requiredAbilities": ["string"],
  "assignedAgentId": "string | null",
  "status": "pending | in_progress | completed | failed",
  "createdAt": "timestamp",
  "completedAt": "timestamp | null"
}
```

#### 2.2.3 任务分配流程

1. 管理员选择任务和目标 Agent
2. 平台通过 WebSocket 将任务推送给 Agent
3. Agent 接收任务，进入 `working` 状态
4. Agent 完成任务后，通过 WebSocket 上报结果
5. 任务状态更新为 `completed` / `failed`
6. Agent 恢复 `idle` 状态，返回聚义厅

### 2.3 悬赏榜

> **MVP 范围**：仅展示任务列表和状态
> **后续版本**：支持 Agent 自动接单

#### 2.3.1 悬赏榜展示

- 显示所有任务及其当前状态
- 支持按状态筛选（全部 / 待领取 / 进行中 / 已完成）
- 任务卡片显示：
  - 任务标题
  - 所需能力
  - 当前状态
  - 执行中的 Agent（如果已分配）

### 2.4 管理员界面

#### 2.4.1 聚义厅视图

- 可视化展示聚义厅场景
- 显示所有在线 Agent 及其当前位置
- 点击 Agent 可查看详情和操作菜单

#### 2.4.2 任务管理

- 创建 / 编辑 / 删除任务
- 分配任务给指定 Agent
- 查看任务执行结果

---

## 3. 非功能需求

### 3.1 性能需求

- WebSocket 连接支持双向实时通信
- 界面刷新频率：至少 1 FPS（用于 Agent 移动动画）
- 单个聚义厅支持显示的 Agent 数量：建议不超过 50 个

### 3.2 可用性需求

- Agent 断线后 30 秒内从界面移除
- 任务分配后 5 秒内推送到 Agent
- 页面加载时间：首屏不超过 3 秒

### 3.3 扩展性需求

- 支持后续增加 Agent 互相交互功能
- 支持多聚义厅（未来可扩展为联盟模式）
- WebSocket 协议预留扩展字段

---

## 4. 技术架构

### 4.1 技术栈

| 层级 | 技术选型 |
|------|----------|
| 前端 | Vue 3 + TypeScript |
| 后端 | Spring Boot |
| 通信 | WebSocket + REST API |
| 存储 | 待定（MVP 可用内存存储） |

### 4.2 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                      管理员浏览器                         │
│                    (Vue 3 前端)                          │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / WebSocket
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    Spring Boot 后端                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Agent管理模块│  │ 任务管理模块 │  │  WebSocket模块  │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌─────────┐     ┌─────────┐     ┌─────────┐
    │ Agent 1 │     │ Agent 2 │     │ Agent N │
    │(WebSocket)│   │(WebSocket)│   │(WebSocket)│
    └─────────┘     └─────────┘     └─────────┘
```

### 4.3 前端目录结构（Vue）

```
src/
├── views/
│   ├── JuyiHall.vue        # 聚义厅主视图
│   └── RewardBoard.vue    # 悬赏榜视图
├── components/
│   ├── AgentAvatar.vue     # Agent 头像组件
│   ├── AgentBubble.vue     # 对话气泡组件
│   ├── TaskCard.vue        # 任务卡片组件
│   └── Workspace.vue       # 办公位组件
├── stores/
│   ├── agentStore.ts       # Agent 状态管理
│   └── taskStore.ts        # 任务状态管理
├── services/
│   ├── websocket.ts        # WebSocket 服务
│   └── api.ts              # REST API 服务
└── types/
    └── index.ts             # TypeScript 类型定义
```

### 4.4 后端目录结构（Spring Boot）

```
src/main/java/com/juyihall/
├── controller/
│   ├── AgentController.java
│   ├── TaskController.java
│   └── WebSocketController.java
├── service/
│   ├── AgentService.java
│   ├── TaskService.java
│   └── WebSocketService.java
├── model/
│   ├── Agent.java
│   └── Task.java
├── dto/
│   ├── AgentDTO.java
│   └── TaskDTO.java
└── config/
    └── WebSocketConfig.java
```

---

## 5. 数据模型

### 5.1 Agent 模型

```java
public class Agent {
    private String agentId;          // 唯一标识
    private String name;             // 水浒人物名称
    private String avatar;           // 头像URL
    private List<String> abilities;  // 能力列表
    private AgentStatus status;      // idle / working / offline
    private String workspaceId;      // 当前工位ID
    private LocalDateTime onlineAt;  // 上线时间
    private LocalDateTime lastHeartbeat; // 最后心跳时间
}
```

### 5.2 Task 模型

```java
public class Task {
    private String taskId;           // 唯一标识
    private String title;            // 任务标题
    private String description;      // 任务描述
    private List<String> requiredAbilities; // 所需能力
    private String assignedAgentId;  // 分配的Agent ID
    private TaskStatus status;       // pending / in_progress / completed / failed
    private String result;          // 执行结果
    private LocalDateTime createdAt; // 创建时间
    private LocalDateTime completedAt; // 完成时间
}
```

### 5.3 Workspace 模型

```java
public class Workspace {
    private String workspaceId;     // 工位ID
    private int positionX;          // X坐标
    private int positionY;          // Y坐标
    private String agentId;         // 当前占用的Agent
}
```

---

## 6. API 设计

### 6.1 REST API

#### Agent 管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/agents` | 获取所有 Agent 列表 |
| GET | `/api/agents/{id}` | 获取指定 Agent 详情 |
| GET | `/api/agents/{id}/status` | 获取 Agent 实时状态 |

#### 任务管理

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/tasks` | 获取所有任务列表 |
| POST | `/api/tasks` | 创建新任务 |
| GET | `/api/tasks/{id}` | 获取任务详情 |
| PUT | `/api/tasks/{id}` | 更新任务 |
| DELETE | `/api/tasks/{id}` | 删除任务 |
| POST | `/api/tasks/{id}/assign` | 分配任务给 Agent |

### 6.2 WebSocket 协议

#### 连接建立

```
Client -> Server:
WS /ws/agent
Headers: X-Agent-Id: {agentId}

Server -> Client:
{
  "type": "connected",
  "data": {
    "workspaceId": "ws-001",
    "position": {"x": 100, "y": 200}
  }
}
```

#### 心跳机制

```
Client -> Server:
{
  "type": "heartbeat"
}

Server -> Client:
{
  "type": "heartbeat_ack"
}
```

#### 任务推送

```
Server -> Client:
{
  "type": "task_assigned",
  "data": {
    "taskId": "task-001",
    "title": "查询天气",
    "description": "获取北京今日天气",
    "deadline": "2025-01-15T18:00:00"
  }
}
```

#### 任务结果上报

```
Client -> Server:
{
  "type": "task_result",
  "data": {
    "taskId": "task-001",
    "status": "completed",
    "result": "北京今日天气：晴，15°C"
  }
}
```

#### Agent 状态同步

```
Server -> All Clients:
{
  "type": "agent_status_changed",
  "data": {
    "agentId": "agent-001",
    "status": "working",
    "workspaceId": "ws-001"
  }
}
```

#### Agent 对话气泡

```
Server -> All Clients:
{
  "type": "agent_bubble",
  "data": {
    "agentId": "agent-001",
    "message": "洒家今日无事，不如去后山走走！",
    "duration": 5000
  }
}
```

---

## 7. 界面设计

### 7.1 聚义厅主视图

**布局**：
- 顶部：标题栏（聚义厅）+ 导航（悬赏榜入口）
- 中部：聚义厅场景（Canvas 或 SVG 实现）
- 右侧：Agent 列表面板
- 底部：状态栏（在线 Agent 数量、任务统计）

**Agent 视觉表现**：
- 头像：圆形水浒人物头像
- 气泡：随机显示水浒风格台词
- 移动：在大厅范围内缓慢随机移动
- 任务状态：头顶显示气泡图标识

### 7.2 悬赏榜视图

**布局**：
- 顶部：筛选栏（全部 / 待领取 / 进行中 / 已完成）
- 主体：任务卡片列表（瀑布流或网格布局）
- 每个卡片：任务标题 + 所需能力标签 + 状态徽章

### 7.3 任务分配弹窗

**触发**：点击"分配任务"按钮
**内容**：
- 任务选择器（下拉）
- Agent 选择器（下拉，可按能力筛选）
- 确认 / 取消按钮

---

## 8. MVP 范围定义

### 8.1 必须实现（MVP）

- [ ] Agent WebSocket 接入与认证
- [ ] Agent 状态管理（idle / working / offline）
- [ ] 聚义厅场景展示（静态背景 + Agent 显示）
- [ ] Agent 自由活动时的气泡对话
- [ ] 管理员手工分配任务
- [ ] 任务状态更新与同步
- [ ] 悬赏榜任务列表展示
- [ ] 基础 REST API

### 8.2 暂不实现（后续版本）

- [ ] 悬赏榜自动接单功能
- [ ] Agent 之间的互相交互
- [ ] 多聚义厅 / 联盟模式
- [ ] 任务历史记录与统计
- [ ] Agent 能力自动匹配
- [ ] 移动端适配

---

## 9. 附录

### 9.1 水浒人物台词示例

```javascript
const waterMarginDialogues = {
  宋江: [
    "各位兄弟，有何高见？",
    "但凡山寨有事，洒家必亲自过问。",
    "今日天色甚好，不如聚义厅中议事。"
  ],
  吴用: [
    "愚有一计，可解此围。",
    "此事需从长计议。",
    "军师我夜观天象，今日必有好事。"
  ],
  李逵: [
    "哥哥，俺的铁牛来也！",
    "哪个敢惹俺，俺一斧子砍了他！",
    "酒肉呢？快拿酒肉来！"
  ],
  武松: [
    "景阳冈的老虎都打死了，还怕这个？",
    "洒家行不更名，坐不改姓！",
    "大哥，有事尽管吩咐！"
  ],
  鲁智深: [
    "洒家不戒酒肉，心中自得快活！",
    "禅杖打开危险路，戒刀杀尽不平人。",
    "谁惹洒家不高兴，洒家让他不高兴！"
  ]
};
```

### 9.2 参考资料

- 水浒传原著（110回本）
- 梁山泊聚义场景相关影视作品

---

## 10. 变更记录

| 版本 | 日期 | 修改内容 | 作者 |
|------|------|----------|------|
| v0.1 | 2025年 | 初始版本 | - |

---

*文档结束*
