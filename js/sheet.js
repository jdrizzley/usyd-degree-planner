// Add-unit sheet (phase 4 brief §5): a search box in the home-page style
// that opens under the plan header.
import { h } from "./dom.js";
import { searchUnits } from "./engine/units.js";

const VISIBLE = 50;
const CODE = /^[A-Za-z]{4}\d{4}$/;

function sessionText(sessions) {
  if (!Array.isArray(sessions)) return "";
  if (!sessions.length) return "Not recent";
  return [...sessions].sort().join(", ");
}

// host: element the sheet renders into. onChoose(code) returns an error
// message (string) to show, or nothing when the unit was added.
export function openSheet(host, { catalog, title, filter = null, onPlan = new Set(), onChoose, onClose }) {
  let results = [];
  let active = -1;
  let closed = false;

  const input = h("input", {
    class: "search-input",
    type: "text",
    role: "combobox",
    "aria-label": title,
    "aria-autocomplete": "list",
    "aria-expanded": "true",
    "aria-controls": "sheet-results",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
  });
  const list = h("ul", { id: "sheet-results", class: "suggestions", role: "listbox", "aria-label": "Units" });
  const error = h("p", { class: "sheet-error", "aria-live": "polite" });
  const box = h("div", { class: "search" }, input, h("div", { class: "suggestions-wrap" }, list));
  const sheet = h("section", { class: "sheet" }, h("p", { class: "sheet-title" }, title), box, error);

  function setActive(i) {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    const li = list.children[i];
    if (i >= 0 && li?.id) {
      input.setAttribute("aria-activedescendant", li.id);
      li.scrollIntoView?.({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  async function choose(code) {
    error.textContent = "";
    const message = await onChoose(code);
    if (message) error.textContent = message;
    else close(false);
  }

  function row(r, i) {
    const taken = onPlan.has(r.code);
    return h("li", {
      id: `sheet-option-${i}`,
      class: taken ? "suggestion unit-row on-plan" : "suggestion unit-row",
      role: "option",
      "aria-selected": "false",
      "aria-disabled": taken ? "true" : null,
      onmousedown: (e) => e.preventDefault(),
      onmouseenter: () => setActive(i),
      onclick: () => !taken && choose(r.code),
    },
    h("span", { class: "unit-row-code" }, r.code),
    h("span", { class: "unit-row-name" }, r.name),
    h("span", { class: "unit-row-meta" }, `${r.cp} cp`),
    h("span", { class: "unit-row-meta" }, taken ? "On your plan" : sessionText(r.sessions)));
  }

  function render() {
    const query = input.value.trim();
    results = searchUnits(catalog.listUnits(), query, { filter, limit: VISIBLE });
    const items = results.map(row);
    if (!results.length && query) {
      items.push(h("li", { class: "suggestion empty", "aria-disabled": "true" }, `No unit matches "${query}"`));
      const code = query.toUpperCase();
      if (CODE.test(query) && !catalog.hasUnit(code) && !onPlan.has(code)) {
        results = [{ code, anyway: true }];
        items.unshift(h("li", {
          id: "sheet-option-0",
          class: "suggestion",
          role: "option",
          "aria-selected": "false",
          onmousedown: (e) => e.preventDefault(),
          onmouseenter: () => setActive(0),
          onclick: () => choose(code),
        }, `Add ${code} anyway`));
      }
    }
    list.replaceChildren(...items);
    box.classList.toggle("open", items.length > 0);
    setActive(-1);
  }

  function onOutside(e) {
    if (!sheet.contains(e.target)) close(false);
  }

  function close(refocus = true) {
    if (closed) return;
    closed = true;
    document.removeEventListener("pointerdown", onOutside, true);
    sheet.remove();
    onClose?.(refocus);
  }

  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    const n = results.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (n) setActive((active + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setActive(active <= 0 ? n - 1 : active - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active >= 0 ? active : 0];
      if (pick && !onPlan.has(pick.code)) choose(pick.code);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    }
  });

  host.replaceChildren(sheet);
  render();
  input.focus();
  document.addEventListener("pointerdown", onOutside, true);
  return () => close(false);
}
