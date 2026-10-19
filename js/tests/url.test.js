import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHash, parseRoute } from "../url.js";

test("home", () => {
  assert.deepEqual(parseRoute(""), { page: "home", params: {} });
  assert.deepEqual(parseRoute("#/"), { page: "home", params: {} });
});

test("dashboard, requirements and plan routes", () => {
  assert.deepEqual(parseRoute("#/science/2026"), { page: "dashboard", course: "science", year: 2026, params: {} });
  assert.equal(parseRoute("#/science/2026/requirements").page, "requirements");
  const plan = parseRoute("#/science/2026/plan?m=computer-science-major&v=1");
  assert.equal(plan.page, "plan");
  assert.deepEqual(plan.params, { m: "computer-science-major", v: "1" });
});

test("missing year is null (means newest)", () => {
  assert.equal(parseRoute("#/science").year, null);
});

test("bad routes are notfound", () => {
  for (const h of ["#/science/26", "#/science/2026/nope", "#/Sci ence/2026", "#/a/2026/plan/extra", "#/%E0%A4%A"]) {
    assert.equal(parseRoute(h).page, "notfound", h);
  }
});

test("buildHash round-trips", () => {
  const r = { page: "plan", course: "science", year: 2026, params: { m: "computer-science-major", s: "mathematics-minor" } };
  assert.deepEqual(parseRoute(buildHash(r)), r);
  assert.equal(buildHash({ page: "dashboard", course: "commerce", year: 2026 }), "#/commerce/2026");
  assert.equal(buildHash({ page: "home" }), "#/");
  assert.equal(buildHash({ page: "dashboard", course: "x", year: 2026, params: { a: "", b: null } }), "#/x/2026");
});

import { decodePlan, encodePlan, readChoices, storageKey } from "../url.js";

test("plan encode/decode round-trips", () => {
  for (const text of ["INFO1110!,MATH1061.INFO1113,~maj:v", "INFO1110,COMP2017..COMP3888", "INFO1110.", "~elec,~sec:iv.~stream"]) {
    const plan = decodePlan(text);
    assert.ok(plan, text);
    assert.equal(encodePlan(plan), text);
  }
  assert.deepEqual(decodePlan("INFO1110!,~maj:v"), { semesters: [[{ code: "INFO1110", taken: true }, { ph: "maj:v" }]] });
  assert.equal(decodePlan("A,B..C".replace(/[ABC]/g, "INFO1110")).semesters.length, 3);
  assert.deepEqual(decodePlan("INFO1110.").semesters, [[{ code: "INFO1110", taken: false }], []]);
  assert.deepEqual(decodePlan(""), { semesters: [] });
});

test("malformed plans decode to null", () => {
  const many = (n, cell) => Array.from({ length: n }, () => cell);
  for (const bad of ["info1110", "INFO111", "INFO1110!!", "~Maj", "~", "INFO1110,,MATH1061", "INFO1110 ", many(17, "INFO1110").join("."), many(13, "INFO1110").join(",")]) {
    assert.equal(decodePlan(bad), null, bad);
  }
  assert.equal(decodePlan(null), null);
  assert.ok(decodePlan(many(16, "").join(".")));
  assert.ok(decodePlan(many(12, "INFO1110").join(",")));
});

test("buildHash keeps plan strings readable", () => {
  const h = buildHash({ page: "plan", course: "science", year: 2026,
    params: { v: 1, p: "INFO1110!,MATH1061!,~ole.INFO1113,~maj:v", m: "computer-science-major", s: "mathematics-minor" } });
  assert.equal(h, "#/science/2026/plan?m=computer-science-major&s=mathematics-minor&p=INFO1110!,MATH1061!,~ole.INFO1113,~maj:v&v=1");
  assert.equal(parseRoute(h).params.p, "INFO1110!,MATH1061!,~ole.INFO1113,~maj:v");
  // Characters that would change the meaning stay encoded.
  const odd = buildHash({ page: "plan", course: "x", year: 2026, params: { q: "a&b=c #d%e+f g" } });
  assert.equal(odd, "#/x/2026/plan?q=a%26b%3Dc%20%23d%25e%2Bf%20g");
  assert.equal(parseRoute(odd).params.q, "a&b=c #d%e+f g");
  // The old fully-encoded form still parses.
  assert.equal(parseRoute("#/science/2026/plan?p=INFO1110%21%2CMATH1061").params.p, "INFO1110!,MATH1061");
});

test("readChoices keeps only real options", () => {
  const course = { choices: [{ id: "m", options: [{ id: "cs-major" }] }, { id: "s", options: [{ id: "maths-minor" }] }] };
  assert.deepEqual(readChoices({ m: "cs-major", s: "nope", x: "cs-major" }, course), { m: "cs-major" });
  assert.deepEqual(readChoices({}, { }), {});
});

test("storageKey doesn't depend on key order", () => {
  assert.equal(storageKey("science", 2026, { s: "b", m: "a" }), "dp:v1:science:2026:m=a&s=b");
  assert.equal(storageKey("science", 2026, { m: "a", s: "b" }), storageKey("science", 2026, { s: "b", m: "a" }));
  assert.equal(storageKey("science", 2026, {}), "dp:v1:science:2026:");
});
