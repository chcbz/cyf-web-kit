#!/usr/bin/env node
/**
 * E13: full-map visual-review evidence generator (real runtime screenshots).
 *
 * Environment prerequisites (same as tests/juyiting-public-beta-ui-smoke.mjs):
 *  - a reachable Juyiting frontend (JUYITING_FRONTEND_URL, default https://localhost:8080)
 *  - a working headless chromium (CHROME_PATH or /usr/local/bin/chromium-headless-smoke)
 *  - backend endpoints are MOCKED via CDP Fetch interception (no live backend needed)
 *
 * Behavior:
 *  - builds the committed world model / shot plan from tests/fixtures/juyiting/occlusion-e13
 *  - captures every planned shot as a REAL runtime screenshot of the melon canvas
 *  - writes index.json (per-shot binding: id/world coords/persona/target stableId/expected relation
 *    + runtime facts incl. actual V2 depth ordering), runtime-facts.json, then contact sheets.
 *  - NEVER fabricates screenshots: if the browser/frontend is unreachable it writes
 *    runtime-blocked.json with precise diagnostics and exits non-zero.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import {
  launchChrome, stopChrome, waitForExpression, evaluate, fulfillJson, fulfillSse,
  captureCanvasPng, GAME_LOOKUP_SOURCE, isMainModule,
} from './lib/cdp-harness.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const EVIDENCE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-e13')
const SHOTS_DIR = join(EVIDENCE_DIR, 'shots')
const CONTACT_DIR = join(EVIDENCE_DIR, 'contact-sheets')

const FRONTEND_URL = process.env.JUYITING_FRONTEND_URL || 'https://localhost:8080'
const DEBUG_KEY = '__JYTING_SCENE_DEBUG__'

const PERSONAS = Object.freeze([
  { personaCode: 'songjiang',  name: '宋江',   agentId: 'songjiang' },
  { personaCode: 'lujunyi',    name: '卢俊义', agentId: 'lujunyi' },
  { personaCode: 'husanniang', name: '扈三娘', agentId: 'husanniang' },
  { personaCode: 'likui',      name: '李逵',   agentId: 'likui' },
  { personaCode: 'linchong',   name: '林冲',   agentId: 'linchong' },
  { personaCode: 'wuyong',     name: '吴用',   agentId: 'wuyong' },
])

// Sideline world positions for non-subject personas (inside map, outside camera frame)
const SIDELINES = [
  { x: 30, y: 60 }, { x: 1634, y: 60 }, { x: 30, y: 908 }, { x: 1634, y: 908 }, { x: 832, y: 920 },
]

const debugExpression = predicate => `(() => {
  const debug = window[${JSON.stringify(DEBUG_KEY)}];
  return Boolean(debug && (${predicate}));
})()`

const readDebug = async cdp => {
  await evaluate(cdp, `(() => { ${GAME_LOOKUP_SOURCE}; return juyitingGame.getSceneDebugSnapshot(); })()`)
  return evaluate(cdp, `window[${JSON.stringify(DEBUG_KEY)}]`)
}

const sceneFixtures = () => {
  const now = Date.now()
  const mapAgents = PERSONAS.map(p => ({ agentId: p.agentId, personaCode: p.personaCode, name: p.name, status: 'online' }))
  const states = PERSONAS.map((p, i) => ({
    agentId: p.agentId, personaCode: p.personaCode,
    behavior: 'idle_at_hall', originRegionId: 'main-seat',
    targetRegionId: ['main-seat', 'council-table', 'bounty-board', 'gate', 'library-shelf', 'right-guard'][i % 6],
    relatedType: 'idle', relatedId: `e13-${p.agentId}`,
    phase: 'idle', stateVersion: 1, startedAt: now - 120000,
    expectedArrivalAt: now - 60000, expiresAt: now + 3600000,
  }))
  return {
    mapAgents: { status: 200, code: 'E0', msg: 'ok', data: mapAgents },
    roster: { status: 200, code: 'E0', msg: 'ok', data: [] },
    catalog: { status: 200, code: 'E0', msg: 'ok', data: [] },
    tasks: { status: 200, code: 'E0', msg: 'ok', data: [] },
    statusCounts: { status: 200, code: 'E0', msg: 'ok', data: [] },
    snapshot: {
      status: 200, code: 'E0', msg: 'ok',
      data: { sceneId: 'juyiting-main', sceneVersion: 256, generatedAt: now, agents: mapAgents, states },
    },
    phases: { status: 200, code: 'E0', msg: 'ok', data: { accepted: 0 } },
  }
}

const setupInterception = (cdp) => {
  const fixtures = sceneFixtures()
  const pausedSse = new Set()
  cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
    const url = request?.url || ''
    try {
      if (url.includes('/agent/map')) return void (await fulfillJson(cdp, requestId, 200, fixtures.mapAgents))
      if (url.includes('/agent/roster')) return void (await fulfillJson(cdp, requestId, 200, fixtures.roster))
      if (url.includes('/agent/personas/catalog')) return void (await fulfillJson(cdp, requestId, 200, fixtures.catalog))
      if (url.includes('/agent/tasks/search')) return void (await fulfillJson(cdp, requestId, 200, fixtures.tasks))
      if (url.includes('/agent/tasks/status-counts')) return void (await fulfillJson(cdp, requestId, 200, fixtures.statusCounts))
      if (url.includes('/agent/scenes/juyiting-main/snapshot')) return void (await fulfillJson(cdp, requestId, 200, fixtures.snapshot))
      if (url.includes('/agent/scenes/juyiting-main/phases')) return void (await fulfillJson(cdp, requestId, 200, fixtures.phases))
      if (url.includes('/agent/scenes/juyiting-main/events')) {
        // Hold the SSE stream open (no further events during evidence capture)
        pausedSse.add(requestId)
        return
      }
      await cdp.send('Fetch.continueRequest', { requestId })
    } catch (error) {
      console.error(`[interception] ${url}: ${error.message}`)
    }
  })
  return cdp.send('Fetch.enable', {
    patterns: [
      { urlPattern: '*://*/*agent/map*', requestStage: 'Request' },
      { urlPattern: '*://*/*agent/roster*', requestStage: 'Request' },
      { urlPattern: '*://*/*agent/personas/catalog*', requestStage: 'Request' },
      { urlPattern: '*://*/*agent/tasks/search*', requestStage: 'Request' },
      { urlPattern: '*://*/*agent/tasks/status-counts*', requestStage: 'Request' },
      { urlPattern: '*://*/*agent/scenes/juyiting-main/*', requestStage: 'Request' },
    ]
  })
}

const PAGE_PROBE_SOURCE = `
window.__E13_RUNTIME__ = (() => {
  let snapshots = [];
  const gameLookup = () => {
    let g = window.__JYTING_GAME__;
    if (!g) {
      let c = document.querySelector('.hall-stage')?.__vueParentComponent;
      while (c && !c.setupState?.juyitingGame) c = c.parent;
      g = c?.setupState?.juyitingGame;
    }
    if (!g) throw new Error('game unavailable');
    return g;
  };
  const scene = () => gameLookup()._hallScene;
  return {
    installSnapshotSource(list) {
      snapshots = (list || []).map(s => ({ ...s }));
      const sc = scene();
      sc.setSimulationRuntime({
        update: () => {},
        snapshots: () => snapshots.map(s => ({ ...s })),
        drainPhaseEvents: () => [],
        onPhaseEvents: () => {}
      });
    },
    place(agentId, personaCode, x, y, facing = 'down') {
      const existing = snapshots.findIndex(s => s.agentId === agentId);
      const entry = { agentId, personaCode, x, y, facing, animation: 'idle', behavior: 'e13-probe', phase: 'idle', regionId: 'e13-probe', stateVersion: 0 };
      if (existing >= 0) snapshots[existing] = entry; else snapshots.push(entry);
    },
    snapshotList() { return snapshots.map(s => ({ ...s })); },
    setCameraWorldCenter(cx, cy, zoom) {
      const g = gameLookup();
      g.resetToMainHall();
      const snap = g.getCameraSnapshot();
      const vp = snap?.viewport || scene()._viewportSize();
      const current = snap?.transform || { zoom: 1, offsetX: 0, offsetY: 0 };
      if (Number.isFinite(zoom) && zoom > 0) g.zoomBy(zoom - current.zoom);
      const after = g.getCameraSnapshot().transform;
      const targetOffsetX = -(cx - vp.width / 2) * after.zoom;
      const targetOffsetY = -(cy - vp.height / 2) * after.zoom;
      g.panBy(targetOffsetX - after.offsetX, targetOffsetY - after.offsetY);
      return g.getCameraSnapshot();
    },
    pinchGesture(cx, cy, startDist, endDist, steps = 12, pointerType = 'touch') {
      const canvas = document.querySelector('.melon-layer canvas');
      if (!canvas) throw new Error('canvas unavailable for pinch');
      const angle = Math.PI / 4;
      const id1 = 10, id2 = 11;
      const fire = (type, id, x, y) => {
        canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: id, pointerType, isPrimary: id === id1,
          clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        }));
      };
      const pt = (dist, t) => ({
        x1: cx + Math.cos(angle) * dist * t, y1: cy + Math.sin(angle) * dist * t,
        x2: cx - Math.cos(angle) * dist * t, y2: cy - Math.sin(angle) * dist * t,
      });
      fire('pointerdown', id1, cx + Math.cos(angle) * startDist / 2, cy + Math.sin(angle) * startDist / 2);
      fire('pointerdown', id2, cx - Math.cos(angle) * startDist / 2, cy - Math.sin(angle) * startDist / 2);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const dist = startDist + (endDist - startDist) * t;
        const p = pt(dist, 0.5);
        fire('pointermove', id1, p.x1, p.y1);
        fire('pointermove', id2, p.x2, p.y2);
      }
      fire('pointerup', id1, cx + Math.cos(angle) * endDist / 2, cy + Math.sin(angle) * endDist / 2);
      fire('pointerup', id2, cx - Math.cos(angle) * endDist / 2, cy - Math.sin(angle) * endDist / 2);
      return true;
    },
    readAgent(agentId) {
      const a = scene()._agents.get(agentId);
      if (!a) return null;
      return { x: a.pos.x, y: a.pos.y, depth: a.depth, selected: Boolean(a._selected), name: a.agentName };
    },
    readV2Ordering(agentId, targetStableId) {
      const sc = scene();
      const adapter = sc._v2AgentAdapter;
      const agentStableId = adapter?.lookup?.(agentId)?.stableId || null;
      const depths = sc.getV2Depths?.() || {};
      const agentDepth = agentStableId ? depths[agentStableId] : undefined;
      const targetDepth = depths[targetStableId];
      let ordering = 'unknown';
      if (agentDepth !== undefined && targetDepth !== undefined) {
        ordering = agentDepth < targetDepth ? 'agent_behind_target' : agentDepth > targetDepth ? 'agent_in_front' : 'tie';
      }
      return { agentStableId, agentDepth, targetDepth, ordering, rendererMode: sc.activeRendererMode };
    },
    readCamera() {
      const g = gameLookup();
      const snap = g.getCameraSnapshot();
      return { transform: snap?.transform || null, viewport: snap?.viewport || scene()._viewportSize(), preset: snap?.presetKey || null };
    },
    clearBubbles() {
      scene()._agents.forEach(a => a.setBubble('', 0));
    }
  };
})();
`

const waitForReady = async (cdp) => {
  await waitForExpression(cdp, 'Boolean(document.querySelector(".juyi-page"))')
  await waitForExpression(cdp, 'Boolean(document.querySelector(".hall-board.is-melon-ready .melon-layer canvas"))')
  await waitForExpression(cdp, debugExpression(`
    debug.ready === true && debug.map?.tmxLoaded === true && debug.map?.movementReady === true &&
    debug.simulation?.ready === true && debug.sprites?.manifestReady === true && debug.input?.interactionLocked === false
  `))
  await waitForExpression(cdp, `(() => { ${GAME_LOOKUP_SOURCE}; return juyitingGame._hallScene?.activeRendererMode === 'v2'; })()`)
  for (const persona of PERSONAS) {
    await waitForExpression(cdp, `(() => { ${GAME_LOOKUP_SOURCE}; return Boolean(juyitingGame._hallScene?._agents.get(${JSON.stringify(persona.agentId)})); })()`)
  }
  // seed the snapshot-source probe with current engine snapshots (all 6 personas)
  await evaluate(cdp, `(() => { ${GAME_LOOKUP_SOURCE}; window.__E13_RUNTIME__.installSnapshotSource(juyitingGame._movementEngine.snapshots()); return true; })()`)
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

async function run (planPath = join(EVIDENCE_DIR, 'shot-plan.json'), outputDir = EVIDENCE_DIR) {
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  const worldModel = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'world-model.json'), 'utf8'))
  mkdirSync(join(outputDir, 'shots'), { recursive: true })
  mkdirSync(join(outputDir, 'contact-sheets'), { recursive: true })

  const probes = []
  const frontendReachable = await fetch(FRONTEND_URL, { signal: AbortSignal.timeout(8000) }).then(r => r.ok).catch(() => false)

  let chrome, cdp, userDataDir
  try {
    if (!frontendReachable) {
      throw new Error(`frontend unreachable: ${FRONTEND_URL} (network restricted or server not running)`)
    }
    const debugPort = 9400 + Math.floor(Math.random() * 400)
    ;({ chrome, cdp, userDataDir } = await launchChrome({ debugPort }))
    await setupInterception(cdp)
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__JYT_V2_ENABLED = true; window.__JYT_OCCLUSION_SHADOW_ENABLED = false;`
    })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_PROBE_SOURCE })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('api_token', ${JSON.stringify(JSON.stringify({ data: 'e13-evidence-token', expTime: Date.now() + 86400000 }))})`
    })
    await cdp.send('Page.navigate', { url: `${FRONTEND_URL}/juyiting?transition=none&scene-debug=1` })
    await waitForReady(cdp)
    await evaluate(cdp, `(() => { ${GAME_LOOKUP_SOURCE}; window.__E13_RUNTIME__.clearBubbles(); return true; })()`)

    const records = []
    for (const shot of plan.shots) {
      const buffer = await captureMatrixShot(cdp, shot, worldModel)
      const file = `shots/${shot.id}.png`
      writeFileSync(join(outputDir, file), buffer)
      records.push({
        id: shot.id, kind: shot.kind, file,
        sha256: sha256(buffer),
        ...(shot.kind === 'matrix' ? {
          cell: shot.cell, persona: shot.persona, personaName: shot.personaName, relation: shot.relation,
          targetStableId: shot.targetStableId, targetKind: shot.targetKind, focus: shot.focus,
          worldX: shot.world.x, worldY: shot.world.y,
          expectedRelation: shot.expectedRelation, expectedDepth: shot.expectedDepth,
        } : {}),
        ...(shot.kind === 'camera' ? { cameraCase: shot.cameraCase, cameraLabel: shot.cameraLabel, persona: shot.persona, personaName: shot.personaName } : {}),
        ...(shot.kind === 'interaction' ? { interactionCase: shot.interactionCase, interactionLabel: shot.interactionLabel } : {}),
        ...(shot.kind === 'movement' ? { movementCase: shot.movementCase, movementLabel: shot.movementLabel } : {}),
      })
    }

    const index = {
      $schema: 'juyiting-occlusion-e13-index-v1',
      schemaVersion: 1,
      taskId: 'E13',
      generatedAt: new Date().toISOString(),
      frontendUrl: FRONTEND_URL,
      chromium: await evaluate(cdp, `navigator.userAgent`),
      worldModelSha256: sha256(readFileSync(join(EVIDENCE_DIR, 'world-model.json'))),
      shotPlanSha256: sha256(readFileSync(planPath)),
      shotCount: records.length,
      status: 'GENERATED',
      shots: records,
    }
    writeFileSync(join(outputDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
    console.log(`E13 evidence generated: ${records.length} shots -> ${outputDir}`)
    return index
  } catch (error) {
    const blocked = {
      $schema: 'juyiting-occlusion-e13-runtime-blocked-v1',
      taskId: 'E13',
      timestamp: new Date().toISOString(),
      frontendUrl: FRONTEND_URL,
      frontendReachable,
      error: error.message,
      probes: probes.map(p => ({ ...p })),
      screenshotsGenerated: 0,
      note: 'No screenshots were fabricated. Re-run on a host with a reachable frontend and working headless chromium.',
    }
    writeFileSync(join(outputDir, 'runtime-blocked.json'), `${JSON.stringify(blocked, null, 2)}\n`)
    console.error(`E13 evidence generation BLOCKED: ${error.message}`)
    console.error(`diagnostics written to ${join(outputDir, 'runtime-blocked.json')}`)
    process.exitCode = 3
  } finally {
    if (cdp) cdp.close()
    if (chrome) await stopChrome(chrome, userDataDir)
  }
}

async function captureMatrixShot (cdp, shot, worldModel) {
  const { kind } = shot
  if (kind === 'matrix') {
    await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const rt = window.__E13_RUNTIME__;
      rt.clearBubbles();
      // place all six personas; subject at target position, others at sideline
      const personas = ${JSON.stringify(worldModel.personas.map(p => p.personaCode))};
      const sidelines = ${JSON.stringify(SIDELINES)};
      personas.forEach((code, i) => {
        if (code === ${JSON.stringify(shot.persona)}) rt.place(code, code, ${shot.world.x}, ${shot.world.y}, 'down');
        else { const s = sidelines[i % sidelines.length]; rt.place(code, code, s.x, s.y, 'down'); }
      });
      rt.setCameraWorldCenter(${shot.camera.center.x}, ${shot.camera.center.y}, ${shot.camera.zoom});
      return true;
    })()`)
    await delay(260) // let per-frame V2 world-order commit settle
    const facts = await evaluate(cdp, `(() => {
      const rt = window.__E13_RUNTIME__;
      return {
        agent: rt.readAgent(${JSON.stringify(shot.persona)}),
        ordering: rt.readV2Ordering(${JSON.stringify(shot.persona)}, ${JSON.stringify(shot.targetStableId)}),
        camera: rt.readCamera(),
      };
    })()`)
    return await captureCanvasPng(cdp, { shot })
  }
  if (kind === 'camera') {
    await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const rt = window.__E13_RUNTIME__;
      const personas = ${JSON.stringify(worldModel.personas.map(p => p.personaCode))};
      const sidelines = ${JSON.stringify(SIDELINES)};
      personas.forEach((code, i) => {
        if (code === 'lujunyi') rt.place(code, code, 1446, 413, 'down');
        else { const s = sidelines[i % sidelines.length]; rt.place(code, code, s.x, s.y, 'down'); }
      });
      const cc = ${JSON.stringify(shot.camera)};
      rt.setCameraWorldCenter(cc.center.x, cc.center.y, cc.zoom);
      if (cc.panDx) juyitingGame.panBy(cc.panDx, 0);
      if (cc.pinch) {
        const vp = juyitingGame.getCameraSnapshot().viewport;
        rt.pinchGesture(vp.width / 2, vp.height / 2, cc.pinch.start, cc.pinch.end);
      }
      return true;
    })()`)
    await delay(260)
    return await captureCanvasPng(cdp)
  }
  if (kind === 'interaction') {
    return await captureInteraction(cdp, shot)
  }
  if (kind === 'movement') {
    return await captureMovement(cdp, shot)
  }
  throw new Error(`unknown shot kind ${kind}`)
}

async function captureInteraction (cdp, shot) {
  const { interactionCase } = shot
  if (interactionCase === 'agent-pointer') {
    await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const rt = window.__E13_RUNTIME__;
      const personas = ${JSON.stringify(PERSONAS.map(p => p.personaCode))};
      const sidelines = ${JSON.stringify(SIDELINES)};
      personas.forEach((code, i) => { if (code === 'songjiang') rt.place(code, code, 872, 302, 'down'); else { const s = sidelines[i % sidelines.length]; rt.place(code, code, s.x, s.y, 'down'); } });
      rt.setCameraWorldCenter(872, 302, 1.3);
      return true;
    })()`)
    await delay(260)
    // click the songjiang agent via its hit area
    await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const canvas = document.querySelector('.melon-layer canvas');
      const area = juyitingGame._hallScene._hitProvider().agents.find(a => a.id === 'songjiang');
      const rect = canvas.getBoundingClientRect();
      const vp = juyitingGame.getCameraSnapshot().viewport;
      if (!area?.bounds?.width || !area?.bounds?.height) throw new Error('songjiang hit area unavailable');
      const p = { x: area.bounds.x + area.bounds.width / 2, y: area.bounds.y + area.bounds.height / 2 };
      const scale = Math.max(rect.width / vp.width, rect.height / vp.height);
      const ox = (rect.width - vp.width * scale) / 2, oy = (rect.height - vp.height * scale) / 2;
      const options = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };
      canvas.dispatchEvent(new PointerEvent('pointerdown', { ...options, buttons: 1, clientX: rect.left + ox + p.x * scale, clientY: rect.top + oy + p.y * scale }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0, clientX: rect.left + ox + p.x * scale, clientY: rect.top + oy + p.y * scale }));
      return true;
    })()`)
    await delay(200)
    const selected = await evaluate(cdp, `(() => { ${GAME_LOOKUP_SOURCE}; return Boolean(juyitingGame._hallScene._agents.get('songjiang')?._selected); })()`)
    if (!selected) throw new Error('agent pointer did not select songjiang')
    return await captureCanvasPng(cdp)
  }
  if (interactionCase.startsWith('hotspot-')) {
    const hotspotId = interactionCase.replace('hotspot-', '')
    const panelClass = hotspotId === 'bounty-board' ? '.panel-tasks' : hotspotId === 'library-shelf' ? '.panel-library' : '.panel-chat'
    await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      juyitingGame.resetToMainHall();
      const area = juyitingGame._hallScene._hitProvider().hotspots.find(h => h.id === ${JSON.stringify(hotspotId)});
      if (!area?.bounds?.width) throw new Error('hotspot ${hotspotId} unavailable');
      juyitingGame._hallScene.panBy(juyitingGame.getCameraSnapshot().viewport.width / 2 - area.bounds.x - area.bounds.width / 2, juyitingGame.getCameraSnapshot().viewport.height / 2 - area.bounds.y - area.bounds.height / 2);
      return true;
    })()`)
    await delay(200)
    await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const canvas = document.querySelector('.melon-layer canvas');
      const rect = canvas.getBoundingClientRect();
      const vp = juyitingGame.getCameraSnapshot().viewport;
      const area = juyitingGame._hallScene._hitProvider().hotspots.find(h => h.id === ${JSON.stringify(hotspotId)});
      const p = { x: area.bounds.x + area.bounds.width / 2, y: area.bounds.y + area.bounds.height / 2 };
      const scale = Math.max(rect.width / vp.width, rect.height / vp.height);
      const ox = (rect.width - vp.width * scale) / 2, oy = (rect.height - vp.height * scale) / 2;
      const options = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };
      canvas.dispatchEvent(new PointerEvent('pointerdown', { ...options, buttons: 1, clientX: rect.left + ox + p.x * scale, clientY: rect.top + oy + p.y * scale }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0, clientX: rect.left + ox + p.x * scale, clientY: rect.top + oy + p.y * scale }));
      return true;
    })()`)
    await waitForExpression(cdp, `Boolean(document.querySelector(${JSON.stringify(panelClass)}))`, 8000)
    return await captureCanvasPng(cdp)
  }
  if (interactionCase === 'labels-bubbles') {
    await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const rt = window.__E13_RUNTIME__;
      const personas = ${JSON.stringify(PERSONAS.map(p => p.personaCode))};
      const sidelines = ${JSON.stringify(SIDELINES)};
      personas.forEach((code, i) => {
        if (code === 'songjiang') rt.place(code, code, 872, 302, 'down');
        else if (code === 'lujunyi') rt.place(code, code, 1446, 413, 'down');
        else if (code === 'wuyong') rt.place(code, code, 880, 500, 'down');
        else { const s = sidelines[i % sidelines.length]; rt.place(code, code, s.x, s.y, 'down'); }
      });
      rt.setCameraWorldCenter(1160, 420, 0.95);
      const scene = juyitingGame._hallScene;
      scene.updateAgentSceneState('songjiang', { bubble: { text: '及时雨·宋江', ttlMs: 60000 } });
      scene.updateAgentSceneState('lujunyi', { bubble: { text: '玉麒麟·卢俊义', ttlMs: 60000 } });
      scene.updateAgentSceneState('wuyong', { bubble: { text: '智多星·吴用', ttlMs: 60000 } });
      return true;
    })()`)
    await delay(260)
    return await captureCanvasPng(cdp)
  }
  if (interactionCase === 'lighting-fullmap') {
    await evaluate(cdp, `(() => { ${GAME_LOOKUP_SOURCE}; juyitingGame.resetToMainHall(); return true; })()`)
    await delay(260)
    return await captureCanvasPng(cdp)
  }
  if (interactionCase === 'lighting-closeup') {
    await evaluate(cdp, `(() => {
      ${GAME_LOOKUP_SOURCE}
      const rt = window.__E13_RUNTIME__;
      const personas = ${JSON.stringify(PERSONAS.map(p => p.personaCode))};
      const sidelines = ${JSON.stringify(SIDELINES)};
      personas.forEach((code, i) => { if (code === 'lujunyi') rt.place(code, code, 1446, 413, 'down'); else { const s = sidelines[i % sidelines.length]; rt.place(code, code, s.x, s.y, 'down'); } });
      rt.setCameraWorldCenter(1446, 379, 1.5);
      return true;
    })()`)
    await delay(260)
    return await captureCanvasPng(cdp)
  }
  throw new Error(`unknown interaction case ${interactionCase}`)
}

async function captureMovement (cdp, shot) {
  // Real engine movement: enqueue a local command after cancelling backend hold.
  await evaluate(cdp, `(() => {
    ${GAME_LOOKUP_SOURCE}
    const g = juyitingGame;
    const rt = window.__E13_RUNTIME__;
    rt.installSnapshotSource([]); // engine-driven again? No: keep probe for non-actors, move subject via engine.
    return true;
  })()`)
  const { movementCase } = shot
  const targetRegionId = movementCase === 'movement-bounty-board' ? 'bounty-board' : 'gate'
  const actor = movementCase === 'movement-bounty-board' ? 'lujunyi' : 'likui'
  await evaluate(cdp, `(() => {
    ${GAME_LOOKUP_SOURCE}
    const g = juyitingGame;
    g.cancelMovement(${JSON.stringify(actor)}, 1);
    g.enqueueMovementCommands([{
      commandId: 'e13-move-${movementCase}-' + Date.now(),
      agentId: ${JSON.stringify(actor)}, personaCode: ${JSON.stringify(actor)},
      source: 'local', type: 'MOVE_TO_REGION', targetRegionId: ${JSON.stringify(targetRegionId)},
      priority: 5, stateVersion: 2, startedAt: new Date().toISOString(),
    }]);
    return true;
  })()`)
  await delay(450) // mid-walk
  return await captureCanvasPng(cdp)
}

if (isMainModule(import.meta.url)) {
  run().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
