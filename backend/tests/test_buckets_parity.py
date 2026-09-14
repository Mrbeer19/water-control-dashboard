"""api/buckets.py ต้องให้ผลตรงกับ lib/utils/time-buckets.ts ทุกกรณี

ค่าอ้างอิงคำนวณจากไฟล์ .ts จริง (scripts/gen_buckets_golden.mjs) ไม่ได้เขียนมือ
"""

import json
from pathlib import Path

import pytest

from api import buckets

GOLDEN = json.loads((Path(__file__).parent / "fixtures" / "buckets_golden.json").read_text(encoding="utf-8"))


def test_max_points_matches():
    assert buckets.MAX_POINTS_PER_SERIES == GOLDEN["maxPoints"]


@pytest.mark.parametrize("case", GOLDEN["cases"], ids=lambda c: f"{c['zone']}-{c['g']}-{c['ts']}")
def test_bucket_edges_match_frontend(case):
    zone, ts, g = case["zone"], case["ts"], case["g"]
    start = buckets.bucket_start(ts, g, zone)
    assert start == case["start"]
    assert buckets.next_bucket_start(start, g, zone) == case["next"]
    assert buckets.expected_samples(start, g, zone, 2000) == case["expected"]
    assert buckets.is_partial_bucket(start, g, zone, ts) == case["partial"]


@pytest.mark.parametrize("case", GOLDEN["ranges"], ids=lambda c: f"span-{c['to'] - c['from']}")
def test_pairing_rules_match_frontend(case):
    assert buckets.preferred_granularity(case["from"], case["to"]) == case["preferred"]
    assert buckets.granularity_options(case["from"], case["to"]) == case["options"]
    for g, want in case["coerced"].items():
        assert buckets.coerce_granularity(g, case["from"], case["to"]) == want


@pytest.mark.parametrize("case", GOLDEN["starts"], ids=lambda c: f"{c['zone']}-{c['g']}")
def test_bucket_starts_match_frontend(case):
    assert buckets.bucket_starts(case["from"], case["to"], case["g"], case["zone"]) == case["starts"]
