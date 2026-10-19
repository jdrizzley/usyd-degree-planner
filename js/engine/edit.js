// Pure plan edits (phase 4 brief §2). Every function returns a new plan and
// never changes the one it was given. Positions are (s, i): semester index,
// cell index within that semester.
import { MAX_SEMESTERS, MAX_SLOTS, semesterLabel, sessionOf, slotsUsed, takesSlot } from "./plan.js";

const copy = (plan) => ({ semesters: plan.semesters.map((sem) => sem.map((c) => ({ ...c }))) });

export function toggleTaken(plan, s, i) {
  const out = copy(plan);
  const cell = out.semesters[s]?.[i];
  if (cell?.code) cell.taken = !cell.taken;
  return out;
}

export function removeCell(plan, s, i) {
  const out = copy(plan);
  const [cell] = out.semesters[s].splice(i, 1);
  return { plan: out, removed: { s, i, cell } };
}

// Puts the cell back where it was, even if that semester has filled up since
// (checkPlan then reports it as overfull; undo never loses the unit).
export function undoRemove(plan, removed) {
  const out = copy(plan);
  while (out.semesters.length <= removed.s) out.semesters.push([]);
  const sem = out.semesters[removed.s];
  sem.splice(Math.min(removed.i, sem.length), 0, { ...removed.cell });
  return out;
}

export function addSemester(plan) {
  const out = copy(plan);
  if (out.semesters.length < MAX_SEMESTERS) out.semesters.push([]);
  return out;
}

export function removeLastSemester(plan) {
  const out = copy(plan);
  if (out.semesters.length && !out.semesters[out.semesters.length - 1].length) out.semesters.pop();
  return out;
}

export function replacePlaceholder(plan, s, i, code) {
  const out = copy(plan);
  if (out.semesters[s]?.[i]?.ph) out.semesters[s][i] = { code, taken: false };
  return out;
}

function findCode(plan, code) {
  for (let s = 0; s < plan.semesters.length; s++) {
    if (plan.semesters[s].some((c) => c.code === code)) return s;
  }
  return -1;
}

// target: null (first semester that fits) or { s } (a slot the user clicked).
export function addUnit(catalog, plan, code, target = null) {
  const at = findCode(plan, code);
  if (at !== -1) return { error: `${code} is already in your plan (${semesterLabel(at)}).` };

  const out = copy(plan);
  const cell = { code, taken: false };
  const unit = catalog.unit(code);
  const needsSlot = takesSlot(catalog, cell);
  const hasRoom = (k) => !needsSlot || slotsUsed(catalog, out.semesters[k]) < MAX_SLOTS;

  if (target) {
    while (out.semesters.length <= target.s) out.semesters.push([]);
    if (!hasRoom(target.s)) return { error: `${semesterLabel(target.s)} is full.` };
    out.semesters[target.s].push(cell);
    return { plan: out, s: target.s, i: out.semesters[target.s].length - 1 };
  }

  const sessions = unit?.sessions;
  const offered = (k) => !Array.isArray(sessions) || !sessions.length || sessions.includes(sessionOf(k));
  for (let k = 0; k < MAX_SEMESTERS; k++) {
    if (k >= out.semesters.length) out.semesters.push([]);
    if (hasRoom(k) && offered(k)) {
      out.semesters[k].push(cell);
      return { plan: out, s: k, i: out.semesters[k].length - 1 };
    }
  }
  return { error: "Your plan is full. Remove a unit first." };
}

// ---------------------------------------------------------------- moving (phase 5)

// to: { kind: "cell", s, i } (another tile) or { kind: "semester", s }.
export function moveCell(catalog, plan, from, to) {
  if (to.kind === "cell" && to.s === from.s && to.i === from.i) return { same: true };
  const src = plan.semesters[from.s]?.[from.i];
  if (!src) return { same: true };
  const dst = to.kind === "cell" ? plan.semesters[to.s]?.[to.i] : null;

  // Swap two slot-taking tiles.
  if (dst && takesSlot(catalog, src) && takesSlot(catalog, dst)) {
    const out = copy(plan);
    out.semesters[from.s][from.i] = { ...dst };
    out.semesters[to.s][to.i] = { ...src };
    return { plan: out, at: { s: to.s, i: to.i } };
  }

  // Otherwise it goes to the end of the target semester (pills never swap).
  const s = to.s;
  const out = copy(plan);
  if (s !== from.s && takesSlot(catalog, src) && slotsUsed(catalog, out.semesters[s]) >= MAX_SLOTS) {
    return { error: `${semesterLabel(s)} is full.` };
  }
  const [cell] = out.semesters[from.s].splice(from.i, 1);
  out.semesters[s].push(cell);
  return { plan: out, at: { s, i: out.semesters[s].length - 1 } };
}

// What's at row `row` of column s: the slot-taking cells fill rows from the top.
export function targetAt(catalog, plan, s, row) {
  const slotted = [];
  (plan.semesters[s] ?? []).forEach((c, i) => takesSlot(catalog, c) && slotted.push(i));
  return row < slotted.length ? { kind: "cell", s, i: slotted[row] } : { kind: "semester", s };
}

// Arrow keys move a keyboard target around the grid, clamped to its edges.
export function stepTarget(catalog, plan, { s, row }, key) {
  const last = plan.semesters.length - 1;
  const rows = (k) => Math.max(MAX_SLOTS, slotsUsed(catalog, plan.semesters[k] ?? []));
  if (key === "ArrowLeft") s = Math.max(0, s - 1);
  else if (key === "ArrowRight") s = Math.min(last, s + 1);
  else if (key === "ArrowUp") row = Math.max(0, row - 1);
  else if (key === "ArrowDown") row = Math.min(rows(s) - 1, row + 1);
  else return { s, row };
  return { s, row: Math.min(row, rows(s) - 1) };
}
