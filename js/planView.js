// Study plan page (build guide §6.4, phase 4 brief §4). The page keeps its
// state in memory: edits re-draw in place and write the address after 150 ms,
// instead of reloading through the router.
import { loadCourse, notFound, notes, numbers, topbar } from "./dashboard.js";
import { h } from "./dom.js";
import { placeholderLabel, unitSummary } from "./engine/describe.js";
import {
  addSemester, addUnit, removeCell, removeLastSemester, replacePlaceholder, toggleTaken, undoRemove,
} from "./engine/edit.js";
import { leafMatches, leavesUnder } from "./engine/expand.js";
import { MAX_SLOTS, MAX_SEMESTERS, calendarYear, cellCp, semesterLabel, takesSlot, yearOf } from "./engine/plan.js";
import { prereqsOf, unlocks } from "./engine/rules.js";
import { infoButton } from "./info.js";
import { openSheet } from "./sheet.js";
import { editPlan, hashFor } from "./state.js";
import { browserStore } from "./store.js";
import { hideTooltip, showTooltip } from "./tooltip.js";

const HOVER_DELAY = 120;
const LEAVE_DELAY = 80;
const WRITE_DELAY = 150;
const UNDO_TIME = 5000;
const FROM_PAGES = new Set(["dashboard", "requirements"]);

export async function renderPlan(ctx) {
  let state = await loadCourse(ctx);
  if (!state.course) return notFound(state);
  const store = browserStore();
  const course = state.course;

  const headerHost = h("div", { class: "plan-header-host" });
  const sheetHost = h("div", { class: "sheet-host" });
  const bodyHost = h("div", { class: "plan-body" });
  const undoHost = h("div", { class: "undo-host", "aria-live": "polite" });
  const root = h("div", { class: "plan-page" }, headerHost, sheetHost, bodyHost, undoHost);

  let edited = false;
  let writeTimer = null;
  let undo = null; // { removed, label, timer }
  let cells = new Map(); // "s:i" -> element
  let hoverTimer = null;
  let leaveTimer = null;

  // ------------------------------------------------------------ editing

  function apply(plan, { keepUndo = false } = {}) {
    const r = editPlan(state, plan, { store });
    state = r.state;
    edited = true;
    if (!keepUndo) clearUndo();
    draw();
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => ctx.write(r.hash), WRITE_DELAY);
  }

  function remove(s, i) {
    const cell = state.plan.semesters[s][i];
    const label = cell.ph ? placeholderLabel(state.catalog, state.expanded, cell.ph).short : cell.code;
    const r = removeCell(state.plan, s, i);
    apply(r.plan);
    showUndo(r.removed, label);
    // Keep the keyboard user near where they were.
    const next = cells.get(`${s}:${Math.min(i, state.plan.semesters[s].length - 1)}`)
      ?? bodyHost.querySelector(`[data-key="cell-${s}-slot-0"]`);
    next?.focus();
  }

  function showUndo(removed, label) {
    clearUndo();
    const button = h("button", { type: "button", class: "undo-button", "data-key": "undo" }, "Undo");
    button.addEventListener("click", () => {
      const back = undo.removed;
      clearUndo();
      apply(undoRemove(state.plan, back));
    });
    undo = { removed, timer: setTimeout(clearUndo, UNDO_TIME) };
    undoHost.replaceChildren(h("p", { class: "undo" }, `Removed ${label} · `, button));
  }

  function clearUndo() {
    if (undo) clearTimeout(undo.timer);
    undo = null;
    undoHost.replaceChildren();
  }

  // ------------------------------------------------------------ add-unit sheet

  function sheet({ title, filter = null, place, opener }) {
    hideTooltip();
    const onPlan = new Set(state.plan.semesters.flat().filter((c) => c.code).map((c) => c.code));
    const openerKey = opener?.dataset.key;
    openSheet(sheetHost, {
      catalog: state.catalog,
      title,
      filter,
      onPlan,
      onChoose: async (code) => {
        await state.catalog.ensureUnits([code]);
        const r = place(code);
        if (r.error) return r.error;
        apply(r.plan);
        bodyHost.querySelector(`[data-key="cell-${code}"]`)?.focus();
        return null;
      },
      onClose: (refocus) => {
        if (refocus && openerKey) root.querySelector(`[data-key="${openerKey}"]`)?.focus();
      },
    });
  }

  const addAnywhere = (opener) => sheet({
    title: "Add a unit",
    place: (code) => addUnit(state.catalog, state.plan, code),
    opener,
  });

  const addToSemester = (s, opener) => sheet({
    title: `Add a unit to ${semesterLabel(s)}`,
    place: (code) => addUnit(state.catalog, state.plan, code, { s }),
    opener,
  });

  function choosePlaceholder(s, i, opener) {
    const id = state.plan.semesters[s][i].ph;
    const node = state.expanded.byId[id];
    const leaves = node ? leavesUnder(node) : [];
    sheet({
      title: `Choose a unit for ${placeholderLabel(state.catalog, state.expanded, id).full}`,
      filter: leaves.length ? (code) => leaves.some((l) => leafMatches(state.catalog, l, code)) : null,
      place: (code) => ({ plan: replacePlaceholder(state.plan, s, i, code) }),
      opener,
    });
  }

  // ------------------------------------------------------------ hover

  function clearHighlights() {
    for (const el of cells.values()) el.classList.remove("pre", "unlock");
  }

  function hoverStart(el, s, i, immediate) {
    clearTimeout(leaveTimer);
    clearTimeout(hoverTimer);
    const run = () => {
      clearHighlights();
      const cell = state.plan.semesters[s][i];
      if (cell.code) {
        for (const p of prereqsOf(state.catalog, state.plan, s, i)) cells.get(`${p.s}:${p.i}`)?.classList.add("pre");
        for (const p of unlocks(state.catalog, state.plan, s, i)) cells.get(`${p.s}:${p.i}`)?.classList.add("unlock");
        showTooltip(el, unitSummary(state.catalog, cell.code, state.checks.cells[s][i]));
      } else {
        const { full } = placeholderLabel(state.catalog, state.expanded, cell.ph);
        showTooltip(el, { title: full, lines: ["Click to choose a unit"] });
      }
    };
    if (immediate) run();
    else hoverTimer = setTimeout(run, HOVER_DELAY);
  }

  function hoverEnd() {
    clearTimeout(hoverTimer);
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      clearHighlights();
      hideTooltip();
    }, LEAVE_DELAY);
  }

  // ------------------------------------------------------------ drawing

  function header() {
    const back = h("a", { class: "back", href: hashFor(state, "dashboard") }, `← ${course.name}`);
    back.addEventListener("click", (e) => {
      // Going back in history is only right while the earlier page's address is current.
      const from = ctx.from;
      if (!edited && from && from.course === ctx.route.course && FROM_PAGES.has(from.page)) {
        e.preventDefault();
        history.back();
      }
    });
    const addSem = h("button", { type: "button", class: "text-button", "data-key": "add-semester" }, "+ Semester");
    addSem.disabled = state.plan.semesters.length >= MAX_SEMESTERS;
    addSem.addEventListener("click", () => apply(addSemester(state.plan)));
    const addU = h("button", { type: "button", class: "text-button", "data-key": "add-unit" }, "+ Unit");
    addU.addEventListener("click", () => addAnywhere(addU));
    return h("header", { class: "plan-header" },
      h("div", { class: "plan-header-start" }, back),
      numbers(state, true),
      h("div", { class: "plan-header-actions" }, addSem, addU, infoButton()));
  }

  function cellLabel(cell, check) {
    if (cell.ph) return `${placeholderLabel(state.catalog, state.expanded, cell.ph).short}, to choose`;
    const u = state.catalog.unit(cell.code);
    const parts = [cell.code, u?.name ?? "not in the unit list"];
    if (cell.taken) parts.push("taken");
    if (check?.status === "broken") parts.push("rules not met");
    return parts.join(", ");
  }

  function tile(cell, s, i, { pill = false } = {}) {
    const check = state.checks.cells[s]?.[i];
    const cls = ["tile"];
    let content;
    if (cell.ph) {
      cls.push("placeholder");
      content = h("span", { class: "tile-ph" }, placeholderLabel(state.catalog, state.expanded, cell.ph).short);
    } else {
      cls.push(pill ? "pill" : "unit");
      if (cell.taken) cls.push("taken");
      if (check?.status === "broken") cls.push("broken");
      const unknown = !state.catalog.unit(cell.code);
      content = [h("span", { class: "tile-code" }, cell.code), unknown ? h("span", { class: "tile-unknown" }, "?") : null];
    }
    const key = cell.code ? `cell-${cell.code}` : `cell-${s}-ph-${i}`;
    const el = h("button", { type: "button", class: cls.join(" "), "data-key": key, "aria-label": cellLabel(cell, check) }, content);
    el.addEventListener("click", () => {
      hideTooltip();
      if (cell.ph) choosePlaceholder(s, i, el);
      else apply(toggleTaken(state.plan, s, i));
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove(s, i);
      } else if (e.key === "Enter" && cell.code) {
        e.preventDefault(); // Enter picks a unit up in phase 5.
      }
    });
    el.addEventListener("mouseenter", () => hoverStart(el, s, i, false));
    el.addEventListener("mouseleave", hoverEnd);
    el.addEventListener("focus", () => hoverStart(el, s, i, true));
    el.addEventListener("blur", hoverEnd);
    cells.set(`${s}:${i}`, el);
    return el;
  }

  function emptySlot(s, row) {
    const el = h("button", {
      type: "button",
      class: "tile empty",
      "data-key": `cell-${s}-slot-${row}`,
      "aria-label": `Empty slot, ${semesterLabel(s)}`,
    });
    el.addEventListener("click", () => addToSemester(s, el));
    return el;
  }

  function columnHeader(sem, s, last) {
    const cp = sem.reduce((sum, c) => sum + cellCp(state.catalog, c), 0);
    const over = sem.filter((c) => takesSlot(state.catalog, c)).length > MAX_SLOTS;
    const label = semesterLabel(s);
    const remove = last && !sem.length && s > 0
      ? h("button", { type: "button", class: "sem-remove", "aria-label": `Remove ${label}`, "data-key": `remove-sem-${s}` }, "×")
      : null;
    remove?.addEventListener("click", () => apply(removeLastSemester(state.plan)));
    return h("div", { class: "sem-head" },
      h("p", { class: "sem-title" }, `Year ${yearOf(s)} · S${(s % 2) + 1}`, remove),
      h("p", { class: "sem-sub" }, `${calendarYear(state.catalog, s)} · ${cp} cp`),
      over ? h("p", { class: "sem-sub" }, "Over 4 units") : null);
  }

  function grid() {
    cells = new Map();
    const sems = state.plan.semesters;
    const rows = Math.max(MAX_SLOTS, ...sems.map((sem) => sem.filter((c) => takesSlot(state.catalog, c)).length));
    const items = [];
    sems.forEach((sem, s) => {
      const col = s + 1;
      const at = (el, row) => {
        el.style.gridColumn = String(col);
        el.style.gridRow = String(row);
        return el;
      };
      items.push(at(columnHeader(sem, s, s === sems.length - 1), 1));
      let row = 0;
      const pills = [];
      sem.forEach((cell, i) => {
        if (takesSlot(state.catalog, cell)) items.push(at(tile(cell, s, i), 2 + row++));
        else pills.push(tile(cell, s, i, { pill: true }));
      });
      for (let r = row; r < MAX_SLOTS; r++) items.push(at(emptySlot(s, r), 2 + r));
      items.push(at(h("div", { class: "pill-strip" }, pills), 2 + rows));
    });
    const g = h("div", { class: "grid", role: "group", "aria-label": "Study plan" }, items);
    g.style.gridTemplateColumns = `repeat(${sems.length}, var(--col))`;
    return h("div", { class: "grid-scroll" }, g);
  }

  function draw() {
    const key = document.activeElement?.dataset?.key;
    const scroll = bodyHost.querySelector(".grid-scroll")?.scrollLeft ?? 0;
    hideTooltip();
    clearTimeout(hoverTimer);
    headerHost.replaceChildren(header());
    const suggestion = state.planSource === "generated"
      ? h("p", { class: "note" }, "This is a suggested plan. Click units you've done to mark them as taken.")
      : null;
    bodyHost.replaceChildren(h("div", { class: "plan-notes" }, notes(state), suggestion), grid());
    const scroller = bodyHost.querySelector(".grid-scroll");
    if (scroller) {
      scroller.scrollLeft = scroll;
      scroller.addEventListener("scroll", hideTooltip, { passive: true });
    }
    if (key) root.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
  }

  draw();
  return { node: root, title: `Study plan · ${course.name} · Degree Planner` };
}
