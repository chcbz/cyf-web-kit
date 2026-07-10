# 聚义厅交互、NPC 仿真与模块化设计

> **状态：已被 `2026-07-11-juyiting-unified-map-and-agent-simulation-design.md` 取代。本文仅保留历史追溯用途。**


日期：2026-07-10

## 1. 背景

聚义厅已经从单页业务入口演进成地图优先的协作大厅：页面需要同时承担移动端地图交互、横竖屏兼容、面板操作、Agent 业务状态展示、未来游戏化 NPC 移动和可测试的场景调试能力。

本设计合并三部分已确认需求：

- 横竖屏、软键盘和面板期间的地图交互规则。
- 面向未来游戏化的 Agent / NPC 移动仿真规则。
- 随功能增长后的模块化拆分、初始化、测试和错误处理策略。

本轮目标仍是设计定稿，不立即实施。

## 2. 核心原则

1. 聚义厅是 map-first app。地图、TMX 和 movement 数据是核心运行时依赖，不是装饰资源。
2. 地图位置只由用户手势和“回主厅”改变，不由浏览器 resize、软键盘、面板打开关闭改变。
3. 后端决定“人物在做什么”，前端决定“人物怎么走得真实”。
4. 人物移动是业务反馈，不是业务完成条件。业务接口成功后立即成功，人物慢慢走过去。
5. 模块边界必须服务未来功能增长。不要继续把 camera、input、simulation、业务适配都塞进同一个文件。
6. 复杂纯逻辑优先使用 TypeScript，Vue 组件和现有 composables 保持当前 JS 风格。

## 3. 横竖屏与软键盘

### 3.1 默认视图

首次进入聚义厅时，根据当前设备方向应用默认主厅视图：

- 竖屏手机：聚焦忠义堂中间区域，适度放大。
- 横屏手机：仍聚焦主厅，但允许看到更多左右内容。
- PC：窗口足够时接近完整地图，小窗口仍聚焦主厅。

默认视图只用于：

- 首次 ready。
- 用户点击“回主厅”。

### 3.2 横竖屏切换

横竖屏切换采用“保持关注点”策略：

1. 切换前记录当前屏幕中心对应的 world point。
2. 切换后用新 viewport 反推 transform。
3. 尽量让同一个 world point 仍位于屏幕中心。
4. 如果新 viewport 放不下，只做最小幅度 clamp，避免露黑边。

横竖屏切换不允许：

- 回主厅。
- 重置缩放。
- 重新 fit 默认视图。
- 打断业务状态。

如果切换发生时用户正在拖动或双指缩放，立即取消当前手势，保留最后稳定 transform，再按新尺寸 clamp。

### 3.3 软键盘

软键盘导致的 `visualViewport.resize` 不调整地图 transform：

- 地图完全不动。
- 输入类面板根据可视高度调整自身高度。
- 输入框保持可见。
- 不触发地图 reset、fit 或 focus preset。

### 3.4 横屏按钮

保留横屏按钮：

1. 用户点击后尝试 `requestFullscreen()`。
2. 再尝试 `screen.orientation.lock('landscape')`。
3. 成功则进入横屏体验。
4. 失败则 toast：“请旋转手机横屏查看”。

无论成功失败，按钮不能重置地图 transform，也不能套横屏默认视图。

## 4. 面板与地图锁定

### 4.1 总规则

任何面板打开时，地图交互统一锁定：

- 禁止拖动。
- 禁止缩放。
- 禁止滚轮缩放。
- 禁止点击人物。
- 禁止点击热点。
- 禁止键盘缩放。

面板内部滚动、输入、按钮点击正常。

### 4.2 点击背景

面板打开时，露出的地图区域只作为背景和退出区域：

- 点击面板外背景关闭当前面板。
- 不触发地图点击。
- 不选中人物。
- 不打开热点。
- 关闭后恢复地图交互。
- 关闭不重置地图位置。

聊天和输入类面板关闭后保留草稿。再次打开同一个上下文时恢复草稿。

### 4.3 面板期间旋转

面板打开期间横竖屏切换：

- 面板保持打开。
- 面板按新方向重新布局。
- 地图在后台保持关注点并 clamp。
- 地图交互仍锁定。
- 草稿和面板状态保留。

普通面板：

- 竖屏为底部抽屉，约 70-85% 高。
- 横屏为右侧抽屉，约 45-55% 宽。

聊天/输入面板：

- 竖屏和横屏都接近全屏。
- 软键盘弹起时只调整面板高度。

## 5. NPC 移动目标

人物移动目标是未来游戏化，不只是氛围动画。

当前阶段不开放：

- 用户点地移动。
- 用户拖拽人物。
- 用户直接调度人物。

但底层 movement command 预留 `source: 'backend' | 'local' | 'user'`，未来可接入用户调度。

人物移动由系统事件和后端语义状态驱动：

- 点将。
- 自动点将。
- 议事开始。
- 查卷。
- Agent 回话。
- 返回默认岗位。
- 巡逻和待命。

## 6. TMX 内容管线

`public/juyiting/hall.tmx` 是聚义厅地图、热点和 NPC movement 的 source of truth。后续允许大模型修改 TMX 任意部分，也允许人工继续在 Tiled 中细调。设计重点不是限制谁能改，而是约束“怎么改、怎么校验、怎么 review”。

当前 `hall.tmx` 已包含基础地图层、遮挡层、灯光层、`collision`、`mask` 和 `hotspots`。后续需要在同一份 TMX 中补齐 movement 专用对象层，并把 hotspots 纳入同一套 stableId、schema、snapshot 和 ops 规范。

### 6.1 修改模式

TMX 修改支持两种模式：

1. 小改 direct patch。
2. 大改 edit ops。

小改可以直接 patch TMX：

- 改对象属性。
- 微调 object 坐标。
- 改热点 label / panel。
- 改图层 opacity / tint。
- 改图片 source。
- 改少量 nav node / slot 位置。
- 修 typo 或补 stableId。

大改必须使用 edit ops：

- 批量新增 / 删除 nav nodes。
- 重建 nav graph。
- 重排 parking / queue slots。
- 替换整组 object layer。
- 改 tile layer 大片数据。
- 改 tileset。
- 批量迁移属性名。
- 增加 movement schema version。
- 任何会影响大量对象 ID、连通性或资源引用的改动。

edit ops 使用 hybrid DSL：

- 优先使用地图语义操作，如 `add_nav_node`、`move_hotspot`、`replace_image_layer_source`。
- 兜底支持通用 property / XML patch。
- 禁止在 ops 中塞入无解释的大段 XML。

edit ops 提交到 `docs/juyiting/tmx-ops/` 作为审计记录，不作为运行时资产，不作为第二份 source of truth。大改需要同时生成文本 summary，列出 layer、object、resource、validation 和 before/after snapshot diff。

### 6.2 坐标和 snapshot

TMX 内部只存像素坐标，和当前地图原生尺寸保持一致：

- 地图原生尺寸：`1664 x 928`。
- tile 尺寸：`16 x 16`。
- map grid：`104 x 58`。
- object 的 `x/y/width/height/polygon/polyline` 均以 TMX 像素为准。

运行时可以派生百分比坐标或 world 坐标，但不把百分比写回 TMX。

大模型维护时读取脚本导出的 snapshot：

```text
docs/juyiting/tmx-snapshots/hall.snapshot.json
docs/juyiting/tmx-snapshots/hall-preview-clean.png
docs/juyiting/tmx-snapshots/hall-preview-debug.png
```

snapshot 包含：

- 结构化 layer / object 摘要。
- 像素坐标和百分比坐标。
- 资源清单。
- clean preview 路径。
- debug preview 路径。
- 校验报告。

snapshot 只由脚本生成，不手写，不参与运行。如果 snapshot 和 TMX 冲突，以 TMX 为准。

clean preview 用于视觉 review。debug preview 在地图上叠加 nav nodes、edges、regions、slots、hotspots、obstacles 和 stableId，给大模型和维护者理解结构。

### 6.3 图层命名和顺序

TMX layer name 全英文，长期目标使用 snake_case。parser、validator、edit ops 只以英文 layer name 定位。

建议 layer 顺序：

```text
background
props
mid_occluders
foreground_occluders
lighting_overlay

collision
mask
hotspots

nav_area
nav_obstacles
regions
nav_nodes
nav_edges
parking_slots
queue_slots
home_slots

debug_labels
```

当前已有短横线旧层名，如 `mid-occluders`、`foreground-occluders`、`lighting-overlay`，短期兼容。后续如需统一命名，应通过 edit ops 显式迁移。

layer 顺序需要规范，object 顺序保持 Tiled / 人工编辑顺序。snapshot 可以按 stableId 排序方便阅读，但不写回 TMX。

### 6.4 stableId 和对象属性

运行时对象使用两套标识：

- `object.name`：给人工在 Tiled 中阅读，可以用中文。
- `stableId` property：给程序、大模型、ops 和 validator 定位对象。

Tiled 自带 object id 不参与业务语义。

stableId 使用 kebab-case，并全局唯一：

```text
node-main-junction-01
edge-main-to-bounty-01
region-bounty-board
slot-bounty-parking-01
slot-bounty-queue-01
home-songjiang
hotspot-main-seat
```

对象属性采用 Tiled property type + schema 双重校验：

- Tiled 中使用 bool / int / float / color / string。
- parser 按 schema 输出 typed object。
- simulation 不直接读取 XML raw property。
- movement 核心字段类型不合法就是 fatal。

### 6.5 movement 图层对象

movement 数据需要提供：

- `nav_area`：全厅可行走区域。
- `nav_obstacles`：不可穿越障碍。
- `nav_nodes`：路网节点。
- `nav_edges`：节点连接。
- `regions`：语义区域，如主位、悬赏榜、议事区、案卷阁。
- `parking_slots`：正式停靠位，带容量、朝向、优先级。
- `queue_slots`：等待位。
- `home_slots`：persona 默认岗位。
- `debug_labels`：仅开发可见的调试标记。

`nav_area` 使用一个或多个 polygon。

`nav_obstacles` 使用 polygon / rectangle，运行时统一转 polygon。

`nav_nodes` 使用小圆 / 椭圆：

- 椭圆中心是 node 坐标。
- `width` property 是运行时通道宽度。
- `kind` 支持 `normal`、`junction`、`doorway`、`narrow`。

`nav_edges` 使用 polyline + `from/to` 语义引用：

- polyline 用于 Tiled 可视化。
- `from` / `to` 是运行时权威。
- 第一版只允许两个端点。
- 弯路通过多个 edge 串联。
- validator 检查 polyline 端点是否接近对应 nav node。

`regions` 支持 polygon / rectangle / ellipse，标准推荐 polygon。运行时统一转换为 polygon。

`parking_slots`、`queue_slots`、`home_slots` 使用小椭圆：

- 椭圆中心是脚底站位点。
- `radiusX` / `radiusY` 是运行时占位半径。
- `priority` 数字越小越优先。
- `capacity` 第一版默认 1。

### 6.6 hotspots

`hotspots` 也纳入 stableId / schema / snapshot / ops 规范。

hotspot 对象属性：

```text
stableId: string
hotspotId: string
panel: "chat" | "agents" | "tasks" | "catalog" | "library"
regionId?: string
label: string
priority?: number
hitSlopTouch?: number
```

hotspot shape 可以是 rectangle / polygon / ellipse，运行时统一转 hit area。hotspot 不要求落在 nav_area 内，因为有些交互目标位于墙面、桌面或道具上。

### 6.7 保护区和风险等级

大模型可以修改任何 TMX 部分，但 high-risk layers 和 protected objects 需要更高等级校验。

high-risk layers：

```text
background
tilesets
image layers
props
hotspots
nav_area
nav_obstacles
nav_nodes
nav_edges
regions
parking_slots
queue_slots
home_slots
```

protected object 同时在 TMX property 和外部 schema 中声明：

```text
protected: true
riskLevel: "high" | "medium" | "low"
riskReason: string
```

外部 schema 维护必备 protected 清单，如：

```text
region-main-seat
region-bounty-board
hotspot-main-seat
hotspot-bounty-board
home-songjiang
node-main-junction-01
```

修改 high-risk / protected 内容时，summary 必须列出原因、影响对象和验证结果。

### 6.8 版本绑定

TMX map properties 记录：

```text
movementSchemaVersion: "1"
navGraphVersion: "juyiting-main-v1"
spriteManifestVersion: "persona-sheets-v1"
```

运行时校验当前 sprite manifest version 是否满足 TMX 声明。不一致为 fatal。

后端语义状态只保存语义，不保存路径，因此 TMX 路网升级后无需迁移后端路径。但前端需要在 debug state 中暴露 `navGraphVersion` 和 `spriteManifestVersion`。

### 6.9 校验和预览

每次 TMX 改动都跑基础校验：

- XML 可解析。
- Tiled 基础结构合法。
- map / tile 尺寸符合预期。
- tileset / image layer 资源存在。
- layer name 合法。
- stableId 全局唯一。
- Tiled property type 和 schema 匹配。
- hotspot panel 合法。
- movement graph 连通。
- region / slot / home slot 合法。
- protected object 完整。
- sprite manifest version 匹配。

视觉相关改动生成 clean/debug preview。

关键行为改动运行 `/juyiting` 浏览器 smoke，不新增独立 preview 页面。`/juyiting` 是真实预览入口，debug overlay 可通过开发/测试开关打开。

TMX movement 校验失败时，聚义厅整体不可用。

## 7. 寻路策略

第一版使用路网 A*：

- 人物沿 TMX `nav_nodes` / `nav_edges` 跨区域移动。
- 接口设计保持可替换，未来可把内部换成 navmesh。
- 节点之间可做局部平滑，让路径不显得机械。

本阶段不做完整 navmesh。navmesh 作为后续可替换寻路内核，不进入第一版范围。

## 8. 默认岗位与 persona

默认岗位按 persona 固定：

- `personaCode` 是空间身份唯一键。
- 一个 persona / 水浒角色同一时间只能绑定一个 Agent。
- 真实 Agent 绑定 persona 后占据该 persona 的 home slot。
- 未绑定真实 Agent 时，可显示合成角色。
- 如果后端异常返回多个同 persona Agent，前端只显示第一个有效 Agent，其余不进入地图，并在 debug state 标记。

业务移动不受 home region 限制。人物可以沿全厅 nav 系统移动到任意目标区域，完成反馈后返回 home slot。

## 9. 行为队列与打断

人物移动采用 movement command queue。

巡逻和返回待命是低优先级行为，可以被业务事件打断。

任务、议事、查卷等业务移动开始后，不被普通回话或气泡打断。移动途中收到回话时：

- 不改路线。
- 可以边走边显示气泡。
- 到达后再切换站姿或状态。

业务事件冲突规则：

- 未开始或未 committed 的动作可被后端新状态覆盖。
- 已 committed 的任务移动先完成。
- 任务移动途中突然被拉去议事时，根据任务阶段判断。已接令先完成，未接令可改去议事。
- 后端新语义状态永远优先，但不瞬移；前端把它转换成下一条 movement command。
- 新状态需要带 `stateVersion` / `updatedAt`，前端只接受更新版本。

`committed` 第一版定义为：人物进入目标区域或距离目标 slot 小于阈值。

## 10. 多人移动、队列和碰撞

同一事件触发多个 Agent 移动时，分批出发：

- 不全员同帧启动。
- 按 150-350ms 间隔形成队列感。
- 重点 Agent 优先。

目标区域点位分两类：

- `parking_slots`：正式停靠位。
- `queue_slots`：等待位。

停靠位满后，超出 Agent 排到等待位。等待位也满后，后续 Agent 保持原地并通过气泡或状态表达，不强行挤入目标区。

碰撞规则采用严格碰撞：

- 人物不能互相穿过。
- 通道需要考虑宽度。
- 同向移动时后方减速或停止。
- 对向或交叉移动时按优先级等待。
- 目标 slot 被占用时不能进入。

让路优先级：

1. 点将、议事、查卷等业务移动。
2. 返回岗位。
3. 普通巡逻。
4. idle 微动。

业务移动遇到巡逻者时，巡逻者让路、暂停或退到等待点。

阻塞恢复主策略是重新规划路径：

- 检测到目标距离长期不减少、速度接近 0、前方持续被占用或等待超时后，触发 replan。
- 连续 replan 失败后进入等待。
- 保留全局安全阀：限制同时路径规划人数和单个 Agent 连续重规划次数，避免异常状态无限计算。

不做低端手机专项适配，不因为低端机关闭严格碰撞或减少规则一致性。

## 11. 速度、动画和等待表现

实际速度由角色基础速度和状态倍率共同决定：

```text
actualSpeed = personaBaseSpeed * behaviorMultiplier * pathModifier
```

示例：

- 巡逻慢。
- 接令/任务移动快。
- 议事移动中等。
- 返回岗位中等偏慢。
- 排队和避让时减速或停止。

第一版动画同步：

- 移动时播放 walk。
- 停止时播放 idle 或当前业务状态。
- 速度越快，walk 步频越快。
- 朝向根据移动方向切换。
- 不做精确步幅、原地转身、斜向专用动画或多方向 sprite。

等待表现：

- 等待超过 800ms-1.2s 后显示短气泡。
- 文案示例：“稍候”“让路”“借过”“候令”。
- 同屏等待气泡数量受限。
- 同一个 Agent 等待气泡有冷却。

人物移动不新增声音，不做脚步声、避让声或到达音效。

### 11.1 人物精灵图标准

后续人物精灵图采用新标准，不保留旧统一 atlas 兼容。

旧运行资源：

```text
public/juyiting/liangshan-character-walksheet-v1.png
```

在新标准实施后不再作为运行依赖。`resources.js` 不再加载统一 `character-atlas`，`HallAgent` 不再按统一 atlas row 取帧，`ATLAS_COLS` / `ATLAS_ROWS` / `CHAR_VISUALS` 逐步由 sprite manifest 取代。

新标准：

- 每个 persona 一张 spritesheet。
- 大模型可以生成或替换 spritesheet 和 manifest。
- 人工 review 后进入项目资源。
- 首批只做 6 个核心 persona：宋江、吴用、林冲、卢俊义、扈三娘、李逵。
- 视觉风格选择延期决策，不阻塞结构设计。

目录建议：

```text
public/juyiting/sprites/personas/
  songjiang-v1.png
  wuyong-v1.png
  linchong-v1.png
  lujunyi-v1.png
  husanniang-v1.png
  likui-v1.png
```

### 11.2 尺寸和动作排布

每帧固定：

```text
frameWidth: 192
frameHeight: 224
columns: 8
```

核心动作强制统一行序：

```text
row 0: idle
row 1: walk
row 2: talk
row 3: busy / work
```

基础 sheet 尺寸：

```text
8 columns x 4 rows = 1536 x 896
```

扩展动作可继续加行，并由 manifest 显式声明：

```text
wait
blocked
command
discuss
search
celebrate
special
```

fallback：

```text
wait -> idle
blocked -> wait -> idle
discuss -> talk
search -> busy
command -> busy
```

第一版仍只要求左右朝向，继续使用 `flipX`，不做四方向或八方向 sprite。

### 11.3 Sprite manifest

精灵图元数据不写进 TMX。TMX 管地图和场景版本，sprite manifest 管 persona 视觉资源。

建议新增：

```text
src/game/sprites/personaSpriteManifest.ts
```

manifest 示例：

```ts
type PersonaSpriteManifest = {
  version: 'persona-sheets-v1'
  frameWidth: 192
  frameHeight: 224
  columns: 8
  personas: Record<string, {
    required: boolean
    image: string
    rows: number
    scale: number
    anchor: { x: number; y: number }
    collider: { radiusX: number; radiusY: number }
    baseSpeed: number
    defaultFacing: 'left' | 'right'
    animations: Record<string, {
      row: number
      frames: number[]
      frameDurationMs: number
      loop: boolean
    }>
  }>
}
```

首批 required 规则：

- `songjiang.required = true`
- `wuyong.required = false`
- `linchong.required = false`
- `lujunyi.required = false`
- `husanniang.required = false`
- `likui.required = false`

`required: true` 的 spritesheet 缺失时，sprite validation 和 browser smoke 失败。`required: false` 的 spritesheet 缺失时，只 warning，该 persona 不显示，不使用 default sprite 冒充。

TMX 通过 `spriteManifestVersion` 绑定 manifest version。不一致为 fatal。

### 11.4 生成记录和人工 review

大模型生成或替换 spritesheet 时，必须同步更新 manifest 和 prompt 记录。

prompt 记录统一放在：

```text
docs/juyiting/sprite-prompts/
  songjiang-v1.md
  wuyong-v1.md
  linchong-v1.md
  lujunyi-v1.md
  husanniang-v1.md
  likui-v1.md
  style-selection-deferred.md
```

prompt 文档包含：

- 用途。
- 已选风格；当前为 deferred。
- spritesheet 规格。
- 生成 prompt。
- negative prompt / avoid。
- review notes。
- anchor / collider / scale 记录。
- known issues。

人工 review 重点：

- 人物是否符合 persona。
- 行走是否不抖。
- 左右翻转是否自然。
- 角色大小是否协调。
- 头顶、武器、衣摆是否被裁。
- 高亮圈和脚底是否对齐。
- 气泡和姓名牌是否不遮挡。
- 多人同屏是否不乱。

### 11.5 锚点、碰撞和排序

人物渲染和仿真都以脚底点为核心：

- sprite anchor 使用脚底中心。
- depth sort 使用脚底 y。
- 点击命中使用当前渲染位置和 collider。
- 碰撞体使用脚底椭圆或 capsule，不使用整张 sprite 矩形。
- 高亮圈围绕脚底绘制。
- 气泡和姓名牌从 sprite 视觉高度派生。

这能避免角色头饰、兵器或衣摆影响移动碰撞。

### 11.6 精灵图验收

精灵图资源需要测试：

- 图片存在且可加载。
- 图片尺寸符合 `columns * 192` 和 `rows * 224`。
- manifest 中每个 persona 的 rows / frames 不越界。
- 核心动作行存在。
- 所有必需动作名存在。
- 宋江 spritesheet 存在。
- collider 半径为正数。
- scale 在允许范围内。
- anchor 位于单帧范围内。
- required sprite 缺失时 smoke 失败。
- optional sprite 缺失时 debug warning。

浏览器 smoke 不检查 canvas 内文字，而是通过 debug state 验证 agent visual key、animation state、sprite loaded 和 sprite missing warnings。

## 12. 点击、镜头和面板期间仿真

移动中的人物可以点击：

- 点击只选中人物或显示人物卡片。
- 不暂停移动。
- 不改变路径。
- 不改变队列优先级。
- 选中高亮跟随人物当前位置。

选中人物后地图不自动跟随。地图位置仍只由用户手势和“回主厅”改变。

用户拖动、缩放地图时，人物仿真继续运行。地图只是镜头变化。

面板打开时：

- 地图交互锁定。
- 人物仿真继续。
- 人物动画继续。
- 用户不能点击背景人物。
- 人物到达目标后只通过气泡/状态变化表达，不弹额外 toast。

## 13. 后端语义状态

后端持久化人物场景语义状态，不存精确坐标、路径或帧级进度。

示例：

```js
{
  agentId: 'agent-1',
  personaCode: 'wuyong',
  sceneId: 'juyiting-main',
  behavior: 'moving_to_discussion',
  targetRegionId: 'councilTable',
  relatedType: 'task',
  relatedId: 'task-123',
  phase: 'moving',
  stateVersion: 123,
  startedAt: '2026-07-10T10:20:00+08:00',
  expiresAt: '2026-07-10T10:25:00+08:00'
}
```

前端负责：

- 根据 persona 找 home slot。
- 根据 target region 找 parking / queue slot。
- 用当前 TMX 路网计算路径。
- 根据 `startedAt` / `expiresAt` 判断是否继续、快进或回 home。

多用户一致性要求：

- 业务状态一致。
- 视觉动画不要求逐帧一致。
- 巡逻和局部避让可由各客户端本地计算。

后端状态更新：

- 业务接口写入主状态。
- 前端第一版只回报关键 phase：`arrived` / `blocked`。
- phase 回报失败不影响前端动画，不产生重试风暴。

## 14. 模块化架构

继续按当前技术层分散组织，不迁移到 `features/juyiting`。

### 14.1 组件层

`src/components/juyiting/`

职责：

- 页面局部 UI。
- 面板、抽屉、卡片、输入框。
- emit 用户事件。

禁止：

- 计算路径。
- 管碰撞。
- 直接调用 simulation。
- 直接修改人物坐标。

### 14.2 Composables 业务层

`src/composables/juyiting/`

职责：

- 业务数据加载。
- 后端语义状态适配。
- 面板状态。
- 草稿状态。
- 业务 command queue。

建议新增：

```text
useHallCommandQueue.js
useHallPanels.js
useHallDrafts.js
useHallBackendSceneState.js
useHallSceneState.js
```

### 14.3 Game camera

`src/game/camera/`

职责：

- transform。
- focal zoom。
- resize policy。
- 横竖屏保持 world point。
- view presets。

新增复杂纯逻辑模块使用 TypeScript。

### 14.4 Game input

`src/game/input/`

职责：

- pointer gesture。
- click / drag / pinch 判定。
- hit test。
- interaction lock。
- 面板锁地图。

### 14.5 Game map

`src/game/map/`

职责：

- TMX 解析。
- 资源派生。
- movement layer 解析。
- nav graph / region / slot 校验。

建议新增：

```text
tmxMovementParser.ts
movementSchema.ts
mapValidation.ts
tmxEditOps.ts
tmxSnapshot.ts
tmxPreviewRenderer.ts
```

### 14.6 Game simulation

`src/game/simulation/`

职责：

- movement command queue。
- A* pathfinding。
- collision world。
- reservation / queue。
- slot allocation。
- behavior state machine。
- phase report 生成。

建议新增：

```text
movementEngine.ts
movementCommandQueue.ts
graphPathfinder.ts
collisionWorld.ts
slotAllocator.ts
behaviorQueue.ts
backendSceneStateAdapter.ts
```

### 14.7 Game sprites

`src/game/sprites/`

职责：

- persona sprite manifest。
- persona visual mapping。
- animation definitions。
- sprite validation。
- collider / anchor visual metadata。

建议新增：

```text
personaSpriteManifest.ts
spriteValidation.ts
```

### 14.8 Game debug

`src/game/debug/`

职责：

- 统一 `sceneDebug` 聚合。
- 对外提供只读 snapshot。
- 给 UI smoke 和真机排查使用。

不允许 debug 模块修改业务或场景状态。

## 15. 通信与队列

同步纯计算使用函数调用：

- clamp。
- focal zoom。
- A*。
- slot 分配。
- TMX 校验。
- hit test。

异步行为和人物移动使用两层 command queue。

### 15.1 业务 command queue

位置：`src/composables/juyiting/useHallCommandQueue.js`

负责：

- `ASSIGN_TASK`
- `START_DISCUSSION`
- `SEARCH_LIBRARY`
- `SYNC_BACKEND_SCENE_STATE`
- `OPEN_PANEL`
- `CLOSE_PANEL`
- `REPORT_SCENE_PHASE`

它知道 taskId、discussionId、业务接口和面板状态，但不算路径。

### 15.2 Movement command queue

位置：`src/game/simulation/movementCommandQueue.ts`

负责：

- `MOVE_AGENT_TO_REGION`
- `RETURN_AGENT_HOME`
- `PATROL_AGENT`
- `WAIT_FOR_SLOT`
- `REPLAN_PATH`
- `REPORT_ARRIVED`
- `REPORT_BLOCKED`

它只知道 agent、persona、region、slot、priority、source，不知道业务接口细节。

## 16. 初始化顺序

采用地图优先初始化：

1. 页面挂载。
2. HallStage 启动 melonJS。
3. 加载并解析 `hall.tmx`。
4. 解析地图基础层。
5. 解析 TMX movement layers。
6. 校验 nav graph、regions、slots、home slots。
7. 地图 ready。
8. 初始化 simulation engine。
9. 注入 movement data。
10. 注入 agents / persona 映射。
11. 接入后端 semantic scene state。
12. 转换为 movement commands。
13. simulation 输出 `AgentSnapshot[]`。
14. HallScene 渲染人物。

业务请求可以并行发起，但结果进入 pending buffer。只有地图和 simulation ready 后，业务语义状态才 flush 到 simulation。

## 17. 错误处理

采用 fatal 上抛、非 fatal 记录 debug 的策略。

### 17.1 致命错误

致命错误让聚义厅整体进入错误态，显示重试：

- `TMX_LOAD_FAILED`
- `BASE_MAP_RESOURCE_FAILED`
- `MOVEMENT_SCHEMA_INVALID`
- `NAV_GRAPH_DISCONNECTED`
- `CORE_REGION_UNREACHABLE`
- `SPRITE_MANIFEST_VERSION_MISMATCH`
- `SIMULATION_INIT_FAILED`

页面只关心是否 fatal、用户文案和是否可重试。技术细节进入 debug state。

### 17.2 非致命错误

非致命错误不打断用户，只进入 debug / console warn：

- `LIGHT_OVERLAY_FAILED`
- `DECORATION_PROP_FAILED`
- `PHASE_REPORT_FAILED`
- `WAITING_BUBBLE_SKIPPED`
- `DUPLICATE_BACKEND_STATE_IGNORED`

## 18. Debug state

统一 `sceneDebug` 聚合所有运行态，只读暴露。

建议结构：

```js
{
  ready: true,
  fatalError: null,
  camera: { zoom, offsetX, offsetY, viewport },
  input: { interactionLocked, activeGesture },
  map: { tmxLoaded, movementReady, navGraphVersion, spriteManifestVersion, hotspotCount },
  sprites: {
    manifestReady,
    requiredMissingCount,
    optionalMissingCount,
    missingPersonas
  },
  simulation: {
    ready,
    movingCount,
    blockedCount,
    queuedCommandCount,
    replanningCount
  },
  agents: [
    {
      agentId,
      personaCode,
      behavior,
      phase,
      regionId,
      targetRegionId,
      blocked
    }
  ],
  backend: {
    stateVersion,
    semanticStateCount,
    lastSyncAt
  }
}
```

禁止暴露：

- token。
- 私聊内容。
- 完整用户资料。
- 原始接口响应。
- 大段聊天文本。

## 19. 测试策略

采用三层测试：单测 + 集成测试 + UI smoke。

### 19.1 单测

主力测试，覆盖纯逻辑：

- camera transform。
- resize policy。
- TMX movement parser。
- TMX edit ops validation。
- TMX snapshot export。
- nav graph validation。
- sprite manifest validation。
- A* pathfinding。
- slot allocator。
- collision / reservation。
- movement command queue。
- backend semantic adapter。

### 19.2 集成测试

覆盖模块组合：

- TMX movement data -> simulation engine -> AgentSnapshot。
- backend semantic state -> movement command -> phase report。
- panel state -> interaction lock -> scene input disabled。
- resize event -> camera policy -> transform preserved。

### 19.3 UI smoke

只保关键路径：

- `/juyiting` 加载成功。
- canvas 存在。
- debug state ready。
- `map.tmxLoaded` / `map.movementReady` / `simulation.ready` 为 true。
- `sprites.manifestReady` 为 true。
- required sprite 没有缺失。
- agent snapshots 可读。
- 面板打开后地图锁定。
- resize 不重置地图。
- 不再依赖 DOM 文本检查“宋江”。

## 20. 非目标

本设计不包含：

- 立即实施。
- 完整 navmesh。
- 用户点地移动。
- 用户拖拽人物。
- 低端手机专项适配。
- 帧率动态降级。
- 人物移动音效。
- 最终人物精灵图美术风格选择。
- 多用户逐帧同步。
- 地图失败后的列表式降级聚义厅。
- 非聚义厅页面重构。

## 21. 后续实施建议

后续进入实现前，建议拆成多个可验证阶段：

1. Camera / input 模块化和横竖屏保持关注点。
2. TMX movement schema、Tiled 图层规范和校验。
3. TMX edit ops、snapshot、clean/debug preview 和 summary 管线。
4. Persona spritesheet 新标准、sprite manifest、sprite validation 和宋江 required 校验。
5. Simulation 类型和 command queue 骨架。
6. A* 路网寻路和 slot 分配。
7. 严格碰撞、排队和 replan。
8. 后端语义状态 adapter 和 arrived / blocked phase 回报。
9. sceneDebug 聚合。
10. UI smoke 更新。

每个阶段都必须有对应单测或集成测试，浏览器 smoke 只验证关键用户路径。
