/**
 * ผลลัพธ์จำลองของทีม AI
 *
 * ★ ที่นี่ "ยืนแทน" บริการของทีม AI ที่รันบน gateway — ไม่ใช่ตรรกะตรวจจับของหน้าบ้าน
 *   หน้าบ้านไม่มีสิทธิ์ตัดสินว่าอะไรผิดปกติ ไฟล์นี้เพียงปล่อยผลสำเร็จรูปตามสถานการณ์
 *   ที่เลือกไว้ เพื่อให้สาธิตได้โดยยังไม่ต้องต่อของจริง
 *
 * สัญญากับทีม AI อยู่ใน docs/AI_CONTRACT.md
 */

import type {
  AIForecast,
  AIServiceStatus,
  AnomalyEvent,
  ForecastPoint,
  MaintenancePrediction,
  MockScenario,
  TimeSeriesPoint,
} from '@/lib/types';
import type { MockState } from './store';
import { nowIso, readHistory } from './store';
import { roundTo } from './random';

/** ชุดผลลัพธ์ที่ทีม AI จะส่งมาในแต่ละสถานการณ์สาธิต */
interface ScenarioAnomalySeed {
  type: string;
  detector: string;
  score: number;
  severity: 'critical' | 'warning' | 'info';
  sourceType: AnomalyEvent['sourceType'];
  sourceId: string;
  metric: string;
  minutesAgo: number;
  summaryTh: string;
  summaryEn: string;
  features: { key: string; value: number; expected?: number | null; contribution?: number }[];
  suggestedAction?: string;
  /** ผลบางรายการจงใจส่งมาไม่ครบ เพื่อทดสอบว่า UI ยัง render ได้ */
  partial?: boolean;
}

const SCENARIO_ANOMALIES: Record<MockScenario, ScenarioAnomalySeed[]> = {
  normal: [
    {
      type: 'sensor_drift',
      detector: 'isolation_forest',
      score: 0.38,
      severity: 'info',
      sourceType: 'sensor',
      sourceId: 'env-outdoor',
      metric: 'humidity',
      minutesAgo: 214,
      summaryTh: 'ความชื้นกลางแจ้งเลื่อนช้า ๆ ออกจากช่วงปกติของฤดูกาล',
      summaryEn: 'Outdoor humidity drifting slowly from its seasonal baseline',
      features: [{ key: 'humidity', value: 79.4, expected: 71.2, contribution: 0.81 }],
    },
  ],
  night_leak: [
    {
      type: 'night_leak',
      detector: 'rule',
      score: 0.92,
      severity: 'critical',
      sourceType: 'zone',
      sourceId: 'zone-7',
      metric: 'flow_lpm',
      minutesAgo: 38,
      summaryTh: 'โซน 7 มีน้ำไหลต่อเนื่องตลอดช่วงกลางคืนที่ไม่ควรมีการใช้งาน',
      summaryEn: 'Zone 7 shows continuous flow through the night with no expected usage',
      suggestedAction: 'ปิดวาล์วโซน 7 แล้วตรวจท่อช่วงลานล้าง หากอัตราไหลไม่ลดแสดงว่ารั่วก่อนวาล์ว',
      features: [
        { key: 'flow_lpm', value: 11.4, expected: 0, contribution: 0.74 },
        { key: 'duration_minutes', value: 316, expected: 0, contribution: 0.26 },
      ],
    },
    {
      type: 'unaccounted_water',
      detector: 'forecast_deviation',
      score: 0.71,
      severity: 'critical',
      sourceType: 'system',
      sourceId: 'system',
      metric: 'unaccounted_percent',
      minutesAgo: 22,
      summaryTh: 'น้ำสูญหายสูงกว่าที่พยากรณ์ไว้ แม้หักปริมาณที่เก็บในถังแล้ว',
      summaryEn: 'Unaccounted water exceeds forecast even after subtracting storage change',
      features: [{ key: 'unaccounted_percent', value: 13.8, expected: 5.1, contribution: 0.93 }],
    },
    {
      // จงใจไม่มี summary/severity/features — ทดสอบ fallback ของ UI
      type: 'pipe_burst_risk',
      detector: 'isolation_forest',
      score: 0.55,
      severity: 'warning',
      sourceType: 'zone',
      sourceId: 'zone-7',
      metric: 'pressure_bar',
      minutesAgo: 9,
      summaryTh: '',
      summaryEn: '',
      features: [],
      partial: true,
    },
  ],
  pump_degrading: [
    {
      type: 'pump_degradation',
      detector: 'isolation_forest',
      score: 0.84,
      severity: 'warning',
      sourceType: 'pump',
      sourceId: 'pump-1',
      metric: 'power_watt',
      minutesAgo: 66,
      summaryTh: 'ปั๊มหลัก 1 ใช้ไฟเท่าเดิมแต่ได้อัตราไหลลดลงต่อเนื่อง 6 วัน',
      summaryEn: 'Main Pump 1 draws the same power but delivers steadily less flow over six days',
      suggestedAction: 'ถอดตรวจใบพัดและซีลภายใน 2 สัปดาห์ ก่อนอัตราไหลตกจนกระทบสายการผลิต',
      features: [
        { key: 'specific_power_w_per_lpm', value: 28.0, expected: 16.7, contribution: 0.68 },
        { key: 'flow_lpm', value: 104.5, expected: 130.0, contribution: 0.32 },
      ],
    },
    {
      type: 'power_anomaly',
      detector: 'rule',
      score: 0.49,
      severity: 'info',
      sourceType: 'pump',
      sourceId: 'pump-1',
      metric: 'current_amp',
      minutesAgo: 12,
      summaryTh: 'กระแสของปั๊มหลัก 1 แกว่งมากกว่าปกติในช่วงสตาร์ต',
      summaryEn: 'Main Pump 1 shows larger-than-usual current swing during start-up',
      features: [{ key: 'current_amp', value: 6.9, expected: 5.4, contribution: 0.77 }],
    },
  ],
};

/**
 * สร้างรายการ anomaly ตามสถานการณ์ที่เลือก
 * เรียกใหม่ทุกครั้งที่สลับ scenario — ผลเก่าถูกแทนที่ทั้งชุด
 */
export function buildAnomalies(state: MockState, scenario: MockScenario): AnomalyEvent[] {
  const now = Date.now();

  return SCENARIO_ANOMALIES[scenario].map((seed, index) => {
    const at = now - seed.minutesAgo * 60_000;
    const sourceName =
      state.zones.find((zone) => zone.id === seed.sourceId)?.name ??
      state.pumps.find((pump) => pump.id === seed.sourceId)?.name ??
      state.sensors.find((sensor) => sensor.id === seed.sourceId)?.name ??
      (seed.sourceId === 'system' ? 'ระบบจ่ายน้ำ' : seed.sourceId);

    const base: AnomalyEvent = {
      id: `anomaly-${scenario}-${index + 1}`,
      type: seed.type,
      detectedAt: nowIso(at),
      status: 'active',
    };

    // ผลที่ทีม AI ส่งมาไม่ครบ — คืนเท่าที่มีจริง ไม่เติมค่าปลอมให้
    if (seed.partial === true) {
      return { ...base, detector: seed.detector, score: seed.score, sourceId: seed.sourceId };
    }

    // ค่าจริงช่วงที่เกิดเหตุ ดึงจากประวัติของ entity ต้นทางเอง ไม่ได้ปั้นตัวเลขใหม่
    const metricKey = seed.metric === 'flow_lpm' ? 'flow_lpm' : seed.metric === 'power_watt' ? 'power_watt' : null;
    const evidence = metricKey === null ? undefined : readHistory(seed.sourceId, metricKey).slice(-40);
    const expectedBand =
      evidence === undefined || evidence.length === 0
        ? undefined
        : {
            lower: evidence.map((point) => ({ timestamp: point.timestamp, value: roundTo(point.value * 0.72, 2) })),
            upper: evidence.map((point) => ({ timestamp: point.timestamp, value: roundTo(point.value * 1.12, 2) })),
          };

    return {
      ...base,
      detector: seed.detector,
      score: seed.score,
      severity: seed.severity,
      evidence,
      expectedBand,
      suggestedAction: seed.suggestedAction,
      feedback: null,
      sourceType: seed.sourceType,
      sourceId: seed.sourceId,
      sourceName,
      metric: seed.metric,
      windowStart: nowIso(at - 3_600_000),
      windowEnd: nowIso(at),
      features: seed.features,
      alertId: null,
      modelName:
        seed.detector === 'rule'
          ? null
          : seed.detector === 'isolation_forest'
            ? state.settings.ai.anomalyModelName
            : state.settings.ai.forecastModelName,
      summaryTh: seed.summaryTh,
      summaryEn: seed.summaryEn,
    };
  });
}

/** คำแนะนำบำรุงรักษาเชิงพยากรณ์ตามสถานการณ์ */
export function buildMaintenancePredictions(
  state: MockState,
  scenario: MockScenario,
): MaintenancePrediction[] {
  const iso = nowIso();

  return state.pumps.map((pump, index) => {
    const degrading = scenario === 'pump_degrading' && pump.id === 'pump-1';
    const failureProbability = degrading ? 0.63 : 0.04 + index * 0.03;
    // คะแนนสุขภาพเดินสวนทางกับโอกาสเสีย — สูง = ดี
    const healthScore = Math.round((1 - failureProbability) * 100);
    const daysUntilIssue = degrading ? 12 : Math.round(pump.hoursUntilService / 18);

    const prediction: MaintenancePrediction = {
      id: `maint-${pump.id}`,
      targetType: 'pump',
      targetId: pump.id,
      generatedAt: iso,
      targetName: pump.name,
      failureProbability: roundTo(failureProbability, 2),
      daysUntilService: degrading ? 9 : Math.round(pump.hoursUntilService / 18),
      // มีวันที่คาดการณ์เฉพาะตัวที่โมเดลเห็นสัญญาณจริง ตัวที่ปกติจะไม่มี
      estimatedIssueDate: degrading
        ? nowIso(Date.now() + daysUntilIssue * 86_400_000)
        : null,
      healthScore,
      trend: degrading ? 'down' : index === 1 ? 'stable' : 'up',
      note: degrading ? 'เฝ้าดูค่ากระแสทุกกะ หากเกิน 6.5 A ให้หยุดใช้งานทันที' : undefined,
      modelName: state.settings.ai.anomalyModelName,
      features: degrading
        ? [
            { key: 'specific_power_w_per_lpm', value: 28.0, expected: 16.7, contribution: 0.61 },
            { key: 'runtime_hours', value: pump.runtimeHours, expected: null, contribution: 0.39 },
          ]
        : [{ key: 'runtime_hours', value: pump.runtimeHours, expected: null, contribution: 1 }],
      recommendationTh: degrading
        ? 'ควรถอดตรวจใบพัดและซีลภายใน 2 สัปดาห์ ก่อนอัตราไหลตกจนกระทบการผลิต'
        : 'ยังไม่พบสัญญาณผิดปกติ ให้บำรุงรักษาตามรอบปกติ',
      recommendationEn: degrading
        ? 'Inspect impeller and seals within two weeks before flow loss affects production'
        : 'No abnormal signal — keep to the regular service interval',
    };
    return prediction;
  });
}

/**
 * ผลพยากรณ์จากทีม AI
 * ใช้ประวัติจริงใน mock เป็นบริบท แล้วต่อเส้นพยากรณ์ออกไปข้างหน้า
 */
export function buildForecast(state: MockState, target: string, targetId: string | null): AIForecast {
  const iso = nowIso();
  const now = Date.now();
  const horizonHours = state.settings.ai.forecastHorizonHours;

  const sourceId = targetId ?? 'system';
  const metric = target === 'tank_level' ? 'level_percent' : target === 'department_energy' ? 'power_watt' : 'flow_lpm';
  const history: TimeSeriesPoint[] = readHistory(sourceId, metric === 'level_percent' ? 'level_percent' : metric === 'power_watt' ? 'power_watt' : 'flow_lpm').slice(-120);
  const lastValue = history.at(-1)?.value ?? 0;

  const steps = 24;
  const stepMs = (horizonHours * 3_600_000) / steps;
  const forecast: ForecastPoint[] = Array.from({ length: steps }, (_, index) => {
    const timestamp = now + (index + 1) * stepMs;
    const wave = Math.sin((index / steps) * Math.PI * 2) * lastValue * 0.12;
    const value = roundTo(lastValue + wave, 2);
    // ช่วงความเชื่อมั่นกว้างขึ้นตามระยะเวลาที่พยากรณ์ออกไป
    const spread = roundTo(Math.abs(value) * (0.03 + (index / steps) * 0.09), 2);
    return { timestamp, value, lowerBound: roundTo(value - spread, 2), upperBound: roundTo(value + spread, 2) };
  });

  const targetName =
    state.tanks.find((tank) => tank.id === targetId)?.name ??
    state.zones.find((zone) => zone.id === targetId)?.name ??
    state.departments.find((department) => department.id === targetId)?.name ??
    'ทั้งระบบ';

  return {
    id: `forecast-${target}-${sourceId}`,
    target,
    generatedAt: iso,
    targetId,
    targetName,
    metric,
    unit: target === 'tank_level' ? '%' : target === 'department_energy' ? 'W' : 'L/min',
    horizonHours,
    history,
    forecast,
    modelName: state.settings.ai.forecastModelName,
    mapePercent: 4.8,
    summaryTh: `คาดว่าค่าจะอยู่ในช่วงปกติตลอด ${horizonHours} ชั่วโมงข้างหน้า`,
    summaryEn: `Expected to stay within normal range for the next ${horizonHours} hours`,
  };
}

export function buildServiceStatus(state: MockState): AIServiceStatus {
  const active = state.anomalies.filter((anomaly) => anomaly.status === 'active');
  const critical = active.filter((anomaly) => anomaly.severity === 'critical').length;
  const enabled = state.settings.ai.forecastEnabled || state.settings.ai.anomalyDetectionEnabled;

  // ข้อความสรุปหนึ่งบรรทัดสำหรับ widget หน้า Overview
  const summaryText =
    !enabled
      ? 'ปิดการตรวจจับความผิดปกติอยู่'
      : critical > 0
        ? `พบความผิดปกติระดับวิกฤต ${critical} รายการ ต้องตรวจสอบทันที`
        : active.length > 0
          ? `พบความผิดปกติ ${active.length} รายการ ยังไม่ถึงระดับวิกฤต`
          : 'ไม่พบความผิดปกติในช่วงที่ผ่านมา';

  return {
    reachable: enabled,
    lastResultAt: state.anomalies[0]?.detectedAt ?? null,
    models: [state.settings.ai.forecastModelName, state.settings.ai.anomalyModelName],
    message: null,
    mode: enabled ? 'live' : 'degraded',
    // ฝึกโมเดลรอบล่าสุดตามรอบที่ตั้งไว้ใน settings
    lastTrainedAt: nowIso(Date.now() - state.settings.ai.retrainIntervalHours * 3_600_000),
    trainingDays: 90,
    accuracy: 0.94,
    falsePositiveRate: 0.06,
    summaryText,
  };
}

/**
 * ผลพยากรณ์หลายรายการที่ทีม AI ส่งมาในรอบเดียว
 * แต่ละรายการมี target ของตัวเอง หน้าจอจึงจัดกลุ่มตาม target ได้
 */
export function buildForecasts(state: MockState): AIForecast[] {
  // เลือกเป้าหมายที่มีความหมายกับคนดูจริง: ถังที่ต้องเฝ้า และการใช้น้ำรวม
  const targets: { target: string; targetId: string | null }[] = [
    { target: 'tank_level', targetId: 'tank-1' },
    { target: 'tank_level', targetId: 'tank-2' },
    { target: 'main_meter', targetId: null },
    ...state.zones
      .filter((zone) => zone.monthCubicMeters > 0)
      .slice(0, 2)
      .map((zone) => ({ target: 'zone_consumption', targetId: zone.id })),
  ];

  return targets.map((entry) => {
    const forecast = buildForecast(state, entry.target, entry.targetId);
    const horizonHours = forecast.horizonHours ?? 24;
    return {
      ...forecast,
      horizon: horizonHours >= 168 ? '7d' : horizonHours >= 24 ? '24h' : `${horizonHours}h`,
      confidence: roundTo(0.72 + (entry.target === 'tank_level' ? 0.14 : 0.06), 2),
    };
  });
}
