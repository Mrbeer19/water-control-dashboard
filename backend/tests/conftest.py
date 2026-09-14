"""fixture ของ integration test — unit test ไม่ได้ใช้ จึงไม่ต้องมี docker"""

from __future__ import annotations

import pytest

from tests.helpers import Db, DeviceClient, load_env


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
