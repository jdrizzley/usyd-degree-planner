// Test helpers: sample data from disk, catalogs and plans from short strings.
import { readFile } from "node:fs/promises";
import { loadCatalog } from "../engine/catalog.js";
import { decodePlan } from "../url.js";

const root = new URL("../../data/planner-sample/", import.meta.url);

export async function loadJSON(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

const catalogs = new Map();
export function catalogFor(slug, year = 2026) {
  if (!catalogs.has(slug)) catalogs.set(slug, loadCatalog(loadJSON, { year, slug }));
  return catalogs.get(slug);
}

// "INFO1110!,MATH1061.INFO1113" -> plan; throws on a typo so tests fail loudly.
export function planFrom(text) {
  const plan = decodePlan(text);
  if (!plan) throw new Error(`bad plan string: ${text}`);
  return plan;
}
