# 聚义厅移动优先地图加载、缩放与拖动设计

> **状态：已被 `2026-07-11-juyiting-unified-map-and-agent-simulation-design.md` 取代。本文仅保留历史追溯用途。**


日期：2026-07-09

## 1. 背景

聚义厅页面当前入口为 `/juyiting`，由 `JuyiHall.vue` 加载业务数据，由 `HallStage.vue` 挂载 melonJS canvas，由 `JuyitingGame.js` 初始化 melonJS、加载 TMX 与资源，由 `HallScene.js` 渲染地图层、热点和人物，并维护地图 transform。

本轮目标不是立即修改代码，而是先完整定义多终端行为，避免只修好当前 PC 页面，导致手机 Chrome、微信浏览器、横竖屏、软键盘、面板滚动等场景继续出问题。

## 2. 终端优先级

1. 手机优先：
   - 安卓 Chrome。
   - 微信内置浏览器。
2. 第二梯队：
   - iPhone Safari。
   - iOS 微信浏览器。
3. 最后适配：
   - PC Chrome / Edge。

所有交互设计以手机触控体验为主，PC 鼠标和键盘行为作为同一套 transform 能力的输入适配。

## 3. 目标

- 手机首次进入聚义厅时，默认聚焦忠义堂中间区域，适度放大。
- 地图加载、业务数据加载、人物加载互相解耦。
- 单指拖动、双指缩放、PC 滚轮缩放必须稳定、跟手、无明显漂移。
- 缩放围绕操作焦点：双指中心或鼠标位置。
- 拖动与点击严格区分，轻点打开，拖动不误触。
- 面板打开时冻结地图，面板内部仍可滚动。
- 手机普通面板使用底部抽屉，聊天/输入类面板接近全屏，PC 保持居中浮层。
- 横竖屏和窗口 resize 时保持当前关注点，只重新 clamp 边界。
- 软键盘弹起时优先保证面板可用，不触发地图重置。
- 地图资源 15 秒加载超时后显示重试。
- `/agent/map` 失败不影响地图加载，只影响人物显示。
- 仅开发/测试环境暴露只读 debug state，辅助自动化与真机排查。
- 修复聚义厅用户可见乱码文案。

## 4. 非目标

本轮不做以下内容：

- 不做惯性拖动。
- 不支持双击缩放或双击回主厅。
- 不主动做 service worker 地图资源缓存，仅利用浏览器默认缓存。
- 不记忆刷新后的上次地图位置。
- 不做人物跨区域、跨场景移动。
- 不做大型多场景切换实现，只预留配置结构。
- 不修非聚义厅页面乱码。
- 不修代码注释乱码，除非影响用户可见文案生成。

## 5. 当前加载链路梳理

### 5.1 路由入口

`src/router/index.js`：

- `/` 重定向到 `/juyiting`。
- `/juyiting` 加载 `src/components/world/JuyiHall.vue`。

### 5.2 页面数据加载

`JuyiHall.vue` 挂载时：

1. 设置全局标题和导航栏显示状态。
2. 调用 `refreshHall({ silent: true })`。
3. 启动对白气泡。

`refreshHall()` 并行调用：

- `loadAgents()`。
- `loadTasks()`。

`loadAgents()` 来自 `src/composables/juyiting/useHallData.js`，并行调用：

- `loadMapAgents()`：请求 `/agent/map`，只保留 online / busy 人物。
- `loadRosterAgents()`：请求 `/agent/roster`。
- `loadPersonaCatalog()`：请求 `/agent/personas/catalog`。

### 5.3 场景挂载

`JuyiHall.vue` 渲染 `HallStage.vue`，传入：

- `sceneAgents`。
- `sceneHotspots`。
- `selectedAgent`。
- 点击、打开面板、刷新等事件。

`HallStage.vue` 中 melonJS 容器是：

```html
<div ref="melonContainerRef" class="melon-layer" aria-hidden="true"></div>
```

`HallStage.vue` 挂载时：

1. 建立方向与 resize 监听。
2. 调用 `mountScene()`。
3. `mountScene()` 调用 `juyitingGame.mount(container, callbacks)`。
4. mount 成功后调用 `juyitingGame.start()`。

### 5.4 melonJS 初始化

`src/game/JuyitingGame.js` 当前负责：

1. 动态导入 melonJS。
2. 等待 `me.device.onReady`。
3. 创建 `HallScene`。
4. `me.video.init(1664, 928, { parent, renderer: CANVAS, scale: 'auto', scaleMethod: 'fit' })`。
5. 加载 boot 资源：
   - `/juyiting/hall.tmx`。
   - `/juyiting/liangshan-character-walksheet-v1.png`。
6. 解析 TMX。
7. 加载 TMX 派生资源。
8. 注册 PLAY state。
9. 进入 `HallScene._buildScene()`。

### 5.5 场景渲染

`src/game/scenes/HallScene.js` 当前负责：

1. `_renderTileLayers()`：把 TMX tile layer 绘制到离屏 canvas，再作为 image layer 加入 world。
2. `_renderModularLayers()`：渲染 TMX image layer，包括遮挡层、灯光层、装饰道具。
3. 创建 hotspot marker。
4. 注册 viewport pointer / wheel 事件。
5. 同步 scene agents 并创建 `HallAgent`。
6. 维护 transform：
   - `offsetX`。
   - `offsetY`。
   - `zoom`。

## 6. 当前关键问题判断

### 6.1 UI smoke 的宋江判断已过时

真实浏览器 smoke 当前失败在等待：

```js
(document.body.innerText || '').includes('宋江')
```

但人物已经绘制到 canvas 内，DOM 文本不包含宋江是合理现象。后续 smoke 应改为读取 `/agent/map` 或开发/测试 debug state 验证人物数据，而不是依赖 body text。

### 6.2 缩放焦点不正确

当前 `zoomBy(delta)` 只改变 zoom，缩放中心固定为 viewport 中心。手机双指缩放和 PC 鼠标滚轮应围绕操作焦点缩放，否则会产生漂移感。

### 6.3 resize 会过度重置地图

当前 `HallStage` 在 `resize` 和 `visualViewport.resize` 时调用 `fitSceneToViewport()`，这可能导致：

- 横竖屏切换时丢失当前关注点。
- 微信或手机软键盘弹起时地图跳动。

后续需要区分真实布局变化和软键盘变化。

### 6.4 面板打开只暂停动画，不显式冻结地图交互

当前页面打开面板时主要通过 CSS 暂停动画，但没有明确的地图交互开关。后续需要显式支持：

```js
juyitingGame.setInteractionEnabled(false)
```

并在面板关闭后恢复。

### 6.5 调试状态不足

canvas 内部状态不容易从浏览器 DOM 直接判断。需要开发/测试环境暴露只读 debug state，用于自动化和手机排查。

## 7. 地图视图策略

### 7.1 默认视图

手机首次进入：

- 默认聚焦忠义堂中间区域。
- 不依赖 `/agent/map` 是否成功。
- 不自动打开任何面板。
- 不保留上次拖动/缩放位置。

PC / 大屏首次进入：

- 根据窗口比例自动决定。
- 宽高充足时接近完整地图。
- 小窗口、窄屏、竖屏时聚焦主厅。

平板：

- 横屏接近 PC 策略。
- 竖屏接近手机策略。

### 7.2 回主厅

提供一个右下角悬浮圆形图标按钮：

- 只显示图标，不显示文字。
- `aria-label` 和 `title` 使用“回主厅”。
- 仅当地图 transform 偏离默认视图超过阈值后显示。
- 面板打开时隐藏。
- 底部人物卡片出现时自动上移，避免遮挡。
- 点击后 150-250ms 短动画回到忠义堂默认焦点。
- 手势过程中无动画，必须跟手。

### 7.3 resize 与横竖屏

- 首次 ready：应用默认视图。
- 用户已经拖动/缩放后：尊重当前关注点。
- 横竖屏切换、PC resize：保持当前屏幕中心对应的 world point，只重新计算边界并 clamp。
- 软键盘导致的 visualViewport resize：不调整地图，只调整面板。
- 不依赖 fullscreen 或 `screen.orientation.lock()` 成功。

## 8. 坐标与未来扩展策略

本轮采用：

- 同时支持百分比和像素。
- 长期以“区域锚点 + 区域内坐标”为主。

原因：

- 如果只是等比例换高清图，百分比稳定。
- 如果以后在右侧/下方拼接新地图，全图百分比会变化。
- 区域内百分比不会因全图扩展而破坏旧区域配置。

建议配置形态：

```js
viewPresets: {
  mainHall: {
    regionId: 'baseHall',
    focus: { unit: 'percent', x: 50, y: 42 },
    mobileZoom: 1.25,
    desktopZoom: 'auto'
  }
}
```

未来多场景：

- 当前聚义厅热点仍先打开面板。
- 大型区域未来再通过路由或场景 ID 切换。
- 进入任何场景都使用该场景默认焦点，不保留上次位置。

## 9. 输入与手势规则

### 9.1 手机触控

- 单指拖动地图。
- 双指围绕双指中心缩放。
- 轻点人物：显示底部人物卡片。
- 轻点热点：打开对应面板，并清空/隐藏人物卡片。
- 轻点空白：关闭人物卡片。
- 拖动地图：不关闭人物卡片。
- 双指缩放：不关闭人物卡片。
- 不支持双击。
- 不做惯性拖动，松手即停。
- 不允许地图边缘出现明显黑边/空白。

### 9.2 点击与拖动判定

- pointerdown 记录起点。
- 移动超过阈值则认为是拖动，取消 pending click。
- mouse 阈值建议 6px。
- touch 阈值建议 10-12px。
- 一旦出现双指 pinch，取消点击。
- pointerup 时只有未拖动、非 pinch 才触发点击。

### 9.3 点击目标

点击目标优先级：

1. 人物。
2. 明确热点。
3. 空白地图。

手机上人物和热点使用隐形 hit slop 扩大点击区域，视觉不变。hit slop 应只针对 touch 或 coarse pointer 增强，避免 PC 精准点击被影响。

### 9.4 PC 输入

- 鼠标位于地图区域时：滚轮直接缩放地图。
- PC 滚轮缩放围绕鼠标位置。
- 鼠标拖动地图。
- 地图区域显示 `cursor: grab`。
- 拖动中显示 `cursor: grabbing`。
- 键盘保留：
  - `+` / `=` 放大。
  - `-` / `_` 缩小。
  - `0` 回主厅或默认视图。

## 10. 面板与滚动规则

### 10.1 总规则

- 面板打开时地图冻结。
- 地图不响应拖动、缩放、点击、滚轮。
- 面板内部保留滚动、输入、按钮点击能力。
- 关闭面板后地图恢复原 transform，不重置、不跳动。

### 10.2 手机面板

普通面板：

- 点将册。
- 悬赏榜。
- 招贤令。
- 藏经阁普通查看。

采用底部抽屉：

- 从底部弹起。
- 高度约 70-85%。
- 顶部圆角。
- 内部内容可滚动。

聊天/输入类面板：

- 主厅议事。
- 私聊。
- 悬赏讨论。
- 需要长输入的面板。

采用接近全屏：

- 高度 90% 或跟随 visualViewport。
- 输入框始终可见。
- 键盘弹起时面板高度收缩。
- 背景地图不重新 fit。

### 10.3 PC 面板

PC 保持居中浮层：

- 鼠标滚轮在面板内部只滚动面板内容。
- 不传给地图。
- 关闭后恢复地图交互。

### 10.4 CSS 方向

地图层应强控制默认手势：

```css
.juyi-page,
.hall-stage,
.hall-board,
.melon-layer,
.melon-layer canvas {
  overscroll-behavior: none;
  touch-action: none;
}
```

面板内容滚动区不能粗暴继承 `touch-action: none`，需要允许滚动和输入操作。

## 11. 加载、失败与降级

### 11.1 加载态

- 地图加载中显示轻量文字 + 小 spinner。
- 文案：“聚义厅地图加载中…”
- 显示在地图中央。
- 加载中禁用地图手势。
- 不依赖额外图片资源。

### 11.2 超时

- `mountScene()` 开始后 15 秒未 ready，进入超时失败态。
- 显示：“地图加载超时，请重试”。
- 提供重试按钮。
- 当前 mount attempt 作废。
- 清理旧 melonJS 实例。

### 11.3 资源分级

致命资源失败则地图不可用：

- TMX 文件。
- tile background 所需底图或 tileset。
- melonJS 初始化。
- canvas 创建。

非致命资源失败可降级：

- 灯光 overlay。
- 前景遮挡层。
- 个别装饰 prop。
- 人物 sprite。
- 音效。

非致命失败时：

- 地图仍进入 ready。
- 控制台 warn。
- debug state 标记 degraded。
- 用户侧最多轻量提示一次，不阻塞。

### 11.4 业务数据失败

`/agent/map` 失败：

- 地图照常显示。
- 不显示在线人物。
- 轻量提示“人物暂未入厅”。
- 不清空或重建地图。

任务、名册、藏经阁、聊天接口失败：

- 不影响地图。
- 只影响对应面板。

## 12. 生命周期与取消

快速切路由、刷新、退出页面时必须安全取消：

- 当前 mount attempt 失效。
- loader 回调晚到也不能操作旧 DOM。
- 释放 pointer / wheel / touch 事件。
- 清理 world children。
- 不残留多个 canvas。
- 重试地图前先销毁旧实例。
- 防止多个 melonJS 实例抢事件。

当前已有 `sceneMountAttempt` 和 `_mountToken`，后续应在新 loading timeout、interaction enabled、debug state 中继续沿用同一套 generation guard。

## 13. 调试状态

仅开发/测试环境暴露只读 debug state，例如：

```js
window.__JYTING_SCENE_DEBUG__ = {
  ready: true,
  degraded: false,
  transform: { zoom: 1.25, offsetX: 0, offsetY: 0 },
  viewport: { width: 1664, height: 928 },
  canvasRect: { width: 390, height: 720 },
  mapLoaded: true,
  agentCount: 4,
  hotspotCount: 5,
  interactionEnabled: true
}
```

禁止暴露：

- token。
- 私聊内容。
- 完整用户资料。
- 敏感接口响应。

UI smoke 应优先读取 debug state 和接口结果，而不是依赖 canvas 内不可见的 DOM 文本。

## 14. 用户可见乱码文案修复范围

本轮修聚义厅用户直接可见乱码：

- 页面标题。
- 顶部工具按钮。
- loading / error / retry。
- 面板标题。
- toast。
- 地图交互提示。
- 人物卡片按钮。
- 空状态/失败状态。

不处理：

- 非聚义厅页面。
- 代码注释。
- 测试描述。
- 不显示给用户的内部常量说明。

修复策略：

- 功能明确的按上下文改成自然中文。
- 不确定原意的改成中性短文案。

## 15. 建议文件结构

允许新增小型工具/配置文件：

```text
src/game/sceneTransform.js          # 纯数学：zoom、pan、clamp、focus
src/game/sceneViewPresets.js        # 默认视图、主厅焦点、设备策略
src/game/sceneInteractionConfig.js  # 点击阈值、缩放范围、hit slop
src/game/sceneDebug.js              # 开发/测试 debug state
```

原则：

- 数学计算可单测。
- 设备策略可单测。
- `HallScene.js` 只负责调用，不继续堆积复杂判断。
- 后续扩地图/多场景时优先改配置。

## 16. 测试与验收

### 16.1 自动化测试

需要覆盖：

- 手机默认聚焦忠义堂 preset。
- PC 根据窗口比例选择默认视图。
- focal zoom 保持双指中心或鼠标点对应 world point 不漂移。
- pan clamp 不露明显空白。
- resize 保持当前关注点。
- 软键盘类 visualViewport resize 不触发地图重置。
- click vs drag 阈值。
- touch hit slop。
- 面板打开时地图 interaction disabled。
- 回主厅按钮偏离默认后显示，回到默认后隐藏。
- loading 15 秒超时。
- `/agent/map` 失败不影响地图 ready。

### 16.2 本地 Chrome smoke

需要验证：

- 登录后进入 `/juyiting`。
- `.juyi-page` 存在。
- `.melon-layer canvas` 存在。
- debug state ready。
- `/agent/map` 返回人物时，debug `agentCount` 正确。
- wheel 后 zoom 改变。
- drag 后 offset 改变。
- 面板打开后 wheel/drag 不改变地图 transform。
- smoke 不再依赖 `document.body.innerText.includes('宋江')`。

### 16.3 手机手工 checklist

安卓 Chrome：

- 首次进入聚焦忠义堂。
- 单指拖动跟手。
- 双指围绕双指中心缩放。
- 缩放/拖动不露明显黑边。
- 轻点人物显示底部卡片。
- 轻点空白关闭卡片。
- 轻点热点打开面板并隐藏卡片。
- 面板打开后地图冻结，面板内部可滚。
- 聊天输入时软键盘不遮挡输入框，地图不跳。
- 横竖屏切换保持当前关注点。
- 偏离默认后出现右下角回主厅图标。

安卓微信浏览器：

- 同安卓 Chrome。
- 重点检查下拉刷新、页面滚动、双指浏览器缩放是否抢地图手势。
- 重点检查键盘弹起。

第二梯队 iOS Safari / iOS 微信：

- 重点检查 touch-action、overscroll、visualViewport 和键盘弹起。

PC Chrome / Edge：

- 默认视图按窗口比例决定。
- 地图 hover 显示 grab。
- 拖动显示 grabbing。
- 鼠标滚轮围绕鼠标点缩放。
- 面板内滚轮不传给地图。
- 键盘 `+`、`-`、`0` 可用。

## 17. 实施阶段建议

后续进入实现前，建议按以下阶段推进：

1. 先补 transform / preset / interaction 配置的单元测试。
2. 实现 focal zoom、focus preset、resize preserve focus。
3. 加入 interaction enabled 与面板冻结联动。
4. 加入 loading timeout 和 debug state。
5. 调整面板移动端布局。
6. 修用户可见乱码文案。
7. 更新 UI smoke。
8. 执行自动化和手工 checklist。

每个阶段只解决一个问题，不把数学、样式、文案、自动化混在一次不可回滚的大改里。
