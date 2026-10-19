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
