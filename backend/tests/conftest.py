"""fixture ของ integration test — unit test ไม่ได้ใช้ จึงไม่ต้องมี docker"""

from __future__ import annotations

import secrets

import httpx
import pytest

from tests.helpers import Db, DeviceClient, load_env, set_password

API = "http://127.0.0.1:8000"
TEST_ACCOUNTS = ("admin", "somchai", "accounting")   # admin · operator · viewer ตาม seed


@pytest.fixture(scope="session")
def env() -> dict[str, str]:
    return load_env()


@pytest.fixture(scope="session")
def db(env):
    database = Db(env)
    yield database
    database.close()


@pytest.fixture
def device(env):
    made: list[DeviceClient] = []

    def factory(device_id: str, **kwargs) -> DeviceClient:
        client = DeviceClient(device_id, env["MQTT_DEVICE_PASSWORD"], **kwargs)
        made.append(client)
        return client

    yield factory
    for client in made:
        try:
            client.close()
        except Exception:  # noqa: BLE001 — เก็บกวาดอย่างเดียว ไม่ให้บังผลของเทส
            pass


@pytest.fixture(scope="session")
def passwords() -> dict[str, str]:
    """รหัสสุ่มใหม่ทุกรอบเทส — ไม่มีรหัสผ่านตายตัวอยู่ใน repo"""
    made = {username: secrets.token_urlsafe(16) for username in TEST_ACCOUNTS}
    for username, password in made.items():
        set_password(username, password)
    return made


@pytest.fixture
def signed_in(passwords):
    """client ที่ล็อกอินแล้ว (cookie httpOnly อยู่ใน jar ของ httpx)"""
    clients: list[httpx.Client] = []

    def factory(username: str) -> httpx.Client:
        client = httpx.Client(base_url=API, timeout=20)
        result = client.post("/api/auth/login", json={"username": username, "password": passwords[username]}).json()
        assert result["ok"], result
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.close()
