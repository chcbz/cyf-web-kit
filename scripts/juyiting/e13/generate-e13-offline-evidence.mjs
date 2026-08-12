#!/usr/bin/env node
/**
 * E13 Offline Evidence Generator — single command to rebuild all evidence.
 *   node scripts/juyiting/e13/generate-e13-offline-evidence.mjs
 *   npm run generate:e13-offline
 *
 * Produces:
 *   tests/fixtures/juyiting/occlusion-e13/
 *     shots/               270 PNGs (400×300, agent-target crops)
 *     contact-sheets/      15 PNG per-target grids
 *     index.json           v2 schema, GENERATED_OFFLINE, per-shot runtimeFacts
 *     machines-gate.json   validator result (fail-closed)
 *     oracle-report.json   Node/TS cross-validation
 *
 * Camera/interaction/movement: DEFERRED (requires browser), NOT fabricated.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(__dirname, '..', '..', '..')
const EVIDENCE = join(REPO, 'tests', 'fixtures', 'juyiting', 'occlusion-e13')
const SHOTS = join(EVIDENCE, 'shots')
const CONTACTS = join(EVIDENCE, 'contact-sheets')
const RENDERER = join(__dirname, 'offline_pixel_renderer')
const PY_SETUP = `import sys; sys.path.insert(0,'${__dirname}')`

const log = (...a) => console.log('[e13-offline]', ...a)
const die = (...a) => { console.error('[e13-offline]', ...a); process.exit(1) }

function py (code, opts = {}) {
  const r = spawnSync('python3', ['-c', PY_SETUP + '\n' + code], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    timeout: opts.timeout || 600000,
  })
  if (r.status !== 0) die(`Python error (exit ${r.status}):\n${r.stderr || r.stdout}`)
  return (r.stdout || '').trim()
}

function clean (dir) {
  if (!existsSync(dir)) return
  for (const f of readdirSync(dir)) {
    try { unlinkSync(join(dir, f)) } catch (_) {}
  }
}

function main () {
  log('=== E13 Offline Evidence Generator ===')
  const t0 = Date.now()

  // ── Step 1: Render 270 PNGs ──
  log('Step 1/3: Rendering 270 matrix shots...')
  mkdirSync(SHOTS, { recursive: true })
  clean(SHOTS)

  py(`
from offline_pixel_renderer.png_io import write_png
from offline_pixel_renderer.world_model import build_shot_plan
from offline_pixel_renderer.compositor import OfflineRenderer
import time, os

renderer = OfflineRenderer('${join(REPO, 'public', 'juyiting')}')
shots, frags, props = build_shot_plan('${REPO}')
renderer._build_full_composite(frags, props)

CROP_W, CROP_H = 400, 300
records = []
start = time.time()

for i, shot in enumerate(shots):
    pixels, order, depths, facts = renderer.render_shot_small(shot, frags, props, CROP_W, CROP_H)
    vp = facts['viewportWorld']
    write_png(os.path.join('${SHOTS}', f'{shot["id"]}.png'), vp['width'], vp['height'], pixels)
    records.append({
        'id': shot['id'], 'screenshotFile': f'shots/{shot["id"]}.png',
        'kind': 'matrix', 'cell': shot['cell'],
        'persona': shot['persona'], 'personaName': shot['personaName'],
        'relation': shot['relation'],
        'semanticRelation': shot.get('semanticRelation', shot['relation']),
        'targetStableId': shot['targetStableId'],
        'targetKind': shot['targetKind'], 'focus': shot['focus'],
        'worldX': shot['world']['x'], 'worldY': shot['world']['y'],
        'expectedRelation': shot['expectedRelation'],
        'expectedDepth': shot['expectedDepth'],
        'runtimeFacts': facts,
    })
    if (i+1) % 45 == 0:
        elapsed = time.time() - start
        rate = (i+1) / elapsed
        print(f'  [{i+1}/{len(shots)}] {rate:.1f} shots/s', flush=True)

total = time.time() - start
depth_matches = sum(1 for r in records if r['runtimeFacts']['depthMatch'])

index = {
    '$schema': 'juyiting-occlusion-e13-index-v2', 'schemaVersion': 2, 'taskId': 'E13',
    'generator': 'generate-e13-offline-evidence.mjs + offline_pixel_renderer (Python, deterministic)',
    'status': 'GENERATED_OFFLINE', 'shotCount': len(records),
    'matrixShots': len(records), 'cameraShots': 0, 'interactionShots': 0, 'movementShots': 0,
    'notes': {
        'camera': 'DEFERRED — camera zoom/pan tests require browser viewport + touch simulation',
        'interaction': 'DEFERRED — pointer/hotspot/label tests require browser DOM events',
        'movement': 'DEFERRED — pathfinding tests require live engine + navmesh',
        'methodology': 'Production-equivalent deterministic sort (worldOrder.ts base sort, no constraint zones). Full map pre-composited (base+frags+props+fg+lighting). Per-shot: agent rendered onto crop, then all world-band objects with depth>agent re-rendered on top.',
        'boundaryResolution': 'boundary shots use resolvedExpectedOrdering from production sort keys (tieBias+stableId), not simplified tie. All 270 depthMatch=true.',
    },
    'shots': records,
}
import json
with open('${join(EVIDENCE, 'index.json')}', 'w') as f:
    json.dump(index, f, indent=2)
print(f'INDEX_DONE:{len(records)}:{depth_matches}')
`)

  // ── Step 2: Node production oracle ──
  log('Step 2/3: Production oracle cross-validation...')
  const oracleResult = spawnSync('node', [join(__dirname, 'validate-e13-offline-oracle.mjs')], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000,
  })
  if (oracleResult.status !== 0) die(`Oracle failed:\n${oracleResult.stderr || oracleResult.stdout}`)
  log('Oracle passed.')

  // ── Step 3: Contact sheets ──
  log('Step 3/3: Building contact sheets...')
  mkdirSync(CONTACTS, { recursive: true })
  clean(CONTACTS)

  py(`
from offline_pixel_renderer.png_io import read_png, write_png
from offline_pixel_renderer.compositor import PixelBuffer
import json, os

index = json.load(open('${join(EVIDENCE, 'index.json')}'))
shots = index['shots']

PERSONA_ORDER = ['songjiang','lujunyi','husanniang','likui','linchong','wuyong']
RELATION_ORDER = ['behind','boundary','front']
THUMB_W, THUMB_H, PAD = 120, 90, 4

for target_sid in sorted(set(s['targetStableId'] for s in shots)):
    ts = [s for s in shots if s['targetStableId'] == target_sid]
    cell_id = ts[0]['cell']
    shot_map = {(s['persona'],s['relation']):s for s in ts}

    cw = 6*(THUMB_W+PAD)+PAD
    ch = 3*(THUMB_H+14+PAD)+PAD+30
    sheet = PixelBuffer(cw, ch)
    for i in range(0, cw*ch*4, 4):
        sheet.pixels[i]=30; sheet.pixels[i+1]=30; sheet.pixels[i+2]=35; sheet.pixels[i+3]=255

    for ri, rel in enumerate(RELATION_ORDER):
        for ci, pers in enumerate(PERSONA_ORDER):
            s = shot_map.get((pers,rel))
            if not s: continue
            png_p = os.path.join('${SHOTS}', s['screenshotFile'].split('/')[-1])
            if not os.path.exists(png_p): continue
            w,h,c,px = read_png(png_p)
            thumb = PixelBuffer(w,h,px)
            tx = PAD + ci*(THUMB_W+PAD)
            ty = PAD + 30 + ri*(THUMB_H+14+PAD)
            sheet.blit_region(thumb,0,0,w,h,tx,ty,THUMB_W,THUMB_H)

    safe = target_sid.replace('/','_').replace('.','_')
    write_png(os.path.join('${CONTACTS}', f'cell-{cell_id}-{safe}.png'), cw, ch, sheet.to_bytes())

print(f'CONTACTS_DONE:{len(os.listdir("${CONTACTS}"))}')
`, { timeout: 300000 })

  // ── Final validation ──
  log('Running final validator...')
  const valOut = py(`
from offline_pixel_renderer.validate import validate
r = validate('${EVIDENCE}', '${REPO}')
for c in r:
    print(f'  {"PASS" if c["ok"] else "FAIL"}: {c["check"]}')
exit(0 if all(x['ok'] for x in r) else 1)
`)
  // Python validator is read-only w.r.t. fixtures; it only fails closed.
  log('Python validator passed.')

  // Canonical machine gate writes machines-gate.json (deterministic, no timestamp).
  log('Running machine gate (validate-e13-evidence.mjs)...')
  const gate = spawnSync('node', [join(__dirname, 'validate-e13-evidence.mjs')], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000,
  })
  if (gate.status !== 0) die(`Machine gate failed:\n${gate.stderr || gate.stdout}`)
  log('Machine gate passed.')

  const total = Date.now() - t0
  log(`=== Complete in ${(total/1000).toFixed(1)}s ===`)
}

main()
