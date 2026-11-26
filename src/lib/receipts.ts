// 回执受理判定（纯函数）：幂等去重 + 旧版本/旧分工冲突检测
import type { Receipt, Station } from '../types';

export interface IntakeContext {
  stations: Station[];
  existingReceipts: Receipt[];
  /** 车辆当前线路版本所包含的站点（含已完成），用于判断回执是否仍属于当前分工 */
  currentStopsByVehicle: Record<string, string[]>;
  currentVersionByVehicle: Record<string, string>;
}

export type Verdict =
  | { kind: 'accepted' }
  | { kind: 'duplicate'; note: string }
  | { kind: 'conflict'; note: string };

/**
 * 判定一条回执是否入账：
 * 1. 同一凭证（同一回执号，或同人同站同动作的同一二维码）重传只计一次；
 * 2. 站点已由他人完成 → 冲突；
 * 3. 站点已移交其他车辆 → 冲突（旧司机迟到的离线回执不能改判）；
 * 4. 站点不在执行车辆当前线路版本中 → 冲突（回执依据的是旧版本）。
 */
export function judgeReceipt(r: Receipt, ctx: IntakeContext): Verdict {
  const dup = ctx.existingReceipts.some(
    (x) =>
      x.id === r.id ||
      (x.credentialId === r.credentialId &&
        x.action === r.action &&
        x.stationId === r.stationId &&
        x.executorId === r.executorId),
  );
  if (dup) {
    return { kind: 'duplicate', note: '同一凭证已入账，重复上传只计一次' };
  }

  if (r.stationId) {
    const st = ctx.stations.find((s) => s.id === r.stationId);
    if (!st) return { kind: 'conflict', note: `站点 ${r.stationId} 不存在` };
    if (st.status === 'completed' && st.completedBy !== r.executorId) {
      return {
        kind: 'conflict',
        note: `站点已由 ${st.completedBy} 完成，旧回执不能改判站点状态`,
      };
    }
    if (st.assignedVehicleId !== r.vehicleId) {
      return {
        kind: 'conflict',
        note: `站点已移交 ${st.assignedVehicleId}，本回执依据旧分工（${r.vehicleId}）`,
      };
    }
    const curStops = ctx.currentStopsByVehicle[r.vehicleId] ?? [];
    if (!curStops.includes(r.stationId)) {
      const curVer = ctx.currentVersionByVehicle[r.vehicleId] ?? '无';
      return {
        kind: 'conflict',
        note: `站点不在 ${r.vehicleId} 当前线路版本（${curVer}）中，回执依据旧版本 ${r.routeVersionId}`,
      };
    }
  }
  return { kind: 'accepted' };
}
