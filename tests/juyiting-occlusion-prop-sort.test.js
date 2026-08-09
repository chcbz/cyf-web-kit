/**
 * E8A Directed Tests: Five Prop Sort Specification
 */

import { expect } from "chai";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = process.cwd();
const SPEC_PATH = join(REPO_ROOT, "tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json");

// Load spec at module level (not in before hook)
const spec = JSON.parse(readFileSync(SPEC_PATH, "utf-8"));

function assetPath(rel) { return join(REPO_ROOT, rel); }
function computeFixedPointY(y) { return Math.round(y * 256); }

function compareStableId(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return a.charCodeAt(i) - b.charCodeAt(i);
  }
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

describe("E8A Prop Sort Spec", () => {

  it("spec loads successfully", () => {
    expect(spec.propCount).to.equal(5);
    expect(spec.props).to.have.lengthOf(5);
  });

  describe("1. Completeness", () => {
    it("covers all expected TMX ids", () => {
      const ids = spec.props.map(p => p.tmxId).sort((a,b) => a-b);
      expect(ids).to.deep.equal(EXPECTED_TMX_IDS);
    });
    it("has no duplicate tmxId", () => {
      expect(new Set(spec.props.map(p => p.tmxId)).size).to.equal(5);
    });
    it("has required top-level fields", () => {
      expect(spec.sceneId).to.equal("juyiting-main");
      expect(spec.specVersion).to.equal(1);
      expect(spec.baseCommit).to.have.lengthOf(40);
    });
  });

  describe("2. stableId schema", () => {
    const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,95}$/;
    it("all stableIds match pattern and are unique", () => {
      const ids = [];
      for (const p of spec.props) {
        expect(p.stableId).to.match(STABLE_ID_PATTERN);
        expect(p.stableId).to.match(/^jyt\.prop\./);
        expect(p.stableId).to.match(/\.v1$/);
        ids.push(p.stableId);
      }
      expect(new Set(ids).size).to.equal(5);
    });
    it("stableIds are pure ASCII", () => {
      for (const p of spec.props) {
        for (let i = 0; i < p.stableId.length; i++) {
          expect(p.stableId.charCodeAt(i)).to.be.lessThanOrEqual(127);
        }
      }
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
    it("all sortAnchors within bounds; floor-standing at rect bottom, roster-book at Y=260 (table contact)", () => {
      for (const p of spec.props) {
        expect(p.sortAnchor.x, p.semanticName + " x").to.be.within(0, 1664);
        expect(p.sortAnchor.y, p.semanticName + " y").to.be.within(0, 928);
        if (p.tmxId === 94) { expect(p.sortAnchor.y, p.semanticName).to.equal(260); expect(p.sortAnchor.y, p.semanticName).to.be.lessThan(p.tmxRect.maxY); } else { expect(p.sortAnchor.y, p.semanticName).to.equal(p.tmxRect.maxY); }
        const expectedX = p.tmxRect.x + Math.floor(p.tmxRect.width / 2);
        expect(Math.abs(p.sortAnchor.x - expectedX), p.semanticName + " center").to.be.lessThanOrEqual(1);
      }
    });
    it("all props have sortAnchorRationale with evidence", () => {
      for (const p of spec.props) {
        expect(p.sortAnchorRationale).to.be.a("string");
        expect(p.sortAnchorRationale.length).to.be.greaterThan(50);
      }
    });
  });

  describe("5. Four-direction probes", () => {
    it("all 5 props have N/S/W/E probes with required fields", () => {
      for (const p of spec.props) {
        for (const dir of ["north","south","west","east"]) {
          const probe = p.probes[dir];
          expect(probe, p.semanticName + " " + dir).to.be.an("object");
          expect(probe.agentFootPoint, p.semanticName + " " + dir + " foot").to.be.an("object");
          expect(probe.agentFootPoint.x).to.be.a("number");
          expect(probe.agentFootPoint.y).to.be.a("number");
          expect(probe.expectedRelation).to.be.a("string");
          expect(probe.rationale).to.be.a("string");
        }
      }
    });
    it("north probes assert agent<prop with agent above sortAnchor", () => {
      for (const p of spec.props) {
        expect(p.probes.north.expectedRelation).to.equal("agent<prop");
        expect(p.probes.north.agentFootPoint.y).to.be.lessThan(p.sortAnchor.y);
      }
    });
    it("south probes assert prop<agent with agent below sortAnchor", () => {
      for (const p of spec.props) {
        expect(p.probes.south.expectedRelation).to.equal("prop<agent");
        expect(p.probes.south.agentFootPoint.y).to.be.greaterThan(p.sortAnchor.y);
      }
    });
    it("west/east probes assert non-overlap", () => {
      for (const p of spec.props) {
        expect(p.probes.west.expectedRelation).to.equal("non-overlap");
        expect(p.probes.west.pixelOverlap).to.equal(false);
        expect(p.probes.east.expectedRelation).to.equal("non-overlap");
        expect(p.probes.east.pixelOverlap).to.equal(false);
      }
    });
  });

  describe("6. Bounty-board matrix", () => {
    const bb = spec.props.find(p => p.tmxId === 92);

    it("has both roles", () => {
      expect(bb.bountyBoardMatrix.roles).to.include("lujunyi");
      expect(bb.bountyBoardMatrix.roles).to.include("husanniang");
    });
    it("has 4 N/S/W/E cells + 3 behind/boundary/front cells", () => {
      const cells = bb.bountyBoardMatrix.matrixCells;
      expect(cells.north).to.be.an("object");
      expect(cells.south).to.be.an("object");
      expect(cells.west).to.be.an("object");
      expect(cells.east).to.be.an("object");
      const bbf = bb.bountyBoardMatrix.behindBoundaryFront;
      expect(bbf.behind).to.be.an("object");
      expect(bbf.boundary).to.be.an("object");
      expect(bbf.front).to.be.an("object");
    });
    it("north: both roles → agent<prop", () => {
      const n = bb.bountyBoardMatrix.matrixCells.north;
      expect(n.lujunyiExpected).to.equal("agent<prop");
      expect(n.husanniangExpected).to.equal("agent<prop");
    });
    it("south: both roles → prop<agent (V0 canonical)", () => {
      const s = bb.bountyBoardMatrix.matrixCells.south;
      expect(s.lujunyiExpected).to.equal("prop<agent");
      expect(s.husanniangExpected).to.equal("prop<agent");
    });
    it("role invariance: same relation for both roles in all positions", () => {
      for (const [dir, cell] of Object.entries(bb.bountyBoardMatrix.matrixCells)) {
        expect(cell.lujunyiExpected, dir).to.equal(cell.husanniangExpected);
      }
      for (const [pos, cell] of Object.entries(bb.bountyBoardMatrix.behindBoundaryFront)) {
        if (pos === "description" || pos === "requiredFields") continue;
        expect(cell.lujunyiExpected, pos).to.equal(cell.husanniangExpected);
      }
    });
    it("behind/boundary → agent<prop, front → prop<agent", () => {
      const bbf = bb.bountyBoardMatrix.behindBoundaryFront;
      expect(bbf.behind.agentFoot.y).to.be.lessThan(bb.sortAnchor.y);
      expect(bbf.behind.lujunyiExpected).to.equal("agent<prop");
      expect(bbf.boundary.agentFoot.y).to.equal(bb.sortAnchor.y);
      expect(bbf.front.agentFoot.y).to.be.greaterThan(bb.sortAnchor.y);
      expect(bbf.front.lujunyiExpected).to.equal("prop<agent");
    });
    it("mask58 cross-reference for E10A", () => {
      expect(bb.bountyBoardMatrix.mask58CrossReference.maskId).to.equal(58);
      expect(bb.bountyBoardMatrix.mask58CrossReference.action).to.equal("E10A_REQUIRED_REVIEW");
    });
    it("clean and UI-on modes documented with required fields", () => {
      expect(bb.bountyBoardMatrix.cleanMode.requiredFields).to.include("commit");
      expect(bb.bountyBoardMatrix.uiOnMode.requiredFields).to.include("commit");
    });
  });

  describe("7. Sort order determinism", () => {
    it("computed order matches declared EXPECTED_ORDER", () => {
      const computed = sortByWorldKey(spec.props).map(p => p.stableId);
      expect(computed).to.deep.equal(EXPECTED_ORDER);
    });
    it("10-shuffle produces identical sort order", () => {
      function shuffle(arr, seed) {
        const a = [...arr];
        let s = seed;
        for (let i = a.length - 1; i > 0; i--) {
          s = (s * 1103515245 + 12345) & 0x7fffffff;
          const j = s % (i + 1);
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      }
      const expected = EXPECTED_ORDER.join("|");
      for (let seed = 0; seed < 10; seed++) {
        const result = sortByWorldKey(shuffle(spec.props, seed)).map(p => p.stableId).join("|");
        expect(result, "seed " + seed).to.equal(expected);
      }
    });
    it("sort is ascending fixedPointY", () => {
      const sorted = sortByWorldKey(spec.props);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].fixedPointY).to.be.greaterThanOrEqual(sorted[i-1].fixedPointY);
      }
    });
  });

  describe("8. Fixed-point Y consistency", () => {
    it("all fixedPointY = round(sortAnchor.y × 256)", () => {
      for (const p of spec.props) {
        expect(p.fixedPointY, p.semanticName).to.equal(computeFixedPointY(p.sortAnchor.y));
      }
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
        if (p.tmxId === 92) { expect(p.tieBias, p.semanticName).to.equal(-4); } else { expect(p.tieBias, p.semanticName).to.equal(0); }
        expect(p.sceneId, p.semanticName).to.equal("juyiting-main");
      }
    });
  });

  describe("10. Fail-closed scenarios", () => {
    it("detects missing prop (<5 entries)", () => {
      expect(spec.props.length).to.equal(5);
    });
    it("detects duplicate stableId", () => {
      expect(new Set(spec.props.map(p => p.stableId)).size).to.equal(5);
    });
    it("detects anchor Y out of bounds", () => {
      for (const p of spec.props) {
        expect(p.sortAnchor.y).to.be.within(0, 928);
      }
    });
    it("TMX sha256 matches (fail-closed on TMX change)", () => {
      const tmxBuf = readFileSync(assetPath(spec.tmxSource.path));
      const tmxSha = createHash("sha256").update(tmxBuf).digest("hex");
      expect(tmxSha).to.equal(spec.tmxSource.sha256);
    });
    it("all 5 props found in TMX by id", () => {
      const tmxStr = readFileSync(assetPath(spec.tmxSource.path), "utf-8");
      for (const p of spec.props) {
        expect(tmxStr).to.include("object id=\"" + p.tmxId + "\"");
      }
    });
  });

  describe("11. TMX rect integrity", () => {
    it("all rects: maxX=x+width, maxY=y+height, matches asset dims", () => {
      for (const p of spec.props) {
        expect(p.tmxRect.maxX, p.semanticName).to.equal(p.tmxRect.x + p.tmxRect.width);
        expect(p.tmxRect.maxY, p.semanticName).to.equal(p.tmxRect.y + p.tmxRect.height);
        expect(p.tmxRect.width, p.semanticName).to.equal(p.asset.width);
        expect(p.tmxRect.height, p.semanticName).to.equal(p.asset.height);
      }
    });
  });

  // ═══════════════════════════════════════════
  // 12. VERIFIER-INVOCATION MUTATION TESTS
  // ═══════════════════════════════════════════
  describe("12. Verifier-invocation mutation tests", () => {
    function cloneSpec() { return JSON.parse(JSON.stringify(spec)); }

    function runVerifierOnMutated(mutateFn) {
      const s = cloneSpec();
      mutateFn(s);
      const tmpSpecPath = join(tmpdir(), "e8a-prop-sort-mutated-" + Date.now() + ".json");
      writeFileSync(tmpSpecPath, JSON.stringify(s, null, 2));
      try {
        execSync("node scripts/juyiting/verify-prop-sort-spec.mjs --spec " + tmpSpecPath, {
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
  });

});
