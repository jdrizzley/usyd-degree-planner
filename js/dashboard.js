// Dashboard (build guide §6.2). Phase 1 shows the degree name only; the numbers,
// pickers and Study plan button arrive in phase 3.
import { loadJSON } from "./data.js";
import { h } from "./dom.js";
import { buildHash } from "./url.js";

export function topbar() {
  return h("header", { class: "topbar" }, h("a", { class: "back", href: "#/" }, "← Degree Planner"));
}

export function message(text, link) {
  return h("section", { class: "message" }, h("p", {}, text), link ? h("p", {}, link) : null);
}

// Nearest available handbook year; ties go to the newer year.
export function resolveYear(years, wanted) {
  if (wanted === null || wanted === undefined) return Math.max(...years);
  if (years.includes(wanted)) return wanted;
  return [...years].sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || b - a)[0];
}

export async function renderDashboard(meta, route) {
  const year = resolveYear(meta.handbookYears, route.year);
  if (year !== route.year) {
    // Fix the address without adding a history entry.
    history.replaceState(null, "", buildHash({ ...route, year }));
  }
  const { courses } = await loadJSON(`handbooks/${year}/index.json`);
  const course = courses.find((c) => c.slug === route.course);
  if (!course) {
    return {
      node: h("div", {}, topbar(), message(`That degree isn't in the ${year} handbook.`, h("a", { href: "#/" }, "Search for your degree"))),
      title: "Degree Planner",
    };
  }
  const yearNote = route.year !== null && year !== route.year
    ? h("p", { class: "note" }, `There's no ${route.year} handbook yet, so this uses ${year}.`)
    : null;
  const node = h("div", {},
    topbar(),
    h("section", { class: "dashboard" },
      h("h1", { class: "page-title" }, course.name),
      yearNote,
      h("p", { class: "note" }, "Requirements and the study plan are on the way."),
    ),
  );
  return { node, title: `${course.name} · Degree Planner` };
}
