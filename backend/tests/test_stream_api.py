"""เกณฑ์รับงานเฟส 4 ข้อ 5 — WS /api/stream ส่งไม่เกิน 1 ครั้งต่อ 2 วินาที แม้ ingest รับ 14 ข้อความ/วินาที (วัดจริง)

รัน: .venv/bin/pytest -m integration tests/test_stream_api.py -v   (make up + make sim ก่อน)
"""

from __future__ import annotations

import json
import threading
import time

import httpx
import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect

from ingest.writer import EXEC_SQL
from tests.helpers import ingest_metrics, now

pytestmark = pytest.mark.integration

API = "http://127.0.0.1:8000"
WS = "ws://127.0.0.1:8000/api/stream"
ENTITY, CODE = "env-control-cabinet", "ENV_HUMIDITY_HIGH"


def collect(url: str, seconds: float) -> list[tuple[float, list[dict]]]:
    received: list[tuple[float, list[dict]]] = []
    deadline = time.monotonic() + seconds
    with connect(url, open_timeout=10) as socket:
        while (left := deadline - time.monotonic()) > 0:
            try:
                raw = socket.recv(timeout=left)
            except TimeoutError:
                break
            received.append((time.monotonic(), json.loads(raw)))
    return received


def test_stream_sends_at_most_one_message_per_two_seconds_under_full_ingest_load():
    rate = float(ingest_metrics()["rows_per_second_10s"])
    assert rate >= 10, f"ต้องเปิด simulator ก่อน (ตอนนี้ ingest เขียน {rate} แถว/วินาที)"

    messages = collect(WS, 20)
    gaps = [later[0] - earlier[0] for earlier, later in zip(messages, messages[1:], strict=False)]
    print(f"ingest {rate} แถว/วินาที → WS {len(messages)} ข้อความใน 20 วินาที · ช่วงห่างน้อยสุด {min(gaps):.3f} วินาที")
    assert 5 <= len(messages) <= 11, len(messages)
    assert min(gaps) >= 1.95, gaps

    events = [event for _, batch in messages for event in batch]
    assert {"tank", "pump", "meter", "zone", "sensor", "electric_node"} <= {e["type"] for e in events}
    for _, batch in messages:
        keys = [(e["type"], e["payload"]["id"]) for e in batch]
        assert len(keys) == len(set(keys)), "ในหนึ่งข้อความ entity หนึ่งต้องมีครั้งเดียว (ค่าล่าสุด)"

    # ★ entity ทั้งก้อน: field ต้องครบเท่ากับ GET ของ REST
    with httpx.Client(base_url=API, timeout=20) as api:
        for kind, path in (("tank", "/api/tanks/"), ("pump", "/api/pumps/"), ("sensor", "/api/environment/"),
                           ("electric_node", "/api/electric/nodes/"), ("zone", "/api/zones/")):
            sample = next(e for e in events if e["type"] == kind)
            assert set(sample["payload"]) == set(api.get(path + sample["payload"]["id"]).json()), kind


def test_alert_channel_carries_acknowledgement_and_no_telemetry(db, signed_in):
    operator = signed_in("somchai")
    db.rows("DELETE FROM alerts WHERE entity_id = %s AND kind = %s", ENTITY, CODE)
    params = {"entity_id": ENTITY, "kind": CODE, "severity": "warning", "started_at": now(),
              "peak_value": 85.0, "threshold": 80}
    for sql in EXEC_SQL["alert_open"]:
        db.run(sql, params)
    alert_id = str(db.value("SELECT alert_id FROM alerts WHERE entity_id = %s AND kind = %s AND ended_at IS NULL",
                            ENTITY, CODE))

    received: list[tuple[float, list[dict]]] = []
    listener = threading.Thread(target=lambda: received.extend(collect(f"{WS}?channels=alerts", 9)))
    listener.start()
    time.sleep(2)
    assert operator.post(f"/api/alerts/{alert_id}/acknowledge", json={"note": "ทดสอบ stream"}).is_success
    listener.join()

    events = [event for _, batch in received for event in batch]
    assert events and {e["type"] for e in events} == {"alert"}
    mine = [e for e in events if e["payload"]["id"] == alert_id]
    assert mine and mine[-1]["payload"]["state"] == "acknowledged"

    for sql in EXEC_SQL["alert_close"]:
        db.run(sql, {"entity_id": ENTITY, "kind": CODE, "ended_at": now(), "peak_value": None})


def test_unknown_channel_is_rejected_at_handshake():
    with pytest.raises(InvalidStatus):
        connect(f"{WS}?channels=everything", open_timeout=5)
