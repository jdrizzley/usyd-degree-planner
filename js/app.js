// Entry point: hash router. Each page renderer returns { node, title, focus? }.
import { loadMeta } from "./data.js";
import { message, renderDashboard, topbar } from "./dashboard.js";
import { h } from "./dom.js";
import { renderHome } from "./search.js";
import { parseRoute } from "./url.js";

const app = document.getElementById("app");
let metaPromise = null;
let current = 0;

async function route() {
  const token = ++current;
  const r = parseRoute(location.hash);
  if (r.page === "notfound") {
    history.replaceState(null, "", "#/");
    return route();
  }

  // Only show "Loading…" if loading takes long enough to notice.
  const slow = setTimeout(() => {
    if (token === current) app.replaceChildren(h("p", { class: "loading" }, "Loading…"));
  }, 300);

  try {
    metaPromise ??= loadMeta();
    const meta = await metaPromise;
    // Requirements and plan pages arrive in phases 3-4; show the dashboard for now.
    const view = r.page === "home" ? await renderHome(meta) : await renderDashboard(meta, r);
    if (token !== current) return;
    app.replaceChildren(view.node);
    document.title = view.title;
    app.dataset.page = r.page;
    view.focus?.();
    window.scrollTo(0, 0);
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

window.addEventListener("hashchange", route);
route();
