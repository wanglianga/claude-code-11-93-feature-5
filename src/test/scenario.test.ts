// 端到端场景集成测试（fake-indexeddb）：完整走一遍题目要求的演示流程
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  advanceClock, applyPlan, buildPlanPayload, currentVersionByVehicle,
  demoDumpEarlyClose, demoOldDriverLateReceipt, divertToDump, flushOutbox,
  recheckVehicle, resetDemo, resendNotification, setClock, submitDriverAction,
} from '../lib/actions';
import { loadSnapshot, type Snapshot } from '../lib/db';
import { runPlan } from '../lib/planner';

async function snap(): Promise<Snapshot> {
  return loadSnapshot();
}

const LAO_WANG = { executorId: 'D01', executorName: '老王' };
const XIAO_LI = { executorId: 'D02', executorName: '小李' };

describe('完整演示流程（封路→双方案→超重→重排→迟到回执→最终状态）', () => {
  beforeEach(async () => {
    await resetDemo();
  });

  it('种子现场：09:20，T1=[S1,S2]，T2=[S3,S4]，清河桥封闭', async () => {
    const s = await snap();
    expect(s.nowMin).toBe(560);
    expect(s.closures).toHaveLength(1);
    const v = currentVersionByVehicle(s);
    expect(v.T1.stopIds).toEqual(['S1', 'S2']);
    expect(v.T2.stopIds).toEqual(['S3', 'S4']);
    // T1 当前线路已不可行（S2 到不了）
    expect(recheckVehicle(s, 'T1').length).toBeGreaterThan(0);
  });

  it('全流程', async () => {
    // ---- 1. 调度员生成两个方案 ----
    let s = await snap();
    const planA = runPlan(buildPlanPayload(s, 'insert'));
    const planB = runPlan(buildPlanPayload(s, 'global'));
    expect(planA.vehiclePlans.find((p) => p.vehicleId === 'T2')!.eval.totalDriveMin).toBe(25);
    expect(planB.vehiclePlans.find((p) => p.vehicleId === 'T2')!.eval.totalDriveMin).toBe(14);
    expect(planA.resends.map((r) => r.stationId)).toEqual(['S2']);
    expect(planB.resends.map((r) => r.stationId).sort()).toEqual(['S2', 'S3', 'S4']);

    // ---- 2. 应用方案 B（全局重排） ----
    await applyPlan(s, planB, '张调度', '封路重排（全局优化）');
    s = await snap();
    let v = currentVersionByVehicle(s);
    expect(v.T1.id).toBe('RV-T1-2');
    expect(v.T2.id).toBe('RV-T2-2');
    expect(v.T2.stopIds).toEqual(['S3', 'S2', 'S4']);
    expect(s.stations.find((x) => x.id === 'S2')!.assignedVehicleId).toBe('T2');
    expect(s.notifications.filter((n) => n.status === 'needs-resend')).toHaveLength(3);

    // ---- 3. 客服重发通知 ----
    await resendNotification(s, 'N2', '陈客服');
    s = await snap();
    expect(s.notifications.find((n) => n.id === 'N2')!.status).toBe('valid');
    expect(s.notifications.find((n) => n.id === 'N2')!.notifiedVehicleId).toBe('T2');

    // ---- 4. 小李（T2）执行：S3 → S2（实称 2.4 吨） ----
    await advanceClock(5, '小李'); // 09:25
    s = await snap();
    await submitDriverAction(s, { action: 'arrive', vehicleId: 'T2', stationId: 'S3', ...XIAO_LI, offline: false });
    s = await snap();
    await submitDriverAction(s, { action: 'scan', vehicleId: 'T2', stationId: 'S3', ...XIAO_LI, offline: false });
    s = await snap();
    const w1 = await submitDriverAction(s, { action: 'weigh', vehicleId: 'T2', stationId: 'S3', ...XIAO_LI, actualTon: 0.8, offline: false });
    expect(w1.weighOutcome).toBe('completed');
    s = await snap();
    expect(s.vehicles.find((x) => x.id === 'T2')!.loadTon).toBeCloseTo(1.6);

    await advanceClock(5, '小李'); // 09:30
    s = await snap();
    await submitDriverAction(s, { action: 'arrive', vehicleId: 'T2', stationId: 'S2', ...XIAO_LI, offline: false });
    s = await snap();
    await submitDriverAction(s, { action: 'scan', vehicleId: 'T2', stationId: 'S2', ...XIAO_LI, offline: false });
    s = await snap();
    // S2 实称 2.4 吨：剩余容量 2.4，恰好可装 → 完成，T2 满载 4.0
    const w2 = await submitDriverAction(s, { action: 'weigh', vehicleId: 'T2', stationId: 'S2', ...XIAO_LI, actualTon: 2.4, offline: false });
    expect(w2.weighOutcome).toBe('completed');
    s = await snap();
    expect(s.vehicles.find((x) => x.id === 'T2')!.loadTon).toBeCloseTo(4.0);
    expect(s.stations.find((x) => x.id === 'S2')!.status).toBe('completed');
    expect(s.stations.find((x) => x.id === 'S2')!.actualTon).toBeCloseTo(2.4);

    // ---- 5. 复检：T2 后续 S4 超载 → 必须停收重排 ----
    const violations = recheckVehicle(s, 'T2');
    expect(violations.join()).toContain('S4');
    // 小李若仍尝试在 S4 称重 0.7 吨 → 拒收
    await advanceClock(8, '小李'); // 09:38
    s = await snap();
    await submitDriverAction(s, { action: 'arrive', vehicleId: 'T2', stationId: 'S4', ...XIAO_LI, offline: false });
    s = await snap();
    await submitDriverAction(s, { action: 'scan', vehicleId: 'T2', stationId: 'S4', ...XIAO_LI, offline: false });
    s = await snap();
    const w3 = await submitDriverAction(s, { action: 'weigh', vehicleId: 'T2', stationId: 'S4', ...XIAO_LI, actualTon: 0.7, offline: false });
    expect(w3.weighOutcome).toBe('rejected');
    s = await snap();
    expect(s.stations.find((x) => x.id === 'S4')!.status).toBe('rejected');

    // ---- 6. 调度员再次重排：S4 移交 T1 ----
    const plan2 = runPlan(buildPlanPayload(s, 'global'));
    expect(plan2.vehiclePlans.find((p) => p.vehicleId === 'T1')!.stopIds).toContain('S4');
    await applyPlan(s, plan2, '张调度', 'S2 实称超重后全局重排');
    s = await snap();
    v = currentVersionByVehicle(s);
    expect(v.T1.stopIds).toEqual(['S1', 'S4']);
    expect(s.stations.find((x) => x.id === 'S4')!.assignedVehicleId).toBe('T1');
    // S4 通知需重发（车辆变更）
    expect(s.notifications.find((n) => n.id === 'N4')!.status).toBe('needs-resend');

    // ---- 7. 卸载点提前关闭 + 老王迟到离线回执（冲突 + 幂等） ----
    await demoDumpEarlyClose(s, '张调度');
    s = await snap();
    expect(s.dumps[0].windows[0].endMin).toBe(600);
    // 09:56 后再想转场：抵达 10:08 已超出开放时段 → 不可卸载
    await setClock(596, '张调度', '时钟推进至 09:56');
    s = await snap();
    const dv = await divertToDump(s, 'T2', 'D1', '小李');
    expect(dv.ok).toBe(false);
    expect(dv.reason).toContain('不在开放时段');

    const late1 = await demoOldDriverLateReceipt(s);
    expect(late1.verdict).toBe('conflict'); // S2 已移交且已完成，旧回执不能改判
    s = await snap();
    expect(s.stations.find((x) => x.id === 'S2')!.completedBy).toBe('小李'); // 状态未被改判
    const late2 = await demoOldDriverLateReceipt(s);
    expect(late2.verdict).toBe('duplicate'); // 同一凭证重传只计一次

    // ---- 8. 老王（T1）完成 S1、S4 ----
    s = await snap();
    await submitDriverAction(s, { action: 'arrive', vehicleId: 'T1', stationId: 'S1', ...LAO_WANG, offline: false });
    s = await snap();
    await submitDriverAction(s, { action: 'scan', vehicleId: 'T1', stationId: 'S1', ...LAO_WANG, offline: false });
    s = await snap();
    const w4 = await submitDriverAction(s, { action: 'weigh', vehicleId: 'T1', stationId: 'S1', ...LAO_WANG, actualTon: 0.7, offline: false });
    expect(w4.weighOutcome).toBe('completed');
    s = await snap();
    await submitDriverAction(s, { action: 'arrive', vehicleId: 'T1', stationId: 'S4', ...LAO_WANG, offline: false });
    s = await snap();
    await submitDriverAction(s, { action: 'scan', vehicleId: 'T1', stationId: 'S4', ...LAO_WANG, offline: false });
    s = await snap();
    const w5 = await submitDriverAction(s, { action: 'weigh', vehicleId: 'T1', stationId: 'S4', ...LAO_WANG, actualTon: 0.7, offline: false });
    expect(w5.weighOutcome).toBe('completed');

    // ---- 9. 时钟推进到 10:15，封路解除；最终状态核验 ----
    await setClock(615, '张调度', '时钟推进至 10:15，清河桥封闭解除');
    s = await snap();
    for (const st of s.stations) expect(st.status).toBe('completed');
    // 全部通知已履约
    for (const n of s.notifications) expect(n.status).toBe('fulfilled');
    // 版本可追溯
    v = currentVersionByVehicle(s);
    expect(v.T1.id).toBe('RV-T1-3');
    expect(v.T1.basedOnVersionId).toBe('RV-T1-2');
    expect(v.T2.id).toBe('RV-T2-3'); // S4 全部移交后 T2 线路为空
    expect(v.T2.stopIds).toEqual([]);
    expect(v.T2.basedOnVersionId).toBe('RV-T2-2');
    // 回执流水包含：冲突 1 条 + 重复 1 条
    expect(s.receipts.filter((r) => r.status === 'conflict')).toHaveLength(1);
    expect(s.receipts.filter((r) => r.status === 'duplicate')).toHaveLength(1);
  });

  it('离线队列：离线扫码暂存，上线后上传入账', async () => {
    let s = await snap();
    // 老王离线完成 S1 扫码
    await submitDriverAction(s, { action: 'arrive', vehicleId: 'T1', stationId: 'S1', ...LAO_WANG, offline: true });
    s = await snap();
    await submitDriverAction(s, { action: 'scan', vehicleId: 'T1', stationId: 'S1', ...LAO_WANG, offline: true });
    s = await snap();
    expect(s.outbox).toHaveLength(2);
    expect(s.stations.find((x) => x.id === 'S1')!.status).toBe('pending'); // 未生效
    const results = await flushOutbox(s, 'T1');
    expect(results.every((r) => r.verdict === 'accepted')).toBe(true);
    s = await snap();
    expect(s.outbox).toHaveLength(0);
    expect(s.stations.find((x) => x.id === 'S1')!.status).toBe('scanned'); // 补录生效
  });
});
