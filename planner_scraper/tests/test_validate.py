"""The sample data must stay valid, and the validator must catch broken data."""
import json
import shutil
from pathlib import Path

import pytest

from planner_scraper.validate import validate

SAMPLE = Path(__file__).resolve().parents[2] / "data" / "planner-sample"
YEAR = "2026"


def test_sample_data_is_valid():
    assert validate(SAMPLE) == []


@pytest.fixture
def copy(tmp_path):
    dst = tmp_path / "data"
    shutil.copytree(SAMPLE, dst)
    return dst


def edit(path: Path, fn):
    data = json.loads(path.read_text())
    fn(data)
    path.write_text(json.dumps(data))


def test_unknown_section(copy):
    edit(copy / "handbooks" / YEAR / "components" / "science" / "computer-science.json",
         lambda d: d["kinds"]["major"]["requirements"][0]["pool"].update(sections=["nope"]))
    assert any("unknown section nope" in e for e in validate(copy))


def test_unknown_unit_in_pool(copy):
    edit(copy / "handbooks" / YEAR / "pools" / "table-o.json", lambda d: d["units"].append("ZZZZ9999"))
    assert any("unknown unit ZZZZ9999" in e for e in validate(copy))


def test_email_is_rejected(copy):
    edit(copy / "meta.json", lambda d: d.update(note="contact someone@sydney.edu.au"))
    assert any("email" in e for e in validate(copy))


def test_requirements_over_total(copy):
    edit(copy / "handbooks" / YEAR / "courses" / "commerce.json", lambda d: d.update(totalCp=60))
    assert any("requirements need at least" in e for e in validate(copy))


def test_unknown_choice(copy):
    edit(copy / "handbooks" / YEAR / "courses" / "science.json",
         lambda d: d["requirements"]["children"][1].update(choice="zz"))
    assert any("unknown choice" in e for e in validate(copy))
