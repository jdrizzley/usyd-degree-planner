import { test } from "node:test";
import assert from "node:assert/strict";
import { generate } from "../engine/generate.js";
import { MAX_SLOTS, slotsUsed, yearOf } from "../engine/plan.js";
import { checkPlan } from "../engine/rules.js";
import { catalogFor } from "./helpers.js";

const bsc = await catalogFor("science");
const bcom = await catalogFor("commerce");
const be = await catalogFor("engineering-honours");

const cases = {
  science: {
    catalog: bsc,
    choices: { m: "computer-science-major", s: "mathematics-minor" },
    units: ["INFO1110", "INFO1113", "COMP2017", "COMP2022", "COMP2123", "COMP3027", "COMP3888",
      "MATH1061", "MATH1062", "MATH2021", "MATH2022", "MATH2023"],
    not: ["INFO1910", "COMP2823", "COMP3927", "COMP3988", "SCPU3001", "MATH1961"],
    // The brief writes "s:iv"; ids use the choice node id ("sec"), as in "maj:v".
    placeholders: { "maj:v": 1, "sec:iv": 1, ole: 1, elec: 9 },
    semesters: 6,
    slots: 24,
  },
  "engineering-honours": {
    catalog: be,
    choices: { st: "software-stream" },
    units: ["INFO1110", "MATH1061", "MATH1062", "ELEC1005", "ENGG2112", "ENGG3112", "ELEC4712", "ELEC4713",
      "ENGP1001", "ENGP1002", "ENGP1003", "ENGP2001", "ENGP2002", "ENGP2003", "ENGP3001", "ENGP3002",
      "INFO1113", "ELEC1601", "COMP2017", "COMP2123", "MATH2069", "INFO3616", "ISYS2110", "ISYS2120",
      "SOFT2201", "SOFT2412", "SOFT3202", "SOFT3888", "ELEC3609", "ELEC5618", "ELEC5619"],
    not: ["COMP2823", "INFO1910", "ENGG1810", "AMME4111", "AMME4112", "COMP2022"],
    placeholders: { "stream:c": 2, stream: 3, open: 4 },
    semesters: 8,
    slots: 32,
  },
  commerce: {
    catalog: bcom,
    choices: { m: "finance-major", s: "accounting-minor" },
    units: ["BUSS1000", "BUSS1020", "BUSS1030", "BUSS2000", "BUSS1040", "FINC2011", "FINC2012", "FINC3017",
      "FINC3600", "ACCT1006", "ACCT2011", "ACCT2019"],
    not: ["ACCT3011", "ACCT3600"],
    placeholders: { "maj:iv": 2, "sec:iii": 2, ole: 1, elec: 7 },
    semesters: 6,
    slots: 24,
  },
};

const flat = (plan) => plan.semesters.flat();
const where = (plan, code) => plan.semesters.findIndex((s) => s.some((c) => c.code === code));
const countPh = (plan) => flat(plan).filter((c) => c.ph).reduce((m, c) => ({ ...m, [c.ph]: (m[c.ph] ?? 0) + 1 }), {});

for (const [slug, x] of Object.entries(cases)) {
  test(`${slug}: picks, placeholders and shape`, () => {
    const plan = generate(x.catalog, x.choices);
    const codes = flat(plan).filter((c) => c.code).map((c) => c.code);
    assert.deepEqual([...codes].sort(), [...x.units].sort());
    for (const c of x.not) assert.ok(!codes.includes(c), c);
    assert.deepEqual(countPh(plan), x.placeholders);
    assert.equal(plan.semesters.length, x.semesters);
    assert.equal(plan.semesters.reduce((s, sem) => s + slotsUsed(x.catalog, sem), 0), x.slots);
    for (const sem of plan.semesters) assert.ok(slotsUsed(x.catalog, sem) <= MAX_SLOTS);
    assert.ok(flat(plan).every((c) => !c.taken));
  });

  test(`${slug}: generated plan has no broken cells`, () => {
    const plan = generate(x.catalog, x.choices);
    const res = checkPlan(x.catalog, plan, x.choices);
    const broken = res.cells.flatMap((sem, s) => sem.map((r, i) => [plan.semesters[s][i].code, r]))
      .filter(([, r]) => r.status === "broken");
    assert.deepEqual(broken, []);
    assert.deepEqual(res.overfull, []);
  });

  test(`${slug}: deterministic`, () => {
    assert.deepEqual(generate(x.catalog, x.choices), generate(x.catalog, x.choices));
  });
}

test("placement facts", () => {
  const c = generate(bcom, cases.commerce.choices);
  assert.equal(where(c, "FINC3600"), 5); // Year 3 S2: needs 112 cp before it
  const e = generate(be, cases["engineering-honours"].choices);
  assert.equal(yearOf(where(e, "ELEC5618")), 4);
  assert.equal(yearOf(where(e, "ELEC5619")), 4);
  const engp = ["ENGP1001", "ENGP1002", "ENGP1003", "ENGP2001", "ENGP2002", "ENGP2003", "ENGP3001", "ENGP3002"];
  const at = engp.map((u) => where(e, u));
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  assert.equal(new Set(at).size, 8, "one ENGP unit per semester");
  const s = generate(bsc, cases.science.choices);
  assert.equal(where(s, "COMP2017"), where(s, "COMP2123")); // corequisites together
});

test("an unpicked choice still generates", () => {
  const plan = generate(bsc, { m: "computer-science-major" });
  const codes = flat(plan).filter((c) => c.code).map((c) => c.code);
  assert.ok(!codes.some((c) => c.startsWith("MATH2")), "no minor units");
  assert.ok(countPh(plan).elec > 9);
  assert.equal(plan.semesters.length, 6);
  assert.deepEqual(checkPlan(bsc, plan).cells.flat().filter((r) => r.status === "broken"), []);
});

test("a course defaultPlan overrides generation", () => {
  const fake = { ...bsc, course: { ...bsc.course, defaultPlan: "INFO1110.INFO1113" } };
  assert.deepEqual(generate(fake, {}), { semesters: [[{ code: "INFO1110", taken: false }], [{ code: "INFO1113", taken: false }]] });
});
