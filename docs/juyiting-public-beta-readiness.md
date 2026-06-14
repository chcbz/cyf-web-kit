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

## 当前已验证结果

- 前端组件/契约测试：`42 passing`
- 前端构建：`vite build` 成功
- 浏览器 UI smoke：`聚义厅 UI smoke 验证通过`
- 藏经阁种子资料：`juyiting library public beta seed completed: 5 documents`
- API smoke：退出码 `0`
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

## 本地剩余状态

以下内容不是本轮聚义厅公测提交的一部分：

- `api/starter/src/main/resources/application-grey.properties` 有一个灰度模型名配置改动，未提交。
- `web/jia-web-kit/src/components.d.ts` 仅显示本地生成/换行状态。

## 后续优化入口

- 公测范围内继续优先补充真实在线 Agent WebSocket `dispatched` 运行时验证。
- 若需要把顶层 `D:\workspace\chcbz\project\jia\docs` 中的详设文档长期维护，应迁移或复制到已跟踪仓库。
