# 聚义厅 Camera/Input 功能指南

本文件直接定义本仓库 Camera/Input Phase 1 的稳定页面行为；开发入口与完整验证命令见 `docs/juyiting-development-guide.md`。

## 页面契约

- `resizeViewport(change)`：`HallStage` 将 viewport 变化分类为 `keyboard`、`orientation` 或 `layout` 后转发。
- `setInteractionLocked(locked, reason)`：按 reason 维护幂等锁集合。重复设置同一 reason 不增加计数，一次解除即删除该 reason；面板和加载态分别使用 `panel`、`loading`。
- `getCameraSnapshot()`：返回 detached mutable copy，包含 `transform`、`presetKey`、`presetId`、`animation`；调用方可修改副本而不会改变相机控制器状态。场景不可用时返回 `null`。
- `resetToMainHall()`：显式回到当前设备 preset，不清理面板或选择上下文。

`HallStage` 依据 snapshot 和相机策略常量计算 reset 按钮可见性。`isAwayFromPreset` 的 facade 暴露有意推迟到后续集成任务，不属于公开稳定 API。

## 设备与恢复行为

- 响应式面板：桌面 `center-modal`；横屏触控 `right-drawer`；竖屏触控 `bottom-drawer`。打开任一面板时锁定地图输入。
- 软键盘：通过 `visualViewport`、editable focus、宽度稳定及 120 CSS px 高度边界过滤打开/关闭 resize；只调整面板布局，保留相机 viewport、中心世界点、zoom、preset 和 reset。
- 加载恢复：单次加载超时固定为 **15 秒（15000 ms）**；retry 通过 generation invalidation 废弃旧 timer 与旧 mount callbacks。
- 横屏 fallback：fullscreen/orientation API 缺失或拒绝时显示手动旋转提示。组件只释放自身取得的 fullscreen/orientation ownership，不释放宿主预先持有的状态。

## 关键测试索引

- `tests/game/camera/`：transform、preset、resize policy、reset/away policy、snapshot copy。
- `tests/game/input/`：pointer gesture、hit priority、keyboard/wheel、reason-set interaction lock。
- `tests/juyiting-component-behavior.test.js`：panel layout、keyboard preservation、15 秒 timeout/retry、fullscreen/orientation ownership。
- `tests/juyiting-hall-scene-runtime.test.js`、`tests/juyiting-melon-hall-scene.test.js`：facade 与场景集成。

## TMX 与人物精灵资产门禁

- `parseJuyiHallTmx` 会同时解析大厅视觉数据和移动数据。只有移动 schema 与导航图完整通过校验时，返回值才包含 `movementReady: true` 和已校验的 `movement`。
- 不支持的 `movementSchemaVersion` 或移动层字段/几何损坏会抛出结构化致命错误 `MOVEMENT_SCHEMA_INVALID`；在进入移动数据边界前发生的 XML、视觉层或程序解析缺陷使用独立的 `MAP_PARSE_FAILED`。两者均为 `severity: fatal`、`source: map`，且不会被 `_prepareMapData` 吞掉。
- 致命挂载失败会清理本次创建的场景、画布、容器引用、回调、加载中止器、ready timer、mount token 和 melonJS 实例，同时原样重新抛出结构化错误；随后 retry 从空状态创建一个新场景和画布。
- 人物精灵加载发生在地图资源就绪之后。必需的宋江精灵加载失败时，挂载结果仍为 `ready: true`、`movementReady: true`，同时为 `degraded: true`、`requiredMissingCount: 1`；地图和面板可继续使用，但不会创建宋江实体，也不会用其他 persona 替代。
- 公测 preflight 会在登录、HTTP、WebSocket 等网络检查之前依次执行地图和精灵发布校验。Windows 在缺少 `npm_execpath` 时通过 `cmd.exe /d /s /c` 执行固定白名单中的 npm 脚本，并传播非零退出码。

发布前完整验证：

```powershell
npm run validate:juyiting-map
npm run validate:juyiting-sprites
npm run typecheck:game
npm run test:run
npm run build
npm run test:juyiting:preflight
```
