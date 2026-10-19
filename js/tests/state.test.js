import { test } from "node:test";
import assert from "node:assert/strict";
import { generate } from "../engine/generate.js";
import { changeChoice, changeYear, hashFor, loadState } from "../state.js";
import { makeStore } from "../store.js";
import { encodePlan, parseRoute, storageKey } from "../url.js";
import { catalogFor, loadJSON } from "./helpers.js";

const META = { handbookYears: [2026] };
const CS_MATHS = { m: "computer-science-major", s: "mathematics-minor" };

function fakeStorage() {
  const m = new Map();
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
const throwing = {
  getItem() { throw new Error("blocked"); },
  setItem() { throw new Error("blocked"); },
  removeItem() { throw new Error("blocked"); },
};

const load = (hash, { store = makeStore(fakeStorage()), meta = META, json = loadJSON } = {}) =>
  loadState({ loadJSON: json, store, meta, route: parseRoute(hash) });

test("no choices: generated plan, both choices missing", async () => {
  const s = await load("#/science/2026");
  assert.deepEqual(s.choices, {});
  assert.equal(s.planSource, "generated");
  assert.deepEqual(s.progress.missingChoices, ["m", "s"]);
  assert.equal(s.progress.takenCp, 0);
  assert.equal(s.progress.plannedCp, 12);
});

test("choices picked: short hash without a plan", async () => {
  const s = await load("#/science/2026?m=computer-science-major&s=mathematics-minor");
  assert.equal(s.progress.plannedCp, 72);
  assert.equal(s.progress.requiredCp, 144);
  assert.equal(hashFor(s, "dashboard"), "#/science/2026?m=computer-science-major&s=mathematics-minor");
});

test("unknown options are dropped", async () => {
  const s = await load("#/science/2026?m=astrology-major");
  assert.deepEqual(s.choices, {});
});

test("plan from the URL is used and backed up", async () => {
  const storage = fakeStorage();
  const s = await load("#/science/2026?m=computer-science-major&s=mathematics-minor&p=INFO1110!,MATH1061!.INFO1113&v=1",
    { store: makeStore(storage) });
  assert.equal(s.planSource, "url");
  assert.equal(s.progress.takenCp, 12);
  assert.equal(storage.map.get(storageKey("science", 2026, CS_MATHS)), "INFO1110!,MATH1061!.INFO1113");
});

test("plan from storage when the URL has none", async () => {
  const storage = fakeStorage();
  storage.setItem(storageKey("science", 2026, CS_MATHS), "INFO1110!.INFO1113!");
  const s = await load("#/science/2026?m=computer-science-major&s=mathematics-minor", { store: makeStore(storage) });
  assert.equal(s.planSource, "storage");
  assert.equal(s.progress.takenCp, 12);
});

test("unknown format version or a broken plan: rebuilt with a note", async () => {
  for (const q of ["p=INFO1110!&v=9", "p=garbage!!&v=1"]) {
    const s = await load(`#/science/2026?m=computer-science-major&${q}`);
    assert.equal(s.planSource, "generated", q);
    assert.ok(s.formatNote, q);
  }
});

test("storage that throws doesn't break loading", async () => {
  const s = await load("#/science/2026?p=INFO1110!&v=1", { store: makeStore(throwing) });
  assert.equal(s.planSource, "url");
  const t = await load("#/science/2026", { store: makeStore(throwing) });
  assert.equal(t.planSource, "generated");
});

test("missing year falls back with a note", async () => {
  const s = await load("#/science/2025");
  assert.equal(s.year, 2026);
  assert.equal(s.yearNote, "There's no 2025 handbook yet, so this uses 2026.");
  assert.equal((await load("#/science")).yearNote, null);
});

test("unknown slug", async () => {
  const s = await load("#/astrology/2026");
  assert.equal(s.course, null);
});

test("changing a choice on a generated plan keeps the hash short", async () => {
  const s = await load("#/science/2026?m=computer-science-major");
  const hash = changeChoice(s, "s", "mathematics-minor", { store: makeStore(fakeStorage()) });
  assert.equal(hash, "#/science/2026?m=computer-science-major&s=mathematics-minor");
  assert.equal(changeChoice(s, "m", null, { store: makeStore(fakeStorage()) }), "#/science/2026");
});

test("changing a choice on the user's plan keeps taken units", async () => {
  const storage = fakeStorage();
  const store = makeStore(storage);
  const s = await load("#/science/2026?m=computer-science-major&s=mathematics-minor&p=INFO1110!,MATH1061!.INFO1113!&v=1", { store });
  const hash = changeChoice(s, "s", "mathematics-major", { store });
  const next = await load(hash, { store });
  assert.equal(next.planSource, "url");
  assert.deepEqual(next.choices, { m: "computer-science-major", s: "mathematics-major" });
  const taken = next.plan.semesters.flatMap((sem, k) => sem.filter((c) => c.taken).map((c) => `${k}:${c.code}`));
  assert.deepEqual(taken, ["0:INFO1110", "0:MATH1061", "1:INFO1113"]);
  assert.ok(storage.map.has(storageKey("science", 2026, next.choices)));
});

test("changing the year keeps the user's plan and drops missing choices", async () => {
  // 2025 is served from the 2026 files, minus the Maths options.
  const json = async (path) => {
    const data = await loadJSON(path.replace("handbooks/2025/", "handbooks/2026/"));
    if (path === "handbooks/2025/courses/science.json") {
      const c = structuredClone(data);
      c.handbookYear = 2025;
      for (const ch of c.choices) ch.options = ch.options.filter((o) => !o.id.startsWith("mathematics"));
      return c;
    }
    return data;
  };
  const meta = { handbookYears: [2025, 2026] };
  const storage = fakeStorage();
  const store = makeStore(storage);
  const s = await load("#/science/2026?m=computer-science-major&s=mathematics-minor&p=INFO1110!.INFO1113&v=1", { store, meta, json });
  const hash = await changeYear(s, 2025, { loadJSON: json, store });
  assert.equal(hash, "#/science/2025?m=computer-science-major&p=INFO1110!.INFO1113&v=1");
  assert.ok(storage.map.has(storageKey("science", 2025, { m: "computer-science-major" })));
});

test("hashes round-trip for every sample degree and page", async () => {
  const cases = [
    ["science", CS_MATHS],
    ["commerce", { m: "finance-major", s: "accounting-minor" }],
    ["engineering-honours", { st: "software-stream" }],
  ];
  for (const [slug, choices] of cases) {
    const cat = await catalogFor(slug);
    const plan = generate(cat, choices);
    plan.semesters[0] = plan.semesters[0].map((c) => (c.code ? { ...c, taken: true } : c));
    const params = { ...choices, p: encodePlan(plan), v: 1 };
    const query = Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&");
    const s = await load(`#/${slug}/2026?${query}`);
    assert.ok(encodePlan(s.plan).includes("~"), "has placeholders");
    for (const page of ["dashboard", "requirements", "plan"]) {
      const back = await load(hashFor(s, page));
      assert.equal(back.page, page);
      assert.equal(back.year, s.year);
      assert.deepEqual(back.choices, s.choices);
      assert.equal(encodePlan(back.plan), encodePlan(plan));
    }
  }
});
