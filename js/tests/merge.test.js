import { test } from "node:test";
import assert from "node:assert/strict";
import { generate } from "../engine/generate.js";
import { mergePlan } from "../engine/merge.js";
import { MAX_SLOTS, PLACEHOLDER_CP, slotsUsed } from "../engine/plan.js";
import { encodePlan } from "../url.js";
import { catalogFor, planFrom } from "./helpers.js";

const bsc = await catalogFor("science");
const bcom = await catalogFor("commerce");
const CS_MATHS = { m: "computer-science-major", s: "mathematics-minor" };
const CS_MATHS_MAJ = { m: "computer-science-major", s: "mathematics-major" };
const FIN_ACC = { m: "finance-major", s: "accounting-minor" };
const FIN_ACC_MAJ = { m: "finance-major", s: "accounting-major" };

const allTaken = (plan) => ({ semesters: plan.semesters.map((s) => s.map((c) => (c.code ? { ...c, taken: true } : c))) });
const codes = (plan) => plan.semesters.flat().filter((c) => c.code).map((c) => c.code);
const count = (plan, id) => plan.semesters.flat().filter((c) => c.ph === id).length;
const cases = [
  [bsc, CS_MATHS, CS_MATHS_MAJ],
  [bcom, FIN_ACC, FIN_ACC_MAJ],
];

test("taken cells keep their place, nothing doubles, slots stay ≤ 4", () => {
  for (const [cat, from, to] of cases) {
    const old = allTaken(generate(cat, from));
    const merged = mergePlan(cat, old, generate(cat, to), to);
    old.semesters.forEach((sem, k) => {
      const keptTaken = merged.semesters[k].filter((c) => c.taken);
      assert.deepEqual(keptTaken, sem.filter((c) => c.taken), `semester ${k}`);
    });
    assert.equal(new Set(codes(merged)).size, codes(merged).length);
    for (const sem of merged.semesters) assert.ok(slotsUsed(cat, sem) <= MAX_SLOTS);
    for (const c of codes(generate(cat, to))) assert.ok(codes(merged).includes(c), c);
  }
});

test("nothing taken: same as the new default plan", () => {
  for (const [cat, from, to] of cases) {
    const fresh = generate(cat, to);
    const merged = mergePlan(cat, generate(cat, from), fresh, to);
    assert.equal(encodePlan(merged), encodePlan(fresh));
  }
});

test("a taken unit that covers a selective removes its placeholder", () => {
  const fresh = generate(bsc, CS_MATHS);
  assert.equal(count(fresh, "maj:v"), 1);
  const merged = mergePlan(bsc, planFrom("INFO1110!.INFO1113!....COMP3221!"), fresh, CS_MATHS);
  assert.equal(count(merged, "maj:v"), 0);
});

test("old units that only count as electives replace elective slots", () => {
  // DATA1001 and STAT2011 aren't in the default plan, so they take elective slots.
  const fresh = generate(bsc, CS_MATHS);
  const merged = mergePlan(bsc, planFrom("INFO1110!,DATA1001!,STAT2011!"), fresh, CS_MATHS);
  assert.equal(count(merged, "elec"), count(fresh, "elec") - 2);
  const cp = codes(merged).reduce((s, c) => s + bsc.unit(c).cp, 0)
    + PLACEHOLDER_CP * merged.semesters.flat().filter((c) => c.ph).length;
  assert.ok(cp <= bsc.course.totalCp, String(cp));
});

test("deterministic", () => {
  const old = allTaken(generate(bcom, FIN_ACC));
  assert.deepEqual(mergePlan(bcom, old, generate(bcom, FIN_ACC_MAJ), FIN_ACC_MAJ),
    mergePlan(bcom, old, generate(bcom, FIN_ACC_MAJ), FIN_ACC_MAJ));
});
