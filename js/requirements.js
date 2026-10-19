// Requirements view (build guide §6.3, phase 3 brief §6): where the credit
// points have to come from.
import { h } from "./dom.js";
import { requirementRows } from "./engine/describe.js";
import { footer, loadCourse, notFound, notes, topbar } from "./dashboard.js";
import { infoButton } from "./info.js";
import { hashFor } from "./state.js";

const SAME_COURSE_PAGES = new Set(["dashboard", "plan"]);

function unitLine(u, planned) {
  return h("li", { class: planned ? "req-unit planned" : "req-unit" },
    h("span", { class: "req-code" }, u.code),
    h("span", { class: "req-name" }, u.name),
    h("span", { class: "req-cp" }, `${u.cp} cp`),
    planned ? h("span", { class: "req-tag" }, "planned") : null);
}

function panel(r, dashboardHash) {
  if (r.choose) {
    return [h("p", {}, "Pick one on the dashboard to see what it needs. ", h("a", { href: dashboardHash }, "Choose on the dashboard"))];
  }
  const out = [];
  if (r.taken.length || r.plannedUnits.length) {
    out.push(h("ul", { class: "req-units" }, r.taken.map((u) => unitLine(u, false)), r.plannedUnits.map((u) => unitLine(u, true))));
  } else {
    out.push(h("p", { class: "muted" }, "Nothing counted here yet."));
  }
  if (r.missing.length) out.push(h("p", {}, `Still needed: ${r.missing.join(", ")}`));
  if (r.pool) out.push(h("p", {}, r.pool));
  if (r.choices.codes.length) {
    const more = r.choices.more ? ` and ${r.choices.more} more` : "";
    out.push(h("p", { class: "muted" }, `Choose from: ${r.choices.codes.join(", ")}${more}`));
  }
  if (r.link) out.push(h("p", {}, h("a", { href: r.link, target: "_blank", rel: "noopener" }, "Handbook ↗")));
  return out;
}

function rowEl(r, dashboardHash) {
  const count = r.measure === "units" ? `${r.have} / ${r.need} units` : `${r.have} / ${r.need}`;
  const cls = `req-row depth-${Math.min(r.depth, 3)}${r.met ? " met" : ""}`;
  const label = h("span", { class: "req-label" }, r.label,
    r.choose ? h("span", { class: "req-choose" }, " · Choose on the dashboard") : null);
  const nums = h("span", { class: "req-nums" },
    r.planned > 0 ? h("span", { class: "req-planned" }, `+${r.planned} planned`) : null,
    h("span", { class: "req-count" }, count));
  if (!r.expandable) return h("div", { class: cls }, label, nums);

  const panelId = `req-panel-${r.id.replace(/[^a-z0-9-]/gi, "-")}`;
  const body = h("div", { id: panelId, class: `req-panel depth-${Math.min(r.depth, 3)}`, hidden: true }, panel(r, dashboardHash));
  const button = h("button", {
    type: "button",
    class: `${cls} expandable`,
    "aria-expanded": "false",
    "aria-controls": panelId,
    "data-key": `req-${r.id}`,
  }, label, nums);
  button.addEventListener("click", () => {
    body.hidden = !body.hidden;
    button.setAttribute("aria-expanded", String(!body.hidden));
  });
  return [button, body];
}

export async function renderRequirements(ctx) {
  const state = await loadCourse(ctx);
  if (!state.course) return notFound(state);
  const { course, progress: p } = state;
  const dashboardHash = hashFor(state, "dashboard");

  const back = h("a", { class: "back", href: dashboardHash }, "← Back");
  const from = ctx.from;
  if (from && from.course === ctx.route.course && SAME_COURSE_PAGES.has(from.page)) {
    back.addEventListener("click", (e) => {
      e.preventDefault();
      history.back();
    });
  }

  const cards = requirementRows(state.catalog, p).map((card) =>
    h("section", { class: "req-card" }, rowEl({ ...card, depth: 0 }, dashboardHash), card.rows.map((r) => rowEl(r, dashboardHash))));

  const node = h("div", {},
    topbar(back, infoButton()),
    h("section", { class: "requirements" },
      h("div", { class: "req-head" },
        h("h1", { class: "page-title" }, `${course.name} · ${state.year}`),
        h("p", { class: p.complete ? "req-total met" : "req-total" }, `${p.takenCp} of ${p.requiredCp} credit points`)),
      h("p", { class: "note" }, "Counts units marked as taken. Planned units are shown in grey."),
      notes(state),
      cards,
      footer(course)),
  );
  return { node, title: `Requirements · ${course.name} · Degree Planner` };
}
