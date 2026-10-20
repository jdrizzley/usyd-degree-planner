// Shared pieces of the course pages (setup, plan, requirements): top bar,
// messages, state loading, notes, footer and the big numbers.
import { loadJSON } from "./data.js";
import { h } from "./dom.js";
import { hashFor, loadState } from "./state.js";
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

const handbookLink = (course, text = "Check handbook") =>
  (course.sourceUrl ? h("a", { href: course.sourceUrl, target: "_blank", rel: "noopener" }, text) : text);

export function footer(course) {
  return h("footer", { class: "footer" },
    "Unofficial. Not affiliated with the University of Sydney. ", handbookLink(course), ".");
}

export function lowConfidenceNote(course) {
  if (course.confidence !== "low") return null;
  return h("p", { class: "note" }, "Some rules for this degree couldn't be read automatically. ", handbookLink(course), ".");
}

// Notes: year fallback, old links, engine warnings.
export function notes(state) {
  return [state.yearNote, state.formatNote, ...(state.progress.warnings ?? [])]
    .filter(Boolean)
    .map((t) => h("p", { class: "note" }, t));
}

// ---------------------------------------------------------------- numbers

const TICK = '<svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true"><path d="M11 25l9 9 17-19" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS = '<svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true"><path d="M14 14l20 20M34 14L14 34" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>';

function icon(svg) {
  const s = h("span", { class: "num-value num-icon" });
  s.innerHTML = svg;
  return s;
}

function numberCard({ key, label, value, done, href }) {
  return h("a", { class: done ? "num done" : "num", href, "data-key": key },
    h("span", { class: "num-value" }, String(value)),
    h("span", { class: "num-label" }, label),
    h("span", { class: "num-unit" }, "credit points"));
}

// Taken · Left · Required · Valid plan. onInvalid opens the reasons pop-up.
export function numbers(state, { onInvalid } = {}) {
  const p = state.progress;
  const href = hashFor(state, "requirements");
  const finished = p.takenCp >= p.requiredCp;
  const valid = state.validity?.valid;
  const validCard = valid
    ? h("div", { class: "num valid", "data-key": "num-valid" },
      icon(TICK), h("span", { class: "num-label" }, "Valid plan"), h("span", { class: "num-unit" }, "meets every requirement"))
    : h("button", {
      type: "button",
      class: "num invalid",
      "data-key": "num-valid",
      "aria-haspopup": "dialog",
      onclick: () => onInvalid?.(),
    }, icon(CROSS), h("span", { class: "num-label" }, "Valid plan"), h("span", { class: "num-unit" }, "see what's missing"));
  return h("div", { class: "numbers" },
    numberCard({ key: "num-taken", label: "Taken", value: p.takenCp, done: finished, href }),
    numberCard({ key: "num-left", label: "Left", value: Math.max(0, p.requiredCp - p.takenCp), done: finished, href }),
    numberCard({ key: "num-required", label: "Required", value: p.requiredCp, done: p.complete, href }),
    validCard);
}
