#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SaxesParser } from "saxes";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

function argVal(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i+1] : null; }
const SPEC_PATH = argVal("--spec") || join(REPO_ROOT, "tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json");
const TMX_OVERRIDE = argVal("--tmx") || null;

let failures = 0;
function fail(msg) { console.error("FAIL:", msg); failures++; }
function pass(msg) { console.error("PASS:", msg); }

// ── Load spec ──
let spec;
try { spec = JSON.parse(readFileSync(SPEC_PATH, "utf-8")); }
catch (e) { console.error("FATAL:", e.message); process.exit(1); }

// ═══ 1. Structural ═══
if (spec.propCount !== 5) fail("propCount"); else pass("propCount=5");
if (spec.props.length !== 5) fail("props.length"); else pass("props.length=5");
if (spec.sceneId !== "juyiting-main") fail("sceneId"); else pass("sceneId");
if (spec.specVersion !== 1) fail("specVersion must be 1, got " + spec.specVersion); else pass("specVersion=1");
if (spec.baseCommit !== "7144d9260b3905ce0335d037d3b1a3589d3a88a1") fail("baseCommit mismatch"); else pass("baseCommit verified");
if (typeof spec.sourceEpoch !== "number" || !Number.isSafeInteger(spec.sourceEpoch) || spec.sourceEpoch <= 0) fail("sourceEpoch missing or invalid: " + spec.sourceEpoch); else pass("sourceEpoch=" + spec.sourceEpoch);
const tmxIdCheck = spec.props.map(p => p.tmxId).sort((a,b)=>a-b).join(",");
if (tmxIdCheck !== "90,91,92,93,94") fail("tmxIds must be 90-94, got " + tmxIdCheck); else pass("tmxIds=90-94");

// ═══ 1b. Generation ID (provisional-zero-id SHA-256, 64 hex) ═══
const ZERO_ID = "0".repeat(64);
if (typeof spec.generationId !== "string" || spec.generationId.length !== 64 || !/^[0-9a-f]{64}$/.test(spec.generationId)) {
  fail("generationId must be 64-hex SHA-256, got " + String(spec.generationId).substring(0,20) + "...");
} else {
  const savedId = spec.generationId;
  spec.generationId = ZERO_ID;
  const recomputed = createHash("sha256").update(JSON.stringify(spec, null, 2)).digest("hex");
  spec.generationId = savedId;
  if (recomputed !== savedId) fail("generationId mismatch: saved " + savedId.substring(0,12) + " vs recomputed " + recomputed.substring(0,12));
  else pass("generationId: " + savedId.substring(0,12) + "... (64-hex verified)");
}

// ═══ 2. Structured TMX parse (tilesets, tiles, images, objects, map) ═══
const tmxPath = TMX_OVERRIDE || spec.tmxSource.path;
let tmxBuf, tmxSha;
try {
  tmxBuf = readFileSync(join(REPO_ROOT, tmxPath));
  tmxSha = createHash("sha256").update(tmxBuf).digest("hex");
} catch (e) { fail("TMX read: " + e.message); }

// Always verify TMX sha if using default path
if (!TMX_OVERRIDE && tmxSha) {
  if (tmxSha !== spec.tmxSource.sha256) fail("TMX sha256 mismatch");
  else pass("TMX sha256 OK");
}

const tmxData = { mapAttrs: null, tilesets: [], objects: [], objectgroupAttrs: null };
if (tmxBuf) {
  try {
    const parser = new SaxesParser({ xmlns: false, position: false });
    let inTileset = false, tsAttrs = null, tsTiles = [];
    let inTile = false, tileAttrs = null;
    let inObject = false, objAttrs = null;
    let inObjectgroup = false;

    parser.on("opentag", (tag) => {
      if (tag.name === "map") { tmxData.mapAttrs = { ...tag.attributes }; }
      if (tag.name === "tileset") { inTileset = true; tsAttrs = { ...tag.attributes }; tsTiles = []; }
      if (tag.name === "tile" && inTileset) { inTile = true; tileAttrs = { ...tag.attributes }; }
      if (tag.name === "image" && inTile) { tileAttrs.image = { ...tag.attributes }; }
      if (tag.name === "objectgroup") { inObjectgroup = true; tmxData.objectgroupAttrs = { ...tag.attributes }; }
      if (tag.name === "object" && tag.attributes.type === "prop") { inObject = true; objAttrs = { ...tag.attributes }; }
    });
    parser.on("closetag", (tag) => {
      if (tag.name === "tileset" && inTileset) { tmxData.tilesets.push({ attrs: tsAttrs, tiles: tsTiles }); inTileset = false; }
      if (tag.name === "tile" && inTile) { tsTiles.push(tileAttrs); inTile = false; }
      if (tag.name === "object" && inObject) { tmxData.objects.push(objAttrs); inObject = false; }
      if (tag.name === "objectgroup") { inObjectgroup = false; }
    });
    parser.write(tmxBuf.toString("utf-8")).close();
    pass("TMX parsed: " + tmxData.tilesets.length + " tilesets, " + tmxData.objects.length + " prop objects");
  } catch (e) { fail("TMX parse: " + e.message); }

  // Map dimension validation (no fallback)
  if (tmxData.mapAttrs) {
    const ma = tmxData.mapAttrs;
    const tw = Number(ma.tilewidth), th = Number(ma.tileheight);
    const mw = Number(ma.width), mh = Number(ma.height);
    if (!(Number.isFinite(tw) && tw > 0)) fail("TMX map tilewidth invalid: " + ma.tilewidth);
    if (!(Number.isFinite(th) && th > 0)) fail("TMX map tileheight invalid: " + ma.tileheight);
    if (!(Number.isFinite(mw) && mw > 0)) fail("TMX map width invalid: " + ma.width);
    if (!(Number.isFinite(mh) && mh > 0)) fail("TMX map height invalid: " + ma.height);
    if (tw > 0 && th > 0 && mw > 0 && mh > 0) {
      const pw = mw * tw, ph = mh * th;
      if (pw !== spec.tmxSource.coordinateWidth) fail("TMX map pixel-width=" + pw + " != spec coordinateWidth=" + spec.tmxSource.coordinateWidth);
      else pass("TMX map pixel-width OK: " + pw);
      if (ph !== spec.tmxSource.coordinateHeight) fail("TMX map pixel-height=" + ph + " != spec coordinateHeight=" + spec.tmxSource.coordinateHeight);
      else pass("TMX map pixel-height OK: " + ph);
    }
  } else { fail("TMX map element not found"); }

  // Tileset structural validation: find hall-props
  const propsTs = tmxData.tilesets.find(ts => ts.attrs.name === "hall-props");
  if (!propsTs) { fail("hall-props tileset not found"); }
  else {
    const firstgid = Number(propsTs.attrs.firstgid);
    if (!Number.isSafeInteger(firstgid) || firstgid < 1) fail("hall-props firstgid invalid: " + firstgid);
    else pass("hall-props firstgid=" + firstgid);

    // Build tile id -> gid -> image map
    const tileGidMap = new Map();
    for (const tile of propsTs.tiles) {
      const tid = Number(tile.id);
      const gid = firstgid + tid;
      tileGidMap.set(gid, {
        tileId: tid,
        imageSource: tile.image?.source || "",
        imageWidth: Number(tile.image?.width) || 0,
        imageHeight: Number(tile.image?.height) || 0,
      });
    }
    if (tileGidMap.size !== 5) fail("hall-props tile count=" + tileGidMap.size + " != 5");
    else pass("hall-props: 5 tiles");

    // Cross-validate each spec prop against TMX object + tileset tile
    for (const prop of spec.props) {
      const label = prop.semanticName + "/" + prop.tmxId;
      const tObj = tmxData.objects.find(o => String(o.id) === String(prop.tmxId));
      if (!tObj) { fail(label + ": not found in TMX prop objects"); continue; }

      // Object fields
      if (tObj.name !== prop.tmxName) fail(label + ": TMX name=" + tObj.name + " != spec " + prop.tmxName);
      else pass(label + ": TMX name OK");

      const ox = Number(tObj.x), oy = Number(tObj.y), ow = Number(tObj.width), oh = Number(tObj.height);
      const r = prop.tmxRect;
      if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(ow) || !Number.isFinite(oh))
        fail(label + ": TMX object has non-finite coords");
      else {
        if (ox !== r.x) fail(label + ": TMX x=" + ox + " != spec " + r.x);
        if (oy !== r.y) fail(label + ": TMX y=" + oy + " != spec " + r.y);
        if (ow !== r.width) fail(label + ": TMX w=" + ow + " != spec " + r.width);
        if (oh !== r.height) fail(label + ": TMX h=" + oh + " != spec " + r.height);
        if (ox === r.x && oy === r.y && ow === r.width && oh === r.height) pass(label + ": TMX rect OK");
      }

      // GID → tileset tile → image source/width/height cross-check
      const gid = Number(tObj.gid);
      if (!Number.isSafeInteger(gid)) fail(label + ": TMX gid not safe integer: " + tObj.gid);
      else {
        const tileInfo = tileGidMap.get(gid);
        if (!tileInfo) { fail(label + ": gid=" + gid + " not in hall-props tileset"); }
        else {
          // Compute expected tile id from tmxId
          const expectedTileId = prop.tmxId - 90;
          if (tileInfo.tileId !== expectedTileId) fail(label + ": tileset tile id=" + tileInfo.tileId + " != expected " + expectedTileId + " (tmxId-90)");
          else pass(label + ": gid=" + gid + " → tile id=" + tileInfo.tileId + " OK");

          // Image source basename should match asset path basename
          const assetBasename = prop.asset.path.split("/").pop();
          const tileBasename = tileInfo.imageSource.split("/").pop();
          if (assetBasename !== tileBasename) fail(label + ": tileset image=" + tileBasename + " != spec asset=" + assetBasename);
          else pass(label + ": tileset image matches asset");

          // Tile width/height should match asset width/height
          if (tileInfo.imageWidth !== prop.asset.width) fail(label + ": tileset image width=" + tileInfo.imageWidth + " != spec " + prop.asset.width);
          if (tileInfo.imageHeight !== prop.asset.height) fail(label + ": tileset image height=" + tileInfo.imageHeight + " != spec " + prop.asset.height);
          if (tileInfo.imageWidth === prop.asset.width && tileInfo.imageHeight === prop.asset.height)
            pass(label + ": tileset image dims OK " + tileInfo.imageWidth + "x" + tileInfo.imageHeight);
        }
      }
    }
  }
}

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
  if (!sa || typeof sa.x !== "number" || typeof sa.y !== "number" || !Number.isFinite(sa.x) || !Number.isFinite(sa.y))
    fail(label + ": sortAnchor missing or non-finite");
  else {
    if (sa.x < 0 || sa.x > CW) fail(label + ": anchor.x=" + sa.x + " OOB [0," + CW + "]");
    if (sa.y < 0 || sa.y > CH) fail(label + ": anchor.y=" + sa.y + " OOB [0," + CH + "]");
    if (sa.x >= 0 && sa.x <= CW && sa.y >= 0 && sa.y <= CH) pass(label + ": anchor(" + sa.x + "," + sa.y + ") in bounds");
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
    if (r.x + r.width !== r.maxX) fail(label + ": maxX inconsistent");
    if (r.y + r.height !== r.maxY) fail(label + ": maxY inconsistent");
  }

  // ═══ Probes (strict, no truthiness) ═══
  if (!prop.probes) fail(label + ": probes missing");
  else for (const d of ["north","south","west","east"]) {
    const pr = prop.probes[d];
    if (!pr) { fail(label + ": probe " + d + " missing"); continue; }
    if (typeof pr.agentFootPoint?.x !== "number" || !Number.isFinite(pr.agentFootPoint.x))
      fail(label + ": probe " + d + " agentFootPoint.x not finite (got " + pr.agentFootPoint?.x + ")");
    if (typeof pr.agentFootPoint?.y !== "number" || !Number.isFinite(pr.agentFootPoint.y))
      fail(label + ": probe " + d + " agentFootPoint.y not finite (got " + pr.agentFootPoint?.y + ")");
    if (!pr.expectedRelation) fail(label + ": probe " + d + " missing expectedRelation");
    if ((d === "north" || d === "south") && !["agent<prop","prop<agent"].includes(pr.expectedRelation))
      fail(label + ": " + d + " relation must be sort assertion, got " + pr.expectedRelation);
    if ((d === "west" || d === "east") && pr.expectedRelation !== "non-overlap")
      fail(label + ": " + d + " relation must be non-overlap, got " + pr.expectedRelation);
  }

  if (!prop.sortAnchorRationale || prop.sortAnchorRationale.length < 50) fail(label + ": rationale too short");
}

// ═══ 4. Bounty-board matrix (strengthened) ═══
const bb = spec.props.find(p => p.tmxId === 92);
if (!bb) fail("bounty-board (tmxId=92) missing");
else {
  const m = bb.bountyBoardMatrix;
  if (!m) fail("matrix missing");
  else {
    // 8 direction-role cells
    for (const d of ["north","south","west","east"]) {
      const cell = m.matrixCells?.[d];
      if (!cell) { fail("matrix cell " + d + " missing"); continue; }
      if (typeof cell.agentFoot?.x !== "number" || !Number.isFinite(cell.agentFoot.x)) fail("matrix " + d + " foot.x non-finite");
      if (typeof cell.agentFoot?.y !== "number" || !Number.isFinite(cell.agentFoot.y)) fail("matrix " + d + " foot.y non-finite");
      if (cell.lujunyiExpected !== cell.husanniangExpected) fail("matrix " + d + " role invariance violated");
      if (!cell.lujunyiExpected) fail("matrix " + d + " missing lujunyiExpected");
    }

    // 6 behind/boundary/front cells
    const bbf = m.behindBoundaryFront;
    if (!bbf) fail("behindBoundaryFront missing");
    else {
      for (const pos of ["behind","boundary","front"]) {
        const cell = bbf[pos];
        if (!cell) { fail("bbf " + pos + " missing"); continue; }
        if (typeof cell.agentFoot?.x !== "number" || !Number.isFinite(cell.agentFoot.x)) fail("bbf " + pos + " foot.x non-finite");
        if (typeof cell.agentFoot?.y !== "number" || !Number.isFinite(cell.agentFoot.y)) fail("bbf " + pos + " foot.y non-finite");
        if (cell.lujunyiExpected !== cell.husanniangExpected) fail("bbf " + pos + " role invariance violated");
        if (!cell.lujunyiExpected) fail("bbf " + pos + " missing lujunyiExpected");
      }

      // boundary MUST be prop<agent
      const bnd = bbf.boundary;
      if (bnd) {
        if (bnd.lujunyiExpected !== "prop<agent") fail("boundary lujunyiExpected must be prop<agent, got " + bnd.lujunyiExpected);
        if (bnd.husanniangExpected !== "prop<agent") fail("boundary husanniangExpected must be prop<agent, got " + bnd.husanniangExpected);
        if (bnd.lujunyiExpected === "prop<agent" && bnd.husanniangExpected === "prop<agent") pass("boundary: prop<agent (deterministic tieBias)");
      }
    }

    if (!m.roles?.includes("lujunyi") || !m.roles?.includes("husanniang")) fail("roles");
    if (!m.mask58CrossReference || m.mask58CrossReference.maskId !== 58) fail("mask58");
    else pass("matrix complete");
    if (bb.tieBias !== -4) fail("tieBias must be -4, got " + bb.tieBias);
    else pass("tieBias=-4 OK");
  }
}

// ═══ 5. Sort order & tieBias proof ═══
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
if (ok) pass("Sort order matches (WorldSortKey: fpY→tieBias→stableId)");

// tieBias proof: construct two objects at same fixedPointY
function tieBiasProof() {
  const tableBias = bb.tieBias; // -4
  const agentBias = 0;
  const a = { fixedPointY: bb.fixedPointY, tieBias: tableBias, stableId: "jyt.prop.northeast.bounty-board.v1" };
  const b = { fixedPointY: bb.fixedPointY, tieBias: agentBias, stableId: "jyt.agent.lujunyi.v1" };
  const sorted = sortByKey([a, b]);
  if (sorted[0].tieBias !== tableBias) fail("tieBias proof: table(-4) should sort before agent(0) at same fpY");
  else pass("tieBias proof: table(-4) < agent(0) at same fpY → table behind agent");
}
tieBiasProof();

// Shuffle
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
  if (sortByKey(shuffle(spec.props, s)).map(p => p.stableId).join("|") !== base) fail("Shuffle " + s);
}
pass("10-shuffle OK");

// ═══ 6. Contact sheet generation-id match ═══
try {
  const svgPath = join(REPO_ROOT, "tests/fixtures/juyiting/occlusion-v1-props/contact-sheet.svg");
  const svgContent = readFileSync(svgPath, "utf-8");
  const m = svgContent.match(/data-generation-id="([^"]+)"/);
  if (!m) fail("contact-sheet missing data-generation-id");
  else if (m[1] !== spec.generationId) fail("contact-sheet genId=" + m[1].substring(0,12) + " != spec genId=" + spec.generationId.substring(0,12));
  else pass("contact-sheet genId matches spec");
} catch (e) { fail("contact-sheet read: " + e.message); }

console.error("");
if (failures === 0) { console.error("ALL VERIFICATIONS PASSED"); process.exit(0); }
else { console.error(failures + " FAILURES"); process.exit(1); }
