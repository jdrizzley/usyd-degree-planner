// One shared tooltip for plan tiles (phase 4 brief §6). Not interactive.
import { h } from "./dom.js";

const ID = "plan-tooltip";
let el = null;
let anchor = null;

function ensure() {
  if (!el) {
    el = h("div", { id: ID, class: "tooltip", role: "tooltip", hidden: true });
    document.body.append(el);
    // Any scroll moves the anchor away from the tooltip.
    window.addEventListener("scroll", hideTooltip, true);
  }
  return el;
}

const noteText = (n) => (/^(Also|Assumed)/.test(n) ? n : `Also: ${n}`);

export function showTooltip(target, { title, lines = [], reasons = [], notes = [] }) {
  const tip = ensure();
  hideTooltip();
  // replaceChildren doesn't flatten arrays (h() does), so spread them.
  tip.replaceChildren(
    h("p", { class: "tooltip-title" }, title),
    ...lines.map((t) => h("p", { class: "tooltip-line" }, t)),
    ...reasons.map((t) => h("p", { class: "tooltip-reason" }, t)),
    ...notes.map((t) => h("p", { class: "tooltip-note" }, noteText(t))),
  );
  tip.hidden = false;
  anchor = target;
  target.setAttribute("aria-describedby", ID);

  // 8px above the tile, centred; below if there's no room; 8px inside the viewport.
  const r = target.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let top = r.top - t.height - 8;
  if (top < 8) top = r.bottom + 8;
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8));
  tip.style.top = `${Math.round(top + window.scrollY)}px`;
  tip.style.left = `${Math.round(left + window.scrollX)}px`;
}

export function hideTooltip() {
  if (!el || el.hidden) return;
  el.hidden = true;
  anchor?.removeAttribute("aria-describedby");
  anchor = null;
}
