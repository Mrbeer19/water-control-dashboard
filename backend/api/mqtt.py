"""ตัวส่งข้อความ MQTT ของ api และ dispatcher — ต่อครั้งเดียวใช้ร่วมกัน ต่อใหม่เองเมื่อหลุด

ใช้ user `api` ซึ่ง ACL อนุญาตให้เขียน plant/water/{valve,pump,pressure,+}/…/cmd และอ่าน plant/water/#
"""

from __future__ import annotations

import json
import os
import threading
import time

import paho.mqtt.client as mqtt

CONNECT_TIMEOUT_S = 5
PUBLISH_TIMEOUT_S = 3


class MqttPublisher:
    def __init__(self, client_id: str) -> None:
        self._client_id = client_id
        self._client: mqtt.Client | None = None
        self._lock = threading.Lock()

    def _close(self) -> None:
        if self._client is not None:
            self._client.loop_stop()
            self._client.disconnect()
            self._client = None

    def _connected(self) -> mqtt.Client:
        if self._client is not None and self._client.is_connected():
            return self._client
        self._close()
        env = os.environ
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"{self._client_id}-{os.getpid()}")
        client.username_pw_set(env.get("MQTT_USER", "api"), env.get("MQTT_PASSWORD", ""))
        client.connect(env.get("MQTT_HOST", "mosquitto"), int(env.get("MQTT_PORT", "1883")), keepalive=30)
        client.loop_start()
        self._client = client
        deadline = time.monotonic() + CONNECT_TIMEOUT_S
        while not client.is_connected():
            if time.monotonic() > deadline:
                raise TimeoutError("ต่อ MQTT broker ไม่สำเร็จ")
            time.sleep(0.05)
        return client

    def publish(self, topic: str, payload: dict[str, object]) -> bool:
        """QoS 1 และรอ broker รับจริง · คืน False ถ้าส่งไม่ออก (ผู้เรียกต้องบันทึกว่าคำสั่งไม่ถึงอุปกรณ์)"""
        with self._lock:
            try:
                info = self._connected().publish(topic, json.dumps(payload, ensure_ascii=False, default=str), qos=1)
                info.wait_for_publish(timeout=PUBLISH_TIMEOUT_S)
                if info.is_published():
                    return True
            except (OSError, ValueError, RuntimeError, TimeoutError):
                pass
            self._close()
            return False


publisher = MqttPublisher("api-control")
