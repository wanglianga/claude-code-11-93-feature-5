// 规划器数值验证：与题目给定的 25 分钟（前置插入）/ 14 分钟（全局重排）一致
import { describe, expect, it } from 'vitest';
import { evalRoute, planGlobal, planInsert, type PlanPayload, type StopReq, type VehicleInput } from '../lib/planner';
import { shortestPath } from '../lib/graph';
import { CLOSURES, DUMPS, ROADS, START_MIN } from '../lib/seed';

const T1: VehicleInput = { id: 'T1', capacityTon: 5.0, loadTon: 3.0, heightM: 3.1, widthM: 2.4, posNodeId: 'P1' };
const T2: VehicleInput = { id: 'T2', capacityTon: 4.0, loadTon: 0.8, heightM: 2.4, widthM: 2.0, posNodeId: 'P2' };

const STOPS: StopReq[] = [
  { stationId: 'S1', nodeId: 'S1', ton: 0.7, deadlineMin: 630, serviceMin: 2 },
  { stationId: 'S2', nodeId: 'S2', ton: 1.2, deadlineMin: 600, serviceMin: 2 },
  { stationId: 'S3', nodeId: 'S3', ton: 0.8, deadlineMin: 630, serviceMin: 2 },
  { stationId: 'S4', nodeId: 'S4', ton: 0.7, deadlineMin: 660, serviceMin: 2 },
];

const NOTIFS = [
  { id: 'N1', stationId: 'S1', notifiedVehicleId: 'T1', notifiedEtaMin: 566, notifiedSeq: 1 },
  { id: 'N2', stationId: 'S2', notifiedVehicleId: 'T1', notifiedEtaMin: 576, notifiedSeq: 2 },
  { id: 'N3', stationId: 'S3', notifiedVehicleId: 'T2', notifiedEtaMin: 575, notifiedSeq: 1 },
  { id: 'N4', stationId: 'S4', notifiedVehicleId: 'T2', notifiedEtaMin: 585, notifiedSeq: 2 },
];

function payload(strategy: 'insert' | 'global', overrides?: Partial<PlanPayload>): PlanPayload {
  return {
    strategy,
    nowMin: START_MIN, // 09:20
    roads: ROADS,
    closures: CLOSURES, // 清河桥 09:20–10:15 封闭
    dumps: DUMPS,
    vehicles: [T1, T2],
    stops: STOPS,
    currentRoutes: { T1: ['S1', 'S2'], T2: ['S3', 'S4'] },
    blockedIds: ['S2'],
    notifications: NOTIFS,
    ...overrides,
  };
}

describe('封路场景下的双方案（题目给定数值）', () => {
  it('方案 A（前置插入）：T2 = S2→S3→S4，行驶 25 分钟，合计 31 分钟', () => {
    const plan = planInsert(payload('insert'));
    expect(plan.feasible).toBe(true);
    const t2 = plan.vehiclePlans.find((p) => p.vehicleId === 'T2')!;
    const t1 = plan.vehiclePlans.find((p) => p.vehicleId === 'T1')!;
    expect(t1.stopIds).toEqual(['S1']);
    expect(t2.stopIds).toEqual(['S2', 'S3', 'S4']);
    expect(t2.eval.totalDriveMin).toBe(25); // 8+7+10
    expect(plan.totalDriveMin).toBe(31); // T1 6 + T2 25
    // 载重不超限
    const maxLoad = Math.max(...t2.eval.legs.map((l) => l.loadAfterTon));
    expect(maxLoad).toBeLessThanOrEqual(4.0);
    // 各站均在截止前到达
    for (const leg of t2.eval.legs) {
      const dl = STOPS.find((s) => s.stationId === leg.stationId)!.deadlineMin;
      expect(leg.arriveMin).toBeLessThanOrEqual(dl);
    }
    // 方案 A 只有 S2 需重发（车辆变更），S3/S4 时刻偏移 ≤5 分钟
    expect(plan.resends.map((r) => r.stationId)).toEqual(['S2']);
    expect(plan.resends[0].reasons.join()).toContain('承运车辆变更');
  });

  it('方案 B（全局重排）：T2 = S3→S2→S4，行驶 14 分钟，合计 20 分钟', () => {
    const plan = planGlobal(payload('global'));
    expect(plan.feasible).toBe(true);
    const t2 = plan.vehiclePlans.find((p) => p.vehicleId === 'T2')!;
    const t1 = plan.vehiclePlans.find((p) => p.vehicleId === 'T1')!;
    expect(t1.stopIds).toEqual(['S1']);
    expect(t2.stopIds).toEqual(['S3', 'S2', 'S4']);
    expect(t2.eval.totalDriveMin).toBe(14); // 5+3+6
    expect(plan.totalDriveMin).toBe(20); // T1 6 + T2 14
    // 全局重排需重发 3 条：S2 车辆变更、S3 提前 10 分钟、S4 提前 7 分钟
    expect(plan.resends.map((r) => r.stationId).sort()).toEqual(['S2', 'S3', 'S4']);
    const n3 = plan.resends.find((r) => r.stationId === 'S3')!;
    expect(n3.reasons.join()).toContain('提前 10 分钟');
  });

  it('T1 保留 S2 被排除：桥梁封闭，绕行抵达 10:02 超过截止 10:00', () => {
    const plan = planInsert(payload('insert'));
    const rejected = plan.rejected.find((r) => r.subject === 'T1 承运 S2');
    expect(rejected).toBeDefined();
    expect(rejected!.reason).toContain('超过服务截止 10:00');
    // 直接核验：T1 当前位置 → S2 最短绕行也需 42 分钟，10:02 才到
    const path = shortestPath(ROADS, CLOSURES, 'P1', 'S2', START_MIN, T1);
    expect(path.ok).toBe(true);
    if (path.ok) expect(path.minutes).toBe(42);
    // 地图上“可达”但超过截止时刻 → 不可行
    const arrive = START_MIN + (path.ok ? path.minutes : 0);
    expect(arrive).toBeGreaterThan(600);
  });

  it('限高核验：T1（3.1m）不能走市场高架（限高 2.6m），T2（2.4m）可以', () => {
    const t1Path = shortestPath(ROADS, [], 'S2', 'S4', START_MIN, T1);
    expect(t1Path.ok).toBe(true);
    if (t1Path.ok) expect(t1Path.minutes).toBeGreaterThan(6); // 不能走 6 分钟直达高架
    const t2Path = shortestPath(ROADS, [], 'S2', 'S4', START_MIN, T2);
    expect(t2Path.ok).toBe(true);
    if (t2Path.ok) expect(t2Path.minutes).toBe(6);
  });

  it('载重核验：S2 实称 2.4 吨后，T2 无法再装 S4（0.7 吨）', () => {
    // T2 已装 S3(0.8)+S2(2.4)，载重 4.0 满载
    const fullT2: VehicleInput = { ...T2, loadTon: 4.0, posNodeId: 'S2' };
    const ev = evalRoute(fullT2, [STOPS[3]], {
      nowMin: 572, roads: ROADS, closures: CLOSURES, dumps: DUMPS,
    });
    expect(ev.feasible).toBe(false);
    expect(ev.violations.map((v) => v.reason).join()).toContain('超过车辆容量');
    // T1 可以接管 S4（载重 3.7 + 0.7 = 4.4 ≤ 5.0，且 11:00 前可达）
    const t1AfterS1: VehicleInput = { ...T1, loadTon: 3.7, posNodeId: 'S1' };
    const ev2 = evalRoute(t1AfterS1, [STOPS[3]], {
      nowMin: 572, roads: ROADS, closures: CLOSURES, dumps: DUMPS,
    });
    expect(ev2.feasible).toBe(true);
  });

  it('S2 实称 2.4 吨后的全局重排：S4 移交 T1', () => {
    const stopsAfter: StopReq[] = [
      { stationId: 'S4', nodeId: 'S4', ton: 0.7, deadlineMin: 660, serviceMin: 2 },
    ];
    const plan = planGlobal(payload('global', {
      nowMin: 572,
      stops: stopsAfter,
      vehicles: [
        { ...T1, loadTon: 3.7, posNodeId: 'S1' },
        { ...T2, loadTon: 4.0, posNodeId: 'S2' },
      ],
      currentRoutes: { T1: [], T2: ['S4'] },
      notifications: [NOTIFS[3]],
    }));
    expect(plan.feasible).toBe(true);
    const t1 = plan.vehiclePlans.find((p) => p.vehicleId === 'T1')!;
    expect(t1.stopIds).toEqual(['S4']); // T2 满载，只能 T1 接管
    expect(plan.resends.map((r) => r.stationId)).toEqual(['S4']);
  });

  it('卸载点时段核验：结束后可达 D1 且在开放时段内', () => {
    const plan = planGlobal(payload('global'));
    for (const vp of plan.vehiclePlans) {
      expect(vp.eval.dump.reachable).toBe(true);
    }
  });
});
