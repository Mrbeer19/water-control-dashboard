# worker — โค้ดชุดเดียวกับ api + WeasyPrint (PDF) + pyarrow (Parquet) + ฟอนต์ Sarabun
# build context = backend/ (ต้องเห็นทั้ง api/ และ assets/fonts/) · .dockerignore ของ backend/ ส่งเฉพาะสองโฟลเดอร์นี้
FROM python@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Bangkok

# ★ WeasyPrint ใช้ Pango/HarfBuzz ของระบบ · pg_dump/pg_restore 17 ตรงกับเซิร์ฟเวอร์ PostgreSQL 17 (สำรองข้อมูล)
#   ติดตั้งตอน build เท่านั้น เครื่องในโรงงานไม่ต้องมีเน็ต
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fontconfig \
      postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*

# ★ ฟอนต์ไทยฝังใน image แล้ว fc-cache — ไม่งั้น PDF เป็นสี่เหลี่ยมทั้งหน้า · build ล้มทันทีถ้าหาฟอนต์ไม่เจอ
COPY assets/fonts/Sarabun-Regular.ttf assets/fonts/Sarabun-Bold.ttf assets/fonts/OFL.txt /usr/share/fonts/truetype/sarabun/
RUN fc-cache -f && fc-list | grep -q "Sarabun"

WORKDIR /app
COPY api/requirements.txt api/requirements-worker.txt /tmp/
RUN pip install --no-cache-dir -r /tmp/requirements-worker.txt

COPY api /app/api

CMD ["python", "-m", "api.worker"]
