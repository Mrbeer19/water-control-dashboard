"""ตรวจสัญญา API กับ lib/types.ts ด้วยคอมไพเลอร์ TypeScript จริง

รันใน container api (มี network ถึง API) แล้วพิมพ์ไฟล์ .ts ออก stdout:
    docker compose exec -T api python - < tests/contract/gen_contract.py > data/contract/generated.ts
แล้วคอมไพล์ด้วย tests/contract/tsconfig.json (make contract ทำให้ทั้งหมด)

★ ทุก response ถูกกำหนดให้ const ที่มี type ตรงกับที่หน้าบ้านใช้ — object literal สด
  ทำให้ tsc จับได้ทั้ง field ขาด · field เกิน · null ในที่ห้าม null · string นอก union
"""

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"

TYPES = ("Tank", "Pump", "Valve", "Zone", "ZoneCost", "WaterMeter", "MainMeter", "UnaccountedWater", "DailyUsagePoint",
         "PressureControl", "EnvironmentSensor", "EnvironmentReading", "ElectricNode", "Department", "DepartmentUsage",
         "User", "Device", "ConnectionStatus", "ServiceHealth", "SystemSummary", "TimeSeriesPoint", "ApiError",
         "Alert", "AlertAcknowledgement", "NotificationDelivery", "NotificationPreview", "RecoveryEvent", "Paginated",
         "SystemSettings", "AuthSession", "RealtimeEvent")
SERVICES = {"tanks": ["getTankTotals"], "pumps": ["getPumpEnergyToday"], "zones": ["getZoneConsumption"],
            "meters": ["getFlowBalance"], "pressure": ["getHeadcount"], "environment": ["getRainfall"],
            "electric": ["getEnergyByDepartment"], "devices": ["getDeviceSummary", "pingDevice"],
            "alerts": ["getUnreadAlertCount"]}

# (method, path, type ของ TypeScript)
CASES = [
    ("GET", "/api/tanks", "Tank[]"),
    ("GET", "/api/tanks/tank-3", "Tank"),
    ("GET", "/api/tanks/summary", "Awaited<ReturnType<typeof getTankTotals>>"),
    ("GET", "/api/tanks/tank-1/history", "TimeSeriesPoint[]"),
    ("GET", "/api/pumps", "Pump[]"),
    ("GET", "/api/pumps/pump-3", "Pump"),
    ("GET", "/api/pumps/energy?period=today", "Awaited<ReturnType<typeof getPumpEnergyToday>>"),
    ("GET", "/api/pumps/pump-1/history?metric=current_amp", "TimeSeriesPoint[]"),
    ("GET", "/api/valves", "Valve[]"),
    ("GET", "/api/zones", "Zone[]"),
    ("GET", "/api/zones/zone-8", "Zone"),
    ("GET", "/api/zones/consumption?period=month", "Awaited<ReturnType<typeof getZoneConsumption>>"),
    ("GET", "/api/zones/cost", "ZoneCost[]"),
    ("GET", "/api/zones/zone-1/history", "TimeSeriesPoint[]"),
    ("GET", "/api/meters", "WaterMeter[]"),
    ("GET", "/api/meters/main", "MainMeter"),
    ("GET", "/api/meters/balance", "Awaited<ReturnType<typeof getFlowBalance>>"),
    ("GET", "/api/meters/unaccounted", "UnaccountedWater"),
    ("GET", "/api/meters/daily", "DailyUsagePoint[]"),
    ("GET", "/api/pressure", "PressureControl"),
    ("GET", "/api/pressure/headcount", "Awaited<ReturnType<typeof getHeadcount>>"),
    ("GET", "/api/pressure/history", "TimeSeriesPoint[]"),
    ("GET", "/api/environment", "EnvironmentSensor[]"),
    ("GET", "/api/environment/env-outdoor", "EnvironmentSensor"),
    ("GET", "/api/environment/env-pump-room/latest", "EnvironmentReading"),
    ("GET", "/api/environment/rainfall", "Awaited<ReturnType<typeof getRainfall>>"),
    ("GET", "/api/environment/env-outdoor/history?metric=humidity", "TimeSeriesPoint[]"),
    ("GET", "/api/electric/nodes", "ElectricNode[]"),
    ("GET", "/api/electric/nodes/elec-executive", "ElectricNode"),
    ("GET", "/api/electric/summary?period=today", "Awaited<ReturnType<typeof getEnergyByDepartment>>"),
    ("GET", "/api/electric/nodes/elec-production/history", "TimeSeriesPoint[]"),
    ("GET", "/api/departments", "Department[]"),
    ("GET", "/api/departments/usage", "DepartmentUsage[]"),
    ("GET", "/api/users", "User[]"),
    ("GET", "/api/devices", "Device[]"),
    ("GET", "/api/devices/plc-1", "Device"),
    ("GET", "/api/devices/summary", "Awaited<ReturnType<typeof getDeviceSummary>>"),
    ("POST", "/api/devices/esp32-vip/ping", "Awaited<ReturnType<typeof pingDevice>>"),
    ("GET", "/api/devices/esp32-vip/history", "TimeSeriesPoint[]"),
    ("GET", "/api/system/connection", "ConnectionStatus"),
    ("GET", "/api/system/services", "ServiceHealth[]"),
    ("GET", "/api/system/summary", "SystemSummary"),
    # {alert} = id ของ alert ล่าสุด — ต้องมี alert อย่างน้อยหนึ่งรายการ (รัน make integration ก่อนจะได้ครบทุกสถานะ)
    ("GET", "/api/alerts?limit=5", "Paginated<Alert>"),
    ("GET", "/api/alerts/{alert}", "Alert"),
    ("GET", "/api/alerts/unread-count", "Awaited<ReturnType<typeof getUnreadAlertCount>>"),
    ("GET", "/api/alerts/acknowledgements", "AlertAcknowledgement[]"),
    ("GET", "/api/alerts/recoveries", "RecoveryEvent[]"),
    ("GET", "/api/alerts/{alert}/preview?channel=email", "NotificationPreview"),
    ("GET", "/api/notifications/deliveries", "NotificationDelivery[]"),
    ("GET", "/api/alerts/999999999", "ApiError"),
    ("GET", "/api/settings", "SystemSettings"),
    # ข้อความจริงหนึ่งข้อความจาก stream (ต้องเปิด simulator) — อาร์เรย์ของ RealtimeEvent
    ("WS", "/api/stream?channels=telemetry,system", "RealtimeEvent[]"),
    ("GET", "/api/auth/session", "AuthSession | null"),
    ("GET", "/api/auth/me", "User | null"),
    ("GET", "/api/tanks/nope", "ApiError"),
    ("GET", "/api/zones/cost?from=bad", "ApiError"),
]


def fetch(method: str, path: str) -> object:
    if method == "WS":
        from websockets.sync.client import connect

        with connect("ws://127.0.0.1:8000" + path, open_timeout=10) as socket:
            return json.loads(socket.recv(timeout=15))
    request = urllib.request.Request(BASE + path, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return json.loads(exc.read())


def main() -> None:
    out = ["// สร้างโดย tests/contract/gen_contract.py — ห้ามแก้มือ", "/* eslint-disable */",
           f"import type {{ {', '.join(TYPES)} }} from '../../../lib/types';"]
    out += [f"import type {{ {', '.join(names)} }} from '../../../lib/services/{module}';"
            for module, names in SERVICES.items()]
    latest = fetch("GET", "/api/alerts?limit=1")["items"]  # type: ignore[index]
    alert_id = latest[0]["id"] if latest else "0"
    for index, (method, path, ts_type) in enumerate(CASES):
        body = json.dumps(fetch(method, path.replace("{alert}", alert_id)), ensure_ascii=False, indent=1)
        out.append(f"\n// {method} {path}\nexport const case{index}: {ts_type} = {body};")
    sys.stdout.write("\n".join(out) + "\n")


main()
