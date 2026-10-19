// Keep what the user has done when their choices change (phase 3 brief §3.5).
//
// The old plan's taken units stay exactly where they are. The new default
// plan's units go in around them, then placeholders are counted again so
// requirements the taken units already cover don't get extra slots.
import { expand } from "./expand.js";
import { MAX_SEMESTERS, MAX_SLOTS, PLACEHOLDER_CP, cellCp, takesSlot, slotsUsed } from "./plan.js";
import { progress } from "./progress.js";

export function mergePlan(catalog, oldPlan, newPlan, choices = {}) {
  const semesters = oldPlan.semesters.map((sem) => sem.filter((c) => c.code && c.taken).map((c) => ({ ...c })));
  while (semesters.length < newPlan.semesters.length) semesters.push([]);
  const present = new Set(semesters.flat().map((c) => c.code));

  const hasRoom = (j) => slotsUsed(catalog, semesters[j]) < MAX_SLOTS;
  // Semester k if it has room, else the next one that does. Placeholders can
  // also go in an earlier free slot before the plan grows a semester.
  function place(cell, k) {
    while (semesters.length <= k) semesters.push([]);
    if (!takesSlot(catalog, cell)) return semesters[k].push(cell);
    for (let j = k; j < semesters.length; j++) if (hasRoom(j)) return semesters[j].push(cell);
    if (cell.ph) for (let j = k - 1; j >= 0; j--) if (hasRoom(j)) return semesters[j].push(cell);
    if (semesters.length < MAX_SEMESTERS) return semesters.push([cell]);
    return semesters[semesters.length - 1].push(cell); // plan is full: phase 4 shows it as overfull
  }

  newPlan.semesters.forEach((sem, k) => {
    for (const cell of sem) {
      if (!cell.code || present.has(cell.code)) continue;
      present.add(cell.code);
      place({ code: cell.code, taken: false }, k);
    }
  });

  // How many placeholders of each id the new plan has, in first-seen order.
  const newCount = new Map();
  for (const sem of newPlan.semesters) for (const c of sem) if (c.ph) newCount.set(c.ph, (newCount.get(c.ph) ?? 0) + 1);

  const ex = expand(catalog, choices);
  const nodes = progress(catalog, choices, { semesters }).nodes;
  const isFill = (id) => !!ex.byId[id]?.fill;
  const keep = new Map();
  for (const [id, n] of newCount) {
    if (isFill(id)) continue;
    const node = nodes[id];
    const short = node ? Math.ceil(Math.max(0, node.needCp - node.plannedCp) / PLACEHOLDER_CP) : n;
    keep.set(id, Math.min(n, short));
  }
  const unitCp = [...present].reduce((s, code) => s + cellCp(catalog, { code }), 0);
  let used = unitCp + PLACEHOLDER_CP * [...keep.values()].reduce((s, n) => s + n, 0);
  for (const [id, n] of newCount) {
    if (!isFill(id)) continue;
    const count = Math.min(n, Math.max(0, Math.ceil((catalog.course.totalCp - used) / PLACEHOLDER_CP)));
    keep.set(id, count);
    used += count * PLACEHOLDER_CP;
  }

  newPlan.semesters.forEach((sem, k) => {
    for (const cell of sem) {
      if (!cell.ph || !keep.get(cell.ph)) continue;
      keep.set(cell.ph, keep.get(cell.ph) - 1);
      place({ ph: cell.ph }, k);
    }
  });

  // Drop empty semesters at the end, but keep at least as many as the new plan.
  while (semesters.length > newPlan.semesters.length && !semesters[semesters.length - 1].length) semesters.pop();
  return { semesters };
}
