// Plan model (phase 2 brief §2.3).
//
//   plan = { semesters: Cell[][] }      semesters[0] = Year 1 · Semester 1
//   Cell = { code: "COMP2017", taken: false } | { ph: "maj:v" }
//
// A placeholder ("ph") stands for one unit still to be chosen for a requirement leaf.

export const MAX_SLOTS = 4;
export const PLACEHOLDER_CP = 6;
export const MAX_SEMESTERS = 16;

// Plans always start in Semester 1.
export const sessionOf = (i) => (i % 2 === 0 ? "S1" : "S2");
export const yearOf = (i) => Math.floor(i / 2) + 1;
export const calendarYear = (catalog, i) => catalog.year + Math.floor(i / 2);
export const semesterLabel = (i) => `Year ${yearOf(i)} · Semester ${(i % 2) + 1}`;

// Credit points a cell counts for in rule checks. Unknown codes count as a
// standard 6 cp unit so a typo or an old code doesn't break every later rule.
export function cellCp(catalog, cell) {
  if (cell.ph) return PLACEHOLDER_CP;
  return catalog.unit(cell.code)?.cp ?? PLACEHOLDER_CP;
}

// 0 cp units (e.g. ENGP pills) don't take a slot; everything else does.
export function takesSlot(catalog, cell) {
  if (cell.ph) return true;
  const u = catalog.unit(cell.code);
  return !u || u.cp > 0;
}

export function slotsUsed(catalog, semester) {
  return semester.filter((c) => takesSlot(catalog, c)).length;
}

// Flat list of every cell with its position.
export function planUnits(plan) {
  const out = [];
  plan.semesters.forEach((sem, s) => sem.forEach((cell, i) => out.push({ s, i, cell })));
  return out;
}
