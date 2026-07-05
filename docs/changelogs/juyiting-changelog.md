# 聚义厅实施日志与变更记录

> 从 `juyiting-spec.md` 第10节拆分，记录前端实施状态和版本变更。

---

## 2026-06-07 前端优化完成度与验证记录

已完成：

- 已拉取并合并 develop 最新代码，解决 `ChatPanel.vue` 与 `world/JuyiHall.vue` 的合并冲突。
- `/juyiting` 已保持地图模式聚义厅：多隔间布局、非重复悬赏标签、浮窗方向键、场景平移边界约束。
- 已移除底部与顶部重复的一排行动按钮，保留顶部功能入口与弹窗面板。
- 方向键浮窗与"点击好汉查看详情"提示卡不再重叠，提示卡尽量下移并与底部区域保持小间距。
- `新建聚义会话` 与 `同步` 在厅内传令弹窗中可见，并按独立整行按钮展示。
- 厅内传令保留 `conversationType=juyiting` 会话、Agent 投递、流式回复、pending 回复状态和消息同步逻辑。

验证结果：

- `npm.cmd run build` 通过，Vite 构建成功。
- 浏览器访问 `https://localhost:8080/juyiting` 页面非空白。
- 已验证地图舞台、方向键浮窗、聊天弹窗、空态文案、顶部入口均可见。
- 已验证连续方向键平移后没有黑边。
- 已验证方向键浮窗与选中 Agent 提示卡不重叠。
- 已验证底部重复按钮不再显示。

当前约束：

- 前端仍依赖后端灰度环境提供 `/agent/active`、聊天会话与 OpenClaw 相关接口；后端灰度若未成功启动，页面会显示空态或接口失败状态。
- `src/components.d.ts` 为组件自动生成文件，当前存在本地变更；如团队不希望提交该文件，应在统一约定后加入 `.gitignore` 或恢复生成策略。

---

## 2026-05-30 前端实施状态

已实施：

- 新增 `/juyiting` 路由与侧边菜单入口。
- 新增 `src/stores/agent.js`，对接 `/agent/list`、`/agent/{id}`、`/agent/tasks/search`、`/agent/tasks/assign`。
- Agent store 兼容 `JsonResult.data`、`list`、`records`、`rows` 等列表/分页结构。
- 新增 Agent 列表、Agent 卡片、Agent 详情弹窗、悬赏榜和聚义厅主页面。
- 支持按状态和能力筛选 Agent，支持任务搜索、任务状态筛选和分配在线 Agent。
- 支持 `agent_status` 类事件的 store 更新入口；未知 Agent 会触发列表刷新。
- 聚义厅会话入口跳转到现有 Chat 路由，并携带 `conversationType=juyiting` 查询参数。
- 未登录或后端 Agent 接口未就绪时，页面显示空状态或错误提示，不再使用本地示例 Agent 降级展示。

## 2026-06-03 聚义厅线上实现状态

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

## 2026-06-03 前端结构优化状态

已实施：

- 将聚义厅常量配置抽到 `src/constants/juyiting.js`，包括菜单控制、快捷操作、状态筛选、任务筛选、水浒角色池、路线和障碍物。
- 将水浒人物原型匹配、头像图集定位和角色 class 计算抽到 `src/composables/juyiting/useWaterMarginRoles.js`。
- 将大厅小人运动、目标路线、边界约束、障碍规避、Agent 间分离力和行走样式计算抽到 `src/composables/juyiting/useHallPhysics.js`。
- 将备用结构化聚义厅组件改名为 `JuyiHallClassic.vue`，消除和线上 `world/JuyiHall.vue` 的自动组件注册同名冲突。

后续拆分建议：

- 继续评估是否拆 `HallStage.vue`，把大厅地图、房间、热点和地图控制从页面容器中移出。
- 拆大厅地图时需要同步迁移 scoped CSS，避免父组件样式无法作用到子组件内部。

## 2026-06-03 面板组件化状态

已实施：

- 将好汉名册弹窗拆为 `src/components/juyiting/AgentPanel.vue`。
- 将悬赏榜弹窗拆为 `src/components/juyiting/BountyPanel.vue`。
- 将厅内传令弹窗拆为 `src/components/juyiting/ChatPanel.vue`，消息滚动逻辑随组件迁移。
- 父页面 `src/components/world/JuyiHall.vue` 只保留弹窗容器、数据编排和业务动作入口。
- 已清理父页面中被迁移的面板死样式，降低 scoped CSS 误用风险。

后续拆分建议：

- 继续拆 `HallStage.vue`，把大厅地图、场景热点、地图控制和空状态收敛为独立舞台组件。
- 若继续拆大厅地图，应优先把地图样式迁入对应组件，避免父 scoped CSS 无法穿透子组件。

## 2026-06-03 大厅部件组件化状态

已实施：

- 将大厅行走小人拆为 `src/components/juyiting/AgentToken.vue`，小人的水浒角色外观、状态徽标、姓名牌、步行动画和移动端尺寸随组件迁移。
- 将当前选中 Agent 摘要入口拆为 `src/components/juyiting/SelectedAgentCard.vue`，父页面只传入选中 Agent 和展示计算函数。
- 将底部名册、悬赏、传令入口拆为 `src/components/juyiting/BottomDock.vue`，窄屏保持隐藏以避免和快捷操作区域重叠。
- `src/components/world/JuyiHall.vue` 进一步收敛为页面编排层，保留大厅地图、数据加载、弹窗容器和业务动作入口。
- 已删除父页面中被迁移的小人外观、头像和步行动画死样式，降低重复样式和 scoped CSS 误判风险。

后续拆分建议：

- 下一步优先拆 `HallStage.vue`，将地图场景、房间热点、悬赏道具和方向控制一起迁入舞台组件。
- 拆舞台组件时需要明确事件边界：打开弹窗、选择 Agent、刷新大厅、地图重置和地图平移应通过 emits 暴露。
- 对悬赏榜操作可继续补充前端测试，覆盖筛选、指派、传令议事和空状态。

后续增强：

- Chat 组件继续消费 `conversationType=juyiting`，并在消息 DTO 或 metadata 中区分 `user/agent/system` 发送者。
- 在现有 `/agent/active` 基础上补充 WebSocket 推送事件，减少前端主动刷新。
- 能力评估 API（`/agent/evaluate`、`/agent/compare`、`/agent/evaluation/*`）可扩展为 Agent 详情内的评分报告和对比视图。

---

## 版本变更记录

| 版本 | 日期 | 修改内容 | 作者 |
| --- | --- | --- | --- |
| v0.1 | 2025-05 | 初始版本 | - |
| v0.2 | 2025-05-04 | 明确 MVP 范围，补充与 `app-spec.md` 的关系 | AI |
| v0.3 | 2026-05-23 | 修复乱码，重构规格结构，补充功能边界、API、数据模型和验收标准 | AI |
| v0.4 | 2026-05-30 | 记录 `cyf-web-kit` 聚义厅 MVP 前端实施状态、接口兼容策略和后续增强项 | AI |
| v0.5 | 2026-06-03 | 同步线上聚义厅实现：菜单首位、活跃 WebSocket Agent、游戏化大厅、水浒人物小人、悬赏榜操作、移除议事圆桌和 `/agent/active` 接口 | AI |
| v0.6 | 2026-06-03 | 记录前端结构优化：抽离常量、水浒角色映射和大厅物理运动 composable，备用组件改名消除同名冲突 | AI |
| v0.7 | 2026-06-03 | 记录面板组件化：拆出好汉名册、悬赏榜和厅内传令面板，清理父页面面板死样式 | AI |
| v0.8 | 2026-06-03 | 记录大厅部件组件化：拆出行走小人、选中 Agent 摘要和底部入口，父页面继续收敛为编排层 | AI |

---

*文档结束*