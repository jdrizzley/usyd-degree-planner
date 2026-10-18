// Entry point. Phase 0: confirms the data loads. Pages arrive in later phases.
import { dataRoot, loadMeta } from "./data.js";

const app = document.getElementById("app");

loadMeta()
  .then((meta) => {
    app.dataset.ready = "true";
    app.dataset.dataRoot = dataRoot();
    console.info(`[planner] data ${dataRoot()} (handbook years ${meta.handbookYears.join(", ")})`);
  })
  .catch((e) => {
    app.textContent = "Couldn't load the degree data. Refresh to try again.";
    console.error("[planner]", e);
  });
