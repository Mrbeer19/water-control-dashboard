/**
 * Service: ผลลัพธ์จากทีม AI — ★ ทางเข้าเดียวของทุกอย่างที่เกี่ยวกับ AI
 *
 * หน้าบ้านแสดงผลอย่างเดียว ไม่มีตรรกะตรวจจับหรือพยากรณ์อยู่ในฝั่งนี้เลย
 * ถ้าจะเปลี่ยนว่า "ตรวจอะไร/พยากรณ์อะไร" ต้องคุยกับทีม AI และแก้ docs/AI_CONTRACT.md
 *
 * ทุกฟังก์ชันต้องทนกับผลที่มาไม่ครบ — คืนตามที่ได้รับมาจริง ห้ามเติมค่าปลอมแทนของที่ขาด
 */

import type {
  AIForecast,
  AIServiceStatus,
  AIStatus,
  AnomalyEvent,
  AnomalyQuery,
  HealthScore,
  MaintenancePrediction,
  MockScenario,
  Prediction,
  PredictionKind,
} from '@/lib/types';
import type { Paginated } from '@/lib/types';
import { buildAnomalies, buildForecast, buildMaintenancePredictions, buildServiceStatus } from '@/lib/mock';
import { mutate, respond } from './internal';

/**
 * รายการความผิดปกติที่ทีม AI ตรวจพบ
 *
 * ★ ตัวกรอง type/detector เป็น string เปิด — หน้าบ้านต้องไม่ปฏิเสธชนิดที่ไม่รู้จัก
 *
 * TODO(backend): GET /api/ai/anomalies?type=&detector=&severity=&minScore=&from=&to=&limit=&offset=
 *   ส่งต่อจากบริการของทีม AI บน gateway ตามรูปแบบใน docs/AI_CONTRACT.md
 */
export async function getAnomalies(query: AnomalyQuery = {}): Promise<Paginated<AnomalyEvent>> {
  return respond((state) => {
    const filtered = state.anomalies.filter((anomaly) => {
      if (query.types !== undefined && !query.types.includes(anomaly.type)) return false;
      if (query.detectors !== undefined) {
        if (anomaly.detector === undefined || !query.detectors.includes(anomaly.detector)) return false;
      }
      // ผลที่ไม่ได้ระบุ severity/score ต้องไม่ถูกกรองทิ้งไปเงียบ ๆ
      if (query.severities !== undefined && anomaly.severity !== undefined) {
        if (!query.severities.includes(anomaly.severity)) return false;
      }
      if (query.sourceTypes !== undefined && anomaly.sourceType !== undefined) {
        if (!query.sourceTypes.includes(anomaly.sourceType)) return false;
      }
      if (query.minScore !== undefined && anomaly.score !== undefined && anomaly.score < query.minScore) {
        return false;
      }
      if (query.range !== undefined) {
        const detected = new Date(anomaly.detectedAt).getTime();
        if (detected < new Date(query.range.from).getTime() || detected > new Date(query.range.to).getTime()) {
          return false;
        }
      }
      return true;
    });

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    return { items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset };
  });
}

/**
 * TODO(backend): GET /api/ai/anomalies/:id
 */
export async function getAnomaly(id: string): Promise<AnomalyEvent | null> {
  return respond((state) => state.anomalies.find((anomaly) => anomaly.id === id) ?? null);
}

/**
 * ผลพยากรณ์
 * target เป็น string เปิด ทีม AI เพิ่มชนิดใหม่ได้โดยไม่ต้องแก้หน้าบ้าน
 *
 * TODO(backend): GET /api/ai/forecast?target=&targetId=&horizon=
 */
export async function getForecast(target: string, targetId: string | null = null): Promise<AIForecast> {
  return respond((state) => buildForecast(state, target, targetId));
}

/**
 * คำแนะนำการบำรุงรักษาเชิงพยากรณ์
 * TODO(backend): GET /api/ai/maintenance?targetType=&targetId=
 */
export async function getMaintenancePredictions(): Promise<MaintenancePrediction[]> {
  return respond((state) => buildMaintenancePredictions(state, state.scenario));
}

/**
 * สถานะบริการ AI บน gateway — ใช้บอกผู้ใช้เมื่อผลยังไม่มาแทนที่จะโชว์หน้าว่าง
 * TODO(backend): GET /api/ai/status
 */
export async function getAIServiceStatus(): Promise<AIServiceStatus> {
  return respond((state) => buildServiceStatus(state));
}


// ─────────────────────────────────────────────────────────────
// Phase 4.5 — ยังเป็น stub รอทีม AI ต่อของจริง
//
// ★ ทั้งสามฟังก์ชันคืนค่าว่างโดยตั้งใจ ไม่ใช่ค่าจำลอง
//   หน้าจอที่เรียกต้องแสดง empty state ว่า "ยังไม่มีผลจากทีม AI"
//   ห้ามเติมข้อมูลปลอมมากลบ เพราะจะแยกไม่ออกว่าผลยังไม่มาหรือไม่มีอะไรผิดปกติ
// ─────────────────────────────────────────────────────────────

/**
 * ผลพยากรณ์ทุกชนิดจากทีม AI
 * kind เป็น string เปิด — ไม่ส่งมาคือเอาทุกชนิด
 *
 * TODO(backend): GET /api/ai/predictions?kind=&targetType=&targetId=&horizon=
 *   ส่งต่อจากบริการของทีม AI บน gateway ตามรูปแบบ Prediction ใน docs/AI_CONTRACT.md
 */
export async function getPredictions(kind?: PredictionKind, targetId?: string): Promise<Prediction[]> {
  // ตั้งใจอ้างพารามิเตอร์ไว้ให้ signature คงที่ตอนต่อของจริง
  void kind;
  void targetId;
  return respond(() => [] as Prediction[]);
}

/**
 * คะแนนสุขภาพอุปกรณ์
 * TODO(backend): GET /api/ai/health-scores?targetType=&targetId=
 */
export async function getHealthScores(targetType?: string): Promise<HealthScore[]> {
  void targetType;
  return respond(() => [] as HealthScore[]);
}

/**
 * สถานะบริการ AI บน gateway
 * ตอนนี้ยังไม่ได้ต่อ จึงรายงานว่า offline ตรง ๆ แทนการเดาว่าออนไลน์
 *
 * TODO(backend): GET /api/ai/status
 */
export async function getAIStatus(): Promise<AIStatus> {
  return respond(() => ({
    online: false,
    checkedAt: new Date().toISOString(),
    modules: {},
    models: [],
    lastResultAt: null,
    messageTh: 'ยังไม่ได้เชื่อมต่อบริการ AI',
    messageEn: 'AI service is not connected yet',
  }));
}

// ─────────────────────────────────────────────────────────────
// สถานการณ์สาธิต — มีเฉพาะตอนใช้ mock ไม่มี endpoint จริงรองรับ
// ─────────────────────────────────────────────────────────────

/** สถานการณ์ที่เลือกอยู่ตอนนี้ */
export async function getScenario(): Promise<MockScenario> {
  return respond((state) => state.scenario);
}

/**
 * สลับสถานการณ์สาธิต แล้วโหลดชุดผล AI ของสถานการณ์นั้นใหม่ทั้งชุด
 * ★ ไม่มี TODO(backend) เพราะเมื่อต่อของจริงต้องลบทิ้ง — ของจริงไม่มีปุ่มสลับสถานการณ์
 */
export async function setScenario(scenario: MockScenario): Promise<MockScenario> {
  return mutate((state) => {
    state.scenario = scenario;
    state.anomalies = buildAnomalies(state, scenario);
    return state.scenario;
  });
}

/** ตัวเลือกทั้งหมดพร้อมคำอธิบาย สำหรับ dropdown บนหน้า AI */
export const SCENARIO_OPTIONS: { value: MockScenario; labelTh: string; labelEn: string }[] = [
  { value: 'normal', labelTh: 'เดินปกติ', labelEn: 'Normal operation' },
  { value: 'night_leak', labelTh: 'น้ำรั่วกลางคืน', labelEn: 'Night-time leak' },
  { value: 'pump_degrading', labelTh: 'ปั๊มเสื่อมสภาพ', labelEn: 'Pump degrading' },
];
