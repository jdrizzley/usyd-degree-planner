"""Shared helper for tools/: handbook unit-of-study table -> sections + unit rows.

Prototype of planner_scraper/uos_table.py (build guide phase 7). Used by make_sample.py.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup

LEVEL_HDR = re.compile(r"^([1-5])000[- ]level units of study$", re.I)
SKIP_HDR = re.compile(r"^(unit of study\b|date\b|this page was)", re.I)
RULE_KEYS = {"A": "assumedKnowledge", "P": "prerequisites", "C": "corequisites", "N": "prohibitions"}


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _rules(td) -> dict:
    """Split the rules cell on its <strong>A|P|C|N</strong> markers."""
    out: dict[str, str] = {}
    key = None
    buf: list[str] = []
    for el in td.descendants:
        if getattr(el, "name", None) == "br":
            # Each rule is its own line; text on a line without a marker is a note.
            if key:
                out[key] = " ".join(" ".join(buf).split()).strip(" /")
            key, buf = None, []
            continue
        if getattr(el, "name", None) == "strong" and el.get_text(strip=True) in RULE_KEYS:
            if key:
                out[key] = " ".join(" ".join(buf).split()).strip(" /")
            key, buf = RULE_KEYS[el.get_text(strip=True)], []
        elif isinstance(el, str) and key and el.parent.name != "strong":
            buf.append(el)
        elif isinstance(el, str) and key and el.parent.name == "strong" and el.strip() not in RULE_KEYS:
            buf.append(el)
    if key:
        out[key] = " ".join(" ".join(buf).split()).strip(" /")
    return out


def parse_table(html: str) -> dict:
    """Returns {"preamble": [str], "sections": [{"id","label","level","units":[...]}]}."""
    soup = BeautifulSoup(html, "lxml")
    preamble: list[str] = []
    sections: list[dict] = []
    level = None
    group = None
    current = None
    in_units = False   # becomes True after the "Unit of study | Credit points" header row
    for tbl in soup.select("table"):
        for tr in tbl.select("tr"):
            ths, tds = tr.find_all("th"), tr.find_all("td")
            if ths and not tds:
                text = " ".join(" ".join(th.get_text(" ").split()) for th in ths)
                if SKIP_HDR.match(text):
                    if text.lower().startswith("date"):
                        return {"preamble": preamble, "sections": sections}
                    if text.lower().startswith("unit of study"):
                        in_units = True
                    continue
                m = LEVEL_HDR.match(text)
                if m:
                    level, group, current = int(m.group(1)) * 1000, None, None
                    continue
                if not in_units:
                    preamble.append(text)
                    continue
                if len(text) > 60:          # explanatory notes, not section names
                    if current is not None:
                        current.setdefault("notes", []).append(text)
                    else:
                        preamble.append(text)
                    continue
                group = text
                current = None
                continue
            if len(tds) < 2:
                continue
            a = tds[0].find("a")
            code_m = re.search(r"[A-Z]{4}\d{4}", tds[0].get_text())
            if not code_m:
                continue
            code = code_m.group(0)
            name = " ".join(tds[0].get_text(" ").replace(code, "", 1).split()).strip(" /")
            name = name.rstrip("*").strip()
            try:
                cp = int(tds[1].get_text(strip=True))
            except ValueError:
                cp = 0
            if current is None:
                label = " ".join(x for x in [f"{level}-level" if level else "", group or ""] if x).strip() or "Units"
                sid = slug(label)
                current = next((s for s in sections if s["id"] == sid), None)
                if current is None:
                    current = {"id": sid, "label": label, "level": level, "units": []}
                    sections.append(current)
            current["units"].append({
                "code": code, "name": name, "cp": cp,
                "rules": _rules(tds[2]) if len(tds) > 2 else {},
            })
    return {"preamble": preamble, "sections": sections}
