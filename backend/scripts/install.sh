#!/usr/bin/env bash
# ติดตั้งจาก bundle บนเครื่องที่ไม่มีอินเทอร์เน็ต (PROMPT_07 งานที่ 4)
#
#   scripts/install.sh dist/water-backend-<ver>.tar
#
# ★ ไม่ build ไม่ pull — ขาด image ตัวไหนให้ล้มทันทีพร้อมบอกชื่อ ดีกว่าค้างรอเน็ตที่ไม่มีวันมา
# ★ ก่อนรัน: ตั้ง .env (make init แล้วแก้รหัส) และสร้าง mosquitto/passwd (make passwd) บนเครื่องนี้
set -euo pipefail
cd "$(dirname "$0")/.."

bundle=${1:?ระบุไฟล์ bundle เช่น dist/water-backend-20260915-abc1234.tar}
[ -f .env ] || { echo "ยังไม่มี .env — รัน make init แล้วตั้งรหัสจริงก่อน" >&2; exit 1; }
[ -f mosquitto/passwd ] || { echo "ยังไม่มี mosquitto/passwd — รัน make passwd ก่อน" >&2; exit 1; }

if [ -f "$bundle.sha256" ]; then
  (
    cd "$(dirname "$bundle")"
    name=$(basename "$bundle")
    if command -v sha256sum >/dev/null; then sha256sum -c "$name.sha256"; else shasum -a 256 -c "$name.sha256"; fi
  )
else
  echo "⚠️ ไม่มีไฟล์ $bundle.sha256 — ข้ามการตรวจว่าไฟล์เสียระหว่างคัดลอกหรือไม่" >&2
fi

docker load -i "$bundle"

compose=(docker compose -f docker-compose.yml)
missing=""
for image in $("${compose[@]}" config --images | sort -u); do
  docker image inspect "$image" >/dev/null 2>&1 || missing="$missing $image"
done
if [ -n "$missing" ]; then
  echo "bundle ไม่มี image:$missing" >&2
  exit 1
fi

"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 300
"${compose[@]}" ps
