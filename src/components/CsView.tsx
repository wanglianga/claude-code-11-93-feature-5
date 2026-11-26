// 客服端：按线路版本核查预约通知是否仍有效，并重发
import React, { useMemo } from 'react';
import type { Snapshot } from '../lib/db';
import type { Account } from '../types';
import { fmtMin } from '../types';
import { computeCurrentEtas, currentVersionByVehicle, resendNotification } from '../lib/actions';
import { NotifBadge, StationBadge, VersionTracePanel } from './Shared';

export function CsView({ snap, account }: { snap: Snapshot; account: Account }) {
  const etas = useMemo(() => computeCurrentEtas(snap), [snap]);
  const versions = useMemo(() => currentVersionByVehicle(snap), [snap]);
  const [msg, setMsg] = React.useState('');

  const resend = async (id: string) => {
    await resendNotification(snap, id, account.name);
    setMsg(`通知 ${id} 已按当前线路版本重发`);
  };

  return (
    <div className="layout single">
      <div className="panel">
        <h3>预约通知有效性（对照当前线路版本）</h3>
        <p className="muted small">
          判定规则：通知依据的车辆、到达顺序、预计时刻（±5 分钟内）与当前线路版本一致则“有效”；否则“需重发”。站点完成即“已履约”。
        </p>
        {msg && <div className="demo-msg">{msg}</div>}
        <table className="tbl">
          <thead>
            <tr>
              <th>编号</th><th>站点</th><th>居民</th><th>预约时段</th>
              <th>通知依据（版本/车辆/时刻）</th><th>当前线路（版本/车辆/时刻）</th>
              <th>状态</th><th>需重发原因</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {snap.notifications.map((n) => {
              const st = snap.stations.find((s) => s.id === n.stationId)!;
              const cur = etas.get(n.stationId);
              const curVersion = cur ? versions[cur.vehicleId]?.id : undefined;
              return (
                <tr key={n.id}>
                  <td className="mono">{n.id}</td>
                  <td>{n.stationId} {st.name}<div><StationBadge status={st.status} /></div></td>
                  <td>{n.resident}</td>
                  <td>{n.slotText}</td>
                  <td className="mono small">{n.notifiedRouteVersionId} / {n.notifiedVehicleId} / {fmtMin(n.notifiedEtaMin)}</td>
                  <td className="mono small">
                    {st.status === 'completed'
                      ? `${fmtMin(st.completedAtMin!)} 已由 ${st.completedBy} 完成`
                      : cur
                        ? `${curVersion} / ${cur.vehicleId} / ${fmtMin(cur.etaMin)}`
                        : '未排入当前线路'}
                  </td>
                  <td><NotifBadge status={n.status} /></td>
                  <td className="small">{n.resendReasons.join('、') || '—'}</td>
                  <td>
                    {n.status === 'needs-resend' && (
                      <button className="btn small primary" onClick={() => resend(n.id)}>重发通知</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <VersionTracePanel versions={snap.routeVersions} />
    </div>
  );
}
