// Per-cell rule checks, reasons and hover relations (phase 2 brief §4).
import { expand, levelOf, placeholderRange } from "./expand.js";
import { MAX_SLOTS, cellCp, semesterLabel, sessionOf, slotsUsed } from "./plan.js";

// "MATH1X61" matches MATH1061, MATH1961, ... (X = any digit).
export function matchPattern(pattern, code) {
  if (pattern.length !== code.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "X" ? !/\d/.test(code[i]) : pattern[i] !== code[i]) return false;
  }
  return true;
}

const leafMatchesCode = (node, code) =>
  (node.unit && node.unit === code) || (node.unitPattern && matchPattern(node.unitPattern, code));

// ---------------------------------------------------------------- evaluation

// An entry is one plan cell turned into what rules need:
//   { code, cp, level }  or  { ph, cp: 6, range: {min, max} | null }
export function entriesFor(catalog, cells, phRange = () => null) {
  const seen = new Set();
  const out = [];
  for (const cell of cells) {
    if (cell.ph) {
      out.push({ ph: cell.ph, cp: cellCp(catalog, cell), range: phRange(cell.ph) });
    } else if (!seen.has(cell.code)) {
      seen.add(cell.code);
      const u = catalog.unit(cell.code);
      out.push({ code: cell.code, cp: cellCp(catalog, cell), level: u?.level ?? levelOf(cell.code) });
    }
  }
  return out;
}

function cpPasses(node, e) {
  if (e.ph) {
    // A placeholder could be any unit of its requirement, so it only passes
    // level filters its whole requirement satisfies.
    if (node.pattern || node.prefixes) return false;
    const r = e.range;
    if (node.level != null && !(r && r.min === node.level && r.max === node.level)) return false;
    if (node.minLevel != null && !(r && r.min >= node.minLevel)) return false;
    return true;
  }
  if (node.level != null && e.level !== node.level) return false;
  if (node.minLevel != null && e.level < node.minLevel) return false;
  if (node.pattern && !matchPattern(node.pattern, e.code)) return false;
  if (node.prefixes && !node.prefixes.some((p) => e.code.startsWith(p))) return false;
  if (node.exclude?.some((x) => leafMatchesCode(x, e.code))) return false;
  return true;
}

export const cpOf = (node, entries) =>
  entries.reduce((s, e) => s + (cpPasses(node, e) ? e.cp : 0), 0);

// mode "require": text and ambiguous nodes are not enforced (true).
// mode "prohibit": they never match (false).
export function evaluate(node, entries, mode = "require") {
  if (!node) return mode === "require";
  if (node.text !== undefined) return mode === "require";
  if (node.op && node.ambiguous) return mode === "require";
  if (node.unit) return entries.some((e) => e.code === node.unit);
  if (node.unitPattern) return entries.some((e) => e.code && matchPattern(node.unitPattern, e.code));
  if (node.cp !== undefined) return cpOf(node, entries) >= node.cp;
  if (node.op === "and") return node.args.every((a) => evaluate(a, entries, mode));
  if (node.op === "or") return node.args.some((a) => evaluate(a, entries, mode));
  return mode === "require";
}

// ---------------------------------------------------------------- describing

function joinWords(list, word = "or") {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} ${word} ${list[list.length - 1]}`;
}

export function describeCp(node) {
  const filter = [];
  if (node.minLevel != null) filter.push(`${node.minLevel}-level or above`);
  if (node.level != null) filter.push(`${node.level}-level`);
  if (node.prefixes) filter.push(joinWords(node.prefixes));
  if (node.pattern) filter.push(node.pattern);
  let s = `${node.cp} credit points`;
  if (filter.length) s += ` of ${filter.join(" ")} units`;
  if (node.exclude?.length) s += ` (not counting ${joinWords(node.exclude.map(describe))})`;
  return s;
}

// Readable rule text. Long "or" lists are shortened to 4 + "N others".
export function describe(tree) {
  if (!tree) return "";
  if (tree.unit) return tree.unit;
  if (tree.unitPattern) return tree.unitPattern;
  if (tree.text !== undefined) return tree.text;
  if (tree.cp !== undefined) return describeCp(tree);
  const parts = tree.args.map((a) => (a.op ? `(${describe(a)})` : describe(a)));
  if (tree.op === "or" && parts.length > 5) {
    return `${parts.slice(0, 4).join(" or ")} or ${parts.length - 4} others`;
  }
  return parts.join(` ${tree.op} `);
}

// ---------------------------------------------------------------- checks

function requireReasons(tree, entries, when) {
  if (!tree || evaluate(tree, entries)) return [];
  const failing = tree.op === "and" && !tree.ambiguous
    ? tree.args.filter((a) => !evaluate(a, entries))
    : [tree];
  return failing.map((n) => {
    if (n.cp !== undefined) {
      const by = when === "earlier" ? "before this semester" : "by this semester";
      return `Needs ${describeCp(n)} ${by} (has ${cpOf(n, entries)})`;
    }
    const where = when === "earlier" ? "in an earlier semester" : "in the same or an earlier semester";
    return `Needs ${describe(n)} ${where}`;
  });
}

// Text leaves and ambiguous groups become notes (shown, never enforced).
function collectNotes(rule, notes) {
  if (!rule?.parsed) return;
  (function walk(n) {
    if (n.text !== undefined) notes.push(n.text);
    else if (n.op && n.ambiguous) notes.push(`Also: ${rule.raw}`);
    else n.args?.forEach(walk);
  })(rule.parsed);
}

// Codes in a tree's unit / unitPattern leaves that match the given codes.
function mentioned(tree, codes) {
  const out = [];
  (function walk(n) {
    if (!n) return;
    if (n.unit || n.unitPattern) {
      for (const c of codes) if (leafMatchesCode(n, c) && !out.includes(c)) out.push(c);
    }
    n.args?.forEach(walk);
  })(tree);
  return out;
}

export const mentions = (tree, code) => mentioned(tree, [code]).length > 0;

function phRangeFor(catalog, choices) {
  let expanded = null;
  const cache = new Map();
  return (id) => {
    if (!cache.has(id)) {
      expanded ??= catalog.course ? expand(catalog, choices) : null;
      cache.set(id, placeholderRange(catalog, expanded, id));
    }
    return cache.get(id);
  };
}

// choices lets placeholders count toward level-limited credit point rules
// (e.g. a 3000-level selective placeholder counts for "36 cp at 3000-level").
export function checkPlan(catalog, plan, choices = {}) {
  const phRange = phRangeFor(catalog, choices);
  const sems = plan.semesters;
  const before = (k) => sems.slice(0, k).flat();

  const cells = sems.map((sem, k) => sem.map((cell, i) => {
    if (cell.ph) return { status: "placeholder", reasons: [], notes: [] };
    const unit = catalog.unit(cell.code);
    if (!unit) return { status: "unknown", reasons: [`Not in the ${catalog.year} unit list`], notes: [] };

    const reasons = [];
    const notes = [];
    const { prerequisites: pre, corequisites: co, prohibitions: no, assumedKnowledge: ak } = unit.rules;

    const earlier = entriesFor(catalog, before(k), phRange);
    reasons.push(...requireReasons(pre?.parsed, earlier, "earlier"));

    const upTo = entriesFor(catalog, [...before(k), ...sem.filter((_, j) => j !== i)], phRange);
    reasons.push(...requireReasons(co?.parsed, upTo, "same"));

    if (no?.parsed) {
      const others = sems.flatMap((s2, k2) => s2.filter((c, j) => c.code && !(k2 === k && j === i)));
      const otherCodes = [...new Set(others.map((c) => c.code).filter((c) => c !== cell.code))];
      const entries = entriesFor(catalog, otherCodes.map((code) => ({ code })));
      if (evaluate(no.parsed, entries, "prohibit")) {
        reasons.push(`Can't be taken with ${joinWords(mentioned(no.parsed, otherCodes), "and")}`);
      }
    }

    if (Array.isArray(unit.sessions) && !unit.sessions.includes(sessionOf(k))) {
      if (unit.sessions.length === 0) {
        reasons.push(unit.last ? `Not offered recently (last ran ${unit.last})` : "Not offered recently");
      } else {
        const names = unit.sessions.map((s) => `Semester ${s.slice(1)}`);
        reasons.push(`Usually only offered in ${joinWords(names)}`);
      }
    }

    const dup = sems.findIndex((s2, k2) => s2.some((c, j) => c.code === cell.code && (k2 < k || (k2 === k && j < i))));
    if (dup !== -1) reasons.push(`Already in your plan in ${semesterLabel(dup)}`);

    collectNotes(pre, notes);
    collectNotes(co, notes);
    if (ak?.raw) notes.push(`Assumed knowledge: ${ak.raw}`);

    return { status: reasons.length ? "broken" : "ok", reasons, notes: [...new Set(notes)] };
  }));

  const overfull = sems.map((s, k) => (slotsUsed(catalog, s) > MAX_SLOTS ? k : -1)).filter((k) => k !== -1);
  return { cells, overfull };
}

// ---------------------------------------------------------------- hover

function positions(plan, keep) {
  const out = [];
  plan.semesters.forEach((sem, s) => sem.forEach((cell, i) => { if (keep(cell, s, i)) out.push({ s, i }); }));
  return out;
}

// Cells this unit depends on (shown red on hover).
export function prereqsOf(catalog, plan, s, i) {
  const cell = plan.semesters[s]?.[i];
  const unit = cell?.code && catalog.unit(cell.code);
  if (!unit) return [];
  const pre = unit.rules.prerequisites?.parsed;
  const co = unit.rules.corequisites?.parsed;
  return positions(plan, (c, s2, i2) => c.code && !(s2 === s && i2 === i) && c.code !== cell.code && (
    (s2 < s && mentions(pre, c.code)) || (s2 <= s && mentions(co, c.code))));
}

// Later cells that depend on this unit (shown green on hover).
export function unlocks(catalog, plan, s, i) {
  const cell = plan.semesters[s]?.[i];
  if (!cell?.code || !catalog.unit(cell.code)) return [];
  return positions(plan, (c, s2, i2) => {
    if (!c.code || (s2 === s && i2 === i) || c.code === cell.code) return false;
    const u = catalog.unit(c.code);
    if (!u) return false;
    return (s2 > s && mentions(u.rules.prerequisites?.parsed, cell.code))
      || (s2 >= s && mentions(u.rules.corequisites?.parsed, cell.code));
  });
}
