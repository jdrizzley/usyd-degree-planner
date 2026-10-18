// Home page: the "Degree Planner" wordmark and the degree search box (build guide §6.1).
import { loadJSON } from "./data.js";
import { h } from "./dom.js";
import { buildHash } from "./url.js";

const MAX_SUGGESTIONS = 8;

export function words(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// Every typed word must be the start of some word in the name or abbreviation.
// "sci", "bsc", "bachelor eng" and "adv comp" all work. Results are alphabetical.
export function matchCourses(courses, query) {
  const q = words(query);
  if (!q.length) return [];
  return courses
    .filter((c) => {
      const w = [...words(c.name), ...words(c.abbr || "")];
      return q.every((t) => w.some((x) => x.startsWith(t)));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function squash(text) {
  return words(text).join("");
}

// Enter with nothing highlighted: an exact name/abbreviation match wins, else the first suggestion.
export function pickOnEnter(courses, query, results) {
  const s = squash(query);
  return courses.find((c) => squash(c.name) === s || squash(c.abbr || "") === s) || results[0] || null;
}

export function newestYear(meta) {
  return Math.max(...meta.handbookYears);
}

export async function renderHome(meta) {
  const year = newestYear(meta);
  const { courses } = await loadJSON(`handbooks/${year}/index.json`);

  let results = [];
  let active = -1;

  const input = h("input", {
    id: "degree-search",
    class: "search-input",
    type: "text",
    role: "combobox",
    "aria-label": "Enter your degree",
    "aria-autocomplete": "list",
    "aria-expanded": "false",
    "aria-controls": "degree-suggestions",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    enterkeyhint: "go",
  });
  const list = h("ul", { id: "degree-suggestions", class: "suggestions", role: "listbox", "aria-label": "Degrees" });
  const box = h("div", { class: "search" }, input, h("div", { class: "suggestions-wrap" }, list));

  function go(course) {
    if (course) location.hash = buildHash({ page: "dashboard", course: course.slug, year });
  }

  function setActive(i) {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
    if (i >= 0 && list.children[i]?.id) input.setAttribute("aria-activedescendant", list.children[i].id);
    else input.removeAttribute("aria-activedescendant");
  }

  function close() {
    box.classList.remove("open");
    input.setAttribute("aria-expanded", "false");
    setActive(-1);
  }

  function open() {
    const query = input.value;
    if (!query.trim()) return close();
    results = matchCourses(courses, query).slice(0, MAX_SUGGESTIONS);
    list.replaceChildren(
      ...(results.length
        ? results.map((c, i) =>
            h("li", {
              id: `degree-option-${i}`,
              class: "suggestion",
              role: "option",
              "aria-selected": "false",
              onmouseenter: () => setActive(i),
              // Keep focus in the input so blur doesn't close the list before the click lands.
              onmousedown: (e) => e.preventDefault(),
              onclick: () => go(c),
            },
            h("span", { class: "suggestion-name" }, c.name),
            c.abbr ? h("span", { class: "suggestion-abbr" }, c.abbr) : null),
          )
        : [h("li", { class: "suggestion empty", "aria-disabled": "true" }, "No undergraduate degree matches")]),
    );
    box.classList.add("open");
    input.setAttribute("aria-expanded", "true");
    setActive(-1);
  }

  input.addEventListener("input", open);
  input.addEventListener("focus", () => input.value.trim() && open());
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (e) => {
    const n = results.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!box.classList.contains("open")) open();
      if (n) setActive((active + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setActive(active <= 0 ? n - 1 : active - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!input.value.trim()) return;
      go(active >= 0 ? results[active] : pickOnEnter(courses, input.value, results));
    } else if (e.key === "Escape") {
      close();
    }
  });

  const node = h("section", { class: "home" }, h("h1", { class: "wordmark" }, "Degree Planner"), box);
  return { node, title: "Degree Planner", focus: () => input.focus() };
}
