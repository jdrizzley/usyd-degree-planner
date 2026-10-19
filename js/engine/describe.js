// View model for the requirements view (phase 3 brief §4). DOM-free.
import { poolCandidates } from "./expand.js";

const MAX_CHOICES = 12;

function sectionLabel(catalog, componentId, sectionId) {
  const s = catalog.components[componentId]?.sections?.find((x) => x.id === sectionId);
  return (s?.label ?? sectionId).replace(/\s*\*+\s*$/, "").trim();
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// "Any 1000-level unit from Science Table A", "From the 3000-level Major selective list".
export function describePool(catalog, leaf) {
  return poolText(catalog, leaf.pool, leaf.component);
}

function poolText(catalog, pool, componentId) {
  if (!pool) return "";
  const comp = pool.component ?? componentId;
  const qualifier = [pool.level != null ? `${pool.level}-level` : null, pool.prefix ?? null].filter(Boolean).join(" ");
  const anyUnit = `Any ${qualifier ? `${qualifier} ` : ""}unit`;
  const parts = [];
  if (pool.any) parts.push("Any unit");
  if (pool.pools?.length) {
    const names = pool.pools.map((p) => catalog.pools[p]?.name ?? p);
    parts.push(`${anyUnit} from ${names.join(" or ")}`);
  }
  if (pool.sections?.length) {
    parts.push(`From the ${pool.sections.map((s) => sectionLabel(catalog, comp, s)).join(" or ")} list`);
  }
  if (pool.units?.length) parts.push("From the units listed below");
  if (!parts.length) parts.push(anyUnit);
  let text = parts.join(", or ");
  if (pool.exclude) text += `, not counting ${lowerFirst(poolText(catalog, pool.exclude, comp))}`;
  return text;
}

function linkFor(catalog, node) {
  const pool = node.pool;
  if (pool?.sections?.length) {
    const url = catalog.components[pool.component ?? node.component]?.sourceUrl;
    if (url) return url;
  }
  if (pool?.pools?.length) {
    const url = catalog.pools[pool.pools[0]]?.sourceUrl;
    if (url) return url;
  }
  if (node.component && catalog.components[node.component]?.sourceUrl) return catalog.components[node.component].sourceUrl;
  return catalog.course.sourceUrl ?? null;
}

const isLeaf = (n) => n.type === "cp" || n.type === "units";

export function requirementRows(catalog, prog) {
  const { nodes, tree } = prog;
  const info = (code) => {
    const u = catalog.unit(code);
    return { code, name: u?.name ?? "", cp: u?.cp ?? 6 };
  };
  const onPlan = new Set(nodes[tree.id]?.plannedUnits ?? []);

  const hidden = (n) => n.type === "cp" && (nodes[n.id]?.needCp ?? 0) === 0 && (nodes[n.id]?.plannedCp ?? 0) === 0;

  function needOf(n) {
    const r = nodes[n.id];
    if (n.type === "units" && unitsCp(n) === 0) return n.units.length;
    if (n.type === "all" && !r.needCp) return (n.children ?? []).reduce((s, c) => s + needOf(c), 0);
    return r.needCp;
  }
  const unitsCp = (n) => n.units.reduce((s, c) => s + (catalog.unit(c)?.cp ?? 0), 0);

  function row(n, depth) {
    const r = nodes[n.id];
    const measure = n.type === "units" && unitsCp(n) === 0 ? "units" : "cp";
    const leaf = isLeaf(n);
    const out = {
      id: n.id,
      depth,
      label: n.label ?? n.id,
      choose: n.type === "choice" && !!n.unresolved,
      measure,
      have: measure === "units" ? r.units.length : r.cp,
      need: needOf(n),
      planned: measure === "units" ? r.plannedUnits.length - r.units.length : Math.max(0, r.plannedCp - r.cp),
      met: r.met,
      expandable: leaf || (n.type === "choice" && !!n.unresolved),
      taken: [],
      plannedUnits: [],
      missing: [],
      pool: null,
      choices: { codes: [], more: 0 },
      link: linkFor(catalog, n),
    };
    if (leaf) {
      out.taken = r.units.map(info);
      out.plannedUnits = r.plannedUnits.filter((c) => !r.units.includes(c)).map(info);
    }
    if (n.type === "units") out.missing = n.units.filter((c) => !r.plannedUnits.includes(c));
    if (n.type === "cp") {
      out.pool = describePool(catalog, n);
      const cands = poolCandidates(catalog, n.pool, n.component).filter((c) => !onPlan.has(c) && !r.plannedUnits.includes(c));
      out.choices = { codes: cands.slice(0, MAX_CHOICES), more: Math.max(0, cands.length - MAX_CHOICES) };
    }
    return out;
  }

  function descendants(n, depth, list) {
    for (const c of n.children ?? []) {
      if (hidden(c)) continue;
      list.push(row(c, depth));
      descendants(c, depth + 1, list);
    }
    return list;
  }

  return (tree.children ?? []).filter((c) => !hidden(c)).map((c) => ({ ...row(c, 0), rows: descendants(c, 1, []) }));
}

// ---------------------------------------------------------------- plan grid

// Tile and tooltip text for a placeholder: { short: "3000 selective",
// full: "Second major or minor · Mathematics · 3000-level selective" }.
export function placeholderLabel(catalog, expanded, id) {
  const node = expanded?.byId[id];
  if (!node) return { short: id, full: id };
  const label = node.label ?? id;
  let short;
  if (node.fill) short = "Elective";
  else if (/^open learning environment$/i.test(label)) short = "OLE";
  else if (node.choice) short = label.split(" · ")[0];
  else short = label.replace(/-level\b/i, "");

  let full = label;
  if (!node.choice) {
    for (let p = expanded.parents[id]; p; p = expanded.parents[p]) {
      const anc = expanded.byId[p];
      if (anc?.choice) {
        full = `${anc.label} · ${label}`;
        break;
      }
    }
  }
  return { short, full };
}

function sessionText(sessions) {
  if (!Array.isArray(sessions)) return null;
  if (!sessions.length) return "Not offered recently";
  const nums = [...sessions].sort().map((s) => s.slice(1));
  return `Semester ${nums.join(" and ")}`;
}

// Tooltip text for a unit cell. cellStatus is the checkPlan cell.
export function unitSummary(catalog, code, cellStatus = null) {
  const u = catalog.unit(code);
  if (!u) return { title: code, lines: [`Not in the ${catalog.year} unit list`], reasons: [], notes: [] };
  const session = sessionText(u.sessions);
  return {
    title: `${code} · ${u.name}`,
    lines: [[`${u.cp} cp`, session].filter(Boolean).join(" · ")],
    reasons: cellStatus?.reasons ?? [],
    notes: cellStatus?.notes ?? [],
  };
}
