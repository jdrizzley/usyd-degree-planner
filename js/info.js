// The (i) "How to use" popover (build guide §6.5).
import { h } from "./dom.js";

const TEXT = [
  "Click a unit to mark it as taken. Drag units to move them between semesters. Drag a unit off the plan to remove it. Use + Unit to add one, + Semester to add a semester.",
  "Red means a unit's rules aren't met. Hover it to see why. When you hover a unit, its prerequisites and the units it unlocks get a thick outline and everything else fades.",
  "Failed a unit? Shift-click it (or press F) to mark it as failed. It counts for nothing, so add the retake to a later semester with + Unit.",
  "With a keyboard: Space marks a unit as taken, F marks it as failed, Enter picks it up, the arrow keys move it, Enter drops it, and Delete removes it.",
  "Your plan is saved in the page address. Bookmark it to come back.",
  "Unofficial. Data comes from the University of Sydney handbook and may be out of date.",
];

export function infoButton() {
  const button = h("button", {
    type: "button",
    class: "info-button",
    "aria-label": "How to use",
    "aria-expanded": "false",
    "aria-controls": "info-card",
    "data-key": "info",
  }, "i");
  const card = h("div", { id: "info-card", class: "info-card", role: "dialog", "aria-label": "How to use", tabindex: "-1", hidden: true },
    h("h2", { class: "info-title" }, "How to use"),
    TEXT.map((t) => h("p", {}, t)));
  const wrap = h("div", { class: "info" }, button, card);

  function onOutside(e) {
    if (!wrap.contains(e.target)) close(false);
  }
  function onKey(e) {
    if (e.key === "Escape") close(true);
  }
  function open() {
    card.hidden = false;
    button.setAttribute("aria-expanded", "true");
    card.focus();
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey);
  }
  function close(refocus) {
    if (card.hidden) return;
    card.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey);
    if (refocus) button.focus();
  }
  button.addEventListener("click", () => (card.hidden ? open() : close(true)));
  return wrap;
}
