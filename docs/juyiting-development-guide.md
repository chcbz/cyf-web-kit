# 聚义厅开发导航

本文件是本仓库 Camera/Input 开发与验证的权威入口。

## 稳定 facade

入口：`src/game/JuyitingGame.js` → `src/game/scenes/HallScene.js`。

| API | 稳定契约 |
| --- | --- |
| `resizeViewport({ width, height, kind, orientationChanged? })` | `kind` 为 `keyboard`、`orientation` 或 `layout`。键盘变化不改权威相机视口或 transform；旋转与布局变化保留当前中心世界点和 zoom。 |
| `setInteractionLocked(locked, reason = 'panel')` | 按 reason 维护幂等集合：重复 lock 同一 reason 不累加；一次 unlock 即移除该 reason。`panel` 与 `loading` 互不覆盖。 |
| `getCameraSnapshot()` | 返回与控制器状态脱离的可变副本，字段为 `transform`、`presetKey`、`presetId`、`animation`；修改副本不会修改控制器。未挂载或已销毁时返回 `null`。 |
| `resetToMainHall()` | 按当前 viewport preset 执行主厅复位动画，不改变面板或 Agent 选择状态。 |

`HallStage` 当前根据 camera snapshot 与相机策略常量派生回主厅按钮可见性。facade 暂不暴露 `isAwayFromPreset`；该能力留给后续集成任务，不是公开稳定 API。

## 响应式与生命周期策略

- 面板：桌面精细指针使用 `center-modal`，横屏触控使用 `right-drawer`，竖屏触控使用 `bottom-drawer`；打开面板时用 `panel` reason 锁定地图输入。
- 键盘 resize：结合 `visualViewport`、可编辑元素焦点、宽度稳定和 120 CSS px 高度阈值识别打开/关闭；只更新面板可用高度，保留相机 focus、zoom、preset 和 reset 状态。旋转信号去重后才发送 `orientation` resize。
- 加载：每次挂载尝试精确超时 **15 秒（15000 ms）**。retry 先递增 generation，使旧 timeout 与旧 ready/error callback 失效，再开始新挂载。
- 横竖屏：仅在 fullscreen/orientation API 不可用或请求被拒绝时显示手动旋转提示；请求 pending 期间不显示提示。stale/迟到完成按 ownership 安全清理，不修改组件状态，也不触碰宿主已有状态。

## 验证

从 `jia-web-kit` 仓库或 worktree 根目录依次运行：

```powershell
npm run typecheck:game
npm run lint
npm run test:run
npm run build
git diff --check
```

测试索引：`tests/game/camera/`、`tests/game/input/`、`tests/juyiting-component-behavior.test.js`、`tests/juyiting-hall-scene-runtime.test.js`、`tests/juyiting-melon-hall-scene.test.js`。
