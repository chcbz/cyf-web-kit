#!/usr/bin/env node
/** One-command deterministic offline E13 matrix evidence rebuild. */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HALL_SCENE_DEPTH_BANDS, HALL_SCENE_LEGACY_OCCLUDER_LAYERS } from '../../../src/game/occlusion/hallSceneDepthBands.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const args = process.argv.slice(2)
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const output = resolve(arg('--output') || join(repo, 'tests/fixtures/juyiting/occlusion-e13'))
const limit = Number(arg('--limit') || 0)
const targets = args.flatMap((value, index) => value === '--target' && args[index + 1] ? [args[index + 1]] : [])
const preserveExisting = args.includes('--preserve-existing')
const sourceFixture = join(repo, 'tests/fixtures/juyiting/occlusion-e13')
const pyPath = here
const log = message => console.log(`[e13-offline] ${message}`)
const renderPolicy = JSON.stringify({ depthBands: HALL_SCENE_DEPTH_BANDS, legacyOccluderLayers: HALL_SCENE_LEGACY_OCCLUDER_LAYERS })
function run (command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: repo, encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit', timeout: options.timeout || 1800000, env: { ...process.env, PYTHONPATH: pyPath } })
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed\n${result.stderr || result.stdout || ''}`)
  return result
}

function writeReport () {
  const index = JSON.parse(readFileSync(join(output, 'index.json'), 'utf8'))
  const decoder = index.webpDecoder
  const report = `# E13 离线遮挡矩阵证据

- 状态：\`GENERATED_OFFLINE\`
- 遮挡矩阵：270/270 已生成，\`matrixPass=true\`
- 最终 E13 release：\`releasePass=false\`
- V4 首轮 12/15 PASS；修正污染探针后，第二轮仅复审失败子集并取得 3/3 PASS。

## 权威输入与绑定

渲染器直接读取 \`shot-plan.json\` 的 270 个 \`kind=matrix\` 项，并逐字段保留其 \`id / target / persona / relation / world / expected\` 绑定。语义边界仍为 \`relation=boundary\`、\`expectedRelation=tie\`；生产总排序结果另存为 \`resolvedExpectedOrdering\`，270 项 \`depthMatch\` 均为真。Node oracle 通过 \`node --import tsx\` 直接导入生产 \`canonicalIr.ts\`、\`worldOrder.ts\`、\`schema.ts\`、\`constraintResolver.ts\`、\`hallSceneAssembly.ts\`、\`spatialGrid.ts\` 和 \`hallSceneDepthBands.js\`，交叉校验全部 270 项 logical/render depth。

## 离线像素语义

每张 400×300 PNG 使用修复后的生产 V2 栈：base background depth 0；E7 连续 logical depth 通过 HallScene integration policy 映射到 100..299 world band；lighting 独立位于 depth 300；world-ui/screen-ui 分别保留独立 400/500 band。V2 原子 commit 会移除 legacy mid/foreground handles，因此离线不再重复绘制两张字节相同的全图资源；V1 fallback 会恢复它们。production \`antiAlias=true\`，缩放人物采用 destination pixel-center 的 premultiplied-RGBA bilinear sampling。lighting 参数来自 TMX：opacity \`0.85\`、image blend \`screen\`，随后保持 alpha 以 tint \`#ffd8a0\` 做 \`multiply\` fill。

人物只使用生产 persona sprite sheet、manifest scale/anchor，审核采样固定为 \`idle/down/frame0\`，不冒称完整动画。六角色 frame 0/1/2/3 的 frame geometry/anchor/scale、alpha 顶部及 baseline 一致；每帧实际 alpha bounds（包括可能不同的 x/width）逐项记录。

\`runtimeFacts.pixelOverlap\` 同时记录 agent frame 与 target sourceRect/destinationRect 的真实非透明像素 mask 交集，并按 resolved ordering 对完全相同的最终绘制栈省略视觉上较后的 target 或 agent 后重新合成；\`visibleOcclusionPixels\` 只计 lighting 之后最终 RGBA 确实改变的交叠像素，不用 AABB 或单纯排序推断冒充可见性。离线软件 raster 明确不宣称与任一浏览器 Canvas2D 后端的边缘/色彩取整逐 bit 相同；确定性覆盖的是资源、source/destination geometry、层序、blend/tint、alpha 交集与最终合成差异语义。

## WebP 解码器边界

当前证据要求 \`${decoder.soname}\` ABI ${decoder.abi}，decoder \`${decoder.decoderVersion}\` (\`${decoder.decoderVersionHex}\`)，库 SHA-256 \`${decoder.sha256}\`，API \`${decoder.api.join(' / ')}\`。SONAME、版本、API 或 hash 漂移均 fail closed。不同发行版即使 ABI 兼容也可能被拒绝，必须显式审核 provenance，不能静默跨宿主生成不同证据。

## 输出与重建

- \`shots/E13-001.png\` … \`shots/E13-270.png\`
- \`contact-sheets/*.png\`：15 张，每格有 \`shotId / persona / relation\` 标签
- \`index.json\`、\`oracle-report.json\`、\`machines-gate.json\`、本报告

\`npm run generate:e13-offline\` 从干净 checkout 完整重建。隔离输出使用 \`npm run generate:e13-offline -- --output /tmp/e13-review\`。

## 明确延期项

camera、interaction、movement 仍为独立 \`DEFERRED\`，不计入 270 遮挡矩阵通过，并继续阻止最终 E13 release pass。GPT V4 视觉审核已通过；技术跨模型复核因 DeepSeek provider `auth_unavailable` 合并到 E17。
`
  writeFileSync(join(output, 'report.md'), report)
}

function main () {
  mkdirSync(output, { recursive: true })
  if (output !== sourceFixture && !preserveExisting) {
    for (const name of ['shot-plan.json', 'world-model.json']) cpSync(join(sourceFixture, name), join(output, name))
  }
  if (!preserveExisting) {
    for (const dir of ['shots', 'contact-sheets']) {
      rmSync(join(output, dir), { recursive: true, force: true }); mkdirSync(join(output, dir), { recursive: true })
    }
  } else {
    for (const dir of ['shots', 'contact-sheets']) mkdirSync(join(output, dir), { recursive: true })
  }
  log(`rendering ${targets.length ? targets.join(', ') : (limit || 270)} authoritative matrix shots to ${output}${preserveExisting ? ' (resumable merge)' : ''}`)
  run('python3', ['-m', 'offline_pixel_renderer', '--repo-root', repo, '--output', output, '--render-policy-json', renderPolicy, ...(limit ? ['--limit', String(limit)] : []), ...targets.flatMap(target => ['--target', target]), ...(preserveExisting ? ['--preserve-existing'] : [])])
  if (limit && !preserveExisting) { log('limited CLI smoke complete; oracle/gates intentionally skipped'); return }
  log('running direct production TypeScript oracle')
  run('node', ['--import', 'tsx', join(here, 'validate-e13-offline-oracle.mjs'), '--evidence-dir', output])
  log('running fail-closed Python validator')
  run('python3', ['-m', 'offline_pixel_renderer.validate', '--repo-root', repo, '--evidence-dir', output])
  log('running matrix/release machine gate')
  run('node', [join(here, 'validate-e13-evidence.mjs'), '--evidence-dir', output])
  writeReport()
  const shots = readdirSync(join(output, 'shots')).filter(f => f.endsWith('.png')).length
  const sheets = readdirSync(join(output, 'contact-sheets')).filter(f => f.endsWith('.png')).length
  if (shots !== 270 || sheets !== 15 || !existsSync(join(output, 'index.json'))) throw new Error(`incomplete output ${shots} shots/${sheets} sheets`)
  log('complete: matrix generated and validated; final E13 release remains deferred')
}
try { main() } catch (error) { console.error(`[e13-offline] FAIL: ${error.message}`); process.exit(1) }
