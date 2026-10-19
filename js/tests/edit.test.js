import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addSemester, addUnit, removeCell, removeLastSemester, replacePlaceholder, toggleTaken, undoRemove,
} from "../engine/edit.js";
import { generate } from "../engine/generate.js";
import { MAX_SEMESTERS } from "../engine/plan.js";
import { progress } from "../engine/progress.js";
import { checkPlan } from "../engine/rules.js";
import { encodePlan } from "../url.js";
import { catalogFor, planFrom } from "./helpers.js";

const bsc = await catalogFor("science");
const be = await catalogFor("engineering-honours");
const CS_MATHS = { m: "computer-science-major", s: "mathematics-minor" };
const G = generate(bsc, CS_MATHS);
const G_COPY = structuredClone(G);
const unchanged = () => assert.deepEqual(G, G_COPY, "the input plan was changed");

test("toggle taken, and placeholders don't toggle", () => {
  const once = toggleTaken(G, 0, 0);
  assert.equal(once.semesters[0][0].taken, true);
  assert.equal(toggleTaken(once, 0, 0).semesters[0][0].taken, false);
  assert.deepEqual(toggleTaken(G, 0, 3), G); // ~ole
  unchanged();
});

test("remove and undo", () => {
  const { plan, removed } = removeCell(G, 2, 1);
  assert.deepEqual(removed, { s: 2, i: 1, cell: { code: "COMP2017", taken: false } });
  assert.ok(!encodePlan(plan).includes("COMP2017"));
  assert.deepEqual(undoRemove(plan, removed), G);
  unchanged();
});

test("undo into a semester that has filled up still puts the unit back", () => {
  const { plan, removed } = removeCell(G, 2, 1);
  const refilled = addUnit(bsc, plan, "DATA1001", { s: 2 }).plan;
  const back = undoRemove(refilled, removed);
  assert.equal(back.semesters[2][1].code, "COMP2017");
  assert.equal(back.semesters[2].length, 5);
  assert.deepEqual(checkPlan(bsc, back, CS_MATHS).overfull, [2]);
});

test("add and remove semesters", () => {
  const more = addSemester(G);
  assert.equal(more.semesters.length, 7);
  assert.equal(removeLastSemester(more).semesters.length, 6);
  assert.deepEqual(removeLastSemester(G), G); // last one isn't empty
  let p = { semesters: [] };
  for (let k = 0; k < MAX_SEMESTERS + 2; k++) p = addSemester(p);
  assert.equal(p.semesters.length, MAX_SEMESTERS);
  unchanged();
});

test("replace a placeholder", () => {
  assert.deepEqual(G.semesters[4][1], { ph: "maj:v" });
  const p = replacePlaceholder(G, 4, 1, "COMP3221");
  assert.deepEqual(p.semesters[4][1], { code: "COMP3221", taken: false });
  assert.equal(progress(bsc, CS_MATHS, p).nodes["maj:v"].plannedMet, true);
  assert.deepEqual(replacePlaceholder(G, 0, 0, "COMP3221"), G); // not a placeholder
  unchanged();
});

test("+ Unit on a full plan adds a semester", () => {
  const r = addUnit(bsc, G, "DATA1001");
  assert.equal(r.plan.semesters.length, 7);
  assert.deepEqual([r.s, r.i], [6, 0]);
  unchanged();
});

test("+ Unit respects the semester a unit runs in", () => {
  const r = addUnit(be, { semesters: [[], []] }, "SOFT3888"); // S2 only
  assert.deepEqual([r.s, r.i], [1, 0]);
});

test("a unit already on the plan is refused", () => {
  assert.equal(addUnit(bsc, G, "COMP2017").error, "COMP2017 is already in your plan (Year 2 · Semester 1).");
});

test("adding to a chosen semester", () => {
  const three = planFrom("INFO1110,MATH1061,MATH1062");
  const r = addUnit(bsc, three, "DATA1001", { s: 0 });
  assert.deepEqual([r.s, r.i], [0, 3]);
  assert.equal(addUnit(bsc, r.plan, "COMP2123", { s: 0 }).error, "Year 1 · Semester 1 is full.");
});

test("0 cp units don't need a slot", () => {
  const full = planFrom("INFO1110,MATH1061,MATH1062,ELEC1601");
  const r = addUnit(be, full, "ENGP1001", { s: 0 });
  assert.deepEqual([r.s, r.i], [0, 4]);
  assert.deepEqual(addUnit(be, full, "ENGP1002").s, 0);
});

test("unknown codes are placed without a session check", () => {
  const r = addUnit(bsc, planFrom("INFO1110"), "ZZZZ1234");
  assert.deepEqual([r.s, r.i], [0, 1]);
});

test("a completely full plan is refused", () => {
  const full = { semesters: Array.from({ length: MAX_SEMESTERS }, () => [1, 2, 3, 4].map((n) => ({ ph: `x${n}` }))) };
  assert.equal(addUnit(bsc, full, "DATA1001").error, "Your plan is full. Remove a unit first.");
});
