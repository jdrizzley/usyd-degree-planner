import { test } from "node:test";
import assert from "node:assert/strict";
import { generate } from "../engine/generate.js";
import { progress } from "../engine/progress.js";
import { catalogFor, planFrom } from "./helpers.js";

const bsc = await catalogFor("science");
const bcom = await catalogFor("commerce");
const be = await catalogFor("engineering-honours");
const CS_MATHS = { m: "computer-science-major", s: "mathematics-minor" };
// Taken units, 4 to a semester.
const taken = (codes) => {
  const cells = codes.map((c) => `${c}!`);
  const sems = [];
  for (let i = 0; i < cells.length; i += 4) sems.push(cells.slice(i, i + 4).join(","));
  return planFrom(sems.join("."));
};
const STREAM_CORE = ["INFO1113", "ELEC1601", "COMP2017", "COMP2123", "MATH2069", "INFO3616", "ISYS2110", "ISYS2120",
  "SOFT2201", "SOFT2412", "SOFT3202", "SOFT3888", "ELEC3609", "ELEC5618", "ELEC5619"];

test("nothing chosen, nothing taken", () => {
  const p = progress(bsc, {}, { semesters: [] });
  assert.equal(p.takenCp, 0);
  assert.equal(p.plannedCp, 0);
  assert.equal(p.requiredCp, 144);
  assert.deepEqual(p.missingChoices, ["m", "s"]);
  assert.equal(p.complete, false);
  assert.equal(p.nodes.maj.met, false);
});

test("degree core shares units with the major", () => {
  const p = progress(bsc, CS_MATHS, taken(["INFO1110", "INFO1113"]));
  assert.equal(p.takenCp, 12);
  assert.ok(p.nodes["core-ii"].met);
  assert.ok(p.nodes["maj:i"].met);
  assert.deepEqual(p.nodes["maj:i"].units, ["INFO1110", "INFO1113"]);
});

test("degree core shares units with the minor", () => {
  const p = progress(bsc, CS_MATHS, taken(["INFO1110", "INFO1113", "MATH1061", "MATH1062"]));
  assert.ok(p.nodes["core-i"].met);
  assert.ok(p.nodes["sec:i"].met);
  assert.ok(p.nodes.core.met);
});

test("a core unit counts as core, not as a selective", () => {
  const p = progress(bsc, CS_MATHS, taken(["COMP3027"]));
  assert.deepEqual(p.nodes["maj:iii"].units, ["COMP3027"]);
  assert.deepEqual(p.nodes["maj:v"].units, []);
});

test("elective credit points depend on the choices", () => {
  assert.equal(progress(bsc, CS_MATHS).nodes.elec.needCp, 54);
  assert.equal(progress(bsc, { m: "computer-science-major", s: "mathematics-major" }).nodes.elec.needCp, 42);
  assert.equal(progress(be, { st: "software-stream" }).nodes.open.needCp, 24);
});

test("stream electives fill to maxCp, then the rest is open electives", () => {
  const extra = ["ELEC3104", "ELEC3203", "ELEC3204", "ELEC3206", "ELEC3304", "ELEC3305"];
  const p = progress(be, { st: "software-stream" }, taken([...STREAM_CORE, ...extra]));
  assert.equal(p.nodes["stream:a"].cp, 90);
  assert.equal(p.nodes["stream:c"].cp, 30);
  assert.ok(p.nodes.stream.met);
  assert.equal(p.nodes.stream.cp, 120);
  assert.equal(p.nodes.open.cp, 6);
  assert.equal(p.nodes.open.units.length, 1);
});

test("commerce core shares with the major", () => {
  const p = progress(bcom, { m: "finance-major", s: "accounting-minor" }, taken(["BUSS1020"]));
  assert.deepEqual(p.nodes.core.units, ["BUSS1020"]);
  assert.deepEqual(p.nodes["maj:i"].units, ["BUSS1020"]);
});

test("planned units count separately from taken ones", () => {
  const p = progress(bsc, CS_MATHS, planFrom("INFO1110!,INFO1113.~elec"));
  assert.equal(p.takenCp, 6);
  assert.equal(p.plannedCp, 6);
  assert.equal(p.nodes["maj:i"].met, false);
  assert.equal(p.nodes["maj:i"].plannedMet, true);
  assert.deepEqual(p.nodes["maj:i"].plannedUnits, ["INFO1110", "INFO1113"]);
  // A unit twice counts once.
  assert.equal(progress(bsc, CS_MATHS, planFrom("INFO1110!.INFO1110!,INFO1110")).takenCp, 6);
});

test("same subject twice gives a warning", () => {
  const p = progress(bsc, { m: "computer-science-major", s: "computer-science-minor" });
  assert.deepEqual(p.warnings, ["Pick a different subject for your second major or minor."]);
  assert.deepEqual(progress(bsc, CS_MATHS).warnings, []);
});

test("taking every unit of a generated plan meets every units requirement", () => {
  for (const [cat, choices] of [[bcom, { m: "finance-major", s: "accounting-minor" }], [be, { st: "software-stream" }]]) {
    const plan = generate(cat, choices);
    for (const sem of plan.semesters) for (const c of sem) if (c.code) c.taken = true;
    const p = progress(cat, choices, plan);
    const unitsLeaves = Object.keys(p.nodes).filter((id) => {
      const find = (n) => (n.id === id ? n : n.children?.map(find).find(Boolean));
      return find(p.tree)?.type === "units";
    });
    assert.ok(unitsLeaves.length > 0);
    for (const id of unitsLeaves) assert.ok(p.nodes[id].met, `${cat.course.slug} ${id}`);
  }
});

test("a complete degree is complete", () => {
  // BSc CS + Maths minor: generated units, with placeholders swapped for real units.
  const fills = { "maj:v": ["COMP3221"], "sec:iv": ["MATH3061"], ole: ["OLES2617"],
    elec: ["DATA1001", "MATH2088", "MATH3066", "COMP3308", "COMP3419", "COMP3520", "MATH3888", "MATH3063", "MATH3078"] };
  const plan = generate(bsc, CS_MATHS);
  for (const sem of plan.semesters) {
    sem.forEach((c, i) => { sem[i] = c.ph ? { code: fills[c.ph].shift(), taken: true } : { ...c, taken: true }; });
  }
  const p = progress(bsc, CS_MATHS, plan);
  assert.equal(p.takenCp, 144);
  assert.ok(p.complete, JSON.stringify(Object.entries(p.nodes).filter(([, n]) => !n.met)));
});
