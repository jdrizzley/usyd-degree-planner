// Dropdown for the dashboard pickers (phase 3 brief §5.2). Plain text with a
// chevron; opens a list styled like the home suggestions.
import { h } from "./dom.js";

const CHEVRON = '<svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function chevron() {
  const s = h("span", { class: "picker-chevron" });
  s.innerHTML = CHEVRON;
  return s;
}

const optionText = (o) => [o.text, o.sub ? h("span", { class: "picker-sub" }, o.sub) : null];

// options: [{ id, text, sub? }]. value: an option id or null.
export function picker({ key, label, value, placeholder = "Choose", options, onPick }) {
  const current = options.find((o) => o.id === value);
  const listId = `${key}-list`;
  let active = -1;

  const button = h("button", {
    type: "button",
    class: "picker-button",
    "data-key": key,
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
    "aria-controls": listId,
  },
  h("span", { class: "picker-label" }, label),
  h("span", { class: current ? "picker-value" : "picker-value picker-placeholder" }, current ? optionText(current) : placeholder),
  chevron());

  const items = options.map((o, i) => h("li", {
    id: `${key}-opt-${i}`,
    class: "picker-option",
    role: "option",
    "aria-selected": String(o.id === value),
    onmousedown: (e) => e.preventDefault(),
    onmouseenter: () => setActive(i),
    onclick: () => pick(o),
  }, optionText(o)));

  const list = h("ul", { id: listId, class: "picker-list", role: "listbox", "aria-label": label, tabindex: "-1", hidden: true }, items);
  const wrap = h("div", { class: "picker" }, button, list);

  function setActive(i) {
    active = i;
    items.forEach((li, j) => li.classList.toggle("active", j === i));
    if (i >= 0) {
      list.setAttribute("aria-activedescendant", items[i].id);
      items[i].scrollIntoView?.({ block: "nearest" });
    } else {
      list.removeAttribute("aria-activedescendant");
    }
  }

  function onOutside(e) {
    if (!wrap.contains(e.target)) close(false);
  }

  function open() {
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    wrap.classList.add("open");
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    list.focus();
    document.addEventListener("pointerdown", onOutside, true);
  }

  function close(refocus = true) {
    if (list.hidden) return;
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    wrap.classList.remove("open");
    setActive(-1);
    document.removeEventListener("pointerdown", onOutside, true);
    if (refocus) button.focus();
  }

  function pick(o) {
    close();
    if (o.id !== value) onPick(o.id);
  }

  button.addEventListener("click", () => (list.hidden ? open() : close()));
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener("keydown", (e) => {
    const n = options.length;
    if (e.key === "ArrowDown") setActive((active + 1) % n);
    else if (e.key === "ArrowUp") setActive(active <= 0 ? n - 1 : active - 1);
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else if (e.key === "Enter" || e.key === " ") {
      if (active >= 0) pick(options[active]);
    } else if (e.key === "Escape") close();
    else if (e.key === "Tab") return close(false);
    else return;
    e.preventDefault();
  });
  list.addEventListener("focusout", (e) => {
    if (!wrap.contains(e.relatedTarget)) close(false);
  });

  return wrap;
}

// "Starting 2026" when there's only one year to pick.
export function staticPicker(label, text) {
  return h("div", { class: "picker picker-static" },
    h("span", { class: "picker-label" }, label),
    h("span", { class: "picker-value" }, text));
}
