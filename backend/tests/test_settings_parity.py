"""validate_settings() ต้องให้ผลเหมือน validateSettings() ของหน้าบ้านทุกตัวอักษรและทุกลำดับ

ค่าอ้างอิงสร้างจากไฟล์ .ts ตัวจริง: make settings-golden
"""

import json

import pytest

from api.settings import validate_settings
from tests.helpers import BACKEND

CASES = json.loads((BACKEND / "tests" / "fixtures" / "settings_golden.json").read_text(encoding="utf-8"))


def test_golden_exercises_every_rule():
    paths = {error["path"].split(".")[0] + "." + error["path"].split(".")[-1] for case in CASES
             for error in case["errors"]}
    assert len(paths) >= 20, sorted(paths)
    assert [case["errors"] for case in CASES if case["name"] == "ค่าตั้งต้นผ่านทุกข้อ"] == [[]]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_validate_settings_matches_frontend(case):
    assert validate_settings(case["settings"]) == case["errors"]
