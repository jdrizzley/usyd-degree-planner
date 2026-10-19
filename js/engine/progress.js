// Credit point totals and allocation of units to requirements (phase 2 brief §5).
import { expand, leafMatches, leafNeedCp, minCp } from "./expand.js";
import { planUnits } from "./plan.js";

// Give each unit (distinct codes, known units only) to requirement leaves.
function allocate(catalog, ex, codes) {
  const units = codes.map((code) => ({ code, cp: catalog.unit(code).cp }));
  const leafIndex = new Map(ex.leaves.map((l, i) => [l.id, i]));
  const need = new Map(ex.leaves.map((l) => [l.id, leafNeedCp(catalog, ex, l)]));
  const alloc = new Map(ex.leaves.map((l) => [l.id, []]));
  const cpIn = (leaf) => alloc.get(leaf.id).reduce((s, c) => s + catalog.unit(c).cp, 0);
  const room = (leaf, u) => cpIn(leaf) + u.cp <= (leaf.maxCp ?? Infinity);
  const give = (leaf, u) => alloc.get(leaf.id).push(u.code);

  // Most-constrained first: units with fewest candidate leaves go first, each
  // to the candidate leaf with fewest candidate units. Units leaves take their own.
  function assignPass(leaves, pending) {
    const cands = new Map(pending.map((u) => [u.code, leaves.filter((l) => leafMatches(catalog, l, u.code))]));
    const leafCount = new Map(leaves.map((l) => [l.id, pending.filter((u) => cands.get(u.code).includes(l)).length]));
    const first = (u) => Math.min(...cands.get(u.code).map((l) => leafIndex.get(l.id)));
    const order = pending.filter((u) => cands.get(u.code).length).sort((a, b) =>
      cands.get(a.code).length - cands.get(b.code).length || first(a) - first(b) || a.code.localeCompare(b.code));
    const used = new Set();
    for (const u of order) {
      const options = cands.get(u.code).filter((l) =>
        l.type === "units" || (cpIn(l) < need.get(l.id) && room(l, u)));
      if (!options.length) continue;
      const pick = options.find((l) => l.type === "units")
        ?? options.sort((a, b) => leafCount.get(a.id) - leafCount.get(b.id) || leafIndex.get(a.id) - leafIndex.get(b.id))[0];
      give(pick, u);
      used.add(u.code);
    }
    return used;
  }

  // 1. Shared leaves (e.g. degree core). These units stay available below.
  assignPass(ex.leaves.filter((l) => l.shared && !l.fill), units);

  // 2. Non-shared leaves still short of their credit points.
  const main = ex.leaves.filter((l) => !l.shared && !l.fill);
  const placed = assignPass(main, units);

  // Ancestors that are "all" nodes with a cp target (the root doesn't count).
  const ancestors = (id) => {
    const out = [];
    for (let p = ex.parents[id]; p && ex.parents[p]; p = ex.parents[p]) out.push(ex.byId[p]);
    return out;
  };
  const subtreeCp = (node) => {
    const codesIn = new Set();
    (function walk(n) {
      if (alloc.has(n.id) && (n.type === "cp" || n.type === "units")) alloc.get(n.id).forEach((c) => codesIn.add(c));
      n.children?.forEach(walk);
    })(node);
    return [...codesIn].reduce((s, c) => s + catalog.unit(c).cp, 0);
  };

  // 3. Extra units into leaves whose parent block still needs credit points
  //    (e.g. stream electives up to the stream's 120 cp).
  const extra = units.filter((u) => !placed.has(u.code));
  for (const u of extra) {
    const leaf = main.find((l) => leafMatches(catalog, l, u.code) && room(l, u)
      && ancestors(l.id).some((a) => a.type === "all" && a.cp != null && subtreeCp(a) < a.cp));
    if (leaf) {
      give(leaf, u);
      placed.add(u.code);
    }
  }

  // 4. Whatever is left goes to fill leaves (electives) up to their maxCp.
  for (const u of units.filter((x) => !placed.has(x.code))) {
    const leaf = ex.leaves.find((l) => l.fill && leafMatches(catalog, l, u.code) && room(l, u));
    if (leaf) {
      give(leaf, u);
      placed.add(u.code);
    }
  }

  // Per-node results, bottom-up.
  const nodes = {};
  (function result(n) {
    if (n.type === "cp" || n.type === "units") {
      const list = alloc.get(n.id);
      const cp = cpIn(n);
      const met = n.type === "units" ? n.units.every((c) => list.includes(c)) : cp >= need.get(n.id);
      nodes[n.id] = { cp, needCp: need.get(n.id), met, units: [...list] };
    } else if (n.type === "choice") {
      nodes[n.id] = { cp: 0, needCp: n.needCp ?? 0, met: false, units: [] };
    } else {
      n.children.forEach(result);
      const list = [...new Set(n.children.flatMap((c) => nodes[c.id].units))];
      const cp = subtreeCp(n);
      const met = n.children.every((c) => nodes[c.id].met) && (n.cp == null || cp >= n.cp);
      nodes[n.id] = { cp, needCp: minCp(catalog, n), met, units: list };
    }
  })(ex.tree);
  return nodes;
}

export function progress(catalog, choices = {}, plan = { semesters: [] }) {
  const ex = expand(catalog, choices);
  const cells = planUnits(plan).map((x) => x.cell).filter((c) => c.code && catalog.unit(c.code));
  const taken = [...new Set(cells.filter((c) => c.taken).map((c) => c.code))];
  const all = [...new Set(cells.map((c) => c.code))];
  const sum = (codes) => codes.reduce((s, c) => s + catalog.unit(c).cp, 0);
  const takenCp = sum(taken);
  const plannedCp = sum(all.filter((c) => !taken.includes(c)));
  const requiredCp = catalog.course.totalCp;

  const a = allocate(catalog, ex, taken);
  const b = allocate(catalog, ex, all);
  const nodes = {};
  for (const id of Object.keys(a)) {
    nodes[id] = {
      ...a[id],
      plannedCp: b[id].cp,
      plannedUnits: b[id].units,
      plannedMet: b[id].met,
    };
  }
  const root = nodes[ex.tree.id];
  root.met = root.met && takenCp >= requiredCp;
  root.plannedMet = root.plannedMet && takenCp + plannedCp >= requiredCp;

  return {
    takenCp,
    plannedCp,
    requiredCp,
    complete: root.met,
    nodes,
    tree: ex.tree,
    missingChoices: ex.missingChoices,
    warnings: ex.warnings,
  };
}
