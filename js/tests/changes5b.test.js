// Phase 5b: valid plan, setup, failed units in links, 5 rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planValidity } from "../engine/describe.js";
import { expand, leafMatches } from "../engine/expand.js";
import { generate } from "../engine/generate.js";
import { rowsFor } from "../engine/plan.js";
import { progress } from "../engine/progress.js";
import { checkPlan } from "../engine/rules.js";
import { applySetup, choiceSummary, loadState, missingRequired } from "../state.js";
import { makeStore } from "../store.js";
import { decodePlan, encodePlan, parseRoute } from "../url.js";
import { catalogFor, loadJSON } from "./helpers.js";

const bsc = await catalogFor("science");
const be = await catalogFor("engineering-honours");
const CS_MATHS = { m: "computer-science-major", s: "mathematics-minor" };
const validity = (cat, choices, plan) => planValidity(cat, {
  progress: progress(cat, choices, plan), checks: checkPlan(cat, plan, choices), expanded: expand(cat, choices), plan,
});
const fakeStore = () => {
  const m = new Map();
  return { map: m, store: makeStore({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }) };
};

test("the suggested plan isn't valid: placeholders and short requirements", () => {
  const v = validity(bsc, CS_MATHS, generate(bsc, CS_MATHS));
  assert.equal(v.valid, false);
  assert.ok(v.placeholders.some((p) => p.startsWith("Elective ×")));
  assert.ok(v.requirements.includes("Major · Computer Science · Major selective: 0 of 6 credit points planned"));
  assert.ok(v.requirements.includes("The plan has 72 of 144 credit points"));
  assert.deepEqual(v.conflicts, []);
});

test("a complete plan with no conflicts is valid; a conflict makes it invalid", () => {
  // Fill each placeholder with the first 6 cp unit that fits its requirement
  // and leaves the plan without conflicts.
  const ex = expand(bsc, CS_MATHS);
  const plan = generate(bsc, CS_MATHS);
  const onPlan = () => new Set(plan.semesters.flat().filter((c) => c.code).map((c) => c.code));
  plan.semesters.forEach((sem, k) => sem.forEach((c, i) => {
    if (!c.ph) return;
    const leaf = ex.byId[c.ph];
    const fits = bsc.listUnits().find((u) => {
      if (u.cp !== 6 || onPlan().has(u.code) || !(leaf.fill || leafMatches(bsc, leaf, u.code))) return false;
      const trial = structuredClone(plan);
      trial.semesters[k][i] = { code: u.code, taken: false };
      return checkPlan(bsc, trial, CS_MATHS).cells.flat().every((x) => x.status !== "broken");
    });
    assert.ok(fits, `nothing fits ${c.ph} in semester ${k}`);
    sem[i] = { code: fits.code, taken: false };
  }));
  const v = validity(bsc, CS_MATHS, plan);
  assert.deepEqual([v.requirements, v.placeholders, v.overfull, v.conflicts], [[], [], [], []]);
  assert.equal(v.valid, true);
  // Swap INFO1110 (Y1 S1) with COMP2017 (Y2 S1): now COMP2017 comes too early.
  const bad = structuredClone(plan);
  [bad.semesters[0][0], bad.semesters[2][1]] = [bad.semesters[2][1], bad.semesters[0][0]];
  const w = validity(bsc, CS_MATHS, bad);
  assert.equal(w.valid, false);
  assert.ok(w.conflicts.some((c) => c.code === "COMP2017" && c.where === "2026 · S1"));
});

test("failed units are stored as x in links", () => {
  const p = decodePlan("INFO1110x,INFO1110!.COMP2017");
  assert.deepEqual(p.semesters[0], [{ code: "INFO1110", taken: false, failed: true }, { code: "INFO1110", taken: true }]);
  assert.equal(encodePlan(p), "INFO1110x,INFO1110!.COMP2017");
  assert.equal(decodePlan("INFO1110X"), null);
});

test("5 rows only for degrees with 0 cp units", () => {
  assert.equal(rowsFor(be), 5);
  assert.equal(rowsFor(bsc), 4);
  // BE's default plan now has the ENGP units as ordinary cells: 5 per semester.
  assert.deepEqual(generate(be, { st: "software-stream" }).semesters.map((s) => s.length), [5, 5, 5, 5, 5, 5, 5, 5]);
});

test("setup: missing choices, summary, and Continue", async () => {
  const { map, store } = fakeStore();
  const meta = { handbookYears: [2026] };
  const s = await loadState({ loadJSON, store, meta, route: parseRoute("#/science/2026/setup?m=computer-science-major") });
  assert.deepEqual(missingRequired(s), ["s"]);
  const hash = await applySetup(s, { year: 2026, choices: CS_MATHS }, { loadJSON, store });
  assert.equal(hash, "#/science/2026?m=computer-science-major&s=mathematics-minor");
  const t = await loadState({ loadJSON, store, meta, route: parseRoute(hash) });
  assert.deepEqual(missingRequired(t), []);
  assert.equal(choiceSummary(t), "Computer Science major · Mathematics minor");
  // A plan the user has edited keeps its taken units when the choices change.
  const own = await loadState({ loadJSON, store, meta, route: parseRoute("#/science/2026/setup?m=computer-science-major&s=mathematics-minor&p=INFO1110!.INFO1113!&v=1") });
  const h2 = await applySetup(own, { year: 2026, choices: { m: "computer-science-major", s: "mathematics-major" } }, { loadJSON, store });
  assert.ok(h2.includes("s=mathematics-major") && h2.includes("p=INFO1110!"), h2);
  assert.equal(map.size, 2);
});
