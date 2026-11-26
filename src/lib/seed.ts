// 随题固定的虚构演示数据：路网、车辆、桶站、卸载点、居民预约通知
// 全部 deterministic，可通过“重置并重放”随时恢复到 09:20 封路通知到达的现场。
import type {
  Account, Closure, DumpSite, EventLog, NodeDef, NotificationDoc,
  Road, RouteVersion, Station, Vehicle,
} from '../types';

export const START_MIN = 560; // 09:20，封路通知到达
export const BRIDGE_CLOSE_FROM = 560; // 09:20
export const BRIDGE_CLOSE_TO = 615;   // 10:15

export const ACCOUNTS: Account[] = [
  { id: 'U-DISP', username: 'dispatcher', password: 'disp123', name: '张调度', role: 'dispatcher' },
  { id: 'D01', username: 'driver1', password: 'drv123', name: '老王', role: 'driver', vehicleId: 'T1' },
  { id: 'D02', username: 'driver2', password: 'drv123', name: '小李', role: 'driver', vehicleId: 'T2' },
  { id: 'U-CS', username: 'service', password: 'svc123', name: '陈客服', role: 'cs' },
];

export const NODES: NodeDef[] = [
  { id: 'DEPOT', name: '车队车场', x: 90, y: 430, kind: 'depot' },
  { id: 'P1', name: '滨河路口（T1 当前位置）', x: 150, y: 330, kind: 'point' },
  { id: 'S1', name: '梧桐里站', x: 250, y: 250, kind: 'station' },
  { id: 'S2', name: '桥东市场站', x: 430, y: 140, kind: 'station' },
  { id: 'P2', name: '文体中心（T2 当前位置）', x: 500, y: 400, kind: 'point' },
  { id: 'S3', name: '朝阳小区站', x: 580, y: 300, kind: 'station' },
  { id: 'S4', name: '河湾花园站', x: 710, y: 370, kind: 'station' },
  { id: 'D1', name: '城东卸载点', x: 740, y: 90, kind: 'dump' },
];

export const ROADS: Road[] = [
  // T1 侧
  { id: 'R-P1-S1', group: 'G-P1S1', from: 'P1', to: 'S1', minutes: 6 },
  { id: 'R-S1-P1', group: 'G-P1S1', from: 'S1', to: 'P1', minutes: 6 },
  { id: 'R-S1-S2', group: 'G-BRIDGE', name: '清河桥', from: 'S1', to: 'S2', minutes: 10 },
  { id: 'R-S2-S1', group: 'G-BRIDGE', name: '清河桥', from: 'S2', to: 'S1', minutes: 10 },
  { id: 'R-P1-DEP', group: 'G-P1DEP', from: 'P1', to: 'DEPOT', minutes: 15 },
  { id: 'R-DEP-P1', group: 'G-P1DEP', from: 'DEPOT', to: 'P1', minutes: 15 },
  { id: 'R-DEP-S2', group: 'G-DEPS2', from: 'DEPOT', to: 'S2', minutes: 30, widthLimitM: 2.5 },
  { id: 'R-S2-DEP', group: 'G-DEPS2', from: 'S2', to: 'DEPOT', minutes: 30, widthLimitM: 2.5 },
  // T2 侧（注意 S2→S3 与 S3→S2 为单向不同时）
  { id: 'R-P2-S2', group: 'G-P2S2', from: 'P2', to: 'S2', minutes: 8 },
  { id: 'R-S2-P2', group: 'G-P2S2', from: 'S2', to: 'P2', minutes: 8 },
  { id: 'R-S2-S3', group: 'G-S2S3', from: 'S2', to: 'S3', minutes: 7 },
  { id: 'R-S3-S2', group: 'G-S3S2', from: 'S3', to: 'S2', minutes: 3 },
  { id: 'R-S3-S4', group: 'G-S3S4', name: '朝阳路（单行）', from: 'S3', to: 'S4', minutes: 10 },
  { id: 'R-P2-S3', group: 'G-P2S3', from: 'P2', to: 'S3', minutes: 5 },
  { id: 'R-S3-P2', group: 'G-P2S3', from: 'S3', to: 'P2', minutes: 5 },
  { id: 'R-S2-S4', group: 'G-S2S4', name: '市场高架', from: 'S2', to: 'S4', minutes: 6, heightLimitM: 2.6 },
  { id: 'R-S4-S2', group: 'G-S2S4', name: '市场高架', from: 'S4', to: 'S2', minutes: 6, heightLimitM: 2.6 },
  // 跨区（S3→S4 为单行；T1 到 S2 只能走清河桥或绕行车场，保证封路前提成立）
  { id: 'R-S1-S4', group: 'G-S1S4', from: 'S1', to: 'S4', minutes: 20 },
  { id: 'R-S4-S1', group: 'G-S1S4', from: 'S4', to: 'S1', minutes: 20 },
  // 卸载点进出
  { id: 'R-S4-D1', group: 'G-S4D1', from: 'S4', to: 'D1', minutes: 12 },
  { id: 'R-D1-S4', group: 'G-S4D1', from: 'D1', to: 'S4', minutes: 12 },
  { id: 'R-S2-D1', group: 'G-S2D1', from: 'S2', to: 'D1', minutes: 15 },
  { id: 'R-D1-S2', group: 'G-S2D1', from: 'D1', to: 'S2', minutes: 15 },
  { id: 'R-S3-D1', group: 'G-S3D1', from: 'S3', to: 'D1', minutes: 9 },
  { id: 'R-D1-S3', group: 'G-S3D1', from: 'D1', to: 'S3', minutes: 9 },
  { id: 'R-S1-D1', group: 'G-S1D1', from: 'S1', to: 'D1', minutes: 30 },
  { id: 'R-D1-S1', group: 'G-S1D1', from: 'D1', to: 'S1', minutes: 30 },
  { id: 'R-P1-D1', group: 'G-P1D1', from: 'P1', to: 'D1', minutes: 30 },
  { id: 'R-D1-P1', group: 'G-P1D1', from: 'D1', to: 'P1', minutes: 30 },
  { id: 'R-P2-D1', group: 'G-P2D1', from: 'P2', to: 'D1', minutes: 14 },
  { id: 'R-D1-P2', group: 'G-P2D1', from: 'D1', to: 'P2', minutes: 14 },
  { id: 'R-DEP-D1', group: 'G-DEPD1', from: 'DEPOT', to: 'D1', minutes: 18 },
  { id: 'R-D1-DEP', group: 'G-DEPD1', from: 'D1', to: 'DEPOT', minutes: 18 },
];

export const CLOSURES: Closure[] = [
  {
    id: 'CL-BRIDGE-1',
    roadGroup: 'G-BRIDGE',
    label: '清河桥',
    fromMin: BRIDGE_CLOSE_FROM,
    toMin: BRIDGE_CLOSE_TO,
    reason: '桥梁临时封闭检修（09:20–10:15）',
  },
];

export const VEHICLES: Vehicle[] = [
  {
    id: 'T1', name: 'T1 压缩车', plate: '环A·1017',
    capacityTon: 5.0, loadTon: 3.0, heightM: 3.1, widthM: 2.4,
    posNodeId: 'P1', driverId: 'D01', driverName: '老王',
  },
  {
    id: 'T2', name: 'T2 压缩车', plate: '环A·2088',
    capacityTon: 4.0, loadTon: 0.8, heightM: 2.4, widthM: 2.0,
    posNodeId: 'P2', driverId: 'D02', driverName: '小李',
  },
];

export const STATIONS: Station[] = [
  {
    id: 'S1', name: '梧桐里站', nodeId: 'S1', estTon: 0.7, deadlineMin: 630, serviceMin: 2,
    status: 'pending', assignedVehicleId: 'T1',
  },
  {
    id: 'S2', name: '桥东市场站', nodeId: 'S2', estTon: 1.2, deadlineMin: 600, serviceMin: 2,
    status: 'pending', assignedVehicleId: 'T1',
  },
  {
    id: 'S3', name: '朝阳小区站', nodeId: 'S3', estTon: 0.8, deadlineMin: 630, serviceMin: 2,
    status: 'pending', assignedVehicleId: 'T2',
  },
  {
    id: 'S4', name: '河湾花园站', nodeId: 'S4', estTon: 0.7, deadlineMin: 660, serviceMin: 2,
    status: 'pending', assignedVehicleId: 'T2',
  },
];

export const DUMPS: DumpSite[] = [
  { id: 'D1', name: '城东卸载点', nodeId: 'D1', windows: [{ startMin: 480, endMin: 720 }], unloadMin: 5 },
];

export const ROUTE_VERSIONS: RouteVersion[] = [
  {
    id: 'RV-T1-1', vehicleId: 'T1', versionNo: 1, stopIds: ['S1', 'S2'],
    strategy: 'initial', reason: '早班初始排线', createdAtMin: 540,
  },
  {
    id: 'RV-T2-1', vehicleId: 'T2', versionNo: 1, stopIds: ['S3', 'S4'],
    strategy: 'initial', reason: '早班初始排线', createdAtMin: 540,
  },
];

// 居民已获知的预计到达（通知时刻 = 计划到达 + 10 分钟告知缓冲）
export const NOTIFICATIONS: NotificationDoc[] = [
  {
    id: 'N1', stationId: 'S1', resident: '张女士', slotText: '09:20–09:40',
    notifiedVehicleId: 'T1', notifiedEtaMin: 566, notifiedSeq: 1, notifiedRouteVersionId: 'RV-T1-1',
    status: 'valid', resendReasons: [],
  },
  {
    id: 'N2', stationId: 'S2', resident: '李先生', slotText: '09:30–09:50',
    notifiedVehicleId: 'T1', notifiedEtaMin: 576, notifiedSeq: 2, notifiedRouteVersionId: 'RV-T1-1',
    status: 'valid', resendReasons: [],
  },
  {
    id: 'N3', stationId: 'S3', resident: '王阿姨', slotText: '09:30–09:50',
    notifiedVehicleId: 'T2', notifiedEtaMin: 575, notifiedSeq: 1, notifiedRouteVersionId: 'RV-T2-1',
    status: 'valid', resendReasons: [],
  },
  {
    id: 'N4', stationId: 'S4', resident: '赵先生', slotText: '09:40–10:00',
    notifiedVehicleId: 'T2', notifiedEtaMin: 585, notifiedSeq: 2, notifiedRouteVersionId: 'RV-T2-1',
    status: 'valid', resendReasons: [],
  },
];

export const SEED_EVENTS: EventLog[] = [
  { tsMin: 540, actor: '系统', type: 'init', message: '早班排线完成：T1=[S1,S2]，T2=[S3,S4]（版本 RV-T1-1 / RV-T2-1）' },
  { tsMin: 560, actor: '路政', type: 'closure', message: '09:20 清河桥封闭至 10:15，T1 无法按原顺序前往 S2（S2 截止 10:00）' },
];

export function credentialOf(stationId: string): string {
  return `QR-${stationId}-20261126`;
}
