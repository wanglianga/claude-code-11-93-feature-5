// 司机端：按当前线路登记 到站 / 扫码 / 称重 / 满溢 / 封路，支持离线队列与转场卸载
import React, { useMemo, useState } from 'react';
import type { Snapshot } from '../lib/db';
import type { Account, Station } from '../types';
import { fmtMin } from '../types';
import {
  addClosure, currentVersionByVehicle, divertToDump, flushOutbox,
  recheckVehicle, submitDriverAction,
} from '../lib/actions';
import { shortestPath } from '../lib/graph';
import { credentialOf } from '../lib/seed';
import { StationBadge, VEHICLE_COLORS } from './Shared';

export function DriverView({ snap, account }: { snap: Snapshot; account: Account }) {
  const vehicle = snap.vehicles.find((v) => v.id === account.vehicleId)!;
  const versions = useMemo(() => currentVersionByVehicle(snap), [snap]);
  const rv = versions[vehicle.id];
  const [offline, setOffline] = useState(false);
  const [scanFor, setScanFor] = useState<Station | null>(null);
  const [weighFor, setWeighFor] = useState<Station | null>(null);
  const [weighTon, setWeighTon] = useState('');
  const [msg, setMsg] = useState('');
  const [rejectInfo, setRejectInfo] = useState<{ station: Station; ton: number; remaining: number } | null>(null);
  const [closureMin, setClosureMin] = useState(60);

  const stops = (rv?.stopIds ?? [])
    .map((id) => snap.stations.find((s) => s.id === id)!)
    .filter(Boolean);
  const nextPending = stops.find((s) => s.status !== 'completed' && s.status !== 'rejected');
  const myOutbox = snap.outbox.filter((r) => r.vehicleId === vehicle.id);
  const myReceipts = snap.receipts.filter((r) => r.vehicleId === vehicle.id).slice().reverse().slice(0, 15);
  const violations = recheckVehicle(snap, vehicle.id);
  const remaining = Math.round((vehicle.capacityTon - vehicle.loadTon) * 100) / 100;

  const doAction = async (action: 'arrive' | 'scan' | 'overflow', station: Station) => {
    const res = await submitDriverAction(snap, {
      action, vehicleId: vehicle.id, stationId: station.id,
      executorId: account.id, executorName: account.name, offline,
    });
    setMsg(res.note ? `${action} ${station.id}：${res.note}` : `${action} ${station.id} 已受理`);
  };

  const doWeigh = async () => {
    if (!weighFor) return;
    const ton = parseFloat(weighTon);
    if (isNaN(ton) || ton <= 0) {
      setMsg('请输入有效的实称吨数');
      return;
    }
    const st = weighFor;
    setWeighFor(null);
    const res = await submitDriverAction(snap, {
      action: 'weigh', vehicleId: vehicle.id, stationId: st.id,
      executorId: account.id, executorName: account.name, actualTon: ton, offline,
    });
    if (res.weighOutcome === 'rejected') {
      setRejectInfo({ station: st, ton, remaining });
      setMsg('');
    } else if (res.weighOutcome === 'completed') {
      setMsg(`${st.id} 实称 ${ton} 吨已入车，站点完成`);
    } else {
      setMsg(res.note ?? '已受理');
    }
  };

  const reportClosure = async () => {
    await addClosure(snap, {
      roadGroup: 'G-BRIDGE', label: '清河桥',
      fromMin: snap.nowMin, toMin: snap.nowMin + closureMin,
      reason: `司机 ${account.name} 现场上报封路`,
    }, account.name);
    setMsg(`已上报清河桥封闭 ${closureMin} 分钟`);
  };

  const tryDivert = async (dumpId: string) => {
    const r = await divertToDump(snap, vehicle.id, dumpId, account.name);
    setMsg(r.ok ? '转场卸载完成，载重清零' : `无法转场卸载：${r.reason}`);
    if (r.ok) setRejectInfo(null);
  };

  const upload = async () => {
    const results = await flushOutbox(snap, vehicle.id);
    const accepted = results.filter((r) => r.verdict === 'accepted').length;
    const dup = results.filter((r) => r.verdict === 'duplicate').length;
    const conflict = results.filter((r) => r.verdict === 'conflict').length;
    setMsg(`离线队列已上传：入账 ${accepted} 条，重复 ${dup} 条，冲突 ${conflict} 条`);
  };

  return (
    <div className="layout">
      <div className="col-left">
        <div className="panel">
          <h3>我的车辆与线路</h3>
          <div className="veh-head">
            <span className="veh-dot" style={{ background: VEHICLE_COLORS[vehicle.id] }} />
            <b>{vehicle.name}</b>（{vehicle.plate}）
            <span className="mono">载重 {vehicle.loadTon.toFixed(1)}/{vehicle.capacityTon.toFixed(1)}t</span>
            <span className="mono">剩余 {remaining.toFixed(1)}t</span>
            <span className="muted">位置 {vehicle.posNodeId}</span>
          </div>
          <div className="loadbar">
            <div className="loadbar-fill" style={{ width: `${Math.min(100, (vehicle.loadTon / vehicle.capacityTon) * 100)}%`, background: VEHICLE_COLORS[vehicle.id] }} />
          </div>
          <div className="version-trace">
            当前线路版本：<b className="mono">{rv?.id ?? '—'}</b>
            {rv && <>（{rv.reason}{rv.basedOnVersionId ? `，源自 ${rv.basedOnVersionId}` : ''}）</>}
          </div>
          {violations.length > 0 && (
            <div className="alert">⚠ 当前线路不再可行：{violations.join('；')}。请等待调度重排或联系调度员。</div>
          )}
          {rejectInfo && (
            <div className="alert strong">
              ✋ 实称 {rejectInfo.ton.toFixed(1)} 吨超出剩余容量 {rejectInfo.remaining.toFixed(1)} 吨，
              {rejectInfo.station.id} 已停收（拒收）。请勿强行装载；可转场卸载后返回，或等待调度移交其他车辆。
              <div className="btn-row">
                {snap.dumps.map((d) => {
                  const path = shortestPath(snap.roads, snap.closures, vehicle.posNodeId, d.nodeId, snap.nowMin, vehicle);
                  const arrive = path.ok ? snap.nowMin + path.minutes : null;
                  const ok = arrive != null && d.windows.some((w) => arrive >= w.startMin && arrive + d.unloadMin <= w.endMin);
                  return (
                    <button key={d.id} className="btn small" disabled={!ok}
                      title={ok ? '' : '卸载点已关闭或到达超出开放时段'}
                      onClick={() => tryDivert(d.id)}>
                      转场 {d.name}{ok ? `（${fmtMin(arrive!)} 到）` : '（不可用）'}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {msg && <div className="demo-msg">{msg}</div>}
        </div>

        <div className="panel">
          <h3>当前线路站点（按顺序执行）</h3>
          <table className="tbl">
            <thead>
              <tr><th>序</th><th>站点</th><th>估重/实称</th><th>截止</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              {stops.map((st, i) => {
                const isNext = nextPending?.id === st.id;
                return (
                  <tr key={st.id} className={st.status === 'completed' ? 'row-done' : isNext ? 'row-next' : ''}>
                    <td className="mono">{i + 1}</td>
                    <td>{st.id} {st.name}{isNext && <span className="tag">下一站</span>}</td>
                    <td className="mono">估{st.estTon}t{st.actualTon != null ? ` / 实${st.actualTon}t` : ''}</td>
                    <td className="mono">{fmtMin(st.deadlineMin)}</td>
                    <td><StationBadge status={st.status} overflow={st.overflowReported} /></td>
                    <td className="actions">
                      {st.status === 'pending' && isNext && (
                        <button className="btn small" onClick={() => doAction('arrive', st)}>到站</button>
                      )}
                      {st.status === 'arrived' && (
                        <button className="btn small" onClick={() => setScanFor(st)}>扫码</button>
                      )}
                      {st.status === 'scanned' && (
                        <button className="btn small primary" onClick={() => { setWeighFor(st); setWeighTon(String(st.estTon)); }}>称重</button>
                      )}
                      {(st.status === 'pending' || st.status === 'arrived' || st.status === 'scanned') && (
                        <button className="btn small ghost" onClick={() => doAction('overflow', st)}>满溢上报</button>
                      )}
                      {st.status === 'completed' && <span className="ok small">✓ {fmtMin(st.completedAtMin!)} 完成</span>}
                      {st.status === 'rejected' && <span className="bad small">✗ 已拒收，等待重排</span>}
                    </td>
                  </tr>
                );
              })}
              {stops.length === 0 && <tr><td colSpan={6} className="muted">当前线路无站点</td></tr>}
            </tbody>
          </table>
          <div className="btn-row">
            <button className="btn" onClick={reportClosure}>封路上报（清河桥，{closureMin} 分钟）</button>
            <select value={closureMin} onChange={(e) => setClosureMin(Number(e.target.value))}>
              <option value={30}>30 分钟</option>
              <option value={60}>60 分钟</option>
              <option value={120}>120 分钟</option>
            </select>
            {snap.dumps.map((d) => (
              <button key={d.id} className="btn ghost" onClick={() => tryDivert(d.id)}>转场 {d.name} 卸载</button>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3>回执与离线</h3>
          <div className="btn-row">
            <label className="switch">
              <input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} />
              离线模式（操作存入待上传队列）
            </label>
            <button className="btn small" disabled={myOutbox.length === 0} onClick={upload}>
              上线并上传（{myOutbox.length} 条待传）
            </button>
          </div>
          <table className="tbl small">
            <thead><tr><th>回执号</th><th>动作</th><th>站点</th><th>依据版本</th><th>时刻</th><th>判定</th></tr></thead>
            <tbody>
              {myReceipts.map((r) => (
                <tr key={r.id}>
                  <td className="mono small">{r.id}</td>
                  <td>{r.action}{r.payload ? ` ${r.payload}` : ''}</td>
                  <td>{r.stationId ?? '—'}</td>
                  <td className="mono small">{r.routeVersionId}</td>
                  <td className="mono">{fmtMin(r.deviceTimeMin)}</td>
                  <td>
                    <span className={`badge ${r.status === 'accepted' ? 'green' : r.status === 'duplicate' ? 'gray' : 'red'}`}>
                      {r.status === 'accepted' ? '已入账' : r.status === 'duplicate' ? '重复' : '冲突'}
                    </span>
                    {r.note && <div className="muted tiny">{r.note}</div>}
                  </td>
                </tr>
              ))}
              {myReceipts.length === 0 && <tr><td colSpan={6} className="muted">暂无回执</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* 扫码弹窗 */}
      {scanFor && (
        <div className="modal-mask" onClick={() => setScanFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h4>扫码 · {scanFor.id} {scanFor.name}</h4>
            <p className="muted">对准站点二维码，或点击模拟扫码：</p>
            <div className="qr-box mono">{credentialOf(scanFor.id)}</div>
            <div className="btn-row">
              <button className="btn primary" onClick={async () => { setScanFor(null); await doAction('scan', scanFor); }}>
                模拟扫码并提交
              </button>
              <button className="btn" onClick={() => setScanFor(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 称重弹窗 */}
      {weighFor && (
        <div className="modal-mask" onClick={() => setWeighFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h4>称重 · {weighFor.id} {weighFor.name}</h4>
            <p className="muted">
              估重 {weighFor.estTon} 吨（估重不是实称）。车辆剩余容量 {remaining.toFixed(1)} 吨。
              实称超出剩余容量将必须停收并重排。
            </p>
            <input className="input" type="number" step="0.1" min="0" value={weighTon}
              onChange={(e) => setWeighTon(e.target.value)} />
            <div className="btn-row">
              <button className="btn primary" onClick={doWeigh}>提交实称重量</button>
              <button className="btn" onClick={() => setWeighFor(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
