// 领域动作：所有状态变更都经过这里（写库 + 事件日志 + 广播刷新）
import type { Closure, EventLog, Receipt, ReceiptAction, RouteVersion, Station } from '../types';
import { fmtMin, round2 } from '../types';
import { getDb, loadSnapshot, resetAndSeed, type Snapshot } from './db';
import { judgeReceipt, type IntakeContext } from './receipts';
import { evalRoute, type PlanResult, type StopReq, type VehicleInput } from './planner';
import { shortestPath } from './graph';
import { credentialOf } from './seed';

// 简单的变更广播：任何写操作后通知 UI 重新加载快照
export const bus = new EventTarget();
function emitChange() {
  bus.dispatchEvent(new Event('change'));
}

async function log(db: any, tsMin: number, actor: string, type: string, message: string) {
  const e: EventLog = { tsMin, actor, type, message };
  await db.add('events', e);
}

export async function nowMin(): Promise<number> {
  const db = await getDb();
  return (await db.get('meta', 'nowMin')) ?? 560;
}

export async function resetDemo(): Promise<void> {
  await resetAndSeed();
  emitChange();
}

export async function advanceClock(deltaMin: number, actor: string, note?: string): Promise<void> {
  const db = await getDb();
  const cur = (await db.get('meta', 'nowMin')) ?? 560;
  const next = cur + deltaMin;
  await db.put('meta', next, 'nowMin');
  await log(db, next, actor, 'clock', note ?? `时钟推进 ${deltaMin} 分钟至 ${fmtMin(next)}`);
  emitChange();
}

export async function setClock(toMin: number, actor: string, note: string): Promise<void> {
  const db = await getDb();
  await db.put('meta', toMin, 'nowMin');
  await log(db, toMin, actor, 'clock', note);
  emitChange();
}

// ---------- 快照派生工具 ----------

export function currentVersionByVehicle(snap: Snapshot): Record<string, RouteVersion> {
  const out: Record<string, RouteVersion> = {};
  for (const rv of snap.routeVersions) {
    const cur = out[rv.vehicleId];
    if (!cur || rv.versionNo > cur.versionNo) out[rv.vehicleId] = rv;
  }
  return out;
}

function intakeCtx(snap: Snapshot): IntakeContext {
  const versions = currentVersionByVehicle(snap);
  const stops: Record<string, string[]> = {};
  const vers: Record<string, string> = {};
  for (const [vid, rv] of Object.entries(versions)) {
    stops[vid] = rv.stopIds;
    vers[vid] = rv.id;
  }
  return { stations: snap.stations, existingReceipts: snap.receipts, currentStopsByVehicle: stops, currentVersionByVehicle: vers };
}

export function vehicleInput(snap: Snapshot, vehicleId: string): VehicleInput {
  const v = snap.vehicles.find((x) => x.id === vehicleId)!;
  return {
    id: v.id, capacityTon: v.capacityTon, loadTon: v.loadTon,
    heightM: v.heightM, widthM: v.widthM, posNodeId: v.posNodeId,
  };
}

export function stopReqOf(snap: Snapshot, stationId: string): StopReq {
  const s = snap.stations.find((x) => x.id === stationId)!;
  return {
    stationId: s.id, nodeId: s.nodeId,
    ton: s.actualTon ?? s.estTon, // 已称重的按实称重排
    deadlineMin: s.deadlineMin, serviceMin: s.serviceMin,
  };
}

/** 当前各车线路的实时执行评估（到站时刻/载重），供路线清单与客服端使用。 */
export function computeCurrentEtas(snap: Snapshot): Map<string, { vehicleId: string; etaMin: number; seq: number; loadAfterTon: number }> {
  const out = new Map<string, { vehicleId: string; etaMin: number; seq: number; loadAfterTon: number }>();
  for (const [vid, ev] of computeRouteEvals(snap)) {
    ev.legs.forEach((leg, i) => {
      out.set(leg.stationId, { vehicleId: vid, etaMin: leg.arriveMin, seq: i + 1, loadAfterTon: leg.loadAfterTon });
    });
  }
  return out;
}

/** 各车当前版本线路（未完成站点）的完整评估，含路径与违例。 */
export function computeRouteEvals(snap: Snapshot): Map<string, import('./planner').RouteEval> {
  const versions = currentVersionByVehicle(snap);
  const out = new Map<string, import('./planner').RouteEval>();
  for (const v of snap.vehicles) {
    const rv = versions[v.id];
    if (!rv) continue;
    const pending = rv.stopIds
      .map((id) => snap.stations.find((s) => s.id === id))
      .filter((s): s is Station => !!s && s.status !== 'completed');
    const ev = evalRoute(vehicleInput(snap, v.id), pending.map((s) => stopReqOf(snap, s.id)), {
      nowMin: snap.nowMin, roads: snap.roads, closures: snap.closures, dumps: snap.dumps,
    });
    out.set(v.id, ev);
  }
  return out;
}

/** 构造规划请求：未完成站点、各车当前剩余顺序、受阻站点（当前承运车已无法履约的）。 */
export function buildPlanPayload(snap: Snapshot, strategy: 'insert' | 'global'): import('./planner').PlanPayload {
  const versions = currentVersionByVehicle(snap);
  const unfinished = snap.stations.filter((s) => s.status !== 'completed');
  const stops = unfinished.map((s) => stopReqOf(snap, s.id));
  const currentRoutes: Record<string, string[]> = {};
  for (const v of snap.vehicles) {
    currentRoutes[v.id] = (versions[v.id]?.stopIds ?? []).filter((id) => unfinished.some((s) => s.id === id));
  }
  // 受阻站点：当前承运车辆按现状已无法可行承运（封闭/超时/超载/限高限宽）
  const blockedIds: string[] = [];
  for (const s of unfinished) {
    const veh = snap.vehicles.find((v) => v.id === s.assignedVehicleId);
    if (!veh) continue;
    const ev = evalRoute(vehicleInput(snap, veh.id), [stopReqOf(snap, s.id)], {
      nowMin: snap.nowMin, roads: snap.roads, closures: snap.closures, dumps: snap.dumps,
    });
    if (!ev.feasible) blockedIds.push(s.id);
  }
  return {
    strategy,
    nowMin: snap.nowMin,
    roads: snap.roads,
    closures: snap.closures,
    dumps: snap.dumps,
    vehicles: snap.vehicles.map((v) => vehicleInput(snap, v.id)),
    stops,
    currentRoutes,
    blockedIds,
    notifications: snap.notifications
      .filter((n) => n.status !== 'fulfilled')
      .map((n) => ({
        id: n.id, stationId: n.stationId, notifiedVehicleId: n.notifiedVehicleId,
        notifiedEtaMin: n.notifiedEtaMin, notifiedSeq: n.notifiedSeq,
      })),
  };
}

// ---------- 回执受理 ----------

let receiptSeq = 0;
function newReceiptId(action: string, vehicleId: string, stationId: string | undefined, t: number): string {
  receiptSeq += 1;
  return `RC-${action}-${vehicleId}-${stationId ?? 'X'}-${t}-${receiptSeq}`;
}

interface ApplyResult {
  verdict: 'accepted' | 'duplicate' | 'conflict';
  note?: string;
  weighOutcome?: 'completed' | 'rejected';
}

async function applyAcceptedEffect(db: any, snap: Snapshot, r: Receipt, actualTon?: number): Promise<{ weighOutcome?: 'completed' | 'rejected' }> {
  const station = r.stationId ? snap.stations.find((s) => s.id === r.stationId) : undefined;
  const vehicle = snap.vehicles.find((v) => v.id === r.vehicleId)!;
  if (r.action === 'arrive' && station) {
    station.status = 'arrived';
    vehicle.posNodeId = station.nodeId;
    await db.put('stations', station);
    await db.put('vehicles', vehicle);
    await log(db, r.deviceTimeMin, r.executorName, 'arrive', `${vehicle.id} 到达 ${station.id}（${station.name}）`);
    return {};
  }
  if (r.action === 'scan' && station) {
    if (station.status === 'pending' || station.status === 'arrived') station.status = 'scanned';
    await db.put('stations', station);
    await log(db, r.deviceTimeMin, r.executorName, 'scan', `${vehicle.id} 在 ${station.id} 扫码（凭证 ${r.credentialId}，依据 ${r.routeVersionId}）`);
    return {};
  }
  if (r.action === 'weigh' && station && actualTon != null) {
    station.actualTon = round2(actualTon);
    const remaining = round2(vehicle.capacityTon - vehicle.loadTon);
    if (actualTon > remaining + 1e-6) {
      station.status = 'rejected';
      station.rejectReason = `实称 ${actualTon.toFixed(1)} 吨超出车辆剩余容量 ${remaining.toFixed(1)} 吨，已停收`;
      await db.put('stations', station);
      await log(db, r.deviceTimeMin, r.executorName, 'reject',
        `${station.id} 实称 ${actualTon.toFixed(1)} 吨 > ${vehicle.id} 剩余容量 ${remaining.toFixed(1)} 吨，停收并等待重排`);
      return { weighOutcome: 'rejected' };
    }
    vehicle.loadTon = round2(vehicle.loadTon + actualTon);
    station.status = 'completed';
    station.completedBy = r.executorName;
    station.completedAtMin = r.deviceTimeMin;
    await db.put('vehicles', vehicle);
    await db.put('stations', station);
    // 通知履约
    const notif = snap.notifications.find((n) => n.stationId === station.id);
    if (notif) {
      notif.status = 'fulfilled';
      notif.resendReasons = [];
      await db.put('notifications', notif);
    }
    await log(db, r.deviceTimeMin, r.executorName, 'weigh',
      `${station.id} 实称 ${actualTon.toFixed(1)} 吨入车，${vehicle.id} 载重 ${vehicle.loadTon.toFixed(1)}/${vehicle.capacityTon.toFixed(1)} 吨，站点完成`);
    return { weighOutcome: 'completed' };
  }
  if (r.action === 'overflow' && station) {
    station.overflowReported = true;
    await db.put('stations', station);
    await log(db, r.deviceTimeMin, r.executorName, 'overflow', `${station.id} 满溢上报，请调度关注`);
    return {};
  }
  return {};
}

/** 统一入口：生成回执 → 判定（幂等/冲突）→ 入账并生效。离线时先入 outbox。 */
export async function submitDriverAction(
  snap: Snapshot,
  input: {
    action: ReceiptAction;
    vehicleId: string;
    stationId?: string;
    executorId: string;
    executorName: string;
    actualTon?: number;
    offline: boolean;
  },
): Promise<ApplyResult> {
  const db = await getDb();
  const t = snap.nowMin;
  const versions = currentVersionByVehicle(snap);
  const rv = versions[input.vehicleId];
  const receipt: Receipt = {
    id: newReceiptId(input.action, input.vehicleId, input.stationId, t),
    credentialId: input.stationId ? credentialOf(input.stationId) : `MANUAL-${input.action}`,
    stationId: input.stationId,
    vehicleId: input.vehicleId,
    routeVersionId: rv?.id ?? 'NONE',
    executorId: input.executorId,
    executorName: input.executorName,
    action: input.action,
    payload: input.actualTon != null ? `${input.actualTon}吨` : undefined,
    deviceTimeMin: t,
    uploadedAtMin: t,
    status: 'accepted',
  };

  if (input.offline) {
    await db.put('outbox', receipt);
    await log(db, t, input.executorName, 'offline', `离线：${input.action} ${input.stationId ?? ''} 已存入待上传队列`);
    emitChange();
    return { verdict: 'accepted', note: '已离线暂存' };
  }
  return intakeAndStore(snap, receipt);
}

async function intakeAndStore(snap: Snapshot, receipt: Receipt): Promise<ApplyResult> {
  const db = await getDb();
  const verdict = judgeReceipt(receipt, intakeCtx(snap));
  if (verdict.kind === 'duplicate') {
    // 保留重复上传痕迹（另存 id，不影响幂等键）
    const dupCopy: Receipt = { ...receipt, id: `${receipt.id}#dup`, status: 'duplicate', note: verdict.note };
    await db.put('receipts', dupCopy);
    await log(db, snap.nowMin, '系统', 'duplicate', `回执 ${receipt.id} 重复上传：${verdict.note}`);
    emitChange();
    return { verdict: 'duplicate', note: verdict.note };
  }
  if (verdict.kind === 'conflict') {
    const conflictCopy: Receipt = { ...receipt, status: 'conflict', note: verdict.note };
    await db.put('receipts', conflictCopy);
    await log(db, snap.nowMin, '系统', 'conflict', `回执 ${receipt.id} 冲突拒纳：${verdict.note}`);
    emitChange();
    return { verdict: 'conflict', note: verdict.note };
  }
  const stored: Receipt = { ...receipt, status: 'accepted' };
  await db.put('receipts', stored);
  const effect = await applyAcceptedEffect(db, snap, stored, receipt.payload ? parseFloat(receipt.payload) : undefined);
  emitChange();
  return { verdict: 'accepted', weighOutcome: effect.weighOutcome };
}

/** 离线队列上传：按发生时间顺序逐条受理（迟到回执在此触发冲突检测）。 */
export async function flushOutbox(snap: Snapshot, vehicleId: string): Promise<ApplyResult[]> {
  const db = await getDb();
  const queued = snap.outbox
    .filter((r) => r.vehicleId === vehicleId)
    .sort((a, b) => a.deviceTimeMin - b.deviceTimeMin);
  const results: ApplyResult[] = [];
  let cur = snap;
  for (const r of queued) {
    await db.delete('outbox', r.id);
    const res = await intakeAndStore(cur, r);
    results.push(res);
    cur = await loadSnapshot();
  }
  if (queued.length > 0) {
    await log(db, cur.nowMin, '系统', 'sync', `${vehicleId} 离线队列上传 ${queued.length} 条，受理完成`);
    emitChange();
  }
  return results;
}

// ---------- 称重后线路复检 ----------

/** 称重/状态变化后复检该车剩余线路：返回违例列表（供“必须停收并重排”提示）。 */
export function recheckVehicle(snap: Snapshot, vehicleId: string): string[] {
  const versions = currentVersionByVehicle(snap);
  const rv = versions[vehicleId];
  if (!rv) return [];
  const remaining = rv.stopIds
    .map((id) => snap.stations.find((s) => s.id === id))
    .filter((s): s is Station => !!s && s.status !== 'completed' && s.status !== 'rejected');
  const ev = evalRoute(vehicleInput(snap, vehicleId), remaining.map((s) => stopReqOf(snap, s.id)), {
    nowMin: snap.nowMin, roads: snap.roads, closures: snap.closures, dumps: snap.dumps,
  });
  return ev.violations.map((v) => v.reason);
}

// ---------- 方案应用 ----------

export async function applyPlan(snap: Snapshot, plan: PlanResult, actor: string, reason: string): Promise<void> {
  const db = await getDb();
  const versions = currentVersionByVehicle(snap);
  for (const vp of plan.vehiclePlans) {
    const cur = versions[vp.vehicleId];
    const curStops = cur?.stopIds ?? [];
    const unfinishedCur = curStops.filter((id) => {
      const st = snap.stations.find((s) => s.id === id);
      return st && st.status !== 'completed';
    });
    const same = unfinishedCur.join('|') === vp.stopIds.join('|');
    // 站点归属更新
    for (const sid of vp.stopIds) {
      const st = snap.stations.find((s) => s.id === sid)!;
      if (st.assignedVehicleId !== vp.vehicleId) {
        st.assignedVehicleId = vp.vehicleId;
        await db.put('stations', st);
      }
    }
    if (same) continue;
    const versionNo = (cur?.versionNo ?? 0) + 1;
    const rv: RouteVersion = {
      id: `RV-${vp.vehicleId}-${versionNo}`,
      vehicleId: vp.vehicleId,
      versionNo,
      stopIds: vp.stopIds,
      strategy: plan.strategy,
      reason,
      createdAtMin: snap.nowMin,
      basedOnVersionId: cur?.id,
    };
    await db.put('routeVersions', rv);
    await log(db, snap.nowMin, actor, 'replan',
      `${vp.vehicleId} 线路更新为 [${vp.stopIds.join(' → ')}]（版本 ${rv.id}，依据 ${cur?.id ?? '无'}，${reason}）`);
  }
  // 通知重发标记
  for (const rs of plan.resends) {
    const notif = snap.notifications.find((n) => n.id === rs.notificationId);
    if (notif && notif.status !== 'fulfilled') {
      notif.status = 'needs-resend';
      notif.resendReasons = rs.reasons;
      await db.put('notifications', notif);
      await log(db, snap.nowMin, actor, 'notify',
        `通知 ${notif.id}（${notif.stationId} ${notif.resident}）需重发：${rs.reasons.join('、')}`);
    }
  }
  emitChange();
}

// ---------- 客服：重发通知 ----------

export async function resendNotification(snap: Snapshot, notifId: string, actor: string): Promise<void> {
  const db = await getDb();
  const notif = snap.notifications.find((n) => n.id === notifId);
  if (!notif) return;
  const etas = computeCurrentEtas(snap);
  const cur = etas.get(notif.stationId);
  const versions = currentVersionByVehicle(snap);
  if (!cur) return;
  notif.notifiedVehicleId = cur.vehicleId;
  notif.notifiedEtaMin = cur.etaMin;
  notif.notifiedSeq = cur.seq;
  notif.notifiedRouteVersionId = versions[cur.vehicleId]?.id ?? notif.notifiedRouteVersionId;
  notif.status = 'valid';
  notif.resendReasons = [];
  await db.put('notifications', notif);
  await log(db, snap.nowMin, actor, 'notify',
    `通知 ${notif.id}（${notif.stationId} ${notif.resident}）已按 ${notif.notifiedRouteVersionId} 重发：${cur.vehicleId} 预计 ${fmtMin(cur.etaMin)} 到达`);
  emitChange();
}

// ---------- 道路封闭 / 卸载点 ----------

export async function addClosure(snap: Snapshot, input: { roadGroup: string; label: string; fromMin: number; toMin: number; reason: string }, actor: string): Promise<void> {
  const db = await getDb();
  const c: Closure = { id: `CL-${input.roadGroup}-${input.fromMin}`, ...input };
  await db.put('closures', c);
  await log(db, snap.nowMin, actor, 'closure', `道路封闭上报：${input.label} ${fmtMin(input.fromMin)}–${fmtMin(input.toMin)}（${input.reason}）`);
  emitChange();
}

export async function liftClosure(snap: Snapshot, closureId: string, actor: string): Promise<void> {
  const db = await getDb();
  const c = snap.closures.find((x) => x.id === closureId);
  await db.delete('closures', closureId);
  await log(db, snap.nowMin, actor, 'closure', `封闭解除：${c?.label ?? closureId}`);
  emitChange();
}

export async function setDumpWindows(snap: Snapshot, dumpId: string, windows: { startMin: number; endMin: number }[], actor: string, note: string): Promise<void> {
  const db = await getDb();
  const d = snap.dumps.find((x) => x.id === dumpId);
  if (!d) return;
  d.windows = windows;
  await db.put('dumps', d);
  await log(db, snap.nowMin, actor, 'dump', note);
  emitChange();
}

/** 转场卸载：车辆前往卸载点清空载重（核验卸载点开放时段，消耗行驶+作业时间）。 */
export async function divertToDump(snap: Snapshot, vehicleId: string, dumpId: string, actor: string): Promise<{ ok: boolean; reason?: string }> {
  const db = await getDb();
  const vehicle = snap.vehicles.find((v) => v.id === vehicleId)!;
  const dump = snap.dumps.find((d) => d.id === dumpId)!;
  const r = shortestPath(snap.roads, snap.closures, vehicle.posNodeId, dump.nodeId, snap.nowMin, vehicle);
  if (!r.ok) return { ok: false, reason: '前往卸载点无可通行路径（封闭或限高限宽）' };
  const arrive = snap.nowMin + r.minutes;
  const okWindow = dump.windows.some((w) => arrive >= w.startMin && arrive + dump.unloadMin <= w.endMin);
  if (!okWindow) {
    return { ok: false, reason: `预计 ${fmtMin(arrive)} 抵达 ${dump.name}，不在开放时段内，无法卸载` };
  }
  const doneMin = arrive + dump.unloadMin;
  vehicle.posNodeId = dump.nodeId;
  vehicle.loadTon = 0;
  await db.put('vehicles', vehicle);
  await db.put('meta', doneMin, 'nowMin');
  await log(db, doneMin, actor, 'dump', `${vehicleId} 转场 ${dump.name} 卸载完成（${fmtMin(arrive)} 到达，载重清零），时钟推进至 ${fmtMin(doneMin)}`);
  emitChange();
  return { ok: true };
}

// ---------- 演示事件（一键注入题目要求的验证输入） ----------

/** 演示：卸载点 D1 提前至 10:00 关闭。 */
export async function demoDumpEarlyClose(snap: Snapshot, actor: string): Promise<void> {
  await setDumpWindows(snap, 'D1', [{ startMin: 480, endMin: 600 }], actor,
    '演示事件：城东卸载点 D1 提前至 10:00 关闭（原 12:00）');
}

/** 演示：旧司机老王迟到的离线回执上传（S2 扫码，依据旧版本 RV-T1-1）。同一凭证重传只计一次。 */
export async function demoOldDriverLateReceipt(snap: Snapshot): Promise<ApplyResult> {
  const receipt: Receipt = {
    id: 'RC-DEMO-OLD-S2',
    credentialId: credentialOf('S2'),
    stationId: 'S2',
    vehicleId: 'T1',
    routeVersionId: 'RV-T1-1',
    executorId: 'D01',
    executorName: '老王',
    action: 'scan',
    deviceTimeMin: 558, // 09:18 离线时扫码
    uploadedAtMin: snap.nowMin,
    status: 'accepted',
  };
  return intakeAndStore(snap, receipt);
}
