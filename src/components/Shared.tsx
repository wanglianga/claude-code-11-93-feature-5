// 共享 UI 小组件：状态徽章、事件日志、版本追溯
import React from 'react';
import type { EventLog, NotificationStatus, RouteVersion, StationStatus } from '../types';
import { fmtMin } from '../types';

export const VEHICLE_COLORS: Record<string, string> = {
  T1: '#2563eb',
  T2: '#059669',
};

export function StationBadge({ status, overflow }: { status: StationStatus; overflow?: boolean }) {
  const map: Record<StationStatus, [string, string]> = {
    pending: ['待服务', 'badge gray'],
    arrived: ['已到站', 'badge blue'],
    scanned: ['已扫码', 'badge indigo'],
    completed: ['已完成', 'badge green'],
    rejected: ['已拒收', 'badge red'],
  };
  const [text, cls] = map[status];
  return (
    <span>
      <span className={cls}>{text}</span>
      {overflow && <span className="badge orange">满溢</span>}
    </span>
  );
}

export function NotifBadge({ status }: { status: NotificationStatus }) {
  const map: Record<NotificationStatus, [string, string]> = {
    valid: ['有效', 'badge green'],
    'needs-resend': ['需重发', 'badge orange'],
    fulfilled: ['已履约', 'badge blue'],
    invalid: ['已失效', 'badge gray'],
  };
  const [text, cls] = map[status];
  return <span className={cls}>{text}</span>;
}

export function EventLogPanel({ events }: { events: EventLog[] }) {
  const sorted = events.slice().sort((a, b) => (b.id ?? 0) - (a.id ?? 0)).slice(0, 80);
  return (
    <div className="panel">
      <h3>事件日志（可追溯）</h3>
      <table className="tbl">
        <thead>
          <tr><th>时刻</th><th>操作者</th><th>类型</th><th>内容</th></tr>
        </thead>
        <tbody>
          {sorted.map((e) => (
            <tr key={e.id}>
              <td className="mono">{fmtMin(e.tsMin)}</td>
              <td>{e.actor}</td>
              <td><span className="tag">{e.type}</span></td>
              <td>{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STRATEGY_NAME: Record<string, string> = {
  initial: '初始排线',
  insert: '最小变更（移交受阻站点）',
  global: '全局重排',
  manual: '人工调整',
};

export function VersionTracePanel({ versions }: { versions: RouteVersion[] }) {
  const sorted = versions.slice().sort((a, b) => a.vehicleId.localeCompare(b.vehicleId) || a.versionNo - b.versionNo);
  return (
    <div className="panel">
      <h3>线路版本追溯</h3>
      <table className="tbl">
        <thead>
          <tr><th>版本</th><th>车辆</th><th>站点顺序</th><th>策略</th><th>生成时刻</th><th>依据版本</th><th>原因</th></tr>
        </thead>
        <tbody>
          {sorted.map((rv) => (
            <tr key={rv.id}>
              <td className="mono">{rv.id}</td>
              <td><span className="veh-dot" style={{ background: VEHICLE_COLORS[rv.vehicleId] ?? '#666' }} />{rv.vehicleId}</td>
              <td className="mono">{rv.stopIds.join(' → ')}</td>
              <td>{STRATEGY_NAME[rv.strategy] ?? rv.strategy}</td>
              <td className="mono">{fmtMin(rv.createdAtMin)}</td>
              <td className="mono">{rv.basedOnVersionId ?? '—'}</td>
              <td>{rv.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
