// 双方案并列对比：路线、载重、延误、需重发通知 —— 不只给一条“最优”线
import React from 'react';
import type { PlanResult } from '../lib/planner';
import type { Snapshot } from '../lib/db';
import { fmtMin } from '../types';
import { VEHICLE_COLORS } from './Shared';

function PlanCard({
  title, subtitle, plan, snap, onApply, applying,
}: {
  title: string;
  subtitle: string;
  plan: PlanResult;
  snap: Snapshot;
  onApply: (plan: PlanResult) => void;
  applying: boolean;
}) {
  const stationName = (id: string) => snap.stations.find((s) => s.id === id)?.name ?? id;
  const stationDeadline = (id: string) => snap.stations.find((s) => s.id === id)?.deadlineMin ?? 0;
  const shiftOf = (sid: string) => plan.etaShifts.find((x) => x.stationId === sid)?.shiftMin;

  return (
    <div className={`plan-card ${plan.feasible ? '' : 'infeasible'}`}>
      <div className="plan-head">
        <h4>{title}</h4>
        <div className="plan-sub">{subtitle}</div>
      </div>
      <div className="plan-kpis">
        <div className="kpi"><span className="kpi-num">{plan.totalDriveMin}</span>分钟总行驶</div>
        <div className="kpi"><span className="kpi-num">{plan.resends.length}</span>条通知需重发</div>
        <div className="kpi"><span className="kpi-num">{plan.feasible ? '✓' : '✗'}</span>{plan.feasible ? '约束全部满足' : '存在违例'}</div>
      </div>

      {plan.vehiclePlans.map((vp) => {
        const veh = snap.vehicles.find((v) => v.id === vp.vehicleId)!;
        const maxLoad = Math.max(veh.loadTon, ...vp.eval.legs.map((l) => l.loadAfterTon));
        return (
          <div key={vp.vehicleId} className="plan-veh">
            <div className="plan-veh-head">
              <span className="veh-dot" style={{ background: VEHICLE_COLORS[vp.vehicleId] ?? '#666' }} />
              <b>{vp.vehicleId}</b>
              <span className="muted">现载 {veh.loadTon.toFixed(1)}t / 容量 {veh.capacityTon.toFixed(1)}t</span>
              <span className={maxLoad <= veh.capacityTon + 1e-6 ? 'ok' : 'bad'}>
                峰值载重 {maxLoad.toFixed(1)}t {maxLoad <= veh.capacityTon + 1e-6 ? '✓' : '超载 ✗'}
              </span>
            </div>
            {vp.stopIds.length === 0 && <div className="muted small">（无站点）</div>}
            <table className="tbl small">
              <tbody>
                {vp.eval.legs.map((leg, i) => {
                  const dl = stationDeadline(leg.stationId);
                  const late = leg.arriveMin > dl;
                  const shift = shiftOf(leg.stationId);
                  return (
                    <tr key={leg.stationId}>
                      <td className="mono">{i + 1}. {leg.stationId}</td>
                      <td>{stationName(leg.stationId)}</td>
                      <td className="mono">行驶{leg.driveMin}分</td>
                      <td className={late ? 'bad mono' : 'mono'}>
                        {fmtMin(leg.arriveMin)} 到{late ? `（超截止 ${fmtMin(dl)}）` : ''}
                      </td>
                      <td className="mono">载 {leg.loadAfterTon.toFixed(1)}t</td>
                      <td className="mono">
                        {shift == null ? '' : shift === 0 ? '时刻不变' : shift > 0 ? `延后${shift}分` : `提前${-shift}分`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className={`small ${vp.eval.dump.reachable ? 'muted' : 'bad'}`}>卸载核验：{vp.eval.dump.note}</div>
            {vp.eval.violations.map((v, i) => (
              <div key={i} className="bad small">✗ {v.reason}</div>
            ))}
          </div>
        );
      })}

      {plan.resends.length > 0 ? (
        <div className="plan-resend">
          <b>需重发的通知（{plan.resends.length}）：</b>
          <ul>
            {plan.resends.map((r) => (
              <li key={r.notificationId}>
                {r.notificationId}（{r.stationId}）：{r.reasons.join('、')}
                {r.oldVehicleId !== r.newVehicleId && `，${r.oldVehicleId}→${r.newVehicleId}`}
                {`，${fmtMin(r.oldEtaMin)}→${fmtMin(r.newEtaMin)}`}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="muted small">无需重发的通知（已通知时刻与顺序均保持）。</div>
      )}

      {plan.notes.map((n, i) => (
        <div key={i} className="muted small">· {n}</div>
      ))}

      <button className="btn primary" disabled={!plan.feasible || applying} onClick={() => onApply(plan)}>
        应用此方案（生成新线路版本）
      </button>
    </div>
  );
}

export function PlanCompare({
  planA, planB, snap, onApply, applying,
}: {
  planA: PlanResult;
  planB: PlanResult;
  snap: Snapshot;
  onApply: (plan: PlanResult) => void;
  applying: boolean;
}) {
  const rejected = [...planA.rejected];
  for (const r of planB.rejected) {
    if (!rejected.some((x) => x.subject === r.subject)) rejected.push(r);
  }
  const driveDiff = planA.totalDriveMin - planB.totalDriveMin;
  return (
    <div className="panel">
      <h3>封路重排方案对比（两案均通过吨位 / 限高限宽 / 截止时刻 / 卸载点时段核验）</h3>
      <div className="compare-summary">
        方案 B 比方案 A 少行驶 <b>{driveDiff}</b> 分钟（{planA.totalDriveMin} → {planB.totalDriveMin}），
        但需重发通知 <b>{planB.resends.length}</b> 条（方案 A 为 {planA.resends.length} 条）。
        方案 A 变更范围小、保留已通知顺序，但替班车辆绕行更多。请调度权衡后选择。
      </div>
      <div className="plan-grid">
        <PlanCard title="方案 A · 最小变更" subtitle="保留其他已通知站点顺序，仅将受阻站点移交有余量的车辆"
          plan={planA} snap={snap} onApply={onApply} applying={applying} />
        <PlanCard title="方案 B · 全局重排" subtitle="重新排列全部未完成站点，最小化总行驶时间"
          plan={planB} snap={snap} onApply={onApply} applying={applying} />
      </div>
      {rejected.length > 0 && (
        <div className="rejected-box">
          <b>已排除的候选（不是“地图上可达”就算可行，均需通过吨位与道路限制核验）：</b>
          <ul>
            {rejected.map((r, i) => (
              <li key={i}><span className="mono">{r.subject}</span>：{r.reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
