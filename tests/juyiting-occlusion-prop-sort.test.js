/**
 * E8A Directed Tests: Five Prop Sort Specification (v3 fix)
 * Covers: completeness, stableId, asset provenance, anchor evidence,
 * 4-dir probes, bounty-board 14-cell matrix with tieBias=-4,
 * role invariance, sort order + tieBias determinism, fixedPoint,
 * TMX rect integrity, generationId, and MUTATION-BASED fail-closed tests.
 */
import { expect } from "chai";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = process.cwd();
const SPEC_PATH = join(REPO_ROOT, "tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json");
const CONTACT_SHEET_PATH = join(REPO_ROOT, "tests/fixtures/juyiting/occlusion-v1-props/contact-sheet.svg");
const VERIFIER = join(REPO_ROOT, "scripts/juyiting/verify-prop-sort-spec.mjs");
const TMX_PATH = join(REPO_ROOT, "public/juyiting/hall.tmx");

const spec = JSON.parse(readFileSync(SPEC_PATH, "utf-8"));

function assetPath(rel) { return join(REPO_ROOT, rel); }
function computeFixedPointY(y) { return Math.round(y * 256); }

function compareStableId(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return a.charCodeAt(i) - b.charCodeAt(i);
  return a.length - b.length;
}

function sortByWorldKey(props) {
  return [...props].sort((a, b) => {
    if (a.fixedPointY !== b.fixedPointY) return a.fixedPointY - b.fixedPointY;
    if (a.tieBias !== b.tieBias) return a.tieBias - b.tieBias;
    return compareStableId(a.stableId, b.stableId);
  });
}

const EXPECTED_TMX_IDS = [90, 91, 92, 93, 94];
const EXPECTED_ORDER = [
  "jyt.prop.center-north.roster-book.v1",
  "jyt.prop.center-north.main-seat.v1",
  "jyt.prop.northeast.bounty-board.v1",
  "jyt.prop.southeast.library-shelf.v1",
  "jyt.prop.southwest.agent-roster.v1",
];

const ZERO_ID = "0".repeat(64);

describe("E8A Prop Sort Spec (v3 fix)", () => {

  it("spec loads successfully", () => {
    expect(spec.propCount).to.equal(5);
    expect(spec.props).to.have.lengthOf(5);
  });

  describe("1. Completeness & identity", () => {
    it("covers all expected TMX ids", () => {
      expect(spec.props.map(p => p.tmxId).sort()).to.deep.equal(EXPECTED_TMX_IDS);
    });
    it("has no duplicate tmxId", () => {
      expect(new Set(spec.props.map(p => p.tmxId)).size).to.equal(5);
    });
    it("has required top-level fields", () => {
      expect(spec.sceneId).to.equal("juyiting-main");
      expect(spec.specVersion).to.equal(1);
      expect(spec.baseCommit).to.equal("7144d9260b3905ce0335d037d3b1a3589d3a88a1");
      expect(spec.taskId).to.equal("E8A");
    });
  });

  describe("2. stableId schema", () => {
    it("all stableIds match pattern and are unique", () => {
      const ids = spec.props.map(p => p.stableId);
      expect(new Set(ids).size).to.equal(5);
      for (const id of ids) expect(id).to.match(/^[a-z0-9][a-z0-9._-]{2,95}$/);
    });
    it("stableIds are pure ASCII", () => {
      for (const p of spec.props)
        for (let i = 0; i < p.stableId.length; i++)
          expect(p.stableId.charCodeAt(i)).to.be.lessThanOrEqual(127);
    });
  });

  describe("3. Asset provenance", () => {
    it("all 5 assets exist with matching sha256", () => {
      for (const p of spec.props) {
        const buf = readFileSync(assetPath(p.asset.path));
        const sha = createHash("sha256").update(buf).digest("hex");
        expect(sha, p.semanticName).to.equal(p.asset.sha256);
      }
    });
    it("bounty-board sha256 matches V0 frozen value", () => {
      const bb = spec.props.find(p => p.tmxId === 92);
      expect(bb.asset.sha256).to.equal("2e4c3e749119392b01a7301aaa8f40986a09e5cc731ab61105ed600a755b6252");
    });
  });

  describe("4. sortAnchor evidence", () => {
    it("all anchors within bounds; floor-standing at rect bottom, roster-book at Y=260", () => {
      for (const p of spec.props) {
        expect(p.sortAnchor.x, p.semanticName + " x").to.be.within(0, 1664);
        expect(p.sortAnchor.y, p.semanticName + " y").to.be.within(0, 928);
        if (p.tmxId === 94) {
          expect(p.sortAnchor.y, p.semanticName).to.equal(260);
          expect(p.sortAnchor.y).to.be.lessThan(p.tmxRect.maxY);
        } else {
          expect(p.sortAnchor.y, p.semanticName).to.equal(p.tmxRect.maxY);
        }
        const expectedX = p.tmxRect.x + Math.floor(p.tmxRect.width / 2);
        expect(Math.abs(p.sortAnchor.x - expectedX), p.semanticName + " center").to.be.lessThanOrEqual(1);
      }
    });
    it("all props have sortAnchorRationale with evidence (>=50 chars)", () => {
      for (const p of spec.props) {
        expect(p.sortAnchorRationale).to.be.a("string");
        expect(p.sortAnchorRationale.length, p.semanticName).to.be.greaterThan(50);
      }
    });
  });

  describe("5. Four-direction probes (strict)", () => {
    it("all 5 props have N/S/W/E probes with finite coords and relation", () => {
      for (const p of spec.props)
        for (const d of ["north","south","west","east"]) {
          const pr = p.probes[d];
          expect(pr, p.semanticName + "/" + d).to.be.an("object");
          expect(pr.agentFootPoint.x, p.semanticName + "/" + d + ".x").to.be.a("number").and.satisfy(Number.isFinite);
          expect(pr.agentFootPoint.y, p.semanticName + "/" + d + ".y").to.be.a("number").and.satisfy(Number.isFinite);
          expect(pr.expectedRelation, p.semanticName + "/" + d).to.be.a("string");
          expect(pr.rationale, p.semanticName + "/" + d).to.be.a("string");
        }
    });
    it("north: agent<prop (sort assertion), south: prop<agent (sort assertion)", () => {
      for (const p of spec.props) {
        expect(p.probes.north.expectedRelation).to.equal("agent<prop");
        expect(p.probes.north.agentFootPoint.y).to.be.lessThan(p.sortAnchor.y);
        expect(p.probes.south.expectedRelation).to.equal("prop<agent");
        expect(p.probes.south.agentFootPoint.y).to.be.greaterThan(p.sortAnchor.y);
      }
    });
    it("west/east: non-overlap (explicit)", () => {
      for (const p of spec.props) {
        expect(p.probes.west.expectedRelation).to.equal("non-overlap");
        expect(p.probes.east.expectedRelation).to.equal("non-overlap");
        expect(p.probes.west.pixelOverlap).to.be.false;
        expect(p.probes.east.pixelOverlap).to.be.false;
      }
    });
  });

  describe("6. Bounty-board 14-cell matrix + tieBias", () => {
    const bb = spec.props.find(p => p.tmxId === 92);
    it("has both roles", () => {
      expect(bb.bountyBoardMatrix.roles).to.include.members(["lujunyi","husanniang"]);
    });
    it("has 4 N/S/W/E cells + 3 behind/boundary/front cells (all 14 cells)", () => {
      const c = bb.bountyBoardMatrix.matrixCells;
      for (const d of ["north","south","west","east"]) {
        expect(c[d], d).to.be.an("object");
        expect(c[d].lujunyiExpected, d + "/lujunyi").to.be.a("string");
        expect(c[d].husanniangExpected, d + "/husanniang").to.be.a("string");
        expect(c[d].agentFoot.x, d + "/foot.x").to.satisfy(Number.isFinite);
        expect(c[d].agentFoot.y, d + "/foot.y").to.satisfy(Number.isFinite);
      }
      const bbf = bb.bountyBoardMatrix.behindBoundaryFront;
      for (const p of ["behind","boundary","front"]) {
        expect(bbf[p], "bbf/" + p).to.be.an("object");
        expect(bbf[p].lujunyiExpected, "bbf/" + p + "/lujunyi").to.be.a("string");
        expect(bbf[p].husanniangExpected, "bbf/" + p + "/husanniang").to.be.a("string");
        expect(bbf[p].agentFoot.x, "bbf/" + p + "/foot.x").to.satisfy(Number.isFinite);
        expect(bbf[p].agentFoot.y, "bbf/" + p + "/foot.y").to.satisfy(Number.isFinite);
      }
    });
    it("tieBias=-4 (deterministic table<agent at boundary)", () => {
      expect(bb.tieBias).to.equal(-4);
    });
    it("role invariance: same relation for both roles in all 14 cells", () => {
      for (const [d, c] of Object.entries(bb.bountyBoardMatrix.matrixCells))
        expect(c.lujunyiExpected, "matrix/" + d).to.equal(c.husanniangExpected);
      for (const [p, c] of Object.entries(bb.bountyBoardMatrix.behindBoundaryFront)) {
        if (p === "description" || p === "requiredFields") continue;
        expect(c.lujunyiExpected, "bbf/" + p).to.equal(c.husanniangExpected);
      }
    });
    it("boundary (y=379): prop<agent via tieBias=-4, NOT stableId", () => {
      const bnd = bb.bountyBoardMatrix.behindBoundaryFront.boundary;
      expect(bnd.agentFoot.y).to.equal(379);
      expect(bnd.agentFoot.y).to.equal(bb.sortAnchor.y);
      expect(bnd.lujunyiExpected).to.equal("prop<agent");
      expect(bnd.husanniangExpected).to.equal("prop<agent");
      expect(bnd.rationale).to.include("tieBias");
      expect(bnd.rationale).to.include("tieBias");
    });
    it("behind (y=370): agent<prop; front (y=420): prop<agent", () => {
      const bbf = bb.bountyBoardMatrix.behindBoundaryFront;
      expect(bbf.behind.agentFoot.y).to.be.lessThan(bb.sortAnchor.y);
      expect(bbf.behind.lujunyiExpected).to.equal("agent<prop");
      expect(bbf.front.agentFoot.y).to.be.greaterThan(bb.sortAnchor.y);
      expect(bbf.front.lujunyiExpected).to.equal("prop<agent");
    });
    it("mask58 cross-reference for E10A", () => {
      expect(bb.bountyBoardMatrix.mask58CrossReference.maskId).to.equal(58);
    });
    it("clean and UI-on modes documented with required fields", () => {
      const m = bb.bountyBoardMatrix;
      expect(m.cleanMode.requiredFields).to.include.members(["commit","tmxSha256","cameraZoom","cameraDpr","sortKey","agentFootWorld"]);
      expect(m.uiOnMode.requiredFields).to.include.members(["commit","tmxSha256","cameraZoom","cameraDpr","sortKey","agentFootWorld"]);
    });
  });

  describe("7. Sort order + tieBias determinism", () => {
    it("computed order matches declared EXPECTED_ORDER", () => {
      const computed = sortByWorldKey(spec.props).map(p => p.stableId);
      expect(computed).to.deep.equal(EXPECTED_ORDER);
    });
    it("10-shuffle produces identical sort order", () => {
      function shuffle(arr, seed) {
        const a = [...arr]; let s = seed;
        for (let i = a.length - 1; i > 0; i--) {
          s = (s * 1103515245 + 12345) & 0x7fffffff;
          const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      }
      const expected = EXPECTED_ORDER.join("|");
      for (let seed = 0; seed < 10; seed++) {
        const result = sortByWorldKey(shuffle(spec.props, seed)).map(p => p.stableId).join("|");
        expect(result, "seed " + seed).to.equal(expected);
      }
    });
    it("tieBias proof: table(-4) < agent(0) at same fixedPointY", () => {
      const a = { fixedPointY: 97024, tieBias: -4, stableId: "jyt.prop.northeast.bounty-board.v1" };
      const b = { fixedPointY: 97024, tieBias: 0, stableId: "jyt.agent.lujunyi.v1" };
      const sorted = sortByWorldKey([a, b]);
      expect(sorted[0].tieBias).to.equal(-4);
      expect(sorted[1].tieBias).to.equal(0);
    });
  });

  describe("8. Fixed-point Y consistency", () => {
    it("all fixedPointY = round(sortAnchor.y * 256)", () => {
      for (const p of spec.props)
        expect(p.fixedPointY, p.semanticName).to.equal(computeFixedPointY(p.sortAnchor.y));
    });
    it("all 5 fixedPointY values are distinct", () => {
      expect(new Set(spec.props.map(p => p.fixedPointY)).size).to.equal(5);
    });
    it("roster-book lowest (66560), agent-roster highest (188672)", () => {
      const sorted = sortByWorldKey(spec.props);
      expect(sorted[0].stableId).to.equal("jyt.prop.center-north.roster-book.v1");
      expect(sorted[4].stableId).to.equal("jyt.prop.southwest.agent-roster.v1");
    });
  });

  describe("9. Frozen field values", () => {
    it("all props: renderBand=world, sortMode=fixed, floorId=floor-1, elev=0, sceneId=juyiting-main; bounty-board tieBias=-4", () => {
      for (const p of spec.props) {
        expect(p.renderBand, p.semanticName).to.equal("world");
        expect(p.sortMode, p.semanticName).to.equal("fixed");
        expect(p.floorId, p.semanticName).to.equal("floor-1");
        expect(p.elevation, p.semanticName).to.equal(0);
        if (p.tmxId === 92) expect(p.tieBias, p.semanticName).to.equal(-4);
        else expect(p.tieBias, p.semanticName).to.equal(0);
        expect(p.sceneId, p.semanticName).to.equal("juyiting-main");
      }
    });
  });

  describe("10. TMX rect integrity", () => {
    it("all rects: maxX=x+width, maxY=y+height, matches asset dims", () => {
      for (const p of spec.props) {
        expect(p.tmxRect.maxX).to.equal(p.tmxRect.x + p.tmxRect.width);
        expect(p.tmxRect.maxY).to.equal(p.tmxRect.y + p.tmxRect.height);
        expect(p.tmxRect.width).to.equal(p.asset.width);
        expect(p.tmxRect.height).to.equal(p.asset.height);
      }
    });
  });

  describe("11. Generation ID (64-hex provisional-zero-id SHA-256)", () => {
    it("generationId is 64 hex chars", () => {
      expect(spec.generationId).to.match(/^[0-9a-f]{64}$/);
    });
    it("generationId can be recomputed (provisional-zero-id convention)", () => {
      const saved = spec.generationId;
      spec.generationId = ZERO_ID;
      const recomputed = createHash("sha256").update(JSON.stringify(spec, null, 2)).digest("hex");
      spec.generationId = saved;
      expect(recomputed).to.equal(saved);
    });
    it("contact-sheet.svg data-generation-id matches spec", () => {
      const svg = readFileSync(CONTACT_SHEET_PATH, "utf-8");
      const m = svg.match(/data-generation-id="([^"]+)"/);
      expect(m, "contact-sheet has data-generation-id").to.not.be.null;
      expect(m[1]).to.equal(spec.generationId);
    });
  });

  // ═══════════════════════════════════════════
  // 12. VERIFIER-INVOCATION MUTATION TESTS
  // ═══════════════════════════════════════════
  describe("12. Verifier-invocation mutation tests", () => {
    function cloneSpec() { return JSON.parse(JSON.stringify(spec)); }

    function runVerifierOnMutated(mutateFn, opts = {}) {
      const s = cloneSpec();
      mutateFn(s);
      const tmpSpecPath = join(tmpdir(), "e8a-prop-sort-mutated-" + Date.now() + "-" + Math.random().toString(36).slice(2,8) + ".json");
      writeFileSync(tmpSpecPath, JSON.stringify(s, null, 2));
      const tmxArg = opts.tmxPath ? " --tmx " + opts.tmxPath : "";
      try {
        execSync("node " + VERIFIER + " --spec " + tmpSpecPath + tmxArg, {
          cwd: REPO_ROOT,
          timeout: 10000,
          stdio: "pipe",
        });
        return 0;
      } catch (e) {
        return e.status || 1;
      } finally {
        try { unlinkSync(tmpSpecPath); } catch (_) {}
      }
    }

    function makeTmpTmx(mutateFn) {
      const orig = readFileSync(TMX_PATH, "utf-8");
      const mutated = mutateFn(orig);
      const p = join(tmpdir(), "e8a-tmx-mutated-" + Date.now() + ".tmx");
      writeFileSync(p, mutated);
      return p;
    }

    // Basic verifier identity
    it("baseline verifier passes on clean spec", () => {
      const r = execSync("node " + VERIFIER, { cwd: REPO_ROOT, timeout: 10000, stdio: "pipe" });
      expect(r.status).to.be.undefined; // execSync throws on non-zero
    });

    // Prop-level mutations
    it("rejects propCount=4 (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.propCount = 4; })).to.not.equal(0);
    });
    it("rejects props array length 4 (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props = s.props.slice(0, 4); })).to.not.equal(0);
    });
    it("rejects duplicate stableId (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props[1].stableId = s.props[0].stableId; })).to.not.equal(0);
    });
    it("rejects tmxId outside 90-94 (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props[0].tmxId = 99; })).to.not.equal(0);
    });
    it("rejects sortAnchor.x out of bounds (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props[0].sortAnchor.x = -1; })).to.not.equal(0);
    });
    it("rejects fixedPointY mismatch (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props[0].sortAnchor.y = 300; })).to.not.equal(0);
    });
    it("rejects mismatched asset sha256 (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props[0].asset.sha256 = "0".repeat(64); })).to.not.equal(0);
    });
    it("rejects elevation != 0 (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props[0].elevation = 1; })).to.not.equal(0);
    });
    it("rejects renderBand != world (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props[0].renderBand = "overhead"; })).to.not.equal(0);
    });
    it("rejects bounty-board missing matrix (verifier)", () => {
      expect(runVerifierOnMutated(s => { delete s.props.find(p => p.tmxId === 92).bountyBoardMatrix; })).to.not.equal(0);
    });
    it("rejects bounty-board tieBias=0 (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props.find(p => p.tmxId === 92).tieBias = 0; })).to.not.equal(0);
    });
    it("rejects tmxName mismatch (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props[0].tmxName = "wrong-name"; })).to.not.equal(0);
    });
    it("rejects tmxRect maxX mismatch (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props[0].tmxRect.maxX = 999; })).to.not.equal(0);
    });
    it("rejects missing sortAnchorRationale (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.props[0].sortAnchorRationale = ""; })).to.not.equal(0);
    });
    it("rejects baseCommit mismatch (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.baseCommit = "0000000"; })).to.not.equal(0);
    });
    it("rejects specVersion != 1 (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.specVersion = 2; })).to.not.equal(0);
    });

    // Generation ID mutation
    it("rejects generationId mismatch (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.generationId = "0".repeat(64); })).to.not.equal(0);
    });
    it("rejects generationId too short (verifier)", () => {
      expect(runVerifierOnMutated(s => { s.generationId = "abc123"; })).to.not.equal(0);
    });

    // Matrix expectation mutations
    it("rejects boundary lujunyiExpected=agent<prop (verifier)", () => {
      expect(runVerifierOnMutated(s => {
        s.props.find(p => p.tmxId === 92).bountyBoardMatrix.behindBoundaryFront.boundary.lujunyiExpected = "agent<prop";
      })).to.not.equal(0);
    });
    it("rejects matrix role invariance violation (verifier)", () => {
      expect(runVerifierOnMutated(s => {
        s.props.find(p => p.tmxId === 92).bountyBoardMatrix.matrixCells.north.husanniangExpected = "prop<agent";
      })).to.not.equal(0);
    });
    it("rejects missing mask58 xref (verifier)", () => {
      expect(runVerifierOnMutated(s => {
        delete s.props.find(p => p.tmxId === 92).bountyBoardMatrix.mask58CrossReference;
      })).to.not.equal(0);
    });

    // TMX-injection mutation tests
    it("rejects TMX with wrong prop object name (verifier)", () => {
      const tmxPath = makeTmpTmx(tmx => tmx.replace('name="main-seat-rect"', 'name="wrong-name"'));
      try {
        expect(runVerifierOnMutated(s => {}, { tmxPath })).to.not.equal(0);
      } finally { try { unlinkSync(tmxPath); } catch (_) {} }
    });
    it("rejects TMX with wrong prop rect (verifier)", () => {
      const tmxPath = makeTmpTmx(tmx => tmx.replace(/x="818" y="175"/, 'x="999" y="999"'));
      try {
        expect(runVerifierOnMutated(s => {}, { tmxPath })).to.not.equal(0);
      } finally { try { unlinkSync(tmxPath); } catch (_) {} }
    });
    it("rejects TMX with wrong prop gid (verifier)", () => {
      const tmxPath = makeTmpTmx(tmx => tmx.replace(/gid="6033"/, 'gid="9999"'));
      try {
        expect(runVerifierOnMutated(s => {}, { tmxPath })).to.not.equal(0);
      } finally { try { unlinkSync(tmxPath); } catch (_) {} }
    });
    it("rejects TMX with wrong tileset image source (verifier)", () => {
      const tmxPath = makeTmpTmx(tmx => tmx.replace('source="images/props/liangshan-hall-prop-main-seat-cropped.png"', 'source="wrong.png"'));
      try {
        expect(runVerifierOnMutated(s => {}, { tmxPath })).to.not.equal(0);
      } finally { try { unlinkSync(tmxPath); } catch (_) {} }
    });
    it("rejects TMX with wrong tileset image width (verifier)", () => {
      const tmxPath = makeTmpTmx(tmx => tmx.replace(/width="109" height="93"/, 'width="999" height="93"'));
      try {
        expect(runVerifierOnMutated(s => {}, { tmxPath })).to.not.equal(0);
      } finally { try { unlinkSync(tmxPath); } catch (_) {} }
    });
    it("rejects TMX with wrong map dimensions (verifier)", () => {
      const tmxPath = makeTmpTmx(tmx => tmx.replace(/width="104"/, 'width="999"'));
      try {
        expect(runVerifierOnMutated(s => {}, { tmxPath })).to.not.equal(0);
      } finally { try { unlinkSync(tmxPath); } catch (_) {} }
    });
    it("rejects TMX with missing hall-props tileset (verifier)", () => {
      const tmxPath = makeTmpTmx(tmx => tmx.replace('name="hall-props"', 'name="gone"'));
      try {
        expect(runVerifierOnMutated(s => {}, { tmxPath })).to.not.equal(0);
      } finally { try { unlinkSync(tmxPath); } catch (_) {} }
    });

    // Contact sheet mismatch
    it("rejects contact-sheet with wrong generation-id (verifier)", () => {
      // The verifier reads contact-sheet from default path and checks genId match.
      // To test, we mutate the spec genId, which will mismatch the real contact-sheet.
      expect(runVerifierOnMutated(s => { s.generationId = "f".repeat(64); })).to.not.equal(0);
    });
  });
});
