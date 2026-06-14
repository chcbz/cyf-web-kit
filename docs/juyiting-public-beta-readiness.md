# 聚义厅受控公测发布手册

> 目标：记录聚义厅受控公测的本地启动、验证命令、发布证据和提交记录。后续继续优化时先看本文档，避免重复全量分析。

## 本地启动

后端灰度：

```powershell
cd D:\workspace\chcbz\project\jia\api
.\gradlew.bat :starter:bootRun --args="--spring.profiles.active=grey --jasypt.encryptor.password=cyf0519"
```

前端：

```powershell
cd D:\workspace\chcbz\project\jia\web\jia-web-kit
npm.cmd run dev
```

固定信息：

- 后端：`https://localhost:10018`
- 前端：`https://localhost:8080`
- 聚义厅：`https://localhost:8080/juyiting`
- 登录：`chcbz / 123`
- Jasypt：`cyf0519`

## 发布验证命令

前端组件/契约测试：

```powershell
cd D:\workspace\chcbz\project\jia\web\jia-web-kit
npx.cmd mocha --require @babel/register --require ./tests/setup.js --timeout 10000 --reporter spec tests/juyiting-component-behavior.test.js tests/juyiting-collaboration-flow.test.js tests/juyiting-hall-data.test.js
```

前端构建：

```powershell
cd D:\workspace\chcbz\project\jia\web\jia-web-kit
npm.cmd run build
```

浏览器 UI smoke：

```powershell
cd D:\workspace\chcbz\project\jia\web\jia-web-kit
npm.cmd run test:juyiting:ui-smoke
```

发布前快速巡检：

```powershell
cd D:\workspace\chcbz\project\jia\web\jia-web-kit
npm.cmd run test:juyiting:preflight
```

在线 Agent 派发 smoke：

```powershell
cd D:\workspace\chcbz\project\jia\web\jia-web-kit
$env:JIA_AGENT_API_KEY="本地 oauth_api_key 中有效的 api_key"
npm.cmd run test:juyiting:agent-smoke
```

说明：

- 脚本会登录本地后端、连接 `wss://localhost:10018/ws/agent/channel`、注册临时 Agent、调用 `/juyiting/actions/{intentId}/dispatch`，并验证 WebSocket 收到 `agent_direct_message`。
- 如果本地测试库沿用 `oauth` 测试种子，可不设置 `JIA_AGENT_API_KEY`，脚本默认尝试 `my-secret-api-key-123`。
- 若握手返回 401，先检查 `oauth_api_key` 是否存在有效记录、`status=1`、`expire_time` 未过期。

本地灰度库可用以下 SQL 检查或初始化测试 key：

```sql
select id, client_id, jiacn, key_name, status, expire_time
from oauth_api_key
where api_key = 'my-secret-api-key-123';

insert into oauth_api_key
    (id, api_key, client_id, jiacn, key_name, expire_time, status, description, create_time, update_time)
select seed.next_id, 'my-secret-api-key-123', 'jia_client', 'oH2zD1El9hvjnWu-LRmCr-JiTuXI',
       'juyiting-public-beta-smoke', 1775444943016, 1, '聚义厅公测在线 Agent 派发 smoke',
       unix_timestamp(now(3)) * 1000, unix_timestamp(now(3)) * 1000
from (
    select coalesce(max(id), 0) + 1 as next_id
    from oauth_api_key
) seed
where not exists (
    select 1
    from oauth_api_key
    where api_key = 'my-secret-api-key-123'
);

update oauth_api_key
set status = 1,
    expire_time = 1775444943016,
    update_time = unix_timestamp(now(3)) * 1000
where api_key = 'my-secret-api-key-123';
```

藏经阁种子资料与 API smoke：

```powershell
cd D:\workspace\chcbz\project\jia
.\test\juyiting-seed-library.ps1
.\test\juyiting-public-beta-smoke.ps1
```

后端关键测试：

```powershell
cd D:\workspace\chcbz\project\jia\api
.\gradlew.bat :agent:jia-agent-service:test --tests cn.jia.agent.service.impl.AgentServiceImplTest --tests cn.jia.agent.config.AgentSchemaInitializerTest --rerun-tasks
.\gradlew.bat :chat:jia-chat-service:test --tests cn.jia.chat.api.ChatControllerTest --tests cn.jia.chat.service.HallActionDispatcherTest --tests cn.jia.chat.handler.AgentWebSocketHandlerTest --rerun-tasks
```

注意：上述两条后端 `--rerun-tasks` 命令应顺序执行，不要并行执行。并行执行可能同时重建 `common` 模块产物，导致另一个 Gradle 进程临时读不到 `BaseEntity.class`。

## 当前已验证结果

- 完整门禁最近验证时间：`2026-06-15 00:40:50 +08:00`
- 前端组件/契约测试：`42 passing`
- 前端构建：`vite build` 成功
- 发布前快速巡检：`聚义厅公测 preflight 验证通过`，覆盖发布手册、后端登录、地图宋江、悬赏接口、藏经阁检索、前端入口和 Agent WebSocket API key。
- 浏览器 UI smoke：`聚义厅 UI smoke 验证通过`，最近验证页面 `https://localhost:8080/juyiting?transition=none`
- 在线 Agent 派发 smoke：`聚义厅在线 Agent 派发 smoke 验证通过: public-beta-smoke-1781455236675`
- 在线 Agent 派发 smoke 前置修复：灰度库 `oauth_api_key` 已补 `my-secret-api-key-123`，`status=1`，`expire_time=1775444943016`。
- 藏经阁种子资料：`juyiting library public beta seed completed: 5 documents`
- 藏经阁实际检索：关键词 `juyiting` 返回 `5` 条 `project` 资料
- API smoke：`聚义厅受控公测 smoke 验证通过`，退出码 `0`
- 后端 Agent 测试：`BUILD SUCCESSFUL`
- 后端 Chat 测试：`BUILD SUCCESSFUL`

## UI Smoke 覆盖范围

`npm.cmd run test:juyiting:ui-smoke` 使用本地账号和 PKCE 授权码流程获取 token，不依赖手工输入老登录页。脚本会启动本机 Chrome 或 Edge，通过 DevTools 打开真实聚义厅页面并验证：

- 聚义厅页面在登录态下正常挂载。
- 地图包含宋江。
- 藏经阁面板可打开并显示向量检索 UI。
- 悬赏榜面板可打开，包含新建、已归档等公测任务管理入口。
- 厅内传令面板可打开。
- 页面不出现 `宋江号令`、`协同会办` 等已移除入口。
- 厅内传令仍包含 `@宋江`，说明传令人选来自地图人物。
- 页面文本不包含已知乱码标记。

## 已推送提交

后端 `api`：

- `c5fb229`：`feat(juyiting): prepare public beta backend`

前端 `web/jia-web-kit`：

- `4391079`：`feat(juyiting): prepare public beta frontend`
- `cbe9431`：`test(juyiting): add public beta ui smoke`
- `6e9dbad`：`chore(juyiting): ignore local vite smoke logs`
- `c40ca4c`：`docs(juyiting): track public beta release handoff`
- `d8a8bab`：`docs(juyiting): record public beta audit evidence`
- `40a327b`：`test(juyiting): add online agent dispatch smoke`
- `7cb4596`：`docs(juyiting): record online agent smoke gate`
- `de43bf6`：`test(juyiting): verify online agent dispatch gate`
- `1fcd781`：`docs(juyiting): record online dispatch verification commit`
- `2651de7`：`docs(juyiting): record latest public beta smoke evidence`
- `bd05d33`：`docs(juyiting): record public beta readiness gate`
- `1a79864`：`test(juyiting): add public beta preflight gate`

## 受控公测结论

截至 `2026-06-15 00:40:50 +08:00`，聚义厅主链路、悬赏任务管理、藏经阁检索、厅内传令、在线 Agent 派发和前后端关键测试均已通过本地灰度验证，可进入受控公测。开放式公测前已补发布前快速巡检和检查清单，仍需在真实生产发布流程中确认监控、告警和回滚责任人。

## 开放公测前检查清单

- 监控：确认后端进程、`/agent/map`、`/agent/tasks/status-counts`、`/chat/library/search`、`/ws/agent/channel` 有可观测的可用性指标。
- 告警：确认登录失败率、WebSocket 401/5xx、藏经阁检索失败、悬赏接口 5xx、ES `chat_memory` yellow/red 状态有告警通道。
- 回滚：确认前端静态资源、后端 `develop` 发布包、灰度 `application-grey.properties` 和 `oauth_api_key` 变更均有回滚记录。
- 配置巡检：发布前执行 `npm.cmd run test:juyiting:preflight`、`npm.cmd run test:juyiting:ui-smoke`、`npm.cmd run test:juyiting:agent-smoke`，并顺序执行后端 Agent/Chat 关键测试。
- 数据巡检：确认 `chat_memory` 中至少有聚义厅公测资料，藏经阁关键词 `聚义厅` 或 `juyiting` 可查回资料。
- 权限巡检：确认悬赏议事只对分派人开放，厅内传令人选来自地图人物，名册状态切换不影响地图人物。
- 运行边界：确认受控公测账号、API key 和本地/灰度服务地址没有写死到生产前端产物中。

## 本地剩余状态

以下内容不是本轮聚义厅公测提交的一部分：

- `api/starter/src/main/resources/application-grey.properties` 有一个灰度模型名配置改动，未提交。
- `web/jia-web-kit/src/components.d.ts` 仅显示本地生成/换行状态。
- 手册文件是 UTF-8；如果 PowerShell 直接 `Get-Content` 出现中文乱码，使用 `Get-Content -Encoding UTF8` 查看。

## 后续优化入口

- 公测范围内继续保留在线 Agent WebSocket `dispatched` 运行时验证证据，并在灰度数据变更后复跑 `npm.cmd run test:juyiting:agent-smoke`。
- 若需要把顶层 `D:\workspace\chcbz\project\jia\docs` 中的详设文档长期维护，应迁移或复制到已跟踪仓库。
