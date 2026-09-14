"""simulator — เล่นเป็น ESP32 ทั้ง 11 ตัว ส่ง 28 stream ขึ้น MQTT ทุก 2 วินาที (QoS 1 + LWT)

ค่าไม่ได้สุ่มแยกกัน แต่เดินตามสมดุลน้ำจริง (แนวเดียวกับ lib/mock/simulator.ts):

  การประปา → มิเตอร์หลัก ─┬→ ถัง 1 → ปั๊ม 1/2 (สลับเวร 12 ชม.) → โซน 1–7
                          │     └→ ถัง VIP → ปั๊ม 3 → โซน 8
                          └→ บ่อสำรอง (เติมเมื่อพร่อง)

★ สมดุลน้ำปิดพอดี: มิเตอร์หลัก − Σโซน − Δถัง = การระเหยของบ่อ (+ น้ำรั่วถ้าเปิด night_leak)

ใช้:
  python -m simulator.plant                                  # เวลาจริง
  python -m simulator.plant --speed 30                       # เร็ว 30 เท่า
  python -m simulator.plant --fast --start 2026-09-01T00:00:00+07:00 --duration 86400
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import signal
import sys
import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import paho.mqtt.client as mqtt
import yaml

from .scenarios import NAMES, Scenarios

POWER_FACTOR = 0.86
PUMP_CUTOUT_PERCENT = 22       # ตัดปั๊มกันดูดแห้ง
PUMP_CUTIN_PERCENT = 40        # กลับมาเดิน (hysteresis กันปั๊มกระพริบ)
TRANSFER_LPM = 60              # ถัง 1 → ถัง VIP
TRANSFER_START_PERCENT = 55
TRANSFER_STOP_PERCENT = 92
POND_FILL_LPM = 57             # วาล์วเติมบ่อสำรองจากประปา
POND_FILL_START_PERCENT = 90
POND_FILL_STOP_PERCENT = 96
POND_EVAPORATION_LPM = 0.6
PHASE_SHARES = {"L1": 1.02, "L2": 0.99, "L3": 0.99}
KIND_TABLE = {"tank": "tank_telemetry", "pump": "pump_telemetry", "meter": "meter_telemetry",
              "env": "env_telemetry", "power": "power_telemetry", "device": "device_status"}

Message = tuple[str, str, dict, bool]  # (device_id, topic ต่อจาก base, payload, retain)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def interpolate(points: list[list[float]], x: float) -> float:
    if x <= points[0][0]:
        return float(points[0][1])
    if x >= points[-1][0]:
        return float(points[-1][1])
    for (x0, y0), (x1, y1) in zip(points, points[1:], strict=False):
        if x0 <= x <= x1:
            return float(y0) if x1 == x0 else y0 + (x - x0) * (y1 - y0) / (x1 - x0)
    return float(points[-1][1])


class Plant:
    def __init__(self, profile: dict, scenarios: Scenarios, rng: random.Random) -> None:
        self.p = profile
        self.sc = scenarios
        self.rng = rng
        self.tz = ZoneInfo(profile["timezone"])
        self.liters = {tid: t["capacity_l"] * t["initial_percent"] / 100 for tid, t in profile["tanks"].items()}
        for tid, percent in scenarios.tank_start.items():
            self.liters[tid] = profile["tanks"][tid]["capacity_l"] * percent / 100
        self.running = dict.fromkeys(profile["pumps"], False)
        self.pump = {pid: {"power": 0.0, "voltage": 380.0, "pressure": 0.2, "flow": 0.0,
                           "energy": float(p["initial_energy_kwh"])} for pid, p in profile["pumps"].items()}
        self.zone_flow = {zid: z["baseline_lpm"] * 0.5 for zid, z in profile["zones"].items()}
        self.meter_m3 = {z["meter"]: float(z["initial_m3"]) for z in profile["zones"].values()}
        self.main_m3 = float(profile["main_meter"]["initial_m3"])
        self.main_flow = float(profile["main_meter"]["baseline_lpm"]) * 0.6
        self.inlet_pressure = 2.8
        self.env = {eid: {"temp": e["base_temp"], "humidity": e["base_humidity"],
                          "pressure": e.get("base_pressure_hpa")} for eid, e in profile["env"].items()}
        self.power = {nid: {"watt": float(n["baseline_w"]), "pf": 0.91,
                            "voltage": dict.fromkeys(self._phases(n), 230.0),
                            "energy": dict.fromkeys(self._phases(n), float(n["initial_energy_kwh"]))}
                      for nid, n in profile["power"].items()}
        self.devices = {did: {"rssi": float(d["rssi"]), "heap": float(d["heap"]), "uptime": float(d["uptime"]),
                              "reconnects": int(d["reconnects"])} for did, d in profile["devices"].items()}
        self.transfer_on = False
        self.pond_fill_on = False
        self.next_status: datetime | None = None

    @staticmethod
    def _phases(node: dict) -> list[str]:
        return ["L1", "L2", "L3"] if node["three_phase"] else ["single"]

    # ─────────────── ตัวนับสะสมข้ามการรีสตาร์ต ───────────────

    def counters(self) -> dict:
        return {"meters": dict(self.meter_m3), "main": self.main_m3,
                "pumps": {pid: s["energy"] for pid, s in self.pump.items()},
                "power": {nid: dict(s["energy"]) for nid, s in self.power.items()}}

    def restore(self, saved: dict) -> None:
        """★ มิเตอร์จริงเก็บเลขหน้าปัดใน NVS — รีสตาร์ตแล้วตัวนับห้ามถอยหลัง
        ไม่งั้น backend มองเป็นการรีเซ็ตแล้วนับยอดทั้งหน้าปัดเป็นการใช้น้ำใหม่ (ใช้ค่าที่มากกว่าเสมอ)
        """
        for mid, value in saved.get("meters", {}).items():
            if mid in self.meter_m3:
                self.meter_m3[mid] = max(self.meter_m3[mid], float(value))
        self.main_m3 = max(self.main_m3, float(saved.get("main", 0.0)))
        for pid, value in saved.get("pumps", {}).items():
            if pid in self.pump:
                self.pump[pid]["energy"] = max(self.pump[pid]["energy"], float(value))
        for nid, phases in saved.get("power", {}).items():
            for phase, value in phases.items():
                if nid in self.power and phase in self.power[nid]["energy"]:
                    self.power[nid]["energy"][phase] = max(self.power[nid]["energy"][phase], float(value))

    def walk(self, value: float, target: float, reversion: float, sigma: float, low: float, high: float) -> float:
        """random walk ที่ดึงกลับเข้าหาเป้า + noise แบบ gaussian"""
        return clamp(value + (target - value) * reversion + self.rng.gauss(0, sigma), low, high)

    def tank_percent(self, tank_id: str) -> float:
        return self.liters[tank_id] / self.p["tanks"][tank_id]["capacity_l"] * 100

    def _demand(self, hour: float) -> float:
        table = self.p["demand_by_hour"]
        base = int(hour) % 24
        frac = hour - int(hour)
        return (table[base] * (1 - frac) + table[(base + 1) % 24] * frac) * (1 + self.rng.gauss(0, 0.02))

    # ─────────────── หนึ่งรอบ ───────────────

    def step(self, at: datetime, dt: float) -> list[Message]:
        local = at.astimezone(self.tz)
        hour = local.hour + local.minute / 60 + local.second / 3600
        stamp = local.isoformat(timespec="milliseconds")
        demand = self._demand(hour)
        out: list[Message] = []
        self._decide_pumps(at, local)
        self._zones(dt, demand, stamp, out)
        self._pumps(dt, local, stamp, out)
        self._water_balance(dt, stamp, out)
        self._environment(at, hour, stamp, out)
        self._power(dt, demand, stamp, out)
        self._status(at, dt, stamp, out)
        return out

    def _decide_pumps(self, at: datetime, local: datetime) -> None:
        # ★ ปั๊มหลักสลับเวรตามเวลาไทย → รอบสลับตก 00:00 และ 12:00 พอดี ณ เวลาหนึ่งเดินตัวเดียว
        period = self.p["pump_alternation_hours"] * 3600
        offset = local.utcoffset().total_seconds() if local.utcoffset() else 0
        mains = [pid for pid, p in self.p["pumps"].items() if p["role"] == "main"]
        duty = mains[int((at.timestamp() + offset) // period) % len(mains)] if mains else None
        for pid, pump in self.p["pumps"].items():
            limit = PUMP_CUTOUT_PERCENT if self.running[pid] else PUMP_CUTIN_PERCENT
            run = self.tank_percent(pump["source"]) > limit
            if pump["role"] == "main":
                run = run and pid == duty
            if pump["role"] == "vip":
                run = run and math.sin(at.timestamp() / 440) > -0.3   # โซน VIP ใช้น้ำเป็นช่วง
            self.running[pid] = run

    def _zones(self, dt: float, demand: float, stamp: str, out: list[Message]) -> None:
        k_factor = self.p["meter_k_factor"]
        for zid, zone in self.p["zones"].items():
            supplied = any(self.running[pid] and zid in p["serves"] for pid, p in self.p["pumps"].items())
            target = zone["baseline_lpm"] * demand if supplied else 0.0
            sigma = zone["baseline_lpm"] * 0.02 if supplied else 0.02
            flow = self.walk(self.zone_flow[zid], target, 0.22, sigma, 0.0, zone["baseline_lpm"] * 2.6)
            self.zone_flow[zid] = flow
            self.meter_m3[zone["meter"]] += flow * dt / 60 / 1000
            m3 = self.meter_m3[zone["meter"]]
            out.append((zone["device"], f"meter/{zone['meter']}/telemetry", {
                "deviceId": zone["device"], "at": stamp,
                "values": {"pulseCount": int(m3 * k_factor), "volumeM3": round(m3, 4), "flowLpm": round(flow, 1),
                           "inletPressureBar": None}}, False))

    def _pumps(self, dt: float, local: datetime, stamp: str, out: list[Message]) -> None:
        for pid, pump in self.p["pumps"].items():
            state = self.pump[pid]
            flow = 0.0
            if self.running[pid]:
                flow = sum(self.zone_flow[z] for z in pump["serves"]) + self.sc.leak_lpm(local, pump["serves"])
            state["flow"] = flow
            state["voltage"] = voltage = self.walk(state["voltage"], 380, 0.08, 0.35, 360, 400)
            if self.running[pid] and flow > 0.5:
                rated_w = pump["rated_power_w"]
                load = clamp(flow / pump["rated_flow_lpm"], 0, 1.15)
                target = rated_w * (0.35 + 0.65 * load) * self.sc.degradation(pid)
                state["power"] = self.walk(state["power"], target, 0.18, rated_w * 0.006, 0, rated_w * 1.6)
                current = state["power"] / (math.sqrt(3) * voltage * POWER_FACTOR)
                state["energy"] += state["power"] / 1000 * dt / 3600
                state["pressure"] = self.walk(state["pressure"], 2.6 + load * 1.1, 0.15, 0.02, 0, 6)
                run_state, vfd = "running", (35 + 15 * load if pump["vfd"] else None)
            else:
                state["power"], current = 0.0, 0.0
                state["pressure"] = self.walk(state["pressure"], 0.2, 0.25, 0.01, 0, 6)
                run_state, vfd = "stopped", (0.0 if pump["vfd"] else None)
            out.append((pump["device"], f"pump/{pid}/telemetry", {
                "deviceId": pump["device"], "at": stamp,
                "values": {"voltage": round(voltage, 1), "currentAmp": round(current, 2),
                           "powerWatt": round(state["power"]), "energyKwh": round(state["energy"], 4),
                           "flowLpm": round(flow, 1), "pressureBar": round(state["pressure"], 2),
                           "vfdHz": None if vfd is None else round(vfd, 1), "runState": run_state}}, False))

    def _water_balance(self, dt: float, stamp: str, out: list[Message]) -> None:
        base_main = self.p["main_meter"]["baseline_lpm"]
        tank1 = self.tank_percent("tank-1")
        # วาล์วลูกลอยไฟฟ้าที่ทางเข้าถัง 1: เปิดเต็มเมื่อพร่อง หรี่ลงเมื่อใกล้เต็ม ปิดเมื่อเต็ม
        if tank1 < 55:
            tank1_target = base_main
        elif tank1 > 97:
            tank1_target = 0.0
        elif tank1 > 92:
            tank1_target = 40.0
        else:
            tank1_target = base_main - (tank1 - 55) / 37 * (base_main - 40)

        pond = self.tank_percent("tank-3")
        if self.pond_fill_on and pond >= POND_FILL_STOP_PERCENT:
            self.pond_fill_on = False
        elif not self.pond_fill_on and pond <= POND_FILL_START_PERCENT:
            self.pond_fill_on = True
        pond_target = POND_FILL_LPM if self.pond_fill_on else 0.0

        self.main_flow = self.walk(self.main_flow, tank1_target + pond_target, 0.12, 2.2, 0, 420)
        pond_in = min(pond_target, self.main_flow)
        tank1_in = self.main_flow - pond_in
        self.main_m3 += self.main_flow * dt / 60 / 1000
        self.inlet_pressure = self.walk(self.inlet_pressure, 2.8, 0.06, 0.015, 1.2, 4.0)
        main = self.p["main_meter"]
        out.append((main["device"], "meter/main/telemetry", {
            "deviceId": main["device"], "at": stamp,
            "values": {"pulseCount": int(self.main_m3 * self.p["meter_k_factor"]), "volumeM3": round(self.main_m3, 4),
                       "flowLpm": round(self.main_flow, 1), "inletPressureBar": round(self.inlet_pressure, 2)}}, False))

        tank2 = self.tank_percent("tank-2")
        source_ok = tank1 > 25
        if self.transfer_on and (tank2 >= TRANSFER_STOP_PERCENT or not source_ok):
            self.transfer_on = False
        elif not self.transfer_on and tank2 <= TRANSFER_START_PERCENT and source_ok:
            self.transfer_on = True
        transfer = TRANSFER_LPM if self.transfer_on else 0.0

        def draw(tank_id: str) -> float:
            return sum(self.pump[pid]["flow"] for pid, p in self.p["pumps"].items() if p["source"] == tank_id)

        flows = {"tank-1": (tank1_in, draw("tank-1") + transfer),
                 "tank-2": (transfer, draw("tank-2")),
                 "tank-3": (pond_in, draw("tank-3") + POND_EVAPORATION_LPM)}
        for tid, (inflow, outflow) in flows.items():
            tank = self.p["tanks"][tid]
            self.liters[tid] = clamp(self.liters[tid] + (inflow - outflow) * dt / 60, 0, tank["capacity_l"])
            # ★ เซนเซอร์วัดความลึก ไม่ใช่ปริมาตร — แปลงกลับด้วยตารางเดียวกับที่ backend ใช้
            level = interpolate([[v, lvl] for lvl, v in tank["profile"]], self.liters[tid])
            out.append((tank["device"], f"tank/{tid}/telemetry", {
                "deviceId": tank["device"], "at": stamp,
                "values": {"levelMeters": round(level, 3), "flowInLpm": round(inflow, 1),
                           "flowOutLpm": round(outflow, 1)}}, False))

    def _environment(self, at: datetime, hour: float, stamp: str, out: list[Message]) -> None:
        diurnal = math.sin((hour - 9) / 24 * 2 * math.pi)   # ร้อนสุดบ่ายสอง เย็นสุดตีห้า
        pump_load = sum(state["power"] for state in self.pump.values()) / 6000
        ts = at.timestamp()
        for eid, env in self.p["env"].items():
            state = self.env[eid]
            heat = 0.0 if env["outdoor"] else pump_load * 2.4
            state["temp"] = self.walk(state["temp"], env["base_temp"] + diurnal * 2.8 + heat, 0.05, 0.06, 18, 55)
            state["humidity"] = self.walk(state["humidity"], env["base_humidity"] - diurnal * 6, 0.04, 0.18, 15, 99)
            values: dict[str, float | None] = {"temperatureC": round(state["temp"], 1),
                                               "humidityPct": round(state["humidity"], 1)}
            if env["outdoor"]:
                wave = math.sin(ts / 1800 + 1.2)   # ฝนมาเป็นช่วง ไม่ใช่สุ่มรายวินาที
                raining = wave > 0.82
                rate_mm_h = clamp((wave - 0.82) * 60, 0, 12) if raining else 0.0
                pressure_target = env["base_pressure_hpa"] + math.sin(ts / 5200) * 3.4 - (2.6 if raining else 0)
                state["pressure"] = self.walk(state["pressure"], pressure_target, 0.02, 0.035, 985, 1035)
                daylight = max(0.0, math.sin((hour - 6) / 12 * math.pi))
                lux = env["peak_lux"] * daylight ** 1.6 * (0.18 if raining else 1) * self.rng.uniform(0.94, 1.06)
                values |= {"pressureHpa": round(state["pressure"], 1), "lux": round(lux),
                           "rainMm": round(rate_mm_h * self._dt_hours(), 3)}
            else:
                # ★ จุดในอาคารไม่มี barometer / light sensor / rain gauge → ส่ง null ไม่ใช่ 0
                values |= {"pressureHpa": None, "lux": None, "rainMm": None}
            out.append((env["device"], f"env/{eid}/telemetry", {"deviceId": env["device"], "at": stamp,
                                                                "values": values}, False))

    _dt: float = 2.0

    def _dt_hours(self) -> float:
        return self._dt / 3600

    def _power(self, dt: float, demand: float, stamp: str, out: list[Message]) -> None:
        for nid, node in self.p["power"].items():
            state = self.power[nid]
            base = node["baseline_w"]
            state["watt"] = self.walk(state["watt"], base * (0.6 + 0.4 * demand), 0.12, base * 0.004,
                                      base * 0.15, base * 1.45)
            state["pf"] = self.walk(state["pf"], 0.91, 0.25, 0.003, 0.82, 0.97)
            phases = self._phases(node)
            readings = {}
            for phase in phases:
                watt = state["watt"] / len(phases) * PHASE_SHARES.get(phase, 1.0)
                state["voltage"][phase] = voltage = self.walk(state["voltage"][phase], 230, 0.08, 0.3, 215, 242)
                state["energy"][phase] += watt / 1000 * dt / 3600
                readings[phase] = {"voltage": round(voltage, 1), "currentAmp": round(watt / (voltage * state["pf"]), 2),
                                   "powerWatt": round(watt), "energyKwh": round(state["energy"][phase], 4),
                                   "pf": round(state["pf"], 3), "frequencyHz": round(50 + self.rng.gauss(0, 0.02), 2)}
            out.append((node["device"], f"power/{nid}/telemetry", {"deviceId": node["device"], "at": stamp,
                                                                   "values": {"phases": readings}}, False))

    def _status(self, at: datetime, dt: float, stamp: str, out: list[Message]) -> None:
        for state in self.devices.values():
            state["uptime"] += dt
        if self.next_status is not None and at < self.next_status:
            return
        self.next_status = at + timedelta(seconds=self.p["status_every_seconds"])
        for did, base in self.p["devices"].items():
            state = self.devices[did]
            state["rssi"] = self.walk(state["rssi"], base["rssi"], 0.06, 0.9, -95, -35)
            state["heap"] = self.walk(state["heap"], base["heap"], 0.04, 380, base["heap"] * 0.55, base["heap"] * 1.08)
            # retained: คนที่ subscribe ทีหลังเห็นสถานะล่าสุดทันที · LWT จะมาทับเมื่อบอร์ดหลุด
            out.append((did, f"device/{did}/status", {
                "deviceId": did, "at": stamp, "online": True, "rssi": round(state["rssi"]),
                "uptimeSeconds": round(state["uptime"]), "freeHeapBytes": round(state["heap"]),
                "reconnectCount": state["reconnects"], "lastError": None}, True))


class Publisher:
    """หนึ่ง connection ต่ออุปกรณ์ — LWT เป็นของแต่ละ connection จึงรวมเป็นก้อนเดียวไม่ได้"""

    def __init__(self, host: str, port: int, password: str, base_topic: str, device_ids: list[str]) -> None:
        self.base = base_topic
        self.clients: dict[str, mqtt.Client] = {}
        self.last_info: dict[str, mqtt.MQTTMessageInfo] = {}
        self.messages: Counter[str] = Counter()
        self.failed = 0
        for did in device_ids:
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"sim-{did}", protocol=mqtt.MQTTv311)
            client.username_pw_set(f"dev-{did}", password)
            client.will_set(f"{base_topic}/device/{did}/status", json.dumps({"deviceId": did, "online": False}),
                            qos=1, retain=True)
            client.max_inflight_messages_set(1000)
            client.reconnect_delay_set(1, 30)
            client.connect_async(host, port, keepalive=30)
            client.loop_start()
            self.clients[did] = client

    def wait_connected(self, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while not all(client.is_connected() for client in self.clients.values()):
            if time.monotonic() > deadline:
                missing = [did for did, c in self.clients.items() if not c.is_connected()]
                raise SystemExit(f"ต่อ MQTT ไม่ได้: {missing}")
            time.sleep(0.2)

    def publish(self, device_id: str, subtopic: str, payload: dict, retain: bool) -> None:
        info = self.clients[device_id].publish(f"{self.base}/{subtopic}", json.dumps(payload), qos=1, retain=retain)
        self.last_info[device_id] = info
        self.messages[subtopic] += 1

    def drain(self, timeout: float = 60) -> None:
        for info in self.last_info.values():
            try:
                info.wait_for_publish(timeout)
            except (RuntimeError, ValueError):
                self.failed += 1

    def close(self) -> None:
        self.drain()
        for client in self.clients.values():
            client.disconnect()   # ปิดแบบสุภาพ → broker ไม่ส่ง LWT
            client.loop_stop()


def rows_of(subtopic: str, payload: dict) -> list[str]:
    """แถวที่ข้อความนี้จะกลายเป็นใน DB — ใช้ตรวจว่าไม่มีแถวหาย"""
    kind, ident, _ = subtopic.split("/")
    table = KIND_TABLE[kind]
    if kind == "power":
        phases = list(payload["values"]["phases"])
        if "L1" in phases:
            phases.append("total")   # ingest เพิ่มแถวยอดรวมทั้งตู้ให้ตู้ 3 เฟส
        return [f"{table}:{ident}:{phase}" for phase in phases]
    entity = "meter-main" if (kind, ident) == ("meter", "main") else ident
    return [f"{table}:{entity}:"]


def save_state(path: Path, plant: Plant) -> None:
    """เขียนแบบ atomic — ถูก kill กลางทางไฟล์เดิมยังอยู่ครบ"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(plant.counters()), encoding="utf-8")
    os.replace(tmp, path)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="simulator โรงงานน้ำ — ส่งข้อมูลปลอมในนามอุปกรณ์ทุกตัว")
    parser.add_argument("--host", default=os.environ.get("MQTT_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MQTT_PORT", "1883")))
    parser.add_argument("--base-topic", default=os.environ.get("MQTT_BASE_TOPIC", "plant/water"))
    parser.add_argument("--profile", default=str(Path(__file__).with_name("profiles.yaml")))
    parser.add_argument("--speed", type=int, default=1, help="จำนวนรอบจำลองต่อหนึ่งรอบนาฬิกาจริง")
    parser.add_argument("--fast", action="store_true", help="ไม่รอเวลาจริง ใช้เติมข้อมูลย้อนหลังคู่กับ --start")
    parser.add_argument("--start", help="เวลาเริ่มจำลอง ISO 8601 พร้อม offset (ค่าเริ่มต้น = ตอนนี้)")
    parser.add_argument("--duration", type=float, help="ความยาวเวลาจำลอง (วินาที) ไม่ใส่ = รันไปเรื่อย ๆ")
    parser.add_argument("--step-seconds", type=float, help="ระยะห่างของแต่ละรอบ (ค่าเริ่มต้นตาม profile = 2)")
    parser.add_argument("--scenario", action="append", default=[], choices=NAMES)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--report", help="เขียนสรุปจำนวนข้อความ/แถวที่ส่งลงไฟล์ JSON")
    parser.add_argument("--state", default=os.environ.get("SIM_STATE"),
                        help="ไฟล์เก็บตัวนับสะสม (แทน NVS ของบอร์ด) — รีสตาร์ตแล้วนับต่อ ไม่ถอยหลัง")
    args = parser.parse_args(argv)

    password = os.environ.get("MQTT_DEVICE_PASSWORD")
    if not password:
        raise SystemExit("ต้องตั้ง MQTT_DEVICE_PASSWORD")
    profile = yaml.safe_load(Path(args.profile).read_text(encoding="utf-8"))
    dt = args.step_seconds or float(profile["tick_seconds"])
    if args.start:
        start = datetime.fromisoformat(args.start)
        if start.tzinfo is None:
            raise SystemExit("--start ต้องมี offset เช่น +07:00")
    else:
        now = datetime.now(UTC)
        start = now.replace(microsecond=now.microsecond // 1000 * 1000)

    plant = Plant(profile, Scenarios.from_names(args.scenario, profile), random.Random(args.seed))
    plant._dt = dt
    state_path = Path(args.state) if args.state else None
    if state_path is not None and state_path.exists():
        plant.restore(json.loads(state_path.read_text(encoding="utf-8")))
    publisher = Publisher(args.host, args.port, password, args.base_topic, list(profile["devices"]))
    publisher.wait_connected(30)

    stopping = False

    def request_stop(*_: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    rows: Counter[str] = Counter()
    sim = start
    end = start + timedelta(seconds=args.duration) if args.duration else None
    next_wall = time.monotonic()
    next_log = time.monotonic() + 60
    published_since_drain = 0
    while not stopping and (end is None or sim < end):
        for _ in range(max(1, args.speed)):
            if end is not None and sim >= end:
                break
            for device_id, subtopic, payload, retain in plant.step(sim, dt):
                publisher.publish(device_id, subtopic, payload, retain)
                for key in rows_of(subtopic, payload):
                    rows[key] += 1
                published_since_drain += 1
            sim += timedelta(seconds=dt)
        if state_path is not None and not args.fast:
            save_state(state_path, plant)
        if args.fast:
            if published_since_drain >= 2000:   # อย่าให้คิวในหน่วยความจำโตไม่รู้จบ
                publisher.drain()
                published_since_drain = 0
        else:
            next_wall += float(profile["tick_seconds"])
            time.sleep(max(0.0, next_wall - time.monotonic()))
        if time.monotonic() >= next_log:
            next_log += 60
            progress = {"event": "progress", "sim": sim.isoformat(), "messages": sum(publisher.messages.values())}
            print(json.dumps(progress), flush=True)

    publisher.close()
    if state_path is not None:
        save_state(state_path, plant)
    report = {"start": start.isoformat(), "end": sim.isoformat(), "stepSeconds": dt,
              "messages": sum(publisher.messages.values()), "failed": publisher.failed,
              "rows": dict(sorted(rows.items()))}
    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}), flush=True)
    sys.exit(1 if publisher.failed else 0)


if __name__ == "__main__":
    main()
