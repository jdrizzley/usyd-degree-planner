// Default plan for a course and its choices (phase 2 brief §7).
import { decodePlan } from "../url.js";
import { expand, leafMatches, leafNeedCp, minCp, placeholderRange, poolCandidates } from "./expand.js";
import { MAX_SEMESTERS, PLACEHOLDER_CP, canAdd, sessionOf, yearOf } from "./plan.js";
import { entriesFor, evaluate, matchPattern, mentions } from "./rules.js";

const ADVANCED = /\((Adv|Advanced|SSP)\)\s*$/i;

export function generate(catalog, choices = {}) {
  const course = catalog.course;
  if (course.defaultPlan) {
    const p = decodePlan(course.defaultPlan);
    if (p) return p;
  }
  const ex = expand(catalog, choices);
  const prefer = new Set(Object.values(ex.byId).flatMap((n) => n.prefer ?? []));
  const unit = (c) => catalog.unit(c);
  const cpOf = (codes) => codes.reduce((s, c) => s + (unit(c)?.cp ?? 0), 0);

  // ------------------------------------------------------------ 1. pick units
  const picked = [];
  const pickedSet = new Set();
  const add = (c) => {
    if (!pickedSet.has(c) && unit(c)) {
      picked.push(c);
      pickedSet.add(c);
    }
  };
  const holders = []; // { id, count, fill }

  const prohibits = (a, b) => evaluate(unit(a)?.rules.prohibitions?.parsed, entriesFor(catalog, [{ code: b }]), "prohibit");
  const clash = (a, b) => prohibits(a, b) || prohibits(b, a);
  const advanced = (c) => ADVANCED.test(unit(c)?.name ?? "");
  // Does c win over k when they're alternatives? prefer, then non-advanced.
  const beats = (c, k) => (prefer.has(c) !== prefer.has(k) ? prefer.has(c) : advanced(k) && !advanced(c));

  // Drop units that are alternatives to (prohibit) a unit already kept.
  function resolveAlternatives(cands) {
    const kept = [];
    for (const c of cands) {
      if (picked.some((p) => clash(p, c))) continue;
      const against = kept.filter((k) => clash(k, c));
      if (!against.length) kept.push(c);
      else if (against.every((k) => beats(c, k))) {
        kept.splice(kept.indexOf(against[0]), 1, c);
        for (const k of against.slice(1)) kept.splice(kept.indexOf(k), 1);
      }
    }
    return kept;
  }

  const ordered = [...ex.leaves.filter((l) => !l.shared), ...ex.leaves.filter((l) => l.shared)];
  for (const leaf of ordered) {
    if (leaf.fill) continue;
    if (leaf.type === "units") {
      leaf.units.forEach(add);
      continue;
    }
    let need = leafNeedCp(catalog, ex, leaf);
    if (leaf.shared) need -= cpOf(picked.filter((c) => leafMatches(catalog, leaf, c)));
    if (need <= 0) continue;
    const cands = poolCandidates(catalog, leaf.pool, leaf.component).filter((c) => !pickedSet.has(c) && unit(c));
    const kept = resolveAlternatives([...cands.filter((c) => prefer.has(c)), ...cands.filter((c) => !prefer.has(c))]);
    const take = cpOf(kept) <= 2 * need ? kept : kept.filter((c) => prefer.has(c));
    let got = 0;
    for (const c of take) {
      if (got >= need) break;
      add(c);
      got += unit(c).cp;
    }
    if (got < need) holders.push({ id: leaf.id, count: Math.ceil((need - got) / PLACEHOLDER_CP) });
  }

  // Blocks that need more than their parts (Software stream: 120 vs 102).
  for (const node of Object.values(ex.byId)) {
    if (node === ex.tree || node.type !== "all" || node.cp == null) continue;
    const short = node.cp - node.children.reduce((s, c) => s + minCp(catalog, c), 0);
    if (short > 0) holders.push({ id: node.id, count: Math.ceil(short / PLACEHOLDER_CP) });
  }

  // Electives make up the rest of the degree.
  for (const leaf of ex.leaves.filter((l) => l.fill)) {
    const used = cpOf(picked) + PLACEHOLDER_CP * holders.reduce((s, h) => s + h.count, 0);
    let count = Math.max(0, Math.ceil((course.totalCp - used) / PLACEHOLDER_CP));
    if (leaf.maxCp != null) count = Math.min(count, Math.ceil(leaf.maxCp / PLACEHOLDER_CP));
    holders.push({ id: leaf.id, count, fill: true });
  }

  // ------------------------------------------------------------ 2. order
  const rule = (c, k) => unit(c)?.rules[k]?.parsed;
  const deps = new Map(picked.map((c) => [c, picked.filter((d) => d !== c
    && (mentions(rule(c, "prerequisites"), d) || mentions(rule(c, "corequisites"), d)))]));
  const byLevel = (a, b) => unit(a).level - unit(b).level || a.localeCompare(b);
  const order = [];
  const left = new Set(picked);
  while (left.size) {
    const ready = [...left].filter((c) => deps.get(c).every((d) => !left.has(d)));
    const next = (ready.length ? ready : [...left]).sort(byLevel)[0]; // a cycle: take the lowest
    order.push(next);
    left.delete(next);
  }

  // ------------------------------------------------------------ 3. place
  const target = Math.max(course.semesters ?? 0, Math.ceil(course.totalCp / 24));
  const years = Math.ceil(target / 2);
  const yearOk = (level, k) => level == null || yearOf(k) >= Math.min(Math.floor(level / 1000), years);

  const ranges = new Map();
  const phRange = (id) => {
    if (!ranges.has(id)) ranges.set(id, placeholderRange(catalog, ex, id));
    return ranges.get(id);
  };
  const phs = [...holders.filter((h) => !h.fill), ...holders.filter((h) => h.fill)]
    .flatMap((h) => Array.from({ length: h.count }, () => h.id));

  // Everything the plan will hold, for telling "not yet" from "never".
  const potential = entriesFor(catalog, [...picked.map((code) => ({ code })), ...phs.map((ph) => ({ ph }))], phRange);
  // Keep only the parts of a rule that units in the plan can satisfy.
  function prune(n) {
    if (!n || n.text !== undefined || (n.op && n.ambiguous)) return null;
    if (n.unit) return pickedSet.has(n.unit) ? n : null;
    if (n.unitPattern) return picked.some((c) => matchPattern(n.unitPattern, c)) ? n : null;
    if (n.cp !== undefined) return n;
    const args = n.args.map(prune).filter(Boolean);
    return args.length ? { ...n, args } : null;
  }
  function ready(tree, entries) {
    if (!tree || evaluate(tree, entries)) return true;
    if (evaluate(tree, potential)) return false; // satisfiable later: wait
    const p = prune(tree); // can never be met in full: ignore units outside the plan
    return !p || evaluate(p, entries);
  }

  const semesters = [];
  let todo = order;
  let queue = phs;
  for (let k = 0; k < MAX_SEMESTERS && (todo.length || queue.length); k++) {
    const sem = [];
    const placed = semesters.flat();
    const earlier = entriesFor(catalog, placed, phRange);
    const fits = (c) => {
      const u = unit(c);
      if (!canAdd(catalog, sem, { code: c })) return false;
      if (Array.isArray(u.sessions) && u.sessions.length && !u.sessions.includes(sessionOf(k))) return false;
      if (!yearOk(u.level, k)) return false;
      if (!ready(u.rules.prerequisites?.parsed, earlier)) return false;
      return ready(u.rules.corequisites?.parsed, entriesFor(catalog, [...placed, ...sem], phRange));
    };
    // Repeat so a corequisite placed later in the order can pull its partner in.
    for (let changed = true; changed;) {
      changed = false;
      for (const c of todo) {
        if (!sem.some((x) => x.code === c) && fits(c)) {
          sem.push({ code: c, taken: false });
          changed = true;
        }
      }
      todo = todo.filter((c) => !sem.some((x) => x.code === c));
    }
    // Then placeholders, in the earliest slots whose year suits them.
    const rest = [];
    for (const ph of queue) {
      if (canAdd(catalog, sem, { ph }) && yearOk(phRange(ph)?.min, k)) sem.push({ ph });
      else rest.push(ph);
    }
    queue = rest;
    semesters.push(sem);
  }

  // Hit the semester cap: put anything left at the end without checks.
  const leftovers = [...todo.map((code) => ({ code, taken: false })), ...queue.map((ph) => ({ ph }))];
  for (const cell of leftovers) {
    let last = semesters[semesters.length - 1];
    if (!last || !canAdd(catalog, last, cell)) semesters.push((last = []));
    last.push(cell);
  }
  while (semesters.length < target) semesters.push([]);
  return { semesters };
}
