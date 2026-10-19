// Pointer drag for plan tiles (phase 5 brief §2): move, swap, drag off to remove.
//
// Attached once to a host that survives re-draws; uses event delegation and
// reads positions from data attributes:
//   draggable tile   data-drag data-s data-i
//   drop target      data-drop="cell" data-s data-i  |  data-drop="semester" data-s
import { h } from "./dom.js";

const THRESHOLD = 5;      // px before a mouse press becomes a drag
const LONG_PRESS = 250;   // ms before a touch press becomes a drag
const OUTSIDE = 16;       // px beyond the grid that counts as "off the plan"
const EDGE = 48;          // px from the scroller's edge that auto-scrolls
const EDGE_STEP = 12;     // px per frame
const SLIDE_BACK = 150;   // ms

const posOf = (el) => ({ s: Number(el.dataset.s), i: Number(el.dataset.i) });
const targetOf = (el) => (el.dataset.drop === "cell"
  ? { kind: "cell", s: Number(el.dataset.s), i: Number(el.dataset.i) }
  : { kind: "semester", s: Number(el.dataset.s) });

export function attachDrag(host, { isValid, onStart, onDrop, onRemove, reducedMotion = () => false }) {
  let press = null; // { el, from, x, y, id, touch, timer }
  let drag = null;  // { el, from, ghost, caption, x0, y0, x, y, over, outside, frame }
  let swallowClick = false;

  // ------------------------------------------------------------ press

  function onPointerDown(e) {
    if (drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    const el = e.target.closest?.("[data-drag]");
    if (!el || !host.contains(el)) return;
    swallowClick = false;
    press = { el, from: posOf(el), x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType === "touch" };
    if (press.touch) press.timer = setTimeout(() => press && begin(press.x, press.y), LONG_PRESS);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  function endPress() {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
    if (!drag) removeWindowListeners();
  }

  function removeWindowListeners() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
  }

  function onPointerMove(e) {
    if (drag) {
      if (e.pointerId === drag.id) moveTo(e.clientX, e.clientY);
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y) >= THRESHOLD;
    if (!moved) return;
    if (press.touch) endPress(); // a swipe: let the page scroll
    else begin(e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    if (drag && e.pointerId === drag.id) finish();
    else endPress();
  }

  function onPointerCancel() {
    if (drag) cancel();
    else endPress();
  }

  // ------------------------------------------------------------ drag

  function begin(x, y) {
    const { el, from, id, x: x0, y: y0 } = press;
    endPress();
    onStart?.(from);
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.removeAttribute("data-key");
    ghost.removeAttribute("data-drag");
    ghost.removeAttribute("data-drop");
    ghost.removeAttribute("id");
    ghost.classList.add("drag-ghost");
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const caption = h("p", { class: "drag-caption", hidden: true }, "Release to remove");
    document.body.append(ghost, caption);
    el.classList.add("drag-source");
    host.classList.add("dragging");
    for (const t of host.querySelectorAll("[data-drop]")) {
      if (t !== el && isValid(from, targetOf(t))) t.classList.add("drop-ok");
    }
    drag = { el, from, id, ghost, caption, x0, y0, x, y, over: null, outside: false, frame: 0 };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKey, true);
    moveTo(x, y);
    drag.frame = requestAnimationFrame(edgeScroll);
  }

  function moveTo(x, y) {
    drag.x = x;
    drag.y = y;
    drag.ghost.style.transform = `translate(${x - drag.x0}px, ${y - drag.y0}px)`;

    const grid = host.querySelector(".grid")?.getBoundingClientRect();
    const outside = !grid || x < grid.left - OUTSIDE || x > grid.right + OUTSIDE
      || y < grid.top - OUTSIDE || y > grid.bottom + OUTSIDE;
    drag.outside = outside;
    drag.ghost.classList.toggle("outside", outside);
    drag.caption.hidden = !outside;
    if (outside) Object.assign(drag.caption.style, { left: `${x}px`, top: `${y + 16}px` });

    const hit = outside ? null : document.elementFromPoint(x, y)?.closest?.("[data-drop]");
    const over = hit && hit.classList.contains("drop-ok") && host.contains(hit) ? hit : null;
    if (over !== drag.over) {
      drag.over?.classList.remove("drop-over");
      over?.classList.add("drop-over");
      drag.over = over;
    }
  }

  function edgeScroll() {
    if (!drag) return;
    const scroller = host.querySelector(".grid-scroll");
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (drag.y >= r.top && drag.y <= r.bottom) {
        let dx = 0;
        if (drag.x < r.left + EDGE) dx = -EDGE_STEP;
        else if (drag.x > r.right - EDGE) dx = EDGE_STEP;
        if (dx) {
          scroller.scrollLeft += dx;
          moveTo(drag.x, drag.y); // targets moved under the pointer
        }
      }
    }
    drag.frame = requestAnimationFrame(edgeScroll);
  }

  function onKey(e) {
    if (e.key === "Escape" && drag) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  function cleanup({ slideBack = false } = {}) {
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.frame);
    removeWindowListeners();
    window.removeEventListener("keydown", onKey, true);
    host.classList.remove("dragging");
    for (const t of host.querySelectorAll(".drop-ok, .drop-over")) t.classList.remove("drop-ok", "drop-over");
    d.el.classList.remove("drag-source");
    d.caption.remove();
    if (slideBack && !reducedMotion()) {
      d.ghost.classList.remove("outside");
      d.ghost.classList.add("sliding");
      d.ghost.style.transform = "translate(0px, 0px)";
      setTimeout(() => d.ghost.remove(), SLIDE_BACK + 20);
    } else {
      d.ghost.remove();
    }
    return d;
  }

  // Swallow the click the browser sends right after pointerup, and only that one.
  function swallowNextClick() {
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 0);
  }

  function finish() {
    swallowNextClick();
    const { outside, over, from } = drag;
    if (outside) {
      cleanup();
      onRemove(from);
    } else if (over) {
      const target = targetOf(over);
      cleanup();
      onDrop(from, target);
    } else {
      cleanup({ slideBack: true });
    }
  }

  function cancel() {
    swallowNextClick();
    cleanup({ slideBack: true });
  }

  // ------------------------------------------------------------ browser defaults

  // The click that follows a drag must not toggle the tile.
  function onClick(e) {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }
  // No scrolling while a touch drag runs, and no long-press menu on tiles.
  function onTouchMove(e) {
    if (drag) e.preventDefault();
  }
  function onContextMenu(e) {
    if (press?.touch || drag) e.preventDefault();
  }

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("click", onClick, true);
  host.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("touchmove", onTouchMove, { passive: false });

  return function detach() {
    if (drag) cleanup();
    endPress();
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("click", onClick, true);
    host.removeEventListener("contextmenu", onContextMenu);
    document.removeEventListener("touchmove", onTouchMove);
  };
}
