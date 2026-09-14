"""python -m api.notifier — วนส่งแจ้งเตือนจนได้ SIGTERM

healthcheck: ไฟล์ HEARTBEAT ถูกแตะทุกรอบที่คุย DB สำเร็จ · DB ล่มนานเกิน 30 วินาทีจะกลายเป็น unhealthy
"""

from __future__ import annotations

import os
import signal
import time
from pathlib import Path

import psycopg

from ..db import conninfo
from .channels import build_channels
from .dispatcher import Dispatcher, log

POLL_SECONDS = 2.0
HEARTBEAT = Path("/tmp/notifier.alive")


def main() -> None:
    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    dispatcher = Dispatcher(build_channels(dict(os.environ)))
    conn: psycopg.Connection | None = None
    log("notifier_started", channels=sorted(dispatcher.channels))
    while not stopping:
        try:
            if conn is None or conn.closed:
                conn = psycopg.connect(conninfo("notifier"), autocommit=True, connect_timeout=3)
            dispatcher.run_once(conn)
            HEARTBEAT.touch()
        except psycopg.OperationalError as exc:
            log("database_unavailable", level="error", error=str(exc).strip())
            conn = None
            time.sleep(5)
        time.sleep(POLL_SECONDS)
    log("notifier_stopped")


if __name__ == "__main__":
    main()
