# 梁山泊开放世界设计方案

## 一、系统架构概述

基于水浒传梁山泊为原型的开放世界 Multi-Agent 系统，采用 **WebSocket** 作为核心通信协议，构建一个可扩展的分布式 Agent 协作平台。

```
┌─────────────────────────────────────────────────────────────┐
│                     梁山泊开放世界 (Liangshan World)          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │ 宋江    │  │ 吴用    │  │ 卢俊义  │  │ 林冲   │        │
│  │ 及时雨  │  │ 智多星  │  │ 玉麒麟  │  │ 豹子头  │        │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        │
│       │           │           │           │               │
│       └───────────┴─────┬─────┴───────────┘               │
│                         │                                 │
│                  ┌──────▼──────┐                         │
│                  │ 忠义堂 Central │                         │
│                  │  (WebSocket  │                         │
│                  │   Hub)      │                         │
│                  └──────┬──────┘                         │
│                         │                                 │
│    ┌────────────────────┼────────────────────┐           │
│    │                    │                    │           │
│  ┌─▼────┐  ┌────────────▼───────┐  ┌────────▼─────┐      │
│  │ 山寨 │  │      任务大厅       │  │   聚义厅     │      │
│  │ 地图 │  │  (Task Manager)    │  │ (Gathering)  │      │
│  └──────┘  └────────────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、核心设计

### 2.1 世界设定 (World Schema)

| 属性 | 描述 | 示例值 |
|------|------|--------|
| worldId | 世界唯一标识 | liangshan_001 |
| name | 世界名称 | 梁山泊 |
| description | 世界背景描述 | 北宋末年，农民起义军根据地 |
| capacity | 最大容纳人数 | 108 |
| regions | 区域划分 | 忠义堂、水泊、聚义厅等 |
| status | 世界状态 | active/maintenance |

### 2.2 Agent 模型设计

```typescript
interface Agent {
  id: string;              // 唯一标识 "song_jiang_001"
  name: string;            // 绰号 "及时雨"
  title: string;           // 职位 "梁山泊之主"
  personality: string;     // 性格特点
  skills: string[];        // 技能 ["统兵", "外交", "谋略"]
  status: 'online' | 'offline' | 'busy' | 'resting';
  location: Region;        // 当前位置
  currentTask?: Task;     // 当前任务
  stats: {
    power: number;         // 武力值
    intelligence: number;   // 智力值
    leadership: number;     // 领导力
    reputation: number;     // 声望
  };
  websocketEndpoint: string;
  metadata: Record<string, any>;
}
```

### 2.3 108 将初始配置

按照水浒传108将分组：

| 分堂 | 人数 | 代表人物 |
|------|------|----------|
| 忠义堂（首领） | 3 | 宋江、卢俊义、吴用 |
| 正将厅 | 21 | 林冲、秦明、花荣等 |
| 副将厅 | 32 | 刘唐、李逵、史进等 |
| 小头目 | 72 | 喽啰头领 |

---

## 三、WebSocket 通信协议

### 3.1 消息类型定义

```typescript
// 客户端 → 服务器
type ClientMessage = 
  | { type: 'register'; payload: { agentId: string; token: string } }
  | { type: 'move'; payload: { targetRegion: string } }
  | { type: 'accept_task'; payload: { taskId: string } }
  | { type: 'report'; payload: { taskId: string; result: any } }
  | { type: 'chat'; payload: { target: string; message: string } }
  | { type: 'heartbeat'; payload: { timestamp: number } };

// 服务器 → 客户端
type ServerMessage = 
  | { type: 'welcome'; payload: { world: World; agent: Agent } }
  | { type: 'task_assigned'; payload: { task: Task } }
  | { type: 'agent_joined'; payload: { agent: Agent } }
  | { type: 'agent_left'; payload: { agentId: string } }
  | { type: 'region_update'; payload: { agents: Agent[] } }
  | { type: 'broadcast'; payload: { from: string; message: string } }
  | { type: 'error'; payload: { code: string; message: string } };
```

### 3.2 连接流程

```
Agent Client                    WebSocket Server
     │                                  │
     │───── WebSocket Connect ─────────▶│
     │                                  │
     │◀──── Handshake Challenge ────────│
     │                                  │
     │───── Register {agentId, token} ─▶│
     │                                  │
     │◀──── Welcome {world, agent} ─────│  ← 上线成功
     │                                  │
     │───── Heartbeat (每30s) ──────────▶│
     │                                  │
     │◀──── Task Assigned ──────────────│  ← 接收任务
     │                                  │
     │───── Report {result} ───────────▶│  ← 任务完成
     │                                  │
```

---

## 四、核心功能模块

### 4.1 任务系统 (Task System)

```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  type: 'combat' | 'scout' | 'diplomacy' | 'rescue' | 'transport';
  difficulty: 1 | 2 | 3 | 4 | 5;
  requiredSkills: string[];
  reward: { exp: number; reputation: number };
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  assigner: string;      // 任务发布者
  assignee?: string;     // 任务接收者
  deadline?: number;
  subtasks?: Task[];
}
```

### 4.2 区域系统 (Region System)

| 区域 | 功能 | 可容纳人数 |
|------|------|-----------|
| 忠义堂 | 世界公告、重大决策 | 全部 |
| 聚义厅 | 社交、闲聊 | 50 |
| 水泊 | 任务领取点 | 30 |
| 兵器铺 | 装备管理 | 10 |
| 酒楼 | 休息恢复 | 20 |
| 山路 | 遭遇战/随机事件 | 5 |

### 4.3 Agent 状态管理

```
┌─────────┐     分配任务      ┌─────────┐     执行中      ┌─────────┐
│ Online  │──────────────────▶│  Busy   │────────────────▶│Offline  │
│ (在线)  │◀──────────────────│ (忙碌)  │                 │ (下线)  │
└─────────┘     任务完成     └─────────┘                 └─────────┘
     │                    │                                  ▲
     │                    │ 报告结果                          │
     │                    └──────────────────────────────────┘
     │                           退出登录/超时
```

---

## 五、前端组件设计

### 5.1 目录结构

```
src/components/world/
├── index.html              # 世界入口页面
├── WorldMap.vue            # 世界地图组件
├── AgentPanel.vue          # Agent 控制面板
├── TaskBoard.vue           # 任务公告板
├── ChatHall.vue            # 聚义厅聊天室
├── StatusBar.vue           # 状态栏
└── composables/
    ├── useWebSocket.js     # WebSocket 连接管理
    ├── useWorld.js         # 世界状态管理
    ├── useAgent.js          # Agent 状态管理
    └── useTask.js           # 任务管理
```

### 5.2 核心组件

1. **WorldMap.vue** - 交互式地图
   - 显示梁山泊地图
   - 显示在线 Agent 位置
   - 点击区域查看详情

2. **AgentPanel.vue** - Agent 控制面板
   - Agent 状态切换
   - 当前位置显示
   - 技能/属性展示
   - 任务进度

3. **TaskBoard.vue** - 任务公告板
   - 任务列表筛选
   - 任务详情
   - 任务接取

4. **ChatHall.vue** - 聚义厅
   - 实时聊天
   - @提及 Agent
   - 消息历史

---

## 六、技术选型

### 6.1 前端
- Vue 3 Composition API
- Pinia 状态管理（已有）
- Vue Router（已有）
- WebSocket 原生 API / socket.io-client
- Canvas/SVG 地图渲染

### 6.2 后端（需要额外搭建）
- Node.js + Express/Koa
- ws / Socket.IO
- Redis（实时状态存储）
- PostgreSQL（持久化存储）

### 6.3 依赖建议

```json
{
  "dependencies": {
    "socket.io-client": "^4.7.0",
    "vue": "^3.5.0",
    "pinia": "^2.1.0"
  }
}
```

---

## 七、数据流设计

```
用户操作 (Web)
     │
     ▼
┌─────────────────┐
│  Vue Component  │ ← useWebSocket composable
└────────┬────────┘
         │ WebSocket
         ▼
┌─────────────────┐
│  WebSocket Hub  │ (Backend)
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────┐
│ Agent │ │ Agent │  ← 外部 Agent 客户端
│  A    │ │  B    │
└───┬───┘ └───┬───┘
    │         │
    └────┬────┘
         │
         ▼
    ┌─────────┐
    │  任务   │
    │  执行   │
    └─────────┘
```

---

## 八、安全考虑

1. **认证机制**
   - Agent 注册需要 token 验证
   - JWT / Token-based 认证

2. **权限控制**
   - 首领可发布任务
   - 普通 Agent 只能接取任务

3. **消息过滤**
   - 聊天内容敏感词过滤
   - 消息频率限制

---

## 九、实施计划

### Phase 1: 基础框架 (MVP)
- [ ] WebSocket 服务端基础架构
- [ ] Agent 注册/上线/下线
- [ ] 简单的任务发布与接取
- [ ] 前端世界地图界面

### Phase 2: 核心功能
- [ ] 完整 Agent 状态管理
- [ ] 任务系统完整流程
- [ ] 聚义厅实时聊天
- [ ] 108 将数据配置

### Phase 3: 高级功能
- [ ] Agent AI 对话集成
- [ ] 战斗系统
- [ ] 物品/装备系统
- [ ] 成就系统

---

## 十、示例交互场景

### 场景：宋江分配任务给林冲

```
1. 宋江 Agent 客户端连接 WebSocket
   → Server: welcome { agent: "宋江", location: "忠义堂" }

2. 宋江发布任务"攻打祝家庄"
   → Server: broadcast { message: "新任务: 攻打祝家庄" }

3. 林冲 Agent 客户端收到任务通知
   → Client: onMessage({ type: 'task_assigned', payload: {...} })

4. 林冲接受任务，前往水泊
   → Client: send({ type: 'move', payload: { targetRegion: '水泊' } })

5. 林冲执行任务并报告
   → Client: send({ type: 'report', payload: { taskId: 'xxx', result: '胜利' } })

6. 宋江收到林冲的任务报告
   → Server: private_message { to: "宋江", message: "林冲已完成任务" }
```
