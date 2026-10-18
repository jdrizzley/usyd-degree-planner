"""Build data/planner-sample/ from real 2026 handbook + unit pages (build guide §4.5).

The requirement structure for the three sample degrees is written by hand below (SPEC).
Unit names, credit points, rules and offering sessions are read from the live pages.

    python tools/make_sample.py --cache <dir> --out data/planner-sample

Fetching is polite (1 request/s, cached on disk) and only touches the pages listed here
plus one landing page per unit, about 200 requests on a cold cache.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from handbook_table import parse_table  # noqa: E402
from planner_scraper.requisites import parse_rule  # noqa: E402

YEAR = 2026
BASE = "https://www.sydney.edu.au"
HB = f"{BASE}/handbooks"
UA = "usyd-degree-planner/1.0 (+https://github.com/jdrizzley/usyd-degree-planner; student project)"
RULE_FIELDS = ("prerequisites", "corequisites", "prohibitions", "assumedKnowledge")


# --------------------------------------------------------------------------- fetch

class Fetch:
    def __init__(self, cache: Path):
        self.cache = cache
        cache.mkdir(parents=True, exist_ok=True)
        self.last = 0.0

    def get(self, url: str) -> str | None:
        p = self.cache / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".html")
        if not p.exists():
            wait = 1.0 - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
            self.last = time.monotonic()
            p.write_text(f"<!-- {r.status_code} {url} -->\n" + r.text)
        text = p.read_text()
        first, _, body = text.partition("\n")
        if " 200 " not in first:
            return None
        # USyd serves "not found" pages with status 200; the title gives it away.
        if re.search(r"<title>\s*Error \(404\)", body):
            return None
        return body


# --------------------------------------------------------------------------- spec

def cp(id_, label, n, sections=None, **extra):
    node = {"id": id_, "label": label, "type": "cp", "cp": n}
    if sections is not None:
        node["pool"] = {"sections": sections}
    node.update(extra)
    return node


COMPONENTS = {
    "science/computer-science": {
        "name": "Computer Science",
        "url": f"{HB}/science/table-a/subject-areas/computer-science/unit-of-study-table.html",
        "kinds": {
            "major": [
                cp("i", "1000-level core", 12, ["1000-level-core"]),
                cp("ii", "2000-level core", 18, ["2000-level-core"]),
                cp("iii", "3000-level core", 6, ["3000-level-core"]),
                cp("iv", "Interdisciplinary project", 6, ["3000-level-interdisciplinary-projects"]),
                cp("v", "Major selective", 6, ["3000-level-major-selective"]),
            ],
            "minor": [
                cp("i", "1000-level core", 12, ["1000-level-core"]),
                cp("ii", "2000-level core", 18, ["2000-level-core"]),
                cp("iii", "Minor selective", 6, ["3000-level-minor-selective"]),
            ],
        },
    },
    "science/mathematics": {
        "name": "Mathematics",
        "url": f"{HB}/science/table-a/subject-areas/mathematics/unit-of-study-table.html",
        "kinds": {
            "major": [
                cp("i", "1000-level units", 12, ["1000-level"]),
                cp("ii", "2000-level core", 12, ["2000-level-core"]),
                cp("iii", "2000-level selective", 6, ["2000-level-selective"]),
                cp("iv", "Interdisciplinary project", 6, ["3000-level-interdisciplinary-project-units"]),
                cp("v", "3000-level selective", 12, ["3000-level-selective"]),
            ],
            "minor": [
                cp("i", "1000-level units", 12, ["1000-level"]),
                cp("ii", "2000-level core", 12, ["2000-level-core"]),
                cp("iii", "2000-level selective", 6, ["2000-level-selective"]),
                cp("iv", "3000-level selective", 6, ["3000-level-selective"]),
            ],
        },
    },
    "engineering/core": {
        "name": "Bachelor of Engineering Honours core",
        "url": f"{HB}/engineering/engineering-honours/core-unit-of-study-table.html",
        "kinds": {},
        "keep": {"thesis-units": ["ELEC4712", "ELEC4713", "AMME4111", "AMME4112"]},
    },
    "engineering/software": {
        "name": "Software",
        "url": f"{HB}/engineering/engineering-honours/streams/software/unit-of-study-table.html",
        "kinds": {
            "stream": [
                cp("a", "Stream core", 90, ["stream-core-units"]),
                cp("b", "1000/2000-level stream electives", 0, ["1000-2000-level-stream-elective-units"], maxCp=18),
                cp("c", "3000+ level stream electives", 12, ["3000-level-stream-elective-units"], maxCp=30),
            ],
        },
        "trim": {"3000-level-stream-elective-units": 24},
    },
    "business-school/finance": {
        "name": "Finance",
        "url": f"{HB}/business-school/commerce-subject-areas/finance/unit-of-study-table.html",
        "kinds": {
            "major": [
                cp("i", "1000-level core", 12, ["1000-level-core"]),
                cp("ii", "2000-level core", 12, ["2000-level-core"]),
                cp("iii", "3000-level core", 12, ["3000-level-core"]),
                cp("iv", "3000-level selective", 12, ["3000-level-selective"]),
            ],
        },
    },
    "business-school/accounting": {
        "name": "Accounting",
        "url": f"{HB}/business-school/commerce-subject-areas/accounting/unit-of-study-table.html",
        "kinds": {
            "major": [
                cp("i", "1000-level core", 12, ["1000-level-core"]),
                cp("ii", "2000-level core", 12, ["2000-level-core"]),
                cp("iii", "3000-level core", 12, ["3000-level-core-major-only"]),
                cp("iv", "3000-level selective", 12, ["3000-level-selective-for-major"]),
            ],
            "minor": [
                cp("i", "1000-level core", 12, ["1000-level-core"]),
                cp("ii", "2000-level core", 12, ["2000-level-core"]),
                cp("iii", "3000-level selective", 12, ["3000-level-selective-for-minor"]),
            ],
        },
    },
}

KIND_TOTAL = {"major": 48, "minor": 36, "stream": 120}

POOLS = {
    "science-degree-core": {
        "name": "Science Table A degree core",
        "url": f"{HB}/science/table-a/overview/core.html",
    },
    "table-o": {
        "name": "Table O: Open Learning Environment",
        "url": f"{HB}/interdisciplinary-studies/open-learning-environment/unit-of-study-table.html",
        "trim": 14,
    },
    "science-table-a": {
        "name": "Science Table A (sample: units from the sample components only)",
        "url": f"{HB}/science/table-a.html",
        "from": ["science/computer-science", "science/mathematics", "@science-degree-core"],
    },
}

# Units that appear in a course's rules but not in any table.
EXTRA_UNITS = ["BUSS1000", "BUSS2000"]
# Handbook-only facts for units whose landing page is missing (soft 404) and that
# aren't in any table either. From the Commerce degree core page.
FALLBACK = {"BUSS1000": {"name": "Future of Business", "cp": 6, "rules": {}}}


def opt(component, kind, **extra):
    area = component.split("/")[1]
    return {"id": f"{area}-{kind}", "component": component, "kind": kind,
            "name": COMPONENTS[component]["name"], **extra}


COURSES = {
    "science": {
        "name": "Bachelor of Science", "abbr": "BSc", "faculty": "science", "totalCp": 144, "semesters": 6,
        "sourceUrl": f"{HB}/science/coursework/science/course-resolutions.html",
        "choices": [
            {"id": "m", "label": "Major", "required": True, "options": [
                opt("science/computer-science", "major"), opt("science/mathematics", "major")]},
            {"id": "s", "label": "Second major or minor", "required": True, "options": [
                opt("science/computer-science", "minor"), opt("science/computer-science", "major"),
                opt("science/mathematics", "minor"), opt("science/mathematics", "major")]},
        ],
        "requirements": {"id": "root", "label": "Bachelor of Science", "type": "all", "cp": 144, "children": [
            {"id": "core", "label": "Degree core", "type": "all", "share": True, "children": [
                {"id": "core-i", "label": "Degree core units", "type": "cp", "cp": 12,
                 "pool": {"pools": ["science-degree-core"]}},
                {"id": "core-ii", "label": "1000-level Table A units", "type": "cp", "cp": 12,
                 "pool": {"pools": ["science-table-a"], "level": 1000, "exclude": {"pools": ["science-degree-core"]}}},
            ]},
            {"id": "maj", "label": "Major", "type": "choice", "choice": "m"},
            {"id": "sec", "label": "Second major or minor", "type": "choice", "choice": "s"},
            {"id": "ole", "label": "Open Learning Environment", "type": "cp", "cp": 6, "pool": {"pools": ["table-o"]}},
            {"id": "elec", "label": "Electives", "type": "cp", "cp": 0, "fill": True, "pool": {"any": True}},
        ]},
    },
    "engineering-honours": {
        "name": "Bachelor of Engineering Honours", "abbr": "BE(Hons)", "faculty": "engineering",
        "totalCp": 192, "semesters": 8,
        "sourceUrl": f"{HB}/engineering/engineering-honours/course-resolutions.html",
        "choices": [
            {"id": "st", "label": "Stream", "required": True, "options": [
                opt("engineering/software", "stream",
                    prefer=["INFO1110", "ELEC1005", "COMP2123", "COMP2022", "ELEC4712", "ELEC4713"])]},
        ],
        "requirements": {"id": "root", "label": "Bachelor of Engineering Honours", "type": "all", "cp": 192, "children": [
            {"id": "found", "label": "Engineering foundations", "type": "all", "children": [
                {"id": "found-comp", "label": "Introductory computing", "type": "cp", "cp": 6,
                 "pool": {"component": "engineering/core", "sections": ["computing-units"]}},
                {"id": "found-math", "label": "Mathematics", "type": "cp", "cp": 12,
                 "pool": {"component": "engineering/core", "sections": ["mathematics-units"]}},
            ]},
            {"id": "proj", "label": "Engineering projects", "type": "all", "children": [
                {"id": "proj-1", "label": "Project 1", "type": "cp", "cp": 6,
                 "pool": {"component": "engineering/core", "sections": ["project-1"]}},
                {"id": "proj-23", "label": "Projects 2 and 3", "type": "cp", "cp": 12,
                 "pool": {"component": "engineering/core", "sections": ["project-2-3"]}},
                {"id": "proj-thesis", "label": "Thesis", "type": "cp", "cp": 12,
                 "pool": {"component": "engineering/core", "sections": ["thesis-units"]}},
            ]},
            {"id": "pep", "label": "Professional Engagement Program", "type": "units",
             "units": ["ENGP1001", "ENGP1002", "ENGP1003", "ENGP2001", "ENGP2002", "ENGP2003", "ENGP3001", "ENGP3002"]},
            {"id": "stream", "label": "Stream", "type": "choice", "choice": "st"},
            {"id": "open", "label": "Open electives", "type": "cp", "cp": 0, "fill": True, "maxCp": 24,
             "pool": {"any": True}},
        ]},
    },
    "commerce": {
        "name": "Bachelor of Commerce", "abbr": "BCom", "faculty": "business-school", "totalCp": 144, "semesters": 6,
        "sourceUrl": f"{HB}/business-school/coursework/commerce/commerce-course-resolutions.html",
        "choices": [
            {"id": "m", "label": "Major", "required": True, "options": [
                opt("business-school/finance", "major"), opt("business-school/accounting", "major")]},
            {"id": "s", "label": "Second major or minor", "required": True, "options": [
                opt("business-school/accounting", "minor"), opt("business-school/accounting", "major"),
                opt("business-school/finance", "major")]},
        ],
        "requirements": {"id": "root", "label": "Bachelor of Commerce", "type": "all", "cp": 144, "children": [
            {"id": "core", "label": "Commerce core", "type": "units", "share": True,
             "units": ["BUSS1000", "BUSS1020", "BUSS1030", "BUSS2000"]},
            {"id": "maj", "label": "Major", "type": "choice", "choice": "m"},
            {"id": "sec", "label": "Second major or minor", "type": "choice", "choice": "s"},
            {"id": "ole", "label": "Open Learning Environment", "type": "cp", "cp": 6, "pool": {"pools": ["table-o"]}},
            {"id": "elec", "label": "Electives", "type": "cp", "cp": 0, "fill": True, "pool": {"any": True}},
        ]},
    },
}


# --------------------------------------------------------------------------- landing pages

OUTLINE_RE = re.compile(r"/units/([A-Z]{4}\d{4})/(\d{4})-([A-Z0-9]+)-([A-Z]+)-([A-Z]+)")
LABELS = {
    "Managing faculty or University school:": "faculty",
    "Academic unit": "academicUnit",
    "Credit points": "creditPoints",
    "Prerequisites:": "prerequisites",
    "Corequisites:": "corequisites",
    "Prohibitions:": "prohibitions",
    "Assumed knowledge:": "assumedKnowledge",
}


def parse_landing(html: str, code: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.find("h1")
    name = " ".join(h1.get_text(" ").split()).split(":", 1)[-1].strip() if h1 else ""
    main = soup.select_one("main") or soup.body
    lines = [ln.strip() for ln in main.get_text("\n").splitlines() if ln.strip() and ln.strip() != "?"]
    fields: dict[str, str] = {}
    for i, ln in enumerate(lines):
        key = LABELS.get(ln)
        if key and key not in fields and i + 1 < len(lines):
            fields[key] = lines[i + 1]
    pattern: dict[str, set[int]] = {}
    for a in soup.find_all("a", href=True):
        m = OUTLINE_RE.search(a["href"])
        if m and m.group(1) == code:
            pattern.setdefault(m.group(3), set()).add(int(m.group(2)))
    return {"name": name, "fields": fields, "offeringPattern": {k: sorted(v) for k, v in sorted(pattern.items())}}


def sessions(pattern: dict) -> list[str]:
    """S1/S2 if the unit ran in that semester this year or last year.

    Session codes have variants (S2CIAU = a Semester 2 intensive), so match on the prefix.
    """
    out = []
    for prefix, label in (("S1C", "S1"), ("S2C", "S2")):
        years = [y for code, ys in pattern.items() if code.startswith(prefix) for y in ys]
        if any(y >= YEAR - 1 for y in years):
            out.append(label)
    return out


def last_offered(pattern: dict) -> int | None:
    years = [y for code, ys in pattern.items() if code[:3] in ("S1C", "S2C") for y in ys]
    return max(years) if years else None


# --------------------------------------------------------------------------- build

def rule_record(raw: str | None) -> dict:
    raw = (raw or "").strip()
    if not raw or raw.lower() == "none":
        return {"raw": "None", "parsed": None}
    return {"raw": raw, "parsed": parse_rule(raw)}


def write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()
    f = Fetch(args.cache)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = args.out
    hb = out / "handbooks" / str(YEAR)

    table_units: dict[str, dict] = {}      # code -> first table row seen (name, cp, rules)

    def remember(rows):
        for u in rows:
            table_units.setdefault(u["code"], u)

    # Components
    comp_files = {}
    for cid, spec in COMPONENTS.items():
        html = f.get(spec["url"])
        assert html, spec["url"]
        t = parse_table(html)
        sections = []
        for s in t["sections"]:
            units = s["units"]
            if s["id"] in spec.get("keep", {}):
                units = [u for u in units if u["code"] in spec["keep"][s["id"]]]
            if s["id"] in spec.get("trim", {}):
                units = units[: spec["trim"][s["id"]]]
            remember(units)
            sec = {"id": s["id"], "label": s["label"], "level": s["level"], "units": [u["code"] for u in units]}
            if s.get("notes"):
                sec["notes"] = s["notes"]
            sections.append(sec)
        ids = {s["id"] for s in sections}
        kinds = {}
        for kind, reqs in spec["kinds"].items():
            for r in reqs:
                missing = set(r["pool"]["sections"]) - ids
                assert not missing, f"{cid} {kind}: unknown sections {missing}; have {sorted(ids)}"
            kinds[kind] = {"name": f"{spec['name']} {kind}", "totalCp": KIND_TOTAL[kind], "requirements": reqs}
        fac, area = cid.split("/")
        comp_files[cid] = {
            "id": cid, "faculty": fac, "slug": area, "name": spec["name"], "handbookYear": YEAR,
            "kinds": kinds, "preamble": t["preamble"], "sections": sections,
            "sourceUrl": spec["url"], "scrapedAt": now,
        }

    # Pools
    pool_files = {}
    for pid, spec in POOLS.items():
        if "from" in spec:
            continue
        t = parse_table(f.get(spec["url"]))
        rows = [u for s in t["sections"] for u in s["units"]]
        if "trim" in spec:
            rows = rows[:10] + [u for u in rows if u["code"].startswith("OLES")][:4]
        remember(rows)
        pool_files[pid] = {"id": pid, "name": spec["name"], "units": [u["code"] for u in rows],
                           "sourceUrl": spec["url"], "handbookYear": YEAR}
    for pid, spec in POOLS.items():
        if "from" not in spec:
            continue
        codes: list[str] = []
        for src in spec["from"]:
            if src.startswith("@"):
                codes += pool_files[src[1:]]["units"]
            else:
                codes += [c for s in comp_files[src]["sections"] for c in s["units"]]
        pool_files[pid] = {"id": pid, "name": spec["name"], "units": sorted(set(codes)),
                           "sourceUrl": spec["url"], "handbookYear": YEAR}

    # Units: table data + landing page
    codes = sorted(set(table_units) | set(EXTRA_UNITS))
    units: dict[str, dict] = {}
    missing = []
    for i, code in enumerate(codes, 1):
        print(f"[{i}/{len(codes)}] {code}", file=sys.stderr)
        html = f.get(f"{BASE}/units/{code}")
        row = table_units.get(code) or FALLBACK.get(code, {})
        if html is None and not row:
            missing.append(code)
            continue
        # No landing page but listed in the handbook: keep the handbook data and mark
        # the offering as unknown (sessions = None, so the planner doesn't flag it).
        land = parse_landing(html, code) if html else {"name": "", "fields": {}, "offeringPattern": None}
        fields = land["fields"]
        try:
            credit = int(fields.get("creditPoints", row.get("cp", 0)))
        except ValueError:
            credit = row.get("cp", 0)
        # Landing page is the source of truth for rules; the table fills gaps.
        rules = {}
        for k in RULE_FIELDS:
            rules[k] = rule_record(fields.get(k) if k in fields else row.get("rules", {}).get(k))
        units[code] = {
            "code": code,
            "name": land["name"] or row.get("name", code),
            "creditPoints": credit,
            "level": int(code[4]) * 1000,
            "faculty": fields.get("faculty", ""),
            "academicUnit": fields.get("academicUnit", ""),
            "rules": rules,
            "offeringPattern": land["offeringPattern"],
            "sessions": sessions(land["offeringPattern"]) if land["offeringPattern"] is not None else None,
            "lastOffered": last_offered(land["offeringPattern"]) if land["offeringPattern"] is not None else None,
            "landingPage": html is not None,
        }

    # Drop references to retired units so the sample is self-consistent.
    gone = set(missing)
    for c in comp_files.values():
        for s in c["sections"]:
            s["units"] = [u for u in s["units"] if u not in gone]
    for p in pool_files.values():
        p["units"] = [u for u in p["units"] if u not in gone]

    # Courses
    index_courses = []
    for slug, spec in COURSES.items():
        model = {"slug": slug, "handbookYear": YEAR, "confidence": "high", "sample": True, **spec}
        write(hb / "courses" / f"{slug}.json", model)
        index_courses.append({"slug": slug, "name": spec["name"], "abbr": spec["abbr"],
                              "faculty": spec["faculty"], "confidence": "high"})

    for cid, comp in comp_files.items():
        write(hb / "components" / f"{cid}.json", comp)
    for pid, pool in pool_files.items():
        write(hb / "pools" / f"{pid}.json", pool)
    write(hb / "index.json", {
        "handbookYear": YEAR,
        "courses": sorted(index_courses, key=lambda c: c["name"]),
        "components": sorted(comp_files),
        "pools": sorted(pool_files),
    })

    by_prefix: dict[str, dict] = {}
    for code, u in units.items():
        by_prefix.setdefault(code[:4], {})[code] = u
    for prefix, group in by_prefix.items():
        write(out / "units" / f"{prefix}.json", {"prefix": prefix, "units": group})
    write(out / "units" / "index.json", {"units": [
        {"c": u["code"], "n": u["name"], "cp": u["creditPoints"], "lv": u["level"], "s": u["sessions"],
         "last": u["lastOffered"]}
        for u in sorted(units.values(), key=lambda u: u["code"])
    ]})
    write(out / "missing.json", {"codes": missing})
    write(out / "meta.json", {
        "formatVersion": 1, "sample": True, "generatedAt": now, "handbookYears": [YEAR],
        "counts": {"units": len(units), "courses": len(COURSES), "components": len(comp_files),
                   "pools": len(pool_files), "missing": len(missing)},
        "note": "Hand-picked sample for 3 degrees, built by tools/make_sample.py. Not complete.",
    })
    print(f"wrote {len(units)} units, {len(COURSES)} courses, {len(missing)} missing", file=sys.stderr)


if __name__ == "__main__":
    main()
