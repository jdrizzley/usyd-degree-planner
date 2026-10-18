// Loads planner JSON. All paths are relative to the data root (build guide §4.2).
//
// The root is data/planner, or data/planner-sample when the page is opened with
// ?data=sample (or when the real data hasn't been published yet).

const cache = new Map();

export function chooseRoot(search = location.search) {
  return new URLSearchParams(search).get("data") === "sample" ? "data/planner-sample" : "data/planner";
}

let root = chooseRoot();

export function dataRoot() {
  return root;
}

export async function loadJSON(path) {
  const url = `${root}/${path}`;
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} loading ${url}`);
      return r.json();
    }).catch((e) => {
      cache.delete(url);
      throw e;
    }));
  }
  return cache.get(url);
}

// Real data first; fall back to the sample until the scraper has run.
export async function loadMeta() {
  try {
    return await loadJSON("meta.json");
  } catch (e) {
    if (root === "data/planner") {
      root = "data/planner-sample";
      return loadJSON("meta.json");
    }
    throw e;
  }
}
