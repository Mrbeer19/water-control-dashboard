# คำสั่งประจำของ backend — รันจากโฟลเดอร์ backend/

COMPOSE := docker compose

.PHONY: env passwd up down reset ps logs psql

env:            ## สร้าง .env จากตัวอย่าง (แล้วแก้รหัสทุกตัวก่อนใช้งานจริง)
	@test -f .env || cp .env.example .env
	@echo "แก้รหัสใน .env ให้ครบก่อน make passwd"

passwd:         ## สร้าง mosquitto/passwd จาก acl + .env
	./scripts/gen_passwd.sh

up:             ## ขึ้นทุก service และรอจน healthy
	$(COMPOSE) up -d --wait --wait-timeout 120

down:
	$(COMPOSE) down

reset:          ## ⚠️ ลบข้อมูลทั้งหมดแล้วสร้าง schema ใหม่ (ใช้ตอนพัฒนาเท่านั้น)
	$(COMPOSE) down -v
	$(COMPOSE) up -d --wait --wait-timeout 120

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f --tail=100

psql:
	$(COMPOSE) exec timescaledb sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'
