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

// Like encodeURIComponent, but leaves "!", "," and ":" readable. They're all
// legal in a fragment, and plan strings are full of them.
const encodeReadable = (v) =>
  encodeURIComponent(v).replace(/%21/g, "!").replace(/%2C/gi, ",").replace(/%3A/gi, ":");

// Query keys come out in the order given, except "p" (plan) and "v" (format
// version), which always go last. Callers pass choice ids in course order.
export function buildHash({ page = "home", course, year, params = {} } = {}) {
  if (page === "home" || !course) return "#/";
  let h = `#/${encodeURIComponent(course)}/${year}`;
  if (SUBPAGES[page]) h += `/${page}`;
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  const last = ["p", "v"];
  entries.sort(([a], [b]) => last.indexOf(a) - last.indexOf(b));
  const query = entries.map(([k, v]) => `${encodeReadable(k)}=${encodeReadable(String(v))}`).join("&");
  return query ? `${h}?${query}` : h;
}

// ------------------------------------------------------------------ plan state

export const FORMAT_VERSION = 1;
const MAX_SEMESTERS = 16;
const MAX_CELLS = 12;
const CELL = /^([A-Z]{4}\d{4})(!?)$|^~([a-z0-9:-]+)$/;

// Semesters joined by ".", cells by ",". "COMP2017", taken "COMP2017!",
// placeholder "~maj:v". Empty semesters are empty segments.
export function encodePlan(plan) {
  return plan.semesters
    .map((sem) => sem.map((c) => (c.ph ? `~${c.ph}` : `${c.code}${c.taken ? "!" : ""}`)).join(","))
    .join(".");
}

// null for anything malformed. "" is a plan with no semesters.
export function decodePlan(text) {
  if (typeof text !== "string") return null;
  if (text === "") return { semesters: [] };
  const segs = text.split(".");
  if (segs.length > MAX_SEMESTERS) return null;
  const semesters = [];
  for (const seg of segs) {
    const parts = seg === "" ? [] : seg.split(",");
    if (parts.length > MAX_CELLS) return null;
    const sem = [];
    for (const part of parts) {
      const m = CELL.exec(part);
      if (!m) return null;
      sem.push(m[3] ? { ph: m[3] } : { code: m[1], taken: m[2] === "!" });
    }
    semesters.push(sem);
  }
  return { semesters };
}

// Only choice ids the course has, with option ids that are real options.
export function readChoices(params, course) {
  const out = {};
  for (const ch of course.choices ?? []) {
    const v = params[ch.id];
    if (ch.options.some((o) => o.id === v)) out[ch.id] = v;
  }
  return out;
}

export function storageKey(slug, year, choices) {
  const parts = Object.keys(choices).sort().map((k) => `${k}=${choices[k]}`);
  return `dp:v${FORMAT_VERSION}:${slug}:${year}:${parts.join("&")}`;
}
