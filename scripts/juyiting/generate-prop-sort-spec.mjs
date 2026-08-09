#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SaxesParser } from "saxes";
import { alphaScan, lastSpanRow, findTransitions, scanReport } from "./lib/alpha-scan.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const args = process.argv.slice(2);
function argVal(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i+1] : null; }

const SPEC_OUT = argVal("--spec") || join(REPO_ROOT, "tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json");
const SVG_OUT = argVal("--svg") || join(REPO_ROOT, "tests/fixtures/juyiting/occlusion-v1-props/contact-sheet.svg");
const TMX_PATH = argVal("--tmx") || "public/juyiting/hall.tmx";

const tmxBuf = readFileSync(join(REPO_ROOT, TMX_PATH));
const tmxSha256 = createHash("sha256").update(tmxBuf).digest("hex");
const tmxStr = tmxBuf.toString("utf-8");

const tmxData = { mapAttrs: null, tilesets: [], objects: [] };
{
  const parser = new SaxesParser({ xmlns: false, position: false });
  let inTileset = false, tilesetAttrs = null, tilesetTiles = [];
  let inTile = false, tileAttrs = null;
  let inObject = false, objectAttrs = null;

  parser.on("opentag", (tag) => {
    if (tag.name === "map") { tmxData.mapAttrs = { ...tag.attributes }; }
    if (tag.name === "tileset") { inTileset = true; tilesetAttrs = { ...tag.attributes }; tilesetTiles = []; }
    if (tag.name === "tile" && inTileset) { inTile = true; tileAttrs = { ...tag.attributes }; }
    if (tag.name === "image" && inTile) { tileAttrs.image = { ...tag.attributes }; }
    if (tag.name === "object" && tag.attributes.type === "prop") { inObject = true; objectAttrs = { ...tag.attributes }; }
  });
  parser.on("closetag", (tag) => {
    if (tag.name === "tileset" && inTileset) { tmxData.tilesets.push({ attrs: tilesetAttrs, tiles: tilesetTiles }); inTileset = false; }
    if (tag.name === "tile" && inTile) { tilesetTiles.push(tileAttrs); inTile = false; }
    if (tag.name === "object" && inObject) { tmxData.objects.push(objectAttrs); inObject = false; }
  });
  parser.write(tmxStr).close();
}

const propsTileset = tmxData.tilesets.find(ts => ts.attrs.name === "hall-props");
if (!propsTileset) { console.error("FATAL: hall-props tileset not found"); process.exit(1); }

const baseFirstGid = Number(propsTileset.attrs.firstgid);
const tileMap = new Map();
for (const tile of propsTileset.tiles) {
  const tid = Number(tile.id);
  const gid = baseFirstGid + tid;
  tileMap.set(gid, { tileId: tid, imageSource: tile.image?.source || "", imageWidth: Number(tile.image?.width) || 0, imageHeight: Number(tile.image?.height) || 0 });
}

const propFiles = {
  90: "public/juyiting/images/props/liangshan-hall-prop-main-seat-cropped.png",
  91: "public/juyiting/images/props/liangshan-hall-prop-agent-roster-cropped.png",
  92: "public/juyiting/images/props/liangshan-hall-prop-bounty-board-cropped.png",
  93: "public/juyiting/images/props/liangshan-hall-prop-library-shelf-cropped.png",
  94: "public/juyiting/images/props/liangshan-hall-prop-roster-book-cropped.png",
};
const scans = {};
for (const [id, path] of Object.entries(propFiles)) scans[id] = alphaScan(join(REPO_ROOT, path));

function buildRationale(prop, scan, isFloorStanding, extra) {
  let r = isFloorStanding ? "Floor-standing. " : "NOT floor-standing (table-top object). ";
  r += "sortAnchor.y=" + prop.sortAnchor.y + " ";
  if (prop.sortAnchor.y === prop.tmxRect.maxY) r += "(rect bottom, TMX " + prop.tmxRect.y + "+" + prop.tmxRect.height + "). ";
  else r += "(img row " + (prop.sortAnchor.y - prop.tmxRect.y) + " in " + scan.height + "px image, NOT rect bottom " + prop.tmxRect.maxY + "). ";
  r += scanReport(scan) + " ";
  if (extra) r += extra + " ";
  r += "sortAnchor.x=" + prop.sortAnchor.x + " is rect center.";
  return r;
}

const propDefs = [
  { semanticName: "roster-book", tmxId: 94, tmxName: "roster-book-rect", stableId: "jyt.prop.center-north.roster-book.v1", chunkId: "center", tmxRect: { x: 217, y: 192, w: 179, h: 192 }, sortAnchor: { x: 306, y: 260 }, tieBias: 0, isFloorStanding: false, extra: "Structural transition at row 82 (span 156→138, minX 7→25) marks pages→body boundary. Anchor at row 68 (Y=260) places book behind table (fpY 66560 < 97024)." },
  { semanticName: "main-seat", tmxId: 90, tmxName: "main-seat-rect", stableId: "jyt.prop.center-north.main-seat.v1", chunkId: "center", tmxRect: { x: 818, y: 175, w: 109, h: 93 }, sortAnchor: { x: 872, y: 268 }, tieBias: 0, isFloorStanding: true, extra: "Single pixel at bottom row (x=3) is structural terminus of seat back." },
  { semanticName: "bounty-board", tmxId: 92, tmxName: "bounty-board-rect", stableId: "jyt.prop.northeast.bounty-board.v1", chunkId: "east-upper", tmxRect: { x: 1360, y: 255, w: 172, h: 124 }, sortAnchor: { x: 1446, y: 379 }, tieBias: -4, isFloorStanding: true, extra: "V0 target: table≈379 < agent≈420 < railing≈458. tieBias=-4 ensures deterministic boundary." },
  { semanticName: "library-shelf", tmxId: 93, tmxName: "library-shelf-rect", stableId: "jyt.prop.southeast.library-shelf.v1", chunkId: "east-lower", tmxRect: { x: 1497, y: 578, w: 123, h: 141 }, sortAnchor: { x: 1558, y: 719 }, tieBias: 0, isFloorStanding: true, extra: "" },
  { semanticName: "agent-roster", tmxId: 91, tmxName: "agent-roster-rect", stableId: "jyt.prop.southwest.agent-roster.v1", chunkId: "west-lower", tmxRect: { x: 120, y: 601, w: 117, h: 136 }, sortAnchor: { x: 178, y: 737 }, tieBias: 0, isFloorStanding: true, extra: "All 136 rows have alpha. Bottom rows 123-135 taper from 24px to 20px (stand feet). Floor contact IS at rect bottom." },
];

function buildProbes(def) {
  const ax = def.sortAnchor.x, ay = def.sortAnchor.y;
  const rx = def.tmxRect.x, rw = def.tmxRect.w;
  return {
    north: { agentFootPoint: { x: ax, y: ay - 28 }, expectedRelation: "agent<prop", rationale: "Agent north: y=" + (ay - 28) + " < prop sortAnchor.y=" + ay + "." },
    south: { agentFootPoint: { x: ax, y: ay + 28 }, expectedRelation: "prop<agent", rationale: "Agent south: prop sortAnchor.y=" + ay + " < agent y=" + (ay + 28) + "." },
    west:  { agentFootPoint: { x: rx - 28, y: ay }, expectedRelation: "non-overlap", pixelOverlap: false, rationale: "West of rect [" + rx + "," + (rx + rw) + "]." },
    east:  { agentFootPoint: { x: rx + rw + 28, y: ay }, expectedRelation: "non-overlap", pixelOverlap: false, rationale: "East of rect [" + rx + "," + (rx + rw) + "]." },
  };
}

function buildMatrix(def) {
  const ax = def.sortAnchor.x, ay = def.sortAnchor.y;
  const rx = def.tmxRect.x, rw = def.tmxRect.w;
  return {
    description: "14-cell matrix: 8-cell N/S/W/E x lujunyi/husanniang + 6-cell behind/boundary/front x both roles.",
    roles: ["lujunyi", "husanniang"],
    roleInvarianceRequirement: "Both roles produce identical sort result; sort key does not depend on role identity.",
    cleanMode: { description: "No UI overlay/labels/bubbles.", requiredFields: ["commit","tmxSha256","cameraZoom","cameraDpr","sortKey","agentFootWorld"] },
    uiOnMode: { description: "Labels and bubbles visible.", requiredFields: ["commit","tmxSha256","cameraZoom","cameraDpr","sortKey","agentFootWorld"] },
    matrixCells: {
      north: { agentFoot: { x: ax, y: ay - 139 }, lujunyiExpected: "agent<prop", husanniangExpected: "agent<prop", rationale: "y=" + (ay - 139) + " < table " + ay + ", both behind table." },
      south: { agentFoot: { x: ax, y: ay + 41 }, lujunyiExpected: "prop<agent", husanniangExpected: "prop<agent", rationale: "y=" + (ay + 41) + " > table " + ay + ", V0 canonical." },
      west:  { agentFoot: { x: rx - 40, y: ay }, lujunyiExpected: "non-overlap", husanniangExpected: "non-overlap", rationale: "West of rect [" + rx + "," + (rx + rw) + "]." },
      east:  { agentFoot: { x: rx + rw + 28, y: ay }, lujunyiExpected: "non-overlap", husanniangExpected: "non-overlap", rationale: "East of rect [" + rx + "," + (rx + rw) + "]." },
    },
    behindBoundaryFront: {
      description: "6-cell: 2 roles x 3 positions. X=" + ax + ", Y varies. tieBias=-4 resolves boundary deterministically.",
      requiredFields: ["commit","tmxSha256","cameraZoom","cameraDpr","sortKey","agentFootWorld","cleanMode"],
      behind:   { agentFoot: { x: ax, y: ay - 9 }, lujunyiExpected: "agent<prop", husanniangExpected: "agent<prop", rationale: "y=" + (ay - 9) + " < table " + ay + ", agent behind table." },
      boundary: { agentFoot: { x: ax, y: ay }, lujunyiExpected: "prop<agent", husanniangExpected: "prop<agent", rationale: "y=" + ay + " = anchor, same fpY. table tieBias=-4 < agent 0 -> table sorts first -> table behind agent. tieBias, NOT stableId." },
      front:    { agentFoot: { x: ax, y: ay + 41 }, lujunyiExpected: "prop<agent", husanniangExpected: "prop<agent", rationale: "y=" + (ay + 41) + " > table " + ay + ", V0 canonical." },
    },
    mask58CrossReference: { description: "Mask 58 x=[1197,1663] y=[342,458]. E10A mandatory review.", action: "E10A_REQUIRED_REVIEW", maskId: 58, maskAabb: { minX: 1197, minY: 342, maxX: 1663, maxY: 458 } },
  };
}

const props = propDefs.map(def => {
  const r = def.tmxRect;
  const scan = scans[def.tmxId];
  const assetPath = propFiles[def.tmxId];
  const assetBuf = readFileSync(join(REPO_ROOT, assetPath));
  const assetSha = createHash("sha256").update(assetBuf).digest("hex");
  const obj = {
    semanticName: def.semanticName, tmxId: def.tmxId, tmxName: def.tmxName, stableId: def.stableId,
    sceneId: "juyiting-main", chunkId: def.chunkId, floorId: "floor-1", elevation: 0,
    renderBand: "world", sortMode: "fixed", tieBias: def.tieBias,
    asset: { path: assetPath, sha256: assetSha, width: scan.width, height: scan.height },
    tmxRect: { x: r.x, y: r.y, width: r.w, height: r.h, minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h },
    sortAnchor: { x: def.sortAnchor.x, y: def.sortAnchor.y },
    fixedPointY: Math.round(def.sortAnchor.y * 256),
    sortAnchorRationale: buildRationale(def, scan, def.isFloorStanding, def.extra),
    probes: buildProbes(def),
  };
  if (def.tmxId === 92) {
    obj.bountyBoardMatrix = buildMatrix(def);
    obj.tieBiasRationale = "tieBias=-4 ensures deterministic table<agent at same fixedPointY. WorldSortKey: renderBandOrder->floorOrder->elevation->fixedPointY->tieBias->stableId. table(-4) < agent(0) -> table behind agent. NOT stableId.";
  }
  return obj;
});

function sortByKey(plist) {
  return [...plist].sort((a, b) => {
    if (a.fixedPointY !== b.fixedPointY) return a.fixedPointY - b.fixedPointY;
    if (a.tieBias !== b.tieBias) return a.tieBias - b.tieBias;
    const sa = a.stableId, sb = b.stableId;
    for (let i = 0; i < Math.min(sa.length, sb.length); i++) if (sa.charCodeAt(i) !== sb.charCodeAt(i)) return sa.charCodeAt(i) - sb.charCodeAt(i);
    return sa.length - sb.length;
  });
}
const sortedOrder = sortByKey(props).map(p => p.stableId);

const mapAttrs = tmxData.mapAttrs;
const tw = Number(mapAttrs?.tilewidth), th = Number(mapAttrs?.tileheight);
const mw = Number(mapAttrs?.width), mh = Number(mapAttrs?.height);
if (!(tw > 0 && th > 0 && mw > 0 && mh > 0)) { console.error("FATAL: TMX map missing valid tilewidth/tileheight/width/height"); process.exit(1); }

const spec = {
  "$schema": "jyt.occlusion.prop-sort-spec.v1",
  specVersion: 1,
  taskId: "E8A",
  baseCommit: "7144d9260b3905ce0335d037d3b1a3589d3a88a1",
  sceneId: "juyiting-main",
  propCount: 5,
  props,
  globalConstraints: {
    declarationOrderIndependence: { description: "Sort result identical regardless of prop declaration/insertion order.", testVector: "Sort 5 props; shuffle input 10 times; verify output byte-identical." },
    fivePropSortOrder: {
      description: "Expected base sort order (WorldSortKey ascending).",
      order: sortedOrder,
      rationale: "fixedPointY: roster-book(" + props.find(p=>p.tmxId===94).fixedPointY + ") < main-seat(" + props.find(p=>p.tmxId===90).fixedPointY + ") < bounty-board(" + props.find(p=>p.tmxId===92).fixedPointY + ") < library-shelf(" + props.find(p=>p.tmxId===93).fixedPointY + ") < agent-roster(" + props.find(p=>p.tmxId===91).fixedPointY + "). Same renderBand/world, floorId/floor-1, elevation/0. bounty-board tieBias=-4 (only matters at same fixedPointY).",
    },
    failClosedRules: {
      tmxIdChange: "TMX object id/name/rect/gid mismatch -> verify failure",
      nameChange: "tmxName mismatch -> verify failure",
      rectChange: "rect field mismatch -> verify failure",
      assetShaMismatch: "asset sha256 mismatch -> verify failure",
      missingProp: "<5 props -> verify failure",
      duplicateStableId: "duplicate stableId -> verify failure",
      anchorOutOfBounds: "sortAnchor outside [0,1664]x[0,928] -> verify failure",
      fixedPointInconsistency: "fixedPointY != round(sortAnchor.y*256) -> verify failure",
      nonFiveCount: "propCount != 5 -> verify failure",
      tieBiasOutOfRange: "tieBias not in [-32,32] -> verify failure",
      missingMatrix: "bounty-board missing matrix -> verify failure",
      elevationNotZero: "elevation != 0 -> verify failure",
      generationIdMismatch: "generationId != SHA-256(spec with generationId=64 zeros) -> verify failure",
    },
  },
  tmxSource: { path: "public/juyiting/hall.tmx", sha256: tmxSha256, coordinateWidth: mw * tw, coordinateHeight: mh * th },
  generationId: "0000000000000000000000000000000000000000000000000000000000000000",
  generatedAt: new Date().toISOString(),
  generatedBy: "scripts/juyiting/generate-prop-sort-spec.mjs (deterministic generator; uses pngjs alpha-scan; see scripts/juyiting/lib/alpha-scan.mjs)",
};

const specStr = JSON.stringify(spec, null, 2);
const genId = createHash("sha256").update(specStr).digest("hex");
spec.generationId = genId;

const finalSpecStr = JSON.stringify(spec, null, 2) + "\n";
writeFileSync(SPEC_OUT, finalSpecStr);
console.error("Spec: " + SPEC_OUT + " genId=" + genId);

// Generate SVG
function dataUri(path) { return "data:image/png;base64," + readFileSync(join(REPO_ROOT, path)).toString("base64"); }
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"<").replace(/>/g,">"); }

let svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1600 1300" width="1600" height="1300" data-generation-id="' + genId + '" data-base-commit="' + spec.baseCommit + '" data-task="E8A" data-spec="prop-sort-spec.v1">\n';
svg += '  <defs><style>text{font-family:monospace}.title{font-size:18px;font-weight:bold;fill:#1a1a2e}.subtitle{font-size:14px;fill:#444}.label{font-size:11px;fill:#333}.anchor-label{font-size:10px;fill:#d32f2f;font-weight:bold}.probe-label{font-size:9px;fill:#1976d2}.evidence-label{font-size:9px;fill:#388e3c}.id-label{font-size:10px;fill:#666}.legend-text{font-size:11px;fill:#333}</style></defs>\n';
svg += '  <rect width="1600" height="1300" fill="#fafafa"/>\n';
svg += '  <rect x="10" y="10" width="1580" height="40" rx="4" fill="#1a1a2e"/>\n';
svg += '  <text x="20" y="36" class="title" fill="#fff">E8A: Five Prop Sort Specification — Contact Sheet</text>\n';
svg += '  <text x="20" y="68" class="subtitle">Base: ' + spec.baseCommit.substring(0,7) + ' | Generation: ' + genId + ' | TMX SHA256: ' + tmxSha256.substring(0,8) + ' | Scene: juyiting-main</text>\n';
svg += '  <text x="20" y="86" class="subtitle">All props: renderBand=world, floorId=floor-1, elevation=0, sortMode=fixed | bounty-board: tieBias=-4 (deterministic boundary via tieBias, NOT stableId)</text>\n';

const panelW = 760, panelH = 220, panelX0 = 30, panelY0 = 185, panelGapX = 30, panelGapY = 25;
const propPanels = [{id:90,row:0,col:0},{id:91,row:0,col:1},{id:92,row:1,col:0},{id:93,row:1,col:1},{id:94,row:2,col:0}];

for (const pp of propPanels) {
  const p = spec.props.find(x => x.tmxId === pp.id);
  const px = panelX0 + pp.col * (panelW + panelGapX);
  const py = panelY0 + pp.row * (panelH + panelGapY);
  const s = Math.min(120 / p.asset.width, 120 / p.asset.height);
  const dw = Math.round(p.asset.width * s * 100) / 100, dh = Math.round(p.asset.height * s * 100) / 100;
  const ix = px + 10, iy = py + 40;
  const aix = (p.sortAnchor.x - p.tmxRect.x) * (dw / p.asset.width);
  const aiy = (p.sortAnchor.y - p.tmxRect.y) * (dh / p.asset.height);
  const asx = ix + aix, asy = iy + aiy;
  const uri = dataUri(propFiles[p.tmxId]);

  svg += '  <rect x="' + px + '" y="' + py + '" width="' + panelW + '" height="' + panelH + '" rx="4" fill="#fff" stroke="#ddd"/>\n';
  svg += '  <text x="' + (px+10) + '" y="' + (py+20) + '" class="title" font-size="14">' + esc(p.semanticName) + ' (TMX id=' + p.tmxId + ')</text>\n';
  svg += '  <text x="' + (px+10) + '" y="' + (py+34) + '" class="id-label">' + esc(p.stableId) + '</text>\n';
  svg += '  <rect x="' + ix + '" y="' + iy + '" width="' + dw + '" height="' + dh + '" fill="rgba(255,215,0,0.15)" stroke="#b8860b" stroke-width="1"/>\n';
  svg += '  <image x="' + ix + '" y="' + iy + '" width="' + dw + '" height="' + dh + '" xlink:href="' + uri + '" image-rendering="auto" opacity="0.9"/>\n';
  svg += '  <circle cx="' + asx + '" cy="' + asy + '" r="4" fill="#d32f2f" stroke="#fff" stroke-width="1"/>\n';
  svg += '  <line x1="' + (asx-8) + '" y1="' + (asy-8) + '" x2="' + (asx+8) + '" y2="' + (asy+8) + '" stroke="#d32f2f" stroke-width="1.5"/>\n';
  svg += '  <line x1="' + (asx+8) + '" y1="' + (asy-8) + '" x2="' + (asx-8) + '" y2="' + (asy+8) + '" stroke="#d32f2f" stroke-width="1.5"/>\n';
  svg += '  <text x="' + (asx+6) + '" y="' + (asy-9) + '" class="anchor-label">anchor(' + p.sortAnchor.x + ',' + p.sortAnchor.y + ') fpY=' + p.fixedPointY + '</text>\n';
  svg += '  <rect x="' + ix + '" y="' + (iy+dh*0.8) + '" width="' + dw + '" height="' + (dh*0.2) + '" fill="rgba(0,200,83,0.15)" stroke="#2e7d32" stroke-width="0.5" stroke-dasharray="2,2"/>\n';
  svg += '  <text x="' + (ix+2) + '" y="' + (iy+dh*0.8-3) + '" class="evidence-label">alpha-evidence zone</text>\n';
  svg += '  <rect x="' + (ix+dw+10) + '" y="' + (py+40) + '" width="230" height="130" rx="3" fill="#f5f5f5" stroke="#ddd"/>\n';
  svg += '  <text x="' + (ix+dw+15) + '" y="' + (py+57) + '" class="label" font-weight="bold">N/S/W/E Probes (world coords)</text>\n';

  const dirs = [{d:"north",c:"#d32f2f",l:"NORTH"},{d:"south",c:"#d32f2f",l:"SOUTH"},{d:"west",c:"#1976d2",l:"WEST"},{d:"east",c:"#1976d2",l:"EAST"}];
  let pry = py + 74;
  for (const dd of dirs) {
    const pr = p.probes[dd.d];
    svg += '  <text x="' + (ix+dw+15) + '" y="' + pry + '" class="probe-label" fill="' + dd.c + '">' + dd.l + ': (' + pr.agentFootPoint.x + ',' + pr.agentFootPoint.y + ') -&gt; ' + pr.expectedRelation + '</text>\n';
    pry += 16;
  }
  svg += '  <text x="' + (ix+dw+15) + '" y="' + (pry+6) + '" class="evidence-label" font-size="8">' + esc(p.sortAnchorRationale.substring(0,200)) + '...</text>\n';
  svg += '  <text x="' + (px+10) + '" y="' + (py+panelH-5) + '" class="id-label" font-size="8">Asset: ' + esc(p.asset.path.split("/").pop()) + ' | SHA256: ' + p.asset.sha256.substring(0,16) + '... | ' + p.asset.width + 'x' + p.asset.height + ' | tieBias=' + p.tieBias + '</text>\n';
}

// bounty-board enlarged
const bb = spec.props.find(x => x.tmxId === 92);
const bbY = panelY0 + 3 * (panelH + panelGapY);
svg += '  <rect x="30" y="' + bbY + '" width="1540" height="270" rx="4" fill="#fff" stroke="#d32f2f" stroke-width="2"/>\n';
svg += '  <rect x="30" y="' + bbY + '" width="1540" height="30" rx="4" fill="#d32f2f"/>\n';
svg += '  <text x="45" y="' + (bbY+20) + '" class="title" fill="#fff">Bounty-Board (tmxId=92) — 14-Cell Matrix | tieBias=-4 deterministic boundary</text>\n';
svg += '  <image x="50" y="' + (bbY+45) + '" width="' + bb.asset.width + '" height="' + bb.asset.height + '" xlink:href="' + dataUri(propFiles[92]) + '" opacity="0.9"/>\n';
svg += '  <rect x="50" y="' + (bbY+45) + '" width="' + bb.asset.width + '" height="' + bb.asset.height + '" fill="none" stroke="#b8860b" stroke-width="1"/>\n';
const bbax = 50 + (bb.sortAnchor.x - bb.tmxRect.x), bbay = bbY + 45 + (bb.sortAnchor.y - bb.tmxRect.y);
svg += '  <circle cx="' + bbax + '" cy="' + bbay + '" r="5" fill="#d32f2f" stroke="#fff" stroke-width="1.5"/>\n';
svg += '  <text x="' + (bbax+8) + '" y="' + (bbay-6) + '" class="anchor-label">anchor(' + bb.sortAnchor.x + ',' + bb.sortAnchor.y + ')</text>\n';
svg += '  <rect x="250" y="' + (bbY+45) + '" width="650" height="200" rx="3" fill="#fafafa" stroke="#ccc"/>\n';
svg += '  <text x="265" y="' + (bbY+62) + '" class="label" font-weight="bold">N/S/W/E Matrix (both roles, same foot-point/dir/frame)</text>\n';
svg += '  <text x="265" y="' + (bbY+82) + '" class="label">Direction  Agent Foot     Lujunyi       Husanniang   Relation</text>\n';
svg += '  <text x="265" y="' + (bbY+100) + '" class="probe-label">N         (1446, 240)     agent&lt;prop    agent&lt;prop    Agent north of table</text>\n';
svg += '  <text x="265" y="' + (bbY+118) + '" class="probe-label" fill="#d32f2f">S         (1446, 420)     prop&lt;agent    prop&lt;agent    V0 canonical: table&lt;agent</text>\n';
svg += '  <text x="265" y="' + (bbY+136) + '" class="probe-label" fill="#1976d2">W         (1320, 379)     non-overlap   non-overlap   West of rect</text>\n';
svg += '  <text x="265" y="' + (bbY+154) + '" class="probe-label" fill="#1976d2">E         (1560, 379)     non-overlap   non-overlap   East of rect</text>\n';
svg += '  <text x="265" y="' + (bbY+174) + '" class="label" font-weight="bold">Behind/Boundary/Front (X=1446, Y varies) — tieBias=-4 resolves boundary</text>\n';
svg += '  <text x="265" y="' + (bbY+192) + '" class="probe-label">Behind    (1446, 370)     agent&lt;prop    agent&lt;prop    y=370 &lt; 379, agent behind</text>\n';
svg += '  <text x="265" y="' + (bbY+207) + '" class="probe-label" fill="#d32f2f">Boundary  (1446, 379)     prop&lt;agent    prop&lt;agent    y=379=anchor, tieBias: table(-4)&lt;agent(0) -> table behind agent</text>\n';
svg += '  <text x="265" y="' + (bbY+222) + '" class="probe-label">Front     (1446, 420)     prop&lt;agent    prop&lt;agent    y=420 &gt; 379, agent in front</text>\n';
svg += '  <rect x="930" y="' + (bbY+45) + '" width="350" height="200" rx="3" fill="#fafafa" stroke="#ccc"/>\n';
svg += '  <text x="945" y="' + (bbY+62) + '" class="label" font-weight="bold">V0 Target / mask58</text>\n';
svg += '  <text x="945" y="' + (bbY+85) + '" class="label">table anchor ~379 &lt; agent ~420 &lt; railing ~458</text>\n';
svg += '  <text x="945" y="' + (bbY+108) + '" class="evidence-label" font-size="9">Mask 58 -> E10A mandatory review</text>\n';
svg += '  <text x="945" y="' + (bbY+125) + '" class="evidence-label" font-size="9">mask58: x=[1197,1663] y=[342,458]</text>\n';
svg += '  <text x="945" y="' + (bbY+145) + '" class="evidence-label" font-size="8">Evidence fields: commit|tmxSha256|cameraZoom|cameraDpr|sortKey|agentFootWorld</text>\n';
svg += '  <text x="945" y="' + (bbY+162) + '" class="evidence-label" font-size="8">tieBias=-4 ensures deterministic boundary without stableId</text>\n';
svg += '  <rect x="10" y="' + (bbY+280) + '" width="1580" height="30" rx="4" fill="#1a1a2e"/>\n';
svg += '  <text x="20" y="' + (bbY+300) + '" class="label" fill="#aaa">E8A Contact Sheet | Generation ID: ' + genId + ' | 5/5 props frozen | Alpha evidence via pngjs | Bounty-board 14-cell matrix | mask58 cross-reference</text>\n';
svg += '</svg>\n';

svg = svg.split("\n").map(l => l.replace(/[ \t]+$/, "")).join("\n");
if (!svg.endsWith("\n")) svg += "\n";
writeFileSync(SVG_OUT, svg);
console.error("SVG: " + SVG_OUT);
console.error("Done.");
