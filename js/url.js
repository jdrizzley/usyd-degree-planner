// Hash routes (build guide §6) and, from phase 2, plan state encoding (§8).
//
//   #/                                  home
//   #/{course}/{year}                   dashboard
//   #/{course}/{year}/requirements      requirements view
//   #/{course}/{year}/plan              study plan
//
// Anything after "?" inside the hash is query state (choices, plan, version).

const SUBPAGES = { requirements: "requirements", plan: "plan" };

export function parseRoute(hash = "") {
  const raw = hash.replace(/^#/, "");
  const q = raw.indexOf("?");
  const path = q === -1 ? raw : raw.slice(0, q);
  const params = Object.fromEntries(new URLSearchParams(q === -1 ? "" : raw.slice(q + 1)));
  let parts;
  try {
    parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { page: "notfound", params };
  }
  if (parts.length === 0) return { page: "home", params };

  const [course, yearPart, sub, ...rest] = parts;
  if (rest.length || !/^[a-z0-9-]+$/.test(course)) return { page: "notfound", params };
  if (yearPart !== undefined && !/^\d{4}$/.test(yearPart)) return { page: "notfound", params };
  if (sub !== undefined && !SUBPAGES[sub]) return { page: "notfound", params };

  return {
    page: sub ? SUBPAGES[sub] : "dashboard",
    course,
    year: yearPart === undefined ? null : Number(yearPart),
    params,
  };
}

export function buildHash({ page = "home", course, year, params = {} } = {}) {
  if (page === "home" || !course) return "#/";
  let h = `#/${encodeURIComponent(course)}/${year}`;
  if (SUBPAGES[page]) h += `/${page}`;
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  ).toString();
  return query ? `${h}?${query}` : h;
}
