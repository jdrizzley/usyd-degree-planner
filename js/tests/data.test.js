import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseRoot } from "../data.js";

test("sample data is chosen with ?data=sample", () => {
  assert.equal(chooseRoot("?data=sample"), "data/planner-sample");
});

test("real data is the default", () => {
  assert.equal(chooseRoot(""), "data/planner");
  assert.equal(chooseRoot("?data=other"), "data/planner");
});
