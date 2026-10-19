// Dashboard (build guide §6.2, phase 3 brief §5): pickers, the three numbers,
// the Study plan button.
import { loadJSON } from "./data.js";
import { h } from "./dom.js";
import { infoButton } from "./info.js";
import { picker, staticPicker } from "./picker.js";
import { changeChoice, changeYear, hashFor, loadState } from "./state.js";
import { browserStore } from "./store.js";

export { resolveYear } from "./state.js";

export function topbar(back = h("a", { class: "back", href: "#/" }, "← Degree Planner"), right = null) {
  return h("header", { class: "topbar" }, back, right);
}

export function message(text, link) {
  return h("section", { class: "message" }, h("p", {}, text), link ? h("p", {}, link) : null);
}

// Loads the course page state, fixing the address if the year changed.
export async function loadCourse(ctx) {
  const state = await loadState({ loadJSON, store: browserStore(), meta: ctx.meta, route: ctx.route });
  if (state.course && state.year !== ctx.route.year) history.replaceState(null, "", hashFor(state));
  return state;
}

export function notFound(state) {
  return {
    node: h("div", {},
      topbar(),
      message(`That degree isn't in the ${state.year} handbook.`, h("a", { href: "#/" }, "Search for your degree"))),
    title: "Degree Planner",
  };
}

export function footer(course) {
  return h("footer", { class: "footer" },
    "Unofficial. Not affiliated with the University of Sydney. Always check ",
    course.sourceUrl ? h("a", { href: course.sourceUrl, target: "_blank", rel: "noopener" }, "the handbook") : "the handbook",
    ".");
}

// Notes under the pickers: year fallback, old links, engine warnings.
export function notes(state) {
  return [state.yearNote, state.formatNote, ...(state.progress.warnings ?? [])]
    .filter(Boolean)
    .map((t) => h("p", { class: "note" }, t));
}

function choiceOptions(choice) {
  const kinds = new Set(choice.options.map((o) => o.kind));
  const label = (k) => k.charAt(0).toUpperCase() + k.slice(1);
  const opts = choice.options.map((o) => ({ id: o.id, text: o.name, sub: kinds.size > 1 ? label(o.kind) : undefined }));
  return choice.required === false ? [{ id: null, text: "None" }, ...opts] : opts;
}

function numberCard({ key, label, value, done, href, sub }) {
  return h("a", { class: done ? "num done" : "num", href, "data-key": key },
    h("span", { class: "num-value" }, String(value)),
    h("span", { class: "num-label" }, label),
    h("span", { class: "num-unit" }, "credit points"),
    sub ? h("span", { class: "num-sub" }, sub) : null);
}

export function numbers(state, compact = false) {
  const p = state.progress;
  const href = hashFor(state, "requirements");
  const finished = p.takenCp >= p.requiredCp;
  return h("div", { class: compact ? "numbers compact" : "numbers" },
    numberCard({ key: "num-taken", label: "Taken", value: p.takenCp, done: finished, href,
      sub: p.plannedCp > 0 ? `+${p.plannedCp} planned` : null }),
    numberCard({ key: "num-left", label: "Left", value: Math.max(0, p.requiredCp - p.takenCp), done: finished, href }),
    numberCard({ key: "num-required", label: "Required", value: p.requiredCp, done: p.complete, href }));
}

export async function renderDashboard(ctx) {
  const state = await loadCourse(ctx);
  if (!state.course) return notFound(state);
  const { course, meta } = { course: state.course, meta: ctx.meta };
  const store = browserStore();

  const pickers = (course.choices ?? []).map((ch) => picker({
    key: `pick-${ch.id}`,
    label: ch.label,
    value: state.choices[ch.id] ?? null,
    options: choiceOptions(ch),
    onPick: (id) => ctx.replace(changeChoice(state, ch.id, id, { store })),
  }));
  const years = [...meta.handbookYears].sort((a, b) => b - a);
  pickers.push(years.length > 1
    ? picker({
      key: "pick-year",
      label: "Starting",
      value: state.year,
      options: years.map((y) => ({ id: y, text: String(y) })),
      onPick: async (y) => ctx.replace(await changeYear(state, y, { loadJSON, store })),
    })
    : staticPicker("Starting", String(state.year)));

  const lowConfidence = course.confidence === "low"
    ? h("p", { class: "note center" }, "Some rules for this degree couldn't be read automatically. ",
      course.sourceUrl ? h("a", { href: course.sourceUrl, target: "_blank", rel: "noopener" }, "Check the handbook") : "Check the handbook",
      ".")
    : null;

  const node = h("div", {},
    topbar(undefined, infoButton()),
    h("section", { class: "dashboard" },
      h("h1", { class: "page-title" }, course.name),
      h("div", { class: "pickers" }, pickers),
      notes(state),
      numbers(state),
      h("div", { class: "plan-cta" },
        h("a", { class: "plan-button", href: hashFor(state, "plan"), "data-key": "plan-button" }, "Study plan")),
      lowConfidence,
      footer(course)),
  );
  return { node, title: `${course.name} · Degree Planner` };
}
