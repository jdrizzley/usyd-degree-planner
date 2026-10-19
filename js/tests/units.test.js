import { test } from "node:test";
import assert from "node:assert/strict";
import { expand, leafMatches } from "../engine/expand.js";
import { searchUnits } from "../engine/units.js";
import { catalogFor } from "./helpers.js";

const bsc = await catalogFor("science");
const rows = bsc.listUnits();
const codes = (list) => list.map((r) => r.code);

test("listUnits covers the whole index", () => {
  assert.equal(rows.length, 178);
  assert.deepEqual(rows.find((r) => r.code === "COMP3109").sessions, []);
});

test("code prefix", () => {
  const r = searchUnits(rows, "comp2");
  assert.equal(r.length, 5);
  assert.deepEqual(codes(r), [...codes(r)].sort());
  assert.ok(r.every((x) => x.code.startsWith("COMP2")));
});

test("name words", () => {
  assert.deepEqual(codes(searchUnits(rows, "sys prog")), ["COMP2017"]);
  assert.deepEqual(codes(searchUnits(rows, "systems")),
    ["COMP2017", "COMP3221", "COMP3520", "ELEC1601", "ELEC2302", "ELEC3206", "ELEC3607", "INFS3110", "ISYS2110", "ISYS2160"]);
});

test("code matches come before name matches", () => {
  const r = codes(searchUnits(rows, "info1"));
  const firstOther = r.findIndex((c) => !c.startsWith("INFO1"));
  assert.ok(r[0].startsWith("INFO1"));
  if (firstOther !== -1) assert.ok(r.slice(firstOther).every((c) => !c.startsWith("INFO1")));
});

test("empty query: nothing, unless filtered", () => {
  assert.deepEqual(searchUnits(rows, ""), []);
  const leaf = expand(bsc, { m: "computer-science-major", s: "mathematics-minor" }).byId["maj:v"];
  const filter = (code) => leafMatches(bsc, leaf, code);
  assert.equal(searchUnits(rows, "", { filter }).length, 7);
  assert.equal(searchUnits(rows, "", { filter, limit: 3 }).length, 3);
  assert.equal(searchUnits(rows, "e", { limit: 4 }).length, 4);
});
