"""เกณฑ์รับงานเฟส 6 ข้อ 1–2 — น้ำสูญหายจากข้อมูลจำลองต่อเนื่อง (simulator --fast ย้อนหลังไปเมื่อวาน)

รัน: .venv/bin/pytest -m integration tests/test_worker_api.py -v   (make up + make sim ก่อน · ใช้เวลาหลายนาที)

★ ปิด simulator ตัวจริงระหว่างเทส — simulator ย้อนหลังใช้ client id เดียวกัน ต่อพร้อมกันจะเตะกันหลุด
★ ลบข้อมูลย้อนหลังที่ฉีดทิ้งตอนจบแล้ว refresh aggregate วันนั้นใหม่ — ตัวนับของ simulator ย้อนหลังเริ่มจากค่าตั้งต้น
  ใน profile ต่อกับข้อมูลจริงไม่ได้ ถ้าทิ้งไว้ รายงานที่ครอบวันนั้นจะนับเป็นตัวนับรีเซ็ต (D-74)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta

import httpx
import pytest

from tests.helpers import BACKEND, BKK, ingest_drained

pytestmark = pytest.mark.integration
API = "http://127.0.0.1:8000"
SIM = ["docker", "compose", "-f", "docker-compose.yml", "-f", "docker-compose.sim.yml"]
TABLES = ("tank_telemetry", "pump_telemetry", "meter_telemetry", "env_telemetry", "power_telemetry", "device_status")
LEAD_MINUTES = 10      # ข้อมูลก่อนหน้าต่าง ให้ตัวนับมี bucket ก่อนหน้า
WINDOW_MINUTES = 30
KIND = "UNACCOUNTED_WATER_HIGH"


class History:
    def __init__(self, db, env: dict[str, str]) -> None:
        self.db, self.env = db, env
        self.spans: list[tuple[datetime, datetime]] = []

    def backfill(self, start: datetime, scenario: str, seed: int) -> datetime:
        """เดิน simulator ย้อนหลัง LEAD + WINDOW นาที คืนปลายหน้าต่าง"""
        minutes = LEAD_MINUTES + WINDOW_MINUTES
        end = start + timedelta(minutes=minutes)
        self.spans.append((start, end))
        subprocess.run([sys.executable, "-m", "simulator.plant", "--host", "127.0.0.1", "--fast",
                        "--start", start.isoformat(), "--duration", str(minutes * 60), "--scenario", scenario,
                        "--seed", str(seed)], cwd=BACKEND, check=True, capture_output=True, text=True, timeout=1500,
                       env={**os.environ, "MQTT_DEVICE_PASSWORD": self.env["MQTT_DEVICE_PASSWORD"]})
        ingest_drained(300)
        self.refresh(start)
        return end

    def refresh(self, moment: datetime) -> None:
        """aggregate ชั้นล่างก่อนชั้นบน · ช่วงวันเต็มตามเวลาโรงงาน (ชั้นรายวันตัดที่เที่ยงคืน)"""
        day = moment.astimezone(BKK).replace(hour=0, minute=0, second=0, microsecond=0)
        views = [row[0] for row in self.db.rows("SELECT view_name FROM timescaledb_information.continuous_aggregates")]
        for suffix in ("_5m", "_1h", "_1d"):
            for view in sorted(v for v in views if v.endswith(suffix)):
                self.db.rows(f"CALL refresh_continuous_aggregate('{view}', '{day.isoformat()}'::timestamptz, "
                             f"'{(day + timedelta(days=1)).isoformat()}'::timestamptz)")

    def cleanup(self) -> None:
        for start, end in self.spans:
            for table in TABLES:
                self.db.rows(f"DELETE FROM {table} WHERE time >= %s AND time <= %s", start, end)
            self.db.rows("DELETE FROM plant_metrics WHERE time >= %s AND time <= %s", start, end)
            self.db.rows("UPDATE alerts SET ended_at = started_at WHERE ended_at IS NULL AND started_at <= %s", end)
            self.refresh(start)


@pytest.fixture(scope="module")
def history(db, env):
    subprocess.run([*SIM, "stop", "simulator"], cwd=BACKEND, check=True, capture_output=True, timeout=120)
    made = History(db, env)
    try:
        yield made
    finally:
        subprocess.run([*SIM, "up", "-d", "simulator"], cwd=BACKEND, check=False, capture_output=True, timeout=300)
        made.cleanup()


def evaluate(end: datetime, window: int = WINDOW_MINUTES) -> dict:
    result = subprocess.run(["docker", "compose", "exec", "-T", "worker", "python", "-m", "api.worker", "unaccounted",
                             "--end", end.isoformat(), "--window", str(window)],
                            cwd=BACKEND, check=True, capture_output=True, text=True, timeout=180)
    return json.loads(result.stdout.strip().splitlines()[-1])


def yesterday(hour: int) -> datetime:
    return (datetime.now(BKK) - timedelta(days=1)).replace(hour=hour, minute=0, second=0, microsecond=0)


def plant_alert(db, at: datetime) -> tuple | None:
    rows = db.rows("SELECT severity, peak_value, threshold FROM alerts WHERE entity_id = 'plant' AND kind = %s "
                   "AND started_at = %s", KIND, at)
    return rows[0] if rows else None


def test_1_filling_the_reserve_pond_for_30_minutes_is_not_a_leak(history, db):
    end = history.backfill(yesterday(14), "pond_fill", seed=61)
    result = evaluate(end)
    print(f"\nข้อ 1: มิเตอร์หลัก {result['mainMeterCubicMeters']} · โซน {result['zoneTotalCubicMeters']} · "
          f"Δถัง {result['storageDeltaCubicMeters']} → สูญหาย {result['unaccountedPercent']}%")

    assert result["missing"] == [] and result["skipped"] is None
    main, zones = result["mainMeterCubicMeters"], result["zoneTotalCubicMeters"]
    # ถ้าไม่หัก Δstorage (main − Σzone) จะดูเหมือนรั่วเกินเกณฑ์ — พิสูจน์ว่าเทสนี้วัดสิ่งที่ตั้งใจวัดจริง
    assert (main - zones) / main * 100 > 8
    assert result["storageDeltaCubicMeters"] > 0
    assert abs(result["unaccountedPercent"]) < 8 and result["severity"] is None
    assert result["alert"] in ("normal", "closed") and plant_alert(db, end) is None


def test_2_night_leak_in_zone_7_raises_unaccounted_water_alert(history, db):
    end = history.backfill(yesterday(23), "night_leak", seed=62)
    # alert ที่ค้างจากเทสอื่นหรือรอบก่อน → ผลจะเป็น ongoing · ปิดแบบเดียวกับตอนเก็บกวาด (ended_at = started_at)
    db.rows("UPDATE alerts SET ended_at = started_at WHERE entity_id = 'plant' AND kind = %s AND ended_at IS NULL",
            KIND)
    result = evaluate(end)
    print(f"\nข้อ 2: มิเตอร์หลัก {result['mainMeterCubicMeters']} · โซน {result['zoneTotalCubicMeters']} · "
          f"Δถัง {result['storageDeltaCubicMeters']} → สูญหาย {result['unaccountedPercent']}% ({result['severity']})")

    assert result["missing"] == [] and result["unaccountedPercent"] > 8
    assert result["severity"] in ("warning", "critical") and result["alert"] == "opened"
    alert = plant_alert(db, end)
    assert alert is not None and alert[0] == result["severity"]
    assert float(alert[1]) == result["unaccountedPercent"] and float(alert[2]) in (8, 15)

    again = evaluate(end)                      # ประเมินหน้าต่างเดิมซ้ำ = alert เดิม ไม่เปิดแถวใหม่
    assert again["alert"] == "ongoing"
    assert db.value("SELECT count(*) FROM alerts WHERE entity_id = 'plant' AND kind = %s AND started_at = %s",
                    KIND, end) == 1

    history.refresh(end)
    with httpx.Client(base_url=API, timeout=30) as api:
        series = api.get("/api/metrics/series", params={
            "sourceType": "system", "sourceId": "plant", "metric": "unaccounted_percent", "granularity": "minute_5",
            "from": int((end - timedelta(minutes=5)).timestamp() * 1000),
            "to": int((end + timedelta(minutes=5)).timestamp() * 1000)}).json()
    assert series["kind"] == "gauge" and series["unit"] == "%"
    stored = [p["avg"] for p in series["points"] if p["avg"] is not None]
    assert stored == [pytest.approx(result["unaccountedPercent"])]
