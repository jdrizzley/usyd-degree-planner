// Unit search for the add-unit sheet (phase 4 brief §3.1).

const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// rows: catalog.listUnits(). Every query word must start the code or some
// word of the name. Code matches for the whole query come first.
export function searchUnits(rows, query, { filter = null, limit = 50 } = {}) {
  const pool = filter ? rows.filter((r) => filter(r.code)) : rows;
  const q = words(query);
  const byCode = (a, b) => a.code.localeCompare(b.code);
  if (!q.length) return filter ? [...pool].sort(byCode).slice(0, limit) : [];

  const squashed = q.join("");
  const hits = pool.filter((r) => {
    const code = r.code.toLowerCase();
    const name = words(r.name);
    return q.every((t) => code.startsWith(t) || name.some((w) => w.startsWith(t)));
  });
  const first = hits.filter((r) => r.code.toLowerCase().startsWith(squashed)).sort(byCode);
  const rest = hits.filter((r) => !r.code.toLowerCase().startsWith(squashed)).sort(byCode);
  return [...first, ...rest].slice(0, limit);
}
