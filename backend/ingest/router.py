"""แกะ topic → ช่องทาง + ชนิด + entity

plant/water/{kind}/{id}/telemetry   kind = tank | pump | meter | env | power
plant/water/device/{deviceId}/status
plant/water/{kind}/{id}/feedback     (ใช้ในเฟสควบคุม)
"""

from __future__ import annotations

from dataclasses import dataclass

TELEMETRY_KINDS = frozenset({"tank", "pump", "meter", "env", "power"})
FEEDBACK_KINDS = frozenset({"valve", "pump", "pressure"})

# topic ของมิเตอร์หลักใช้ชื่อสั้น `meter/main` ตามสัญญาใน HANDOFF §3 แต่ entity ชื่อ `meter-main`
TOPIC_ALIASES = {("meter", "main"): "meter-main"}


@dataclass(frozen=True)
class Route:
    channel: str  # telemetry | status | feedback
    kind: str
    entity_id: str


def is_command(topic: str, base_topic: str) -> bool:
    """คำสั่งขาออกที่ api/notifier/dispatcher ส่งถึงอุปกรณ์ (…/cmd) — ingest subscribe `#` จึงเห็นด้วย
    ★ ไม่ใช่ข้อมูลเข้า ข้ามเงียบ ๆ ไม่งั้นทุกคำสั่งสั่งวาล์ว บัซเซอร์ รีบูต จะถูกนับเป็นข้อความทิ้งพร้อมคำเตือน
    """
    prefix = base_topic.rstrip("/") + "/"
    return topic.startswith(prefix) and topic.rsplit("/", 1)[-1] == "cmd"


def route(topic: str, base_topic: str) -> Route | None:
    prefix = base_topic.rstrip("/") + "/"
    if not topic.startswith(prefix):
        return None
    parts = topic[len(prefix):].split("/")
    if len(parts) != 3 or not all(parts):
        return None
    kind, ident, channel = parts

    if channel == "telemetry" and kind in TELEMETRY_KINDS:
        return Route("telemetry", kind, TOPIC_ALIASES.get((kind, ident), ident))
    if channel == "status" and kind == "device":
        return Route("status", "device", ident)
    if channel == "feedback" and kind in FEEDBACK_KINDS:
        return Route("feedback", kind, ident)
    return None
