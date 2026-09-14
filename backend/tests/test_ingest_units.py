"""unit test ของ ingest — ไม่ต้องมี DB/MQTT"""

from datetime import UTC, datetime, timedelta

import pytest

from ingest.cache import Cache, Entity, Threshold
from ingest.liveness import Liveness
from ingest.normalize import PayloadError, heat_index, normalize_status, normalize_telemetry
from ingest.router import route
from ingest.rules import RuleEngine
from ingest.spool import Spool
from ingest.states import StateTracker

RECV = datetime(2026, 9, 13, 6, 45, 1, tzinfo=UTC)
AT = "2026-09-13T13:45:00+07:00"


# ─────────────── router ───────────────

def test_route_telemetry_status_and_main_meter_alias():
    assert route("plant/water/tank/tank-1/telemetry", "plant/water").entity_id == "tank-1"
    main = route("plant/water/meter/main/telemetry", "plant/water")
    assert (main.kind, main.entity_id) == ("meter", "meter-main")
    assert route("plant/water/device/esp32-vip/status", "plant/water").channel == "status"
    assert route("plant/water/valve/valve-zone-1/feedback", "plant/water").channel == "feedback"


@pytest.mark.parametrize("topic", ["other/tank/tank-1/telemetry", "plant/water/tank/tank-1",
                                   "plant/water/x/y/telemetry",
                                   "plant/water/tank//telemetry", "plant/water/tank/tank-1/telemetry/extra"])
def test_route_rejects_unknown(topic):
    assert route(topic, "plant/water") is None


# ─────────────── normalize ───────────────

def test_missing_value_is_null_not_zero():
    n = normalize_telemetry("env", "env-pump-room", {"at": AT, "values": {"temperatureC": 34.5, "humidityPct": 60,
                                                                           "pressureHpa": None}}, RECV)
    row = n.rows[0][1]
    assert row["pressure_hpa"] is None
    assert row["lux"] is None  # ไม่ส่งมาเลยก็ต้องเป็น None ไม่ใช่ 0
    assert row["rain_mm"] is None
    assert row["heat_index_c"] is not None


def test_zero_stays_zero():
    n = normalize_telemetry("env", "env-outdoor", {"at": AT, "values": {"lux": 0, "rainMm": 0}}, RECV)
    assert n.rows[0][1]["lux"] == 0 and n.rows[0][1]["rain_mm"] == 0


def test_out_of_range_becomes_null_but_row_kept():
    n = normalize_telemetry("pump", "pump-1", {"at": AT, "values": {"currentAmp": 9999, "voltage": 380}}, RECV)
    assert len(n.rows) == 1
    assert n.rows[0][1]["current"] is None and n.rows[0][1]["voltage"] == 380
    assert any(issue["event"] == "out_of_range" for issue in n.issues)


@pytest.mark.parametrize("bad", ["2026-09-13T13:45:00", "not-a-date", None, 12345])
def test_at_must_have_offset(bad):
    with pytest.raises(PayloadError):
        normalize_telemetry("tank", "tank-1", {"at": bad, "values": {"levelMeters": 1}}, RECV)


def test_invalid_types_and_bool_rejected():
    n = normalize_telemetry("tank", "tank-1", {"at": AT, "values": {"levelMeters": "2.3", "flowInLpm": True}}, RECV)
    assert n.rows[0][1]["level_m"] is None and n.rows[0][1]["flow_in_lpm"] is None


def test_power_three_phase_rows():
    phases = {p: {"voltage": 230, "currentAmp": 10, "powerWatt": 2000, "energyKwh": 5, "pf": 0.9, "frequencyHz": 50}
              for p in ("L1", "L2", "L3")}
    n = normalize_telemetry("power", "elec-production", {"at": AT, "values": {"phases": phases}}, RECV)
    assert [row["phase"] for _, row in n.rows] == ["L1", "L2", "L3", "total"]
    assert all(table == "power_telemetry" for table, _ in n.rows)
    total = n.rows[-1][1]
    assert total["power_w"] == 6000 and total["energy_kwh"] == 15 and total["current"] == 10
    assert total["voltage"] == 230 and total["pf"] == pytest.approx(6000 / (3 * 2300))


def test_power_total_is_null_when_a_phase_is_missing():
    phases = {"L1": {"powerWatt": 2000, "energyKwh": 5, "currentAmp": 9},
              "L2": {"powerWatt": None, "energyKwh": 5, "currentAmp": 12},
              "L3": {"powerWatt": 2000, "energyKwh": 5, "currentAmp": 8}}
    n = normalize_telemetry("power", "elec-production", {"at": AT, "values": {"phases": phases}}, RECV)
    total = n.rows[-1][1]
    assert total["power_w"] is None           # ห้ามบวกเท่าที่มี → ตัวเลขต่ำกว่าจริงแบบเงียบ ๆ
    assert total["energy_kwh"] == 15 and total["current"] == 12


def test_single_phase_has_no_total_row():
    n = normalize_telemetry("power", "elec-executive",
                            {"at": AT, "values": {"phases": {"single": {"powerWatt": 6400}}}}, RECV)
    assert [row["phase"] for _, row in n.rows] == ["single"]


def test_power_without_phases_is_rejected():
    with pytest.raises(PayloadError):
        normalize_telemetry("power", "elec-production", {"at": AT, "values": {"voltage": 230}}, RECV)


def test_pump_run_state_validated():
    ok = normalize_telemetry("pump", "pump-1", {"at": AT, "values": {"runState": "running"}}, RECV)
    bad = normalize_telemetry("pump", "pump-1", {"at": AT, "values": {"runState": "flying"}}, RECV)
    assert ok.rows[0][1]["run_state"] == "running" and bad.rows[0][1]["run_state"] is None


def test_status_and_lwt():
    message, online = normalize_status("esp32-vip", {"at": AT, "rssi": -60, "uptimeSeconds": 10, "lastError": None},
                                       RECV)
    assert online is None and message.rows[0][1]["rssi"] == -60
    message, online = normalize_status("esp32-vip", {"deviceId": "esp32-vip", "online": False}, RECV)
    assert message is None and online is False


def test_heat_index_matches_mock_formula():
    assert heat_index(25, 80) == 25.0
    assert heat_index(None, 50) is None
    # ค่าอ้างอิงคำนวณด้วย heatIndexOf() ของ lib/mock/simulator.ts ใน node
    assert heat_index(34.5, 68) == 47.5
    assert heat_index(30, 50) == 31.0
    assert heat_index(40.2, 33.3) == 45.1


# ─────────────── rules (debounce) ───────────────

PUMP_CURRENT = Threshold(warn_low=None, warn_high=11.5, crit_low=None, crit_high=13.0)
HIGH = frozenset({"high"})


def _run(engine, values, start=None):
    start = start or datetime(2026, 9, 13, tzinfo=UTC)
    ops = []
    for i, value in enumerate(values):
        at = start + timedelta(seconds=2 * i)
        ops += engine.evaluate("pump-1", "PUMP_OVERCURRENT", value, PUMP_CURRENT, HIGH, at)
    return ops


def test_single_breach_does_not_alert():
    assert _run(RuleEngine(), [14, 8, 8, 8]) == []


def test_sustained_breach_opens_once_then_closes_once():
    ops = _run(RuleEngine(), [13.5] * 15 + [8] * 5)
    kinds = [op["op"] for op in ops]
    assert kinds == ["alert_open", "alert_close"]
    assert ops[0]["params"]["severity"] == "critical" and ops[0]["params"]["peak_value"] == 13.5


def test_escalation_warning_to_critical():
    kinds = [op["op"] for op in _run(RuleEngine(), [12, 12, 12, 13.2, 13.2])]
    assert kinds == ["alert_open", "alert_escalate"]


def test_null_value_neither_breach_nor_normal():
    engine = RuleEngine()
    assert _run(engine, [14, 14, None, 14]) and _run(engine, [14]) == []


def test_mark_open_allows_close_after_restart():
    engine = RuleEngine()
    engine.mark_open("pump-1", "PUMP_OVERCURRENT", "critical")
    assert [op["op"] for op in _run(engine, [8, 8, 8])] == ["alert_close"]


# ─────────────── states ───────────────

def test_state_tracker_emits_on_change_only_and_ignores_old():
    tracker = StateTracker()
    t0 = datetime(2026, 9, 13, tzinfo=UTC)
    assert len(tracker.observe("pump-1", "pump_run_state", "running", t0)) == 1
    assert tracker.observe("pump-1", "pump_run_state", "running", t0 + timedelta(seconds=2)) == []
    assert tracker.observe("pump-1", "pump_run_state", "stopped", t0 - timedelta(seconds=10)) == []
    assert len(tracker.observe("pump-1", "pump_run_state", "stopped", t0 + timedelta(seconds=4))) == 1


# ─────────────── liveness ───────────────

def test_liveness_zombie_detected_by_silence():
    live = Liveness(timeout_s=30)
    live.track(["esp32-pond"], now=1000)
    assert live.touch("esp32-pond", 1001)[0][0] == "online"
    assert live.check(1025) == []
    events = live.check(1032)
    assert events and events[0][:2] == ("offline", "esp32-pond")
    assert events[0][2] == datetime.fromtimestamp(1001, tz=UTC)  # เวลาที่เงียบไปจริง
    assert live.check(1100) == []  # ไม่ซ้ำ
    assert live.touch("esp32-pond", 1101)[0][0] == "online"


def test_liveness_lwt_offline_immediately():
    live = Liveness(timeout_s=30)
    live.touch("esp32-vip", 1000)
    assert live.lwt_offline("esp32-vip", 1001)[0][0] == "offline"
    assert live.lwt_offline("esp32-vip", 1002) == []


# ─────────────── spool ───────────────

def test_spool_roundtrip_keeps_datetimes(tmp_path):
    spool = Spool(str(tmp_path), max_bytes=10_000_000)
    op = {"op": "insert", "table": "tank_telemetry", "row": {"time": RECV, "level_m": None}}
    spool.append([op])
    seen = []
    assert spool.replay(seen.extend) == 1
    assert seen[0]["row"]["time"] == RECV and seen[0]["row"]["level_m"] is None
    assert not spool.has_pending()


def test_spool_keeps_file_when_apply_fails(tmp_path):
    spool = Spool(str(tmp_path), max_bytes=10_000_000)
    spool.append([{"op": "x", "params": {}}])

    def boom(_):
        raise RuntimeError("db down")

    with pytest.raises(RuntimeError):
        spool.replay(boom)
    assert spool.has_pending()


def test_spool_cap_drops_oldest(tmp_path):
    spool = Spool(str(tmp_path), max_bytes=2_000)
    for i in range(5):
        spool._current = None  # บังคับไฟล์ใหม่ทุกครั้งเพื่อทดสอบการทิ้งไฟล์เก่า
        spool.append([{"op": "x", "params": {"pad": "x" * 900, "i": i}}])
    assert spool.size_bytes() <= 2_000 + 1_000
    assert len(spool.files()) < 5


# ─────────────── cache: % ระดับน้ำ ───────────────

def test_tank_percent_interpolates_and_clamps():
    cache = Cache("")
    cache.entities = {"tank-3": Entity("tank-3", "tank", None, None, {"capacityLiters": 490000}, True)}
    cache.profiles = {"tank-3": [(0.0, 0.0), (1.0, 92000.0), (1.5, 148000.0), (4.0, 490000.0)]}
    assert cache.tank_percent("tank-3", 1.25) == pytest.approx(120000 / 490000 * 100)
    assert cache.tank_percent("tank-3", 9) == pytest.approx(100)
    assert cache.tank_percent("tank-3", -1) == 0
    assert cache.tank_percent("tank-3", None) is None
