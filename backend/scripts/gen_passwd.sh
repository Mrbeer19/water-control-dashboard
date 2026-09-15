#!/bin/sh
# สร้าง mosquitto/passwd จากรายชื่อ user ใน mosquitto/acl + รหัสใน .env
#
# รหัสของแต่ละ user อ่านจากตัวแปร MQTT_PASSWORD_<USER> (ตัวพิมพ์ใหญ่ ขีดเป็นขีดล่าง)
#   เช่น ingest → MQTT_PASSWORD_INGEST · dev-esp32-vip → MQTT_PASSWORD_DEV_ESP32_VIP
# อุปกรณ์ที่ไม่ได้ตั้งรหัสแยก ใช้ MQTT_DEVICE_PASSWORD
# ★ บนเครื่องจริงควรตั้งรหัสแยกทุกอุปกรณ์ บอร์ดหนึ่งหลุดรหัสจะได้ไม่ลามทั้งโรงงาน
set -eu
umask 077          # ไฟล์มีรหัสดิบอยู่ชั่วครู่ก่อนถูก hash — ห้ามให้ user อื่นอ่านได้แม้ช่วงนั้น
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "ไม่พบ .env — คัดลอกจาก .env.example ก่อน" >&2; exit 1; }
set -a; . ./.env; set +a

tmp=mosquitto/passwd
: > "$tmp"
for user in $(awk '$1 == "user" { print $2 }' mosquitto/acl); do
  var="MQTT_PASSWORD_$(echo "$user" | tr 'a-z-' 'A-Z_')"
  eval "password=\${$var:-}"
  if [ -z "$password" ]; then
    case "$user" in
      dev-*) password="${MQTT_DEVICE_PASSWORD:?ต้องตั้ง MQTT_DEVICE_PASSWORD}" ;;
      *) echo "ต้องตั้ง $var ใน .env" >&2; exit 1 ;;
    esac
  fi
  printf '%s:%s\n' "$user" "$password" >> "$tmp"
done

# แปลงรหัสดิบเป็น hash ในที่เดียว ด้วย image เดียวกับที่ compose ใช้
docker compose run --rm --no-deps -v "$PWD/mosquitto:/work" --entrypoint mosquitto_passwd mosquitto -U /work/passwd
chmod 600 "$tmp"
echo "สร้าง $tmp แล้ว ($(wc -l < "$tmp") user)"
