"""สถานการณ์ทดสอบ S1–S14 ของเฟส 2 — ยิงกับ stack จริงที่ docker compose ขึ้นอยู่

รัน:  tests/run_scenarios.sh S2   ·   tests/run_scenarios.sh all
★ ต้องไม่มี simulator รันค้าง (S1/S13/S14 เรียก simulator เอง) ไม่งั้นค่าจริงจะปนกับค่าที่ฉีด
★ เรียงลำดับในไฟล์โดยตั้งใจ: เคสสั้นก่อน · S8/S9 ที่ปิด service ตรงกลาง · S1 (10 นาที) ท้ายสุด
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta

import pytest

from tests.helpers import (
    BACKEND,
    BKK,
    Clock,
    compose,
    container_state,
    ingest_drained,
    ingest_health_status,
    ingest_metrics,
    now,
    wait_for,
)

pytestmark = pytest.mark.integration

ALERTS = "SELECT alert_id, severity, started_at, ended_at FROM alerts WHERE entity_id = %s AND kind = %s"
OPEN_OFFLINE = "SELECT 1 FROM alerts WHERE entity_id = %s AND kind = 'DEVICE_OFFLINE' AND ended_at IS NULL"


def reset_rule(db, send, normal: dict, entity_id: str, code: str) -> None:
    """ส่งค่าปกติ 3 รอบให้ ingest ปิดเหตุค้างจากรอบก่อน แล้วลบประวัติของเหตุนี้ทิ้ง"""
    for _ in range(3):
        send(normal)
    wait_for(lambda: not db.rows(ALERTS + " AND ended_at IS NULL", entity_id, code), 10, f"ปิดเหตุค้าง {code}")
    db.rows("DELETE FROM alerts WHERE entity_id = %s AND kind = %s", entity_id, code)


# ─────────────── S2 · S3 debounce ───────────────

PUMP_NORMAL = {"currentAmp": 6.0, "pressureBar": 3.0, "runState": "running"}


def test_s02_overcurrent_for_30s_opens_exactly_one_critical_alert(db, device):
    node = device("esp32-pump-house")
    clock = Clock(now() - timedelta(seconds=55), 2)

    def send(values: dict) -> None:
        node.telemetry("pump", "pump-1", clock.next(), values)

    reset_rule(db, send, PUMP_NORMAL, "pump-1", "PUMP_OVERCURRENT")
    for _ in range(15):                      # 15 รอบ × 2 วินาที = 30 วินาที
        send({**PUMP_NORMAL, "currentAmp": 13.6})
    for _ in range(3):
        send(PUMP_NORMAL)

    wait_for(lambda: [r for r in db.rows(ALERTS, "pump-1", "PUMP_OVERCURRENT") if r[3] is not None], 10,
             "ต้องมี alert ที่เปิดแล้วปิด")
    time.sleep(2)
    rows = db.rows(ALERTS, "pump-1", "PUMP_OVERCURRENT")
    assert len(rows) == 1, rows
    assert rows[0][1] == "critical"


def test_s03_single_breach_is_debounced_no_alert(db, device):
    node = device("esp32-pump-house")
    clock = Clock(now() - timedelta(seconds=30), 2)

    def send(values: dict) -> None:
        node.telemetry("pump", "pump-1", clock.next(), values)

    reset_rule(db, send, PUMP_NORMAL, "pump-1", "PUMP_OVERCURRENT")
    send({**PUMP_NORMAL, "currentAmp": 14.0})
    for _ in range(3):
        send(PUMP_NORMAL)
    time.sleep(3)
    assert db.rows(ALERTS, "pump-1", "PUMP_OVERCURRENT") == []


# ─────────────── S4 · S5 liveness สองทาง ───────────────

def _come_online(db, node, kind: str, ident: str, values: dict) -> None:
    node.telemetry(kind, ident, now(), values)
    wait_for(lambda: not db.rows(OPEN_OFFLINE, node.device_id), 15, f"{node.device_id} ต้องกลับมา online ก่อน")


def test_s04_node_stops_without_lwt_is_caught_by_silence(db, device):
    node = device("esp32-pond")
    _come_online(db, node, "tank", "tank-3", {"levelMeters": 3.6})
    node.telemetry("tank", "tank-3", now(), {"levelMeters": 3.6})
    last_message = time.monotonic()
    node.close()   # ปิดแบบสุภาพ → ไม่มี LWT ต้องจับได้ด้วยทาง B

    wait_for(lambda: db.rows(OPEN_OFFLINE, "esp32-pond"), 60, "ต้องจับได้ว่า esp32-pond offline")
    elapsed = time.monotonic() - last_message
    print(f"\nS4: offline หลังเงียบ {elapsed:.1f} วินาที")
    assert 30 <= elapsed <= 40
    spans = db.rows("SELECT state FROM state_spans WHERE entity_id = 'esp32-pond' AND metric = 'online_state' "
                    "AND ended_at IS NULL")
    assert spans == [("offline",)]


def test_s04b_lwt_marks_offline_immediately(db, device):
    node = device("esp32-meter-main", keepalive=5)
    _come_online(db, node, "meter", "main", {"flowLpm": 300.0})
    node.telemetry("meter", "main", now(), {"flowLpm": 300.0})
    cut = time.monotonic()
    node.kill()    # ตัดสายกระทันหัน → broker ส่ง LWT แทน

    wait_for(lambda: db.rows(OPEN_OFFLINE, "esp32-meter-main"), 20, "LWT ต้องทำให้ offline")
    elapsed = time.monotonic() - cut
    print(f"\nS4b: offline ผ่าน LWT หลังตัดสาย {elapsed:.1f} วินาที")
    assert elapsed < 10

    # ล้าง LWT ที่ค้างเป็น retained ไม่ให้กวนรอบถัดไป
    device("esp32-meter-main").status(now())


def test_s05_zombie_node_still_connected_is_detected(db, device):
    node = device("esp32-env-outdoor")
    _come_online(db, node, "env", "env-outdoor", {"temperatureC": 30.0, "humidityPct": 70.0})
    node.telemetry("env", "env-outdoor", now(), {"temperatureC": 30.0, "humidityPct": 70.0})
    last_message = time.monotonic()

    wait_for(lambda: db.rows(OPEN_OFFLINE, "esp32-env-outdoor"), 60, "ต้องจับ node ค้างได้")
    elapsed = time.monotonic() - last_message
    print(f"\nS5: zombie ถูกจับหลังเงียบ {elapsed:.1f} วินาที · connection ยังต่ออยู่ = {node.client.is_connected()}")
    assert node.client.is_connected(), "เคสนี้ต้องไม่มี LWT — ถ้าหลุดจริงแปลว่าไม่ได้ทดสอบทาง B"
    assert 30 <= elapsed <= 40


# ─────────────── S6 · S7 ───────────────

def test_s06_energy_counter_reset_is_recorded(db, device):
    node = device("esp32-pump-house")
    base = now() - timedelta(seconds=20)
    for offset, kwh in ((0, 5000.0), (2, 5000.4), (4, 0.3)):
        node.telemetry("pump", "pump-2", base + timedelta(seconds=offset), {"energyKwh": kwh, "runState": "stopped"})
    reset_at = base + timedelta(seconds=4)
    rows = wait_for(lambda: db.rows("SELECT value_before, value_after FROM counter_resets "
                                    "WHERE entity_id = 'pump-2' AND metric = 'energy_kwh' AND at = %s", reset_at),
                    10, "ต้องมีแถวใน counter_resets")
    assert rows == [(5000.4, 0.3)]


def test_s07_clock_skew_is_logged_but_row_is_kept(db, device):
    node = device("esp32-pump-house")
    before = ingest_metrics().get("clock_skew_total", 0)
    at = now() - timedelta(hours=1)
    node.telemetry("env", "env-pump-room", at, {"temperatureC": 31.2, "humidityPct": 61.0})
    wait_for(lambda: db.rows("SELECT 1 FROM env_telemetry WHERE entity_id = 'env-pump-room' AND time = %s", at), 10,
             "แถวที่นาฬิกาเพี้ยนต้องยังถูกเก็บ")
    assert ingest_metrics().get("clock_skew_total", 0) >= before + 1


# ─────────────── S8 · S9 ความทนทาน ───────────────

def _publish_through_outage(node, kind: str, ident: str, values: dict, service: str, total_s: int,
                            down_at: int, up_at: int, during=None):
    """ส่งค่าทุก 1 วินาทีขณะปิด/เปิด service กลางทาง

    ★ เล่นเป็น firmware ที่ถูกต้อง: ขาด broker ต้องเก็บค่าไว้ในบอร์ด แล้วส่งตามเมื่อต่อได้
      (paho ไม่คิวข้อความตอนหลุดให้เอง — publish ตอนหลุดคือทิ้ง)
    ★ `at` ต้องไม่ซ้ำ: ตอนส่งตามหลังรอ compose หลายข้อความอาจตกมิลลิวินาทีเดียวกัน
      แล้ว PK ถือเป็นแถวซ้ำ ซึ่งถูกต้องตาม DB แต่ทำให้นับ "ส่ง" เกินจริง
    """
    sent: list = []
    infos: list = []
    backlog: list = []
    started = time.monotonic()
    stopped = restarted = checked = False

    def flush_backlog() -> None:
        while backlog and node.client.is_connected():
            infos.append(node.telemetry(kind, ident, backlog.pop(0), values, wait=False))

    for i in range(total_s):
        at = now()
        if sent and at <= sent[-1]:
            at = sent[-1] + timedelta(milliseconds=1)
        sent.append(at)
        backlog.append(at)
        flush_backlog()
        elapsed = time.monotonic() - started
        if not stopped and elapsed >= down_at:
            compose("stop", service)
            stopped = True
        if during is not None and stopped and not checked and elapsed >= (down_at + up_at) / 2:
            during()
            checked = True
        if stopped and not restarted and elapsed >= up_at:
            compose("up", "-d", "--wait", service)
            restarted = True
        time.sleep(max(0.0, started + i + 1 - time.monotonic()))
    return sent, infos


def test_s08_broker_down_60s_reconnects_and_data_catches_up(db, device):
    node = device("esp32-meter-main", clean_session=False)
    sent, infos = _publish_through_outage(node, "meter", "main", {"flowLpm": 310.0}, "mosquitto",
                                          total_s=100, down_at=10, up_at=70)
    wait_for(lambda: all(info.is_published() for info in infos), 60, "ข้อความที่ค้างในตัวส่งต้องถูกส่งครบ")
    wait_for(lambda: ingest_metrics()["mqtt_connected"], 60, "ingest ต้อง reconnect เอง")
    ingest_drained()
    got = db.value("SELECT count(*) FROM meter_telemetry WHERE entity_id = 'meter-main' AND time BETWEEN %s AND %s",
                   sent[0], sent[-1])
    print(f"\nS8: ส่ง {len(sent)} · ถึง DB {got}")
    assert got == len(sent)


def test_s09_db_down_60s_ingest_survives_spools_and_backfills_without_duplicates(db, device):
    node = device("esp32-vip")
    state_before = container_state("ingest")
    spooled_before = ingest_metrics().get("ops_spooled", 0)
    health_during: list[int] = []

    sent, _ = _publish_through_outage(node, "tank", "tank-2", {"levelMeters": 1.5}, "timescaledb",
                                      total_s=90, down_at=10, up_at=70,
                                      during=lambda: health_during.append(ingest_health_status()))
    wait_for(lambda: ingest_metrics()["db_up"], 120, "ingest ต้องต่อ DB กลับได้เอง")
    ingest_drained()

    total, distinct = db.rows("SELECT count(*), count(DISTINCT time) FROM tank_telemetry "
                              "WHERE entity_id = 'tank-2' AND time BETWEEN %s AND %s", sent[0], sent[-1])[0]
    spooled = ingest_metrics().get("ops_spooled", 0) - spooled_before
    print(f"\nS9: ส่ง {len(sent)} · ใน DB {total} (ไม่ซ้ำ {distinct}) · ลง spool {spooled} op")
    assert health_during == [200], "ingest ต้องตอบ /health ได้ระหว่าง DB ล่ม"
    assert spooled > 0, "ช่วง DB ล่มต้องเขียนลง spool"
    assert total == distinct == len(sent)
    assert container_state("ingest") == state_before, "ingest ต้องไม่ crash/รีสตาร์ท"


# ─────────────── S10 · S11 · S12 ───────────────

def test_s10_duplicate_payload_three_times_stores_one_row(db, device):
    node = device("esp32-vip")
    at = now()
    for _ in range(3):
        node.telemetry("tank", "tank-2", at, {"levelMeters": 1.42})
    time.sleep(3)
    assert db.value("SELECT count(*) FROM tank_telemetry WHERE entity_id = 'tank-2' AND time = %s", at) == 1


def test_s11_pump_toggling_20_times_gives_20_running_spans(db, device):
    node = device("esp32-vip")
    base = now() - timedelta(seconds=50)
    # ★ เริ่มจาก stopped ก่อน — ถ้า span ล่าสุดใน DB เป็น running อยู่แล้ว ข้อความ running แรกจะต่อ span เดิม
    #   (ถูกต้องตามหลัก "เปลี่ยนสถานะเท่านั้นถึงเปิด span ใหม่") แล้วเทสจะนับได้ 19
    node.telemetry("pump", "pump-3", base - timedelta(seconds=1), {"runState": "stopped", "pressureBar": 0.2})
    for i in range(40):
        running = i % 2 == 0
        node.telemetry("pump", "pump-3", base + timedelta(seconds=i), {
            "runState": "running" if running else "stopped", "pressureBar": 3.0 if running else 0.2,
            "currentAmp": 2.0 if running else 0.0})
    window_end = base + timedelta(seconds=40)
    count_sql = ("SELECT count(*) FROM state_spans WHERE entity_id = 'pump-3' AND metric = 'pump_run_state' "
                 "AND state = 'running' AND started_at >= %s AND started_at < %s")
    wait_for(lambda: db.value(count_sql, base, window_end) == 20, 15, "ต้องมี running span 20 ช่วง")
    assert db.value(count_sql, base, window_end) == 20


def test_s12_pipe_burst_zone3_alerts_within_10s(db, device):
    node = device("esp32-meter-bank")

    def send(flow: float) -> None:
        node.telemetry("meter", "meter-zone-3", now(), {"flowLpm": flow})

    for _ in range(3):
        send(20.0)
        time.sleep(0.05)
    wait_for(lambda: not db.rows(ALERTS + " AND ended_at IS NULL", "zone-3", "ZONE_FLOW_HIGH"), 10, "ปิดเหตุค้าง")
    db.rows("DELETE FROM alerts WHERE entity_id = 'zone-3' AND kind = 'ZONE_FLOW_HIGH'")

    burst_started = time.monotonic()
    for i in range(3):               # ท่อแตก: อัตราไหลพุ่งเกินเกณฑ์วิกฤต (42 L/min) ตามจังหวะส่งจริง 2 วินาที
        send(65.0)
        if i < 2:
            time.sleep(2)
    wait_for(lambda: db.rows(ALERTS + " AND ended_at IS NULL", "zone-3", "ZONE_FLOW_HIGH"), 10, "ต้องเตือนท่อแตก")
    elapsed = time.monotonic() - burst_started
    print(f"\nS12: เตือนหลังอัตราไหลพุ่ง {elapsed:.1f} วินาที")
    assert elapsed <= 10
    for _ in range(3):
        send(20.0)
        time.sleep(0.05)


# ─────────────── S13 · S14 ข้อมูลพร้อมให้เฟสถัดไป ───────────────

def run_simulator(env: dict[str, str], *args: str, timeout: float) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", "simulator.plant", "--host", "127.0.0.1", *args], cwd=BACKEND,
                          env={**os.environ, "MQTT_DEVICE_PASSWORD": env["MQTT_DEVICE_PASSWORD"]},
                          check=True, capture_output=True, text=True, timeout=timeout)


def test_s13_night_leak_zone7_shows_unmetered_water(db, env):
    start = (datetime.now(BKK) - timedelta(days=1)).replace(hour=23, minute=0, second=0, microsecond=0)
    end = start + timedelta(minutes=20)
    run_simulator(env, "--fast", "--start", start.isoformat(), "--duration", "1200", "--scenario", "night_leak",
                  "--seed", "13", timeout=600)
    ingest_drained()
    leak = db.value("""
        WITH p AS (SELECT time, sum(flow_lpm) AS pumps FROM pump_telemetry
                    WHERE entity_id IN ('pump-1', 'pump-2') AND time >= %s AND time < %s GROUP BY time),
             z AS (SELECT m.time, sum(m.flow_lpm) AS zones FROM meter_telemetry m JOIN entities e USING (entity_id)
                    JOIN zones zn ON zn.zone_id = e.zone_id
                    WHERE NOT zn.is_vip AND m.time >= %s AND m.time < %s GROUP BY m.time)
        SELECT avg(p.pumps - z.zones) FROM p JOIN z USING (time)""", start, end, start, end)
    print(f"\nS13: น้ำที่ปั๊มสูบแต่มิเตอร์โซนไม่เห็น เฉลี่ย {leak:.2f} L/min (ตั้งไว้ 11.4)")
    assert 9 <= float(leak) <= 14


def test_s14_degrading_pump1_draws_35_percent_more_power(db, env):
    day = datetime.now(BKK) - timedelta(days=1)
    # เลือกช่วงที่ปั๊ม 1 เข้าเวร (ช่วงคู่ของรอบ 12 ชม. ตามเวลาไทย)
    start = next(t for t in (day.replace(hour=9, minute=0, second=0, microsecond=0),
                             day.replace(hour=14, minute=0, second=0, microsecond=0))
                 if int((t.timestamp() + 7 * 3600) // (12 * 3600)) % 2 == 0)
    end = start + timedelta(minutes=20)
    run_simulator(env, "--fast", "--start", start.isoformat(), "--duration", "1200", "--scenario", "pump_degrading",
                  "--seed", "14", timeout=600)
    ingest_drained()
    ratio = db.value("""
        SELECT avg(power_w / (3000 * (0.35 + 0.65 * least(flow_lpm / 220.0, 1.15))))
          FROM pump_telemetry
         WHERE entity_id = 'pump-1' AND run_state = 'running' AND flow_lpm > 50
           AND time >= %s + interval '5 minutes' AND time < %s""", start, end)
    print(f"\nS14: กำลังไฟปั๊ม 1 เทียบค่าปกติที่อัตราไหลเดียวกัน = {ratio:.3f} เท่า (ตั้งไว้ 1.35)")
    assert 1.25 <= float(ratio) <= 1.45


# ─────────────── S1 เดินปกติ — ท้ายสุดเพราะนานที่สุด ───────────────

def test_s01_normal_run_28_streams_no_missing_rows_lag_under_2s(db, env):
    duration = int(os.environ.get("S1_DURATION", "600"))
    # ★ เริ่มจากฐานที่สะอาด: S13/S14 ก่อนหน้าเทข้อความย้อนหลังเป็นหมื่น ค่า lag สูงสุดของหน้าต่าง 1 นาทียังค้างอยู่ตอนเริ่มเทสนี้
    #   (เคยได้ 61,674 ms ห้าจุดแรกแล้วลดเหลือ 1,437 ms) — รอให้พ้นก่อน ช่วง 600 วินาทีของ S1 ยังต้องต่ำกว่า 2 วินาทีทุกจุด
    ingest_drained()
    wait_for(lambda: (ingest_metrics().get("max_flush_lag_ms_1m") or 0) < 2000, 120,
             "lag ของเทสก่อนหน้ายังไม่พ้นหน้าต่าง 1 นาที")
    report_path = BACKEND / "data" / "s01-report.json"
    process = subprocess.Popen(
        [sys.executable, "-m", "simulator.plant", "--host", "127.0.0.1", "--duration", str(duration),
         "--seed", "1", "--report", str(report_path)],
        cwd=BACKEND, env={**os.environ, "MQTT_DEVICE_PASSWORD": env["MQTT_DEVICE_PASSWORD"]},
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lags: list[float] = []
    while process.poll() is None:
        lag = ingest_metrics().get("max_flush_lag_ms_1m")
        if lag is not None:
            lags.append(float(lag))
        time.sleep(5)
    output = process.stdout.read() if process.stdout else ""
    assert process.returncode == 0, output
    ingest_drained()

    report = json.loads(report_path.read_text(encoding="utf-8"))
    missing = {}
    for key, expected in report["rows"].items():
        table, entity, phase = key.split(":")
        phase_sql = " AND phase = %s" if phase else ""
        params = [entity, report["start"], report["end"]] + ([phase] if phase else [])
        actual = db.value(f"SELECT count(*) FROM {table} WHERE entity_id = %s AND time >= %s AND time < %s{phase_sql}",
                          *params)
        if actual != expected:
            missing[key] = {"expected": expected, "actual": actual}
    # 28 stream = ค่าวัดจริงจากอุปกรณ์ · ไม่นับสถานะอุปกรณ์ และแถว 'total' ที่ ingest คำนวณเพิ่ม (D-22)
    streams = [key for key in report["rows"] if not key.startswith("device_status") and not key.endswith(":total")]
    print(f"\nS1: {len(streams)} stream · {sum(report['rows'].values())} แถว · lag สูงสุด {max(lags, default=0):.0f} ms")
    assert len(streams) == 28
    assert not missing, missing
    assert lags and max(lags) < 2000
