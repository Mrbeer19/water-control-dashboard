'use client';

import { useRouter } from 'next/navigation';
import { Droplet, Thermometer } from 'lucide-react';
import type {
  AnomalyEvent,
  EnvironmentSensor,
  MainMeter,
  Pump,
  Tank,
  Valve,
  Zone,
} from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { formatFlow, formatPercent, formatPower, formatTemperature } from '@/lib/utils';
import { DiagramNode, Pipe } from './diagram-primitives';

export interface FlowDiagramData {
  tanks: Tank[];
  pumps: Pump[];
  zones: Zone[];
  valves: Valve[];
  mainMeter: MainMeter;
  sensors: EnvironmentSensor[];
  anomalies: AnomalyEvent[];
}

const W = 1240;
const H = 720;

/**
 * แผนผังการไหลของน้ำทั้งระบบ — SVG เขียนมือ ไม่ใช้ไลบรารีวาดผัง
 *
 * เส้นทาง: การประปา → มิเตอร์หลัก → ถังใต้ดิน → ปั๊ม → วาล์ว 8 โซน → มิเตอร์โซน
 *          และแยกไปบ่อสำรอง กับถังจ่ายที่เลี้ยงปั๊ม VIP
 */
export function FlowDiagram({ data }: { data: FlowDiagramData }): JSX.Element {
  const { t, locale } = useLocale();
  const router = useRouter();

  const tank1 = data.tanks.find((tank) => tank.id === 'tank-1');
  const tank2 = data.tanks.find((tank) => tank.id === 'tank-2');
  const tank3 = data.tanks.find((tank) => tank.id === 'tank-3');
  const mainPumps = data.pumps.filter((pump) => pump.role === 'main');
  const vipPump = data.pumps.find((pump) => pump.role === 'vip');

  /** true เมื่อ AI แจ้งว่าอุปกรณ์ตัวนี้ผิดปกติ */
  const flagged = (id: string): boolean => data.anomalies.some((anomaly) => anomaly.sourceId === id);

  const openDevice = (deviceId: string | null): void => {
    router.push(deviceId === null ? '/devices' : `/devices?device=${deviceId}`);
  };

  const zoneRows = data.zones.map((zone, index) => ({
    zone,
    valve: data.valves.find((valve) => valve.id === zone.valveId) ?? null,
    y: 24 + index * 76,
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[900px]" role="img" aria-label={t.diagram.title}>
      {/* ── ท่อ ── */}
      {/* การประปา → มิเตอร์หลัก → แยกสองทาง */}
      <Pipe d="M150 92 H206" flowLpm={data.mainMeter.flowLpm} />
      <Pipe d="M322 92 H362" flowLpm={data.mainMeter.flowLpm} />
      {/* มิเตอร์หลัก → ถังใต้ดิน (85%) */}
      <Pipe d="M362 92 H392" flowLpm={data.mainMeter.flowLpm * 0.85} />
      {/* มิเตอร์หลัก → บ่อสำรอง (15%) */}
      <Pipe d="M362 92 V286 H392" flowLpm={data.mainMeter.flowLpm * 0.15} />

      {/* ถังใต้ดิน → ปั๊มหลัก */}
      <Pipe d="M512 78 H556" flowLpm={mainPumps[0]?.flowLpm ?? 0} />
      <Pipe d="M512 110 H540 V166 H556" flowLpm={mainPumps[1]?.flowLpm ?? 0} />
      {/* ถังใต้ดิน → ถังจ่าย (สายถ่ายน้ำขึ้นดาดฟ้า) */}
      <Pipe d="M512 132 H534 V330 H556" flowLpm={tank2?.inflowLpm ?? 0} />
      {/* ถังจ่าย → ปั๊ม VIP */}
      <Pipe d="M676 330 H712" flowLpm={vipPump?.flowLpm ?? 0} />

      {/* ปั๊มหลัก → ท่อรวมจ่ายโซน */}
      <Pipe d="M676 78 H860" flowLpm={mainPumps[0]?.flowLpm ?? 0} />
      <Pipe d="M676 166 H820 V78" flowLpm={mainPumps[1]?.flowLpm ?? 0} />
      {/* ปั๊ม VIP → โซน 8 (แยกสายไม่รวมกับท่อหลัก) */}
      <Pipe d="M832 330 H860 V556" flowLpm={vipPump?.flowLpm ?? 0} />

      {/* ท่อรวม → แต่ละวาล์ว */}
      {zoneRows.map(({ zone, y }) => (
        <Pipe
          key={`pipe-${zone.id}`}
          d={`M860 ${zone.isVip ? 556 : 78} V${y + 26} H906`}
          flowLpm={zone.flowLpm}
          width={4}
        />
      ))}
      {/* วาล์ว → มิเตอร์โซน */}
      {zoneRows.map(({ zone, y }) => (
        <Pipe key={`pipe2-${zone.id}`} d={`M1006 ${y + 26} H1046`} flowLpm={zone.flowLpm} width={4} />
      ))}

      {/* ── อุปกรณ์ ── */}
      <DiagramNode
        x={40}
        y={62}
        width={110}
        height={60}
        status="ok"
        label={t.diagram.utility}
        value={`${data.mainMeter.pipeSizeInches}"`}
        sub={locale === 'th' ? data.mainMeter.supplierName : data.mainMeter.supplierNameEn}
        ariaLabel={t.diagram.utility}
      />

      <DiagramNode
        x={206}
        y={62}
        width={116}
        height={60}
        status={data.mainMeter.status}
        label={t.overview.mainMeter}
        value={formatFlow(data.mainMeter.flowLpm, locale, 0)}
        sub={`${data.mainMeter.monthCubicMeters.toFixed(0)} m³`}
        anomaly={flagged(data.mainMeter.id)}
        onClick={() => {
          openDevice(data.mainMeter.deviceId);
        }}
        ariaLabel={locale === 'th' ? data.mainMeter.name : data.mainMeter.nameEn}
      />

      {tank1 !== undefined && (
        <DiagramNode
          x={392}
          y={40}
          width={120}
          height={112}
          status={tank1.status}
          label={locale === 'th' ? tank1.name : tank1.nameEn}
          value={formatPercent(tank1.percentFull, locale, 1)}
          sub={`${(tank1.currentLiters / 1000).toFixed(1)}k / ${(tank1.capacityLiters / 1000).toFixed(0)}k L`}
          anomaly={flagged(tank1.id)}
          onClick={() => {
            openDevice(tank1.deviceId);
          }}
          ariaLabel={tank1.nameEn}
        />
      )}

      {tank3 !== undefined && (
        <DiagramNode
          x={392}
          y={256}
          width={120}
          height={86}
          status={tank3.status}
          label={locale === 'th' ? tank3.name : tank3.nameEn}
          value={formatPercent(tank3.percentFull, locale, 1)}
          sub={`${(tank3.currentLiters / 1000).toFixed(0)}k / 490k L`}
          anomaly={flagged(tank3.id)}
          onClick={() => {
            openDevice(tank3.deviceId);
          }}
          ariaLabel={tank3.nameEn}
        />
      )}

      {tank2 !== undefined && (
        <DiagramNode
          x={556}
          y={300}
          width={120}
          height={60}
          status={tank2.status}
          label={locale === 'th' ? tank2.name : tank2.nameEn}
          value={formatPercent(tank2.percentFull, locale, 1)}
          sub={`${tank2.currentLiters.toFixed(0)} / 3,000 L`}
          anomaly={flagged(tank2.id)}
          onClick={() => {
            openDevice(tank2.deviceId);
          }}
          ariaLabel={tank2.nameEn}
        />
      )}

      {mainPumps.map((pump, index) => (
        <DiagramNode
          key={pump.id}
          x={556}
          y={index === 0 ? 50 : 138}
          width={120}
          height={56}
          status={pump.runState === 'fault' ? 'critical' : pump.runState === 'running' ? 'ok' : 'offline'}
          label={locale === 'th' ? pump.name : pump.nameEn}
          value={formatPower(pump.electrical.powerWatt, locale)}
          sub={formatFlow(pump.flowLpm, locale, 0)}
          anomaly={flagged(pump.id)}
          onClick={() => {
            router.push('/control');
          }}
          ariaLabel={pump.nameEn}
        />
      ))}

      {vipPump !== undefined && (
        <DiagramNode
          x={712}
          y={302}
          width={120}
          height={56}
          status={vipPump.runState === 'fault' ? 'critical' : vipPump.runState === 'running' ? 'ok' : 'offline'}
          label={locale === 'th' ? vipPump.name : vipPump.nameEn}
          value={formatPower(vipPump.electrical.powerWatt, locale)}
          sub={vipPump.vfdFrequencyHz === null ? undefined : `${vipPump.vfdFrequencyHz.toFixed(1)} Hz`}
          anomaly={flagged(vipPump.id)}
          onClick={() => {
            router.push('/control');
          }}
          ariaLabel={vipPump.nameEn}
        />
      )}

      {/* วาล์ว + มิเตอร์ 8 โซน */}
      {zoneRows.map(({ zone, valve, y }) => (
        <g key={zone.id}>
          <DiagramNode
            x={906}
            y={y}
            width={100}
            height={52}
            status={valve === null ? 'offline' : valve.position === 'fault' ? 'critical' : valve.openPercent > 0 ? 'ok' : 'offline'}
            label={`V${zone.zoneNumber}`}
            value={`${valve?.openPercent ?? 0}%`}
            anomaly={valve !== null && flagged(valve.id)}
            onClick={() => {
              router.push('/control');
            }}
            ariaLabel={valve?.nameEn ?? `valve zone ${zone.zoneNumber}`}
          />
          <DiagramNode
            x={1046}
            y={y}
            width={168}
            height={52}
            status={zone.status}
            label={locale === 'th' ? zone.name : zone.nameEn}
            value={formatFlow(zone.flowLpm, locale, 1)}
            sub={`${zone.todayCubicMeters.toFixed(1)} m³ ${t.zone.today}`}
            anomaly={flagged(zone.id)}
            onClick={() => {
              openDevice(null);
            }}
            ariaLabel={zone.nameEn}
          />
        </g>
      ))}

      {/* เซนเซอร์สภาพแวดล้อมซ้อนที่ห้องปั๊มและตู้คอนโทรล */}
      {data.sensors
        .filter((sensor) => sensor.location !== 'outdoor')
        .map((sensor, index) => (
          <g
            key={sensor.id}
            transform={`translate(${556 + index * 150} ${400})`}
            role="button"
            tabIndex={0}
            aria-label={sensor.nameEn}
            className="cursor-pointer outline-none"
            onClick={() => {
              openDevice(sensor.deviceId);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openDevice(sensor.deviceId);
              }
            }}
          >
            <rect width={140} height={44} rx={8} strokeWidth={1.5} className="fill-secondary stroke-border" />
            <foreignObject x={7} y={9} width={16} height={16}>
              {/* ไอคอนบอกชนิดค่าที่วัด ไม่ใช่สถานะ จึงไม่ใช้สีสถานะ (ข้อ 3.3) */}
              <Thermometer className="h-4 w-4 text-muted-foreground" aria-hidden />
            </foreignObject>
            <foreignObject x={7} y={25} width={16} height={16}>
              <Droplet className="h-4 w-4 text-water" aria-hidden />
            </foreignObject>
            <text x={28} y={21} className="tabular fill-foreground text-[11px] font-semibold">
              {formatTemperature(sensor.latest.temperatureCelsius, locale)}
            </text>
            <text x={28} y={37} className="tabular fill-muted-foreground text-[10px]">
              {formatPercent(sensor.latest.humidityPercent, locale, 0)} RH
            </text>
            <text x={82} y={21} className="fill-muted-foreground text-[9px]">
              {locale === 'th' ? sensor.locationLabel : sensor.locationLabelEn}
            </text>
          </g>
        ))}

      {/* ── เส้นทางข้อมูล ── */}
      <DataPath y={620} />
    </svg>
  );
}

/**
 * เส้นทางข้อมูล ESP32 → MQTT → เซิร์ฟเวอร์ → แดชบอร์ด
 * จุดไฟวิ่งไปตามเส้นเพื่อบอกว่ามี message ไหลอยู่จริง ไม่ใช่ผังนิ่ง ๆ
 */
function DataPath({ y }: { y: number }): JSX.Element {
  const { t } = useLocale();
  const stops = [
    { x: 40, label: 'ESP32' },
    { x: 320, label: 'MQTT' },
    { x: 600, label: t.diagram.server },
    { x: 880, label: t.diagram.dashboard },
  ];

  return (
    <g transform={`translate(0 ${y})`}>
      <text x={40} y={-14} className="fill-muted-foreground text-[10px] font-medium">
        {t.diagram.dataPath}
      </text>
      <line x1={70} x2={910} y1={20} y2={20} strokeWidth={2} strokeDasharray="4 4" className="stroke-border" />

      {stops.slice(0, -1).map((stop, index) => (
        <circle
          key={stop.label}
          cx={stop.x + 30}
          cy={20}
          r={4}
          className="data-pulse fill-water"
          style={{ ['--data-distance' as string]: '280px', animationDelay: `${index * 0.45}s` }}
        />
      ))}

      {stops.map((stop) => (
        <g key={stop.label} transform={`translate(${stop.x} 0)`}>
          <rect width={60} height={40} rx={6} strokeWidth={1.5} className="fill-card stroke-border" />
          <text x={30} y={24} textAnchor="middle" className="fill-foreground text-[10px] font-medium">
            {stop.label}
          </text>
        </g>
      ))}
    </g>
  );
}
