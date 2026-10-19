import { test } from "node:test";
import assert from "node:assert/strict";
import { describePool, requirementRows } from "../engine/describe.js";
import { expand } from "../engine/expand.js";
import { generate } from "../engine/generate.js";
import { progress } from "../engine/progress.js";
import { catalogFor } from "./helpers.js";

const bsc = await catalogFor("science");
const bcom = await catalogFor("commerce");
const be = await catalogFor("engineering-honours");
const CS_MATHS = { m: "computer-science-major", s: "mathematics-minor" };
const FIN_ACC = { m: "finance-major", s: "accounting-minor" };
const SOFT = { st: "software-stream" };

const rowsFor = (cat, choices, plan = generate(cat, choices)) => requirementRows(cat, progress(cat, choices, plan));
const flat = (cards) => cards.flatMap((c) => [c, ...c.rows]);
const byId = (cards) => Object.fromEntries(flat(cards).map((r) => [r.id, r]));

test("BSc CS + Maths minor: cards and numbers", () => {
  const cards = rowsFor(bsc, CS_MATHS);
  assert.deepEqual(cards.map((c) => c.id), ["core", "maj", "sec", "ole", "elec"]);
  const r = byId(cards);
  assert.equal(r.core.need, 24);
  assert.equal(r.maj.label, "Major · Computer Science");
  assert.deepEqual([r.maj.have, r.maj.need, r.maj.planned], [0, 48, 42]);
  assert.equal(r["maj:v"].planned, 0);
  assert.equal(r["maj:v"].depth, 1);
  assert.equal(r.maj.expandable, false);
  assert.equal(r["maj:v"].expandable, true);
});

test("unpicked choice says choose", () => {
  const r = byId(rowsFor(bsc, {}));
  assert.equal(r.maj.choose, true);
  assert.equal(r.maj.need, 48);
  assert.equal(r.maj.expandable, true);
  assert.equal(r.sec.need, 36);
});

test("BE: units counted for 0 cp units, empty 0 cp leaves hidden", () => {
  const r = byId(rowsFor(be, SOFT));
  assert.equal(r.pep.measure, "units");
  assert.equal(r.pep.need, 8);
  assert.equal(r.pep.planned, 8);
  assert.equal(r["stream:b"], undefined);
  assert.equal(r.stream.need, 120);
});

test("BCom core is a units node with nothing missing on the default plan", () => {
  const r = byId(rowsFor(bcom, FIN_ACC));
  assert.equal(r.core.measure, "cp");
  assert.equal(r.core.need, 24);
  assert.deepEqual(r.core.missing, []);
  const empty = byId(rowsFor(bcom, FIN_ACC, { semesters: [] }));
  assert.deepEqual(empty.core.missing, ["BUSS1000", "BUSS1020", "BUSS1030", "BUSS2000"]);
});

test("pool descriptions", () => {
  const ex = expand(bsc, CS_MATHS);
  assert.equal(describePool(bsc, ex.byId["core-ii"]),
    "Any 1000-level unit from Science Table A (sample: units from the sample components only), not counting any unit from Science Table A degree core");
  assert.equal(describePool(bsc, ex.byId.ole), "Any unit from Table O: Open Learning Environment");
  assert.equal(describePool(bsc, ex.byId["maj:v"]), "From the 3000-level Major selective list");
  assert.equal(describePool(bsc, ex.byId.elec), "Any unit");
  const fin = expand(bcom, FIN_ACC);
  assert.equal(describePool(bcom, fin.byId["maj:i"]), "From the 1000-level Core list");
  assert.equal(describePool(bsc, { pool: { level: 3000, prefix: "COMP" } }), "Any 3000-level COMP unit");
});

test("choose-from lists skip counted units and stop at 12", () => {
  for (const [cat, ch] of [[bsc, CS_MATHS], [bcom, FIN_ACC], [be, SOFT]]) {
    for (const r of flat(rowsFor(cat, ch))) {
      assert.ok(r.choices.codes.length <= 12, r.id);
      const counted = [...r.taken, ...r.plannedUnits].map((u) => u.code);
      for (const c of r.choices.codes) assert.ok(!counted.includes(c), `${r.id} ${c}`);
    }
  }
  const r = byId(rowsFor(bsc, CS_MATHS));
  assert.equal(r["sec:iv"].choices.codes.length, 12);
  assert.ok(r["sec:iv"].choices.more > 0);
});

test("every unit of the default plan taken: units rows met, planned becomes taken", () => {
  for (const [cat, ch] of [[bsc, CS_MATHS], [bcom, FIN_ACC], [be, SOFT]]) {
    const plan = generate(cat, ch);
    const taken = { semesters: plan.semesters.map((s) => s.map((c) => (c.code ? { ...c, taken: true } : c))) };
    const before = byId(rowsFor(cat, ch, plan));
    const after = byId(rowsFor(cat, ch, taken));
    for (const [id, r] of Object.entries(after)) {
      if (cat.course.requirements.children.find((n) => n.id === id)?.type === "units") assert.ok(r.met, id);
      assert.equal(r.planned, 0, id);
      assert.equal(r.have, before[id].have + before[id].planned, id);
      assert.equal(r.plannedUnits.length, 0, id);
    }
  }
});
