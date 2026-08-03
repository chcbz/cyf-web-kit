# Juyiting Occlusion V2 · E1 V0 证据补齐报告

- 日期：2026-08-03
- Writer：`deepseek_flash_worker`
- 基线 commit（web 分支）：`2424f51f375814f403ca70a9a6e9948728e595b1`
- TMX：`public/juyiting/hall.tmx`
- TMX SHA-256：`e2b79085d2caf232801f9843bb1cfafa941fb5a7d38e16cede60ecb0ab3e8401`
- 本报告绑定：`tests/fixtures/juyiting/occlusion-v0/source-hashes.json`（canonical + prop SHA-256）、`inventory.json`、`mask-ledger.md`、`layers/*.svg`（每个 SVG 内嵌 `data-commit` / `data-tmx-sha256` / `data-generation-id`）、`asset-report.json`。
- 稳定 provenance：fixture 的 `baselineCommit` / SVG `data-commit` 固定为上述基线，不使用当前 HEAD 生成。无参数 verify 会证明基线是当前 HEAD 的 ancestor，并通过 `git show <baselineCommit>:<path>` 对 hall.tmx 与关键资产重新计算 SHA-256；因此后续提交不会触发“重新生成 → HEAD 再变化”的循环。
- `data-generation-id` 算法：先把该字段设为 64 个 `0` 生成 provisional SVG，再对 provisional SVG 计算 SHA-256，最后将结果写回。它**不是 final SVG 的 self-hash**；SVG 另含 `data-generation-algorithm=sha256-provisional-svg-zero-id-v1`。

## 1. 已冻结回归用例（用户事实 → 回归条目）

| 用例 ID | 事实 | 预期 |
| --- | --- | --- |
| `REG-TABLE-LUJUNYI-HISTORICAL` | 卢俊义历史截图在右上桌子区域头部/上身被可见桌子像素错误覆盖（FAIL） | 修复后同坐标/动画帧不再被前方桌子像素错误覆盖 |
| `REG-TABLE-HUSANNIANG-POSITIVE` | 扈三娘对应历史截图未被桌子错误遮挡（PASS 正向基线） | 修复卢俊义时不得破坏该正向基线 |
| `REG-TABLE-ROLE-INVARIANCE` | 同脚点/floor/elevation/关系条件下排序不得随角色身份变化 | 排序键不含角色身份 |
| `REG-TABLE-TARGET-RELATION` | 桌前目标关系固定为 `桌子 < 人物 < 前方栏杆`（table < agent < front railing） | sortAnchor：table≈379 < agent foot≈420 < railing≈458（设计文档 §10 候选；E8A 冻结最终值） |

> 来源：`docs/juyiting-occlusion-visual-review-v0.md` §2；E1 只登记事实，不做视觉裁决。

## 2. V0-CS01～CS09 证据状态

| 编号 | 内容 | 状态 | 证据 / 缺口 |
| --- | --- | --- | --- |
| `V0-CS01` | 历史截图索引 | **BLOCKED（部分）** | A1～A6 历史截图文件在当前环境不可用（visualizations 目录为空），无法重建带时间顺序/crop 位置的索引；缺失项已明确标记。A1 卢俊义遮挡 FAIL、A2 扈三娘正向 PASS 以文字事实登记为回归条目，不能作为像素证据。 |
| `V0-CS02` | 同坐标角色 A/B（卢俊义/扈三娘同脚点、同朝向、同动画帧） | **BLOCKED** | 当前产品没有可控角色坐标/动画帧/depth 调试接口（无 `?jytOcclusionDebug` 等价物；`__JYTING_SCENE_DEBUG__` 无 x/y/depth/mask-hit；`?scene-debug=1` 仅聚合）。不能伪造。E6 debug overlay 后可补齐：角色运行 ID、世界坐标/脚点、动画帧与 anchor、camera/zoom/DPR、agent depth、命中 mask ID。 |
| `V0-CS03` | 桌子三点矩阵（behind/boundary/front × 2 角色，6 帧） | **BLOCKED** | 同上：无可控角色摆位与 debug 接口。E6 后可补齐。 |
| `V0-CS04` | 双人同时出现（UI 关 / world-ui 开各一张） | **BLOCKED** | 无可控角色 spawn/同步接口。E6 后可补齐。 |
| `V0-CS05` | Debug 对照（脚点、prop bbox、mask polygon/AABB、命中 ID、depth） | **BLOCKED** | 当前 v1 运行时 `_sortByDepth()` 使用 mask AABB + 双 depth 公式（behind `1.5+normY*1.0` / front `2.0+normY*3.5`，prop `3.0+propIndex*0.5`）——已由代码路径核实，但无运行时 overlay 输出。E6 后补齐渲染侧字段。 |
| `V0-CS06` | 资产组合（base、桌子 prop、canonical occluder 棋盘格/组合） | **BLOCKED（部分）** | 可自动化部分：canonical 与 duplicate occluder 字节级相同（SHA-256 `3e4f3f90…`）已由 `source-hashes.json` 证明；prop 像素组合展示需浏览器合成截图，E1 无此 harness，标 BLOCKED。E6/E9B 后由 RGBA 脚本补齐。 |
| `V0-CS07` | 几何分层（mask-only、collision/nav-only、routes/nodes-only、combined，带 ID/图例） | **DONE** | `tests/fixtures/juyiting/occlusion-v0/layers/occlusion-{mask-only,collision-nav-only,routes-nodes-only,combined}.svg`；每张含稳定基线 `data-commit`、`data-tmx-sha256`、provisional-hash `data-generation-id` 与算法标记、ID 标签及 `<title>` tooltip。生成脚本：`scripts/juyiting/render-occlusion-layers.mjs`。 |
| `V0-CS08` | 九宫基线（production-equivalent clean screenshot） | **BLOCKED** | 无后端/前端运行实例的自动化 production-equivalent 截图 harness（后端仅 401 探活；headless Chromium 仅支持静态 file:// 截图，无法渲染 melonJS 场景与后端数据）。E6 debug + 运行 harness 后补齐。 |
| `V0-CS09` | UI/相机回归（desktop/mobile/zoom/pan，labels/bubbles） | **BLOCKED** | 无浏览器驱动（无 puppeteer/playwright）。E6 后补齐。 |

### 每条截图必备字段（E6 后补齐模板，先冻结契约）

```text
commit, tmxSha256, 资源 hash, 人物运行时 ID, 世界坐标与脚点, 动画帧与 anchor,
camera/zoom/DPR, agent/prop/image-layer depth, 命中 mask ID
```

## 3. 机器清单摘要（`inventory.json` / `mask-ledger.md`）

- mask=37；prop rect=5（gid 6033–6037，tileset `hall-props`）；image layers=3（mid-occluders id=3、foreground-occluders id=10、lighting-overlay id=11 opacity .85）
- collision=38；nav_obstacles=38；hotspot polygon=5；nav_area=1；regions=8；nav_nodes=14；nav_edges=13；patrol_routes=6；parking_slots=32；queue_slots=1；home_slots=6；debug_labels=0
- TMX parser 保留 `hall-props.objectalignment=topleft`；ellipse shape：nav_nodes=9、parking_slots=28、queue_slots=1、home_slots=6（其余对象保留 rectangle/polyline 等实际 shape）
- 地图 1664×928（104×58 tile × 16px），sceneId `juyiting-main`，navGraphVersion `juyiting-main-v1`
- 每个 mask ledger 条目：index、TMX id、region（§9 权威映射）、regionGeometric 交叉核对、AABB、vertices、targetVisualStructure=TBD_E10A、stableId=TBD_E10B、status=baseline_present

## 4. 边界/缺口与后续任务归属

- **7 个 mask 几何 region 边界漂移**：49、54、57、74、76、80、83 的 centroid 与权威 region 不一致 → E10A 多边形/region 校准候选。
- **duplicate occluder**：mid 与 foreground 字节级相同（同一 SHA-256，size 71274）→ E16B 清理，E1 不删除（canonical 契约已冻结）。
- **CS02–05/08/09（production-equivalent）**：需要 E6 `?jytOcclusionDebug` overlay + 可控角色坐标/动画/depth 调试接口 + 浏览器驱动截图 harness；E1 明确标记 BLOCKED，不伪造数字/截图。
- **draw call / 运行时性能**：E1 无可靠自动采样 harness，标 BLOCKED（见 `asset-report.json` 的 `drawCallsRuntimePerf`）；E14 固定 108-agent benchmark 负责。
