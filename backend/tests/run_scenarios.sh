#!/bin/sh
# รันสถานการณ์ทดสอบเฟส 2 กับ stack ที่ขึ้นอยู่ (make up ก่อน)
#   tests/run_scenarios.sh S2     รันเคสเดียว (S4 จะรวม S4b ด้วย)
#   tests/run_scenarios.sh all    รันทั้งชุด + เขียนรายงาน data/scenario-report.xml
# ★ ต้องไม่มี simulator รันค้าง ไม่งั้นค่าที่ฉีดจะปนกับค่าจำลอง
set -eu
cd "$(dirname "$0")/.."

if docker compose -f docker-compose.yml -f docker-compose.sim.yml ps --status running --services 2>/dev/null \
    | grep -qx simulator; then
  echo "simulator กำลังรันอยู่ — หยุดก่อน: docker compose -f docker-compose.yml -f docker-compose.sim.yml stop simulator" >&2
  exit 1
fi

target="${1:-all}"
case "$target" in
  all) selector="" ;;
  S[0-9]|S[0-9][0-9]) selector="test_s$(printf '%02d' "${target#S}")" ;;
  *) echo "ใช้: $0 S<เลข>|all" >&2; exit 2 ;;
esac

mkdir -p data
# ★ ระบุไฟล์เสมอ — ไม่ระบุ pytest จะเก็บ integration test ทุกไฟล์ ซึ่งเทสเฟส 5–6 เปิด simulator คืนตอนจบ
#   simulator กลับมาส่งค่าในนามอุปกรณ์เดียวกันกลางชุด แล้ว S4 รอความเงียบไม่มีวันมา
if [ -n "$selector" ]; then
  exec .venv/bin/pytest -m integration tests/test_scenarios.py -k "$selector" -v -rA -s
fi
exec .venv/bin/pytest -m integration tests/test_scenarios.py -v -rA -s --junitxml=data/scenario-report.xml
