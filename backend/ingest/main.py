"""จุดเริ่มของ ingest: ต่อ MQTT → คิว → processor → writer → DB

รันด้วย: python -m ingest.main
"""

from __future__ import annotations

import json
import os
import signal
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import paho.mqtt.client as mqtt
import psycopg
from psycopg.conninfo import make_conninfo

from .cache import Cache
from .log import log
from .metrics import Metrics
from .processor import Processor, ProcessorConfig
from .redis_pub import RedisPublisher
from .spool import Spool
from .writer import Writer


@dataclass(frozen=True)
class Config:
    dsn: str
    mqtt_host: str
    mqtt_port: int
    mqtt_user: str
    mqtt_password: str
    base_topic: str
    redis_url: str
    spool_dir: str
    spool_max_bytes: int
    health_port: int
    offline_after_s: float
    liveness_check_s: float
    cache_refresh_s: float
    clock_skew_s: float


def load_config() -> Config:
    env = os.environ
    dsn = make_conninfo(host=env.get("POSTGRES_HOST", "timescaledb"), port=env.get("POSTGRES_PORT", "5432"),
                        dbname=env["POSTGRES_DB"], user=env["POSTGRES_USER"], password=env["POSTGRES_PASSWORD"],
                        application_name="ingest")
    return Config(
        dsn=dsn,
        mqtt_host=env.get("MQTT_HOST", "mosquitto"),
        mqtt_port=int(env.get("MQTT_PORT", "1883")),
        mqtt_user=env.get("MQTT_USER", "ingest"),
        mqtt_password=env["MQTT_PASSWORD"],
        base_topic=env.get("MQTT_BASE_TOPIC", "plant/water"),
        redis_url=env.get("REDIS_URL", "redis://redis:6379/0"),
        spool_dir=env.get("SPOOL_DIR", "/data/spool"),
        spool_max_bytes=int(env.get("SPOOL_MAX_BYTES", str(200 * 1024 * 1024))),
        health_port=int(env.get("HEALTH_PORT", "8080")),
        offline_after_s=float(env.get("OFFLINE_AFTER_S", "30")),
        liveness_check_s=float(env.get("LIVENESS_CHECK_S", "5")),
        cache_refresh_s=float(env.get("CACHE_REFRESH_S", "60")),
        clock_skew_s=float(env.get("CLOCK_SKEW_S", "60")),
    )


def _serve_health(port: int, metrics: Metrics, processor: Processor, writer: Writer) -> None:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                body: dict[str, object] = {"status": "ok", "dbUp": metrics.get("db_up"),
                                           "mqttConnected": metrics.get("mqtt_connected")}
            elif self.path == "/metrics":
                body = metrics.snapshot({"processor": processor.inbox.qsize(), "writer": writer.inbox.qsize()})
            else:
                self.send_error(404)
                return
            data = json.dumps(body).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    threading.Thread(target=server.serve_forever, name="health", daemon=True).start()


def main() -> None:
    cfg = load_config()
    metrics = Metrics()
    log("starting", base_topic=cfg.base_topic)

    # ★ ต้องได้ทะเบียนจาก DB อย่างน้อยครั้งแรก — ไม่รู้จัก entity ก็เขียนอะไรไม่ได้
    #   หลังจากนั้น DB ล่มได้โดย ingest ไม่หยุด
    cache = Cache(cfg.dsn)
    while True:
        try:
            cache.load(include_open_records=True)
            break
        except psycopg.Error as exc:
            log("waiting_for_registry", level="warning", error=str(exc).strip())
            time.sleep(3)
    log("registry_loaded", entities=len(cache.entities), thresholds=len(cache.thresholds),
        tracked_devices=len(cache.tracked_device_ids))

    writer = Writer(cfg.dsn, Spool(cfg.spool_dir, cfg.spool_max_bytes), metrics)
    redis_pub = RedisPublisher(cfg.redis_url, metrics)
    processor = Processor(ProcessorConfig(cfg.base_topic, cfg.clock_skew_s, cfg.offline_after_s),
                          cfg.dsn, cache, writer, redis_pub, metrics, time.time())
    writer.start()
    processor.start()
    _serve_health(cfg.health_port, metrics, processor, writer)

    def on_connect(client: mqtt.Client, userdata: object, flags: object, reason_code: object,
                   properties: object) -> None:
        if getattr(reason_code, "is_failure", False):
            log("mqtt_connect_failed", level="error", reason=str(reason_code))
            return
        client.subscribe(f"{cfg.base_topic}/#", qos=1)
        metrics.set("mqtt_connected", True)
        log("mqtt_connected", session_present=getattr(flags, "session_present", None))

    def on_disconnect(client: mqtt.Client, userdata: object, flags: object, reason_code: object,
                      properties: object) -> None:
        metrics.set("mqtt_connected", False)
        metrics.inc("mqtt_disconnects")
        log("mqtt_disconnected", level="warning", reason=str(reason_code))

    def on_message(client: mqtt.Client, userdata: object, message: mqtt.MQTTMessage) -> None:
        processor.inbox.put(("mqtt", message.topic, message.payload, time.time()))

    # ★ clean_session=False + client id คงที่ → broker เก็บข้อความ QoS 1 ไว้ให้ตอน ingest หลุดสั้น ๆ
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="ingest", clean_session=False,
                         protocol=mqtt.MQTTv311)
    client.username_pw_set(cfg.mqtt_user, cfg.mqtt_password)
    client.on_connect, client.on_disconnect, client.on_message = on_connect, on_disconnect, on_message
    client.reconnect_delay_set(min_delay=1, max_delay=30)  # exponential backoff
    client.connect_async(cfg.mqtt_host, cfg.mqtt_port, keepalive=30)
    client.loop_start()

    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())

    next_check = next_refresh = time.monotonic()
    next_refresh += cfg.cache_refresh_s
    while not stop.wait(0.5):
        now = time.monotonic()
        if now >= next_check:
            processor.inbox.put(("tick", time.time()))
            next_check = now + cfg.liveness_check_s
        if now >= next_refresh:
            processor.inbox.put(("refresh",))
            next_refresh = now + cfg.cache_refresh_s

    log("stopping")
    client.disconnect()
    client.loop_stop()
    processor.stop()
    processor.join(timeout=5)
    writer.stop()
    writer.join(timeout=5)
    log("stopped")


if __name__ == "__main__":
    main()
