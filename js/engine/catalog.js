// Loads one course and everything it refers to (phase 2 brief §2.1).
//
// loadJSON(path) is injected: js/data.js's loadJSON in the browser, a disk
// reader in tests. Paths are relative to the data root.

const RULE_KINDS = ["prerequisites", "corequisites", "prohibitions", "assumedKnowledge"];

function walkReq(node, fn) {
  if (!node) return;
  fn(node);
  for (const c of node.children ?? []) walkReq(c, fn);
}

function poolRefs(spec, comps, pools) {
  if (!spec) return;
  if (spec.component) comps.add(spec.component);
  for (const p of spec.pools ?? []) pools.add(p);
  poolRefs(spec.exclude, comps, pools);
}

export async function loadCatalog(loadJSON, { year, slug }) {
  const base = `handbooks/${year}`;
  const course = await loadJSON(`${base}/courses/${slug}.json`);

  const compIds = new Set();
  const poolIds = new Set();
  for (const ch of course.choices ?? []) for (const o of ch.options) compIds.add(o.component);
  walkReq(course.requirements, (n) => poolRefs(n.pool, compIds, poolIds));

  const components = {};
  await Promise.all([...compIds].map(async (id) => {
    components[id] = await loadJSON(`${base}/components/${id}.json`);
  }));
  // Component requirements can name further pools (but not further components).
  for (const comp of Object.values(components)) {
    for (const kind of Object.values(comp.kinds ?? {})) {
      for (const r of kind.requirements ?? []) walkReq(r, (n) => poolRefs(n.pool, new Set(), poolIds));
    }
  }
  const pools = {};
  await Promise.all([...poolIds].map(async (id) => {
    pools[id] = await loadJSON(`${base}/pools/${id}.json`);
  }));

  const { units: rows } = await loadJSON("units/index.json");
  const index = new Map(rows.map((r) => [r.c, r]));

  // Every unit code the course can mention.
  const codes = new Set();
  walkReq(course.requirements, (n) => n.units?.forEach((c) => codes.add(c)));
  for (const ch of course.choices ?? []) for (const o of ch.options) o.prefer?.forEach((c) => codes.add(c));
  for (const comp of Object.values(components)) {
    for (const s of comp.sections ?? []) s.units.forEach((c) => codes.add(c));
    for (const kind of Object.values(comp.kinds ?? {})) {
      for (const r of kind.requirements ?? []) walkReq(r, (n) => n.units?.forEach((c) => codes.add(c)));
    }
  }
  for (const p of Object.values(pools)) p.units?.forEach((c) => codes.add(c));

  const records = new Map();
  const shards = new Map(); // prefix -> Promise
  function loadShard(prefix) {
    if (!shards.has(prefix)) {
      shards.set(prefix, loadJSON(`units/${prefix}.json`).then((data) => {
        for (const [code, u] of Object.entries(data.units ?? {})) records.set(code, u);
      }).catch(() => {
        // A missing shard leaves those units without rules; nothing else breaks.
      }));
    }
    return shards.get(prefix);
  }
  async function ensureUnits(list) {
    const prefixes = new Set([...list].filter((c) => index.has(c)).map((c) => c.slice(0, 4)));
    await Promise.all([...prefixes].map(loadShard));
  }
  // TODO(phase 7): real data is too big to load every referenced shard up front.
  await ensureUnits(codes);

  const unitCache = new Map();
  function unit(code) {
    const row = index.get(code);
    if (!row) return null;
    const rec = records.get(code);
    if (unitCache.has(code) && (unitCache.get(code).loaded || !rec)) return unitCache.get(code);
    const rules = {};
    for (const k of RULE_KINDS) if (rec?.rules?.[k]) rules[k] = rec.rules[k];
    const u = {
      code,
      name: row.n,
      cp: row.cp,
      level: row.lv ?? Number(code[4]) * 1000,
      sessions: row.s ?? null,
      last: row.last ?? null,
      rules,
      loaded: !!rec,
    };
    unitCache.set(code, u);
    return u;
  }

  return {
    year,
    course,
    components,
    pools,
    unit,
    hasUnit: (code) => index.has(code),
    ensureUnits,
  };
}
