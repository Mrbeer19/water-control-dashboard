"""FastAPI — service แยกของ backend (nginx proxy /api มาที่นี่)

รัน: uvicorn api.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime

import psycopg
from fastapi import FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .db import pool
from .errors import ApiException
from .routes_ai import router as ai_router
from .routes_alerts import router as alerts_router
from .routes_auth import router as auth_router
from .routes_domain import router as domain_router
from .routes_settings import router as settings_router
from .series import SeriesQuery, metric_series, state_spans
from .stream import hub, stream_endpoint

SERVICE = "api"


def log(event: str, **fields: object) -> None:
    record = {"ts": datetime.now().astimezone().isoformat(timespec="milliseconds"), "service": SERVICE,
              "entity_id": fields.pop("entity_id", None), "event": event, **fields}
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    pool.open(wait=False)
    hub.start()
    yield
    await hub.stop()
    pool.close()


app = FastAPI(title="Water Control API", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.include_router(domain_router)
app.include_router(alerts_router)
app.include_router(auth_router)
app.include_router(settings_router)
app.include_router(ai_router)
app.add_api_websocket_route("/api/stream", stream_endpoint)


@app.exception_handler(ApiException)
async def api_error(request: Request, exc: ApiException) -> JSONResponse:
    trace_id = uuid.uuid4().hex[:12]
    if exc.status >= 500:
        log("request_failed", level="error", path=request.url.path, code=exc.code, trace_id=trace_id)
    return JSONResponse(exc.body(trace_id), status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(part) for part in first.get("loc", []) if part not in ("query", "body"))
    body = ApiException(400, "VALIDATION_FAILED", f"พารามิเตอร์ {field} ไม่ถูกต้อง", f"Invalid parameter {field}",
                        {"field": field, "reason": str(first.get("msg", ""))}).body(None)
    return JSONResponse(body, status_code=400)


@app.exception_handler(psycopg.OperationalError)
async def database_down(request: Request, exc: psycopg.OperationalError) -> JSONResponse:
    trace_id = uuid.uuid4().hex[:12]
    log("database_unavailable", level="error", path=request.url.path, error=str(exc).strip(), trace_id=trace_id)
    body = ApiException(503, "DATABASE_UNAVAILABLE", "ฐานข้อมูลไม่พร้อมใช้งานชั่วคราว",
                        "Database temporarily unavailable").body(trace_id)
    return JSONResponse(body, status_code=503)


@app.get("/api/health")
def health() -> dict[str, object]:
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/api/metrics/series")
def get_metric_series(
    response: Response,
    source_type: str = Query(alias="sourceType"),
    source_id: str = Query(alias="sourceId"),
    metric: str = Query(),
    from_ms: int = Query(alias="from"),
    to_ms: int = Query(alias="to"),
    granularity: str = Query(),
    compare: str = Query("none"),
    month_anchor: str = Query("calendar", alias="monthAnchor"),
) -> dict[str, object]:
    query = SeriesQuery(source_type, source_id, metric, from_ms, to_ms, granularity, compare, month_anchor)
    with pool.connection() as conn:
        body = metric_series(conn, query)
    response.headers["Cache-Control"] = "max-age=1"
    return body


@app.get("/api/metrics/state-spans")
def get_state_spans(
    response: Response,
    source_type: str = Query(alias="sourceType"),
    source_id: str = Query(alias="sourceId"),
    from_ms: int = Query(alias="from"),
    to_ms: int = Query(alias="to"),
    metric: str | None = Query(None),
) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = state_spans(conn, source_type, source_id, from_ms, to_ms, metric)
    response.headers["Cache-Control"] = "max-age=1"
    return body
