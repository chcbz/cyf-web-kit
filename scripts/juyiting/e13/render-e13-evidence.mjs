#!/usr/bin/env node
/**
 * E13: render static evidence (works with or without a browser).
 *
 * Consumes (committed, reproducible):
 *   tests/fixtures/juyiting/occlusion-e13/world-model.json
 *   tests/fixtures/juyiting/occlusion-e13/shot-plan.json
 *   public/juyiting/images/*.webp                    (map artwork)
 *   tests/fixtures/juyiting/occlusion-e13/runtime-blocked.json (when present)
 *
 * Emits:
 *   contact-sheets/overview.svg, cell-*.svg (9), focus-targets.svg
 *   index.json        (per-shot binding: id/world/persona/target stableId/expected relation)
 *   report.md         (summary + GPT review input path)
 *
 * The contact sheets are static layout basemaps (NOT runtime screenshots);
 * every sheet is labelled as such. No browser, no screenshot, no fabrication.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  REPO_ROOT, MAP, FOCUS_GROUPS, esc, round,
  loadLayerDataUris, buildMapImageGroup, buildGridOverlay, buildShotMarkers,
  buildTargetRects, buildLegendRows, cellSheetHeader, buildStyle,
} from './lib/contact-sheets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EVIDENCE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-e13')
const CONTACT_DIR = join(EVIDENCE_DIR, 'contact-sheets')

const sha256Text = text => createHash('sha256').update(text).digest('hex')
const sha256Buffer = buffer => createHash('sha256').update(buffer).digest('hex')

function readJson (path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function buildCellSheet (cell, worldModel, plan, layers) {
  const region = worldModel.regions.find(r => r.id === cell)
  const targets = worldModel.targets.filter(t => t.cell === cell)
  const shots = plan.filter(s => s.kind === 'matrix' && s.cell === cell)
  const targetByStableId = new Map(worldModel.targets.map(t => [t.stableId, t]))
  const W = 2400
  const MAP_X = 32
  const MAP_Y = 96
  const PANEL_X = 1740
  const PANEL_W = W - PANEL_X - 40
  const S = 1.7 // inset zoom
  const insetW = round(region.bounds.width * S)
  const insetH = round(region.bounds.height * S)
  const legendY = MAP_Y + insetH + 26
  const legendColumns = 2
  const legendColW = Math.floor(PANEL_W / legendColumns)
  const legendRowH = 16
  const legend = buildLegendRows(shots, PANEL_X, legendY + 18, legendColW, legendRowH, legendColumns)
  const H = Math.max(MAP_Y + MAP.height + 60, legendY + 18 + legend.rows * legendRowH + 50)

  const body = []
  body.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#0d1117"/>`)
  body.push(`<text x="32" y="48" class="title">${esc(cellSheetHeader(cell, worldModel, shots.length))}</text>`)
  body.push(`<text x="32" y="74" class="subtitle">${esc(`九宫 ${cell} · 区域 (${region.bounds.x},${region.bounds.y},${region.bounds.width}×${region.bounds.height}) · 目标 ${targets.map(t => t.stableId).join(' / ')} · 编号接触板（静态布局底图，非运行截图）`)}</text>`)

  // ── left: full map with cell highlight + markers ──
  body.push(`<g transform="translate(${MAP_X},${MAP_Y})">`)
  body.push(buildMapImageGroup(layers, ['base', 'mid', 'foreground'], 0, 0, MAP.width, MAP.height))
  body.push(buildGridOverlay(0, 0, 1, worldModel.regions, cell))
  body.push(buildTargetRects(targets, 0, 0, 1))
  body.push(buildShotMarkers(shots, 0, 0, 1, targetByStableId))
  body.push(`<text x="0" y="${MAP.height + 20}" class="note">静态布局底图：base + mid-occluders + foreground-occluders（无 lighting，lighting 见 overview 与 interaction 证据）</text>`)
  body.push('</g>')

  // ── right: zoomed inset ──
  const clipId = `clip-${cell}`
  body.push(`<defs><clipPath id="${clipId}"><rect x="${PANEL_X}" y="${MAP_Y}" width="${insetW}" height="${insetH}"/></clipPath></defs>`)
  body.push(`<text x="${PANEL_X}" y="${MAP_Y - 18}" class="heading">${esc(`区域放大 ×${S}（${region.zh} ${cell}）`)}</text>`)
  body.push(`<g clip-path="url(#${clipId})" transform="translate(${PANEL_X},${MAP_Y}) translate(${round(-region.bounds.x * S)},${round(-region.bounds.y * S)}) scale(${S})">`)
  body.push(buildMapImageGroup(layers, ['base', 'mid', 'foreground'], 0, 0, MAP.width, MAP.height))
  body.push(buildTargetRects(targets, 0, 0, 1))
  body.push(buildShotMarkers(shots, 0, 0, 1, targetByStableId))
  body.push('</g>')
  body.push(`<rect x="${PANEL_X}" y="${MAP_Y}" width="${insetW}" height="${insetH}" class="panel" fill="none"/>`)

  // ── right: legend ──
  body.push(`<text x="${PANEL_X}" y="${legendY}" class="heading">${esc(`${shots.length} 张矩阵图（六角色 × ${Object.keys(worldModel.relations).length} 关系 × ${targets.length} 目标）`)}</text>`)
  body.push(legend.lines)

  body.push(`<text x="32" y="${H - 24}" class="note">图例：● ${esc('蓝=behind(agent_y=anchor_y-34)')} · ● ${esc('琥珀=boundary(dy=0)')} · ● ${esc('绿=front(agent_y=anchor_y+34)')} ；虚线框=目标 rect；十字=TMX sortAnchor；★=E13 重点目标</text>`)
  body.push(`<text x="32" y="${H - 8}" class="note">属性：data-shot-id/data-persona/data-relation/data-world-x/data-world-y/data-expected — 机器门禁可解析验证。</text>`)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc"
  data-sheet="cell" data-cell="${esc(cell)}" data-shot-count="${shots.length}" data-shot-ids="${esc(shots.map(s => s.id).join(','))}">
<title id="title">E13 cell contact sheet ${esc(cell)}</title>
<desc id="desc">${esc(cellSheetHeader(cell, worldModel, shots.length))}</desc>
${buildStyle()}
${body.join('\n')}
</svg>
`
}

function buildOverviewSheet (worldModel, plan, layers) {
  const W = 2400
  const MAP_X = 32
  const MAP_Y = 96
  const PANEL_X = 1740
  const PANEL_W = W - PANEL_X - 40
  const targetByStableId = new Map(worldModel.targets.map(t => [t.stableId, t]))
  const focusTargets = worldModel.targets.filter(t => t.focus)
  const cameraShots = plan.filter(s => s.kind === 'camera')
  const interactionShots = plan.filter(s => s.kind === 'interaction')
  const movementShots = plan.filter(s => s.kind === 'movement')
  const H = 1150

  const body = []
  body.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#0d1117"/>`)
  body.push(`<text x="32" y="48" class="title">E13 全地图视觉审核 · 总览接触板（静态布局底图，非运行截图）</text>`)
  body.push(`<text x="32" y="74" class="subtitle">${esc(`九宫 3×3 · 六角色（宋江/卢俊义/扈三娘/李逵/林冲/吴用）· behind/boundary/front · ${plan.length} 张计划图（matrix ${worldModel.shotCounts.matrix} + camera ${worldModel.shotCounts.camera} + interaction ${worldModel.shotCounts.interaction} + movement ${worldModel.shotCounts.movement}）`)}</text>`)

  body.push(`<g transform="translate(${MAP_X},${MAP_Y})">`)
  body.push(buildMapImageGroup(layers, ['base', 'mid', 'foreground', 'lighting'], 0, 0, MAP.width, MAP.height, { lighting: 0.45 }))
  body.push(buildGridOverlay(0, 0, 1, worldModel.regions))
  body.push(buildTargetRects(focusTargets, 0, 0, 1, true))
  // camera case markers (bounty-board viewport focus)
  for (const shot of cameraShots) {
    const c = shot.camera
    body.push(`<g class="marker" data-shot-id="${esc(shot.id)}" data-kind="camera">
  <circle cx="${c.center.x}" cy="${c.center.y}" r="7" fill="none" stroke="#48a9ff" stroke-width="1.5"/>
  <text x="${c.center.x + 10}" y="${c.center.y + 4}" class="marker-label">${esc(shot.id)} ${esc(shot.cameraLabel)}</text>
</g>`)
  }
  // movement markers: start (agent default) → target anchor
  for (const shot of movementShots) {
    const target = targetByStableId.get(shot.targetStableId)
    if (!target) continue
    body.push(`<g class="marker" data-shot-id="${esc(shot.id)}" data-kind="movement">
  <line x1="1446" y1="413" x2="${target.anchor.x}" y2="${target.anchor.y}" stroke="#2dd4bf" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#arrow)"/>
  <text x="${target.anchor.x + 8}" y="${target.anchor.y - 8}" class="marker-label">${esc(shot.id)} ${esc(shot.movementLabel)}</text>
</g>`)
  }
  body.push('</g>')

  // right panel
  let ly = MAP_Y + 10
  body.push(`<text x="${PANEL_X}" y="${ly}" class="heading">覆盖清单（机器门禁校验）</text>`)
  ly += 30
  for (const region of worldModel.regions) {
    const targets = worldModel.targets.filter(t => t.cell === region.id)
    const count = plan.filter(s => s.kind === 'matrix' && s.cell === region.id).length
    body.push(`<text x="${PANEL_X}" y="${ly}" class="body">${esc(`${region.zh} ${region.id}: ${targets.length} 目标 / ${count} 图`)}</text>`)
    ly += 20
    for (const t of targets) {
      body.push(`<text x="${PANEL_X + 18}" y="${ly}" class="legend">${esc(`${t.focus ? '★' : ' '} ${t.stableId} anchor=(${t.anchor.x},${t.anchor.y}) tieBias=${t.tieBias}`)}</text>`)
      ly += 15
    }
    ly += 6
  }
  body.push(`<text x="${PANEL_X}" y="${ly + 8}" class="heading">重点区域（E13 handoff）</text>`)
  ly += 32
  for (const group of FOCUS_GROUPS) {
    body.push(`<text x="${PANEL_X}" y="${ly}" class="group-title">${esc(`${group.zh} (${group.group})`)}</text>`)
    ly += 18
    for (const stableId of group.stableIds) {
      body.push(`<text x="${PANEL_X + 18}" y="${ly}" class="legend">${esc(stableId)}</text>`)
      ly += 15
    }
    ly += 4
  }
  body.push(`<text x="${PANEL_X}" y="${ly + 8}" class="note">camera ${cameraShots.length} 例（desktop zoom/pan/tablet/mobile/pinch）· interaction ${interactionShots.length} 例（pointer/hotspot/labels/lighting）· movement ${movementShots.length} 例</text>`)

  body.push(`<text x="32" y="${H - 40}" class="note">本总览为静态布局底图：base + mid + foreground + lighting(45%)。运行时遮挡排序需真实截图（generate-e13-evidence.mjs），本底图仅提供世界坐标/目标/关系几何。</text>`)
  body.push(`<text x="32" y="${H - 22}" class="note">world-model.json + shot-plan.json SHA-256 见 report.md 与 machines-gate.json。</text>`)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc"
  data-sheet="overview" data-cell="all" data-shot-count="${plan.length}" data-shot-ids="${esc(plan.map(s => s.id).join(','))}">
<title id="title">E13 overview contact sheet</title>
<desc id="desc">E13 full-map visual review overview (static layout basemap)</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#2dd4bf"/></marker></defs>
${buildStyle()}
${body.join('\n')}
</svg>
`
}

function buildFocusSheet (worldModel, plan, layers) {
  const W = 2400
  const PANEL_X0 = 32
  const PANEL_W = 770
  const PANEL_H = 640
  const COLS = 3
  const targetByStableId = new Map(worldModel.targets.map(t => [t.stableId, t]))
  const panels = []
  for (const group of FOCUS_GROUPS) {
    for (const stableId of group.stableIds) {
      const target = targetByStableId.get(stableId)
      const shots = plan.filter(s => s.kind === 'matrix' && s.targetStableId === stableId)
      panels.push({ group, target, shots })
    }
  }
  const rows = Math.ceil(panels.length / COLS)
  const H = 110 + rows * (PANEL_H + 30)
  const body = []
  body.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#0d1117"/>`)
  body.push(`<text x="32" y="48" class="title">E13 重点遮挡目标接触板（右上桌/栏杆/柱子/书架/前门 · 静态布局底图，非运行截图）</text>`)
  body.push(`<text x="32" y="74" class="subtitle">${esc(`${panels.length} 个重点目标 × 六角色 × behind/boundary/front = ${panels.reduce((n, p) => n + p.shots.length, 0)} 张矩阵图；每面板含区域放大底图 + 目标 rect/anchor + 18 个角色位置标记`)}</text>`)

  panels.forEach((panel, index) => {
    const col = index % COLS
    const row = Math.floor(index / COLS)
    const px = PANEL_X0 + col * (PANEL_W + 16)
    const py = 110 + row * (PANEL_H + 30)
    const target = panel.target
    const shots = panel.shots
    const S = 1.35
    const pad = 70
    const crop = {
      x: Math.max(0, target.rect.x - pad),
      y: Math.max(0, target.rect.y - pad),
      width: Math.min(MAP.width, target.rect.x + target.rect.width + pad) - Math.max(0, target.rect.x - pad),
      height: Math.min(MAP.height, target.rect.y + target.rect.height + pad) - Math.max(0, target.rect.y - pad),
    }
    const insetW = round(crop.width * S)
    const insetH = round(crop.height * S)
    const clipId = `focus-clip-${index}`
    body.push(`<g transform="translate(${px},${py})">`)
    body.push(`<rect x="0" y="0" width="${PANEL_W}" height="${PANEL_H}" class="panel"/>`)
    body.push(`<text x="14" y="26" class="group-title">${esc(`${panel.group.zh} · ${target.stableId}`)}</text>`)
    body.push(`<text x="14" y="44" class="body">${esc(`cell=${target.cell} kind=${target.kind} anchor=(${target.anchor.x},${target.anchor.y}) tieBias=${target.tieBias} rect=(${target.rect.x},${target.rect.y},${target.rect.width}×${target.rect.height})`)}</text>`)
    body.push(`<defs><clipPath id="${clipId}"><rect x="14" y="54" width="${insetW}" height="${insetH}"/></clipPath></defs>`)
    body.push(`<g clip-path="url(#${clipId})">`)
    body.push(`<use href="#focus-map-layers" transform="translate(14,54) translate(${round(-crop.x * S)},${round(-crop.y * S)}) scale(${S})"/>`)
    body.push(`<g transform="translate(14,54) translate(${round(-crop.x * S)},${round(-crop.y * S)}) scale(${S})">`)
    body.push(buildTargetRects([target], 0, 0, 1))
    body.push(buildShotMarkers(shots, 0, 0, 1, targetByStableId))
    body.push('</g>')
    body.push('</g>')
    const legend = buildLegendRows(shots, 14, 54 + insetH + 24, Math.floor((PANEL_W - 28) / 2), 15, 2)
    body.push(`<text x="14" y="${54 + insetH + 18}" class="body">${esc(`${shots.length} 张矩阵图`)}</text>`)
    body.push(legend.lines)
    body.push('</g>')
  })

  body.push(`<text x="32" y="${H - 24}" class="note">标记/图例与 cell 接触板一致：● 蓝=behind ● 琥珀=boundary ● 绿=front；虚线框=目标 rect；十字=TMX sortAnchor；data-shot-id 可机器校验。</text>`)
  body.push(`<text x="32" y="${H - 8}" class="note">静态布局底图（非运行截图）：base + mid-occluders + foreground-occluders。真实遮挡渲染请重跑 generate-e13-evidence.mjs。</text>`)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc"
  data-sheet="focus" data-cell="focus" data-shot-count="${panels.reduce((n, p) => n + p.shots.length, 0)}" data-shot-ids="${esc(panels.flatMap(p => p.shots.map(s => s.id)).join(','))}">
<title id="title">E13 focus target contact sheet</title>
<desc id="desc">E13 focus occlusion targets (static layout basemap)</desc>
<defs>
<g id="focus-map-layers">
${buildMapImageGroup(layers, ['base', 'mid', 'foreground'], 0, 0, MAP.width, MAP.height)}
</g>
</defs>
${buildStyle()}
${body.join('\n')}
</svg>
`
}

function buildIndex (worldModel, plan, blocked) {
  const shots = plan.map(shot => {
    const base = {
      id: shot.id,
      kind: shot.kind,
      screenshot: { file: `shots/${shot.id}.png`, exists: false },
      runtimeFacts: null,
    }
    if (shot.kind === 'matrix') {
      Object.assign(base, {
        cell: shot.cell,
        persona: shot.persona,
        personaName: shot.personaName,
        relation: shot.relation,
        world: { x: shot.world.x, y: shot.world.y },
        targetStableId: shot.targetStableId,
        targetKind: shot.targetKind,
        focus: shot.focus,
        expectedRelation: shot.expectedRelation,
        expectedDepth: shot.expectedDepth,
        viewport: shot.viewport,
        camera: shot.camera,
      })
    } else if (shot.kind === 'camera') {
      Object.assign(base, {
        cameraCase: shot.cameraCase,
        cameraLabel: shot.cameraLabel,
        persona: shot.persona,
        personaName: shot.personaName,
        targetStableId: shot.targetStableId,
        viewport: shot.viewport,
        camera: shot.camera,
      })
    } else if (shot.kind === 'interaction') {
      Object.assign(base, { interactionCase: shot.interactionCase, interactionLabel: shot.interactionLabel })
    } else if (shot.kind === 'movement') {
      Object.assign(base, { movementCase: shot.movementCase, movementLabel: shot.movementLabel, targetStableId: shot.targetStableId })
    }
    return base
  })
  return {
    $schema: 'juyiting-occlusion-e13-index-v1',
    schemaVersion: 1,
    taskId: 'E13',
    generatedAt: new Date().toISOString(),
    status: blocked ? 'BLOCKED' : 'GENERATED',
    frontendUrl: process.env.JUYITING_FRONTEND_URL || 'https://localhost:8080',
    worldModelSha256: sha256Text(readFileSync(join(EVIDENCE_DIR, 'world-model.json'), 'utf8')),
    shotPlanSha256: sha256Text(readFileSync(join(EVIDENCE_DIR, 'shot-plan.json'), 'utf8')),
    shotCount: shots.length,
    screenshotsGenerated: blocked ? 0 : shots.length,
    runtimeBlocked: Boolean(blocked),
    runtimeBlockedRef: 'runtime-blocked.json',
    probesRef: 'runtime-env-probes.json',
    shots,
  }
}

function buildReport (worldModel, plan, blocked, gate) {
  const counts = worldModel.shotCounts
  const blockedSection = blocked
    ? `## 运行时截图状态：BLOCKED（本宿主不可用）

真实浏览器/前端在此宿主上不可用（详见 \`runtime-env-probes.json\` / \`runtime-env-probes.log\` / \`runtime-blocked.json\`）：

- headless chromium 启动即崩溃：\`FATAL:sandbox_host_linux.cc(41) Check failed: . shutdown: Operation not permitted (1)\`（exit 133 / SIGTRAP）
- 任何本地 TCP 监听被拒绝（\`EPERM\`，含 8080/5173/4173/9090）→ 无法启动 vite dev/preview server
- \`fetch\` 到前端/线上 API 全部失败（网络受限或服务不可用）
- \`node-canvas\` 未安装（WebP 位图裁剪工具链不可用）
- \`dist/\` 存在但无法被静态服务（无 TCP 监听）

**未伪造任何截图。** 本接触板为静态布局底图（非运行截图），仅提供世界坐标/目标/关系几何，供 GPT 视觉审核作为压缩输入。真实运行截图需在具备浏览器/主机的环境重跑：

\`\`\`bash
node scripts/juyiting/e13/generate-e13-evidence.mjs   # 需要可访问前端 + 可用 headless chromium
\`\`\`
`
    : `## 运行时截图状态：GENERATED

所有 \`shots/E13-*.png\` 已由 \`generate-e13-evidence.mjs\` 采集，\`index.json\` 含每图 SHA-256 与运行时 V2 depth 事实。`
  return `# E13 全地图视觉审核证据（第一阶段）

- 任务：E13 Phase 1 — 一次性全地图视觉审核所需的完整、可复现证据
- 分支：codex/juyiting-occlusion-v2 · base commit 5308d7c
- 生成时间：${new Date().toISOString()}
- 覆盖：九宫 3×3 × 六角色（宋江/卢俊义/扈三娘/李逵/林冲/吴用）× behind/boundary/front
- 计划图总数：**${counts.total}** = matrix ${counts.matrix} + camera ${counts.camera} + interaction ${counts.interaction} + movement ${counts.movement}

${blockedSection}

## 交付文件（机器门禁可校验）

| 文件 | 说明 |
| --- | --- |
| \`world-model.json\` | 权威世界模型：九宫 cells、六 personas、relations、15 targets（stableId/anchor/tieBias/rect）、camera/interaction/movement cases |
| \`shot-plan.json\` | 289 张计划图（E13-001..E13-289），每图绑定编号/world 坐标/角色/目标 stableId/预期关系 |
| \`index.json\` | 每图绑定索引（编号、world 坐标、角色、目标 prop/fragment stableId、预期关系）+ 截图文件引用 |
| \`contact-sheets/*.svg\` | 编号接触板（静态布局底图，非运行截图）：总览 + 九宫 cell×9 + 重点目标 |
| \`runtime-blocked.json\` | 生成器 fail-fast 阻塞证据（screenshotsGenerated=0，未伪造截图） |
| \`runtime-env-probes.json\` / \`.log\` | 宿主环境探测证据（chromium FATAL / EPERM / fetch 失败 / canvas 缺失） |
| \`machines-gate.json\` | 机器完整性门禁结果（全部通过/失败项） |

## 覆盖矩阵要点

- 重点区域（E13 handoff）：右上悬赏桌（bounty-board + scroll-table-front）、栏杆（railing-01/02/railing-post）、柱子（pillar-01/02）、书架（library-shelf）、前门（hanging-banner + lantern-post）、右工作台（worktable-01）
- 每 九宫 cell 至少 1 个目标；每个目标 × 6 角色 × 3 关系 = 18 张矩阵图
- camera：desktop default/zoom-in/zoom-out/pan-east/pan-west、tablet landscape、mobile portrait/landscape、pinch-in/out（10 例）
- interaction：agent pointer、hotspot（bounty-board/library-shelf/main-seat）、labels/bubbles、lighting fullmap/closeup（7 例）
- movement：卢俊义→右上悬赏桌、李逵→前门（2 例，真实引擎）

## GPT 审核压缩输入路径

\`tests/fixtures/juyiting/occlusion-e13/\`：
1. \`contact-sheets/overview.svg\` + \`cell-*.svg\`（9）+ \`focus-targets.svg\` — 编号接触板
2. \`index.json\` — 每图绑定
3. \`world-model.json\` + \`shot-plan.json\` — 完整几何/计划（含 SHA-256 于 machines-gate.json）
4. \`report.md\` — 本报告
5. \`machines-gate.json\` — 机器门禁结果

真实截图路径（待有浏览器主机）：\`tests/fixtures/juyiting/occlusion-e13/shots/E13-*.png\` + 重新生成的 \`index.json\`（status=GENERATED）。

## 机器门禁

${gate ? '```json\n' + JSON.stringify(gate, null, 2) + '\n```' : '（由 validate-e13-evidence.mjs 生成 machines-gate.json）'}
`
}

function main () {
  const worldModel = readJson(join(EVIDENCE_DIR, 'world-model.json'))
  const plan = readJson(join(EVIDENCE_DIR, 'shot-plan.json')).shots
  const blocked = existsSync(join(EVIDENCE_DIR, 'runtime-blocked.json'))
  const layers = loadLayerDataUris()

  mkdirSync(CONTACT_DIR, { recursive: true })
  mkdirSync(join(EVIDENCE_DIR, 'shots'), { recursive: true })

  const sheets = []
  sheets.push({ name: 'overview.svg', svg: buildOverviewSheet(worldModel, plan, layers) })
  for (const region of worldModel.regions) {
    sheets.push({ name: `cell-${region.id}.svg`, svg: buildCellSheet(region.id, worldModel, plan, layers) })
  }
  sheets.push({ name: 'focus-targets.svg', svg: buildFocusSheet(worldModel, plan, layers) })
  for (const sheet of sheets) {
    writeFileSync(join(CONTACT_DIR, sheet.name), sheet.svg)
  }

  // index.json: never overwrite a GENERATED (real screenshot) index
  const existingIndexPath = join(EVIDENCE_DIR, 'index.json')
  const existingIndex = existsSync(existingIndexPath) ? readJson(existingIndexPath) : null
  if (existingIndex?.status === 'GENERATED') {
    console.log('E13 index.json already GENERATED (real screenshots) — keeping it')
  } else {
    const index = buildIndex(worldModel, plan, blocked)
    writeFileSync(existingIndexPath, `${JSON.stringify(index, null, 2)}\n`)
  }

  // report.md
  const gatePath = join(EVIDENCE_DIR, 'machines-gate.json')
  const gate = existsSync(gatePath) ? readJson(gatePath) : null
  writeFileSync(join(EVIDENCE_DIR, 'report.md'), buildReport(worldModel, plan, blocked, gate))

  console.log(`E13 static evidence rendered: ${sheets.length} contact sheets, index.json, report.md -> ${EVIDENCE_DIR}`)
  return sheets.map(s => s.name)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main()
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
