// Setup page (phase 5b): pick majors/minors (or stream) and the start year,
// then Continue to the plan page. The only place these can be changed.
import { loadJSON } from "./data.js";
import { footer, loadCourse, lowConfidenceNote, notFound, topbar } from "./dashboard.js";
import { h } from "./dom.js";
import { infoButton } from "./info.js";
import { applySetup } from "./state.js";
import { browserStore } from "./store.js";

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function field(id, label, select) {
  return h("div", { class: "field" }, h("label", { class: "field-label", for: id }, label), h("div", { class: "select-wrap" }, select));
}

export async function renderSetup(ctx) {
  const state = await loadCourse(ctx);
  if (!state.course) return notFound(state);
  const { course } = state;
  const choices = course.choices ?? [];

  const selects = choices.map((ch) => {
    const kinds = new Set(ch.options.map((o) => o.kind));
    const current = state.choices[ch.id] ?? "";
    const required = ch.required !== false;
    const select = h("select", { id: `setup-${ch.id}`, class: "select", "data-key": `setup-${ch.id}` },
      h("option", { value: "", disabled: required ? true : null, selected: current === "" ? true : null }, required ? "Choose…" : "None"),
      ch.options.map((o) => h("option", { value: o.id, selected: o.id === current ? true : null },
        kinds.size > 1 ? `${o.name} ${cap(o.kind)}` : o.name)));
    return { ch, select, required };
  });

  const years = [...ctx.meta.handbookYears].sort((a, b) => b - a);
  const yearSelect = h("select", { id: "setup-year", class: "select", "data-key": "setup-year" },
    years.map((y) => h("option", { value: String(y), selected: y === state.year ? true : null }, String(y))));

  const warning = h("p", { class: "note", "aria-live": "polite" });
  const go = h("button", { type: "button", class: "plan-button", "data-key": "setup-continue" }, "Continue");

  function update() {
    const picked = selects.filter((x) => x.select.value);
    go.disabled = selects.some((x) => x.required && !x.select.value);
    const comps = picked.map((x) => x.ch.options.find((o) => o.id === x.select.value)?.component);
    warning.textContent = new Set(comps).size < comps.length ? "Pick a different subject for your second major or minor." : "";
  }
  for (const x of selects) x.select.addEventListener("change", update);
  update();

  go.addEventListener("click", async () => {
    if (go.disabled) return;
    const picked = Object.fromEntries(selects.filter((x) => x.select.value).map((x) => [x.ch.id, x.select.value]));
    go.disabled = true;
    const hash = await applySetup(state, { year: Number(yearSelect.value), choices: picked }, { loadJSON, store: browserStore() });
    location.hash = hash; // a new history entry, so Back returns here
  });

  const node = h("div", {},
    topbar(undefined, infoButton()),
    h("section", { class: "setup" },
      h("h1", { class: "page-title" }, course.name),
      h("p", { class: "note" }, choices.length ? "Choose your study areas and the year you started." : "Choose the year you started."),
      selects.map((x) => field(x.select.id, x.ch.label, x.select)),
      field("setup-year", "Year you started", yearSelect),
      warning,
      h("div", { class: "setup-actions" }, go),
      lowConfidenceNote(course),
      footer(course)),
  );
  return { node, title: `Set up · ${course.name} · Degree Planner` };
}
