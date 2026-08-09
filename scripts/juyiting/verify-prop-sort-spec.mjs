#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SaxesParser } from "saxes";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
// Allow --spec <path> override for testing
const SPEC_PATH = process.argv.includes("--spec")
  ? (() => { const i = process.argv.indexOf("--spec"); return process.argv[i+1] || ""; })()
  : join(REPO_ROOT, "tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json");

let failures = 0;
function fail(msg) { console.error("FAIL:", msg); failures++; }
function pass(msg) { console.error("PASS:", msg); }

let spec;
try { spec = JSON.parse(readFileSync(SPEC_PATH, "utf-8")); }
catch (e) { console.error("FATAL:", e.message); process.exit(1); }

// ═══ 1. Structural ═══
if (spec.propCount !== 5) fail("propCount"); else pass("propCount=5");
if (spec.props.length !== 5) fail("props.length"); else pass("props.length=5");
if (spec.sceneId !== "juyiting-main") fail("sceneId"); else pass("sceneId");
if (spec.specVersion !== 1) fail("specVersion must be 1, got " + spec.specVersion); else pass("specVersion=1");
if (spec.baseCommit !== "7144d9260b3905ce0335d037d3b1a3589d3a88a1") fail("baseCommit mismatch"); else pass("baseCommit verified");
// TMX id range 90-94
const tmxIds = spec.props.map(p => p.tmxId).sort((a,b)=>a-b);
if (tmxIds.join(",") !== "90,91,92,93,94") fail("tmxIds must be 90-94, got " + tmxIds.join(",")); else pass("tmxIds=90-94");

// ═══ 2. Structured TMX parse ═══
const tmxObjects = [];
try {
  const tmxBuf = readFileSync(join(REPO_ROOT, spec.tmxSource.path));
  const tmxSha = createHash("sha256").update(tmxBuf).digest("hex");
  if (tmxSha !== spec.tmxSource.sha256) fail("TMX sha256 mismatch");
  else pass("TMX sha256 OK");

  const parser = new SaxesParser({ xmlns: false, position: false });
  let inObject = false, attrs = null, depth = 0, mapAttrs = null;
  parser.on("opentag", (tag) => {
    depth++;
    if (tag.name === "map") { mapAttrs = { ...tag.attributes }; }
    if (tag.name === "object" && tag.attributes.type === "prop") {
      inObject = true; attrs = { ...tag.attributes };
    }
  });
  parser.on("closetag", (tag) => {
    if (tag.name === "object" && inObject) {
      tmxObjects.push(attrs); inObject = false; attrs = null;
    }
    depth--;
  });
  parser.write(tmxBuf.toString("utf-8")).close();
  pass("TMX parsed: " + tmxObjects.length + " prop objects found");
  if (mapAttrs) {
    const tw = Number(mapAttrs.tilewidth) || 16, th = Number(mapAttrs.tileheight) || 16;
    const mw = Number(mapAttrs.width) * tw, mh = Number(mapAttrs.height) * th;
    if (mw !== spec.tmxSource.coordinateWidth) fail("TMX map pixel-width=" + mw + " != spec coordinateWidth=" + spec.tmxSource.coordinateWidth);
    else pass("TMX map pixel-width OK: " + mw);
    if (mh !== spec.tmxSource.coordinateHeight) fail("TMX map pixel-height=" + mh + " != spec coordinateHeight=" + spec.tmxSource.coordinateHeight);
    else pass("TMX map pixel-height OK: " + mh);
  } else { fail("TMX map element not found"); }
} catch (e) { fail("TMX parse: " + e.message); }

// ═══ 3. Per-prop validation ═══
const seenIds = new Set(), seenStableIds = new Set();
const STABLE_ID_RE = /^[a-z0-9][a-z0-9._-]{2,95}$/;
const CW = spec.tmxSource.coordinateWidth, CH = spec.tmxSource.coordinateHeight;

for (const prop of spec.props) {
  const label = prop.semanticName + "/" + prop.tmxId;
  if (seenIds.has(prop.tmxId)) { fail(label + ": dup tmxId"); continue; }
  seenIds.add(prop.tmxId);
  if (seenStableIds.has(prop.stableId)) { fail(label + ": dup stableId"); continue; }
  seenStableIds.add(prop.stableId);
  if (!STABLE_ID_RE.test(prop.stableId)) fail(label + ": stableId pattern");
  else pass(label + ": stableId OK");

  if (prop.sceneId !== "juyiting-main") fail(label + ": sceneId");
  if (prop.floorId !== "floor-1") fail(label + ": floorId");
  if (prop.elevation !== 0) fail(label + ": elevation=" + prop.elevation);
  if (prop.renderBand !== "world") fail(label + ": renderBand");
  if (prop.sortMode !== "fixed") fail(label + ": sortMode");
  if (!Number.isSafeInteger(prop.tieBias) || prop.tieBias < -32 || prop.tieBias > 32) fail(label + ": tieBias=" + prop.tieBias);

  const sa = prop.sortAnchor;
  if (!sa || typeof sa.x !== "number" || typeof sa.y !== "number") fail(label + ": sortAnchor missing");
  else {
    if (sa.x < 0 || sa.x > CW) fail(label + ": anchor.x=" + sa.x + " OOB");
    if (sa.y < 0 || sa.y > CH) fail(label + ": anchor.y=" + sa.y + " OOB");
  }
  const efp = Math.round((sa?.y ?? 0) * 256);
  if (prop.fixedPointY !== efp) fail(label + ": fixedPointY " + prop.fixedPointY + " != " + efp);
  else pass(label + ": fpY=" + prop.fixedPointY);

  if (!prop.asset?.path || !prop.asset?.sha256) fail(label + ": asset missing");
  else {
    try {
      const buf = readFileSync(join(REPO_ROOT, prop.asset.path));
      if (createHash("sha256").update(buf).digest("hex") !== prop.asset.sha256) fail(label + ": asset sha");
      else pass(label + ": asset sha OK");
    } catch (e) { fail(label + ": asset read: " + e.message); }
  }

  const r = prop.tmxRect;
  if (!r) fail(label + ": tmxRect missing");
  else {
    if (r.x + r.width !== r.maxX) fail(label + ": maxX");
    if (r.y + r.height !== r.maxY) fail(label + ": maxY");
  }

  if (!prop.probes) fail(label + ": probes missing");
  else for (const d of ["north","south","west","east"]) {
    const pr = prop.probes[d];
    if (!pr) { fail(label + ": probe " + d); continue; }
    if (!pr.agentFootPoint?.x) fail(label + ": probe " + d + " foot");
    if (!pr.expectedRelation) fail(label + ": probe " + d + " relation");
    if ((d === "north" || d === "south") && !["agent<prop","prop<agent"].includes(pr.expectedRelation))
      fail(label + ": " + d + " relation invalid");
  }

  if (!prop.sortAnchorRationale || prop.sortAnchorRationale.length < 50) fail(label + ": rationale");

  // ── TMX cross-check ──
  const tObj = tmxObjects.find(o => String(o.id) === String(prop.tmxId));
  if (!tObj) { fail(label + ": not found in TMX props"); continue; }
  if (tObj.name !== prop.tmxName) fail(label + ": TMX name=" + tObj.name + " != " + prop.tmxName);
  else pass(label + ": TMX name OK");
  const ox = Number(tObj.x), oy = Number(tObj.y), ow = Number(tObj.width), oh = Number(tObj.height);
  if (ox !== r.x) fail(label + ": TMX x=" + ox + " != " + r.x);
  if (oy !== r.y) fail(label + ": TMX y=" + oy + " != " + r.y);
  if (ow !== r.width) fail(label + ": TMX w=" + ow + " != " + r.width);
  if (oh !== r.height) fail(label + ": TMX h=" + oh + " != " + r.height);
  if (ox === r.x && oy === r.y && ow === r.width && oh === r.height) pass(label + ": TMX rect OK");
  const egid = 6033 + (prop.tmxId - 90);
  if (Number(tObj.gid) !== egid) fail(label + ": TMX gid=" + tObj.gid + " != " + egid);
  else pass(label + ": TMX gid OK");
}

// ═══ 4. Bounty-board matrix ═══
const bb = spec.props.find(p => p.tmxId === 92);
if (!bb) fail("bounty-board missing");
else {
  const m = bb.bountyBoardMatrix;
  if (!m) fail("matrix missing");
  else {
    if (!m.matrixCells?.north || !m.matrixCells?.south || !m.matrixCells?.west || !m.matrixCells?.east) fail("matrix cells");
    if (!m.behindBoundaryFront?.behind || !m.behindBoundaryFront?.boundary || !m.behindBoundaryFront?.front) fail("matrix b/b/f");
    if (!m.roles?.includes("lujunyi") || !m.roles?.includes("husanniang")) fail("roles");
    if (!m.mask58CrossReference || m.mask58CrossReference.maskId !== 58) fail("mask58");
    else pass("matrix complete");
    if (bb.tieBias !== -4) fail("tieBias must be -4, got " + bb.tieBias);
    else pass("tieBias=-4 OK");
    const bnd = m.behindBoundaryFront.boundary;
    if (bnd.lujunyiExpected !== "prop<agent") fail("boundary: expected prop<agent");
    else pass("boundary: prop<agent (deterministic tieBias)");
  }
}

// ═══ 5. Sort order ═══
function sortByKey(props) {
  return [...props].sort((a, b) => {
    if (a.fixedPointY !== b.fixedPointY) return a.fixedPointY - b.fixedPointY;
    if (a.tieBias !== b.tieBias) return a.tieBias - b.tieBias;
    const sa = a.stableId, sb = b.stableId;
    for (let i = 0; i < Math.min(sa.length, sb.length); i++)
      if (sa.charCodeAt(i) !== sb.charCodeAt(i)) return sa.charCodeAt(i) - sb.charCodeAt(i);
    return sa.length - sb.length;
  });
}
const computed = sortByKey(spec.props).map(p => p.stableId);
const declared = spec.globalConstraints.fivePropSortOrder.order;
let ok = true;
for (let i = 0; i < declared.length; i++) {
  if (declared[i] !== computed[i]) { fail("Sort[" + i + "]: " + declared[i] + " vs " + computed[i]); ok = false; }
}
if (ok) pass("Sort order matches");

function shuffle(arr, seed) {
  const a = [...arr]; let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const base = computed.join("|");
for (let s = 0; s < 10; s++) {
  if (sortByKey(shuffle(spec.props, s)).map(p => p.stableId).join("|") !== base)
    fail("Shuffle " + s);
}
pass("10-shuffle OK");

console.error("");
if (failures === 0) { console.error("ALL VERIFICATIONS PASSED"); process.exit(0); }
else { console.error(failures + " FAILURES"); process.exit(1); }
