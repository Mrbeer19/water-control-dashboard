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
	.venv/bin/pip install -r ingest/requirements.txt -r simulator/requirements.txt -r api/requirements.txt pytest==8.4.2 ruff==0.8.6

lint:
	.venv/bin/ruff check ingest simulator api scripts tests

test:           ## unit test — ไม่ต้องมี docker
	.venv/bin/pytest -q

scenarios:      ## สถานการณ์ S1–S14 กับ stack จริง (make up ก่อน)
	tests/run_scenarios.sh all

caggs:          ## สร้าง db/07_caggs.sql ใหม่จาก api/metric_registry.py
	.venv/bin/python scripts/gen_caggs.py

parity:         ## เกณฑ์รับงานเฟส 3 — /api/metrics/series 13 ข้อ (make up ก่อน)
	.venv/bin/pytest -m integration tests/test_series_parity.py -v

NODE22 := node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

frontend-checks: ## 6 คำสั่งที่ CI บังคับก่อน push (check:buckets/series ต้องใช้ Node 22 จึงรันใน container)
	cd .. && npx tsc --noEmit && npm run lint && npm run check:colors && npm run build
	docker run --rm --network none -v "$(abspath ..)":/app:ro -w /app $(NODE22) \
	  sh -c 'npm run check:buckets && npm run check:series'

contract:       ## คอมไพล์ response จริงทุก endpoint เทียบ lib/types.ts (make up + make sim ก่อน)
	mkdir -p data/contract
	$(COMPOSE) exec -T api python - < tests/contract/gen_contract.py > data/contract/generated.ts
	docker run --rm --network none -v "$(abspath ..)":/app:ro -w /app $(NODE22) \
	  node_modules/.bin/tsc -p backend/tests/contract/tsconfig.json

integration:    ## เกณฑ์รับงานที่ใช้ stack จริง ยกเว้น S1–S14 (make up ก่อน)
	.venv/bin/pytest -m integration tests/test_series_parity.py tests/test_alerts_api.py -v

sim:            ## เปิด simulator 28 stream ต่อเนื่อง
	$(COMPOSE) -f docker-compose.yml -f docker-compose.sim.yml up -d --build simulator

sim-stop:
	$(COMPOSE) -f docker-compose.yml -f docker-compose.sim.yml stop simulator
