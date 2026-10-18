import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchCourses, pickOnEnter } from "../search.js";

const { courses } = JSON.parse(
  readFileSync(new URL("../../data/planner-sample/handbooks/2026/index.json", import.meta.url)),
);
const names = (q) => matchCourses(courses, q).map((c) => c.abbr);

test("word-prefix matching on name and abbreviation", () => {
  assert.deepEqual(names("sci"), ["BSc"]);
  assert.deepEqual(names("bsc"), ["BSc"]);
  assert.deepEqual(names("bachelor eng"), ["BE(Hons)"]);
  assert.deepEqual(names("be(hons)"), ["BE(Hons)"]);
  assert.deepEqual(names("COM"), ["BCom"]);
  assert.deepEqual(names("zzz"), []);
  assert.deepEqual(names("   "), []);
});

test("results are alphabetical by name", () => {
  assert.deepEqual(names("bachelor"), ["BCom", "BE(Hons)", "BSc"]);
});

test("Enter prefers an exact match, else the first result", () => {
  const all = matchCourses(courses, "bachelor");
  assert.equal(pickOnEnter(courses, "bachelor of science", matchCourses(courses, "bachelor of science")).slug, "science");
  assert.equal(pickOnEnter(courses, "BSc", matchCourses(courses, "BSc")).slug, "science");
  assert.equal(pickOnEnter(courses, "bachelor", all).slug, "commerce");
  assert.equal(pickOnEnter(courses, "zzz", []), null);
});
