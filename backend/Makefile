# คำสั่งประจำของ backend — รันจากโฟลเดอร์ backend/

COMPOSE := docker compose

.PHONY: env passwd up down reset ps logs psql venv lint test scenarios sim sim-stop

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

venv:           ## เครื่องมือทดสอบบนเครื่อง (ต้องมีเน็ตครั้งแรก)
	python3 -m venv .venv
	.venv/bin/pip install -r ingest/requirements.txt -r simulator/requirements.txt pytest==8.4.2 ruff==0.8.6

lint:
	.venv/bin/ruff check ingest simulator tests

test:           ## unit test — ไม่ต้องมี docker
	.venv/bin/pytest -q

scenarios:      ## สถานการณ์ S1–S14 กับ stack จริง (make up ก่อน)
	tests/run_scenarios.sh all

sim:            ## เปิด simulator 28 stream ต่อเนื่อง
	$(COMPOSE) -f docker-compose.yml -f docker-compose.sim.yml up -d --build simulator

sim-stop:
	$(COMPOSE) -f docker-compose.yml -f docker-compose.sim.yml stop simulator
