// Entry point: hash router. Each page renderer takes ctx and returns
// { node, title, focus? }.
//
//   ctx = { meta, route, from, replace }
//   from     the route shown before this one (null on first load)
//   replace  edit within a page: swap the address without a history entry, then re-render
import { loadMeta } from "./data.js";
import { message, renderDashboard, renderPlanHolder, topbar } from "./dashboard.js";
import { h } from "./dom.js";
import { renderRequirements } from "./requirements.js";
import { renderHome } from "./search.js";
import { parseRoute } from "./url.js";

const app = document.getElementById("app");
const PAGES = { dashboard: renderDashboard, requirements: renderRequirements, plan: renderPlanHolder };
let metaPromise = null;
let current = 0;
let shown = null; // the route on screen now
let from = null;

function replace(hash) {
  history.replaceState(null, "", hash);
  route({ replaced: true });
}

async function route({ replaced = false } = {}) {
  const token = ++current;
  const r = parseRoute(location.hash);
  if (r.page === "notfound") {
    history.replaceState(null, "", "#/");
    return route();
  }
  if (!replaced) from = shown;

  // Only show "Loading…" if loading takes long enough to notice.
  const slow = setTimeout(() => {
    if (token === current) app.replaceChildren(h("p", { class: "loading" }, "Loading…"));
  }, 300);

  try {
    metaPromise ??= loadMeta();
    const meta = await metaPromise;
    const ctx = { meta, route: r, from, replace };
    const view = r.page === "home" ? await renderHome(meta) : await PAGES[r.page](ctx);
    if (token !== current) return;

    // Keep keyboard focus on the same control across a re-render.
    const key = document.activeElement?.dataset?.key;
    app.replaceChildren(view.node);
    document.title = view.title;
    app.dataset.page = r.page;
    shown = r;
    const again = key && app.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (again) again.focus();
    else view.focus?.();
    if (!replaced) window.scrollTo(0, 0);
  } catch (e) {
    console.error("[planner]", e);
    metaPromise = null;
    if (token === current) {
      app.replaceChildren(topbar(), message("Couldn't load the degree data. Refresh to try again."));
    }
  } finally {
    clearTimeout(slow);
  }
}

window.addEventListener("hashchange", () => route());
route();
