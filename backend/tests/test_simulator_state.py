"""simulator รีสตาร์ตแล้วตัวนับสะสมต้องนับต่อ ไม่ถอยหลัง (ไม่งั้น backend มองเป็นการรีเซ็ตแล้วนับยอดหน้าปัดทั้งก้อน)"""

from __future__ import annotations

import json
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path

import yaml

from simulator.plant import Plant, save_state
from simulator.scenarios import Scenarios

PROFILE = yaml.safe_load((Path(__file__).parents[1] / "simulator" / "profiles.yaml").read_text(encoding="utf-8"))
START = datetime(2026, 9, 14, 3, 0, tzinfo=UTC)


def plant(seed: int) -> Plant:
    return Plant(PROFILE, Scenarios.from_names([], PROFILE), random.Random(seed))


def flat(counters: dict) -> dict[str, float]:
    out = {f"meter:{k}": v for k, v in counters["meters"].items()} | {"main": counters["main"]}
    out |= {f"pump:{k}": v for k, v in counters["pumps"].items()}
    out |= {f"power:{n}:{p}": v for n, phases in counters["power"].items() for p, v in phases.items()}
    return out


def test_restart_resumes_counters(tmp_path: Path) -> None:
    first = plant(1)
    for i in range(900):
        first.step(START + timedelta(seconds=2 * i), 2.0)
    before = flat(first.counters())
    assert before["main"] > PROFILE["main_meter"]["initial_m3"]

    path = tmp_path / "counters.json"
    save_state(path, first)
    second = plant(2)
    second.restore(json.loads(path.read_text(encoding="utf-8")))
    assert flat(second.counters()) == before

    second.step(START + timedelta(seconds=1800), 2.0)
    after = flat(second.counters())
    assert all(after[key] >= before[key] for key in before)


def test_restore_never_lowers_counters() -> None:
    fresh = plant(3)
    initial = flat(fresh.counters())
    fresh.restore({"meters": dict.fromkeys(fresh.meter_m3, 0.0), "main": 0.0, "pumps": {"pump-1": 0.0},
                   "power": {}, "unknown": 1})
    assert flat(fresh.counters()) == initial
