"""spool ลงดิสก์ตอน DB ล่ม แล้ว replay เมื่อกลับมา

★ ingest ห้าม crash และห้ามทิ้งข้อมูลเพราะ DB ล่ม — MQTT ไม่เก็บย้อนหลังให้
★ มีเพดานขนาด เต็มแล้วทิ้งไฟล์เก่าสุดพร้อม log (ดีกว่าดิสก์เต็มแล้วทั้งเครื่องล่ม)
★ ทุก op ที่ spool ต้อง idempotent เพราะ replay ซ้ำได้ถ้าล้มกลางไฟล์
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable, Iterator
from datetime import datetime
from pathlib import Path

from .log import log

ROTATE_BYTES = 16 * 1024 * 1024


def _encode(value: object) -> object:
    if isinstance(value, datetime):
        return {"$dt": value.isoformat()}
    raise TypeError(f"spool encode: {type(value).__name__}")


def _decode(obj: dict[str, object]) -> object:
    if len(obj) == 1 and "$dt" in obj:
        return datetime.fromisoformat(str(obj["$dt"]))
    return obj


class Spool:
    def __init__(self, directory: str, max_bytes: int) -> None:
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.max_bytes = max_bytes
        self._current: Path | None = None

    def files(self) -> list[Path]:
        return sorted(self.directory.glob("spool-*.ndjson"))

    def size_bytes(self) -> int:
        return sum(path.stat().st_size for path in self.files())

    def has_pending(self) -> bool:
        return any(True for _ in self.directory.glob("spool-*.ndjson"))

    def append(self, ops: list[dict[str, object]]) -> None:
        if not ops:
            return
        if self._current is None or not self._current.exists() or self._current.stat().st_size > ROTATE_BYTES:
            self._current = self.directory / f"spool-{time.time_ns()}.ndjson"
        with self._current.open("a", encoding="utf-8") as handle:
            for op in ops:
                handle.write(json.dumps(op, default=_encode, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        self._enforce_cap()

    def _enforce_cap(self) -> None:
        files = self.files()
        total = sum(path.stat().st_size for path in files)
        while total > self.max_bytes and len(files) > 1:
            oldest = files.pop(0)
            size = oldest.stat().st_size
            oldest.unlink()
            total -= size
            log("spool_dropped_oldest", level="error", file=oldest.name, bytes=size)

    def _read(self, path: Path) -> Iterator[dict[str, object]]:
        with path.open(encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line, object_hook=_decode)
                except ValueError:
                    # บรรทัดท้ายที่เขียนไม่จบตอนเครื่องดับ — ข้ามแล้วไปต่อ
                    log("spool_bad_line", level="warning", file=path.name, line=line_no)

    def replay(self, apply: Callable[[list[dict[str, object]]], None], chunk: int = 500) -> int:
        """เล่นทุกไฟล์จากเก่าไปใหม่ ลบไฟล์เมื่อ apply ผ่านครบ · apply โยน exception = หยุดและเก็บไฟล์ไว้"""
        self._current = None
        replayed = 0
        for path in self.files():
            batch: list[dict[str, object]] = []
            for op in self._read(path):
                batch.append(op)
                if len(batch) >= chunk:
                    apply(batch)
                    replayed += len(batch)
                    batch = []
            if batch:
                apply(batch)
                replayed += len(batch)
            path.unlink()
        return replayed
