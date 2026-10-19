// Everything a course page needs, built from the route (phase 3 brief §3).
// DOM-free: loadJSON and the store are passed in, so tests run in Node.
import { loadCatalog } from "./engine/catalog.js";
import { generate } from "./engine/generate.js";
import { mergePlan } from "./engine/merge.js";
import { progress } from "./engine/progress.js";
import { FORMAT_VERSION, buildHash, decodePlan, encodePlan, readChoices, storageKey } from "./url.js";

// Nearest available handbook year; ties go to the newer year.
export function resolveYear(years, wanted) {
  if (wanted === null || wanted === undefined) return Math.max(...years);
  if (years.includes(wanted)) return wanted;
  return [...years].sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || b - a)[0];
}

async function courseFor(loadJSON, year, slug) {
  const { courses } = await loadJSON(`handbooks/${year}/index.json`);
  return courses.some((c) => c.slug === slug) ? loadCatalog(loadJSON, { year, slug }) : null;
}

const userPlan = (state) => state.planSource !== "generated";

function withProgress(state) {
  return { ...state, progress: progress(state.catalog, state.choices, state.plan) };
}

export async function loadState({ loadJSON, store, meta, route }) {
  const year = resolveYear(meta.handbookYears, route.year);
  const yearNote = route.year !== null && route.year !== undefined && year !== route.year
    ? `There's no ${route.year} handbook yet, so this uses ${year}.`
    : null;
  const base = { page: route.page, slug: route.course, year, yearNote, formatNote: null };
  const catalog = await courseFor(loadJSON, year, route.course);
  if (!catalog) return { ...base, course: null, catalog: null };

  const course = catalog.course;
  const params = route.params ?? {};
  const choices = readChoices(params, course);
  const key = storageKey(route.course, year, choices);

  let plan = null;
  let planSource = "generated";
  let formatNote = null;
  if (params.p !== undefined) {
    const okVersion = params.v === undefined || params.v === String(FORMAT_VERSION);
    const decoded = okVersion ? decodePlan(params.p) : null;
    if (decoded) {
      plan = decoded;
      planSource = "url";
      store.set(key, params.p);
    } else {
      formatNote = okVersion
        ? "This link's study plan couldn't be read, so the plan was rebuilt."
        : "This link uses an older format, so the plan was rebuilt.";
    }
  }
  if (!plan && !formatNote) {
    const saved = decodePlan(store.get(key));
    if (saved) {
      plan = saved;
      planSource = "storage";
    }
  }
  if (!plan) plan = generate(catalog, choices);

  return withProgress({ ...base, formatNote, course, catalog, choices, plan, planSource });
}

// Choices in course order, then the plan (only when it's the user's own).
export function hashFor(state, page = state.page) {
  const params = {};
  for (const ch of state.course.choices ?? []) {
    if (state.choices[ch.id]) params[ch.id] = state.choices[ch.id];
  }
  if (userPlan(state)) {
    params.p = encodePlan(state.plan);
    params.v = FORMAT_VERSION;
  }
  return buildHash({ page, course: state.slug, year: state.year, params });
}

export function changeChoice(state, choiceId, optionId, { store }) {
  const choices = { ...state.choices };
  if (optionId) choices[choiceId] = optionId;
  else delete choices[choiceId];
  let next = { ...state, choices };
  if (userPlan(state)) {
    const plan = mergePlan(state.catalog, state.plan, generate(state.catalog, choices), choices);
    next = { ...next, plan };
    store.set(storageKey(state.slug, state.year, choices), encodePlan(plan));
  }
  return hashFor(next);
}

export async function changeYear(state, year, { loadJSON, store }) {
  const catalog = await courseFor(loadJSON, year, state.slug);
  if (!catalog) return buildHash({ page: state.page, course: state.slug, year });
  const choices = readChoices(state.choices, catalog.course);
  const next = { ...state, year, catalog, course: catalog.course, choices };
  if (userPlan(state)) store.set(storageKey(state.slug, year, choices), encodePlan(state.plan));
  return hashFor(next);
}
