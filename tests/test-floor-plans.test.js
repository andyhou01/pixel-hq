const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function runTests() {
  console.log("=== Running Floor Plan Tests ===");
  const fp = await import(pathToFileURL(path.resolve(__dirname, "../mods/company-agents/floorplan.js")).href);

  // Orchestrator t1 started four workers; t9 works alone; t1g is a worker's own helper;
  // t7's parent sits on another floor, so t7 leads here.
  const parents = new Map([["t1b", "t1"], ["t1c", "t1"], ["t1d", "t1"], ["t1f", "t1"], ["t1g", "t1c"], ["t7", "t-elsewhere"]]);
  const teams = fp.floorTeams(["t1", "t1b", "t1c", "t1d", "t1f", "t1g", "t7", "t9"], parents);
  assert.deepStrictEqual(teams, [
    { lead: "t1", team: ["t1b", "t1c", "t1d", "t1f", "t1g"] },
    { lead: "t7", team: [] },
    { lead: "t9", team: [] },
  ]);
  console.log("PASS: floorTeams groups desks under their topmost lead on the floor");

  const crew = [{ lead: "L", team: ["a", "b", "c", "d"] }, { lead: "s", team: [] }];
  const rows = (plan, cols) => fp.planRows(plan, crew, cols).rows;
  assert.strictEqual(fp.planRows("cubicles", crew, 2), null);
  assert.deepStrictEqual(rows("boardroom", 2), [["L"], ["a", "b"], ["c", "d"], ["s"]]);
  assert.deepStrictEqual(rows("pod", 2), [["a", "b"], ["L"], ["c", "d"], ["s"]]);
  assert.deepStrictEqual(rows("corner-office", 2), [["L", "a"], [null, "b"], [null, "c"], [null, "d"], ["s"]]);
  assert.deepStrictEqual(rows("corner-office", 3), [["L", "a", "c"], [null, "b", "d"], ["s"]]);
  assert.deepStrictEqual(rows("standup", 3), [["L"], ["a"], ["b"], ["c"], ["d"], ["s"]]);
  assert.deepStrictEqual(rows("open-plan", 3), [["L", "a", "b"], ["c", "d", "s"]]);
  console.log("PASS: planRows seats a lead and team for every plan");

  const spots = fp.planSpots(fp.planRows("boardroom", [{ lead: "L", team: ["a", "b", "c"] }], 2));
  assert.deepStrictEqual(spots.get("L"), [0.5, 0]);
  assert.deepStrictEqual(spots.get("a"), [0.25, 0.5]);
  assert.deepStrictEqual(spots.get("c"), [0.5, 1]);
  console.log("PASS: planSpots centres short rows and spreads rows top to bottom");

  // Cubicles keep the office's original staggered grid.
  assert.deepStrictEqual(fp.cubicleSpot(1, 2, 2), [0.75, 0.12 / 1.12]);
  assert.deepStrictEqual(fp.cubicleSpot(4, 2, 3), [0.25, 1]);
  console.log("PASS: cubicleSpot keeps the staggered grid");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
