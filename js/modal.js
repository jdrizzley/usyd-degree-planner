// Centred dialog with an × (phase 5b): Esc, the ×, or a click outside closes it.
import { h } from "./dom.js";

export function openModal({ title, body, opener = null }) {
  const close = h("button", { type: "button", class: "modal-close", "aria-label": "Close" }, "×");
  const box = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" },
    close,
    h("h2", { class: "modal-title" }, title),
    h("div", { class: "modal-body" }, body));
  const backdrop = h("div", { class: "modal-backdrop" }, box);

  function shut() {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
    if (opener?.isConnected) opener.focus();
  }
  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      shut();
    } else if (e.key === "Tab") {
      // Keep focus inside: the box and its × are the only stops.
      e.preventDefault();
      (document.activeElement === close ? box : close).focus();
    }
  }
  close.addEventListener("click", shut);
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) shut();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  box.focus();
  return shut;
}
