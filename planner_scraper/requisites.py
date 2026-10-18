"""Enrolment rule text -> expression tree (build guide §4.2, data plan §4.5).

Node forms:
    {"unit": "COMP2017"}
    {"unitPattern": "MATH2X21"}            X matches any digit
    {"cp": 96}                             credit points completed before
    {"cp": 12, "level": 2000}              ...at a given level
    {"cp": 12, "pattern": "MATH2XXX"}      ...from units matching a pattern
    {"op": "and" | "or", "args": [...]}   may carry "ambiguous": true
    {"text": "..."}                        anything not understood (never enforced)

The raw text is always stored next to the tree, so nothing is lost when a
phrase falls back to a text leaf.
"""
from __future__ import annotations

import re

CODE_RE = re.compile(r"^[A-Z]{4}[0-9X]{4}$")
CODE_IN_TEXT = re.compile(r"\b[A-Z]{4}[0-9X]{4}\b")
CP_RE = re.compile(r"\b(\d{1,3})\s*(?:credit points?|cp)\b", re.I)
LEVEL_RE = re.compile(r"\b([1-5])000[- ]level\b", re.I)
PATTERN_AFTER_CP = re.compile(r"credit points?\s+(?:of|from|in)\s+([A-Z]{4}[0-9X]{4})\b", re.I)

# Words that carry no meaning beyond the credit points / codes in a phrase.
FILLER = {
    "completion", "complete", "completed", "of", "at", "least", "a", "minimum", "including",
    "units", "unit", "study", "in", "the", "from", "level", "successful", "successfully",
    "credit", "points", "point", "cp", "any",
}

NOTE_START = re.compile(r"(?<=[A-Z]{4}[0-9X]{4})\s*[.;]?\s+(?=[A-Z][a-z]+\s+[a-z])")

# "or above", "or more" etc. are not the logical operator.
PROTECT = re.compile(r"\b(or)\s+(above|greater|more|higher|better|equivalent|better)\b", re.I)


def _tokenise(text: str) -> list[tuple[str, str]]:
    t = PROTECT.sub(lambda m: f"{m.group(1)}_{m.group(2)}", text)
    t = t.replace("{", "(").replace("}", ")").replace("[", "(").replace("]", ")")
    tokens: list[tuple[str, str]] = []
    words: list[str] = []

    def flush() -> None:
        if words:
            tokens.append(("PHRASE", " ".join(words)))
            words.clear()

    for raw in re.findall(r"\(|\)|,|;|[^\s(),;]+", t):
        low = raw.lower()
        if raw == "(":
            flush(); tokens.append(("LP", raw))
        elif raw == ")":
            flush(); tokens.append(("RP", raw))
        elif low in ("and", "&") or raw == ";":
            flush(); tokens.append(("AND", raw))
        elif low == "or" or raw == ",":
            flush(); tokens.append(("OR", raw))
        else:
            words.append(raw.replace("_", " "))
    flush()
    return tokens


def _phrase(text: str) -> dict:
    """One run of words between operators/brackets."""
    clean = text.strip(" .")
    if CODE_RE.match(clean):
        return {"unitPattern": clean} if "X" in clean else {"unit": clean}

    parts: list[dict] = []
    cp = CP_RE.search(clean)
    if cp:
        node: dict = {"cp": int(cp.group(1))}
        pat = PATTERN_AFTER_CP.search(clean)
        lvl = LEVEL_RE.search(clean)
        if pat:
            node["pattern"] = pat.group(1)
        elif lvl:
            node["level"] = int(lvl.group(1)) * 1000
        parts.append(node)

    codes = [c for c in CODE_IN_TEXT.findall(clean) if not (cp and "pattern" in parts[0] and c == parts[0]["pattern"])]
    for c in codes:
        parts.append({"unitPattern": c} if "X" in c else {"unit": c})

    residual = CODE_IN_TEXT.sub(" ", clean)
    residual = CP_RE.sub(" ", residual)
    residual = LEVEL_RE.sub(" ", residual)
    leftover = [w for w in re.findall(r"[A-Za-z]+", residual) if w.lower() not in FILLER]
    if leftover:
        parts.insert(0, {"text": clean})
    if not parts:
        return {"text": clean}
    return parts[0] if len(parts) == 1 else {"op": "and", "args": parts}


class _Parser:
    def __init__(self, tokens: list[tuple[str, str]]):
        self.toks = tokens
        self.i = 0

    def parse(self) -> dict:
        node = self._group()
        if self.i != len(self.toks):
            raise ValueError("trailing tokens")
        return node

    def _group(self) -> dict:
        items: list[dict] = []
        ops: list[str] = []          # explicit operators between items
        pending_op: str | None = None
        while self.i < len(self.toks):
            kind, val = self.toks[self.i]
            if kind == "RP":
                break
            self.i += 1
            if kind in ("AND", "OR"):
                if items:
                    pending_op = kind.lower()
                continue
            if kind == "LP":
                item = self._group()
                if self.i >= len(self.toks) or self.toks[self.i][0] != "RP":
                    raise ValueError("unbalanced bracket")
                self.i += 1
            else:
                item = _phrase(val)
            if items:
                ops.append(pending_op or "implicit-and")
            items.append(item)
            pending_op = None
        if not items:
            raise ValueError("empty group")
        return _combine(items, ops)


def _combine(items: list[dict], ops: list[str]) -> dict:
    explicit = {o for o in ops if o != "implicit-and"}
    ambiguous = len(explicit) > 1
    # "and" (explicit or implicit) binds tighter than "or".
    or_terms: list[list[dict]] = [[items[0]]]
    for op, item in zip(ops, items[1:]):
        if op == "or":
            or_terms.append([item])
        else:
            or_terms[-1].append(item)
    terms = [t[0] if len(t) == 1 else _flat("and", t) for t in or_terms]
    node = terms[0] if len(terms) == 1 else _flat("or", terms)
    if ambiguous and "op" in node:
        node = {**node, "ambiguous": True}
    return node


def _flat(op: str, args: list[dict]) -> dict:
    out: list[dict] = []
    for a in args:
        if a.get("op") == op and not a.get("ambiguous"):
            out.extend(a["args"])
        else:
            out.append(a)
    return {"op": op, "args": out}


def parse_rule(raw: str | None) -> dict | None:
    """Rule text -> tree. Returns None for empty / 'None'."""
    if raw is None:
        return None
    text = " ".join(raw.split()).strip(" ./")
    # A unit code followed by a capitalised word starts a note sentence, e.g.
    # "... or ENGP1000 Students must enrol in ENGP1002 ..." -> keep only the rule.
    text = NOTE_START.split(text, maxsplit=1)[0].strip(" ./")
    if not text or text.lower() in ("none", "nil", "n/a"):
        return None
    try:
        return _Parser(_tokenise(text)).parse()
    except ValueError:
        return {"text": text}


def is_fully_parsed(tree: dict | None) -> bool:
    """True when the tree has no text leaves (used for the parse-rate stat)."""
    if tree is None:
        return True
    if "text" in tree:
        return False
    return all(is_fully_parsed(a) for a in tree.get("args", []))
