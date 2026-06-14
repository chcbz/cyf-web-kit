# 聚义厅开放公测运行手册

> 目标：把开放公测发布当天需要确认的人、系统、命令和回滚动作固定下来。发布前必须填写本手册中的待确认项，并把执行结果回填到 `juyiting-public-beta-readiness.md`。

## 发布窗口

- 发布日期：
- 发布开始时间：
- 发布结束时间：
- 发布范围：受控公测 / 开放公测 / 回滚演练
- 发布分支：
- 前端提交：
- 后端提交：

## 责任人

- 发布负责人：
- 后端负责人：
- 前端负责人：
- Agent/WebSocket 负责人：
- ES/藏经阁负责人：
- 运维/监控负责人：
- 回滚决策人：
- 用户通知负责人：

## 发布前门禁

按顺序执行：

```powershell
cd D:\workspace\chcbz\project\jia\web\jia-web-kit
npm.cmd run test:juyiting:preflight
npm.cmd run test:juyiting:ui-smoke
npm.cmd run test:juyiting:agent-smoke
```

```powershell
cd D:\workspace\chcbz\project\jia
.\test\juyiting-public-beta-smoke.ps1
```

```powershell
cd D:\workspace\chcbz\project\jia\api
.\gradlew.bat :agent:jia-agent-service:test --tests cn.jia.agent.service.impl.AgentServiceImplTest --tests cn.jia.agent.config.AgentSchemaInitializerTest --rerun-tasks
.\gradlew.bat :chat:jia-chat-service:test --tests cn.jia.chat.api.ChatControllerTest --tests cn.jia.chat.service.HallActionDispatcherTest --tests cn.jia.chat.handler.AgentWebSocketHandlerTest --rerun-tasks
```

注意：后端两条 Gradle 命令必须顺序执行，不要并行执行。

## 配置巡检

- 后端灰度地址：`https://localhost:10018`
- 前端灰度地址：`https://localhost:8080`
- 聚义厅入口：`https://localhost:8080/juyiting`
- 登录账号：`chcbz / 123`
- Jasypt 参数：`jasypt.encryptor.password=cyf0519`
- Agent WebSocket：`/ws/agent/channel`
- Agent API key：确认 `oauth_api_key.status=1` 且 `expire_time` 未过期。
- ES 索引：确认 `chat_memory` 为 green 或 yellow，且可检索聚义厅资料。

## 监控确认

- 后端进程存活：
- 前端静态资源可访问：
- 登录成功率：
- `/agent/map` 可用性：
- `/agent/tasks/status-counts` 可用性：
- `/agent/tasks/search` 可用性：
- `/chat/library/search` 可用性：
- `/ws/agent/channel` 握手成功率：
- ES `chat_memory` 健康状态：

## 告警确认

- 登录失败率告警：
- HTTP 5xx 告警：
- WebSocket 401/5xx 告警：
- 藏经阁检索失败告警：
- 悬赏接口失败告警：
- ES yellow/red 告警：
- Agent 在线数异常告警：

## 发布步骤

1. 确认本手册责任人全部到位。
2. 执行发布前门禁命令，任何失败都先停止发布。
3. 确认灰度配置和 API key。
4. 发布后端。
5. 发布前端。
6. 执行 `npm.cmd run test:juyiting:preflight`。
7. 执行 `npm.cmd run test:juyiting:ui-smoke`。
8. 执行 `npm.cmd run test:juyiting:agent-smoke`。
9. 检查监控和告警面板。
10. 回填发布结果和提交信息到 readiness 手册。

## 回滚步骤

1. 回滚前端静态资源到上一稳定提交。
2. 回滚后端发布包到上一稳定提交。
3. 如本次变更涉及 `oauth_api_key`，恢复发布前状态或禁用新增 key。
4. 如本次变更涉及 `application-grey.properties`，恢复发布前配置。
5. 复跑 `npm.cmd run test:juyiting:preflight`。
6. 复跑 `.\test\juyiting-public-beta-smoke.ps1`。
7. 通知用户当前状态。

## 发布后观察

- 观察窗口：至少 30 分钟。
- 重点观察：登录、聚义厅页面加载、地图宋江、悬赏接口、藏经阁检索、厅内传令、在线 Agent 派发。
- 异常处理：任一核心链路连续 3 次失败，进入回滚决策。

## 发布记录

- 执行人：
- 执行时间：
- 发布结果：
- 失败项：
- 回滚结果：
- 备注：
