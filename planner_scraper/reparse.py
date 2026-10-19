"""Re-parse every rule in a data folder with the current parser. No network.

    python -m planner_scraper.reparse data/planner-sample

Rewrites rules.*.parsed from rules.*.raw in units/{PREFIX}.json and prints the
full-parse rate (prerequisites, corequisites, prohibitions) before and after.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from planner_scraper.requisites import is_fully_parsed, parse_rule

COUNTED = ("prerequisites", "corequisites", "prohibitions")


def write(path: Path, obj) -> None:
    """Same format as tools/make_sample.py."""
    path.write_text(json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False) + "\n")


def rate(rules: list[dict | None]) -> tuple[int, int]:
    present = [r for r in rules if r is not None]
    return sum(is_fully_parsed(r) for r in present), len(present)


def reparse(root: Path) -> tuple[tuple[int, int], tuple[int, int], int]:
    before: list = []
    after: list = []
    changed = 0
    for shard in sorted((root / "units").glob("*.json")):
        if shard.name == "index.json":
            continue
        data = json.loads(shard.read_text())
        dirty = False
        for unit in data.get("units", {}).values():
            for kind, rule in unit.get("rules", {}).items():
                new = parse_rule(rule.get("raw"))
                if kind in COUNTED:
                    before.append(rule.get("parsed"))
                    after.append(new)
                if new != rule.get("parsed"):
                    rule["parsed"] = new
                    dirty = True
                    changed += 1
        if dirty:
            write(shard, data)
    return rate(before), rate(after), changed


if __name__ == "__main__":
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "data/planner")
    (b_ok, b_n), (a_ok, a_n), changed = reparse(root)
    print(f"{root}: {changed} rule(s) changed")
    print(f"fully parsed before: {b_ok}/{b_n}, after: {a_ok}/{a_n}")
