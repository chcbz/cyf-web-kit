# E13 全地图视觉审核证据（第一阶段）

- 任务：E13 Phase 1 — 一次性全地图视觉审核所需的完整、可复现证据
- 分支：codex/juyiting-occlusion-v2 · base commit 5308d7c
- 生成时间：2026-08-12T13:59:47.030Z
- 覆盖：九宫 3×3 × 六角色（宋江/卢俊义/扈三娘/李逵/林冲/吴用）× behind/boundary/front
- 计划图总数：**289** = matrix 270 + camera 10 + interaction 7 + movement 2

## 运行时截图状态：BLOCKED（本宿主不可用）

真实浏览器/前端在此宿主上不可用（详见 `runtime-env-probes.json` / `runtime-env-probes.log` / `runtime-blocked.json`）：

- headless chromium 启动即崩溃：`FATAL:sandbox_host_linux.cc(41) Check failed: . shutdown: Operation not permitted (1)`（exit 133 / SIGTRAP）
- 任何本地 TCP 监听被拒绝（`EPERM`，含 8080/5173/4173/9090）→ 无法启动 vite dev/preview server
- `fetch` 到前端/线上 API 全部失败（网络受限或服务不可用）
- `node-canvas` 未安装（WebP 位图裁剪工具链不可用）
- `dist/` 存在但无法被静态服务（无 TCP 监听）

**未伪造任何截图。** 本接触板为静态布局底图（非运行截图），仅提供世界坐标/目标/关系几何，供 GPT 视觉审核作为压缩输入。真实运行截图需在具备浏览器/主机的环境重跑：

```bash
node scripts/juyiting/e13/generate-e13-evidence.mjs   # 需要可访问前端 + 可用 headless chromium
```


## 交付文件（机器门禁可校验）

| 文件 | 说明 |
| --- | --- |
| `world-model.json` | 权威世界模型：九宫 cells、六 personas、relations、15 targets（stableId/anchor/tieBias/rect）、camera/interaction/movement cases |
| `shot-plan.json` | 289 张计划图（E13-001..E13-289），每图绑定编号/world 坐标/角色/目标 stableId/预期关系 |
| `index.json` | 每图绑定索引（编号、world 坐标、角色、目标 prop/fragment stableId、预期关系）+ 截图文件引用 |
| `contact-sheets/*.svg` | 编号接触板（静态布局底图，非运行截图）：总览 + 九宫 cell×9 + 重点目标 |
| `runtime-blocked.json` | 生成器 fail-fast 阻塞证据（screenshotsGenerated=0，未伪造截图） |
| `runtime-env-probes.json` / `.log` | 宿主环境探测证据（chromium FATAL / EPERM / fetch 失败 / canvas 缺失） |
| `machines-gate.json` | 机器完整性门禁结果（全部通过/失败项） |

## 覆盖矩阵要点

- 重点区域（E13 handoff）：右上悬赏桌（bounty-board + scroll-table-front）、栏杆（railing-01/02/railing-post）、柱子（pillar-01/02）、书架（library-shelf）、前门（hanging-banner + lantern-post）、右工作台（worktable-01）
- 每 九宫 cell 至少 1 个目标；每个目标 × 6 角色 × 3 关系 = 18 张矩阵图
- camera：desktop default/zoom-in/zoom-out/pan-east/pan-west、tablet landscape、mobile portrait/landscape、pinch-in/out（10 例）
- interaction：agent pointer、hotspot（bounty-board/library-shelf/main-seat）、labels/bubbles、lighting fullmap/closeup（7 例）
- movement：卢俊义→右上悬赏桌、李逵→前门（2 例，真实引擎）

## GPT 审核压缩输入路径

`tests/fixtures/juyiting/occlusion-e13/`：
1. `contact-sheets/overview.svg` + `cell-*.svg`（9）+ `focus-targets.svg` — 编号接触板
2. `index.json` — 每图绑定
3. `world-model.json` + `shot-plan.json` — 完整几何/计划（含 SHA-256 于 machines-gate.json）
4. `report.md` — 本报告
5. `machines-gate.json` — 机器门禁结果

真实截图路径（待有浏览器主机）：`tests/fixtures/juyiting/occlusion-e13/shots/E13-*.png` + 重新生成的 `index.json`（status=GENERATED）。

## 机器门禁

```json
{
  "$schema": "juyiting-occlusion-e13-machines-gate-v1",
  "taskId": "E13",
  "timestamp": "2026-08-12T13:59:46.816Z",
  "generatedBy": "validate-e13-evidence.mjs",
  "pass": true,
  "passedChecks": 37,
  "totalChecks": 37,
  "failures": [],
  "extraErrors": [],
  "checks": [
    {
      "check": "world-model.json exists",
      "ok": true,
      "detail": ""
    },
    {
      "check": "shot-plan.json exists",
      "ok": true,
      "detail": ""
    },
    {
      "check": "targets anchored to TMX (≤1px) + tieBias",
      "ok": true,
      "detail": ""
    },
    {
      "check": "shot plan invariants (cells/personas/relations/targets/ids)",
      "ok": true,
      "detail": ""
    },
    {
      "check": "matrix count = 270",
      "ok": true,
      "detail": "got 270"
    },
    {
      "check": "camera count = 10",
      "ok": true,
      "detail": "got 10"
    },
    {
      "check": "interaction count = 7",
      "ok": true,
      "detail": "got 7"
    },
    {
      "check": "movement count = 2",
      "ok": true,
      "detail": "got 2"
    },
    {
      "check": "total count = 289",
      "ok": true,
      "detail": "got 289"
    },
    {
      "check": "matrix covers every cell×persona×relation",
      "ok": true,
      "detail": ""
    },
    {
      "check": "all focus targets present in world model",
      "ok": true,
      "detail": ""
    },
    {
      "check": "provenance tmx sha256 matches live TMX",
      "ok": true,
      "detail": "4f94e3a52da71369d9c29d96e0ac0ceb2126a1a441b6cd63911701957e1ed49b vs 4f94e3a52da71369d9c29d96e0ac0ceb2126a1a441b6cd63911701957e1ed49b"
    },
    {
      "check": "provenance fragment-spec sha256 matches",
      "ok": true,
      "detail": ""
    },
    {
      "check": "provenance map-snapshot sha256 matches",
      "ok": true,
      "detail": ""
    },
    {
      "check": "index has every planned shot id",
      "ok": true,
      "detail": "missing "
    },
    {
      "check": "index has no extra/duplicate ids",
      "ok": true,
      "detail": "extra "
    },
    {
      "check": "index shotCount = 289",
      "ok": true,
      "detail": "got 289"
    },
    {
      "check": "index matrix shots carry id/world/persona/target/expected binding",
      "ok": true,
      "detail": ""
    },
    {
      "check": "runtime-blocked.json honest (screenshotsGenerated=0)",
      "ok": true,
      "detail": "got 0"
    },
    {
      "check": "index status = BLOCKED when blocked",
      "ok": true,
      "detail": "got BLOCKED"
    },
    {
      "check": "no PNG shots when blocked",
      "ok": true,
      "detail": "0 pngs present"
    },
    {
      "check": "runtime-env-probes.json exists",
      "ok": true,
      "detail": ""
    },
    {
      "check": "runtime-env-probes.json has conclusion",
      "ok": true,
      "detail": ""
    },
    {
      "check": "contact-sheets dir exists",
      "ok": true,
      "detail": ""
    },
    {
      "check": "all contact sheets well-formed XML",
      "ok": true,
      "detail": ""
    },
    {
      "check": "cell sheet northwest contains exactly its 18 matrix shots",
      "ok": true,
      "detail": "missing  extra "
    },
    {
      "check": "cell sheet north_center contains exactly its 18 matrix shots",
      "ok": true,
      "detail": "missing  extra "
    },
    {
      "check": "cell sheet northeast contains exactly its 36 matrix shots",
      "ok": true,
      "detail": "missing  extra "
    },
    {
      "check": "cell sheet west_center contains exactly its 18 matrix shots",
      "ok": true,
      "detail": "missing  extra "
    },
    {
      "check": "cell sheet center contains exactly its 18 matrix shots",
      "ok": true,
      "detail": "missing  extra "
    },
    {
      "check": "cell sheet east_center contains exactly its 18 matrix shots",
      "ok": true,
      "detail": "missing  extra "
    },
    {
      "check": "cell sheet southwest contains exactly its 18 matrix shots",
      "ok": true,
      "detail": "missing  extra "
    },
    {
      "check": "cell sheet south_center contains exactly its 54 matrix shots",
      "ok": true,
      "detail": "missing  extra "
    },
    {
      "check": "cell sheet southeast contains exactly its 72 matrix shots",
      "ok": true,
      "detail": "missing  extra "
    },
    {
      "check": "every matrix shot appears in exactly one cell sheet",
      "ok": true,
      "detail": "dup  missing "
    },
    {
      "check": "overview sheet lists all 289 shots",
      "ok": true,
      "detail": "got 289"
    },
    {
      "check": "focus sheet lists exactly the focus-target matrix shots",
      "ok": true,
      "detail": "got 198, expected 198"
    }
  ]
}
```
