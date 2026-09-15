"""ช่องทางส่งแจ้งเตือนแบบ plugin — เพิ่มช่องทางใหม่ = เพิ่มคลาสที่มี name + send() แล้วใส่ใน build_channels()

ใช้ได้จริง: email (SMTP ภายใน) · buzzer (MQTT) · webhook (เฉพาะปลายทางใน LAN)
ปิดไว้: line (ระบบไม่มีอินเทอร์เน็ต — PROBLEMS P-06) · sms (ยังไม่มี gateway)
"""

from __future__ import annotations

import ipaddress
import json
import os
import smtplib
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol
from urllib.parse import urlsplit

import paho.mqtt.client as mqtt


class DeliveryError(Exception):
    """permanent = ลองใหม่ก็ไม่หาย (ตั้งค่าผิด/ช่องทางปิด) → เลิกลองทันที"""

    def __init__(self, message: str, permanent: bool = False) -> None:
        super().__init__(message)
        self.permanent = permanent


@dataclass(frozen=True)
class Message:
    recipient: str
    title: str
    body: str
    alert: dict[str, object]
    base_topic: str


class Channel(Protocol):
    name: str

    def send(self, message: Message) -> None: ...


class EmailChannel:
    name = "email"

    def __init__(self, host: str, port: int, sender: str) -> None:
        self.host, self.port, self.sender = host, port, sender

    def send(self, message: Message) -> None:
        if not self.host:
            raise DeliveryError("ยังไม่ได้ตั้งเมลเซิร์ฟเวอร์ภายใน (SMTP_HOST ใน .env)", permanent=True)
        mail = EmailMessage()
        mail["Subject"], mail["From"], mail["To"] = message.title, self.sender, message.recipient
        mail.set_content(message.body)
        try:
            with smtplib.SMTP(self.host, self.port, timeout=10) as smtp:
                smtp.send_message(mail)
        except smtplib.SMTPRecipientsRefused as exc:
            raise DeliveryError(f"เมลเซิร์ฟเวอร์ปฏิเสธผู้รับ {message.recipient}", permanent=True) from exc
        except (OSError, smtplib.SMTPException) as exc:
            raise DeliveryError(f"ส่งเมลไม่สำเร็จ: {exc}") from exc


class BuzzerChannel:
    """publish ไป {base}/buzzer/cmd · recipient = ชื่อตู้ที่ติดบัซเซอร์ · ★ ESP32 ที่ตู้ต้อง subscribe topic นี้"""

    name = "buzzer"

    def __init__(self, host: str, port: int, user: str, password: str) -> None:
        self._args = (host, port, user, password)
        self._client: mqtt.Client | None = None

    def _connected(self) -> mqtt.Client:
        if self._client is not None and self._client.is_connected():
            return self._client
        self._close()
        host, port, user, password = self._args
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"notifier-{os.getpid()}")
        client.username_pw_set(user, password)
        client.connect(host, port, keepalive=30)
        client.loop_start()
        self._client = client
        deadline = time.monotonic() + 5
        while not client.is_connected():
            if time.monotonic() > deadline:
                raise DeliveryError("ต่อ MQTT broker ไม่สำเร็จภายใน 5 วินาที")
            time.sleep(0.05)
        return client

    def _close(self) -> None:
        if self._client is not None:
            self._client.loop_stop()
            self._client.disconnect()
            self._client = None

    def send(self, message: Message) -> None:
        alert = message.alert
        payload = json.dumps({"cabinet": message.recipient, "alertId": alert["id"], "code": alert["code"],
                              "severity": alert["severity"], "sourceId": alert["sourceId"],
                              "pattern": "continuous" if alert["severity"] == "critical" else "beep",
                              "at": alert["raisedAt"]}, ensure_ascii=False)
        topic = f"{message.base_topic.rstrip('/')}/buzzer/cmd"
        try:
            info = self._connected().publish(topic, payload, qos=1)
            info.wait_for_publish(timeout=5)
        except (OSError, ValueError, RuntimeError) as exc:
            self._close()
            raise DeliveryError(f"ส่งคำสั่งบัซเซอร์ไม่สำเร็จ: {exc}") from exc
        if not info.is_published():
            self._close()
            raise DeliveryError("broker ไม่ยืนยันคำสั่งบัซเซอร์ภายใน 5 วินาที")


class LineChannel:
    name = "line"

    def send(self, message: Message) -> None:
        raise DeliveryError("offline_mode — ระบบไม่มีอินเทอร์เน็ต ต้องอนุมัติเปิดขาออก api.line.me ก่อน",
                            permanent=True)


class SmsChannel:
    name = "sms"

    def send(self, message: Message) -> None:
        raise DeliveryError("ยังไม่มี SMS gateway ในเครือข่ายโรงงาน", permanent=True)


class WebhookChannel:
    name = "webhook"

    def send(self, message: Message) -> None:
        parts = urlsplit(message.recipient)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise DeliveryError(f"URL ของ webhook ไม่ถูกต้อง: {message.recipient}", permanent=True)
        try:
            addresses = {info[4][0] for info in socket.getaddrinfo(parts.hostname, parts.port or 80)}
        except socket.gaierror as exc:
            raise DeliveryError(f"หา host {parts.hostname} ไม่เจอ") from exc
        # ★ ระบบ on-premise — ห้ามส่งข้อมูลโรงงานออกนอก LAN แม้ผู้ดูแลจะพิมพ์ URL ภายนอกมา
        if not all(ipaddress.ip_address(a.split("%")[0]).is_private for a in addresses):
            raise DeliveryError("webhook ต้องชี้ไปปลายทางในเครือข่ายโรงงานเท่านั้น", permanent=True)
        data = json.dumps({"title": message.title, "body": message.body, "alert": message.alert},
                          ensure_ascii=False).encode()
        request = urllib.request.Request(message.recipient, data, {"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=5):
                pass
        except urllib.error.HTTPError as exc:
            raise DeliveryError(f"webhook ตอบ HTTP {exc.code}", permanent=400 <= exc.code < 500) from exc
        except (urllib.error.URLError, OSError) as exc:
            raise DeliveryError(f"เรียก webhook ไม่สำเร็จ: {exc}") from exc


def build_channels(env: dict[str, str]) -> dict[str, Channel]:
    channels: list[Channel] = [
        EmailChannel(env.get("SMTP_HOST", ""), int(env.get("SMTP_PORT", "25")),
                     env.get("SMTP_FROM", "water-alerts@plant.local")),
        BuzzerChannel(env.get("MQTT_HOST", "mosquitto"), int(env.get("MQTT_PORT", "1883")),
                      env.get("MQTT_USER", "api"), env.get("MQTT_PASSWORD", "")),
        LineChannel(), SmsChannel(), WebhookChannel(),
    ]
    return {channel.name: channel for channel in channels}
