# E13 离线遮挡矩阵证据

- 状态：`GENERATED_OFFLINE`
- 遮挡矩阵：270/270 已生成，`matrixPass=true`
- 最终 E13 release：`releasePass=false`
- 本命令只重建并验证确定性的 270-shot mechanical matrix；V5/V6、37-mask mapping 与 live browser 审核产物由独立 aggregate reviewed-evidence gate 消费，不会从旧 fixture 静默混入本次机械结果。

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
- `index.json`、`oracle-report.json`、`pixel-recompute-report.json`、`matrix-gate.json`、本报告

`npm run generate:e13-offline` 从干净 checkout 重建并验证 mechanical matrix。隔离输出使用 `npm run generate:e13-offline -- --output /tmp/e13-matrix`；该目录不需要、也不会读取 V5/V6、mask mapping 或 live browser 审核产物。完整 reviewed-evidence 汇总另由 `npm run validate:e13-evidence` 显式消费已审核目录；若重建字节与已审核 fixture 漂移，aggregate 必须拒绝并要求重新审核，不能沿用旧 V6。

## 明确延期项

matrix index 中 camera、interaction、movement 保持独立 `DEFERRED`，因为它们不是本命令可确定重建的产物。已提交的 V6 与 live browser 审核证据只能由 aggregate reviewed-evidence gate 按实际 SHA 显式绑定；最终 release 仍由独立 release_guard 决定。
