// The plan page (build guide §6.4, phase 4 brief §4, phase 5b): degree title,
// the four numbers, the grid and + Semester / + Unit, all centred. The page
// keeps its state in memory: edits re-draw in place and write the address
// after 150 ms, instead of reloading through the router.
import { footer, loadCourse, lowConfidenceNote, notFound, notes, numbers, topbar } from "./dashboard.js";
import { h } from "./dom.js";
import { placeholderLabel } from "./engine/describe.js";
import { attachDrag } from "./drag.js";
import {
  addSemester, addUnit, moveCell, removeCell, removeLastSemester, replacePlaceholder, stepTarget, targetAt,
  toggleFailed, toggleTaken, undoRemove,
} from "./engine/edit.js";
import { leafMatches, leavesUnder } from "./engine/expand.js";
import { MAX_SEMESTERS, calendarYear, rowsFor, semesterLabel } from "./engine/plan.js";
import { prereqsOf, unlocks } from "./engine/rules.js";
import { infoButton } from "./info.js";
import { openModal } from "./modal.js";
import { openSheet } from "./sheet.js";
import { choiceSummary, editPlan, hashFor, missingRequired } from "./state.js";
import { browserStore } from "./store.js";
import { hideTooltip, showTooltip } from "./tooltip.js";

const HOVER_DELAY = 120;
const LEAVE_DELAY = 80; // highlights only; the conflict pop-up hides at once
const WRITE_DELAY = 150;
const UNDO_TIME = 5000;
const FROM_PAGES = new Set(["setup"]);

// The previous plan page's drag listeners, removed when a new one renders.
let detachPrevious = null;
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export async function renderPlan(ctx) {
  let state = await loadCourse(ctx);
  if (!state.course) return notFound(state);
  // Old /plan links, and links missing a required choice, go elsewhere.
  if (ctx.route.page === "plan" || missingRequired(state).length) {
    ctx.replace(hashFor(state, missingRequired(state).length ? "setup" : "dashboard"));
    return { node: h("div"), title: "Degree Planner" };
  }
  const store = browserStore();
  const course = state.course;

  const headerHost = h("div", { class: "plan-top" });
  const sheetHost = h("div", { class: "sheet-host" });
  const bodyHost = h("div", { class: "plan-body" });
  const undoHost = h("div", { class: "undo-host", "aria-live": "polite" });
  const live = h("p", { class: "visually-hidden", "aria-live": "assertive" });
  const root = h("div", { class: "plan-page" }, headerHost, sheetHost, bodyHost, undoHost, live);

  let edited = false;
  let writeTimer = null;
  let undo = null; // { removed, label, timer }
  let cells = new Map(); // "s:i" -> element
  let hoverTimer = null;
  let leaveTimer = null;
  let carry = null; // keyboard move: { from: {s, i}, at: {s, row}, el }

  const announce = (text) => {
    live.textContent = "";
    setTimeout(() => { live.textContent = text; }, 30);
  };

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

  // Shift-click / F: failed <-> normal. Focus stays on the tile.
  function fail(s, i) {
    const cell = state.plan.semesters[s][i];
    if (!cell?.code) return;
    apply(toggleFailed(state.plan, s, i));
    cells.get(`${s}:${i}`)?.focus();
    announce(`${cell.code} ${cell.failed ? "is no longer marked failed" : "marked failed"}.`);
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
    // Failed attempts don't count: the retake can still be added.
    const onPlan = new Set(state.plan.semesters.flat().filter((c) => c.code && !c.failed).map((c) => c.code));
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
    for (const el of cells.values()) el.classList.remove("pre", "unlock", "spot-src");
    bodyHost.classList.remove("spotlight");
  }

  function hoverStart(el, s, i, immediate) {
    if (carry || bodyHost.classList.contains("dragging")) return;
    clearTimeout(leaveTimer);
    clearTimeout(hoverTimer);
    const run = () => {
      clearHighlights();
      hideTooltip();
      const cell = state.plan.semesters[s][i];
      if (cell.code) {
        const pre = prereqsOf(state.catalog, state.plan, s, i);
        const after = unlocks(state.catalog, state.plan, s, i);
        for (const p of pre) cells.get(`${p.s}:${p.i}`)?.classList.add("pre");
        for (const p of after) cells.get(`${p.s}:${p.i}`)?.classList.add("unlock");
        // Spotlight: linked tiles get a thick ring, everything else fades (styles.css).
        if (pre.length || after.length) {
          el.classList.add("spot-src");
          bodyHost.classList.add("spotlight");
        }
        // The pop-up is only for conflicts, and only says why.
        const check = state.checks.cells[s][i];
        if (check?.status === "broken") showTooltip(el, { reasons: check.reasons });
      }
    };
    if (immediate) run();
    else hoverTimer = setTimeout(run, HOVER_DELAY);
  }

  function hoverEnd() {
    clearTimeout(hoverTimer);
    clearTimeout(leaveTimer);
    hideTooltip(); // the conflict pop-up never outlives the pointer leaving its tile
    leaveTimer = setTimeout(clearHighlights, LEAVE_DELAY);
  }

  // ------------------------------------------------------------ moving

  const isValid = (from, target) => {
    const r = moveCell(state.catalog, state.plan, from, target);
    return !r.error && !r.same;
  };

  const nameOf = (cell) => (cell.ph ? placeholderLabel(state.catalog, state.expanded, cell.ph).short : cell.code);

  // Do a move and say what happened. Returns false if it was refused.
  function doMove(from, target) {
    const cell = state.plan.semesters[from.s][from.i];
    const other = target.kind === "cell" ? state.plan.semesters[target.s][target.i] : null;
    const r = moveCell(state.catalog, state.plan, from, target);
    if (r.error) {
      announce(r.error);
      return false;
    }
    if (r.same) return false;
    const swapped = !!other;
    apply(r.plan);
    announce(swapped ? `Swapped ${nameOf(cell)} and ${nameOf(other)}.` : `Moved ${nameOf(cell)} to ${semesterLabel(r.at.s)}.`);
    const moved = cell.code ? bodyHost.querySelector(`[data-key="cell-${cell.code}"]`) : cells.get(`${r.at.s}:${r.at.i}`);
    moved?.focus();
    return true;
  }

  const rowOf = (s, i) => i; // cells fill rows from the top

  // The element a keyboard target points at, for the outline.
  function targetEl(t) {
    if (t.kind === "cell") return cells.get(`${t.s}:${t.i}`);
    return bodyHost.querySelector(`[data-key="cell-${t.s}-slot-${carry.at.row}"]`)
      ?? [...bodyHost.querySelectorAll(".tile.empty")].find((e) => Number(e.dataset.s) === t.s)
      ?? null;
  }

  function showCarryTarget() {
    for (const e of bodyHost.querySelectorAll(".drop-over")) e.classList.remove("drop-over");
    const t = targetAt(state.catalog, state.plan, carry.at.s, carry.at.row);
    targetEl(t)?.classList.add("drop-over");
    const where = `${semesterLabel(carry.at.s)}, row ${carry.at.row + 1}`;
    if (t.kind === "cell" && !(t.s === carry.from.s && t.i === carry.from.i)) {
      announce(`${where}, swap with ${nameOf(state.plan.semesters[t.s][t.i])}`);
    } else if (t.kind === "cell") {
      announce(`${where}, where it started`);
    } else {
      announce(`${where}, empty`);
    }
    return t;
  }

  function pickUp(el, s, i) {
    hideTooltip();
    clearHighlights();
    carry = { from: { s, i }, at: { s, row: rowOf(s, i) }, el };
    el.classList.add("drag-source");
    bodyHost.classList.add("carrying");
    for (const t of bodyHost.querySelectorAll("[data-drop]")) {
      if (t !== el && isValid(carry.from, t.dataset.drop === "cell"
        ? { kind: "cell", s: Number(t.dataset.s), i: Number(t.dataset.i) }
        : { kind: "semester", s: Number(t.dataset.s) })) t.classList.add("drop-ok");
    }
    announce(`Picked up ${nameOf(state.plan.semesters[s][i])}. Arrow keys to move, Enter to drop, Escape to cancel.`);
  }

  function endCarry() {
    if (!carry) return;
    carry.el.classList.remove("drag-source");
    bodyHost.classList.remove("carrying");
    for (const e of bodyHost.querySelectorAll(".drop-ok, .drop-over")) e.classList.remove("drop-ok", "drop-over");
    carry = null;
  }

  function cancelCarry() {
    if (!carry) return;
    endCarry();
    announce("Move cancelled.");
  }

  function onTileKey(e, el, s, i) {
    if (carry && carry.el === el) {
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        carry.at = stepTarget(state.catalog, state.plan, carry.at, e.key);
        showCarryTarget();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const t = targetAt(state.catalog, state.plan, carry.at.s, carry.at.row);
        const from = carry.from;
        if (t.kind === "cell" && t.s === from.s && t.i === from.i) return cancelCarry();
        const r = moveCell(state.catalog, state.plan, from, t);
        if (r.error) return announce(r.error);
        endCarry();
        doMove(from, t);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelCarry();
      } else if (e.key === " " || e.key === "Delete" || e.key === "Backspace" || e.key === "Tab") {
        if (e.key !== "Tab") e.preventDefault();
        else cancelCarry();
      }
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(s, i);
    } else if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      fail(s, i);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickUp(el, s, i);
    }
  }

  // ------------------------------------------------------------ drawing

  // ← goes to setup (pre-filled), where majors/minors and the start year live.
  function top() {
    const back = h("a", { class: "back", href: hashFor(state, "setup") }, "← Setup");
    back.addEventListener("click", (e) => {
      // Going back in history is only right while the earlier page's address is current.
      const from = ctx.from;
      if (!edited && from && from.course === ctx.route.course && FROM_PAGES.has(from.page)) {
        e.preventDefault();
        history.back();
      }
    });
    return topbar(back, infoButton());
  }

  function intro() {
    const summary = choiceSummary(state);
    const change = h("a", { class: "change-link", href: hashFor(state, "setup"), "data-key": "change-setup" }, "Change");
    const suggestion = state.planSource === "generated"
      ? h("p", { class: "note" }, "This is a suggested plan. Click units you've done to mark them as taken.")
      : null;
    return h("div", { class: "plan-intro" },
      h("h1", { class: "page-title" }, course.name),
      h("p", { class: "plan-subtitle" }, [summary, `Starting ${state.year}`].filter(Boolean).join(" · "), " · ", change),
      notes(state), suggestion, lowConfidenceNote(course));
  }

  function actions() {
    const addSem = h("button", { type: "button", class: "text-button", "data-key": "add-semester" }, "+ Semester");
    addSem.disabled = state.plan.semesters.length >= MAX_SEMESTERS;
    addSem.addEventListener("click", () => apply(addSemester(state.plan)));
    const addU = h("button", { type: "button", class: "text-button", "data-key": "add-unit" }, "+ Unit");
    addU.addEventListener("click", () => addAnywhere(addU));
    return h("div", { class: "plan-actions" }, addSem, addU);
  }

  // The reasons the plan isn't valid yet, in a centred pop-up.
  function showInvalid() {
    const v = state.validity;
    const section = (title, items) => (items.length
      ? [h("h3", { class: "modal-section" }, title), h("ul", { class: "modal-list" }, items.map((t) => h("li", {}, t)))]
      : []);
    const body = [
      ...section("Requirements not met", v.requirements),
      ...section("Still to choose", v.placeholders.length ? [`${v.placeholders.join(", ")}`] : []),
      ...section("Too many units", v.overfull),
      ...section("Conflicts", v.conflicts.flatMap((c) => c.reasons.map((r) => `${c.code} (${c.where}): ${r}`))),
    ];
    openModal({ title: "Why this plan isn't valid yet", body, opener: bodyHost.querySelector('[data-key="num-valid"]') });
  }

  function cellLabel(cell, check) {
    if (cell.ph) return `${placeholderLabel(state.catalog, state.expanded, cell.ph).short}, to choose`;
    const u = state.catalog.unit(cell.code);
    const parts = [cell.code, u?.name ?? "not in the unit list"];
    if (cell.failed) parts.push("failed");
    if (cell.taken) parts.push("taken");
    if (check?.status === "broken") parts.push("rules not met");
    return parts.join(", ");
  }

  function tile(cell, s, i) {
    const check = state.checks.cells[s]?.[i];
    const cls = ["tile"];
    let content;
    if (cell.ph) {
      cls.push("placeholder");
      content = h("span", { class: "tile-ph" }, placeholderLabel(state.catalog, state.expanded, cell.ph).short);
    } else {
      cls.push("unit");
      if (cell.failed) cls.push("failed");
      if (cell.taken) cls.push("taken");
      if (check?.status === "broken") cls.push("broken");
      const unit = state.catalog.unit(cell.code);
      const code = h("span", { class: "tile-code" }, cell.code, unit ? null : h("span", { class: "tile-unknown" }, " ?"));
      // Hover slides the code up and shows the name underneath (styles.css).
      const name = h("span", { class: "tile-name", "aria-hidden": "true" },
        unit ? unit.name : `Not in the ${state.catalog.year} unit list`);
      content = [code, name];
    }
    // Codes are unique on a plan except for failed attempts (a retake can follow).
    const key = cell.ph ? `cell-${s}-ph-${i}` : cell.failed ? `cell-${cell.code}-failed-${s}` : `cell-${cell.code}`;
    const el = h("button", {
      type: "button",
      class: cls.join(" "),
      "data-key": key,
      "aria-label": cellLabel(cell, check),
      "data-drag": "",
      "data-drop": "cell",
      "data-s": s,
      "data-i": i,
    }, content);
    el.addEventListener("click", (e) => {
      if (!el.isConnected) return; // a tile from before the last re-draw
      hideTooltip();
      if (cell.ph) choosePlaceholder(s, i, el);
      else if (e.shiftKey) fail(s, i);
      else apply(toggleTaken(state.plan, s, i));
    });
    el.addEventListener("keydown", (e) => onTileKey(e, el, s, i));
    el.addEventListener("mouseenter", () => hoverStart(el, s, i, false));
    el.addEventListener("mouseleave", hoverEnd);
    el.addEventListener("focus", () => hoverStart(el, s, i, true));
    el.addEventListener("blur", () => {
      hoverEnd();
      if (carry?.el === el) cancelCarry();
    });
    cells.set(`${s}:${i}`, el);
    return el;
  }

  function emptySlot(s, row) {
    const el = h("button", {
      type: "button",
      class: "tile empty",
      "data-key": `cell-${s}-slot-${row}`,
      "data-drop": "semester",
      "data-s": s,
      "data-row": row,
      "aria-label": `Empty slot, ${semesterLabel(s)}`,
    });
    el.addEventListener("click", () => addToSemester(s, el));
    return el;
  }

  // One bold line: "2026 · S1".
  function columnHeader(sem, s, last) {
    const label = `${calendarYear(state.catalog, s)} · S${(s % 2) + 1}`;
    const remove = last && !sem.length && s > 0
      ? h("button", { type: "button", class: "sem-remove", "aria-label": `Remove ${label}`, "data-key": `remove-sem-${s}` }, "×")
      : null;
    remove?.addEventListener("click", () => apply(removeLastSemester(state.plan)));
    return h("div", { class: "sem-head" }, h("p", { class: "sem-title" }, label, remove));
  }

  function grid() {
    cells = new Map();
    const sems = state.plan.semesters;
    const rows = rowsFor(state.catalog);
    const items = [];
    sems.forEach((sem, s) => {
      const col = s + 1;
      const at = (el, row) => {
        el.style.gridColumn = String(col);
        el.style.gridRow = String(row);
        return el;
      };
      items.push(at(columnHeader(sem, s, s === sems.length - 1), 1));
      sem.forEach((cell, i) => items.push(at(tile(cell, s, i), 2 + i)));
      for (let r = sem.length; r < rows; r++) items.push(at(emptySlot(s, r), 2 + r));
    });
    const g = h("div", { class: "grid", role: "group", "aria-label": "Study plan" }, items);
    g.style.gridTemplateColumns = `repeat(${sems.length}, var(--col))`;
    return h("div", { class: "grid-scroll" }, g);
  }

  function draw() {
    carry = null;
    bodyHost.classList.remove("carrying");
    const key = document.activeElement?.dataset?.key;
    const scroll = bodyHost.querySelector(".grid-scroll")?.scrollLeft ?? 0;
    hideTooltip();
    clearTimeout(hoverTimer);
    headerHost.replaceChildren(top());
    bodyHost.replaceChildren(intro(), numbers(state, { onInvalid: showInvalid }), grid(), actions(), footer(course));
    const scroller = bodyHost.querySelector(".grid-scroll");
    if (scroller) {
      scroller.scrollLeft = scroll;
      scroller.addEventListener("scroll", hideTooltip, { passive: true });
    }
    if (key) root.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
  }

  draw();

  detachPrevious?.();
  detachPrevious = attachDrag(bodyHost, {
    isValid,
    onStart: () => {
      cancelCarry();
      hideTooltip();
      clearTimeout(hoverTimer);
      clearHighlights();
    },
    onDrop: (from, target) => doMove(from, target),
    onRemove: (from) => remove(from.s, from.i),
    reducedMotion,
  });
  const summary = choiceSummary(state);
  return { node: root, title: [course.name, summary, String(state.year), "Degree Planner"].filter(Boolean).join(" · ") };
}
