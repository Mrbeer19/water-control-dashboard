#!/usr/bin/env bash
# รวม image ทุกตัวของ production เป็นไฟล์เดียว หอบใส่ USB ไปเครื่องในโรงงานที่ไม่มีอินเทอร์เน็ต (PROMPT_07 งานที่ 4)
#
#   scripts/bundle.sh           build → ตรวจ tag → pull image จาก registry → docker save → dist/water-backend-<ver>.tar (+ .sha256)
#   scripts/bundle.sh --check   ตรวจ tag อย่างเดียว ไม่ build ไม่ save
#
# ★ ไม่รวม simulator (ใช้ตอนพัฒนาเท่านั้น ห้ามขึ้นเครื่องจริง — ส่งค่าในนามอุปกรณ์จริงทุกตัว)
# ★ image ต้องปักด้วย digest หรือ tag เวอร์ชัน (เช่น 0.3.0) · ไม่มี tag หรือ latest = ล้มทันที
# ★ .env ไม่ถูกใส่ลง bundle — เครื่องปลายทางตั้งรหัสของตัวเอง
set -euo pipefail
cd "$(dirname "$0")/.."

env_file=.env
[ -f "$env_file" ] || env_file=.env.example        # แค่ให้ compose แปลไฟล์ได้ ไม่ได้ใช้ค่าในนั้น
compose=(docker compose --env-file "$env_file" -f docker-compose.yml)

images=$("${compose[@]}" config --images | sort -u)
bad=$(printf '%s\n' "$images" | grep -Ev '@sha256:[0-9a-f]{64}$|:[0-9]+(\.[0-9]+)+$' || true)
if [ -n "$bad" ]; then
  echo "image ต่อไปนี้ไม่ได้ปักด้วย digest หรือ tag เวอร์ชัน (ห้าม latest):" >&2
  echo "$bad" >&2
  exit 1
fi
count=$(printf '%s\n' "$images" | wc -l | tr -d ' ')
if [ "${1:-}" = "--check" ]; then
  echo "tag ผ่านครบ ${count} image"
  printf '  %s\n' $images
  exit 0
fi

"${compose[@]}" build
"${compose[@]}" pull --ignore-buildable            # image จาก registry ต้องอยู่ในเครื่องก่อน save

version="$(date +%Y%m%d)-$(git rev-parse --short HEAD)"
mkdir -p dist
out="dist/water-backend-${version}.tar"
# shellcheck disable=SC2086  # ต้องแตกเป็นหลายอาร์กิวเมนต์
docker save -o "$out" $images
(
  cd dist
  name=$(basename "$out")
  if command -v sha256sum >/dev/null; then sha256sum "$name" > "$name.sha256"; else shasum -a 256 "$name" > "$name.sha256"; fi
)
echo "สร้าง $out ($(du -h "$out" | cut -f1)) รวม ${count} image"
echo "เครื่องปลายทาง: คัดลอกโฟลเดอร์ backend/ + ไฟล์ .tar แล้วรัน scripts/install.sh $out"
