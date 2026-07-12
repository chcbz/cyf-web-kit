# 聚义厅功能说明与持续优化指南

> 本文件索引 Camera/Input Phase 1 的稳定行为；其他业务功能仍查阅工作区级 `docs/juyiting-feature-guide.md`。

## 1. 稳定 Camera/Input facade

| API | 页面使用方式 |
| --- | --- |
| `resizeViewport(change)` | `HallStage` 将 viewport 变化分类为 `keyboard` / `orientation` / `layout` 后转发。 |
| `setInteractionLocked(locked, reason)` | 面板与加载态分别使用 `panel`、`loading` reason，避免一个状态误解锁另一个状态。 |
| `getCameraSnapshot()` | reset 按钮和动画轮询读取 preset/transform/animation；场景不可用时返回 `null`。 |
| `resetToMainHall()` | 用户显式回到当前设备 preset，不清理面板或选择上下文。 |

注意：`HallStage` 目前依据 camera snapshot 和相机策略常量派生 reset 按钮可见性。`isAwayFromPreset` 的 facade 暴露有意留给后续集成任务，不属于公开稳定 API。

## 2. 设备与恢复行为

- 响应式面板：桌面 `center-modal`；横屏触控 `right-drawer`；竖屏触控 `bottom-drawer`。打开任一面板时地图输入锁定。
- 软键盘：通过 `visualViewport`、editable focus、宽度稳定及 120 CSS px 高度边界过滤打开/关闭 resize；只调整面板布局，保留相机 viewport、中心世界点、zoom、preset 和进行中的 reset。
- 加载恢复：单次加载超时固定为 **15 秒（15000 ms）**；retry 通过 generation invalidation 废弃旧 timer 与旧 mount callbacks，禁止迟到回调覆盖新尝试。
- 横屏 fallback：fullscreen/orientation API 缺失或拒绝时显示手动旋转提示。组件只退出自身取得的 fullscreen、只解锁自身取得的 orientation；宿主预先持有的状态不释放，卸载后的异步完成按相同所有权规则回收。

## 3. 精确验证命令

```powershell
cd D:\workspace\chcbz\project\jia\web\jia-web-kit\.worktrees\juyiting-unified-simulation
npm run typecheck:game
npm run lint
npm run test:run
npm run build
git diff --check
```

关键测试索引：

- `tests/game/camera/`：transform、preset、resize policy、reset/away policy。
- `tests/game/input/`：pointer gesture、hit priority、keyboard/wheel、interaction lock。
- `tests/juyiting-component-behavior.test.js`：panel layout、keyboard preservation、15 秒 timeout/retry、fullscreen/orientation ownership。
- `tests/juyiting-hall-scene-runtime.test.js`、`tests/juyiting-melon-hall-scene.test.js`：facade 与场景集成。
