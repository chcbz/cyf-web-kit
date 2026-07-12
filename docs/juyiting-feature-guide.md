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
