// ============================================================================
// 暴雨前有限运力 · 首轮可执行安排（本题 93-feature-5）核心领域逻辑
// ----------------------------------------------------------------------------
// 纯 TS、无 React / IndexedDB 依赖，便于 vitest 直接校验全部给定数值。
// 时间统一为“自当日 00:00 起的分钟数”（09:20 = 560，10:00 = 600）。
//
// 题目固定数值：
//  - 当前 09:20；10:00 起停止站点装运，10:00 仍未完成即不合规（到站不算完成）
//  - 车辆当前可用余量 1.0t（演示车取额定 2.0t / 在载 1.0t）
//  - H 医院站：容器 1.0t，估计满溢 80%–95% = 0.80–0.95t，截止 10:00
//  - R 普通街区：容器 0.7t，估计满溢 95%–100% = 0.665–0.70t，截止 09:50
//  - 两站传感器当前均缺报；区间来自前一日实称 + 最近有效读数的带时间估计
//  - 现位→H 12 分、→R 8 分；两站清运均 8 分
//  - H/R→U 10 分，U 卸 5 分（本例无排队），U→另一站 10 分，再清运 8 分
// ============================================================================

import { fmtMin } from '../types';

export { fmtMin };

export const EPS = 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const NOW_MIN = 9 * 60 + 20; // 560 = 09:20
export const WEATHER_CUTOFF_MIN = 10 * 60; // 600 = 10:00 停止站点装运
export const UNLOAD_MIN = 5;
export const NO_QUEUE_MIN = 0;

/** 本题选定的自动建议准则（不提供两个策略切换按钮，只在界面解释另一准则） */
export const CHOSEN_POLICY: SortPolicy = 'fullness-upper';

export type SortPolicy = 'fullness-upper' | 'service-level';
export type ServiceLevel = 'hospital' | 'ordinary';
export type NodeId = 'POS' | 'H' | 'R' | 'U';
export type StationStatus =
  | 'pending'      // 待安排
  | 'tasked'       // 已列入本窗口确认任务
  | 'arrived'      // 司机已到站
  | 'scanned'      // 已扫码
  | 'completed'    // 已清运完成（唯一合规的“已清”）
  | 'rejected';    // 实称超限，停收

export interface EstimateInterval {
  fullnessLowPct: number;
  fullnessHighPct: number; // 满溢率上界：自动排序主键
  tonLow: number;
  tonHigh: number;         // 吨位上界：只用于容量判断，不参与满溢排序
  revised: boolean;
  revisionNote?: string;
}

export interface SensorReading {
  id: string;
  sampleAtMin: number;    // 采样时刻（数据时间）
  receivedAtMin: number;  // 到达平台时刻
  fullnessPct: number;
  kind: 'last-valid' | 'backfill-late';
  stale?: boolean;        // 采样时间早于已采用的最近有效读数
  note?: string;
}

export interface SensorState {
  reportingNow: boolean;       // 当前是否有实时上报（本题初始 false=缺报）
  missingSinceMin?: number;
  lastValidSampleAtMin: number;
  lastValidFullnessPct: number;
  prevDayActualText: string;   // 前一日实称来源
  sourceSummary: string;       // 区间来源完整说明
  readings: SensorReading[];
}

export interface RainStation {
  id: string;
  code: string;
  name: string;
  level: ServiceLevel;
  levelLabel: string;
  containerCapTon: number;
  deadlineMin: number;
  serviceMin: number;
  posTravelMin: number; // 当前位置直达该站
  toUTravelMin: number; // 该站 → U
  fromUTravelMin: number; // U → 该站
  estimate: EstimateInterval;
  sensor: SensorState;
  status: StationStatus;
  actualTon?: number;
  completedAtMin?: number;
  rejectReason?: string;
}

export interface RainVehicle {
  id: string;
  name: string;
  plate: string;
  capacityTon: number;
  loadTon: number;
}

export interface LogEntry {
  id: number;
  atMin: number;
  actor: string;
  type: string;
  message: string;
  tone?: 'info' | 'ok' | 'warn' | 'bad';
}

export interface PublishedTask {
  stationId: string;
  mode: 'auto' | 'manual';
  policy: SortPolicy;
  manualReason?: string;
  publishedAtMin: number;
  basisRev: number;
  status: 'active' | 'invalid' | 'replanned' | 'done';
}

export interface RainState {
  nowMin: number;
  basisRev: number; // 输入修订版本：任何估计/截止/补报变化都 +1，强制确认前重核
  windowAckRev: number | null;
  estimateAckRev: number | null;
  manualId: string | null; // null = 采用自动建议
  manualReason: string;
  vehicle: RainVehicle;
  node: NodeId;
  driverPhase: 'waiting' | 'at-station' | 'scanned' | 'done-station' | 'at-u' | 'empty-confirmed';
  stations: RainStation[];
  task: PublishedTask | null;
  logs: LogEntry[];
  nextLogId: number;
  evacAck: boolean;
  handoverAck: boolean;
  replanCount: number;
}

// ----------------------------------------------------------------------------
// 种子数据（题目固定现场，09:20）
// ----------------------------------------------------------------------------

export function initialRainState(): RainState {
  const stations: RainStation[] = [
    {
      id: 'H',
      code: 'H',
      name: '医院站',
      level: 'hospital',
      levelLabel: '医院 / 敏感服务等级',
      containerCapTon: 1.0,
      deadlineMin: 10 * 60, // 10:00
      serviceMin: 8,
      posTravelMin: 12,
      toUTravelMin: 10,
      fromUTravelMin: 10,
      estimate: {
        fullnessLowPct: 80,
        fullnessHighPct: 95,
        tonLow: 0.8,
        tonHigh: 0.95,
        revised: false,
      },
      sensor: {
        reportingNow: false,
        missingSinceMin: 9 * 60 + 5, // 09:05
        lastValidSampleAtMin: 8 * 60 + 40, // 08:40
        lastValidFullnessPct: 88,
        prevDayActualText: '前一日同时段实称 0.82t / 0.89t',
        sourceSummary:
          '传感器当前缺报（自 09:05 起无上报）；0.80–0.95t（满溢 80%–95%）由前一日实称 0.82–0.89t 与最近一次有效读数（08:40，88%）做带时间外推形成。属区间估计，不是 0，也不是当前实测。',
        readings: [
          {
            id: 'H-LV1',
            sampleAtMin: 8 * 60 + 40,
            receivedAtMin: 8 * 60 + 41,
            fullnessPct: 88,
            kind: 'last-valid',
            note: '最近一次有效读数',
          },
        ],
      },
      status: 'pending',
    },
    {
      id: 'R',
      code: 'R',
      name: '普通街区站',
      level: 'ordinary',
      levelLabel: '普通街区 / 常规服务等级',
      containerCapTon: 0.7,
      deadlineMin: 9 * 60 + 50, // 09:50
      serviceMin: 8,
      posTravelMin: 8,
      toUTravelMin: 10,
      fromUTravelMin: 10,
      estimate: {
        fullnessLowPct: 95,
        fullnessHighPct: 100,
        tonLow: 0.665,
        tonHigh: 0.7,
        revised: false,
      },
      sensor: {
        reportingNow: false,
        missingSinceMin: 9 * 60 + 2, // 09:02
        lastValidSampleAtMin: 8 * 60 + 52, // 08:52
        lastValidFullnessPct: 96,
        prevDayActualText: '前一日同时段实称 0.66t / 0.69t',
        sourceSummary:
          '传感器当前缺报（自 09:02 起无上报）；0.665–0.70t（满溢 95%–100%）由前一日实称 0.66–0.69t 与最近一次有效读数（08:52，96%）做带时间外推形成。属区间估计，不是 0，也不是当前实测。',
        readings: [
          {
            id: 'R-LV1',
            sampleAtMin: 8 * 60 + 52,
            receivedAtMin: 8 * 60 + 53,
            fullnessPct: 96,
            kind: 'last-valid',
            note: '最近一次有效读数',
          },
        ],
      },
      status: 'pending',
    },
  ];

  const state: RainState = {
    nowMin: NOW_MIN,
    basisRev: 0,
    windowAckRev: null,
    estimateAckRev: null,
    manualId: null,
    manualReason: '',
    // 题目只指定“可用余量 1t”。演示车取额定 2.0t、早班在载 1.0t，
    // 这样“当前载重 / 余量 / 卸空恢复”都可被直接观察。
    vehicle: {
      id: 'V-YJ1',
      name: '暴雨应急清运车',
      plate: '京A·D0920',
      capacityTon: 2.0,
      loadTon: 1.0,
    },
    node: 'POS',
    driverPhase: 'waiting',
    stations,
    task: null,
    logs: [],
    nextLogId: 1,
    evacAck: false,
    handoverAck: false,
    replanCount: 0,
  };
  state.logs = [
    makeLog(state, '系统', 'init', '09:20 现场建立：暴雨预警，10:00 起停止站点装运；H/R 传感器均缺报。', 'warn'),
  ];
  return state;
}

function makeLog(
  s: RainState,
  actor: string,
  type: string,
  message: string,
  tone: LogEntry['tone'] = 'info',
): LogEntry {
  return { id: s.nextLogId, atMin: s.nowMin, actor, type, message, tone };
}

// ----------------------------------------------------------------------------
// 基础选择器
// ----------------------------------------------------------------------------

export const isPostCutoff = (nowMin: number) => nowMin >= WEATHER_CUTOFF_MIN;

export function remainingTon(v: RainVehicle): number {
  return r3(v.capacityTon - v.loadTon);
}

/** 合规截止 = 站截止 与 天气 10:00 停止装运 的较早者 */
export function effectiveDeadline(st: RainStation): number {
  return Math.min(st.deadlineMin, WEATHER_CUTOFF_MIN);
}

export function getStation(s: RainState, id: string | null | undefined): RainStation | undefined {
  return s.stations.find((x) => x.id === id);
}

// ----------------------------------------------------------------------------
// 首站可行性 + 逐步时刻推演
// ----------------------------------------------------------------------------

export interface TimedStep {
  label: string;
  atMin: number;
  note?: string;
  bad?: boolean;
  ok?: boolean;
}

export interface Violation {
  code: 'time' | 'capacity';
  message: string;
}

export interface FirstStopEval {
  stationId: string;
  startMin: number;
  arriveMin: number;
  completeMin: number;
  deadlineMin: number;
  effectiveDeadlineMin: number;
  lateByMin: number; // 相对有效截止
  timeOk: boolean;
  remainingTon: number;
  estTonHigh: number;
  loadAfterHighTon: number;
  capacityOverTon: number; // >0 表示上界估计下装不下
  capacityOk: boolean;
  feasible: boolean;
  violations: Violation[];
  steps: TimedStep[];
}

export function evalFirstStop(st: RainStation, v: RainVehicle, nowMin: number): FirstStopEval {
  const arriveMin = nowMin + st.posTravelMin;
  const completeMin = arriveMin + st.serviceMin;
  const deadlineEff = effectiveDeadline(st);
  const lateByMin = Math.max(0, completeMin - deadlineEff);
  const timeOk = completeMin <= deadlineEff + EPS;

  const remain = remainingTon(v);
  const loadAfterHigh = r3(v.loadTon + st.estimate.tonHigh);
  const capacityOver = r3(Math.max(0, st.estimate.tonHigh - remain));
  const capacityOk = st.estimate.tonHigh <= remain + EPS;

  const violations: Violation[] = [];
  if (!timeOk) {
    violations.push({
      code: 'time',
      message: `最早 ${fmtMin(completeMin)} 才能完成清运，晚于${st.name}有效截止 ${fmtMin(deadlineEff)} 共 ${completeMin - deadlineEff} 分钟（${fmtMin(arriveMin)} 赶到不算完成）`,
    });
  }
  if (!capacityOk) {
    violations.push({
      code: 'capacity',
      message: `估计吨位上界 ${st.estimate.tonHigh.toFixed(2)}t 超过当前可用余量 ${remain.toFixed(2)}t（缺口 ${capacityOver.toFixed(2)}t），本车无法合法承运`,
    });
  }

  const steps: TimedStep[] = [
    { label: '当前位置出发', atMin: nowMin },
    { label: `行驶 ${st.posTravelMin} 分钟到达${st.code}（赶到不等于完成）`, atMin: arriveMin },
    {
      label: `扫码·称重·装载作业 ${st.serviceMin} 分钟，清运完成`,
      atMin: completeMin,
      ok: timeOk,
      bad: !timeOk,
      note: timeOk
        ? `不晚于有效截止 ${fmtMin(deadlineEff)}${completeMin === deadlineEff ? '，恰在截止时刻，算合规' : ''}`
        : `晚于有效截止 ${fmtMin(deadlineEff)} ${completeMin - deadlineEff} 分钟，不合规`,
    },
  ];

  return {
    stationId: st.id,
    startMin: nowMin,
    arriveMin,
    completeMin,
    deadlineMin: st.deadlineMin,
    effectiveDeadlineMin: deadlineEff,
    lateByMin,
    timeOk,
    remainingTon: remain,
    estTonHigh: st.estimate.tonHigh,
    loadAfterHighTon: loadAfterHigh,
    capacityOverTon: capacityOver,
    capacityOk,
    feasible: timeOk && capacityOk,
    violations,
    steps,
  };
}

// ----------------------------------------------------------------------------
// 装完首站 → U 卸空 → 第二站 的推演（题目给定 10:09 / 10:13）
// ----------------------------------------------------------------------------

export interface SecondLegEval {
  firstId: string;
  secondId: string;
  minCombinedTon: number;
  remainingTon: number;
  mustUnload: boolean;
  firstCompleteMin: number;
  arriveUMin: number;
  unloadStartMin: number;
  emptyConfirmedMin: number;
  arriveSecondMin: number;
  secondCompleteMin: number;
  secondDeadlineMin: number;
  lateByMin: number; // 相对站点自身截止（题目要求“忽略天气限制”也已晚）
  feasible: boolean;
  steps: TimedStep[];
}

export function evalSecondLeg(
  first: RainStation,
  second: RainStation,
  v: RainVehicle,
  nowMin: number,
): SecondLegEval {
  const f = evalFirstStop(first, v, nowMin);
  const firstCompleteMin = f.completeMin;
  const arriveUMin = firstCompleteMin + first.toUTravelMin;
  const unloadStartMin = arriveUMin; // 本例无排队
  const emptyConfirmedMin = unloadStartMin + NO_QUEUE_MIN + UNLOAD_MIN;
  const arriveSecondMin = emptyConfirmedMin + second.fromUTravelMin;
  const secondCompleteMin = arriveSecondMin + second.serviceMin;
  const lateByMin = Math.max(0, secondCompleteMin - second.deadlineMin);

  const minCombinedTon = r3(first.estimate.tonLow + second.estimate.tonLow);
  const mustUnload = minCombinedTon > remainingTon(v) + EPS;

  const steps: TimedStep[] = [
    { label: `${first.code} 首站清运完成`, atMin: firstCompleteMin, ok: true },
    { label: `${first.code}→U 行驶 ${first.toUTravelMin} 分钟`, atMin: arriveUMin },
    { label: `U 卸载 ${UNLOAD_MIN} 分钟（无排队）`, atMin: emptyConfirmedMin },
    { label: '确认卸空，余量才恢复（计划到 U 不释放载重）', atMin: emptyConfirmedMin, ok: true },
    { label: `U→${second.code} 行驶 ${second.fromUTravelMin} 分钟`, atMin: arriveSecondMin },
    {
      label: `${second.code} 再作业 ${second.serviceMin} 分钟完成`,
      atMin: secondCompleteMin,
      bad: lateByMin > 0,
      note:
        lateByMin > 0
          ? `忽略 10:00 天气限制，仍晚于${second.code}截止 ${fmtMin(second.deadlineMin)} 共 ${lateByMin} 分钟`
          : `不晚于${second.code}截止 ${fmtMin(second.deadlineMin)}`,
    },
  ];

  return {
    firstId: first.id,
    secondId: second.id,
    minCombinedTon,
    remainingTon: remainingTon(v),
    mustUnload,
    firstCompleteMin,
    arriveUMin,
    unloadStartMin,
    emptyConfirmedMin,
    arriveSecondMin,
    secondCompleteMin,
    secondDeadlineMin: second.deadlineMin,
    lateByMin,
    feasible: lateByMin === 0,
    steps,
  };
}

/** 实称超限后，本车“先去 U 卸空再折返该站”的补救推演（从被拒收时刻起算） */
export function evalUnloadAndReturn(st: RainStation, v: RainVehicle, atMin: number) {
  const arriveUMin = atMin + st.toUTravelMin;
  const emptyMin = arriveUMin + UNLOAD_MIN;
  const backAtStationMin = emptyMin + st.fromUTravelMin;
  const completeMin = backAtStationMin + st.serviceMin;
  const deadlineEff = effectiveDeadline(st);
  return {
    atMin,
    arriveUMin,
    emptyMin,
    backAtStationMin,
    completeMin,
    deadlineMin: st.deadlineMin,
    effectiveDeadlineMin: deadlineEff,
    lateVsStationMin: Math.max(0, completeMin - st.deadlineMin),
    lateVsWindowMin: Math.max(0, completeMin - deadlineEff),
    feasible: completeMin <= deadlineEff + EPS && st.actualTon !== undefined
      ? st.actualTon <= v.capacityTon + EPS // 卸空后余量=额定容量
      : completeMin <= deadlineEff + EPS,
    steps: [
      { label: `${st.code} 停收时刻`, atMin },
      { label: `→U ${st.toUTravelMin} 分钟`, atMin: arriveUMin },
      { label: `卸载 ${UNLOAD_MIN} 分钟并确认卸空`, atMin: emptyMin },
      { label: `U→${st.code} ${st.fromUTravelMin} 分钟`, atMin: backAtStationMin },
      { label: `再作业 ${st.serviceMin} 分钟完成`, atMin: completeMin },
    ] as TimedStep[],
  };
}

// ----------------------------------------------------------------------------
// 排序准则（本题固定：满溢率上界优先）
// ----------------------------------------------------------------------------

export interface RankedRow {
  st: RainStation;
  first: FirstStopEval;
}

/**
 * 满溢率上界优先：fullnessHighPct 降序 → 稳定站号升序。
 * 注意：不能用吨位上界 0.70 / 0.95 排序——两站容器容量不同，
 * 吨位上界只用于容量判断。
 */
export function rankByFullness(rows: RankedRow[]): RankedRow[] {
  return [...rows].sort((a, b) => {
    if (b.st.estimate.fullnessHighPct !== a.st.estimate.fullnessHighPct) {
      return b.st.estimate.fullnessHighPct - a.st.estimate.fullnessHighPct;
    }
    return a.st.code.localeCompare(b.st.code);
  });
}

/**
 * 服务等级优先（仅用于界面说明“另一准则”，不提供策略按钮）：
 * 医院等敏感等级在前 → 同等级比满溢率上界降序 → 仍相同按稳定站号。
 */
export function rankByServiceLevel(rows: RankedRow[]): RankedRow[] {
  return [...rows].sort((a, b) => {
    const la = a.st.level === 'hospital' ? 0 : 1;
    const lb = b.st.level === 'hospital' ? 0 : 1;
    if (la !== lb) return la - lb;
    if (b.st.estimate.fullnessHighPct !== a.st.estimate.fullnessHighPct) {
      return b.st.estimate.fullnessHighPct - a.st.estimate.fullnessHighPct;
    }
    return a.st.code.localeCompare(b.st.code);
  });
}

// ----------------------------------------------------------------------------
// 综合分析：建议首站、两种顺序推演、待增援事项
// ----------------------------------------------------------------------------

export type ReinforceKind = 'second-leg-miss' | 'hard-block' | 'actual-overload';

export interface ReinforcementItem {
  stationId: string;
  kind: ReinforceKind;
  title: string;
  detail: string;
  predictedCompleteMin?: number;
  deadlineMin?: number;
  lateByMin?: number;
  appointmentRisk: string;
}

export interface RainAnalysis {
  rows: RankedRow[];                 // 按选定准则排序
  levelOrder: RankedRow[];          // 另一准则的顺序（仅说明用）
  suggestedFirstId: string | null;  // 排序后第一个“硬约束可行”的站
  suggestionReason: string;
  projections: Record<string, SecondLegEval>; // `${firstId}->${secondId}`
  reinforcements: ReinforcementItem[];
  pendingServiceIds: string[];      // 仍待服务对象（未完成，含停收）
  postCutoff: boolean;
}

const key2 = (a: string, b: string) => `${a}->${b}`;

export function analyzeRain(s: RainState): RainAnalysis {
  const postCutoff = isPostCutoff(s.nowMin);
  const active = s.stations.filter((x) => x.status !== 'completed');

  const allRows: RankedRow[] = s.stations.map((st) => ({
    st,
    first: evalFirstStop(st, s.vehicle, s.nowMin),
  }));
  const activeRows = allRows.filter((r) => r.st.status !== 'completed');

  const rows = rankByFullness(activeRows);
  const levelOrder = rankByServiceLevel(activeRows);
  const suggested = rows.find((r) => r.first.feasible) ?? null;

  let suggestionReason: string;
  if (rows.length === 0) {
    suggestionReason = '两站均已清运完成，本窗口无待派站点。';
  } else if (!suggested) {
    suggestionReason =
      '按满溢率上界排序后，所有站点均未通过时间/载重硬约束核验：本车本窗口无可发布的合法首站，全部转为增援/交接。';
  } else {
    const top = rows[0];
    if (top.st.id === suggested.st.id) {
      suggestionReason =
        `选定准则「满溢率上界优先」：${top.st.code} 满溢上界 ${top.st.estimate.fullnessHighPct}%` +
        `${rows.length > 1 ? ` 高于 ${rows[1].st.code} 的 ${rows[1].st.estimate.fullnessHighPct}%` : ''}` +
        `，且通过时间与载重核验，作为唯一可发布首站。吨位上界仅用于容量判断，不参与排序。`;
    } else {
      suggestionReason =
        `满溢率上界最高的 ${top.st.code} 未通过硬约束核验（${top.first.violations
          .map((v) => v.message)
          .join('；')}）；硬约束优先于排序，故自动建议改派排序其后且合法的 ${suggested.st.code}。`;
    }
  }

  // 两种先后顺序的二站推演（题目四个关键时刻）
  const projections: Record<string, SecondLegEval> = {};
  for (const a of s.stations) {
    for (const b of s.stations) {
      if (a.id === b.id) continue;
      projections[key2(a.id, b.id)] = evalSecondLeg(a, b, s.vehicle, NOW_MIN);
    }
  }

  const reinforcements: ReinforcementItem[] = [];

  for (const row of activeRows) {
    const { st, first } = row;

    // 实称超限停收：最高优先级的增援事项
    if (st.status === 'rejected' && st.actualTon !== undefined) {
      const back = evalUnloadAndReturn(st, s.vehicle, s.nowMin);
      reinforcements.push({
        stationId: st.id,
        kind: 'actual-overload',
        title: `${st.code} 实称 ${st.actualTon.toFixed(2)}t 超限停收，需增援/重排`,
        detail:
          `${st.rejectReason ?? '实称超过车辆可用余量'}。实称不回写估计、不提前登记已清；` +
          `本车即便先到 U 卸空再折返，最早 ${fmtMin(back.completeMin)} 完成` +
          (back.lateVsStationMin > 0
            ? `，仍晚于${st.code}截止 ${fmtMin(st.deadlineMin)} ${back.lateVsStationMin} 分钟`
            : '') +
          `，应另派载重足够的增援车辆，本站仍待服务。`,
        appointmentRisk: `预计失约：${st.name}需立即告知无法按原计划清运并改约增援班次。`,
      });
      continue;
    }

    if (!first.feasible) {
      reinforcements.push({
        stationId: st.id,
        kind: 'hard-block',
        title: `${st.code} 本车已无法合法承运，需另行增援`,
        detail: first.violations.map((v) => v.message).join('；'),
        predictedCompleteMin: first.completeMin,
        deadlineMin: first.effectiveDeadlineMin,
        lateByMin: first.lateByMin,
        appointmentRisk: `预计失约：最早 ${fmtMin(first.completeMin)} 完成，已错过截止 ${fmtMin(first.effectiveDeadlineMin)}，须提前发出失约/改约提示。`,
      });
      continue;
    }

    // 可行但不是建议首站：它只能作为“第二站”，而二站经 U 推演必然失约
    if (suggested && st.id !== suggested.st.id) {
      const leg = projections[key2(suggested.st.id, st.id)];
      if (leg && !leg.feasible) {
        reinforcements.push({
          stationId: st.id,
          kind: 'second-leg-miss',
          title: `${st.code} 不列入本窗口确认任务，生成待增援`,
          detail:
            `若先做 ${leg.firstId} 再到 U 卸空转 ${leg.secondId}，最早 ${fmtMin(
              leg.secondCompleteMin,
            )} 才能完成，晚于${st.code}截止 ${fmtMin(leg.secondDeadlineMin)} 共 ${leg.lateByMin} 分钟；` +
            `两站估计最低合量 ${leg.minCombinedTon.toFixed(3)}t > 可用余量 ${leg.remainingTon.toFixed(
              2,
            )}t，必须卸空后才能装第二站。该二站线路不得标作可执行，也不提前登记 ${st.code} 已清。`,
          predictedCompleteMin: leg.secondCompleteMin,
          deadlineMin: leg.secondDeadlineMin,
          lateByMin: leg.lateByMin,
          appointmentRisk: `预计失约 ${leg.lateByMin} 分钟：需通知${st.name}另行增援与改约。`,
        });
      }
    }
  }

  const pendingServiceIds = s.stations
    .filter((x) => x.status !== 'completed')
    .map((x) => x.id);

  return {
    rows,
    levelOrder,
    suggestedFirstId: suggested?.st.id ?? null,
    suggestionReason,
    projections,
    reinforcements,
    pendingServiceIds,
    postCutoff,
  };
}

// ----------------------------------------------------------------------------
// 发布前核对（窗口 + 估计修订）与人工改序校验
// ----------------------------------------------------------------------------

export function windowChecked(s: RainState): boolean {
  return s.windowAckRev === s.basisRev;
}
export function estimateChecked(s: RainState): boolean {
  return s.estimateAckRev === s.basisRev;
}

export interface PublishCheck {
  ok: boolean;
  chosenId: string | null;
  manual: boolean;
  blockers: string[];
}

export function checkPublish(s: RainState): PublishCheck {
  const blockers: string[] = [];
  const manual = s.manualId !== null;
  const chosenId = s.manualId ?? analyzeRain(s).suggestedFirstId;

  if (isPostCutoff(s.nowMin)) {
    blockers.push('已到/已过 10:00，停止站点装运，不再发布站点开工任务，只保留撤离与交接。');
  }
  if (!windowChecked(s)) blockers.push('请先核对暴雨窗口（10:00 停止装运）与各站截止时刻。');
  if (!estimateChecked(s)) blockers.push('请先核对估计区间、传感器缺报状态与最新修订/补报。');
  if (manual && s.manualReason.trim().length < 2) {
    blockers.push('人工改序必须填写理由（不少于 2 个字），留痕后重新验证时间与载重。');
  }
  if (!chosenId) {
    blockers.push('没有通过硬约束核验的可执行首站。');
  } else {
    const st = getStation(s, chosenId)!;
    const ev = evalFirstStop(st, s.vehicle, s.nowMin);
    if (!ev.feasible) {
      blockers.push(
        `人工选择 ${chosenId} 未通过重新验证：${ev.violations.map((v) => v.message).join('；')}——人工改序不能越过硬约束。`,
      );
    }
  }
  if (s.task) {
    if (s.task.status === 'active') {
      blockers.push('已有确认任务在执行；如需改序，请先在调度台判定失效并执行重排。');
    } else if (s.task.status === 'done') {
      blockers.push('本车首轮首站已完成；另一站经 U 卸空推演仍必然失约，只能走待增援，不能作为新首站再发布。');
    } else if (s.task.status === 'replanned') {
      blockers.push('本轮派单已重排终止，剩余站点走增援/交接；如需重新演示派单请重置现场。');
    }
  }
  return { ok: blockers.length === 0, chosenId, manual, blockers };
}

/** 已发布任务相对于当前输入/时钟是否仍有效 */
export function taskInvalidReasons(s: RainState): string[] {
  const t = s.task;
  if (!t || t.status === 'replanned' || t.status === 'done') return [];
  const reasons: string[] = [];
  if (t.basisRev !== s.basisRev) {
    reasons.push('任务确认后估计/截止/传感器依据发生修订，建议失效，需重新核对并重排。');
  }
  const st = getStation(s, t.stationId);
  if (st) {
    if (st.status === 'rejected') {
      reasons.push(`司机实称超限，${st.code} 已停收，原任务不能继续，必须重排/增援。`);
    }
    if (st.status !== 'completed' && isPostCutoff(s.nowMin)) {
      reasons.push('已过 10:00 且该站未清运完成：按不合规/失约处理，转入交接，不再续发开工指令。');
    }
    const ev = evalFirstStop(st, s.vehicle, t.publishedAtMin);
    // 仅当依据未修订时，用发布时刻推演解释；时钟推进导致的过期由上一条覆盖
    if (t.basisRev === s.basisRev && !ev.feasible) {
      reasons.push(...ev.violations.map((v) => v.message));
    }
  }
  return reasons;
}

// ----------------------------------------------------------------------------
// Reducer（UI 与测试共用；保持纯函数）
// ----------------------------------------------------------------------------

export type RainAction =
  | { type: 'reset' }
  | { type: 'setClockMin'; min: number }
  | { type: 'advance'; delta: number; actor?: string }
  | { type: 'chooseAuto' }
  | { type: 'chooseManual'; stationId: string }
  | { type: 'setManualReason'; reason: string }
  | { type: 'ackWindow' }
  | { type: 'ackEstimate' }
  | { type: 'publish'; actor?: string }
  | { type: 'demoHOver' }
  | { type: 'demoRDeadlineEarly' }
  | { type: 'demoBackfillEarlier' }
  | { type: 'driverArrive'; actor?: string }
  | { type: 'driverScan'; actor?: string }
  | { type: 'driverWeigh'; ton: number; actor?: string }
  | { type: 'driverTransitU'; actor?: string }
  | { type: 'driverConfirmEmpty'; actor?: string }
  | { type: 'dispatcherReplan'; actor?: string }
  | { type: 'ackEvac' }
  | { type: 'ackHandover' };

function withLog(s: RainState, actor: string, type: string, message: string, tone: LogEntry['tone'] = 'info'): RainState {
  const entry: LogEntry = { id: s.nextLogId, atMin: s.nowMin, actor, type, message, tone };
  return { ...s, nextLogId: s.nextLogId + 1, logs: [entry, ...s.logs] };
}

const clampMin = (n: number) => Math.max(0, Math.min(24 * 60, n));

export function rainReducer(prev: RainState, action: RainAction): RainState {
  switch (action.type) {
    case 'reset':
      return initialRainState();

    case 'setClockMin': {
      const nowMin = clampMin(Math.round(action.min));
      let next: RainState = { ...prev, nowMin };
      if (nowMin >= WEATHER_CUTOFF_MIN && prev.nowMin < WEATHER_CUTOFF_MIN) {
        next = withLog(
          next,
          '系统',
          'window-close',
          '时钟到达 10:00：停止站点装运。未完成站点按失约/交接处理，只保留撤离与交接待办。',
          'bad',
        );
      }
      return next;
    }

    case 'advance':
      return rainReducer(prev, { type: 'setClockMin', min: prev.nowMin + action.delta });

    case 'chooseAuto':
      return { ...prev, manualId: null };

    case 'chooseManual':
      return { ...prev, manualId: action.stationId };

    case 'setManualReason':
      return { ...prev, manualReason: action.reason };

    case 'ackWindow':
      return { ...prev, windowAckRev: prev.basisRev };

    case 'ackEstimate':
      return { ...prev, estimateAckRev: prev.basisRev };

    case 'publish': {
      const check = checkPublish(prev);
      const actor = action.actor ?? '张调度';
      if (!check.ok || !check.chosenId) {
        return withLog(
          prev,
          actor,
          'publish-blocked',
          `发布被硬校验拦截：${check.blockers.join(' / ')}`,
          'bad',
        );
      }
      const st = getStation(prev, check.chosenId)!;
      let next: RainState = {
        ...prev,
        task: {
          stationId: st.id,
          mode: check.manual ? 'manual' : 'auto',
          policy: CHOSEN_POLICY,
          manualReason: check.manual ? prev.manualReason.trim() : undefined,
          publishedAtMin: prev.nowMin,
          basisRev: prev.basisRev,
          status: 'active',
        },
        stations: prev.stations.map((x) => (x.id === st.id ? { ...x, status: 'tasked' } : x)),
      };
      next = withLog(
        next,
        actor,
        'publish',
        check.manual
          ? `人工改序发布首站 ${st.code}（理由：${prev.manualReason.trim()}）；已重新核验时间与载重。另一站只生成待增援，不发布二站线路。`
          : `按「满溢率上界优先」发布唯一可执行首站 ${st.code}；另一站生成待增援与预计失约提示，二站线路不可执行。`,
        'ok',
      );
      return next;
    }

    case 'demoHOver': {
      let next: RainState = {
        ...prev,
        basisRev: prev.basisRev + 1,
        stations: prev.stations.map((x) =>
          x.id === 'H'
            ? {
                ...x,
                estimate: {
                  fullnessLowPct: 105,
                  fullnessHighPct: 120,
                  tonLow: 1.05,
                  tonHigh: 1.2,
                  revised: true,
                  revisionNote: '演示注入：现场巡查 + 邻近称重修正，H 估计上修至 1.05–1.20t，已超过 1.0t 容器额定与本车余量。',
                },
              }
            : x,
        ),
      };
      next = withLog(
        next,
        '张调度',
        'demo-h-over',
        '【演示①】H 估计修订为 1.05–1.20t（满溢 105%–120%，超过 1t）：容量硬约束失效，原建议需重核。',
        'bad',
      );
      return next;
    }

    case 'demoRDeadlineEarly': {
      let next: RainState = {
        ...prev,
        basisRev: prev.basisRev + 1,
        stations: prev.stations.map((x) => (x.id === 'R' ? { ...x, deadlineMin: 9 * 60 + 30 } : x)),
      };
      next = withLog(
        next,
        '张调度',
        'demo-r-deadline',
        '【演示②】R 截止提前至 09:30：R 最早 09:36 才完成（赶到 09:28 不算），时间硬约束失效，需重排。',
        'bad',
      );
      return next;
    }

    case 'demoBackfillEarlier': {
      const reading: SensorReading = {
        id: `BF-${prev.basisRev + 1}`,
        sampleAtMin: 8 * 60 + 15, // 08:15，早于已采用的最近有效读数 08:40
        receivedAtMin: prev.nowMin,
        fullnessPct: 84,
        kind: 'backfill-late',
        stale: true,
        note: '网关缓存迟到补报：采样 08:15 早于最近有效读数 08:40，只补齐历史缺报，不替代最新依据',
      };
      let next: RainState = {
        ...prev,
        basisRev: prev.basisRev + 1,
        stations: prev.stations.map((x) =>
          x.id === 'H'
            ? {
                ...x,
                sensor: { ...x.sensor, readings: [...x.sensor.readings, reading] },
              }
            : x,
        ),
      };
      next = withLog(
        next,
        '系统',
        'demo-backfill',
        `【演示③】收到 H 缺报补传：采样时间 ${fmtMin(reading.sampleAtMin)} 早于接收时间 ${fmtMin(
          reading.receivedAtMin,
        )}，且早于已采用的最近有效读数 08:40。按迟到/乱序补报归档，不外推为当前实测、不填零，估计区间不变；确认前须重新核对该修订记录。`,
        'warn',
      );
      return next;
    }

    case 'driverArrive': {
      const actor = action.actor ?? '王师傅';
      const t = prev.task;
      if (!t || t.status !== 'active') return prev;
      if (isPostCutoff(prev.nowMin)) {
        return withLog(prev, actor, 'blocked', '已过 10:00，不再续发站点开工/到站指令，请执行撤离与交接。', 'bad');
      }
      const st = getStation(prev, t.stationId);
      if (!st || (st.status !== 'tasked' && st.status !== 'pending')) return prev;
      const travel = prev.node === 'POS' ? st.posTravelMin : 0;
      let next: RainState = {
        ...prev,
        nowMin: prev.nowMin + travel,
        node: st.id as NodeId,
        driverPhase: 'at-station',
        stations: prev.stations.map((x) => (x.id === st.id ? { ...x, status: 'arrived' } : x)),
      };
      next = withLog(next, actor, 'arrive', `到达 ${st.code}（行驶 ${travel} 分钟）；到站时刻不计为完成。`);
      return next;
    }

    case 'driverScan': {
      const actor = action.actor ?? '王师傅';
      const t = prev.task;
      if (!t || t.status !== 'active') return prev;
      const st = getStation(prev, t.stationId);
      if (!st || st.status !== 'arrived') return prev;
      let next: RainState = {
        ...prev,
        driverPhase: 'scanned',
        stations: prev.stations.map((x) => (x.id === st.id ? { ...x, status: 'scanned' } : x)),
      };
      next = withLog(next, actor, 'scan', `${st.code} 扫码成功，容器身份与任务一致。`);
      return next;
    }

    case 'driverWeigh': {
      const actor = action.actor ?? '王师傅';
      const t = prev.task;
      if (!t || t.status !== 'active') return prev;
      if (isPostCutoff(prev.nowMin)) {
        return withLog(prev, actor, 'blocked', '已过 10:00，停止站点装运/称重开工，请走撤离与交接。', 'bad');
      }
      const st = getStation(prev, t.stationId);
      if (!st || st.status !== 'scanned') return prev;
      const ton = r3(action.ton);
      const remain = remainingTon(prev.vehicle);

      // 实称超过当前可用余量 → 停收，不增加载重，不登记完成
      if (ton > remain + EPS || prev.vehicle.loadTon + ton > prev.vehicle.capacityTon + EPS) {
        const over = r3(Math.max(ton - remain, prev.vehicle.loadTon + ton - prev.vehicle.capacityTon));
        let next: RainState = {
          ...prev,
          stations: prev.stations.map((x) =>
            x.id === st.id
              ? {
                  ...x,
                  status: 'rejected',
                  actualTon: ton,
                  rejectReason: `实称 ${ton.toFixed(2)}t，超过可用余量 ${remain.toFixed(2)}t（超载约 ${over.toFixed(2)}t）`,
                }
              : x,
          ),
        };
        next = withLog(
          next,
          actor,
          'overload-reject',
          `${st.code} 实称 ${ton.toFixed(2)}t 超限：立即停收，载重不增加、站点不记已清；已通知调度重排/增援。`,
          'bad',
        );
        next = withLog(
          next,
          '系统',
          'task-invalid',
          '已确认任务因实称超限失效，调度台须重排；该站仍属待服务对象。',
          'bad',
        );
        return next;
      }

      // 合法：作业 8 分钟结束（称重/装载包含在内），登记实称与完成时刻
      const completedAt = prev.nowMin + st.serviceMin;
      const late = completedAt > effectiveDeadline(st) + EPS;
      let next: RainState = {
        ...prev,
        nowMin: completedAt,
        driverPhase: 'done-station',
        vehicle: { ...prev.vehicle, loadTon: r3(prev.vehicle.loadTon + ton) },
        stations: prev.stations.map((x) =>
          x.id === st.id ? { ...x, status: 'completed', actualTon: ton, completedAtMin: completedAt } : x,
        ),
        task: prev.task ? { ...prev.task, status: 'done' } : prev.task,
      };
      next = withLog(
        next,
        actor,
        'weigh-complete',
        `${st.code} 实称 ${ton.toFixed(3)}t 可装，清运完成于 ${fmtMin(completedAt)}` +
          (late ? '（晚于截止，不合规）' : '（合规）') +
          `；当前载重 ${next.vehicle.loadTon.toFixed(2)}t。`,
        late ? 'bad' : 'ok',
      );
      return next;
    }

    case 'driverTransitU': {
      const actor = action.actor ?? '王师傅';
      const done = prev.stations.find((x) => x.status === 'completed');
      if (!done || prev.driverPhase !== 'done-station') return prev;
      let next: RainState = { ...prev, nowMin: prev.nowMin + done.toUTravelMin, node: 'U' };
      next = withLog(
        next,
        actor,
        'transit-u',
        `由 ${done.code} 转场 U，行驶 ${done.toUTravelMin} 分钟，${fmtMin(next.nowMin)} 到达；卸载确认前载重仍为 ${prev.vehicle.loadTon.toFixed(2)}t，余量不释放。`,
      );
      return next;
    }

    case 'driverConfirmEmpty': {
      const actor = action.actor ?? '王师傅';
      if (prev.node !== 'U') return prev;
      let next: RainState = {
        ...prev,
        nowMin: prev.nowMin + UNLOAD_MIN,
        driverPhase: 'empty-confirmed',
        vehicle: { ...prev.vehicle, loadTon: 0 },
      };
      next = withLog(
        next,
        actor,
        'unload-empty',
        `卸载 ${UNLOAD_MIN} 分钟并确认卸空：当前载重 0.00t，可用余量恢复为额定 ${prev.vehicle.capacityTon.toFixed(1)}t。`,
        'ok',
      );
      return next;
    }

    case 'dispatcherReplan': {
      const actor = action.actor ?? '张调度';
      let next: RainState = {
        ...prev,
        replanCount: prev.replanCount + 1,
        task: prev.task ? { ...prev.task, status: 'replanned' } : null,
      };
      const a = analyzeRain(next);
      next = withLog(
        next,
        actor,
        'replan',
        `第 ${next.replanCount} 次重排：原任务终止，按当前估计/截止/实称重新核验；待增援 ${a.reinforcements
          .map((r) => r.stationId)
          .join('、') || '无'}，仍待服务 ${a.pendingServiceIds.join('、') || '无'}。10:00 后不再续发站点开工指令。`,
        'warn',
      );
      return next;
    }

    case 'ackEvac':
      return { ...prev, evacAck: true };

    case 'ackHandover':
      return withLog({ ...prev, handoverAck: true }, '王师傅/张调度', 'handover-ack', '撤离与交接已确认：未服务站点、估计区间、传感器缺报/补报、预计失约清单均已移交增援值班。', 'ok');

    default:
      return prev;
  }
}

// ----------------------------------------------------------------------------
// 撤离 / 交接待办（10:00 后唯一允许的操作类待办）
// ----------------------------------------------------------------------------

export interface OffBoardTodo {
  id: 'evac' | 'handover';
  title: string;
  detail: string;
  ack: boolean;
}

export function offBoardTodos(s: RainState): OffBoardTodo[] {
  if (!isPostCutoff(s.nowMin)) return [];
  const pending = s.stations.filter((x) => x.status !== 'completed');
  return [
    {
      id: 'evac',
      title: '撤离待办：人员车辆撤至安全点',
      detail: '10:00 起站点停止装运，不再开工；司机确认人员安全、车辆驶离低洼/易涝点位并到安全点待命。',
      ack: s.evacAck,
    },
    {
      id: 'handover',
      title: '交接待办：向增援/应急值班交接未服务对象',
      detail:
        pending.length === 0
          ? '两站均已在截止前完成，无未服务对象；交接时钟、异常与回执即可。'
          : `仍待服务：${pending
              .map(
                (x) =>
                  `${x.code}（${x.name}，截止 ${fmtMin(x.deadlineMin)}，估计 ${x.estimate.tonLow.toFixed(
                    3,
                  )}–${x.estimate.tonHigh.toFixed(2)}t，传感器${x.sensor.reportingNow ? '有报' : '缺报/区间估计'}${
                    x.status === 'rejected' && x.actualTon !== undefined
                      ? `，实称 ${x.actualTon.toFixed(2)}t 已停收`
                      : ''
                  }）`,
              )
              .join('；')}。连同预计失约提示、补报记录一并移交。`,
      ack: s.handoverAck,
    },
  ];
}
