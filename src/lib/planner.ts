// 线路规划器（纯函数，供 WebWorker 与单元测试使用）
// 同时核验：车辆吨位、道路限高限宽、道路封闭、各站服务截止、卸载点开放时段。
// 不允许用“地图上可达”代替吨位或道路限制核验。
import type { Closure, DumpSite, Road } from '../types';
import { fmtMin, round2 } from '../types';
import { explainUnreachable, travelLeg } from './graph';

export interface StopReq {
  stationId: string;
  nodeId: string;
  ton: number;          // 规划用重量：已称重的用实称，否则用估重
  deadlineMin: number;
  serviceMin: number;
}

export interface VehicleInput {
  id: string;
  capacityTon: number;
  loadTon: number;
  heightM: number;
  widthM: number;
  posNodeId: string;
}

export interface NotifInput {
  id: string;
  stationId: string;
  notifiedVehicleId: string;
  notifiedEtaMin: number;
  notifiedSeq: number;
}

export interface PlanContext {
  nowMin: number;
  roads: Road[];
  closures: Closure[];
  dumps: DumpSite[];
}

export interface LegEval {
  stationId: string;
  arriveMin: number;
  departMin: number;
  loadAfterTon: number;
  driveMin: number;
  path: string[];
}

export interface Violation {
  stationId?: string;
  reason: string;
}

export interface DumpCheck {
  reachable: boolean;
  dumpId?: string;
  arriveMin?: number;
  note: string;
}

export interface RouteEval {
  vehicleId: string;
  legs: LegEval[];
  feasible: boolean;
  totalDriveMin: number;
  endMin: number;
  violations: Violation[];
  dump: DumpCheck;
}

export interface ResendInfo {
  notificationId: string;
  stationId: string;
  reasons: string[];
  oldVehicleId: string;
  newVehicleId: string;
  oldEtaMin: number;
  newEtaMin: number;
}

export interface VehiclePlan {
  vehicleId: string;
  stopIds: string[];
  eval: RouteEval;
}

export interface PlanResult {
  strategy: 'insert' | 'global';
  feasible: boolean;
  vehiclePlans: VehiclePlan[];
  totalDriveMin: number;          // 所有车合计行驶时间
  notes: string[];                // 方案说明（移交、排除原因等）
  rejected: { subject: string; reason: string }[]; // 被排除的候选及原因
  resends: ResendInfo[];          // 需要重发的通知
  etaShifts: { stationId: string; shiftMin: number }[]; // 相对已通知时刻的偏移（正=延后）
}

export interface PlanPayload extends PlanContext {
  strategy: 'insert' | 'global';
  vehicles: VehicleInput[];
  stops: StopReq[];                          // 全部未完成站点
  currentRoutes: Record<string, string[]>;   // insert 策略：各车当前剩余顺序
  blockedIds: string[];                      // insert 策略：受阻需移交的站点
  notifications: NotifInput[];
}

const ETA_TOLERANCE_MIN = 5; // 通知时刻偏移超过 5 分钟即需重发

function dumpCheck(veh: VehicleInput, pos: string, t: number, ctx: PlanContext): DumpCheck {
  let best: DumpCheck | null = null;
  for (const d of ctx.dumps) {
    const r = travelLeg(ctx.roads, ctx.closures, pos, d.nodeId, t, veh);
    if (!r.ok) continue;
    const arrive = t + r.minutes;
    const okWindow = d.windows.some((w) => arrive >= w.startMin && arrive + d.unloadMin <= w.endMin);
    if (okWindow && (!best || (best.arriveMin ?? Infinity) > arrive)) {
      best = {
        reachable: true,
        dumpId: d.id,
        arriveMin: arrive,
        note: `结束后 ${fmtMin(arrive)} 可达「${d.name}」，在开放时段内可卸载`,
      };
    }
  }
  return best ?? { reachable: false, note: '结束后无法在卸载点开放时段内抵达卸载点' };
}

/** 评估一辆车按给定顺序执行一批站点的可行性（载重/截止/限高限宽/封闭/卸载点时段）。 */
export function evalRoute(veh: VehicleInput, ordered: StopReq[], ctx: PlanContext): RouteEval {
  const violations: Violation[] = [];
  const legs: LegEval[] = [];
  let t = ctx.nowMin;
  let load = veh.loadTon;
  let pos = veh.posNodeId;
  let drive = 0;

  for (const s of ordered) {
    const r = travelLeg(ctx.roads, ctx.closures, pos, s.nodeId, t, veh);
    if (!r.ok) {
      const why = explainUnreachable(ctx.roads, ctx.closures, pos, s.nodeId, t, veh);
      violations.push({ stationId: s.stationId, reason: `${s.stationId}：${why}` });
      return {
        vehicleId: veh.id, legs, feasible: false, totalDriveMin: drive, endMin: t,
        violations, dump: dumpCheck(veh, pos, t, ctx),
      };
    }
    const arrive = t + r.minutes;
    if (arrive > s.deadlineMin) {
      violations.push({
        stationId: s.stationId,
        reason: `${s.stationId} 预计 ${fmtMin(arrive)} 到达，超过服务截止 ${fmtMin(s.deadlineMin)}`,
      });
    }
    load = round2(load + s.ton);
    if (load > veh.capacityTon + 1e-6) {
      violations.push({
        stationId: s.stationId,
        reason: `${s.stationId} 装载后累计 ${load.toFixed(1)} 吨，超过车辆容量 ${veh.capacityTon.toFixed(1)} 吨`,
      });
    }
    legs.push({
      stationId: s.stationId,
      arriveMin: arrive,
      departMin: arrive + s.serviceMin,
      loadAfterTon: load,
      driveMin: r.minutes,
      path: r.path,
    });
    drive += r.minutes;
    t = arrive + s.serviceMin;
    pos = s.nodeId;
  }

  return {
    vehicleId: veh.id, legs, feasible: violations.length === 0, totalDriveMin: drive,
    endMin: t, violations, dump: dumpCheck(veh, pos, t, ctx),
  };
}

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr.slice()];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

function computeResends(
  notifications: NotifInput[],
  vehiclePlans: VehiclePlan[],
): { resends: ResendInfo[]; etaShifts: { stationId: string; shiftMin: number }[] } {
  const placement = new Map<string, { vehicleId: string; eta: number; seq: number }>();
  for (const vp of vehiclePlans) {
    vp.eval.legs.forEach((leg, i) => {
      placement.set(leg.stationId, { vehicleId: vp.vehicleId, eta: leg.arriveMin, seq: i });
    });
  }

  const resends: ResendInfo[] = [];
  const etaShifts: { stationId: string; shiftMin: number }[] = [];
  const orderReasonByStation = new Map<string, string>();

  // 同车相对顺序变化：旧通知序列过滤出仍在该车的站点，与新序列对比
  const oldOrderByVeh = new Map<string, NotifInput[]>();
  for (const n of notifications) {
    const list = oldOrderByVeh.get(n.notifiedVehicleId) ?? [];
    list.push(n);
    oldOrderByVeh.set(n.notifiedVehicleId, list);
  }
  for (const [vehId, list] of oldOrderByVeh) {
    const oldSeq = list.slice().sort((a, b) => a.notifiedSeq - b.notifiedSeq).map((n) => n.stationId);
    const vp = vehiclePlans.find((p) => p.vehicleId === vehId);
    const newSeqAll = vp ? vp.stopIds : [];
    const stillHere = oldSeq.filter((s) => newSeqAll.includes(s));
    const newFiltered = newSeqAll.filter((s) => stillHere.includes(s));
    if (stillHere.join('|') !== newFiltered.join('|')) {
      for (const s of stillHere) orderReasonByStation.set(s, '同车站点到达顺序变化');
    }
  }

  for (const n of notifications) {
    const cur = placement.get(n.stationId);
    if (!cur) continue; // 不在本方案（如已完成）
    const reasons: string[] = [];
    if (cur.vehicleId !== n.notifiedVehicleId) reasons.push('承运车辆变更');
    const shift = cur.eta - n.notifiedEtaMin;
    etaShifts.push({ stationId: n.stationId, shiftMin: shift });
    if (Math.abs(shift) > ETA_TOLERANCE_MIN) {
      reasons.push(shift > 0 ? `到达延后 ${shift} 分钟` : `到达提前 ${-shift} 分钟`);
    }
    const orderReason = orderReasonByStation.get(n.stationId);
    if (orderReason) reasons.push(orderReason);
    if (reasons.length > 0) {
      resends.push({
        notificationId: n.id,
        stationId: n.stationId,
        reasons,
        oldVehicleId: n.notifiedVehicleId,
        newVehicleId: cur.vehicleId,
        oldEtaMin: n.notifiedEtaMin,
        newEtaMin: cur.eta,
      });
    }
  }
  return { resends, etaShifts };
}

function buildResult(
  strategy: 'insert' | 'global',
  vehicles: VehicleInput[],
  assignments: Record<string, StopReq[]>,
  ctx: PlanContext,
  notifications: NotifInput[],
  notes: string[],
  rejected: { subject: string; reason: string }[],
): PlanResult {
  const vehiclePlans: VehiclePlan[] = vehicles.map((v) => ({
    vehicleId: v.id,
    stopIds: (assignments[v.id] ?? []).map((s) => s.stationId),
    eval: evalRoute(v, assignments[v.id] ?? [], ctx),
  }));
  const feasible = vehiclePlans.every((p) => p.eval.feasible);
  const totalDriveMin = vehiclePlans.reduce((a, p) => a + p.eval.totalDriveMin, 0);
  const { resends, etaShifts } = computeResends(notifications, vehiclePlans);
  return { strategy, feasible, vehiclePlans, totalDriveMin, notes, rejected, resends, etaShifts };
}

/** 诊断：若某站仍由某车承运（从当前位置单独跑这一站），不可行的原因。 */
function diagnose(veh: VehicleInput, stop: StopReq, ctx: PlanContext): string | null {
  const ev = evalRoute(veh, [stop], ctx);
  if (ev.feasible) return null;
  return ev.violations.map((v) => v.reason).join('；');
}

/** 方案 A：最小变更——保留各车已通知站点顺序，仅把受阻站点前置移交给有余量的车辆。 */
export function planInsert(payload: PlanPayload): PlanResult {
  const { vehicles, stops, currentRoutes, blockedIds, notifications } = payload;
  const stopById = new Map(stops.map((s) => [s.stationId, s]));
  const notes: string[] = [];
  const rejected: { subject: string; reason: string }[] = [];

  const assignments: Record<string, StopReq[]> = {};
  for (const v of vehicles) {
    assignments[v.id] = (currentRoutes[v.id] ?? [])
      .filter((id) => !blockedIds.includes(id))
      .map((id) => stopById.get(id))
      .filter((s): s is StopReq => !!s);
  }

  // 受阻站点的排除诊断（如 T1 保留 S2：封闭+绕行超时）
  for (const bid of blockedIds) {
    const s = stopById.get(bid);
    if (!s) continue;
    for (const v of vehicles) {
      const reason = diagnose(v, s, payload);
      if (reason) rejected.push({ subject: `${v.id} 承运 ${bid}`, reason });
    }
  }

  // 逐站移交：选“剩余容量足够且前置插入后全线可行”的车辆；候选按剩余容量从大到小
  const addedTon = (vId: string) => assignments[vId].reduce((a, s) => a + s.ton, 0);
  for (const bid of blockedIds) {
    const s = stopById.get(bid);
    if (!s) continue;
    const candidates = vehicles
      .map((v) => ({ v, remaining: v.capacityTon - (v.loadTon + addedTon(v.id)) }))
      .filter((c) => c.remaining >= s.ton - 1e-6)
      .sort((a, b) => b.remaining - a.remaining);
    let placed = false;
    for (const c of candidates) {
      const trial = [s, ...assignments[c.v.id]]; // 前置插入，保留已通知顺序
      const ev = evalRoute(c.v, trial, payload);
      if (ev.feasible) {
        assignments[c.v.id] = trial;
        placed = true;
        notes.push(`${bid} 前置移交 ${c.v.id}（保留 ${c.v.id} 已通知站点顺序，其余车辆线路不变）`);
        break;
      }
    }
    if (!placed) {
      notes.push(`${bid} 无车辆可接管：余量不足或插入后超出服务截止`);
    }
  }

  return buildResult('insert', vehicles, assignments, payload, notifications, notes, rejected);
}

/** 方案 B：全局重排——重新排列全部未完成站点，最小化总行驶时间（不改变服务期限与载重限制）。 */
export function planGlobal(payload: PlanPayload): PlanResult {
  const { vehicles, stops, notifications } = payload;
  const notes: string[] = ['对全部未完成站点枚举分配与顺序，取总行驶时间最短的可行方案'];
  const rejected: { subject: string; reason: string }[] = [];

  // 诊断信息：每个站点 × 每辆车的单站可行性（解释为何某些组合被排除）
  for (const s of stops) {
    for (const v of vehicles) {
      const reason = diagnose(v, s, payload);
      if (reason) rejected.push({ subject: `${v.id} 承运 ${s.stationId}`, reason });
    }
  }

  let best: { assign: Record<string, StopReq[]>; drive: number; moves: number; key: string } | null = null;
  const n = stops.length;
  const k = vehicles.length;
  const choice = new Array<number>(n).fill(0);

  const originalVeh = new Map<string, string>();
  for (const v of vehicles) {
    for (const id of payload.currentRoutes[v.id] ?? []) originalVeh.set(id, v.id);
  }

  const consider = (assign: Record<string, StopReq[]>) => {
    let drive = 0;
    let moves = 0;
    const bestLists: Record<string, StopReq[]> = {};
    for (const v of vehicles) {
      const list = assign[v.id];
      // 容量预检：估重累计已超容量则不必枚举顺序
      const sumTon = list.reduce((a, s) => a + s.ton, 0);
      if (v.loadTon + sumTon > v.capacityTon + 1e-6) return;
      let bestPerm: StopReq[] | null = null;
      let bestDrive = Infinity;
      for (const perm of permutations(list)) {
        const ev = evalRoute(v, perm, payload);
        if (ev.feasible && ev.totalDriveMin < bestDrive) {
          bestDrive = ev.totalDriveMin;
          bestPerm = perm;
        }
      }
      if (!bestPerm) return;
      drive += bestDrive;
      bestLists[v.id] = bestPerm;
      for (const s of list) if (originalVeh.get(s.stationId) !== v.id) moves++;
    }
    const key = vehicles
      .map((v) => bestLists[v.id].map((s) => s.stationId).join(','))
      .join('|');
    if (
      !best ||
      drive < best.drive ||
      (drive === best.drive && moves < best.moves) ||
      (drive === best.drive && moves === best.moves && key < best.key)
    ) {
      // 注意：bestLists 引用递归中会被改写的数组，必须深拷贝快照
      const snapshot: Record<string, StopReq[]> = {};
      for (const v of vehicles) snapshot[v.id] = [...bestLists[v.id]];
      best = { assign: snapshot, drive, moves, key };
    }
  };

  const walk = (i: number, assign: Record<string, StopReq[]>) => {
    if (i === n) {
      consider(assign);
      return;
    }
    for (let v = 0; v < k; v++) {
      assign[vehicles[v].id].push(stops[i]);
      walk(i + 1, assign);
      assign[vehicles[v].id].pop();
    }
  };
  const empty: Record<string, StopReq[]> = {};
  for (const v of vehicles) empty[v.id] = [];
  walk(0, empty);

  if (!best) {
    notes.push('无可行方案：现有车辆在给定载重/时限/道路限制下无法覆盖全部站点');
    return buildResult('global', vehicles, empty, payload, notifications, notes, rejected);
  }
  const b = best as { assign: Record<string, StopReq[]>; drive: number };
  notes.push(`全局最优合计行驶 ${b.drive} 分钟`);
  return buildResult('global', vehicles, b.assign, payload, notifications, notes, rejected);
}

export function runPlan(payload: PlanPayload): PlanResult {
  return payload.strategy === 'insert' ? planInsert(payload) : planGlobal(payload);
}
