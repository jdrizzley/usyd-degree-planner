import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveYear } from "../dashboard.js";

test("resolveYear picks newest, exact, or nearest (newer on ties)", () => {
  assert.equal(resolveYear([2024, 2025, 2026], null), 2026);
  assert.equal(resolveYear([2024, 2025, 2026], 2025), 2025);
  assert.equal(resolveYear([2024, 2025, 2026], 2030), 2026);
  assert.equal(resolveYear([2024, 2026], 2025), 2026);
  assert.equal(resolveYear([2024, 2025], 2019), 2024);
});
