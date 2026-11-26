// 回执受理规则验证：幂等去重 + 旧版本/旧分工冲突
import { describe, expect, it } from 'vitest';
import { judgeReceipt, type IntakeContext } from '../lib/receipts';
import type { Receipt, Station } from '../types';

function mkReceipt(overrides?: Partial<Receipt>): Receipt {
  return {
    id: 'RC-1',
    credentialId: 'QR-S2-20261126',
    stationId: 'S2',
    vehicleId: 'T1',
    routeVersionId: 'RV-T1-1',
    executorId: 'D01',
    executorName: '老王',
    action: 'scan',
    deviceTimeMin: 558,
    uploadedAtMin: 600,
    status: 'accepted',
    ...overrides,
  };
}

function mkCtx(overrides?: Partial<IntakeContext>): IntakeContext {
  const stations: Station[] = [
    {
      id: 'S1', name: '梧桐里站', nodeId: 'S1', estTon: 0.7, deadlineMin: 630, serviceMin: 2,
      status: 'pending', assignedVehicleId: 'T1',
    },
    {
      id: 'S2', name: '桥东市场站', nodeId: 'S2', estTon: 1.2, deadlineMin: 600, serviceMin: 2,
      status: 'pending', assignedVehicleId: 'T1',
    },
  ];
  return {
    stations,
    existingReceipts: [],
    currentStopsByVehicle: { T1: ['S1', 'S2'], T2: ['S3', 'S4'] },
    currentVersionByVehicle: { T1: 'RV-T1-1', T2: 'RV-T2-1' },
    ...overrides,
  };
}

describe('回执幂等与冲突', () => {
  it('正常回执：入账', () => {
    const v = judgeReceipt(mkReceipt(), mkCtx());
    expect(v.kind).toBe('accepted');
  });

  it('同一凭证重传只计一次（同一回执号）', () => {
    const first = mkReceipt();
    const ctx = mkCtx({ existingReceipts: [first] });
    const v = judgeReceipt(mkReceipt(), ctx);
    expect(v.kind).toBe('duplicate');
  });

  it('同一二维码同人同站同动作（不同回执号）也算重复', () => {
    const first = mkReceipt();
    const ctx = mkCtx({ existingReceipts: [first] });
    const v = judgeReceipt(mkReceipt({ id: 'RC-2' }), ctx);
    expect(v.kind).toBe('duplicate');
  });

  it('旧司机迟到的离线回执：站点已移交 T2 → 冲突，不能改判', () => {
    const ctx = mkCtx();
    ctx.stations[1].assignedVehicleId = 'T2'; // S2 已移交替班车辆
    ctx.currentStopsByVehicle.T1 = ['S1'];    // T1 新版本不再含 S2
    const v = judgeReceipt(mkReceipt(), ctx);
    expect(v.kind).toBe('conflict');
    if (v.kind === 'conflict') expect(v.note).toContain('移交');
  });

  it('站点已由替班司机完成 → 旧回执冲突', () => {
    const ctx = mkCtx();
    ctx.stations[1].status = 'completed';
    ctx.stations[1].completedBy = '小李';
    ctx.stations[1].assignedVehicleId = 'T2';
    const v = judgeReceipt(mkReceipt(), ctx);
    expect(v.kind).toBe('conflict');
  });

  it('站点仍在该车当前版本中但版本号已推进 → 入账（归属未变）', () => {
    const ctx = mkCtx({
      currentStopsByVehicle: { T1: ['S1', 'S2'] },
      currentVersionByVehicle: { T1: 'RV-T1-2' },
    });
    const v = judgeReceipt(mkReceipt({ stationId: 'S1', routeVersionId: 'RV-T1-1' }), ctx);
    expect(v.kind).toBe('accepted');
  });

  it('站点已不在该车当前版本中 → 冲突（依据旧版本）', () => {
    const ctx = mkCtx({
      currentStopsByVehicle: { T1: ['S1'] },
      currentVersionByVehicle: { T1: 'RV-T1-2' },
    });
    const v = judgeReceipt(mkReceipt(), ctx);
    expect(v.kind).toBe('conflict');
    if (v.kind === 'conflict') expect(v.note).toContain('RV-T1-1');
  });
});
