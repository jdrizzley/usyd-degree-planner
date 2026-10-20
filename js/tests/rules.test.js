import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPlan, describe, prereqsOf, unlocks } from "../engine/rules.js";
import { catalogFor, planFrom } from "./helpers.js";

const bsc = await catalogFor("science");
const bcom = await catalogFor("commerce");
const be = await catalogFor("engineering-honours");

// Result for the first cell with this code.
function cell(catalog, text, code, choices) {
  const plan = planFrom(text);
  const res = checkPlan(catalog, plan, choices);
  for (const [s, sem] of plan.semesters.entries()) {
    const i = sem.findIndex((c) => c.code === code);
    if (i !== -1) return res.cells[s][i];
  }
  throw new Error(`${code} not in plan`);
}
const ph = (n) => Array.from({ length: n }, () => "~elec");
// n cells spread over semesters of 4, as a plan prefix ending in "."
const before = (cells) => {
  const sems = [];
  for (let i = 0; i < cells.length; i += 4) sems.push(cells.slice(i, i + 4).join(","));
  return sems;
};

test("a valid chain is all ok", () => {
  const res = checkPlan(bsc, planFrom("INFO1110.INFO1113.COMP2017,COMP2123"));
  assert.deepEqual(res.cells.flat().map((r) => r.status), ["ok", "ok", "ok", "ok"]);
  assert.deepEqual(res.overfull, []);
});

test("missing prerequisite and corequisite", () => {
  const r = cell(bsc, "COMP2017", "COMP2017");
  assert.equal(r.status, "broken");
  assert.ok(r.reasons.includes("Needs INFO1113 or INFO1105 or INFO1905 or INFO1103 in an earlier semester"), r.reasons);
  assert.ok(r.reasons.some((x) => x.includes("COMP2123") && x.includes("same or an earlier semester")), r.reasons);
});

test("offered in the other semester only", () => {
  const r = cell(bsc, "INFO1113.COMP2123,COMP2017", "COMP2017");
  assert.deepEqual(r.reasons, ["Usually only offered in Semester 1"]);
});

test("prohibited pair: both broken", () => {
  const res = checkPlan(bsc, planFrom("INFO1110.COMP2123,COMP2823"));
  const [a, b] = res.cells[1];
  assert.ok(a.reasons.includes("Can't be taken with COMP2823"), a.reasons);
  assert.ok(b.reasons.includes("Can't be taken with COMP2123"), b.reasons);
});

test("credit points from a pattern", () => {
  const r = cell(bsc, "MATH2021.....MATH3061", "MATH3061");
  assert.equal(r.status, "broken");
  assert.ok(r.reasons.some((x) => x.includes("12 credit points of MATH2XXX") && x.includes("(has 6)")), r.reasons);
  assert.equal(cell(bsc, "MATH2021,MATH2022.....MATH3061", "MATH3061").status, "ok");
});

test("credit points count units and placeholders", () => {
  const cells16 = ["INFO1110", "MATH1061", ...ph(14)];
  assert.equal(cell(bsc, [...before(cells16), "SCPU3001,COMP3888"].join("."), "SCPU3001").status, "ok");
  const r = cell(bsc, [...before(cells16.slice(0, 15)), "SCPU3001,COMP3888"].join("."), "SCPU3001");
  assert.equal(r.status, "broken");
  assert.ok(r.reasons.includes("Needs 96 credit points before this semester (has 90)"), r.reasons);
});

test("corequisite in the same semester, not a later one", () => {
  const early = before(["FINC2011", "FINC2012", ...ph(17)]); // 5 semesters, 114 cp
  assert.equal(cell(bcom, [...early, "FINC3600,FINC3017"].join("."), "FINC3600").status, "ok");
  const r = cell(bcom, [...early, "FINC3600", "FINC3017"].join("."), "FINC3600");
  assert.deepEqual(r.reasons, ["Needs FINC3017 in the same or an earlier semester"]);
});

test("not offered recently", () => {
  const old = cell(bsc, "COMP3109", "COMP3109");
  assert.ok(old.reasons.includes("Not offered recently (last ran 2020)"), old.reasons);
});

test("no offering data means no offering reason", () => {
  assert.equal(bcom.unit("BUSS1000").sessions, null);
  assert.deepEqual(cell(bcom, ".BUSS1000", "BUSS1000").reasons, []);
});

test("unknown codes don't throw", () => {
  const r = cell(bsc, "ZZZZ1234.INFO1110", "ZZZZ1234");
  assert.equal(r.status, "unknown");
  assert.deepEqual(r.reasons, ["Not in the 2026 unit list"]);
  assert.deepEqual(prereqsOf(bsc, planFrom("ZZZZ1234"), 0, 0), []);
  assert.deepEqual(unlocks(bsc, planFrom("ZZZZ1234"), 0, 0), []);
});

test("text in a rule becomes a note, not a block", () => {
  const r = cell(bsc, "INFO1110..COMP2823", "COMP2823");
  assert.equal(r.status, "ok");
  assert.ok(r.notes.some((n) => n.startsWith("Distinction level results in")), r.notes);
  assert.ok(cell(bsc, "INFO1110.INFO1113.COMP2017,COMP2123", "COMP2017").notes.some((n) => n.startsWith("Assumed knowledge:")));
});

test("ambiguous rules are not enforced", () => {
  const raw = "INFO1110 or INFO1910 and INFO1113";
  const fake = {
    ...bsc,
    unit: (c) => (c === "TEST1001"
      ? { code: c, name: "Test", cp: 6, level: 1000, sessions: ["S1", "S2"], last: 2026,
          rules: { prerequisites: { raw, parsed: { op: "or", ambiguous: true, args: [
            { unit: "INFO1110" }, { op: "and", args: [{ unit: "INFO1910" }, { unit: "INFO1113" }] }] } } } }
      : bsc.unit(c)),
  };
  const r = cell(fake, "TEST1001", "TEST1001");
  assert.equal(r.status, "ok");
  assert.deepEqual(r.notes, [`Also: ${raw}`]);
});

test("duplicates: only the later copy is flagged", () => {
  const res = checkPlan(bsc, planFrom("INFO1110.INFO1110"));
  assert.deepEqual(res.cells[0][0].reasons, []);
  assert.deepEqual(res.cells[1][0].reasons, ["Already in your plan in Year 1 · Semester 1"]);
});

test("BE gets a 5th row, only for 0 cp units", () => {
  assert.deepEqual(checkPlan(be, planFrom("INFO1110,MATH1061,MATH1062,ELEC1005,ENGP1001")).overfull, []);
  assert.deepEqual(checkPlan(be, planFrom("INFO1110,MATH1061,MATH1062,ELEC1005,ENGP1001,ENGP1002")).overfull, [0]);
  assert.deepEqual(checkPlan(be, planFrom("INFO1110,MATH1061,MATH1062,ELEC1005,ENGG2112")).overfull, [0]);
});

test("except: excluded units don't count", () => {
  assert.equal(cell(be, "MATH1061..MATH2069", "MATH2069").status, "ok");
  const r = cell(be, "MATH1050..MATH2069", "MATH2069");
  assert.equal(r.status, "broken");
  assert.ok(r.reasons[0].includes("not counting MATH1XX5, MATH1050 or MATH1111"), r.reasons);
});

test("placeholders count for level rules when their requirement is all at that level", () => {
  const choices = { st: "software-stream" };
  const thirdYear = "ENGG3112,INFO3616,SOFT3202,SOFT3888,ELEC3609";
  const plan = `${thirdYear}.~stream:c.ELEC4712`;
  assert.equal(cell(be, plan, "ELEC4712", choices).status, "ok");
  const r = cell(be, `${thirdYear}.~open.ELEC4712`, "ELEC4712", choices);
  assert.ok(r.reasons.includes("Needs 36 credit points of 3000-level or above units before this semester (has 30)"), r.reasons);
});

test("hover relations", () => {
  const plan = planFrom("INFO1110.INFO1113.COMP2017,COMP2123.COMP2022..COMP3888");
  const at = (list) => list.map(({ s, i }) => plan.semesters[s][i].code).sort();
  assert.deepEqual(at(prereqsOf(bsc, plan, 5, 0)), ["COMP2017", "COMP2022", "COMP2123", "INFO1110", "INFO1113"]);
  const later = at(unlocks(bsc, plan, 1, 0));
  assert.ok(later.includes("COMP2017") && later.includes("COMP3888"), later);
  assert.ok(!later.includes("INFO1110"));
  // COMP2017's corequisite COMP2123 sits in the same semester.
  assert.deepEqual(at(prereqsOf(bsc, plan, 2, 0)), ["COMP2123", "INFO1113"]);
  assert.deepEqual(prereqsOf(bsc, planFrom("~elec"), 0, 0), []);
});

test("describe", () => {
  const or = (n) => ({ op: "or", args: Array.from({ length: n }, (_, i) => ({ unit: `COMP200${i}` })) });
  assert.equal(describe(or(7)), "COMP2000 or COMP2001 or COMP2002 or COMP2003 or 3 others");
  assert.equal(describe(or(5)), "COMP2000 or COMP2001 or COMP2002 or COMP2003 or COMP2004");
  assert.equal(describe({ op: "and", args: [{ unit: "A" }, { op: "or", args: [{ unit: "B" }, { unit: "C" }] }] }), "A and (B or C)");
  assert.equal(describe({ cp: 18, minLevel: 2000, prefixes: ["SOFT", "COMP", "INFO"] }),
    "18 credit points of 2000-level or above SOFT, COMP or INFO units");
  assert.equal(describe({ cp: 48 }), "48 credit points");
});
