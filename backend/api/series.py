"""GET /api/metrics/series และ /api/metrics/state-spans

ขั้นตอน (PROMPT_03 งานที่ 3):
  1. ตรวจคู่ช่วง ↔ granularity ตาม PAIRING (api/buckets.py = พอร์ตของ time-buckets.ts) → 400
  2. นับ bucket เกิน 1,000 → 400
  3. เลือกแหล่ง  raw → hypertable · minute_5/15 → *_5m · hour → *_1h · day/week/month/year → *_1d
  4. สร้างโครง bucket ครบทุกช่วงด้วย bucket_starts() แล้ว LEFT JOIN → ช่วงไม่มีข้อมูลเป็น null ไม่ใช่ 0
  5. bucket ที่ยังไม่จบ → isPartial
  6. compare = previous | last_year
  7. monthAnchor = meter_reading → ตัดเดือนตามวันที่จดใน meter_readings
  8. ห่อเป็น MetricSeries (timestamp = epoch ms · from/to = ISO พร้อม offset · ส่ง timezone กลับ)

★★ counter.delta = last(N) − last(N−1) ข้าม bucket (ไม่ใช่ last − first ของช่วง) — telescoping sum
   ผลรวมรายชั่วโมงจึงเท่ารายวันเป๊ะ · ค่าลดลง = รีเซ็ต → delta = last(N), resetDetected = true, ห้ามติดลบ
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

from . import buckets as bk
from .errors import ApiException, bad_request, not_found
from .metric_registry import (
    AMOUNT,
    COUNTER,
    GAUGE,
    LEVEL,
    METRICS,
    PENDING_METRICS,
    SOURCES,
    STATE,
    STATE_METRICS,
    MetricDef,
    Source,
    cagg_name,
)

NO_DATA = "no_data"
SAMPLE_MS = 2_000
COUNTER_EPSILON = 1e-9
COMPARE_MODES = ("none", "previous", "last_year")
MONTH_ANCHORS = ("calendar", "meter_reading")
LEVEL_OF = {"raw": None, "minute_5": "5m", "minute_15": "5m", "hour": "1h",
            "day": "1d", "week": "1d", "month": "1d", "year": "1d"}
MAX_STATE_RANGE_MS = 400 * bk.MS_DAY

Bounds = list[tuple[int, int]]
Segment = tuple[int, int, str]


@dataclass(frozen=True)
class SeriesQuery:
    source_type: str
    source_id: str
    metric: str
    from_ms: int
    to_ms: int
    granularity: str
    compare: str = "none"
    month_anchor: str = "calendar"


# ─────────────── เวลา ───────────────

def now_ms() -> int:
    return round(datetime.now(UTC).timestamp() * 1000)


def to_ms(value: datetime | None) -> int | None:
    return None if value is None else round(value.timestamp() * 1000)


def to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=UTC)


def iso(ms: int, tz: str) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=ZoneInfo(tz)).isoformat(timespec="milliseconds")


def resolve_timezone(conn: psycopg.Connection) -> str:
    """เขตเวลาจาก settings.general.timezone — ห้าม hardcode · ต้องตรงกับที่ใช้สร้าง aggregate"""
    row = conn.execute("SELECT value ->> 'timezone' FROM settings WHERE section = 'general'").fetchone()
    tz = row[0] if row is not None else None
    if not tz:
        raise ApiException(500, "SETTINGS_MISSING", "ยังไม่ได้ตั้งเขตเวลาของระบบ", "System timezone is not configured")
    try:
        ZoneInfo(tz)
    except (KeyError, ValueError) as exc:
        raise ApiException(500, "TIMEZONE_INVALID", f"เขตเวลา {tz} ไม่ถูกต้อง", f"Invalid timezone {tz}") from exc
    cagg = conn.execute("SELECT timezone FROM aggregate_config").fetchone()
    if cagg is not None and cagg[0] != tz:
        raise ApiException(409, "AGGREGATE_TIMEZONE_MISMATCH",
                           f"เขตเวลาในการตั้งค่า ({tz}) ไม่ตรงกับที่ใช้สร้างข้อมูลรวม ({cagg[0]}) ต้องสร้างข้อมูลรวมใหม่",
                           f"Settings timezone ({tz}) differs from aggregate timezone ({cagg[0]}); rebuild aggregates",
                           {"settings": tz, "aggregate": cagg[0]})
    return tz


def assert_whole_hour_offset(tz: str, *moments: int) -> None:
    """★ bucketStart() ฝั่งหน้าบ้านกับ time_bucket() ตรงกันเฉพาะ offset ชั่วโมงเต็ม (PROBLEMS.md P-11)"""
    for moment in moments:
        offset = datetime.fromtimestamp(moment / 1000, tz=ZoneInfo(tz)).utcoffset()
        if offset is not None and offset.total_seconds() % 3600 != 0:
            raise bad_request("TIMEZONE_NOT_WHOLE_HOUR",
                              f"เขตเวลา {tz} มี offset ไม่ใช่ชั่วโมงเต็ม ขอบช่วงสองฝั่งจะไม่ตรงกัน",
                              f"Timezone {tz} has a non whole-hour offset; bucket edges would disagree", timezone=tz)


# ─────────────── ตรวจคำขอ ───────────────

def validate(q: SeriesQuery) -> None:
    if q.granularity not in bk.GRANULARITIES:
        raise bad_request("INVALID_GRANULARITY", f"ไม่รู้จักความละเอียด {q.granularity}",
                          f"Unknown granularity {q.granularity}", allowed=",".join(bk.GRANULARITIES))
    if q.compare not in COMPARE_MODES:
        raise bad_request("INVALID_COMPARE", f"ไม่รู้จักโหมดเปรียบเทียบ {q.compare}", f"Unknown compare mode {q.compare}",
                          allowed=",".join(COMPARE_MODES))
    if q.month_anchor not in MONTH_ANCHORS:
        raise bad_request("INVALID_MONTH_ANCHOR", f"ไม่รู้จัก monthAnchor {q.month_anchor}",
                          f"Unknown monthAnchor {q.month_anchor}", allowed=",".join(MONTH_ANCHORS))
    if q.to_ms <= q.from_ms:
        raise bad_request("INVALID_RANGE", "เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม", "`to` must be after `from`")
    allowed = bk.allowed_granularities(q.from_ms, q.to_ms)
    if q.granularity not in allowed:
        preferred = bk.preferred_granularity(q.from_ms, q.to_ms)
        raise bad_request("GRANULARITY_NOT_ALLOWED",
                          f"ช่วงเวลานี้ใช้ความละเอียด {q.granularity} ไม่ได้ ควรใช้ {preferred}",
                          f"Granularity {q.granularity} is not allowed for this range; use {preferred}",
                          requested=q.granularity, allowed=",".join(allowed), suggested=preferred)


def calendar_bounds(from_ms: int, to_ms: int, granularity: str, tz: str) -> Bounds:
    starts = bk.bucket_starts(from_ms, to_ms, granularity, tz)
    bounds = [(start, bk.next_bucket_start(start, granularity, tz)) for start in starts]
    # ★ raw ยกเว้นเพดาน 1,000 จุด: PAIRING ในหน้าบ้านยอม raw ถึง 1 ชม. (1,800 จุด) — ดู DECISIONS D-23
    if granularity != "raw" and len(bounds) > bk.MAX_POINTS_PER_SERIES:
        raise bad_request("TOO_MANY_POINTS", f"ขอข้อมูลเกิน {bk.MAX_POINTS_PER_SERIES} จุดต่อชุด ลดช่วงหรือเพิ่มความละเอียด",
                          f"More than {bk.MAX_POINTS_PER_SERIES} points requested", limit=bk.MAX_POINTS_PER_SERIES)
    return bounds


def meter_reading_bounds(conn: psycopg.Connection, entity_id: str, from_ms: int, to_ms: int, tz: str) -> Bounds:
    """เดือนตามรอบจดมิเตอร์ — ขอบช่วงคือ 00:00 ของวันที่จด (ไม่ใช่วันที่ 1)

    มิเตอร์ที่ไม่มีบันทึกการจดของตัวเอง ใช้วันจดของมิเตอร์หลัก (รอบบิลของการประปาเป็นรอบเดียวกัน)
    """
    rows = conn.execute("""
        SELECT DISTINCT read_on FROM meter_readings
         WHERE entity_id = COALESCE((SELECT entity_id FROM meter_readings WHERE entity_id = %s LIMIT 1),
                                    (SELECT entity_id FROM entities WHERE source_type = 'meter'
                                                                     AND (spec ->> 'isMain')::boolean LIMIT 1))
         ORDER BY read_on""", (entity_id,)).fetchall()
    if not rows:
        raise bad_request("METER_READINGS_MISSING", "ยังไม่มีบันทึกวันจดมิเตอร์ ใช้มุมมองเดือนตามปฏิทินแทน",
                          "No meter readings recorded; use calendar months")
    marks = [bk.zoned_time_to_ms((d.year, d.month, d.day, 0, 0, 0), tz) for (d,) in rows if isinstance(d, date)]
    edges = [*marks, max(to_ms, marks[-1] + 1)]
    bounds = [(start, stop) for start, stop in zip(edges, edges[1:], strict=False) if stop > from_ms and start < to_ms]
    if not bounds:
        raise bad_request("METER_READINGS_MISSING", "ไม่มีบันทึกวันจดมิเตอร์ครอบช่วงที่ขอ",
                          "No meter readings cover the requested range")
    return bounds


# ─────────────── หา entity ───────────────

def resolve_entity(conn: psycopg.Connection, source_type: str, source_id: str, metric: str) -> dict[str, object]:
    with conn.cursor(row_factory=dict_row) as cur:
        if source_type == "zone" and metric not in STATE_METRICS:
            cur.execute("SELECT * FROM entities WHERE source_type = 'meter' AND zone_id = %s AND active LIMIT 1",
                        (source_id,))
        elif source_type == "system" and metric == "main_inflow_lpm":
            cur.execute("SELECT * FROM entities WHERE source_type = 'meter' AND (spec ->> 'isMain')::boolean LIMIT 1")
        else:
            cur.execute("SELECT * FROM entities WHERE entity_id = %s AND source_type = %s", (source_id, source_type))
        found = cur.fetchone()
    if found is None:
        raise not_found("SOURCE_NOT_FOUND", f"ไม่พบ {source_type} {source_id}", f"{source_type} {source_id} not found",
                        sourceType=source_type, sourceId=source_id)
    return found


def metric_definition(source_type: str, metric: str) -> MetricDef:
    definition = METRICS.get((source_type, metric))
    if definition is not None:
        return definition
    if metric in PENDING_METRICS:
        reason = PENDING_METRICS[metric]
        raise not_found("METRIC_NOT_AVAILABLE", f"metric {metric} ยังไม่พร้อม: {reason}",
                        f"Metric {metric} is not available yet", metric=metric, reason=reason)
    raise not_found("METRIC_NOT_SUPPORTED", f"{source_type} ไม่มี metric {metric}",
                    f"Metric {metric} is not supported for {source_type}", sourceType=source_type, metric=metric)


# ─────────────── ดึงผลรวมต่อ bucket ───────────────

def _select_exprs(source: Source, measure_key: str, raw: bool) -> dict[str, str]:
    m = source.measure(measure_key)
    k, e = m.key, m.expr
    if raw:
        nn = f"FILTER (WHERE ({e}) IS NOT NULL)"
        exprs = {"s": f"sum({e})", "n": f"count({e})", "mn": f"min({e})", "mx": f"max({e})",
                 "mn_at": f"first(c.time, {e}) {nn}", "mx_at": f"last(c.time, {e}) {nn}",
                 "last": f"last({e}, c.time) {nn}", "first": f"first({e}, c.time) {nn}"}
    else:
        exprs = {"s": f"sum(c.{k}_sum)", "n": f"sum(c.{k}_n)", "mn": f"min(c.{k}_min)", "mx": f"max(c.{k}_max)",
                 "mn_at": f"first(c.{k}_min_at, c.{k}_min) FILTER (WHERE c.{k}_min IS NOT NULL)",
                 "mx_at": f"last(c.{k}_max_at, c.{k}_max) FILTER (WHERE c.{k}_max IS NOT NULL)",
                 "last": f"last(c.{k}_last, c.bucket) FILTER (WHERE c.{k}_last IS NOT NULL)",
                 "first": f"first(c.{k}_first, c.bucket) FILTER (WHERE c.{k}_first IS NOT NULL)"}
    wanted = {GAUGE: ("s", "n", "mn", "mx", "mn_at", "mx_at"), LEVEL: ("n", "mn", "mx", "last"),
              COUNTER: ("n", "last", "first"), AMOUNT: ("s", "n", "mx")}[m.kind]
    return {alias: exprs[alias] for alias in wanted}


def fetch_buckets(conn: psycopg.Connection, definition: MetricDef, level: str | None, entity_id: str,
                  bounds: Bounds) -> list[dict[str, object]]:
    source = SOURCES[definition.source]
    raw = level is None
    table = source.table if raw else cagg_name(definition.source, level)
    time_col = "time" if raw else "bucket"
    extra = f" AND ({source.where})" if raw and source.where else ""
    exprs = _select_exprs(source, definition.measure, raw)
    select = ", ".join(f"{expr} AS {alias}" for alias, expr in exprs.items())
    query = f"""
        SELECT b.idx, {select}
          FROM unnest(%(starts)s::timestamptz[], %(stops)s::timestamptz[]) WITH ORDINALITY AS b(start, stop, idx)
          LEFT JOIN {table} c ON c.entity_id = %(entity)s AND c.{time_col} >= b.start AND c.{time_col} < b.stop{extra}
         GROUP BY b.idx
         ORDER BY b.idx"""
    params = {"starts": [to_dt(s) for s, _ in bounds], "stops": [to_dt(e) for _, e in bounds], "entity": entity_id}
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(query, params)  # type: ignore[arg-type]
        return cur.fetchall()


def fetch_prior_counter(conn: psycopg.Connection, definition: MetricDef, level: str | None, entity_id: str,
                        before_ms: int) -> float | None:
    """ค่าสะสมล่าสุดก่อนช่วงที่ขอ — ให้ delta ของ bucket แรกข้าม bucket ได้เหมือน bucket อื่น"""
    source = SOURCES[definition.source]
    m = source.measure(definition.measure)
    if level is None:
        extra = f" AND ({source.where})" if source.where else ""
        query = (f"SELECT {m.expr} FROM {source.table} WHERE entity_id = %s AND time < %s "
                 f"AND ({m.expr}) IS NOT NULL{extra} ORDER BY time DESC LIMIT 1")
    else:
        query = (f"SELECT {m.key}_last FROM {cagg_name(definition.source, level)} WHERE entity_id = %s "
                 f"AND bucket < %s AND {m.key}_last IS NOT NULL ORDER BY bucket DESC LIMIT 1")
    row = conn.execute(query, (entity_id, to_dt(before_ms))).fetchone()  # type: ignore[arg-type]
    return None if row is None else float(row[0])


# ─────────────── ประกอบ bucket (pure — ทดสอบได้ไม่ต้องมี DB) ───────────────

def _f(value: object) -> float | None:
    return None if value is None else float(value)  # type: ignore[arg-type]


def expected_count(start: int, stop: int) -> int:
    return max(1, math.floor((stop - start) / SAMPLE_MS + 0.5))


def build_points(kind: str, rows: list[dict[str, object]], bounds: Bounds, now: int, prior: float | None = None,
                 scale: float = 1.0) -> list[dict[str, object]]:
    """★ ตอบเป็น discriminated union จริง — gauge ไม่มีคีย์ sum เลยแม้เป็น null"""
    points: list[dict[str, object]] = []
    previous = prior
    for (start, stop), row in zip(bounds, rows, strict=True):
        n = int(row.get("n") or 0)  # type: ignore[call-overload]
        base: dict[str, object] = {"timestamp": start, "count": n, "expectedCount": expected_count(start, stop),
                                   "isPartial": stop > now}
        if kind == GAUGE:
            base |= {"kind": GAUGE, "avg": None, "min": None, "max": None, "minAt": None, "maxAt": None}
            if n:
                base |= {"avg": _f(row["s"]) / n, "min": _f(row["mn"]), "max": _f(row["mx"]),  # type: ignore[operator]
                         "minAt": to_ms(row["mn_at"]), "maxAt": to_ms(row["mx_at"])}  # type: ignore[arg-type]
        elif kind == LEVEL:
            base |= {"kind": LEVEL, "last": None, "min": None, "max": None}
            if n:
                base |= {key: None if row[col] is None else _f(row[col]) * scale  # type: ignore[operator]
                         for key, col in (("last", "last"), ("min", "mn"), ("max", "mx"))}
        elif kind == AMOUNT:
            base |= {"kind": AMOUNT, "sum": _f(row["s"]) if n else None, "max": _f(row["mx"]) if n else None}
        elif kind == COUNTER:
            delta, reset = None, False
            last = _f(row.get("last"))
            if n and last is not None:
                if previous is None:
                    first = _f(row.get("first"))
                    delta = last - first if first is not None and last >= first else last
                    reset = first is not None and last < first
                elif last < previous - COUNTER_EPSILON:
                    delta, reset = last, True   # ★ ตัวนับรีเซ็ต: นับจากค่าใหม่ ห้ามติดลบ
                else:
                    delta = last - previous
                previous = last
            base |= {"kind": COUNTER, "delta": delta, "resetDetected": reset}
        points.append(base)
    return points


# ─────────────── สถานะ ───────────────

def _subtract(pieces: list[Segment], cut_start: int, cut_end: int) -> list[Segment]:
    out: list[Segment] = []
    for start, end, state in pieces:
        if cut_end <= start or cut_start >= end:
            out.append((start, end, state))
            continue
        if cut_start > start:
            out.append((start, cut_start, state))
        if cut_end < end:
            out.append((cut_end, end, state))
    return out


def build_timeline(spans: list[tuple[str, int, int | None]], masks: list[tuple[int, int | None]], start: int,
                   end: int, now: int) -> list[Segment]:
    """ช่วงสถานะที่ต่อกันไม่มีรูใน [start, end)

    ★ ช่วงที่ไม่มีข้อมูล / อุปกรณ์ offline (masks) / อนาคตที่ยังไม่เกิด = no_data
    ★ ตัดขอบที่ start/end · ผลรวมความยาว = end − start พอดี
    """
    known_end = max(start, min(end, now))
    pieces: list[Segment] = []
    for state, s, e in sorted(spans, key=lambda item: item[1]):
        clipped_start, clipped_end = max(s, start), min(known_end if e is None else e, known_end)
        if clipped_end > clipped_start:
            pieces.append((clipped_start, clipped_end, state))
    for mask_start, mask_end in masks:
        pieces = _subtract(pieces, mask_start, known_end if mask_end is None else mask_end)

    timeline: list[Segment] = []
    cursor = start
    for s, e, state in sorted(pieces):
        s = max(s, cursor)
        if e <= s:
            continue
        if s > cursor:
            timeline.append((cursor, s, NO_DATA))
        timeline.append((s, e, state))
        cursor = e
    if cursor < end:
        timeline.append((cursor, end, NO_DATA))

    merged: list[Segment] = []
    for segment in timeline:
        if merged and merged[-1][2] == segment[2] and merged[-1][1] == segment[0]:
            merged[-1] = (merged[-1][0], segment[1], segment[2])
        else:
            merged.append(segment)
    return merged


def state_points(timeline: list[Segment], bounds: Bounds, now: int) -> list[dict[str, object]]:
    points: list[dict[str, object]] = []
    first_index = 0
    range_start = bounds[0][0] if bounds else 0
    for start, stop in bounds:
        while first_index < len(timeline) and timeline[first_index][1] <= start:
            first_index += 1
        durations: dict[str, int] = {}
        entries: dict[str, int] = {}
        count = 0
        i = first_index
        while i < len(timeline) and timeline[i][0] < stop:
            seg_start, seg_end, state = timeline[i]
            overlap = min(seg_end, stop) - max(seg_start, start)
            if overlap > 0:
                durations[state] = durations.get(state, 0) + overlap
                if start <= seg_start < stop and seg_start != range_start:
                    entries[state] = entries.get(state, 0) + 1   # เข้าสถานะนี้ภายในช่วง
                if state != NO_DATA:
                    count += 1
            i += 1
        points.append({"kind": STATE, "timestamp": start, "count": count,
                       "expectedCount": expected_count(start, stop), "isPartial": stop > now,
                       "durationsMs": durations, "entries": entries})
    return points


def state_metric_for(source_type: str, requested: str | None) -> str:
    if requested is not None:
        return requested
    return "pump_run_state" if source_type == "pump" else "online_state"


def fetch_timeline(conn: psycopg.Connection, entity: dict[str, object], metric: str, from_ms: int, until_ms: int,
                   now: int) -> list[Segment]:
    target = str(entity["entity_id"])
    device_id = entity.get("device_id")
    if metric == "online_state" and entity["source_type"] != "device":
        if device_id is None:
            return build_timeline([], [], from_ms, until_ms, now)
        target = str(device_id)
    overlap = "started_at < %s AND (ended_at IS NULL OR ended_at > %s)"
    rows = conn.execute(f"SELECT state, started_at, ended_at FROM state_spans WHERE entity_id = %s AND metric = %s "
                        f"AND {overlap} ORDER BY started_at",
                        (target, metric, to_dt(until_ms), to_dt(from_ms))).fetchall()
    spans = [(state, to_ms_required(s), to_ms(e)) for state, s, e in rows]
    masks: list[tuple[int, int | None]] = []
    if metric != "online_state" and device_id is not None:
        # ★ อุปกรณ์ที่วัดค่า offline = ไม่รู้สถานะจริง ต้องเป็น no_data ไม่ใช่สถานะค้างล่าสุด
        offline = conn.execute(f"SELECT started_at, ended_at FROM state_spans WHERE entity_id = %s "
                               f"AND metric = 'online_state' AND state = 'offline' AND {overlap}",
                               (device_id, to_dt(until_ms), to_dt(from_ms))).fetchall()
        masks = [(to_ms_required(s), to_ms(e)) for s, e in offline]
    return build_timeline(spans, masks, from_ms, until_ms, now)


def to_ms_required(value: datetime) -> int:
    return round(value.timestamp() * 1000)


# ─────────────── endpoint ───────────────

def compare_range(q: SeriesQuery) -> tuple[int, int] | None:
    """ช่วงก่อนหน้าที่ยาวเท่ากัน หรือช่วงเดียวกันของปีก่อน — แบบเดียวกับ compareRange() ใน lib/services/metrics.ts"""
    if q.compare == "previous":
        span = q.to_ms - q.from_ms
        return q.from_ms - span, q.from_ms
    if q.compare == "last_year":
        return _shift_year(q.from_ms), _shift_year(q.to_ms)
    return None


def _shift_year(ms: int) -> int:
    moment = datetime.fromtimestamp(ms / 1000, tz=UTC)
    try:
        shifted = moment.replace(year=moment.year - 1)
    except ValueError:   # 29 ก.พ. → setUTCFullYear ของ JS เลื่อนเป็น 1 มี.ค.
        shifted = moment.replace(year=moment.year - 1, month=3, day=1)
    return round(shifted.timestamp() * 1000)


def metric_series(conn: psycopg.Connection, q: SeriesQuery) -> dict[str, object]:
    validate(q)
    tz = resolve_timezone(conn)
    assert_whole_hour_offset(tz, q.from_ms, q.to_ms)
    now = now_ms()

    if q.metric in STATE_METRICS:
        kind, unit, definition = STATE, "", None
    else:
        definition = metric_definition(q.source_type, q.metric)
        kind, unit = definition.kind, definition.unit
    entity = resolve_entity(conn, q.source_type, q.source_id, q.metric)
    entity_id = str(entity["entity_id"])

    scale = 1.0
    if definition is not None and definition.scale == "capacity_percent":
        capacity = (entity.get("spec") or {}).get("capacityLiters")  # type: ignore[union-attr]
        if not isinstance(capacity, (int, float)) or capacity <= 0:
            raise ApiException(422, "CAPACITY_MISSING", f"ไม่ทราบความจุของ {entity_id}",
                               f"Capacity of {entity_id} unknown")
        scale = 100 / capacity

    def build(from_ms: int, to_ms_: int) -> list[dict[str, object]]:
        if q.granularity == "month" and q.month_anchor == "meter_reading":
            bounds = meter_reading_bounds(conn, entity_id, from_ms, to_ms_, tz)
        else:
            bounds = calendar_bounds(from_ms, to_ms_, q.granularity, tz)
        if not bounds:
            return []
        if definition is None:
            span_start, span_end = min(bounds[0][0], from_ms), max(bounds[-1][1], to_ms_)
            return state_points(fetch_timeline(conn, entity, q.metric, span_start, span_end, now), bounds, now)
        level = LEVEL_OF[q.granularity]
        rows = fetch_buckets(conn, definition, level, entity_id, bounds)
        prior = fetch_prior_counter(conn, definition, level, entity_id, bounds[0][0]) if kind == COUNTER else None
        return build_points(kind, rows, bounds, now, prior, scale)

    compare = compare_range(q)
    return {
        "sourceType": q.source_type, "sourceId": q.source_id, "metric": q.metric, "unit": unit, "kind": kind,
        "granularity": q.granularity, "timezone": tz, "from": iso(q.from_ms, tz), "to": iso(q.to_ms, tz),
        "points": build(q.from_ms, q.to_ms),
        "compare": None if compare is None else {"from": iso(compare[0], tz), "to": iso(compare[1], tz),
                                                  "points": build(*compare)},
    }


def state_spans(conn: psycopg.Connection, source_type: str, source_id: str, from_ms: int, to_ms_: int,
                metric: str | None = None) -> list[dict[str, object]]:
    if to_ms_ <= from_ms:
        raise bad_request("INVALID_RANGE", "เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม", "`to` must be after `from`")
    if to_ms_ - from_ms > MAX_STATE_RANGE_MS:
        raise bad_request("RANGE_TOO_LONG", "ขอช่วงสถานะได้ไม่เกิน 400 วัน ใช้ /api/metrics/series แบบ kind state แทน",
                          "State span range limited to 400 days; use series with kind state")
    chosen = state_metric_for(source_type, metric)
    if chosen not in STATE_METRICS:
        raise not_found("METRIC_NOT_SUPPORTED", f"ไม่รู้จักสถานะ {chosen}", f"Unknown state metric {chosen}")
    entity = resolve_entity(conn, source_type, source_id, chosen)
    timeline = fetch_timeline(conn, entity, chosen, from_ms, to_ms_, now_ms())
    spans = [{"from": s, "to": e, "state": state, "durationMs": e - s} for s, e, state in timeline]
    assert sum(span["durationMs"] for span in spans) == to_ms_ - from_ms  # type: ignore[misc]
    return spans
