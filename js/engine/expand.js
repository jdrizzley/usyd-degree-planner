// Requirement tree with choices resolved, and pool matching (phase 2 brief §3).

export const levelOf = (code) => Number(code[4]) * 1000;

const clone = (x) => JSON.parse(JSON.stringify(x));

export function expand(catalog, choices = {}) {
  const course = catalog.course;
  const byId = {};
  const parents = {};
  const leaves = [];
  const missingChoices = [];
  const warnings = [];
  const usedComponents = new Set();

  function walk(src, parentId, component, shared, prefix) {
    let n = { ...src, id: prefix + src.id };
    if (n.type === "choice") n = resolveChoice(n);
    if (component && !n.component) n.component = component;
    if (n.share) shared = true;
    byId[n.id] = n;
    if (parentId) parents[n.id] = parentId;
    if (n.type === "all") {
      const childPrefix = n.choice ? `${n.id}:` : prefix;
      n.children = n.children.map((c) => walk(c, n.id, n.component ?? component, shared, childPrefix));
    } else if (n.type === "cp" || n.type === "units") {
      if (shared) n.shared = true;
      leaves.push(n);
    }
    return n;
  }

  function resolveChoice(n) {
    const def = (course.choices ?? []).find((c) => c.id === n.choice);
    const opt = def?.options.find((o) => o.id === choices[n.choice]);
    const comp = opt && catalog.components[opt.component];
    const kind = comp?.kinds?.[opt.kind];
    if (!kind) {
      missingChoices.push(n.choice);
      const totals = (def?.options ?? [])
        .map((o) => catalog.components[o.component]?.kinds?.[o.kind]?.totalCp)
        .filter((t) => typeof t === "number");
      return { ...n, unresolved: true, needCp: totals.length ? Math.min(...totals) : 0 };
    }
    if (usedComponents.has(opt.component)) {
      warnings.push(`Pick a different subject for your ${def.label.toLowerCase()}.`);
    }
    usedComponents.add(opt.component);
    return {
      id: n.id,
      type: "all",
      label: `${def.label} · ${opt.name}`,
      cp: kind.totalCp,
      component: opt.component,
      choice: n.choice,
      option: opt.id,
      prefer: opt.prefer ?? [],
      children: clone(kind.requirements),
    };
  }

  const tree = walk(clone(course.requirements), null, null, false, "");
  return { tree, leaves, byId, parents, missingChoices, warnings };
}

function sectionUnits(catalog, componentId, sectionId) {
  return catalog.components[componentId]?.sections?.find((s) => s.id === sectionId)?.units ?? [];
}

// Does a pool spec accept this code? All present keys must hold; units,
// sections and pools are unioned.
export function poolMatches(catalog, pool, code, componentId) {
  if (!pool) return false;
  if (pool.exclude && poolMatches(catalog, pool.exclude, code, componentId)) return false;
  if (pool.any) return true;
  const comp = pool.component ?? componentId;
  if (pool.units || pool.sections || pool.pools) {
    const inSet = (pool.units ?? []).includes(code)
      || (pool.sections ?? []).some((s) => sectionUnits(catalog, comp, s).includes(code))
      || (pool.pools ?? []).some((p) => (catalog.pools[p]?.units ?? []).includes(code));
    if (!inSet) return false;
  }
  if (pool.level != null && levelOf(code) !== pool.level) return false;
  if (pool.prefix && !code.startsWith(pool.prefix)) return false;
  return true;
}

// The units a pool lists, in handbook order. Empty for "any" pools and for
// pools defined only by level/prefix (those can't be listed).
export function poolCandidates(catalog, pool, componentId) {
  if (!pool || pool.any) return [];
  const comp = pool.component ?? componentId;
  const all = [
    ...(pool.units ?? []),
    ...(pool.sections ?? []).flatMap((s) => sectionUnits(catalog, comp, s)),
    ...(pool.pools ?? []).flatMap((p) => catalog.pools[p]?.units ?? []),
  ];
  return [...new Set(all)].filter((c) => poolMatches(catalog, pool, c, componentId));
}

export const leafMatches = (catalog, leaf, code) =>
  leaf.type === "units" ? leaf.units.includes(code) : poolMatches(catalog, leaf.pool, code, leaf.component);

export function leavesUnder(node) {
  if (node.type === "cp" || node.type === "units") return [node];
  return (node.children ?? []).flatMap(leavesUnder);
}

// The level range a placeholder for this node could have: { min, max }, or
// null when it could be anything (electives, unlisted pools).
export function placeholderRange(catalog, expanded, id) {
  const node = expanded?.byId[id];
  if (!node) return null;
  const levels = [];
  for (const leaf of leavesUnder(node)) {
    if (leaf.type === "units") {
      levels.push(...leaf.units.map((c) => catalog.unit(c)?.level ?? levelOf(c)));
    } else if (leaf.pool?.level != null) {
      levels.push(leaf.pool.level);
    } else {
      const cands = poolCandidates(catalog, leaf.pool, leaf.component);
      if (!cands.length) return null;
      levels.push(...cands.map((c) => catalog.unit(c)?.level ?? levelOf(c)));
    }
  }
  return levels.length ? { min: Math.min(...levels), max: Math.max(...levels) } : null;
}

// Smallest credit points a subtree needs (shared nodes count 0, like validate.py).
export function minCp(catalog, node) {
  if (node.share) return 0;
  if (node.type === "cp") return node.cp ?? 0;
  if (node.type === "units") return node.units.reduce((s, c) => s + (catalog.unit(c)?.cp ?? 0), 0);
  if (node.type === "choice") return node.needCp ?? 0;
  return Math.max(node.cp ?? 0, (node.children ?? []).reduce((s, c) => s + minCp(catalog, c), 0));
}

// needCp of a leaf (brief §5 step 1). Fill leaves get what's left of their
// parent's cp after the other non-shared siblings.
export function leafNeedCp(catalog, expanded, leaf) {
  if (leaf.type === "units") return leaf.units.reduce((s, c) => s + (catalog.unit(c)?.cp ?? 0), 0);
  if (!leaf.fill) return leaf.cp ?? 0;
  const parent = expanded.byId[expanded.parents[leaf.id]];
  if (!parent) return 0;
  const others = parent.children.filter((c) => c !== leaf && !c.fill && !c.share);
  const left = (parent.cp ?? 0) - others.reduce((s, c) => s + minCp(catalog, c), 0);
  return Math.min(Math.max(left, 0), leaf.maxCp ?? Infinity);
}
