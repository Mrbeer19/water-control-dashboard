"""connection ของ API — pool ใช้ร่วมกันทุก router · notifier ใช้ conninfo() ต่อเอง"""

from __future__ import annotations

import os

from psycopg.conninfo import make_conninfo
from psycopg_pool import ConnectionPool


def conninfo(application_name: str) -> str:
    env = os.environ
    return make_conninfo(host=env.get("POSTGRES_HOST", "timescaledb"), port=env.get("POSTGRES_PORT", "5432"),
                         dbname=env.get("POSTGRES_DB", "water"), user=env.get("POSTGRES_USER", "water"),
                         password=env.get("POSTGRES_PASSWORD", ""), application_name=application_name)


def make_pool() -> ConnectionPool:
    return ConnectionPool(conninfo("api"), min_size=1, max_size=int(os.environ.get("API_DB_POOL", "8")), open=False,
                          kwargs={"autocommit": True, "connect_timeout": 3})


pool = make_pool()
