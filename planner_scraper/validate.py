"""Check a data/planner* folder against the format in the build guide (§4.2, §4.3).

    python -m planner_scraper.validate data/planner-sample

Exits 1 and lists every problem if anything is wrong. Standard library only.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
CODE = re.compile(r"^[A-Z]{4}\d{4}$")
PATTERN = re.compile(r"^[A-Z]{4}[0-9X]{4}$")
PREFIX = re.compile(r"^[A-Z]{4}$")
CP_KEYS = {"cp", "level", "minLevel", "pattern", "prefixes", "exclude"}
REQ_TYPES = {"all", "cp", "units", "choice"}
POOL_KEYS = {"units", "component", "sections", "pools", "level", "prefix", "exclude", "any"}
SESSIONS = {"S1", "S2"}


class Checker:
    def __init__(self, root: Path):
        self.root = root
        self.errors: list[str] = []
        self.units: dict[str, dict] = {}
        self.components: dict[str, dict] = {}
        self.pools: dict[str, dict] = {}

    def err(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}: {msg}")

    def load(self, rel: str | Path):
        path = self.root / rel
        try:
            text = path.read_text()
        except FileNotFoundError:
            self.err(str(rel), "missing file")
            return None
        if EMAIL.search(text):
            self.err(str(rel), "contains an email address (no personal data allowed)")
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            self.err(str(rel), f"invalid JSON: {e}")
            return None

    # ------------------------------------------------------------------ units

    def check_tree(self, where: str, node) -> None:
        if node is None:
            return
        if not isinstance(node, dict):
            self.err(where, f"rule node is not an object: {node!r}")
            return
        if "op" in node:
            if node["op"] not in ("and", "or") or not node.get("args"):
                self.err(where, f"bad op node: {node}")
            for a in node.get("args", []):
                self.check_tree(where, a)
        elif "unit" in node:
            if not CODE.match(node["unit"]):
                self.err(where, f"bad unit code {node['unit']!r}")
        elif "unitPattern" in node:
            if not PATTERN.match(node["unitPattern"]):
                self.err(where, f"bad unit pattern {node['unitPattern']!r}")
        elif "cp" in node:
            extra = set(node) - CP_KEYS
            if extra:
                self.err(where, f"unknown cp node keys {sorted(extra)}: {node}")
            for k in ("cp", "level", "minLevel"):
                if k in node and not isinstance(node[k], int):
                    self.err(where, f"{k} must be an int: {node}")
            if "pattern" in node and not PATTERN.match(node["pattern"]):
                self.err(where, f"bad pattern {node['pattern']!r}")
            if "prefixes" in node and not (
                node["prefixes"] and all(isinstance(x, str) and PREFIX.match(x) for x in node["prefixes"])
            ):
                self.err(where, f"bad prefixes {node['prefixes']!r}")
            for ex in node.get("exclude", []):
                if not (isinstance(ex, dict) and ("unit" in ex or "unitPattern" in ex)):
                    self.err(where, f"exclude must list unit / unitPattern nodes: {ex!r}")
                else:
                    self.check_tree(where, ex)
        elif "text" not in node:
            self.err(where, f"unknown rule node: {node}")

    def check_units(self) -> None:
        index = self.load("units/index.json")
        if not index:
            return
        rows = index.get("units", [])
        seen = set()
        for r in rows:
            c = r.get("c", "")
            if not CODE.match(c):
                self.err("units/index.json", f"bad code {c!r}")
            if c in seen:
                self.err("units/index.json", f"duplicate {c}")
            seen.add(c)
            if not isinstance(r.get("cp"), int):
                self.err("units/index.json", f"{c}: cp must be an int")
            s = r.get("s")
            if s is not None and not set(s) <= SESSIONS:
                self.err("units/index.json", f"{c}: bad sessions {s}")
        for shard in sorted((self.root / "units").glob("*.json")):
            if shard.name in ("index.json",):
                continue
            data = self.load(shard.relative_to(self.root))
            if not data:
                continue
            for code, u in data.get("units", {}).items():
                where = f"units/{shard.name}:{code}"
                if code[:4] != data.get("prefix"):
                    self.err(where, "in the wrong prefix shard")
                for k in ("code", "name", "creditPoints", "level", "rules", "sessions"):
                    if k not in u:
                        self.err(where, f"missing {k}")
                for k, rule in u.get("rules", {}).items():
                    if "raw" not in rule or "parsed" not in rule:
                        self.err(where, f"rule {k} needs raw + parsed")
                    else:
                        self.check_tree(f"{where}.{k}", rule["parsed"])
                self.units[code] = u
        for c in seen - set(self.units):
            self.err("units/index.json", f"{c} has no full record in a shard")
        for c in set(self.units) - seen:
            self.err("units", f"{c} is in a shard but not in index.json")

    def known(self, where: str, codes) -> None:
        for c in codes:
            if c not in self.units:
                self.err(where, f"unknown unit {c}")

    # ------------------------------------------------------------------ handbooks

    def check_pool_spec(self, where: str, pool: dict, component: str | None) -> None:
        extra = set(pool) - POOL_KEYS
        if extra:
            self.err(where, f"unknown pool keys {sorted(extra)}")
        if "units" in pool:
            self.known(where, pool["units"])
        for pid in pool.get("pools", []):
            if pid not in self.pools:
                self.err(where, f"unknown pool {pid}")
        comp_id = pool.get("component", component)
        if "sections" in pool:
            comp = self.components.get(comp_id)
            if comp is None:
                self.err(where, f"sections given but component {comp_id!r} is unknown")
            else:
                ids = {s["id"] for s in comp["sections"]}
                for sid in pool["sections"]:
                    if sid not in ids:
                        self.err(where, f"unknown section {sid} in {comp_id}")
        if "exclude" in pool:
            self.check_pool_spec(where + ".exclude", pool["exclude"], component)

    def check_req(self, where: str, node: dict, ids: set, component: str | None, choices: set) -> None:
        nid = node.get("id")
        if not nid:
            self.err(where, "requirement without id")
        elif nid in ids:
            self.err(where, f"duplicate requirement id {nid}")
        ids.add(nid)
        here = f"{where}/{nid}"
        t = node.get("type")
        if t not in REQ_TYPES:
            self.err(here, f"bad type {t!r}")
        if not node.get("label"):
            self.err(here, "missing label")
        if t == "all":
            if not node.get("children"):
                self.err(here, "all node needs children")
            for ch in node.get("children", []):
                self.check_req(here, ch, ids, component, choices)
        elif t == "cp":
            if not isinstance(node.get("cp"), int):
                self.err(here, "cp node needs an int cp")
            if "pool" not in node:
                self.err(here, "cp node needs a pool")
            else:
                self.check_pool_spec(here, node["pool"], component)
        elif t == "units":
            if not node.get("units"):
                self.err(here, "units node needs units")
            self.known(here, node.get("units", []))
        elif t == "choice":
            if node.get("choice") not in choices:
                self.err(here, f"unknown choice {node.get('choice')!r}")

    def min_cp(self, node: dict, course: dict) -> int:
        """Smallest credit points a requirement subtree needs (shared nodes count 0)."""
        if node.get("share"):
            return 0
        t = node.get("type")
        if t == "cp":
            return node.get("cp", 0)
        if t == "units":
            return sum(self.units.get(c, {}).get("creditPoints", 0) for c in node.get("units", []))
        if t == "choice":
            ch = next((c for c in course["choices"] if c["id"] == node["choice"]), None)
            totals = [self.components[o["component"]]["kinds"][o["kind"]]["totalCp"]
                      for o in (ch or {}).get("options", [])
                      if o["component"] in self.components and o["kind"] in self.components[o["component"]]["kinds"]]
            return min(totals) if totals else 0
        return max(node.get("cp", 0), sum(self.min_cp(c, course) for c in node.get("children", [])))

    def check_year(self, year_dir: Path) -> None:
        y = year_dir.name
        index = self.load(f"handbooks/{y}/index.json")
        if not index:
            return
        for pid in index.get("pools", []):
            p = self.load(f"handbooks/{y}/pools/{pid}.json")
            if p:
                self.pools[pid] = p
                self.known(f"pools/{pid}", p.get("units", []))
        for cid in index.get("components", []):
            c = self.load(f"handbooks/{y}/components/{cid}.json")
            if not c:
                continue
            self.components[cid] = c
            for s in c.get("sections", []):
                self.known(f"components/{cid}#{s.get('id')}", s.get("units", []))
        for cid, c in self.components.items():
            for kind, k in c.get("kinds", {}).items():
                if not isinstance(k.get("totalCp"), int):
                    self.err(f"components/{cid}.{kind}", "totalCp must be an int")
                ids: set = set()
                for r in k.get("requirements", []):
                    self.check_req(f"components/{cid}.{kind}", r, ids, cid, set())
        if not index.get("courses"):
            self.err(f"handbooks/{y}/index.json", "no courses")
        for entry in index.get("courses", []):
            slug = entry.get("slug")
            for k in ("slug", "name", "abbr", "faculty", "confidence"):
                if not entry.get(k):
                    self.err(f"handbooks/{y}/index.json", f"course {slug!r} missing {k}")
            course = self.load(f"handbooks/{y}/courses/{slug}.json")
            if not course:
                continue
            where = f"courses/{slug}"
            if not (isinstance(course.get("totalCp"), int) and course["totalCp"] > 0):
                self.err(where, "totalCp must be a positive int")
            choice_ids = set()
            for ch in course.get("choices", []):
                choice_ids.add(ch["id"])
                opt_ids = set()
                for o in ch.get("options", []):
                    if o["id"] in opt_ids:
                        self.err(where, f"duplicate option {o['id']} in choice {ch['id']}")
                    opt_ids.add(o["id"])
                    comp = self.components.get(o.get("component"))
                    if comp is None:
                        self.err(where, f"option {o['id']}: unknown component {o.get('component')}")
                    elif o.get("kind") not in comp.get("kinds", {}):
                        self.err(where, f"option {o['id']}: component has no kind {o.get('kind')}")
                    self.known(f"{where}.{o['id']}.prefer", o.get("prefer", []))
            self.check_req(where, course.get("requirements", {}), set(), None, choice_ids)
            need = self.min_cp(course.get("requirements", {}), course)
            if need > course.get("totalCp", 0):
                self.err(where, f"requirements need at least {need} cp but totalCp is {course.get('totalCp')}")

    def run(self) -> list[str]:
        meta = self.load("meta.json")
        if meta and meta.get("formatVersion") != 1:
            self.err("meta.json", "formatVersion must be 1")
        self.check_units()
        years = sorted(p for p in (self.root / "handbooks").glob("*") if p.is_dir())
        if not years:
            self.err("handbooks", "no handbook years")
        for y in years:
            self.check_year(y)
        if meta:
            listed = sorted(int(y) for y in meta.get("handbookYears", []))
            present = sorted(int(y.name) for y in years)
            if listed != present:
                self.err("meta.json", f"handbookYears {listed} != folders {present}")
        return self.errors


def validate(root: str | Path) -> list[str]:
    return Checker(Path(root)).run()


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "data/planner"
    errors = validate(root)
    for e in errors:
        print(e)
    print(f"{root}: {'OK' if not errors else f'{len(errors)} problem(s)'}")
    sys.exit(1 if errors else 0)
