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
