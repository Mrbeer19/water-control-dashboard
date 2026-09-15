"""structured log — บรรทัดละหนึ่งเหตุการณ์ในรูป JSON มี service · entity_id · event เสมอ"""

from __future__ import annotations

import json
import sys
from datetime import datetime

SERVICE = "ingest"


def log(event: str, entity_id: str | None = None, level: str = "info", **fields: object) -> None:
    record: dict[str, object] = {
        "ts": datetime.now().astimezone().isoformat(timespec="milliseconds"),
        "level": level,
        "service": SERVICE,
        "entity_id": entity_id,
        "event": event,
    }
    record.update(fields)
    sys.stdout.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()
