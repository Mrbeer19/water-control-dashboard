"""unit test ของข้อความแจ้งเตือนและกฎการส่ง — ไม่ต้องมี DB"""

import re
from datetime import UTC, datetime, time

import pytest

from api.alerts import CATALOG, js_number, message, render_notification, thai_datetime
from api.notifier.dispatcher import in_quiet_hours, retry_delay, should_notify
from api.registry import Registry
from tests.helpers import BACKEND

TZ = "Asia/Bangkok"


def frontend_alert_codes() -> set[str]:
    source = (BACKEND.parent / "lib" / "types.ts").read_text(encoding="utf-8")
    block = re.search(r"export type AlertCode =(.*?);", source, re.S)
    assert block is not None
    return set(re.findall(r"'([A-Z_]+)'", block.group(1)))


def test_catalog_matches_every_alert_code_in_frontend_types():
    assert set(CATALOG) == frontend_alert_codes()


@pytest.mark.parametrize("code", sorted(CATALOG))
@pytest.mark.parametrize("severity", ["critical", "warning", "info"])
def test_every_template_renders_without_leftover_placeholders(code, severity):
    th, en = message(code, severity, "ปั๊มหลัก 1", "Main Pump 1")
    assert "{" not in th + en and th and en


def test_message_uses_entity_name_and_threshold_level():
    assert message("TANK_LEVEL_LOW", "warning", "ถังใต้ดินหลัก", "Main Underground Tank") == (
        "ระดับน้ำถังใต้ดินหลัก ต่ำกว่าเกณฑ์เตือน", "Main Underground Tank level below warning threshold")
    th, en = message("SOMETHING_NEW", "critical", "ถัง", "Tank")
    assert "SOMETHING_NEW" in th and "SOMETHING_NEW" in en


# ค่าอ้างอิงจาก Intl.DateTimeFormat('th-TH-u-ca-buddhist', {dateStyle/timeStyle: 'medium'}) ของ node
NODE_THAI = [
    (1767398400000, "3 ม.ค. 2569 07:00:00"), (1770170704000, "4 ก.พ. 2569 09:05:04"),
    (1772683808000, "5 มี.ค. 2569 11:10:08"), (1775456112000, "6 เม.ย. 2569 13:15:12"),
    (1778142016000, "7 พ.ค. 2569 15:20:16"), (1780914320000, "8 มิ.ย. 2569 17:25:20"),
    (1783600224000, "9 ก.ค. 2569 19:30:24"), (1786372528000, "10 ส.ค. 2569 21:35:28"),
    (1789144832000, "11 ก.ย. 2569 23:40:32"), (1791830736000, "13 ต.ค. 2569 01:45:36"),
    (1794603040000, "14 พ.ย. 2569 03:50:40"), (1797288944000, "15 ธ.ค. 2569 05:55:44"),
    (1830274200000, "1 ม.ค. 2571 00:30:00"),
]


@pytest.mark.parametrize(("ms", "expected"), NODE_THAI)
def test_thai_datetime_matches_frontend_formatter(ms, expected):
    assert thai_datetime(datetime.fromtimestamp(ms / 1000, UTC), TZ) == expected


def test_js_number_matches_template_string_output():
    # ค่าอ้างอิงจาก `${v}` ของ node
    assert [js_number(v) for v in (45.6, 45.0, -81.0, 9.4, 0.1 + 0.2, 1234567.891)] == \
        ["45.6", "45", "-81", "9.4", "0.30000000000000004", "1234567.891"]


def test_render_notification_matches_frontend_preview_layout():
    reg = Registry({}, {}, {}, {}, {}, {"general": {"siteName": "โรงงานสาขาธัญบุรี", "timezone": TZ}}, {})
    alert = {"severity": "critical", "messageTh": "อุณหภูมิเซนเซอร์ตู้คอนโทรล สูงเกินเกณฑ์วิกฤต",
             "sourceName": "เซนเซอร์ตู้คอนโทรล", "triggerValue": 45.6, "thresholdValue": 45.0, "unit": "°C",
             "raisedAt": "2026-09-14T12:26:43.000+07:00", "occurrenceCount": 2}
    title, body = render_notification(alert, reg)
    assert title == "🔴 วิกฤต · โรงงานสาขาธัญบุรี"
    assert body.split("\n") == [title, "อุณหภูมิเซนเซอร์ตู้คอนโทรล สูงเกินเกณฑ์วิกฤต", "จุดเกิดเหตุ: เซนเซอร์ตู้คอนโทรล",
                                "ค่าที่วัดได้: 45.6 °C (เกณฑ์ 45 °C)", "เวลา: 14 ก.ย. 2569 12:26:43", "เกิดซ้ำ 2 ครั้ง"]
    alert |= {"triggerValue": None, "occurrenceCount": 1}
    assert len(render_notification(alert, reg)[1].split("\n")) == 4


QUIET = {"enabled": True, "startTime": "22:00", "endTime": "06:00", "overrideSeverity": "critical"}


@pytest.mark.parametrize(("at", "quiet", "expected"), [
    (time(23, 0), QUIET, True), (time(5, 59), QUIET, True), (time(22, 0), QUIET, True),
    (time(6, 0), QUIET, False), (time(12, 0), QUIET, False),
    (time(12, 0), QUIET | {"startTime": "09:00", "endTime": "17:00"}, True),
    (time(17, 0), QUIET | {"startTime": "09:00", "endTime": "17:00"}, False),
    (time(23, 0), QUIET | {"enabled": False}, False),
    (time(23, 0), QUIET | {"startTime": "06:00"}, False),
])
def test_quiet_hours_window_crosses_midnight(at, quiet, expected):
    assert in_quiet_hours(at, quiet) is expected


@pytest.mark.parametrize(("severity", "notified", "minimum", "quiet", "expected"), [
    ("warning", None, "warning", False, (True, True)),       # เกิดใหม่ถึงเกณฑ์ → ส่ง
    ("info", None, "warning", False, (False, True)),         # ต่ำกว่าขั้นต่ำ → จดว่าประเมินแล้ว ไม่ส่ง
    ("warning", None, "warning", True, (False, False)),      # ช่วงเงียบ → เลื่อน (ไม่จด)
    ("critical", None, "warning", True, (True, True)),       # วิกฤตทะลุช่วงเงียบ
    ("critical", "warning", "warning", False, (True, True)),  # ยกระดับ → ส่งอีกรอบ
    ("warning", "warning", "warning", False, (False, False)),  # ประเมินแล้ว
    ("warning", "info", "critical", False, (False, True)),   # ยกระดับแต่ยังต่ำกว่าขั้นต่ำ
])
def test_should_notify_rules(severity, notified, minimum, quiet, expected):
    assert should_notify(severity, notified, minimum, quiet, "critical") == expected


def test_retry_gives_up_after_three_attempts():
    assert [retry_delay(n) for n in (1, 2, 3)] == [30, 120, None]
