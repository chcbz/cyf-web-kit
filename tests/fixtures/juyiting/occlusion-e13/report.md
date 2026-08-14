# E13 离线遮挡矩阵证据

- 状态：`GENERATED_OFFLINE`
- 遮挡矩阵：270/270 已生成，`matrixPass=true`
- 真实 Chromium：19/19（camera 10、interaction 7、movement 2 + 6 个 before/mid/after movement frames），机器校验 17/17 PASS
- GPT live 视觉复审：camera / interaction / movement 全部 PASS，最高严重级 S0
- 最终 E13 release：`releasePass=false`（仅独立 `release_guard` 待完成）
- GPT V5 全量审核发现 5 个 P1；重建固定视口、可达探针、ownership overlay 和 37-mask mapping 后，GPT V6 全量审核 15/15 sheets、270/270 shots、37/37 mask cards PASS。

## 权威输入与绑定

渲染器直接读取 `shot-plan.json` 的 270 个 `kind=matrix` 项，并逐字段保留其 `id / target / persona / relation / world / expected` 绑定。语义边界仍为 `relation=boundary`、`expectedRelation=tie`；生产总排序结果另存为 `resolvedExpectedOrdering`，270 项 `depthMatch` 均为真。Node oracle 通过 `node --import tsx` 直接导入生产 `canonicalIr.ts`、`worldOrder.ts`、`schema.ts`、`constraintResolver.ts`、`hallSceneAssembly.ts`、`spatialGrid.ts` 和 `hallSceneDepthBands.js`，交叉校验全部 270 项 logical/render depth。

## 离线像素语义

每张 400×300 PNG 使用修复后的生产 V2 栈：base background depth 0；E7 连续 logical depth 通过 HallScene integration policy 映射到 100..299 world band；lighting 独立位于 depth 300；world-ui/screen-ui 分别保留独立 400/500 band。V2 原子 commit 会移除 legacy mid/foreground handles，因此离线不再重复绘制两张字节相同的全图资源；V1 fallback 会恢复它们。production `antiAlias=true`，缩放人物采用 destination pixel-center 的 premultiplied-RGBA bilinear sampling。lighting 参数来自 TMX：opacity `0.85`、image blend `screen`，随后保持 alpha 以 tint `#ffd8a0` 做 `multiply` fill。

人物只使用生产 persona sprite sheet、manifest scale/anchor，审核采样固定为 `idle/down/frame0`，不冒称完整动画。六角色 frame 0/1/2/3 的 frame geometry/anchor/scale、alpha 顶部及 baseline 一致；每帧实际 alpha bounds（包括可能不同的 x/width）逐项记录。

`runtimeFacts.pixelOverlap` 同时记录 agent frame 与 target sourceRect/destinationRect 的真实非透明像素 mask 交集，并按 resolved ordering 对完全相同的最终绘制栈省略视觉上较后的 target 或 agent 后重新合成；`visibleOcclusionPixels` 只计 lighting 之后最终 RGBA 确实改变的交叠像素，不用 AABB 或单纯排序推断冒充可见性。离线软件 raster 明确不宣称与任一浏览器 Canvas2D 后端的边缘/色彩取整逐 bit 相同；确定性覆盖的是资源、source/destination geometry、层序、blend/tint、alpha 交集与最终合成差异语义。

## WebP 解码器边界

当前证据要求 `libwebp.so.7` ABI 7，decoder `1.2.0` (`0x010200`)，库 SHA-256 `cddced092a8452bb7df72743d7810d736b4043cf9b00f41a4fdf72e120f438a0`，API `WebPGetDecoderVersion / WebPGetInfo / WebPDecodeRGBA / WebPFree`。SONAME、版本、API 或 hash 漂移均 fail closed。不同发行版即使 ABI 兼容也可能被拒绝，必须显式审核 provenance，不能静默跨宿主生成不同证据。

## 输出与重建

- `shots/E13-001.png` … `shots/E13-270.png`
- `contact-sheets/*.png`：15 张，每格有 `shotId / persona / relation` 标签
- `index.json`、`oracle-report.json`、`machines-gate.json`、本报告

`npm run generate:e13-offline` 从干净 checkout 完整重建。隔离输出使用 `npm run generate:e13-offline -- --output /tmp/e13-review`。

## 明确延期项

离线 `index.json` 继续将 camera、interaction、movement 标记为浏览器专属范围，不混入 270 遮挡矩阵。对应的真实 Chromium 证据已生成到 `live/`：10 个 camera、7 个 interaction、2 个 movement，PNG/hash/viewport/V2 renderer/camera contract/pointer-panel-bubble-lighting/movement contract 共 17/17 校验通过。GPT V6 离线全量视觉审核已通过；live camera/interaction/movement 视觉复审也已全部 PASS。独立技术复核和 release guard 按 E17/E18 完成。
