# 聚义厅开发导航

> 本仓库内的低 token 开发入口；完整历史与跨仓库索引仍以工作区级 `docs/juyiting-development-guide.md` 为准。

## Camera/Input 稳定接口

入口：`src/game/JuyitingGame.js` → `src/game/scenes/HallScene.js`。

| API | 稳定契约 |
| --- | --- |
| `resizeViewport({ width, height, kind, orientationChanged? })` | `kind` 为 `keyboard`、`orientation` 或 `layout`；键盘变化不改权威相机视口/变换，旋转与布局变化保留当前中心世界点和缩放。 |
| `setInteractionLocked(locked, reason = 'panel')` | 按原因引用计数；`panel`、`loading` 独立加锁/解锁，不得互相覆盖。 |
| `getCameraSnapshot()` | 返回只读快照（当前 preset、transform、reset animation），未挂载/已销毁时为 `null`。 |
| `resetToMainHall()` | 按当前 viewport preset 执行主厅复位动画；不改变面板和 Agent 选择状态。 |

`HallStage` 的回主厅按钮当前根据 camera snapshot 与相机策略常量计算可见性。`isAwayFromPreset` 的 facade 暴露明确推迟到后续集成任务；它不是公开稳定 API。

## 响应式与生命周期策略

- 面板：桌面精细指针为 `center-modal`，横屏触控为 `right-drawer`，竖屏触控为 `bottom-drawer`；面板打开期间立即使用 `panel` reason 锁定地图输入。
- 键盘 resize：优先结合 `visualViewport`、可编辑元素焦点、宽度稳定和 120 CSS px 高度阈值识别；键盘打开/关闭均只更新面板可用高度，保留相机 focus、zoom、preset 和 reset 状态。旋转信号去重后才发送 `orientation` resize。
- 加载：每次挂载尝试的超时精确为 **15 秒（15000 ms）**。retry 先递增 generation，使旧 timeout、旧 ready/error callback 失效，再启动一次全新挂载。
- 横竖屏：仅释放本组件实际取得的 fullscreen/orientation lock；API 缺失、拒绝或延迟完成时显示“请旋转手机横屏查看”，卸载后的迟到成功也只回收本次取得的所有权，不触碰宿主已有状态。

## Camera/Input 验证

在 `web/jia-web-kit`（或对应 worktree 根目录）依次运行：

```powershell
npm run typecheck:game
npm run lint
npm run test:run
npm run build
git diff --check
```

相关入口：`tests/game/camera/`、`tests/game/input/`、`tests/juyiting-component-behavior.test.js`、`tests/juyiting-hall-scene-runtime.test.js`、`tests/juyiting-melon-hall-scene.test.js`。
